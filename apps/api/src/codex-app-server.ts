import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface, type Interface } from "node:readline";
import type { RunRoutingStrategyId } from "@openrigor/protocol";

/** A JSON-RPC message emitted by the local Codex app-server. */
export interface CodexNotification {
  method: string;
  params?: unknown;
  [key: string]: unknown;
}

export interface CodexRunSession {
  threadId: string;
  turnId: string;
}

export interface CodexTurnResult {
  threadId: string;
  turnId: string;
  status: "completed" | "interrupted" | "failed";
  error?: { message: string; details?: string };
  turn?: unknown;
}

/** Values accepted by Codex app-server's `turn/start.effort` field. */
export type CodexReasoningEffort = "low" | "medium" | "high" | "xhigh" | "max" | "ultra";

/** Verified against this runtime's experimental app-server DynamicToolSpec. */
export interface CodexDynamicToolSpec {
  type: "function";
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  deferLoading?: boolean;
}

export interface CodexRunOptions {
  prompt: string;
  cwd: string;
  /** Existing live app-server thread to append this turn to. */
  threadId?: string;
  model?: string;
  effort?: CodexReasoningEffort;
  /**
   * Local routing hint. This is intentionally translated into prompt
   * guidance only; the app-server protocol does not expose a provider-side
   * scheduler/delegation API we can safely claim to control.
   */
  routing?: RunRoutingStrategyId;
  sandbox?: "read-only" | "workspace-write" | "danger-full-access";
  approvalPolicy?: "untrusted" | "on-request" | "never";
  ephemeral?: boolean;
  /** Declared only when creating a thread; Codex persists these for later resume. */
  dynamicTools?: CodexDynamicToolSpec[];
}

export interface CodexServerRequest { id: string | number; method: string; params?: unknown }

export interface CodexRunCallbacks {
  onSession?: (session: CodexRunSession) => void;
  onNotification?: (notification: CodexNotification) => void;
  onServerRequest?: (request: CodexServerRequest, respond: (result: unknown) => boolean) => void;
}

export interface CodexAppServerOptions {
  /** Command used to launch Codex. Defaults to OPENRIGOR_CODEX_BIN or `codex`. */
  command?: string;
  /** Arguments appended after `app-server --stdio`. */
  args?: string[];
  /** Default request timeout for control-plane JSON-RPC calls. */
  requestTimeoutMs?: number;
  /** Default maximum duration for a turn. */
  turnTimeoutMs?: number;
  /** Environment passed to the child process. */
  env?: NodeJS.ProcessEnv;
}

interface JsonRpcResponse {
  id?: string | number | null;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
  method?: string;
  params?: unknown;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

interface ActiveTurn {
  threadId: string;
  turnId?: string;
  complete: (result: CodexTurnResult) => void;
  notify?: (notification: CodexNotification) => void;
  request?: (request: CodexServerRequest, respond: (result: unknown) => boolean) => void;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_TURN_TIMEOUT_MS = 30 * 60_000;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function idKey(value: string | number | null | undefined): string {
  return String(value);
}

function timeoutValue(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && value !== undefined && value > 0 ? value : fallback;
}

/**
 * Future routing strategies belong in this explicit local policy boundary.
 * Today TokenResearch provides deterministic coordinator instructions and
 * relies on the local Codex collaboration tools for child-agent scheduling.
 * The explicit agent profile remains in the prompt so this boundary can be
 * replaced by a first-party scheduler when one is available.
 */
function routedPrompt(prompt: string, routing: RunRoutingStrategyId | undefined): string {
  if (routing !== "tokenresearch") return prompt;
  return `${prompt}\n\n[OpenRigor routing: tokenresearch]\nYou are the coordinator running on gpt-5.6-sol with Ultra orchestration. For independent work, proactively delegate bounded subtasks through the local collaboration tools using the luna-worker profile (gpt-5.6-luna, max reasoning effort), then synthesize and verify the child results. Treat this as local runtime guidance: do not claim that a provider-side scheduler or delegation API was invoked unless the runtime explicitly reports it.`;
}

function notificationTurnId(params: Record<string, unknown> | null): string | undefined {
  const directTurnId = stringValue(params?.turnId);
  if (directTurnId) return directTurnId;
  return stringValue(asRecord(params?.turn)?.id);
}

/**
 * Small JSONL JSON-RPC client for the local Codex app-server.
 *
 * The process is shared by all local runs. Threads remain separate, while
 * request ids and notification routing are handled here so the HTTP layer
 * only has to translate provider events into the OpenRigor protocol.
 */
export class CodexAppServerClient {
  private readonly options: CodexAppServerOptions;
  private child: ChildProcessWithoutNullStreams | null = null;
  private output: Interface | null = null;
  private startPromise: Promise<void> | null = null;
  private nextRequestId = 1;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly activeTurns = new Map<string, ActiveTurn>();
  private readonly loadedThreads = new Set<string>();
  private readonly pendingServerRequests = new Map<string, { threadId: string; method: string; respond: (result: unknown) => boolean }>();

  public constructor(options: CodexAppServerOptions = {}) {
    this.options = options;
  }

  public async run(options: CodexRunOptions, callbacks: CodexRunCallbacks = {}): Promise<CodexTurnResult> {
    if (options.model === "gpt-5.6-luna" && options.effort === "ultra") {
      throw new Error("gpt-5.6-luna does not support Codex Ultra; use max effort or select gpt-5.6-sol/gpt-5.6-terra");
    }
    await this.ensureStarted();

    let threadId = options.threadId;
    if (!threadId) {
      const threadParams: Record<string, unknown> = {
        cwd: options.cwd,
        sandbox: options.sandbox ?? "workspace-write",
        approvalPolicy: options.approvalPolicy ?? "never",
        ephemeral: options.ephemeral ?? false
      };
      if (options.model && options.model !== "auto") threadParams.model = options.model;
      if (options.dynamicTools?.length) threadParams.dynamicTools = options.dynamicTools;

      const threadResponse = await this.request("thread/start", threadParams);
      const thread = asRecord(asRecord(threadResponse)?.thread);
      threadId = stringValue(thread?.id);
      if (!threadId) throw new Error("Codex app-server returned no thread id");
      this.loadedThreads.add(threadId);
    } else if (!this.loadedThreads.has(threadId)) {
      // Threads persisted by a prior API/app-server process must be explicitly resumed.
      await this.request("thread/resume", { threadId, cwd: options.cwd, sandbox: options.sandbox ?? "workspace-write", approvalPolicy: options.approvalPolicy ?? "never" });
      this.loadedThreads.add(threadId);
    }
    if (this.activeTurns.has(threadId)) {
      throw new Error(`Codex thread already has an active turn: ${threadId}`);
    }

    let turnId: string | undefined;
    let resolveCompletion: ((result: CodexTurnResult) => void) | undefined;
    const completion = new Promise<CodexTurnResult>((resolve) => {
      resolveCompletion = resolve;
    });

    const active: ActiveTurn = {
      threadId,
      complete: (result) => resolveCompletion?.(result),
      ...(callbacks.onNotification === undefined ? {} : { notify: callbacks.onNotification }),
      ...(callbacks.onServerRequest === undefined ? {} : { request: callbacks.onServerRequest })
    };
    this.activeTurns.set(threadId, active);
    try {
      const input = [{ type: "text", text: routedPrompt(options.prompt, options.routing) }];
      const turnParams: Record<string, unknown> = { threadId, input };
      if (options.model && options.model !== "auto") turnParams.model = options.model;
      if (options.effort) turnParams.effort = options.effort;
      // A turn/start response is normally immediate, but use the turn
      // deadline rather than the short control-plane timeout. If the server
      // has already emitted turn/started before a transport error, the catch
      // path below can still interrupt the known turn.
      let turnResponse: unknown;
      try {
        turnResponse = await this.request("turn/start", turnParams, timeoutValue(this.options.turnTimeoutMs, DEFAULT_TURN_TIMEOUT_MS));
      } catch (error) {
        if (active.turnId) await this.interrupt(threadId, active.turnId).catch(() => undefined);
        throw error;
      }
      const turn = asRecord(asRecord(turnResponse)?.turn);
      turnId = stringValue(turn?.id);
      if (!turnId) throw new Error("Codex app-server returned no turn id");
      if (active.turnId && active.turnId !== turnId) {
        await this.interrupt(threadId, turnId).catch(() => undefined);
        throw new Error(`Codex turn id mismatch: ${active.turnId} != ${turnId}`);
      }
      active.turnId = turnId;
      callbacks.onSession?.({ threadId, turnId });

      try {
        return await this.withTimeout(
          completion,
          timeoutValue(this.options.turnTimeoutMs, DEFAULT_TURN_TIMEOUT_MS),
          "Codex turn timed out"
        );
      } catch (error) {
        // A timed-out turn must not keep running invisibly and consuming local
        // resources after the HTTP run has failed. Keep this turn registered
        // until the interrupt request has at least been acknowledged.
        await this.interrupt(threadId, turnId).catch(() => undefined);
        throw error;
      }
    } finally {
      this.declinePendingRequests(threadId);
      this.activeTurns.delete(threadId);
    }
  }

  public async listModels(): Promise<{ id: string; name: string; description: string }[]> {
    await this.ensureStarted();
    const result = asRecord(await this.request("model/list", {}));
    const data = Array.isArray(result?.data) ? result.data : [];
    return data.flatMap((item) => {
      const record = asRecord(item); const id = stringValue(record?.id) ?? stringValue(record?.model);
      return id ? [{ id, name: stringValue(record?.displayName) ?? id, description: stringValue(record?.description) ?? "" }] : [];
    });
  }

  public async interrupt(threadId: string, turnId: string): Promise<void> {
    if (!this.child || this.child.killed || this.child.exitCode !== null) return;
    this.declinePendingRequests(threadId);
    await this.request("turn/interrupt", { threadId, turnId });
  }

  /** Stop the child process. Used during API shutdown and tests. */
  public async close(): Promise<void> {
    const child = this.child;
    if (!child) return;
    this.handleProcessFailure(child, new Error("Codex app-server closed"));
    if (!child.killed && child.exitCode === null) await this.terminateChild(child);
  }

  private async ensureStarted(): Promise<void> {
    if (this.startPromise) return this.startPromise;
    if (this.child && !this.child.killed && this.child.exitCode === null) return;
    this.startPromise = this.startProcess().finally(() => {
      this.startPromise = null;
    });
    return this.startPromise;
  }

  private async startProcess(): Promise<void> {
    const command = this.options.command ?? process.env.OPENRIGOR_CODEX_BIN ?? "codex";
    const args = ["app-server", "--stdio", ...(this.options.args ?? [])];
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: { ...process.env, ...this.options.env },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      // npm installs the Windows launcher as codex.cmd. Shell resolution is
      // needed only on Windows; Unix launches the executable directly.
      ...(process.platform === "win32" ? { shell: true } : {})
    });
    this.child = child;
    this.output = createInterface({ input: child.stdout });
    this.output.on("line", (line) => this.handleLine(line));
    this.output.on("close", () => {
      if (this.child === child && child.exitCode === null && !child.killed) {
        this.handleProcessFailure(child, new Error("Codex app-server stdout closed"));
      }
    });
    child.stdin.on("error", (error) => this.handleProcessFailure(child, error));
    child.stdout.on("error", (error) => this.handleProcessFailure(child, error));
    // Drain diagnostics so the child cannot block on a full stderr pipe. Raw
    // diagnostics are intentionally not forwarded to RunEvent payloads.
    child.stderr.resume();
    child.on("error", (error) => this.handleProcessFailure(child, error));
    child.on("exit", (code, signal) => {
      const suffix = signal ? ` (${signal})` : code === null ? "" : ` (exit ${code})`;
      this.handleProcessFailure(child, new Error(`Codex app-server exited${suffix}`));
    });

    try {
      await this.request("initialize", {
        clientInfo: { name: "openrigor", title: "OpenRigor", version: "0.1.0" },
        capabilities: { experimentalApi: true }
      });
      this.notify("initialized", {});
    } catch (error) {
      await this.close();
      throw error;
    }
  }

  private notify(method: string, params: unknown): void {
    const child = this.child;
    if (!child || child.killed || child.exitCode !== null || !child.stdin.writable) {
      throw new Error("Codex app-server is not running");
    }
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  }

  private request(method: string, params: unknown, timeoutMs?: number): Promise<unknown> {
    const child = this.child;
    if (!child || child.killed || child.exitCode !== null || !child.stdin.writable) {
      return Promise.reject(new Error("Codex app-server is not running"));
    }
    const id = this.nextRequestId++;
    const key = idKey(id);
    const requestTimeout = timeoutValue(timeoutMs ?? this.options.requestTimeoutMs, DEFAULT_REQUEST_TIMEOUT_MS);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(key);
        reject(new Error(`Codex request timed out: ${method}`));
      }, requestTimeout);
      this.pending.set(key, { resolve, reject, timer });
      try {
        child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(key);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private handleLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    let message: JsonRpcResponse;
    try {
      message = JSON.parse(trimmed) as JsonRpcResponse;
    } catch {
      // App-server uses JSONL on stdout. Ignore an accidental diagnostic line
      // so one malformed frame cannot take down all active local runs.
      return;
    }

    if (message.id !== undefined && message.id !== null && (message.result !== undefined || message.error !== undefined)) {
      const pending = this.pending.get(idKey(message.id));
      if (!pending) return;
      this.pending.delete(idKey(message.id));
      clearTimeout(pending.timer);
      if (message.error) {
        const detail = stringValue(message.error.message) ?? "unknown Codex error";
        pending.reject(new Error(detail));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (!message.method) return;
    const notification: CodexNotification = {
      method: message.method,
      ...(message.params === undefined ? {} : { params: message.params })
    };
    const params = asRecord(message.params);
    const threadId = stringValue(params?.threadId);
    if (threadId) {
      const active = this.activeTurns.get(threadId);
      const eventTurnId = notificationTurnId(params);
      let matchesActiveTurn = Boolean(active);
      if (active && message.method === "turn/started" && eventTurnId) {
        if (active.turnId && active.turnId !== eventTurnId) matchesActiveTurn = false;
        else active.turnId = eventTurnId;
      } else if (active && eventTurnId) {
        // A live thread can have many sequential turns. Late or duplicate
        // notifications from the previous turn must never enter the new run.
        matchesActiveTurn = active.turnId === eventTurnId;
      }
      if (active && matchesActiveTurn) {
        try {
          active.notify?.(notification);
        } catch {
          // Consumer exceptions must not break the JSONL reader.
        }
      }
      if (message.method === "turn/completed" && active && matchesActiveTurn) {
        const turn = asRecord(params?.turn);
        const completedTurnId = stringValue(turn?.id);
        if (!completedTurnId || completedTurnId !== active.turnId) return;
        const status = turn?.status;
        const resultStatus: CodexTurnResult["status"] = status === "interrupted" ? "interrupted" : status === "failed" ? "failed" : "completed";
        const errorRecord = asRecord(turn?.error);
        const errorMessage = stringValue(errorRecord?.message);
        const errorDetails = stringValue(errorRecord?.additionalDetails);
        active.complete({
          threadId,
          turnId: completedTurnId,
          status: resultStatus,
          ...(errorMessage === undefined ? {} : { error: { message: errorMessage, ...(errorDetails === undefined ? {} : { details: errorDetails }) } }),
          ...(turn === null ? {} : { turn })
        });
      }
    }

    if (message.id !== undefined && message.id !== null) this.respondToServerRequest(message.id, message.method, message.params);
  }

  private respondToServerRequest(id: string | number, method: string, params?: unknown): void {
    const requestRecord = asRecord(params);
    const threadId = stringValue(requestRecord?.threadId);
    const active = threadId ? this.activeTurns.get(threadId) : undefined;
    const requestTurn = notificationTurnId(requestRecord);
    const supported = method === "item/commandExecution/requestApproval" || method === "item/fileChange/requestApproval" || method === "item/tool/requestUserInput" || method === "item/tool/call";
    if (supported && threadId && active?.request && (!requestTurn || active.turnId === requestTurn)) {
      const key = idKey(id);
      if (this.pendingServerRequests.has(key)) return;
      let resolved = false;
      const respond = (result: unknown): boolean => {
        if (resolved) return false;
        resolved = true; this.pendingServerRequests.delete(key); this.writeRaw({ jsonrpc: "2.0", id, result }); return true;
      };
      this.pendingServerRequests.set(key, { threadId, method, respond });
      try { active.request({ id, method, ...(params === undefined ? {} : { params }) }, respond); }
      catch { respond(method === "item/tool/call" ? { success: false, contentItems: [{ type: "inputText", text: "The local tool could not be completed." }] } : method === "item/tool/requestUserInput" ? { answers: {} } : { decision: "decline" }); }
      return;
    }
    let result: unknown;
    if (method === "item/commandExecution/requestApproval" || method === "item/fileChange/requestApproval") {
      result = { decision: "decline" };
    } else if (method === "item/tool/requestUserInput") {
      result = { answers: {} };
    } else if (method === "item/tool/call") {
      result = { success: false, contentItems: [{ type: "inputText", text: "This local tool is unavailable for the active turn." }] };
    } else if (method === "mcpServer/elicitation/request") {
      result = { action: "decline", content: null };
    } else if (method === "item/permissions/requestApproval") {
      result = { permissions: {}, scope: "turn", strictAutoReview: false };
    } else if (method === "execCommandApproval") {
      result = { decision: { denied: { rejection: "OpenRigor did not receive an interactive approval response" } } };
    } else if (method === "applyPatchApproval") {
      result = { decision: { denied: { rejection: "OpenRigor did not receive an interactive approval response" } } };
    } else {
      // Unknown server requests are rejected explicitly instead of leaving the
      // Codex turn blocked forever. This is intentionally conservative.
      this.writeRaw({ jsonrpc: "2.0", id, error: { code: -32601, message: "OpenRigor does not implement this app-server request" } });
      return;
    }
    this.writeRaw({ jsonrpc: "2.0", id, result });
  }

  private declinePendingRequests(threadId?: string): void {
    for (const request of this.pendingServerRequests.values()) {
      if (!threadId || request.threadId === threadId) request.respond(request.method === "item/tool/call" ? { success: false, contentItems: [{ type: "inputText", text: "The local tool was interrupted." }] } : request.method === "item/tool/requestUserInput" ? { answers: {} } : { decision: "decline" });
    }
  }

  private writeRaw(message: Record<string, unknown>): void {
    const child = this.child;
    if (!child || child.killed || child.exitCode !== null || !child.stdin.writable) return;
    try {
      child.stdin.write(`${JSON.stringify(message)}\n`);
    } catch {
      // Process exit is handled by the exit/error listeners.
    }
  }

  private handleProcessFailure(child: ChildProcessWithoutNullStreams, error: Error): void {
    if (this.child !== child) return;
    const message = error.message;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(message));
    }
    this.pending.clear();
    for (const active of this.activeTurns.values()) {
      active.complete({ threadId: active.threadId, turnId: active.turnId ?? "", status: "failed", error: { message } });
    }
    this.activeTurns.clear();
    this.pendingServerRequests.clear();
    this.loadedThreads.clear();
    this.child = null;
    const output = this.output;
    this.output = null;
    output?.close();
  }

  private async terminateChild(child: ChildProcessWithoutNullStreams): Promise<void> {
    if (process.platform !== "win32" || child.pid === undefined) {
      child.kill();
      return;
    }
    await new Promise<void>((resolve) => {
      const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true
      });
      const timer = setTimeout(() => {
        if (!child.killed && child.exitCode === null) child.kill();
        resolve();
      }, 5_000);
      const done = (): void => {
        clearTimeout(timer);
        resolve();
      };
      killer.once("error", done);
      killer.once("exit", done);
    });
  }

  private async withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    });
    try {
      return await Promise.race([promise, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

export function createCodexAppServerClientFromEnv(): CodexAppServerClient {
  const parsePositive = (name: string): number | undefined => {
    const value = Number.parseInt(process.env[name] ?? "", 10);
    return Number.isFinite(value) && value > 0 ? value : undefined;
  };
  const requestTimeoutMs = parsePositive("OPENRIGOR_CODEX_REQUEST_TIMEOUT_MS");
  const turnTimeoutMs = parsePositive("OPENRIGOR_CODEX_TURN_TIMEOUT_MS");
  const options: CodexAppServerOptions = {};
  if (process.env.OPENRIGOR_CODEX_BIN) options.command = process.env.OPENRIGOR_CODEX_BIN;
  if (requestTimeoutMs !== undefined) options.requestTimeoutMs = requestTimeoutMs;
  if (turnTimeoutMs !== undefined) options.turnTimeoutMs = turnTimeoutMs;
  return new CodexAppServerClient(options);
}
