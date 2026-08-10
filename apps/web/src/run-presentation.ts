import type { RunSnapshot, RunStatus } from "@openrigor/protocol";

const activelyWorkingStatuses = new Set<RunStatus>([
  "queued",
  "running",
  "waiting_tool",
  "cancelling"
]);

export const STALE_EVENT_AFTER_MS = 10_000;

export interface RunActivityPresentation {
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

export function presentRunActivity(
  snapshot: Pick<RunSnapshot, "status" | "createdAt" | "updatedAt" | "currentStep">,
  latestEventAt: string,
  nowMs: number
): RunActivityPresentation {
  const animated = isActivelyWorkingStatus(snapshot.status);
  const latestAt = Date.parse(latestEventAt);
  const ageMs = Math.max(0, nowMs - (Number.isFinite(latestAt) ? latestAt : nowMs));
  const canReportBackgroundWork = snapshot.status === "running" || snapshot.status === "waiting_tool";
  const stale = canReportBackgroundWork && ageMs >= STALE_EVENT_AFTER_MS;

  const fallback: Record<RunStatus, string> = {
    queued: "正在准备运行环境",
    running: "正在分析并执行任务",
    waiting_tool: "正在执行工具",
    waiting_user: "等待你的确认",
    cancelling: "正在安全停止任务",
    completed: "任务已经完成",
    failed: "任务执行失败",
    cancelled: "任务已经停止"
  };

  return {
    animated,
    stale,
    headline: stale ? "Codex 仍在处理" : fallback[snapshot.status],
    detail: readableStep(snapshot.currentStep, fallback[snapshot.status]),
    elapsed: formatElapsed(runElapsedMs(snapshot, nowMs)),
    lastUpdate: formatLastUpdate(ageMs)
  };
}
