export const PROTOCOL_VERSION = 0;

export type RunStatus =
  | "queued"
  | "running"
  | "waiting_tool"
  | "waiting_user"
  | "cancelling"
  | "completed"
  | "failed"
  | "cancelled";

export const RUN_MODELS = ["auto", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"] as const;
export const RUN_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export const ULTRA_MODELS = ["gpt-5.6-sol", "gpt-5.6-terra"] as const;
/** Explicit server-side routing strategies. Add new ids only with a defined policy. */
export const RUN_ROUTING_STRATEGIES = ["tokenresearch"] as const;

export type RunModel = typeof RUN_MODELS[number];
export type UltraRunModel = typeof ULTRA_MODELS[number];
export type RunMode = "standard" | "ultra";
export type RunEffort = typeof RUN_EFFORTS[number];
export type RunRoutingStrategyId = typeof RUN_ROUTING_STRATEGIES[number];

type LegacyRunMode = "cluster";
type LegacyRunEffort = "fast" | "balanced" | "deep";

export interface AttachmentRef {
  fileId: string;
  name: string;
  mimeType?: string;
  sizeBytes?: number;
}

export interface RunRequest {
  prompt: string;
  /** Known first-party values are exposed through `RunModel`; custom Codex providers may still use their own model id. */
  model?: RunModel | (string & {});
  mode?: RunMode;
  effort?: RunEffort;
  /** Optional server-side routing policy. Omitted requests retain legacy behavior. */
  routing?: RunRoutingStrategyId;
  workspaceId?: string;
  attachments?: AttachmentRef[];
  clientRequestId?: string;
  /** Continue the conversation whose latest run has this id. */
  continueFromRunId?: string;
}

export interface RunSnapshot {
  runId: string;
  status: RunStatus;
  prompt: string;
  model: string;
  mode: RunMode;
  effort: RunEffort;
  /** The normalized routing policy used for this run, when selected. */
  routing?: RunRoutingStrategyId;
  createdAt: string;
  updatedAt: string;
  progress: number;
  currentStep?: string;
  workspaceId?: string;
  /** Stable id shared by every run in one conversation. */
  conversationId?: string;
  /** The first run in this conversation. */
  rootRunId?: string;
  /** The immediately preceding run when this is a follow-up. */
  parentRunId?: string;
  error?: { code: string; message: string };
}

export interface TextPart {
  partId: string;
  kind: "text" | "reasoning";
  text: string;
  done?: boolean;
}

export interface ToolCall {
  callId: string;
  name: string;
  phase: "requested" | "running" | "succeeded" | "failed";
  inputSummary?: string;
  outputSummary?: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface FileArtifact {
  fileId: string;
  name: string;
  mimeType: string;
  sizeBytes?: number;
  sha256?: string;
  revision: number;
  downloadUrl?: string;
}

export interface UsageSummary {
  inputTokens?: number;
  outputTokens?: number;
  estimatedCredits?: number;
  providerRequestId?: string;
}

export interface SubagentSummary {
  subagentRunId: string;
  label: string;
  status: RunStatus;
  parentRunId: string;
}

export interface EventBase<T extends string> {
  protocolVersion: typeof PROTOCOL_VERSION;
  type: T;
  eventId: string;
  runId: string;
  sequence: number;
  ts: string;
}

export type SnapshotEvent = EventBase<"snapshot"> & { snapshot: RunSnapshot };
export type StatusEvent = EventBase<"status"> & {
  status: RunStatus;
  message?: string;
  progress?: number;
  currentStep?: string;
};
export type PartEvent = EventBase<"part"> & { part: TextPart };
export type PartDeltaEvent = EventBase<"part-delta"> & {
  partId: string;
  kind: TextPart["kind"];
  delta: string;
};
export type ToolEvent = EventBase<"tool"> & { tool: ToolCall };
export type FileEvent = EventBase<"file"> & { file: FileArtifact };
export type SubagentEvent = EventBase<"subagent"> & { subagent: SubagentSummary };
export type FinishedEvent = EventBase<"run-finished"> & {
  status: Extract<RunStatus, "completed" | "failed" | "cancelled">;
  usage?: UsageSummary;
  error?: { code: string; message: string };
};
export type ErrorEvent = EventBase<"error"> & {
  code: string;
  message: string;
  retryable: boolean;
};

export type RunEvent =
  | SnapshotEvent
  | StatusEvent
  | PartEvent
  | PartDeltaEvent
  | ToolEvent
  | FileEvent
  | SubagentEvent
  | FinishedEvent
  | ErrorEvent;

export interface RunAccepted {
  runId: string;
  status: Extract<RunStatus, "queued" | "running">;
  eventsUrl: string;
  conversationId?: string;
  rootRunId?: string;
  parentRunId?: string;
}

export interface ConversationRun {
  snapshot: RunSnapshot;
  events: RunEvent[];
}

/** Additive conversation context returned by GET /api/runs/:runId. */
export interface RunConversation {
  conversationId: string;
  rootRunId: string;
  runs: ConversationRun[];
}

/** The legacy snapshot/events pair plus the full conversation when available. */
export interface RunDetail extends ConversationRun {
  conversation?: RunConversation;
}

export function isTerminalStatus(status: RunStatus): status is FinishedEvent["status"] {
  return status === "completed" || status === "failed" || status === "cancelled";
}

export function isTerminalEvent(event: RunEvent): event is FinishedEvent {
  return event.type === "run-finished";
}

export function validateRunRequest(value: unknown): RunRequest {
  if (!value || typeof value !== "object") {
    throw new Error("request body must be an object");
  }

  const candidate = value as Record<string, unknown>;
  const prompt = typeof candidate.prompt === "string" ? candidate.prompt.trim() : "";
  if (!prompt) {
    throw new Error("prompt is required");
  }
  if (prompt.length > 32_000) {
    throw new Error("prompt exceeds 32000 characters");
  }

  const request: RunRequest = { prompt };
  if (typeof candidate.model === "string" && candidate.model.trim()) request.model = candidate.model.trim();

  const mode = normalizeRunMode(candidate.mode);
  if (mode) request.mode = mode;

  const effort = normalizeRunEffort(candidate.effort);
  if (effort) request.effort = effort;

  // Older clients represented Ultra as an effort. Keep accepting that wire
  // value, but normalize it into a separate orchestration mode so consumers
  // never confuse multi-agent execution with a model reasoning-effort level.
  if (candidate.effort === "ultra") {
    request.mode = "ultra";
    request.effort = "max";
  }
  const routing = normalizeRunRouting(candidate.routing);
  if (routing) {
    request.routing = routing;
    // TokenResearch is a coordinator policy, not a provider capability. Keep
    // the coordinator deterministic and use Codex Ultra's orchestration path;
    // its prompt then guides Luna delegation without pretending to expose a
    // provider-side scheduler API.
    if (routing === "tokenresearch") {
      request.model = "gpt-5.6-sol";
      request.mode = "ultra";
      request.effort = "max";
    }
  }
  if (request.mode === "ultra") request.effort = "max";
  if (request.mode === "ultra" && !supportsUltraMode(request.model)) {
    if (request.model === "gpt-5.6-luna") {
      throw new Error("gpt-5.6-luna does not support ultra mode; choose standard mode or gpt-5.6-sol/gpt-5.6-terra");
    }
    throw new Error("ultra mode requires an explicit gpt-5.6-sol or gpt-5.6-terra model");
  }
  if (typeof candidate.workspaceId === "string" && candidate.workspaceId.trim()) request.workspaceId = candidate.workspaceId.trim();
  if (typeof candidate.clientRequestId === "string" && candidate.clientRequestId.trim()) {
    const clientRequestId = candidate.clientRequestId.trim();
    if (clientRequestId.length > 200) throw new Error("clientRequestId exceeds 200 characters");
    request.clientRequestId = clientRequestId;
  }
  if (typeof candidate.continueFromRunId === "string" && candidate.continueFromRunId.trim()) {
    const continueFromRunId = candidate.continueFromRunId.trim();
    if (continueFromRunId.length > 200) throw new Error("continueFromRunId exceeds 200 characters");
    request.continueFromRunId = continueFromRunId;
  }

  if (Array.isArray(candidate.attachments)) {
    request.attachments = candidate.attachments.filter(isAttachmentRef);
  }
  return request;
}

function normalizeRunRouting(value: unknown): RunRoutingStrategyId | undefined {
  if (value === undefined) return undefined;
  const id = typeof value === "string"
    ? value.trim()
    : value && typeof value === "object" && typeof (value as Record<string, unknown>).id === "string"
      ? ((value as Record<string, unknown>).id as string).trim()
      : "";
  if (id === "tokenresearch") return id;
  throw new Error("routing.id must be tokenresearch");
}

function isAttachmentRef(value: unknown): value is AttachmentRef {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.fileId === "string" && typeof candidate.name === "string";
}

function normalizeRunMode(value: unknown): RunMode | undefined {
  if (value === "standard" || value === "ultra") return value;
  // `cluster` was the protocol-v0 name for the planned multi-agent mode.
  if (value === ("cluster" satisfies LegacyRunMode)) return "ultra";
  return undefined;
}

function normalizeRunEffort(value: unknown): RunEffort | undefined {
  if (typeof value === "string" && RUN_EFFORTS.some((effort) => effort === value)) return value as RunEffort;
  if (value === ("fast" satisfies LegacyRunEffort)) return "low";
  if (value === ("balanced" satisfies LegacyRunEffort)) return "medium";
  if (value === ("deep" satisfies LegacyRunEffort)) return "max";
  return undefined;
}

export function supportsUltraMode(model: string | undefined): model is UltraRunModel {
  return model === "gpt-5.6-sol" || model === "gpt-5.6-terra";
}

export function createInitialSnapshot(runId: string, request: RunRequest, now = new Date().toISOString()): RunSnapshot {
  const mode = request.mode ?? "standard";
  const snapshot: RunSnapshot = {
    runId,
    status: "queued",
    prompt: request.prompt,
    model: request.model ?? "auto",
    mode,
    effort: mode === "ultra" ? "max" : request.effort ?? "medium",
    createdAt: now,
    updatedAt: now,
    progress: 0
  };
  if (request.routing) snapshot.routing = request.routing;
  if (request.workspaceId) snapshot.workspaceId = request.workspaceId;
  return snapshot;
}
