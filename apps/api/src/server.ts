import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import { URL } from "node:url";
import {
  PROTOCOL_VERSION,
  createInitialSnapshot,
  isTerminalStatus,
  supportsUltraMode,
  validateRunRequest,
  type EventBase,
  type FileArtifact,
  type RunEvent,
  type RunDetail,
  type RunRequest,
  type RunSnapshot,
  type RunStatus,
  type ToolCall
} from "@openrigor/protocol";
import {
  createCodexAppServerClientFromEnv,
  type CodexAppServerClient,
  type CodexNotification,
  type CodexReasoningEffort
} from "./codex-app-server.js";
import {
  IdempotencyConflictError,
  getOrCreateIdempotent,
  type IdempotencyEntry
} from "./idempotency.js";

const port = Number.parseInt(process.env.PORT ?? "8787", 10);
const allowedOrigins = new Set(
  (process.env.WEB_ORIGINS ?? process.env.WEB_ORIGIN ?? "http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174,http://localhost:4173,http://127.0.0.1:4173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
);
const maxBodyBytes = 256 * 1024;
const executor = (process.env.OPENRIGOR_EXECUTOR ?? "demo").trim().toLowerCase();
const codexClient = executor === "codex-app-server" ? createCodexAppServerClientFromEnv() : null;
const codexCwd = resolve(process.env.OPENRIGOR_CODEX_CWD?.trim() || process.cwd());
const codexSandbox = parseCodexSandbox(process.env.OPENRIGOR_CODEX_SANDBOX);
const codexApprovalPolicy = parseCodexApprovalPolicy(process.env.OPENRIGOR_CODEX_APPROVAL_POLICY);

function parseCodexSandbox(value: string | undefined): "read-only" | "workspace-write" | "danger-full-access" {
  if (value === "read-only" || value === "danger-full-access" || value === "workspace-write") return value;
  return "workspace-write";
}

function parseCodexApprovalPolicy(value: string | undefined): "untrusted" | "on-request" | "never" {
  if (value === "untrusted" || value === "on-request" || value === "never") return value;
  // The first local integration has no approval UI yet. `never` keeps a run
  // from hanging while still honoring the app-server sandbox policy.
  return "never";
}

type EventListener = (event: RunEvent) => void;

interface RunRecord {
  snapshot: RunSnapshot;
  events: RunEvent[];
  listeners: Set<EventListener>;
  cancelRequested: boolean;
  codexThreadId?: string;
  codexTurnId?: string;
  codexTools: Map<string, ToolCall>;
  codexUsage?: { inputTokens?: number; outputTokens?: number; providerRequestId?: string };
}

const runs = new Map<string, RunRecord>();
const runsByClientRequestId = new Map<string, IdempotencyEntry<RunRecord>>();
const runsByConversationId = new Map<string, RunRecord[]>();

class HttpError extends Error {
  public constructor(public readonly statusCode: number, message: string) {
    super(message);
  }
}

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

function publishFinished(
  record: RunRecord,
  status: Extract<RunStatus, "completed" | "failed" | "cancelled">,
  error?: { code: string; message: string },
  usage?: { inputTokens?: number; outputTokens?: number; providerRequestId?: string }
): void {
  // Cancellation, provider completion, and executor failure can race. Keep
  // the public event stream strictly single-terminal so clients do not need
  // to guess which completion event wins.
  if (isTerminalStatus(record.snapshot.status)) return;
  const base = baseEvent(record, "run-finished");
  const event: RunEvent = {
    ...base,
    type: "run-finished",
    status,
    ...(error === undefined ? {} : { error }),
    ...(usage === undefined ? {} : { usage })
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

function codexRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function codexString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function codexNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function codexFlattenText(value: unknown, depth = 0): string {
  if (depth > 5 || value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((item) => codexFlattenText(item, depth + 1)).filter(Boolean).join("\n");
  if (typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  const direct = typeof record.text === "string" ? record.text : "";
  if (direct) return direct;
  for (const key of ["content", "summary", "parts", "message"]) {
    const nested = codexFlattenText(record[key], depth + 1);
    if (nested) return nested;
  }
  return "";
}

function safeCodexText(value: unknown, maxLength = 4_000): string | undefined {
  if (typeof value !== "string" || !value) return undefined;
  // Keep obvious credentials out of the browser event stream. This is a
  // lightweight local guard, not a replacement for production secret scanning.
  const redacted = value
    .replace(/sk-[A-Za-z0-9_-]{16,}/g, "[REDACTED]")
    .replace(/(api[_-]?key|authorization|token)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]");
  return redacted.length > maxLength ? `${redacted.slice(0, maxLength)}...` : redacted;
}

function publishCodexStatus(record: RunRecord, status: RunStatus, options: { progress?: number; currentStep?: string }): void {
  const progress = options.progress === undefined ? record.snapshot.progress : Math.max(record.snapshot.progress, options.progress);
  const sameStatus = record.snapshot.status === status;
  const sameStep = options.currentStep === undefined || record.snapshot.currentStep === options.currentStep;
  if (sameStatus && sameStep && progress === record.snapshot.progress) return;
  publishStatus(record, status, {
    progress,
    ...(options.currentStep === undefined ? {} : { currentStep: options.currentStep })
  });
}

function codexEffort(request: RunRequest): CodexReasoningEffort {
  // OpenRigor exposes Ultra as an orchestration mode. Codex app-server's
  // current transport represents that mode through the special `ultra`
  // effort value; it is not forwarded as a normal model reasoning level.
  if (request.mode === "ultra") {
    if (!supportsUltraMode(request.model)) {
      throw new Error("Codex Ultra requires an explicit gpt-5.6-sol or gpt-5.6-terra model");
    }
    return "ultra";
  }

  const configured = process.env.OPENRIGOR_CODEX_EFFORT?.trim();
  if (configured) {
    if (configured === "fast") return "low";
    if (configured === "balanced") return "medium";
    if (configured === "deep") return "max";
    if (configured === "low" || configured === "medium" || configured === "high" || configured === "xhigh" || configured === "max") {
      return configured;
    }
    if (configured === "ultra") {
      throw new Error("OPENRIGOR_CODEX_EFFORT=ultra is ambiguous; request mode=ultra explicitly");
    }
    throw new Error(`unsupported OPENRIGOR_CODEX_EFFORT: ${configured}`);
  }
  return request.effort ?? "medium";
}

function codexItemId(item: Record<string, unknown>): string | undefined {
  return codexString(item.id);
}

function codexToolInfo(item: Record<string, unknown>): { name: string; inputSummary?: string } | null {
  const type = codexString(item.type);
  if (!type) return null;
  if (type === "commandExecution") {
    const command = safeCodexText(item.command, 600);
    const info: { name: string; inputSummary?: string } = { name: "command.execute" };
    if (command !== undefined) info.inputSummary = command;
    return info;
  }
  if (type === "fileChange") {
    const changes = Array.isArray(item.changes) ? item.changes : [];
    const paths = changes.map((change) => codexString(codexRecord(change)?.path)).filter((path): path is string => path !== undefined);
    const info: { name: string; inputSummary?: string } = { name: "file.change" };
    if (paths.length > 0) info.inputSummary = paths.join(", ");
    return info;
  }
  if (type === "webSearch") {
    const query = safeCodexText(item.query, 600);
    const info: { name: string; inputSummary?: string } = { name: "web.search" };
    if (query !== undefined) info.inputSummary = query;
    return info;
  }
  if (type === "mcpToolCall") {
    const server = codexString(item.server) ?? "mcp";
    const tool = codexString(item.tool) ?? "tool";
    const info: { name: string; inputSummary?: string } = { name: `${server}.${tool}` };
    const inputSummary = item.arguments === undefined ? undefined : safeCodexText(JSON.stringify(item.arguments), 800);
    if (inputSummary !== undefined) info.inputSummary = inputSummary;
    return info;
  }
  if (type === "dynamicToolCall") {
    const namespace = codexString(item.namespace);
    const tool = codexString(item.tool) ?? "tool";
    const info: { name: string; inputSummary?: string } = { name: namespace ? `${namespace}.${tool}` : tool };
    const inputSummary = item.arguments === undefined ? undefined : safeCodexText(JSON.stringify(item.arguments), 800);
    if (inputSummary !== undefined) info.inputSummary = inputSummary;
    return info;
  }
  if (type === "collabAgentToolCall") {
    const prompt = safeCodexText(item.prompt, 800);
    const info: { name: string; inputSummary?: string } = { name: "subagent" };
    if (prompt !== undefined) info.inputSummary = prompt;
    return info;
  }
  if (type === "subAgentActivity") return { name: "subagent.activity" };
  if (type === "imageGeneration") return { name: "image.generate" };
  if (type === "sleep") return { name: "clock.sleep" };
  return null;
}

function codexToolPhase(item: Record<string, unknown>, started: boolean): ToolCall["phase"] {
  const status = codexString(item.status);
  if (started && (!status || status === "inProgress")) return "requested";
  if (status === "failed" || status === "declined") return "failed";
  if (status === "completed") return "succeeded";
  return started ? "running" : "succeeded";
}

function codexToolOutput(item: Record<string, unknown>): string | undefined {
  const candidates = [item.aggregatedOutput, item.result, item.error, item.output];
  for (const candidate of candidates) {
    const text = typeof candidate === "string" ? safeCodexText(candidate, 2_000) : candidate && typeof candidate === "object" ? safeCodexText(JSON.stringify(candidate), 2_000) : undefined;
    if (text) return text;
  }
  return undefined;
}

function publishCodexItem(record: RunRecord, item: Record<string, unknown>, started: boolean): void {
  const itemId = codexItemId(item);
  const info = codexToolInfo(item);
  if (!itemId || !info) {
    const type = codexString(item.type);
    if (type === "reasoning") publishCodexStatus(record, "running", { progress: 12, currentStep: "Reasoning" });
    if (type === "plan") publishCodexStatus(record, "running", { progress: 8, currentStep: "Planning" });
    if (type === "agentMessage") publishCodexStatus(record, "running", { progress: 55, currentStep: "Writing answer" });
    return;
  }

  const existing = record.codexTools.get(itemId);
  const startedAt = existing?.startedAt ?? timestamp();
  const phase = codexToolPhase(item, started);
  const outputSummary = started ? existing?.outputSummary : codexToolOutput(item) ?? existing?.outputSummary;
  const inputSummary = info.inputSummary ?? existing?.inputSummary;
  const tool: ToolCall = {
    callId: itemId,
    name: info.name,
    phase,
    ...(outputSummary === undefined ? {} : { outputSummary }),
    startedAt,
    ...(started ? {} : { finishedAt: timestamp() })
  };
  if (inputSummary !== undefined) tool.inputSummary = inputSummary;
  record.codexTools.set(itemId, tool);
  if (started) {
    publishCodexStatus(record, "waiting_tool", { progress: 22, currentStep: info.name });
  }
  publishTool(record, tool);
}

function publishCodexFileArtifacts(record: RunRecord, item: Record<string, unknown>): void {
  const changes = Array.isArray(item.changes) ? item.changes : [];
  for (const change of changes) {
    const changeRecord = codexRecord(change);
    const path = codexString(changeRecord?.path);
    if (!path) continue;
    const name = path.replaceAll("\\", "/").split("/").pop() ?? path;
    const artifact: FileArtifact = {
      fileId: `${codexItemId(item) ?? randomUUID()}:${name}`,
      name: path,
      mimeType: name.endsWith(".md") ? "text/markdown" : name.endsWith(".json") ? "application/json" : "text/plain",
      revision: 1
    };
    publish(record, { ...baseEvent(record, "file"), type: "file", file: artifact });
  }
}

function handleCodexNotification(record: RunRecord, notification: CodexNotification): void {
  if (record.cancelRequested || isTerminalStatus(record.snapshot.status)) return;
  const params = codexRecord(notification.params);
  if (!params) return;
  const method = notification.method;

  if (method.endsWith("/requestApproval") || method === "item/tool/requestUserInput" || method === "mcpServer/elicitation/request") {
    publishCodexStatus(record, "waiting_user", { currentStep: "Codex requested input; local alpha declined it" });
    return;
  }

  if (method === "item/agentMessage/delta") {
    const delta = safeCodexText(params.delta, 8_000);
    if (delta) {
      publishCodexStatus(record, "running", { progress: 55, currentStep: "Streaming answer" });
      // Protocol v0 consumers already aggregate the primary assistant stream
      // under the stable `answer` part id.
      publishTextDelta(record, "answer", "text", delta);
    }
    return;
  }
  if (method === "item/reasoning/summaryTextDelta" || method === "item/reasoning/textDelta") {
    const delta = safeCodexText(params.delta, 8_000);
    const itemId = codexString(params.itemId) ?? "reasoning";
    if (delta) publishTextDelta(record, `reasoning:${itemId}`, "reasoning", delta);
    publishCodexStatus(record, "running", { progress: 12, currentStep: "Reasoning" });
    return;
  }
  if (method === "item/commandExecution/outputDelta" || method === "item/mcpToolCall/progress") {
    const delta = safeCodexText(params.delta ?? params.output, 8_000);
    const itemId = codexString(params.itemId) ?? codexString(params.callId) ?? "tool";
    if (delta) publishTextDelta(record, `tool:${itemId}`, "text", delta);
    return;
  }
  if (method === "item/started" || method === "item/completed") {
    const item = codexRecord(params.item);
    if (!item) return;
    publishCodexItem(record, item, method === "item/started");
    if (method === "item/completed" && codexString(item.type) === "fileChange") publishCodexFileArtifacts(record, item);
    const itemType = codexString(item.type);
    if (method === "item/completed" && itemType === "agentMessage") {
      const text = safeCodexText(item.text, 32_000);
      if (text) publish(record, { ...baseEvent(record, "part"), type: "part", part: { partId: "answer", kind: "text", text, done: true } });
    }
    if (method === "item/completed" && itemType === "reasoning") {
      const text = safeCodexText(codexFlattenText(item.summary) || codexFlattenText(item.content), 32_000);
      const itemId = codexItemId(item);
      if (text && itemId) publish(record, { ...baseEvent(record, "part"), type: "part", part: { partId: `reasoning:${itemId}`, kind: "reasoning", text, done: true } });
    }
    return;
  }
  if (method === "turn/plan/updated") {
    const plan = Array.isArray(params.plan) ? params.plan : [];
    const completed = plan.filter((step) => codexString(codexRecord(step)?.status) === "completed").length;
    const progress = plan.length ? Math.min(90, Math.max(record.snapshot.progress, Math.round((completed / plan.length) * 80))) : record.snapshot.progress;
    const current = plan.find((step) => codexString(codexRecord(step)?.status) !== "completed");
    const currentStep = codexString(codexRecord(current)?.step) ?? codexString(codexRecord(current)?.text) ?? "Planning";
    publishCodexStatus(record, "running", { progress, currentStep });
    return;
  }
  if (method === "turn/diff/updated") {
    const diff = safeCodexText(params.diff, 32_000);
    if (diff) publish(record, { ...baseEvent(record, "part"), type: "part", part: { partId: `diff:${record.codexTurnId ?? "turn"}`, kind: "text", text: diff, done: false } });
    return;
  }
  if (method === "thread/tokenUsage/updated") {
    const usage = codexRecord(params.tokenUsage);
    const last = codexRecord(usage?.last) ?? codexRecord(usage?.total);
    if (last) {
      const inputTokens = codexNumber(last.inputTokens);
      const outputTokens = codexNumber(last.outputTokens);
      const providerRequestId = codexString(params.turnId);
      record.codexUsage = {};
      if (inputTokens !== undefined) record.codexUsage.inputTokens = inputTokens;
      if (outputTokens !== undefined) record.codexUsage.outputTokens = outputTokens;
      if (providerRequestId !== undefined) record.codexUsage.providerRequestId = providerRequestId;
    }
    return;
  }
  if (method === "thread/status/changed") {
    const status = codexRecord(params.status);
    if (codexString(status?.type) === "active") publishCodexStatus(record, "running", { progress: 5, currentStep: "Running Codex" });
    return;
  }
  if (method === "error") {
    const error = codexRecord(params.error);
    const message = safeCodexText(error?.message ?? params.message, 2_000) ?? "Codex reported an error";
    publish(record, { ...baseEvent(record, "error"), type: "error", code: "CODEX_ERROR", message, retryable: params.willRetry === true });
  }
}

function publishExecutorFailure(record: RunRecord, code: string, error: unknown): void {
  if (isTerminalStatus(record.snapshot.status)) return;
  const message = safeCodexText(error instanceof Error ? error.message : "executor failed", 2_000) ?? "executor failed";
  if (record.cancelRequested) {
    publishFinished(record, "cancelled");
    return;
  }
  publish(record, { ...baseEvent(record, "error"), type: "error", code, message, retryable: false });
  publishFinished(record, "failed", { code, message }, record.codexUsage);
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

async function executeCodexRun(record: RunRecord, client: CodexAppServerClient): Promise<void> {
  if (record.cancelRequested) {
    publishFinished(record, "cancelled");
    return;
  }
  publishStatus(record, "running", { progress: 4, currentStep: "Starting Codex" });
  const request: RunRequest = {
    prompt: record.snapshot.prompt,
    model: record.snapshot.model,
    mode: record.snapshot.mode,
    effort: record.snapshot.effort,
    ...(record.snapshot.routing === undefined ? {} : { routing: record.snapshot.routing }),
    ...(record.snapshot.workspaceId === undefined ? {} : { workspaceId: record.snapshot.workspaceId })
  };
  const result = await client.run(
    {
      prompt: request.prompt,
      cwd: codexCwd,
      ...(record.codexThreadId === undefined ? {} : { threadId: record.codexThreadId }),
      ...(request.model === undefined ? {} : { model: request.model }),
      effort: codexEffort(request),
      ...(request.routing === undefined ? {} : { routing: request.routing }),
      sandbox: codexSandbox,
      approvalPolicy: codexApprovalPolicy,
      // A root run creates one thread. Follow-up runs pass that thread id and
      // append another turn without creating or resuming a second thread.
      ephemeral: process.env.OPENRIGOR_CODEX_EPHEMERAL !== "false"
    },
    {
      onSession: (session) => {
        record.codexThreadId = session.threadId;
        record.codexTurnId = session.turnId;
        if (record.cancelRequested) {
          void client.interrupt(session.threadId, session.turnId).catch(() => undefined);
        }
      },
      onNotification: (notification) => handleCodexNotification(record, notification)
    }
  );

  if (record.cancelRequested || result.status === "interrupted") {
    publishFinished(record, "cancelled");
    return;
  }
  if (result.status === "failed") {
    const message = safeCodexText(result.error?.message ?? "Codex turn failed", 2_000) ?? "Codex turn failed";
    publish(record, { ...baseEvent(record, "error"), type: "error", code: "CODEX_TURN_FAILED", message, retryable: false });
    publishFinished(record, "failed", { code: "CODEX_TURN_FAILED", message }, record.codexUsage);
    return;
  }
  publishStatus(record, "running", { progress: 94, currentStep: "Finalizing" });
  publishFinished(record, "completed", undefined, record.codexUsage);
}

function conversationIdOf(record: RunRecord): string {
  return record.snapshot.conversationId ?? record.snapshot.rootRunId ?? record.snapshot.runId;
}

function rootRunIdOf(record: RunRecord): string {
  return record.snapshot.rootRunId ?? record.snapshot.runId;
}

function conversationRuns(record: RunRecord): RunRecord[] {
  return runsByConversationId.get(conversationIdOf(record)) ?? [record];
}

function runDetail(record: RunRecord): RunDetail {
  const conversationId = conversationIdOf(record);
  const rootRunId = rootRunIdOf(record);
  return {
    snapshot: record.snapshot,
    events: record.events,
    conversation: {
      conversationId,
      rootRunId,
      runs: conversationRuns(record).map((conversationRun) => ({
        snapshot: conversationRun.snapshot,
        events: conversationRun.events
      }))
    }
  };
}

function runRequestFingerprint(request: RunRequest): string {
  return JSON.stringify({
    prompt: request.prompt,
    model: request.model ?? "auto",
    mode: request.mode ?? "standard",
    effort: request.effort ?? "medium",
    routing: request.routing ?? null,
    workspaceId: request.workspaceId ?? null,
    attachments: (request.attachments ?? []).map((attachment) => ({
      fileId: attachment.fileId,
      name: attachment.name,
      mimeType: attachment.mimeType ?? null,
      sizeBytes: attachment.sizeBytes ?? null
    })),
    continueFromRunId: request.continueFromRunId ?? null
  });
}

function createRun(request: RunRequest): { record: RunRecord; replayed: boolean } {
  const result = getOrCreateIdempotent(request.clientRequestId, runRequestFingerprint(request), runsByClientRequestId, () => {
    const runId = `run_${randomUUID().replaceAll("-", "").slice(0, 20)}`;
    let conversationId = `conversation_${randomUUID().replaceAll("-", "").slice(0, 20)}`;
    let rootRunId = runId;
    let parentRunId: string | undefined;
    let codexThreadId: string | undefined;

    if (request.continueFromRunId) {
      const parent = runs.get(request.continueFromRunId);
      if (!parent) throw new HttpError(404, "continueFromRunId was not found");
      const chain = conversationRuns(parent);
      const latest = chain.at(-1);
      if (latest !== parent) throw new HttpError(409, "continueFromRunId must identify the latest run in the conversation");
      if (!isTerminalStatus(parent.snapshot.status)) throw new HttpError(409, "continueFromRunId must identify a terminal run");
      if (chain.some((candidate) => !isTerminalStatus(candidate.snapshot.status))) {
        throw new HttpError(409, "conversation already has an active run");
      }
      conversationId = conversationIdOf(parent);
      rootRunId = rootRunIdOf(parent);
      parentRunId = parent.snapshot.runId;
      codexThreadId = parent.codexThreadId;
      if (codexClient && !codexThreadId) throw new HttpError(409, "Codex thread is unavailable for continuation");
    }

    const initialSnapshot = createInitialSnapshot(runId, request);
    const record: RunRecord = {
      snapshot: {
        ...initialSnapshot,
        conversationId,
        rootRunId,
        ...(parentRunId === undefined ? {} : { parentRunId })
      },
      events: [],
      listeners: new Set(),
      cancelRequested: false,
      codexTools: new Map(),
      ...(codexThreadId === undefined ? {} : { codexThreadId })
    };
    runs.set(runId, record);
    const chain = runsByConversationId.get(conversationId) ?? [];
    chain.push(record);
    runsByConversationId.set(conversationId, chain);
    publish(record, { ...baseEvent(record, "snapshot"), type: "snapshot", snapshot: record.snapshot });
    const execution = codexClient ? executeCodexRun(record, codexClient) : executeDemoRun(record);
    void execution.catch((error: unknown) => publishExecutorFailure(record, codexClient ? "CODEX_EXECUTOR_ERROR" : "EXECUTOR_ERROR", error));
    return record;
  });
  return { record: result.value, replayed: result.replayed };
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
    sendJson(res, 200, { ok: true, service: "openrigor-api", executor });
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
    sendJson(res, 200, runDetail(record));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/runs") {
    try {
      const request = validateRunRequest(await readJson(req));
      const { record, replayed } = createRun(request);
      if (replayed) res.setHeader("Idempotency-Replayed", "true");
      sendJson(res, 202, {
        runId: record.snapshot.runId,
        status: record.snapshot.status,
        eventsUrl: `/api/runs/${record.snapshot.runId}/events`,
        conversationId: conversationIdOf(record),
        rootRunId: rootRunIdOf(record),
        ...(record.snapshot.parentRunId === undefined ? {} : { parentRunId: record.snapshot.parentRunId })
      });
    } catch (error: unknown) {
      const statusCode = error instanceof HttpError ? error.statusCode : error instanceof IdempotencyConflictError ? 409 : 400;
      sendJson(res, statusCode, { error: error instanceof Error ? error.message : "invalid request" });
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
      if (codexClient && record.codexThreadId && record.codexTurnId) {
        void codexClient.interrupt(record.codexThreadId, record.codexTurnId).catch((error: unknown) => {
          // A turn that already exited is still safely considered cancelled
          // because the user explicitly requested cancellation.
          if (!isTerminalStatus(record.snapshot.status)) {
            const message = safeCodexText(error instanceof Error ? error.message : "Codex interrupt failed", 2_000) ?? "Codex interrupt failed";
            publish(record, { ...baseEvent(record, "error"), type: "error", code: "CODEX_INTERRUPT_ERROR", message, retryable: false });
            publishFinished(record, "cancelled");
          }
        });
      }
    }
    sendJson(res, 202, { runId: record.snapshot.runId, status: record.snapshot.status });
    return;
  }

  sendJson(res, 404, { error: "not found" });
}

export const server = createServer((req, res) => {
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
  void codexClient?.close().finally(() => server.close(() => process.exit(0)));
  if (!codexClient) server.close(() => process.exit(0));
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
