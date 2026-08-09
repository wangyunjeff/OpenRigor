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

export type RunMode = "standard" | "cluster";
export type RunEffort = "fast" | "balanced" | "deep";

export interface AttachmentRef {
  fileId: string;
  name: string;
  mimeType?: string;
  sizeBytes?: number;
}

export interface RunRequest {
  prompt: string;
  model?: string;
  mode?: RunMode;
  effort?: RunEffort;
  workspaceId?: string;
  attachments?: AttachmentRef[];
  clientRequestId?: string;
}

export interface RunSnapshot {
  runId: string;
  status: RunStatus;
  prompt: string;
  model: string;
  mode: RunMode;
  effort: RunEffort;
  createdAt: string;
  updatedAt: string;
  progress: number;
  currentStep?: string;
  workspaceId?: string;
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
  if (candidate.mode === "standard" || candidate.mode === "cluster") request.mode = candidate.mode;
  if (candidate.effort === "fast" || candidate.effort === "balanced" || candidate.effort === "deep") request.effort = candidate.effort;
  if (typeof candidate.workspaceId === "string" && candidate.workspaceId.trim()) request.workspaceId = candidate.workspaceId.trim();
  if (typeof candidate.clientRequestId === "string" && candidate.clientRequestId.trim()) request.clientRequestId = candidate.clientRequestId.trim();

  if (Array.isArray(candidate.attachments)) {
    request.attachments = candidate.attachments.filter(isAttachmentRef);
  }
  return request;
}

function isAttachmentRef(value: unknown): value is AttachmentRef {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.fileId === "string" && typeof candidate.name === "string";
}

export function createInitialSnapshot(runId: string, request: RunRequest, now = new Date().toISOString()): RunSnapshot {
  const snapshot: RunSnapshot = {
    runId,
    status: "queued",
    prompt: request.prompt,
    model: request.model ?? "auto",
    mode: request.mode ?? "standard",
    effort: request.effort ?? "balanced",
    createdAt: now,
    updatedAt: now,
    progress: 0
  };
  if (request.workspaceId) snapshot.workspaceId = request.workspaceId;
  return snapshot;
}
