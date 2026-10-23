import type { RunSnapshot } from "@openrigor/protocol";
import { cleanHistoryPrompt } from "./conversation";

export interface RecentTask {
  rootRunId: string;
  conversationId: string;
  latestRunId: string;
  prompt: string;
  status: RunSnapshot["status"];
  updatedAt: string;
  title?: string;
  projectId?: string;
  pinned?: boolean;
}

const runStatuses: RunSnapshot["status"][] = ["queued", "running", "waiting_tool", "waiting_user", "cancelling", "completed", "failed", "cancelled"];
export const maxCachedRecentTasks = 64;

export function isRunStatus(value: unknown): value is RunSnapshot["status"] {
  return typeof value === "string" && runStatuses.some((status) => status === value);
}

/** Restore both legacy run shortcuts and conversation metadata from the local cache. */
export function parseRecentTasks(serialized: string | null): RecentTask[] {
  try {
    const value = JSON.parse(serialized ?? "[]") as unknown;
    if (!Array.isArray(value)) return [];
    return value.flatMap((item): RecentTask[] => {
      if (!item || typeof item !== "object") return [];
      const candidate = item as Record<string, unknown>;
      const legacyRunId = typeof candidate.runId === "string" ? candidate.runId : undefined;
      const rootRunId = typeof candidate.rootRunId === "string" ? candidate.rootRunId : legacyRunId;
      const latestRunId = typeof candidate.latestRunId === "string" ? candidate.latestRunId : legacyRunId;
      if (!rootRunId || !latestRunId || typeof candidate.prompt !== "string" || !isRunStatus(candidate.status) || typeof candidate.updatedAt !== "string") return [];
      return [{
        rootRunId,
        conversationId: typeof candidate.conversationId === "string" ? candidate.conversationId : rootRunId,
        latestRunId,
        prompt: cleanHistoryPrompt(candidate.prompt),
        status: candidate.status,
        updatedAt: candidate.updatedAt,
        ...(typeof candidate.title === "string" && candidate.title.trim() ? { title: candidate.title } : {}),
        ...(typeof candidate.projectId === "string" && candidate.projectId ? { projectId: candidate.projectId } : {}),
        ...(typeof candidate.pinned === "boolean" ? { pinned: candidate.pinned } : {})
      }];
    }).slice(0, maxCachedRecentTasks);
  } catch {
    return [];
  }
}

/** Keep all server navigation in memory; only the offline cache is bounded. */
export function rememberRecentTask(items: RecentTask[], task: RecentTask, authoritativeProjectId?: string | null): RecentTask[] {
  const existing = items.find((item) => item.rootRunId === task.rootRunId);
  const projectId = authoritativeProjectId === undefined ? task.projectId ?? existing?.projectId : authoritativeProjectId;
  const { projectId: _existingProjectId, ...existingMetadata } = existing ?? {};
  const { projectId: _taskProjectId, ...taskMetadata } = task;
  const next = { ...existingMetadata, ...taskMetadata, ...(projectId ? { projectId } : {}), prompt: cleanHistoryPrompt(existing?.prompt ?? task.prompt) };
  return [next, ...items.filter((item) => item.rootRunId !== task.rootRunId)];
}

export function serializeRecentTasks(items: RecentTask[]): string {
  return JSON.stringify(items.slice(0, maxCachedRecentTasks).map((item) => ({ ...item, prompt: item.prompt.slice(0, 32768), ...(item.title ? { title: item.title.slice(0, 512) } : {}) })));
}
