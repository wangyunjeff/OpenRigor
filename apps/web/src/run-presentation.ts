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
  if (seconds < 2) return "刚刚更新";
  if (seconds < 60) return `${seconds}s 前更新`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m 前更新`;
  return `${Math.floor(minutes / 60)}h 前更新`;
}

function readableStep(step: string | undefined, fallback: string): string {
  const value = step?.trim();
  if (!value) return fallback;
  const normalized = value.toLowerCase();
  if (normalized === "running codex") return "Codex 正在处理任务";
  if (normalized.includes("command.execute") || normalized.includes("shell")) return "正在执行命令";
  if (normalized.includes("web.search") || normalized.includes("browser")) return "正在检索资料";
  if (normalized.includes("file.read")) return "正在读取文件";
  if (normalized.includes("file.write") || normalized.includes("file.edit")) return "正在更新文件";
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
    queued: "任务排队中",
    running: "任务运行中",
    waiting_tool: "正在调用工具",
    waiting_user: "需要你的确认",
    cancelling: "正在停止任务",
    completed: "任务已经完成",
    failed: "任务执行失败",
    cancelled: "任务已经停止"
  };
  const stageHeadline = context?.stage === "reasoning" ? "正在思考"
    : context?.stage === "tool" ? "正在调用工具"
    : context?.stage === "answer" ? "正在生成回答"
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
  let helper = state === "waiting-user" ? "确认或回答后，任务才会继续。"
    : state === "queued" ? "等待运行时开始处理；开始后会自动显示进展。"
    : state === "stopping" ? "已请求停止，正在等待运行时确认。"
    : terminal ? "" : "有新进展时会自动显示。";
  let visibleDetail = detail;
  if (state === "reconnecting") {
    headline = "正在恢复实时连接";
    visibleDetail = `最后记录：${fallback[snapshot.status]}`;
    helper = "正在重新连接；恢复后会同步最新进度。";
  } else if (state === "disconnected") {
    headline = "实时连接已断开";
    visibleDetail = `最后记录：${fallback[snapshot.status]}`;
    helper = "暂时无法确认最新进度；任务可能仍在后台运行。";
  } else if (stale) {
    headline = "任务运行中，等待下一条输出";
    helper = "暂时没有新的输出；有更新时会自动显示。";
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

/** The execution rail describes actual records, rather than presenting finished tools as live. */
export function executionSummary({ status, current, total, runningTools, connection }: {
  status: RunStatus;
  current: boolean;
  total: number;
  runningTools: number;
  connection: RunActivityConnection;
}): string {
  const records = `${total} 条执行记录`;
  if (!current || status === "completed" || status === "failed" || status === "cancelled") return records;
  if (connection === "connecting") return `正在恢复连接 · ${records}`;
  if (connection !== "open") return `实时连接已断开 · ${records}`;
  if (status === "waiting_user") return `等待你的确认 · ${records}`;
  if (status === "cancelling") return `正在停止 · ${records}`;
  if (status === "queued") return `任务排队中 · ${records}`;
  if (runningTools > 0) return `正在执行 ${runningTools} 个工具 · ${records}`;
  return `${records} · 等待下一步输出`;
}
