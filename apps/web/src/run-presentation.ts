import type { RunSnapshot, RunStatus } from "@openrigor/protocol";

const activelyWorkingStatuses = new Set<RunStatus>([
  "queued",
  "running",
  "waiting_tool",
  "cancelling"
]);

export const STALE_EVENT_AFTER_MS = 10_000;

export type RunActivityState = "working" | "queued" | "waiting-user" | "stopping" | "reconnecting" | "disconnected" | "completed" | "failed" | "cancelled";
export type RunActivityConnection = "idle" | "connecting" | "open" | "closed";
export interface RunActivityContext {
  connection: RunActivityConnection;
  stage?: "working" | "reasoning" | "tool" | "answer";
  detail?: string;
}

export interface RunActivityPresentation {
  state: RunActivityState;
  helper: string;
  animated: boolean;
  stale: boolean;
  headline: string;
  detail: string;
  elapsed: string;
  lastUpdate: string;
}

export function isActivelyWorkingStatus(status: RunStatus): boolean {
  return activelyWorkingStatuses.has(status);
}

/**
 * Decide when the execution rail should change itself. A status update within
 * one active run must preserve the user's open/closed choice; only a new run
 * or a terminal transition gets an automatic toggle.
 */
export function executionOpenTransition(
  previous: { runId: string; isRunning: boolean } | undefined,
  current: { runId: string; isRunning: boolean }
): boolean | undefined {
  if (!previous || previous.runId !== current.runId) return current.isRunning;
  if (previous.isRunning !== current.isRunning) return current.isRunning;
  return undefined;
}

export function formatElapsed(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;

  const hours = Math.floor(minutes / 60);
  return `${hours}h ${(minutes % 60).toString().padStart(2, "0")}m`;
}

export function formatToolDuration(milliseconds: number): string {
  const duration = Math.max(0, milliseconds);
  if (duration < 1000) return `${Math.round(duration)}ms`;
  if (duration < 10_000) return `${(duration / 1000).toFixed(1)}s`;
  if (duration < 60_000) return `${Math.round(duration / 1000)}s`;
  return formatElapsed(duration);
}

export function runElapsedMs(snapshot: Pick<RunSnapshot, "createdAt" | "updatedAt" | "status">, nowMs: number): number {
  const startedAt = Date.parse(snapshot.createdAt);
  if (!Number.isFinite(startedAt)) return 0;

  const terminal = snapshot.status === "completed" || snapshot.status === "failed" || snapshot.status === "cancelled";
  const endAt = terminal ? Date.parse(snapshot.updatedAt) : nowMs;
  return Math.max(0, (Number.isFinite(endAt) ? endAt : nowMs) - startedAt);
}

export function toolElapsedMs(firstAt: string, lastAt: string, running: boolean, nowMs: number): number {
  const startedAt = Date.parse(firstAt);
  if (!Number.isFinite(startedAt)) return 0;
  const recordedEnd = Date.parse(lastAt);
  const endAt = running ? nowMs : Number.isFinite(recordedEnd) ? recordedEnd : nowMs;
  return Math.max(0, endAt - startedAt);
}

export function formatLastUpdate(ageMs: number): string {
  const seconds = Math.max(0, Math.floor(ageMs / 1000));
  if (seconds < 2) return "Updated just now";
  if (seconds < 60) return `Updated ${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `Updated ${minutes}m ago`;
  return `Updated ${Math.floor(minutes / 60)}h ago`;
}

function readableStep(step: string | undefined, fallback: string): string {
  const value = step?.trim();
  if (!value) return fallback;
  const normalized = value.toLowerCase();
  if (normalized === "running codex" || normalized === "starting codex") return "Codex is working on the task";
  if (normalized.includes("command.execute") || normalized.includes("shell")) return "Running a command";
  if (normalized.includes("web.search") || normalized.includes("browser")) return "Searching the web";
  if (normalized.includes("file.read")) return "Reading files";
  if (normalized.includes("file.write") || normalized.includes("file.edit") || normalized.includes("file.change")) return "Editing files";
  return value;
}

/** Status comes from persisted events; elapsed silence is never a heartbeat or proof of a stall. */
export function presentRunActivity(
  snapshot: Pick<RunSnapshot, "status" | "createdAt" | "updatedAt" | "currentStep">,
  latestEventAt: string,
  nowMs: number,
  context?: RunActivityContext
): RunActivityPresentation {
  const connection = context?.connection ?? "open";
  const latestAt = Date.parse(latestEventAt);
  const ageMs = Math.max(0, nowMs - (Number.isFinite(latestAt) ? latestAt : nowMs));
  const terminal = snapshot.status === "completed" || snapshot.status === "failed" || snapshot.status === "cancelled";
  const fallback: Record<RunStatus, string> = {
    queued: "Queued",
    running: "Working",
    waiting_tool: "Using a tool",
    waiting_user: "Needs your input",
    cancelling: "Stopping",
    completed: "Completed",
    failed: "Failed",
    cancelled: "Stopped"
  };
  const stageHeadline = context?.stage === "reasoning" ? "Thinking"
    : context?.stage === "tool" ? "Using a tool"
    : context?.stage === "answer" ? "Writing the response"
    : fallback[snapshot.status];
  const detail = readableStep(context?.detail ?? snapshot.currentStep, fallback[snapshot.status]);
  const state: RunActivityState = terminal ? snapshot.status as "completed" | "failed" | "cancelled"
    : connection === "connecting" ? "reconnecting"
    : connection !== "open" ? "disconnected"
    : snapshot.status === "waiting_user" ? "waiting-user"
    : snapshot.status === "queued" ? "queued"
    : snapshot.status === "cancelling" ? "stopping" : "working";
  const stale = state === "working" && ageMs >= STALE_EVENT_AFTER_MS;
  let headline = snapshot.status === "running" || snapshot.status === "waiting_tool" ? stageHeadline : fallback[snapshot.status];
  let helper = state === "waiting-user" ? "The task continues after you respond."
    : state === "queued" ? "Waiting for the runtime to start. Progress appears here automatically."
    : state === "stopping" ? "Stop requested. Waiting for the runtime to confirm."
    : terminal ? "" : "New progress appears here automatically.";
  let visibleDetail = detail;
  if (state === "reconnecting") {
    headline = "Reconnecting";
    visibleDetail = `Last recorded: ${fallback[snapshot.status]}`;
    helper = "Restoring the live connection. The latest progress will sync when it returns.";
  } else if (state === "disconnected") {
    headline = "Live connection lost";
    visibleDetail = `Last recorded: ${fallback[snapshot.status]}`;
    helper = "Progress can't be confirmed right now. The task may still be running in the background.";
  } else if (stale) {
    headline = "Still working, waiting for output";
    helper = "No new output yet. Updates appear here automatically.";
  }
  return {
    state,
    animated: state === "reconnecting" || (connection === "open" && isActivelyWorkingStatus(snapshot.status)),
    stale,
    headline,
    detail: visibleDetail,
    helper,
    elapsed: formatElapsed(runElapsedMs(snapshot, nowMs)),
    lastUpdate: formatLastUpdate(ageMs)
  };
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * One line that summarizes the agent's work above the response. It reports
 * recorded steps only; a finished tool is never described as live.
 */
export function processSummary({ status, steps, issues, elapsed, liveHeadline, connection }: {
  status: RunStatus;
  steps: number;
  issues: number;
  elapsed: string;
  liveHeadline?: string;
  connection: RunActivityConnection;
}): { title: string; meta: string[] } {
  const meta = steps > 0 ? [plural(steps, "step")] : [];
  if (issues > 0) meta.push(plural(issues, "issue"));
  if (status === "completed") return { title: `Worked for ${elapsed}`, meta };
  if (status === "failed") return { title: `Failed after ${elapsed}`, meta };
  if (status === "cancelled") return { title: `Stopped after ${elapsed}`, meta };
  if (connection === "connecting") return { title: "Reconnecting", meta };
  if (connection !== "open") return { title: "Live connection lost", meta };
  if (status === "waiting_user") return { title: "Waiting for your input", meta };
  if (status === "cancelling") return { title: "Stopping", meta };
  if (status === "queued") return { title: "Queued", meta };
  return { title: liveHeadline ?? "Working", meta };
}
