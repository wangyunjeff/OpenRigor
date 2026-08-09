import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { URL } from "node:url";
import {
  PROTOCOL_VERSION,
  createInitialSnapshot,
  isTerminalStatus,
  validateRunRequest,
  type EventBase,
  type FileArtifact,
  type RunEvent,
  type RunRequest,
  type RunSnapshot,
  type RunStatus,
  type ToolCall
} from "@openrigor/protocol";

const port = Number.parseInt(process.env.PORT ?? "8787", 10);
const allowedOrigins = new Set(
  (process.env.WEB_ORIGINS ?? process.env.WEB_ORIGIN ?? "http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://127.0.0.1:4173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
);
const maxBodyBytes = 256 * 1024;

type EventListener = (event: RunEvent) => void;

interface RunRecord {
  snapshot: RunSnapshot;
  events: RunEvent[];
  listeners: Set<EventListener>;
  cancelRequested: boolean;
}

const runs = new Map<string, RunRecord>();

function timestamp(): string {
  return new Date().toISOString();
}

function setCors(req: IncomingMessage, res: ServerResponse): void {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.has(origin)) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Last-Event-ID");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Vary", "Origin");
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function baseEvent<T extends RunEvent["type"]>(record: RunRecord, type: T, ts = timestamp()): EventBase<T> {
  const sequence = record.events.length + 1;
  return {
    protocolVersion: PROTOCOL_VERSION,
    type,
    eventId: `${record.snapshot.runId}:${sequence}`,
    runId: record.snapshot.runId,
    sequence,
    ts
  } as EventBase<T>;
}

function publish(record: RunRecord, event: RunEvent): void {
  record.events.push(event);
  applyProjection(record, event);
  for (const listener of record.listeners) listener(event);
}

function applyProjection(record: RunRecord, event: RunEvent): void {
  if (event.type === "snapshot") {
    record.snapshot = event.snapshot;
    return;
  }
  const next: RunSnapshot = { ...record.snapshot, updatedAt: event.ts };
  if (event.type === "status") {
    next.status = event.status;
    if (event.progress !== undefined) next.progress = event.progress;
    if (event.currentStep !== undefined) next.currentStep = event.currentStep;
  } else if (event.type === "run-finished") {
    next.status = event.status;
    next.progress = event.status === "completed" ? 100 : next.progress;
    if (event.error) next.error = event.error;
  } else if (event.type === "error") {
    next.error = { code: event.code, message: event.message };
  }
  record.snapshot = next;
}

function publishStatus(record: RunRecord, status: RunStatus, options: { message?: string; progress?: number; currentStep?: string } = {}): void {
  const eventBase = baseEvent(record, "status");
  const event: RunEvent = {
    ...eventBase,
    type: "status",
    status,
    ...(options.message === undefined ? {} : { message: options.message }),
    ...(options.progress === undefined ? {} : { progress: options.progress }),
    ...(options.currentStep === undefined ? {} : { currentStep: options.currentStep })
  };
  publish(record, event);
}

function publishTool(record: RunRecord, tool: ToolCall): void {
  publish(record, { ...baseEvent(record, "tool"), type: "tool", tool });
}

function publishTextDelta(record: RunRecord, partId: string, kind: "text" | "reasoning", delta: string): void {
  publish(record, { ...baseEvent(record, "part-delta"), type: "part-delta", partId, kind, delta });
}

function publishFinished(record: RunRecord, status: Extract<RunStatus, "completed" | "failed" | "cancelled">, error?: { code: string; message: string }): void {
  const base = baseEvent(record, "run-finished");
  const event: RunEvent = {
    ...base,
    type: "run-finished",
    status,
    ...(error === undefined ? {} : { error })
  };
  publish(record, event);
}

function sendEvent(res: ServerResponse, event: RunEvent): void {
  res.write(`id: ${event.eventId}\n`);
  res.write(`event: ${event.type}\n`);
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBodyBytes) throw new Error("request body is too large");
    chunks.push(buffer);
  }
  if (size === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isCancelled(record: RunRecord): boolean {
  return record.cancelRequested || isTerminalStatus(record.snapshot.status);
}

async function executeDemoRun(record: RunRecord): Promise<void> {
  await delay(80);
  if (record.cancelRequested) {
    publishFinished(record, "cancelled");
    return;
  }

  publishStatus(record, "running", { progress: 8, currentStep: "Planning" });
  await delay(120);
  if (isCancelled(record)) {
    publishFinished(record, "cancelled");
    return;
  }

  const callId = `tool_${randomUUID().slice(0, 8)}`;
  const startedAt = timestamp();
  publishStatus(record, "waiting_tool", { progress: 22, currentStep: "Inspecting workspace" });
  publishTool(record, { callId, name: "workspace.inspect", phase: "requested", inputSummary: "list top-level files" });
  await delay(160);
  if (isCancelled(record)) {
    publishTool(record, { callId, name: "workspace.inspect", phase: "failed", outputSummary: "cancelled", startedAt, finishedAt: timestamp() });
    publishFinished(record, "cancelled");
    return;
  }
  publishTool(record, { callId, name: "workspace.inspect", phase: "succeeded", outputSummary: "demo workspace is ready", startedAt, finishedAt: timestamp() });

  publishStatus(record, "running", { progress: 48, currentStep: "Streaming answer" });
  const answer = `OpenRigor demo run received: ${record.snapshot.prompt}`;
  for (const chunk of answer.match(/.{1,18}/g) ?? [answer]) {
    if (isCancelled(record)) {
      publishFinished(record, "cancelled");
      return;
    }
    publishTextDelta(record, "answer", "text", chunk);
    await delay(35);
  }
  publish(record, {
    ...baseEvent(record, "part"),
    type: "part",
    part: { partId: "answer", kind: "text", text: answer, done: true }
  });
  publishStatus(record, "running", { progress: 84, currentStep: "Finalizing" });
  await delay(80);
  publishFinished(record, "completed");
}

function createRun(request: RunRequest): RunRecord {
  const runId = `run_${randomUUID().replaceAll("-", "").slice(0, 20)}`;
  const record: RunRecord = {
    snapshot: createInitialSnapshot(runId, request),
    events: [],
    listeners: new Set(),
    cancelRequested: false
  };
  runs.set(runId, record);
  publish(record, { ...baseEvent(record, "snapshot"), type: "snapshot", snapshot: record.snapshot });
  void executeDemoRun(record).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "executor failed";
    publish(record, { ...baseEvent(record, "error"), type: "error", code: "EXECUTOR_ERROR", message, retryable: false });
    publishFinished(record, "failed", { code: "EXECUTOR_ERROR", message });
  });
  return record;
}

function connectEvents(req: IncomingMessage, res: ServerResponse, runId: string): void {
  const record = runs.get(runId);
  if (!record) {
    sendJson(res, 404, { error: "run not found" });
    return;
  }

  res.statusCode = 200;
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const rawLastId = req.headers["last-event-id"];
  const lastId = Array.isArray(rawLastId) ? rawLastId[0] : rawLastId;
  const lastSequence = lastId?.startsWith(`${runId}:`) ? Number.parseInt(lastId.slice(runId.length + 1), 10) : 0;
  const listener: EventListener = (event) => sendEvent(res, event);
  record.listeners.add(listener);
  res.write(": openrigor\n\n");
  for (const event of record.events) {
    if (event.sequence > (Number.isFinite(lastSequence) ? lastSequence : 0)) sendEvent(res, event);
  }

  const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), 15_000);
  const cleanup = (): void => {
    clearInterval(heartbeat);
    record.listeners.delete(listener);
  };
  req.on("close", cleanup);
  res.on("close", cleanup);
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  setCors(req, res);
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  if (req.method === "GET" && url.pathname === "/healthz") {
    sendJson(res, 200, { ok: true, service: "openrigor-api", executor: process.env.OPENRIGOR_EXECUTOR ?? "demo" });
    return;
  }

  const eventMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/events$/);
  const eventRunId = eventMatch?.[1];
  if (req.method === "GET" && eventRunId) {
    connectEvents(req, res, eventRunId);
    return;
  }

  const runMatch = url.pathname.match(/^\/api\/runs\/([^/]+)$/);
  const runId = runMatch?.[1];
  if (req.method === "GET" && runId) {
    const record = runs.get(runId);
    if (!record) return sendJson(res, 404, { error: "run not found" });
    sendJson(res, 200, { snapshot: record.snapshot, events: record.events });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/runs") {
    try {
      const request = validateRunRequest(await readJson(req));
      const record = createRun(request);
      sendJson(res, 202, { runId: record.snapshot.runId, status: record.snapshot.status, eventsUrl: `/api/runs/${record.snapshot.runId}/events` });
    } catch (error: unknown) {
      sendJson(res, 400, { error: error instanceof Error ? error.message : "invalid request" });
    }
    return;
  }

  const cancelMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/cancel$/);
  const cancelRunId = cancelMatch?.[1];
  if (req.method === "POST" && cancelRunId) {
    const record = runs.get(cancelRunId);
    if (!record) return sendJson(res, 404, { error: "run not found" });
    if (!isTerminalStatus(record.snapshot.status) && !record.cancelRequested) {
      record.cancelRequested = true;
      publishStatus(record, "cancelling", { currentStep: "Cancellation requested" });
    }
    sendJson(res, 202, { runId: record.snapshot.runId, status: record.snapshot.status });
    return;
  }

  sendJson(res, 404, { error: "not found" });
}

const server = createServer((req, res) => {
  void handle(req, res).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "internal server error";
    if (!res.headersSent) sendJson(res, 500, { error: message });
    else res.end();
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`OpenRigor API listening on http://127.0.0.1:${port}`);
});

function shutdown(signal: string): void {
  console.log(`received ${signal}; closing API`);
  server.close(() => process.exit(0));
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
