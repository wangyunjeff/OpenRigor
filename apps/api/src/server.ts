import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { resolve, join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { LocalStore, type PersistedRun } from "./local-store.js";
import { ApiError, WorkspaceService } from "./workspace.js";
import { readPublicWebPage, WebReaderError } from "./web-reader.js";
import { RunArtifactDiscovery, canPreviewArtifact, isTextArtifact, readCapturedArtifact } from "./run-artifacts.js";
import { OPENRIGOR_PLAN_TOOL, extractCodexSources, parseCodexPlan, validatePlanToolArguments } from "./research-events.js";
import { URL, fileURLToPath } from "node:url";
import {
  PROTOCOL_VERSION,
  createInitialSnapshot,
  isTerminalStatus,
  supportsUltraMode,
  validateRunRequest,
  type AttachmentRef,
  type EventBase,
  type RunEvent,
  type RunDetail,
  type RunRequest,
  type RunSnapshot,
  type RunStatus,
  type ToolCall,
  type ToolOutcome
} from "@openrigor/protocol";
import {
  createCodexAppServerClientFromEnv,
  type CodexAppServerClient,
  type CodexNotification,
  type CodexServerRequest,
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
const codexCwd = resolve(process.env.OPENRIGOR_CODEX_CWD?.trim() || fileURLToPath(new URL("../../../", import.meta.url)));
const codexSandbox = parseCodexSandbox(process.env.OPENRIGOR_CODEX_SANDBOX);
const codexApprovalPolicy = parseCodexApprovalPolicy(process.env.OPENRIGOR_CODEX_APPROVAL_POLICY);
const dataDirectory = process.env.OPENRIGOR_DATA_DIR?.trim() || (process.env.NODE_TEST_CONTEXT ? mkdtempSync(join(tmpdir(), "openrigor-test-")) : join(codexCwd, ".openrigor"));
const localStore = new LocalStore(resolve(dataDirectory));
const releaseDataLock = localStore.acquireLock();
process.once("exit", releaseDataLock);
const workspace = new WorkspaceService(localStore, codexCwd, executor);

function parseCodexSandbox(value: string | undefined): "read-only" | "workspace-write" | "danger-full-access" {
  if (value === "read-only" || value === "danger-full-access" || value === "workspace-write") return value;
  return "workspace-write";
}

function parseCodexApprovalPolicy(value: string | undefined): "untrusted" | "on-request" | "never" {
  if (value === "untrusted" || value === "on-request" || value === "never") return value;
  // The local UI now handles explicit command/file approvals and questions.
  return "on-request";
}

type EventListener = (event: RunEvent) => void;
const eventStreams = new Set<ServerResponse>();
let shuttingDown = false;
interface PublicUserRequest {
  id: string;
  kind: "approval" | "question";
  title: string;
  description?: string;
  questions?: { id: string; header: string; question: string; options?: { label: string; description: string }[] }[];
}
interface PendingUserRequest { public: PublicUserRequest; resolved: boolean; respond: (result: unknown) => boolean }


interface RunRecord {
  snapshot: RunSnapshot;
  events: RunEvent[];
  listeners: Set<EventListener>;
  cancelRequested: boolean;
  codexThreadId?: string;
  codexTurnId?: string;
  clientRequestId?: string;
  fingerprint?: string;
  projectId?: string;
  skillIds?: string[];
  contextPrompt?: string;
  attachments?: AttachmentRef[];
  contextPaths?: string[];
  userRequests: Map<string, PendingUserRequest>;
  codexTools: Map<string, ToolCall>;
  codexUsage?: { inputTokens?: number; outputTokens?: number; providerRequestId?: string };
  artifactDiscovery?: RunArtifactDiscovery;
  sourceVersions?: Map<string, string>;
  lastPlan?: string;
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
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Expose-Headers", "Content-Disposition, Content-Length");
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
  // Persist before fan-out so an acknowledged browser event always survives restart.
  localStore.appendEvent(event);
  record.events.push(event);
  applyProjection(record, event);
  persistRun(record);
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
  for (const request of record.userRequests.values()) {
    if (!request.resolved) { request.resolved = true; request.respond(request.public.kind === "question" ? { answers: {} } : { decision: "decline" }); }
  }
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
  const record = runs.get(event.runId);
  const payload = event.type === "snapshot" && record ? { ...event, snapshot: publicSnapshot(record, event.snapshot) } : event;
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBodyBytes) throw new ApiError(413, "request body is too large");
    chunks.push(buffer);
  }
  if (size === 0) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new ApiError(400, "request body must be valid JSON"); }
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

export function codexMessagePartId(value: unknown): string {
  const itemId = codexString(value);
  return itemId === undefined ? "answer" : `answer:${itemId}`;
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
    .replace(/((?:api[_-]?key|authorization|access[_-]?token|refresh[_-]?token|password|passwd|secret|cookie|token)["\']?)\s*[:=]\s*(?:"[^"\n]*"|\'[^\'\n]*\'|(?:Bearer\s+)?[^\s,;]+)/gi, "$1=[REDACTED]");
  return redacted.length > maxLength ? `${redacted.slice(0, maxLength)}...` : redacted;
}

function publishCodexStatus(record: RunRecord, status: RunStatus, options: { progress?: number; currentStep?: string }): void {
  if ([...record.userRequests.values()].some((request) => !request.resolved) && status !== "cancelling") {
    status = "waiting_user";
    options = { ...options, currentStep: "Waiting for your response" };
  }
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
  const allowExitMarker = item.type === "commandExecution";
  const candidates = [item.aggregatedOutput, item.result, item.error, item.output];
  for (const candidate of candidates) {
    const raw = typeof candidate === "string" ? candidate : candidate && typeof candidate === "object" ? JSON.stringify(candidate) : undefined;
    const text = raw === undefined ? undefined : cleanCodexToolOutput(raw, allowExitMarker);
    if (text) return text;
  }
  return undefined;
}

function terminalExitMarker(value: string): string | undefined {
  const lines = value.split(/\r?\n/);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]?.trim();
    if (!line) continue;
    return line.match(/^__(?:RG|OPENRIGOR)_EXIT_CODE__\s*=\s*(-?\d+)$/i)?.[1];
  }
  return undefined;
}

function cleanCodexToolOutput(value: string, allowExitMarker = false): string | undefined {
  const safeValue = safeCodexText(value, 2_000);
  if (!safeValue) return undefined;
  if (!allowExitMarker) return safeValue.trim() || undefined;

  const lines = safeValue.split(/\r?\n/);
  let lastNonEmpty = lines.length - 1;
  while (lastNonEmpty >= 0 && !lines[lastNonEmpty]?.trim()) lastNonEmpty -= 1;
  if (lastNonEmpty >= 0 && terminalExitMarker(lines[lastNonEmpty] ?? "") !== undefined) lines.splice(lastNonEmpty, 1);
  const cleaned = lines.join("\n").trim();
  return cleaned || undefined;
}

function codexReportedExitCode(item: Record<string, unknown>, output: string | undefined): number | undefined {
  if (item.type !== "commandExecution") return codexNumber(item.exitCode);
  const rawCandidates = [output, item.aggregatedOutput, item.output, item.result]
    .map((candidate) => typeof candidate === "string" ? candidate : candidate && typeof candidate === "object" ? JSON.stringify(candidate) : undefined)
    .filter((candidate): candidate is string => candidate !== undefined);
  const marker = rawCandidates
    .map((candidate) => terminalExitMarker(candidate))
    .find((value) => value !== undefined);
  // Codex's shell wrapper reports the process status through this marker and
  // exits the wrapper itself with zero. Prefer the marker when present.
  if (marker !== undefined) return Number.parseInt(marker, 10);
  return codexNumber(item.exitCode);
}

interface CodexToolOutcome {
  outcome: ToolOutcome;
  exitCode?: number;
  durationMs?: number;
  diagnostic?: string;
}

function codexCommandActionTypes(item: Record<string, unknown>): string[] {
  if (!Array.isArray(item.commandActions)) return [];
  return item.commandActions
    .map((action) => codexString(codexRecord(action)?.type))
    .filter((type): type is string => type !== undefined);
}

function commandContainsSearch(command: string | undefined): boolean {
  if (!command) return false;
  // The command may be wrapped by PowerShell (`powershell -Command ...`), so
  // match a search executable after a shell separator as well as at the start.
  return /(?:^|[\s;&|])((?:rg|grep)(?:\.exe)?|select-string)(?:\s|$)/i.test(shellScriptBody(command));
}

function commandContainsList(command: string | undefined): boolean {
  if (!command) return false;
  const script = shellScriptBody(command);
  return /(?:^|[\s;&|])rg(?:\.exe)?\s+[^\r\n]*--files(?:\s|$)/i.test(script)
    || /(?:^|[\s;&|])(?:find|dir|ls|get-childitem)(?:\.exe)?(?:\s|$)/i.test(script);
}

function shellScriptBody(command: string): string {
  // Codex commonly reports `powershell -Command "..."` or `bash -c '...'`.
  // Scan the script argument itself so its outer transport quotes do not hide
  // real separators while quoted regexes such as "foo|bar" remain intact.
  const wrapped = command.match(/(?:^|\s)(?:-(?:command|c)|\/c)\s+(["'])([\s\S]*)\1\s*$/i);
  return wrapped?.[2] ?? command;
}

function isCompoundCommand(command: string | undefined): boolean {
  if (!command) return false;
  // A non-zero status belongs to the whole shell expression. Do not turn an
  // unrelated failing command into a search miss just because `rg` appears
  // later in a semicolon/pipeline chain.
  const script = shellScriptBody(command);
  let quote: "\"" | "'" | undefined;
  for (let index = 0; index < script.length; index += 1) {
    const character = script[index];
    const escaped = index > 0 && ["\\", "`", "^"].includes(script[index - 1] ?? "");
    if (quote) {
      if (character === quote && !escaped) quote = undefined;
      continue;
    }
    if (character === "\"" || character === "'") {
      quote = character;
      continue;
    }
    if (character === ";" || character === "|" || character === "&" || character === "\n" || character === "\r") return true;
  }
  return false;
}

const powerShellDiagnosticMarker = /^(?:at line:|所在位置(?:\s|$)|parsererror\s*:|\+\s*(?:categoryinfo|fullyqualifiederrorid)\s*:|(?:categoryinfo|fullyqualifiederrorid)\s*:)/i;

function hasPowerShellDiagnosticContext(lines: string[]): boolean {
  return lines.some((line) => powerShellDiagnosticMarker.test(line.trim()));
}

function isCommandDiagnosticLine(line: string, powerShellDiagnosticContext: boolean): boolean {
  const value = line.trim();
  if (!value) return true;
  if (/^__(?:RG|OPENRIGOR)_EXIT_CODE__\s*=\s*-?\d+$/i.test(value)) return true;
  if (powerShellDiagnosticMarker.test(value)) return true;
  if (/^warning\s*:/i.test(value)) return true;
  if (powerShellDiagnosticContext) {
    // PowerShell renders the failing command, source line, and caret marker as
    // ordinary text in the aggregated stream. Only interpret these shapes as
    // diagnostics when the record also contains its structured error footer.
    if (/^[+~]/.test(value)) return true;
    if (/^(?:[A-Za-z0-9_.-]+\\)?(?:[A-Za-z0-9_.]+-[A-Za-z0-9_.-]+|[A-Za-z0-9_.-]+\.exe)\s*:\s+/i.test(value)) return true;
  }
  if (/^(?:rg|grep|select-string|get-childitem|find|dir|ls|get-content|powershell)(?:\.exe)?\s*:/i.test(value)) return true;
  if (/^.*:\s*(?:system cannot find|the system cannot find|cannot find|not found|access is denied|拒绝访问|系统找不到|无法找到|未找到)/i.test(value)) return true;
  if (/\(\s*os error \d+\)\s*$/i.test(value)) return true;
  return false;
}

function hasUsableCommandOutput(output: string | undefined): boolean {
  if (!output?.trim()) return false;
  const lines = output.split(/\r?\n/);
  const powerShellDiagnosticContext = hasPowerShellDiagnosticContext(lines);
  return lines.some((line) => !isCommandDiagnosticLine(line, powerShellDiagnosticContext));
}

function codexErrorDiagnostic(item: Record<string, unknown>): string | undefined {
  const error = item.error;
  if (typeof error === "string") return safeCodexText(error, 400);
  const errorRecord = codexRecord(error);
  if (!errorRecord) return undefined;
  const message = codexString(errorRecord.message) ?? codexString(errorRecord.details) ?? codexString(errorRecord.code);
  return message === undefined ? undefined : safeCodexText(message, 400);
}

/**
 * Classify a completed Codex item without changing the legacy lifecycle phase.
 * The provider uses non-zero exit codes for both expected search misses and
 * genuine failures, so command actions are used to constrain the exceptions.
 */
export function classifyCodexToolOutcome(item: Record<string, unknown>, output?: string): CodexToolOutcome | undefined {
  const status = codexString(item.status);
  if (status === "inProgress") return undefined;

  const exitCode = codexReportedExitCode(item, output);
  const durationMs = codexNumber(item.durationMs);
  if (status === "declined") {
    return { outcome: "declined", ...(exitCode === undefined ? {} : { exitCode }), ...(durationMs === undefined ? {} : { durationMs }), diagnostic: "工具调用被拒绝" };
  }

  const command = codexString(item.command);
  const actionTypes = codexCommandActionTypes(item);
  const searchLike = actionTypes.includes("search") || commandContainsSearch(command);
  const listLike = actionTypes.includes("listFiles") || commandContainsList(command);
  const visibleOutput = output === undefined ? undefined : cleanCodexToolOutput(output, item.type === "commandExecution");
  const standaloneSearchOrList = (searchLike || listLike)
    && actionTypes.length <= 1
    && !isCompoundCommand(command);

  if (exitCode === 1 && standaloneSearchOrList && !visibleOutput) {
    return {
      outcome: "no-result",
      exitCode,
      ...(durationMs === undefined ? {} : { durationMs }),
      diagnostic: "未找到匹配结果（退出码 1）"
    };
  }
  if (exitCode !== undefined && exitCode !== 0 && (searchLike || listLike) && hasUsableCommandOutput(visibleOutput)) {
    return {
      outcome: "partial",
      exitCode,
      ...(durationMs === undefined ? {} : { durationMs }),
      diagnostic: `命令返回退出码 ${exitCode}，但产生了部分输出`
    };
  }

  if (status === "failed") {
    return {
      outcome: "error",
      ...(exitCode === undefined ? {} : { exitCode }),
      ...(durationMs === undefined ? {} : { durationMs }),
      diagnostic: codexErrorDiagnostic(item) ?? (exitCode === undefined ? "工具执行失败" : `命令返回退出码 ${exitCode}`)
    };
  }

  // Completed items normally have exitCode 0. Treat an inconsistent non-zero
  // code as an error rather than hiding a provider/runtime contract violation.
  if (exitCode !== undefined && exitCode !== 0) {
    return {
      outcome: "error",
      exitCode,
      ...(durationMs === undefined ? {} : { durationMs }),
      diagnostic: `命令报告已完成但退出码为 ${exitCode}`
    };
  }
  return {
    outcome: "success",
    ...(exitCode === undefined ? {} : { exitCode }),
    ...(durationMs === undefined ? {} : { durationMs })
  };
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
  const outcome = started ? undefined : classifyCodexToolOutcome(item, outputSummary);
  const tool: ToolCall = {
    callId: itemId,
    name: info.name,
    phase,
    ...(outputSummary === undefined ? {} : { outputSummary }),
    ...(outcome?.outcome === undefined ? {} : { outcome: outcome.outcome }),
    ...(outcome?.exitCode === undefined ? {} : { exitCode: outcome.exitCode }),
    ...(outcome?.durationMs === undefined ? {} : { durationMs: outcome.durationMs }),
    ...(outcome?.diagnostic === undefined ? {} : { diagnostic: outcome.diagnostic }),
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
  for (const change of changes.slice(0, 60)) {
    const changeRecord = codexRecord(change);
    const path = codexString(changeRecord?.path);
    if (!path) continue;
    const artifact = record.artifactDiscovery?.capture(path);
    if (artifact) publish(record, { ...baseEvent(record, "file"), type: "file", file: artifact });
  }
}

function discoverRunArtifacts(record: RunRecord): void {
  if (isCancelled(record)) return;
  for (const file of record.artifactDiscovery?.discover() ?? []) publish(record, { ...baseEvent(record, "file"), type: "file", file });
}

function publishCodexSources(record: RunRecord, item: Record<string, unknown>): void {
  record.sourceVersions ??= new Map();
  for (const source of extractCodexSources(item)) {
    const fingerprint = JSON.stringify(source);
    if (record.sourceVersions.get(source.sourceId) === fingerprint) continue;
    record.sourceVersions.set(source.sourceId, fingerprint);
    publish(record, { ...baseEvent(record, "source"), type: "source", source });
  }
}

function handleCodexNotification(record: RunRecord, notification: CodexNotification): void {
  if (record.cancelRequested || isTerminalStatus(record.snapshot.status)) return;
  const params = codexRecord(notification.params);
  if (!params) return;
  const method = notification.method;

  if (method.endsWith("/requestApproval") || method === "item/tool/requestUserInput" || method === "mcpServer/elicitation/request") {
    // The dedicated server-request callback owns interactive state; unsupported requests are declined by the client.
    return;
  }

  if (method === "item/agentMessage/delta") {
    const delta = safeCodexText(params.delta, 8_000);
    if (delta) {
      publishCodexStatus(record, "running", { progress: 55, currentStep: "Streaming answer" });
      // Keep provider message boundaries so commentary before a tool call and
      // the final response can be replayed at their original timeline slots.
      publishTextDelta(record, codexMessagePartId(params.itemId), "text", delta);
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
    if (itemType === "webSearch") publishCodexSources(record, item);
    if (method === "item/completed" && ["commandExecution", "fileChange"].includes(itemType ?? "")) discoverRunArtifacts(record);
    if (method === "item/completed" && itemType === "agentMessage") {
      const text = safeCodexText(item.text, 32_000);
      if (text) {
        publish(record, { ...baseEvent(record, "part"), type: "part", part: { partId: codexMessagePartId(codexItemId(item)), kind: "text", text, done: true } });
        for (const file of record.artifactDiscovery?.mentioned(text) ?? []) publish(record, { ...baseEvent(record, "file"), type: "file", file });
      }
    }
    if (method === "item/completed" && itemType === "reasoning") {
      const text = safeCodexText(codexFlattenText(item.summary) || codexFlattenText(item.content), 32_000);
      const itemId = codexItemId(item);
      if (text && itemId) publish(record, { ...baseEvent(record, "part"), type: "part", part: { partId: `reasoning:${itemId}`, kind: "reasoning", text, done: true } });
    }
    return;
  }
  if (method === "turn/plan/updated") {
    const plan = parseCodexPlan(params);
    if (!plan) return;
    const fingerprint = JSON.stringify(plan);
    if (record.lastPlan === fingerprint) return;
    record.lastPlan = fingerprint;
    publish(record, { ...baseEvent(record, "plan"), type: "plan", ...plan, provenance: "provider" });
    const completed = plan.steps.filter((step) => step.status === "completed").length;
    const progress = plan.steps.length ? Math.min(90, Math.max(record.snapshot.progress, Math.round((completed / plan.steps.length) * 80))) : record.snapshot.progress;
    const currentStep = plan.steps.find((step) => step.status === "in_progress")?.step ?? plan.steps.find((step) => step.status === "pending")?.step ?? "Planning";
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
  const runCwd = record.projectId ? workspace.project(record.projectId).path : codexCwd;
  record.artifactDiscovery = new RunArtifactDiscovery(runCwd, localStore.directory, record.snapshot.runId);
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
      prompt: `${request.prompt}\n\n[OpenRigor delivery guidance]\nFor nontrivial multi-step work, use openrigor_update_plan if available to publish a real plan and update actual step statuses as work proceeds; skip plans for simple requests. Save generated deliverables under the workspace's artifacts/ directory and link completed files using relative Markdown links in the final answer. Preserve original source URLs and distinguish retrieved evidence from unverified references or failed page requests. Return the useful answer directly; do not fabricate sources, files, progress, or an unnecessarily long report.${record.contextPrompt ? `\n\n[OpenRigor workspace context]\n${record.contextPrompt}` : ""}`,
      cwd: runCwd,
      dynamicTools: [OPENRIGOR_PLAN_TOOL],
      ...(record.codexThreadId === undefined ? {} : { threadId: record.codexThreadId }),
      ...(request.model === undefined ? {} : { model: request.model }),
      effort: codexEffort(request),
      ...(request.routing === undefined ? {} : { routing: request.routing }),
      sandbox: codexSandbox,
      approvalPolicy: codexApprovalPolicy,
      // A root run creates one thread. Follow-up runs pass that thread id and
      // append another turn without creating or resuming a second thread.
      ephemeral: process.env.OPENRIGOR_CODEX_EPHEMERAL === "true"
    },
    {
      onSession: (session) => {
        record.codexThreadId = session.threadId;
        record.codexTurnId = session.turnId;
        persistRun(record);
        if (record.cancelRequested) {
          void client.interrupt(session.threadId, session.turnId).catch(() => undefined);
        }
      },
      onNotification: (notification) => handleCodexNotification(record, notification),
      onServerRequest: (request, respond) => registerUserRequest(record, request, respond)
    }
  );

  if (record.cancelRequested || result.status === "interrupted") {
    publishFinished(record, "cancelled");
    return;
  }
  discoverRunArtifacts(record);
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

function publicSnapshot(record: RunRecord, snapshot = record.snapshot): RunSnapshot & { projectId: string | null; attachments: AttachmentRef[] } {
  return { ...snapshot, projectId: record.projectId ?? null, attachments: record.attachments ?? [] };
}

function publicEvents(record: RunRecord): RunEvent[] {
  return record.events.map((event) => event.type === "snapshot" ? { ...event, snapshot: publicSnapshot(record, event.snapshot) } : event);
}

function runDetail(record: RunRecord): RunDetail & { projectId: string | null; attachments: AttachmentRef[] } {
  const conversationId = conversationIdOf(record);
  const rootRunId = rootRunIdOf(record);
  return {
    projectId: record.projectId ?? null,
    attachments: record.attachments ?? [],
    snapshot: publicSnapshot(record),
    events: publicEvents(record),
    conversation: {
      conversationId,
      rootRunId,
      runs: conversationRuns(record).map((conversationRun) => ({
        snapshot: publicSnapshot(conversationRun),
        events: publicEvents(conversationRun)
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

function createRun(request: RunRequest, metadata: { projectId?: string; skillIds?: string[]; knowledgeIds?: string[]; contextPaths?: string[] } = {}): { record: RunRecord; replayed: boolean } {
  const fingerprint = runRequestFingerprint(request) + (metadata.projectId || metadata.skillIds?.length || metadata.knowledgeIds?.length || metadata.contextPaths?.length ? JSON.stringify(metadata) : "");
  const result = getOrCreateIdempotent(request.clientRequestId, fingerprint, runsByClientRequestId, () => {
    const runId = `run_${randomUUID().replaceAll("-", "").slice(0, 20)}`;
    let conversationId = `conversation_${randomUUID().replaceAll("-", "").slice(0, 20)}`;
    let rootRunId = runId;
    let parentRunId: string | undefined;
    let codexThreadId: string | undefined;
    let projectId = metadata.projectId;
    if (projectId) workspace.project(projectId);

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
      if (projectId && projectId !== parent.projectId) throw new HttpError(409, "a conversation cannot switch project directories");
      projectId = parent.projectId;
      if (codexClient && !codexThreadId) throw new HttpError(409, "Codex thread is unavailable for continuation");
    }

    const attachmentContext = workspace.attachments(request.attachments, projectId);
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
      userRequests: new Map(),
      ...(request.clientRequestId ? { clientRequestId: request.clientRequestId } : {}),
      fingerprint,
      ...(projectId ? { projectId } : {}),
      ...(metadata.skillIds ? { skillIds: metadata.skillIds } : {}),
      attachments: attachmentContext.refs,
      ...(metadata.contextPaths?.length ? { contextPaths: metadata.contextPaths } : {}),
      contextPrompt: [workspace.context(projectId, metadata.skillIds, metadata.knowledgeIds, metadata.contextPaths), attachmentContext.context].filter(Boolean).join("\n\n"),
      ...(codexThreadId === undefined ? {} : { codexThreadId })
    };
    record.snapshot = publicSnapshot(record);
    runs.set(runId, record);
    const chain = runsByConversationId.get(conversationId) ?? [];
    chain.push(record);
    runsByConversationId.set(conversationId, chain);
    persistRun(record);
    publish(record, { ...baseEvent(record, "snapshot"), type: "snapshot", snapshot: record.snapshot });
    const execution = codexClient ? executeCodexRun(record, codexClient) : executeDemoRun(record);
    void execution.catch((error: unknown) => publishExecutorFailure(record, codexClient ? "CODEX_EXECUTOR_ERROR" : "EXECUTOR_ERROR", error));
    return record;
  });
  return { record: result.value, replayed: result.replayed };
}

function registerUserRequest(record: RunRecord, request: CodexServerRequest, respond: (result: unknown) => boolean): void {
  const params = codexRecord(request.params);
  if (request.method === "item/tool/call") {
    const reply = (success: boolean, text: string): void => { respond({ success, contentItems: [{ type: "inputText", text }] }); };
    if (isCancelled(record)) { reply(false, "This run is no longer active."); return; }
    if (params?.tool !== "openrigor_update_plan" || (params.namespace !== undefined && params.namespace !== null)) { reply(false, "This local tool is not supported."); return; }
    try {
      const plan = validatePlanToolArguments(params.arguments);
      const fingerprint = JSON.stringify(plan);
      if (record.lastPlan !== fingerprint) {
        record.lastPlan = fingerprint;
        publish(record, { ...baseEvent(record, "plan"), type: "plan", ...plan, provenance: "tool" });
        const currentStep = plan.steps.find((step) => step.status === "in_progress")?.step ?? plan.steps.find((step) => step.status === "pending")?.step;
        if (currentStep) publishCodexStatus(record, "running", { currentStep });
      }
      reply(true, "The work plan has been recorded and displayed. Update it only to reflect actual work.");
    } catch (error) { reply(false, error instanceof Error ? error.message : "Invalid plan arguments."); }
    return;
  }
  if (isTerminalStatus(record.snapshot.status) || record.cancelRequested) { respond(request.method === "item/tool/requestUserInput" ? { answers: {} } : { decision: "decline" }); return; }
  const id = `request_${randomUUID().slice(0, 16)}`;
  const question = request.method === "item/tool/requestUserInput";
  const details: PublicUserRequest = { id, kind: question ? "question" : "approval", title: question ? "The agent needs your input" : request.method === "item/fileChange/requestApproval" ? "Approve file changes" : "Approve command execution" };
  const reason = safeCodexText(params?.reason, 2_000);
  const command = safeCodexText(typeof params?.command === "string" ? params.command : Array.isArray(params?.command) ? params.command.join(" ") : undefined, 8_000);
  const cwd = safeCodexText(params?.cwd, 1_000);
  const description = [reason, command ? `Command: ${command}` : undefined, cwd ? `Directory: ${cwd}` : undefined].filter(Boolean).join("\n");
  if (description) details.description = description;
  if (question) {
    const questions = Array.isArray(params?.questions) ? params.questions.slice(0, 8) : [];
    details.questions = questions.flatMap((value) => {
      const item = codexRecord(value); const questionId = codexString(item?.id); const prompt = safeCodexText(item?.question, 4_000);
      if (!questionId || !prompt) return [];
      const options = Array.isArray(item?.options) ? item.options.slice(0, 20).flatMap((option) => {
        const optionRecord = codexRecord(option); const label = safeCodexText(optionRecord?.label, 200);
        return label ? [{ label, description: safeCodexText(optionRecord?.description, 1_000) ?? "" }] : [];
      }) : [];
      return [{ id: questionId.slice(0, 100), header: safeCodexText(item?.header, 100) ?? "Your input", question: prompt, ...(options.length ? { options } : {}) }];
    });
    if (!details.questions.length) { respond({ answers: {} }); return; }
  }
  record.userRequests.set(id, { public: details, resolved: false, respond });
  publishStatus(record, "waiting_user", { currentStep: details.title });
}

function persistRun(record: RunRecord): void {
  const metadata: PersistedRun = { snapshot: record.snapshot, ...(record.clientRequestId ? { clientRequestId: record.clientRequestId } : {}), ...(record.fingerprint ? { fingerprint: record.fingerprint } : {}), ...(record.codexThreadId ? { codexThreadId: record.codexThreadId } : {}), ...(record.projectId ? { projectId: record.projectId } : {}), ...(record.skillIds ? { skillIds: record.skillIds } : {}), ...(record.contextPrompt ? { contextPrompt: record.contextPrompt } : {}), ...(record.attachments?.length ? { attachments: record.attachments } : {}), ...(record.contextPaths?.length ? { contextPaths: record.contextPaths } : {}) };
  localStore.writeRun(metadata);
}

function restorePersistedRuns(): void {
  for (const { metadata, events } of localStore.loadRuns()) {
    const record: RunRecord = { ...metadata, events: [], listeners: new Set(), cancelRequested: false, codexTools: new Map(), userRequests: new Map() };
    for (const event of events) { record.events.push(event); applyProjection(record, event); if (event.type === "tool") record.codexTools.set(event.tool.callId, event.tool); }
    record.snapshot = publicSnapshot(record);
    runs.set(record.snapshot.runId, record);
    const conversationId = conversationIdOf(record);
    const chain = runsByConversationId.get(conversationId) ?? []; chain.push(record); runsByConversationId.set(conversationId, chain);
    if (metadata.clientRequestId && metadata.fingerprint) runsByClientRequestId.set(metadata.clientRequestId, { fingerprint: metadata.fingerprint, value: record });
    if (!isTerminalStatus(record.snapshot.status)) {
      const message = "The local runtime restarted before this turn finished. Its saved output is available; send a follow-up to continue.";
      publishFinished(record, "failed", { code: "RUNTIME_RESTARTED", message });
    }
  }
}
function conversationList(url: URL): { rootRunId: string; conversationId: string; latestRunId: string; prompt: string; title: string; status: RunStatus; updatedAt: string; projectId?: string; pinned: boolean; archived: boolean }[] {
  const query = (url.searchParams.get("q") ?? "").toLowerCase();
  const projectId = url.searchParams.get("projectId");
  const includeArchived = url.searchParams.get("archived") === "true";
  return [...runsByConversationId.values()].flatMap((chain) => {
    const first = chain[0]; const latest = chain.at(-1);
    if (!first || !latest) return [];
    const rootRunId = rootRunIdOf(first);
    const metadata = workspace.state.conversations[rootRunId] ?? {};
    const item = { rootRunId, conversationId: conversationIdOf(first), latestRunId: latest.snapshot.runId, prompt: first.snapshot.prompt, title: metadata.title || first.snapshot.prompt.slice(0, 120), status: latest.snapshot.status, updatedAt: latest.snapshot.updatedAt, ...(first.projectId ? { projectId: first.projectId } : {}), pinned: metadata.pinned ?? false, archived: metadata.archived ?? false };
    if ((!includeArchived && item.archived) || (projectId && item.projectId !== projectId)) return [];
    if (query && !`${item.title} ${chain.map((run) => run.snapshot.prompt + " " + run.events.flatMap((event) => event.type === "part" ? [event.part.text] : []).join(" ")).join(" ")}`.toLowerCase().includes(query)) return [];
    return [item];
  }).sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt));
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
  eventStreams.add(res);
  res.write(": openrigor\n\n");
  for (const event of record.events) {
    if (event.sequence > (Number.isFinite(lastSequence) ? lastSequence : 0)) sendEvent(res, event);
  }

  const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), 15_000);
  const cleanup = (): void => {
    clearInterval(heartbeat);
    record.listeners.delete(listener);
    eventStreams.delete(res);
  };
  req.on("close", cleanup);
  res.on("close", cleanup);
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (shuttingDown) {
    sendJson(res, 503, { error: "API is restarting; retry after reconnecting" });
    return;
  }
  setCors(req, res);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "no-store");
  const host = (req.headers.host ?? "").split(":")[0]?.toLowerCase();
  if (host && host !== "localhost" && host !== "127.0.0.1" && host !== "[::1]") {
    sendJson(res, 403, { error: "local API requires a loopback Host header" }); return;
  }
  const origin = req.headers.origin;
  if (origin && !allowedOrigins.has(origin)) {
    sendJson(res, 403, { error: "origin is not allowed" }); return;
  }
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
  if (req.method === "GET" && url.pathname === "/api/web/read") {
    try {
      sendJson(res, 200, await readPublicWebPage(url.searchParams.get("url") ?? ""));
    } catch (error: unknown) {
      if (!(error instanceof WebReaderError)) throw error;
      sendJson(res, error.statusCode, { error: error.message, code: error.code });
    }
    return;
  }

  const listConversations = (): ReturnType<typeof conversationList> => conversationList(url);
  if ((url.pathname === "/api/conversations" || url.pathname === "/api/runs") && req.method === "GET") {
    const conversations = listConversations(); sendJson(res, 200, { conversations, runs: conversations }); return;
  }
  const conversationMatch = url.pathname.match(/^\/api\/conversations\/([^/]+)$/);
  if (conversationMatch?.[1] && req.method === "PATCH") {
    const rootId = conversationMatch[1];
    if (!runs.has(rootId)) throw new ApiError(404, "conversation not found");
    const input = await readJson(req) as Record<string, unknown>;
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new ApiError(400, "request body must be an object");
    const metadata = workspace.state.conversations[rootId] ?? {};
    if (input.title !== undefined) {
      if (typeof input.title !== "string" || !input.title.trim() || input.title.length > 200) throw new ApiError(400, "invalid title");
      metadata.title = input.title.trim();
    }
    for (const field of ["pinned", "archived"] as const) if (input[field] !== undefined) {
      if (typeof input[field] !== "boolean") throw new ApiError(400, `${field} must be a boolean`);
      metadata[field] = input[field];
    }
    workspace.state.conversations[rootId] = metadata; workspace.save();
    sendJson(res, 200, { conversation: conversationList(new URL("http://localhost/")).find((item) => item.rootRunId === rootId) ?? { rootRunId: rootId, ...metadata } }); return;
  }
  if (url.pathname === "/api/usage" && req.method === "GET") {
    const entries = [...runs.values()].flatMap((record) => record.events.flatMap((event) => event.type === "run-finished" ? [{ runId: record.snapshot.runId, model: record.snapshot.model, status: event.status, createdAt: event.ts, inputTokens: event.usage?.inputTokens ?? 0, outputTokens: event.usage?.outputTokens ?? 0, providerRequestId: event.usage?.providerRequestId }] : []));
    sendJson(res, 200, { usage: { runs: runs.size, completedRuns: entries.filter((entry) => entry.status === "completed").length, inputTokens: entries.reduce((sum, entry) => sum + entry.inputTokens, 0), outputTokens: entries.reduce((sum, entry) => sum + entry.outputTokens, 0), images: workspace.state.images.length, entries, billing: "local", credits: null } }); return;
  }
  if (url.pathname === "/api/runtime" && req.method === "GET") {
    sendJson(res, 200, { runtime: { executor, localOnly: true, persistence: "local-disk", cwd: codexCwd, sandbox: codexSandbox, imageGenerationConfigured: workspace.imageConfigured() } }); return;
  }
  if (url.pathname === "/api/models" && req.method === "GET") {
    const models = codexClient ? await codexClient.listModels().catch(() => []) : [];
    sendJson(res, 200, { models: [{ id: "auto", name: "Auto", description: "Use your local Codex default model" }, ...models] }); return;
  }
  const artifactMatch = url.pathname.match(/^\/api\/runs\/(run_[a-zA-Z0-9]+)\/files\/(artifact_[a-f0-9]{24})(?:\/(content|preview))?$/);
  if (req.method === "GET" && artifactMatch?.[1] && artifactMatch[2]) {
    const record = runs.get(artifactMatch[1]);
    if (!record) throw new ApiError(404, "run not found");
    const revisionInput = url.searchParams.get("revision");
    if (revisionInput !== null && !/^[1-9]\d{0,5}$/.test(revisionInput)) throw new ApiError(400, "invalid artifact revision");
    const file = [...record.events].reverse().find((event) => event.type === "file" && event.file.fileId === artifactMatch[2] && (revisionInput === null || event.file.revision === Number(revisionInput)));
    if (file?.type !== "file") throw new ApiError(404, "artifact not found");
    const bytes = readCapturedArtifact(localStore.directory, record.snapshot.runId, file.file);
    const action = artifactMatch[3];
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "sandbox; default-src 'none'; base-uri 'none'; form-action 'none'");
    if (action === "content") {
      if (!file.file.contentUrl || !isTextArtifact(bytes)) throw new ApiError(415, "artifact is not available as text");
      sendJson(res, 200, { name: file.file.name, path: file.file.path, mimeType: file.file.mimeType, sizeBytes: bytes.length, content: bytes.subarray(0, 256 * 1024).toString("utf8"), truncated: bytes.length > 256 * 1024 }); return;
    }
    if (action === "preview" && (!file.file.previewUrl || !canPreviewArtifact(file.file.mimeType))) throw new ApiError(415, "this artifact has no inline preview");
    res.setHeader("Content-Type", action === "preview" ? file.file.mimeType : "application/octet-stream");
    res.setHeader("Content-Disposition", `${action === "preview" ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.file.name)}`);
    res.setHeader("Content-Length", bytes.length);
    res.end(bytes); return;
  }
  if (await workspace.handle(req, res, url, () => conversationList(new URL("http://localhost/")))) return;

  const requestListMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/requests$/);
  if (req.method === "GET" && requestListMatch?.[1]) {
    const record = runs.get(requestListMatch[1]);
    if (!record) throw new ApiError(404, "run not found");
    sendJson(res, 200, { requests: [...record.userRequests.values()].filter((request) => !request.resolved).map((request) => request.public) }); return;
  }
  const requestResponseMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/requests\/([^/]+)$/);
  if (req.method === "POST" && requestResponseMatch?.[1] && requestResponseMatch[2]) {
    const record = runs.get(requestResponseMatch[1]);
    if (!record) throw new ApiError(404, "run not found");
    const request = record.userRequests.get(requestResponseMatch[2]);
    if (!request) throw new ApiError(404, "request not found");
    if (request.resolved || isTerminalStatus(record.snapshot.status) || record.cancelRequested) throw new ApiError(409, "request is already resolved");
    const input = await readJson(req) as Record<string, unknown>;
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new ApiError(400, "invalid response");
    let response: unknown;
    if (request.public.kind === "approval") {
      if (input.decision !== "accept" && input.decision !== "decline") throw new ApiError(400, "decision must be accept or decline");
      response = { decision: input.decision };
    } else {
      const values = codexRecord(input.answers);
      if (!values) throw new ApiError(400, "answers must be an object");
      const answers: Record<string, { answers: string[] }> = {};
      for (const question of request.public.questions ?? []) {
        const value = values[question.id];
        if (value === undefined) continue;
        const items = typeof value === "string" ? [value] : Array.isArray(value) ? value : null;
        if (!items || items.length > 20 || items.some((answer) => typeof answer !== "string" || answer.length > 8_000)) throw new ApiError(400, "invalid question answer");
        answers[question.id] = { answers: items as string[] };
      }
      response = { answers };
    }
    request.resolved = true;
    const accepted = request.respond(response);
    if (!accepted) throw new ApiError(409, "request is no longer pending");
    if (![...record.userRequests.values()].some((candidate) => !candidate.resolved)) publishStatus(record, "running", { currentStep: "Continuing after your response" });
    sendJson(res, 200, { resolved: true, id: request.public.id }); return;
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
      const input = await readJson(req);
      const request = validateRunRequest(input);
      const extra = input as Record<string, unknown>;
      const projectId = extra.projectId === undefined || extra.projectId === null || extra.projectId === "" ? undefined : extra.projectId;
      if (projectId !== undefined && (typeof projectId !== "string" || projectId.length > 100)) throw new HttpError(400, "invalid projectId");
      const stringIds = (value: unknown, field: string): string[] | undefined => {
        if (value === undefined) return undefined;
        if (!Array.isArray(value) || value.length > 30 || value.some((item) => typeof item !== "string" || item.length > 100)) throw new HttpError(400, `invalid ${field}`);
        return [...new Set(value as string[])].sort();
      };
      const skillIds = stringIds(extra.skillIds, "skillIds");
      const knowledgeIds = stringIds(extra.knowledgeIds, "knowledgeIds");
      let contextPaths: string[] | undefined;
      if (extra.contextPaths !== undefined) {
        if (!Array.isArray(extra.contextPaths) || extra.contextPaths.length > 10 || extra.contextPaths.some((path) => typeof path !== "string" || !path.trim() || path.length > 1000)) throw new HttpError(400, "invalid contextPaths");
        contextPaths = [...new Set((extra.contextPaths as string[]).map((path) => path.trim()))].sort();
      }
      const { record, replayed } = createRun(request, { ...(projectId ? { projectId: projectId as string } : {}), ...(skillIds ? { skillIds } : {}), ...(knowledgeIds ? { knowledgeIds } : {}), ...(contextPaths ? { contextPaths } : {}) });
      if (replayed) res.setHeader("Idempotency-Replayed", "true");
      sendJson(res, 202, {
        runId: record.snapshot.runId,
        status: record.snapshot.status,
        eventsUrl: `/api/runs/${record.snapshot.runId}/events`,
        conversationId: conversationIdOf(record),
        rootRunId: rootRunIdOf(record),
        projectId: record.projectId ?? null,
        ...(record.snapshot.parentRunId === undefined ? {} : { parentRunId: record.snapshot.parentRunId })
      });
    } catch (error: unknown) {
      const statusCode = error instanceof HttpError || error instanceof ApiError ? error.statusCode : error instanceof IdempotencyConflictError ? 409 : 400;
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
      for (const request of record.userRequests.values()) if (!request.resolved) { request.resolved = true; request.respond(request.public.kind === "question" ? { answers: {} } : { decision: "decline" }); }
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

restorePersistedRuns();

export const server = createServer((req, res) => {
  void handle(req, res).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "internal server error";
    if (!res.headersSent) sendJson(res, error instanceof ApiError || error instanceof HttpError ? error.statusCode : 500, { error: safeCodexText(message, 2000) ?? "internal server error" });
    else res.end();
  });
});

server.once("close", releaseDataLock);

server.listen(port, "127.0.0.1", () => {
  console.log(`OpenRigor API listening on http://127.0.0.1:${(server.address() as { port: number }).port}`);
});

function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`received ${signal}; closing API`);
  // SSE is intentionally long-lived, so server.close() cannot drain it on
  // its own. End streams before waiting for HTTP shutdown; otherwise a dev
  // watcher can orphan the old API while it still owns the durable-store lock.
  for (const stream of eventStreams) stream.end();
  const deadline = setTimeout(() => { server.closeAllConnections(); process.exit(0); }, 3_000);
  deadline.unref();
  const finish = (): void => {
    server.close(() => { clearTimeout(deadline); process.exit(0); });
  };
  if (codexClient) void codexClient.close().catch(() => undefined).finally(finish);
  else finish();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
