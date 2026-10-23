import { conversationTitle, type WorkspaceConversation } from "./api";

export type TaskView = "tasks" | "pinned" | "archived";
export type TaskStatusFilter = "all" | "active" | "completed" | "attention";
export type TaskSort = "recent" | "oldest" | "title";
export const standaloneTaskScope = "__standalone__";

const activeStatuses = new Set(["queued", "running", "waiting_tool", "waiting_user", "cancelling"]);

export function taskStatusLabel(status: string): string {
  return ({ queued: "Queued", running: "Running", waiting_tool: "Using a tool", waiting_user: "Needs your input", cancelling: "Stopping", completed: "Completed", failed: "Failed", cancelled: "Cancelled" } as Record<string, string>)[status] ?? "Unknown status";
}

export function matchesTaskStatus(item: WorkspaceConversation, status: TaskStatusFilter): boolean {
  if (status === "all") return true;
  if (status === "active") return activeStatuses.has(item.status);
  if (status === "completed") return item.status === "completed";
  return item.status === "failed" || item.status === "waiting_user";
}

function matchesTaskScope(item: WorkspaceConversation, scope: string): boolean {
  return scope === standaloneTaskScope ? !item.projectId : !scope || item.projectId === scope;
}

/** Counts describe the same search and filters as the rows, including real archives. */
export function taskCollectionCounts(items: WorkspaceConversation[], options: { status: TaskStatusFilter; scope: string }): Record<TaskView, number> {
  const counts = { tasks: 0, pinned: 0, archived: 0 };
  for (const item of items) {
    if (!matchesTaskScope(item, options.scope) || !matchesTaskStatus(item, options.status)) continue;
    if (item.archived) counts.archived += 1;
    else { counts.tasks += 1; if (item.pinned) counts.pinned += 1; }
  }
  return counts;
}

export function taskSearchPath(query: string, projectId?: string): string {
  const params = new URLSearchParams({ archived: "true" });
  if (query.trim()) params.set("q", query.trim());
  if (projectId) params.set("projectId", projectId);
  return `/api/conversations?${params.toString()}`;
}

export function selectTasks(items: WorkspaceConversation[], options: { view: TaskView; status: TaskStatusFilter; scope: string; sort: TaskSort }): WorkspaceConversation[] {
  const filtered = items.filter((item) => {
    if (options.view === "archived" ? !item.archived : item.archived) return false;
    if (options.view === "pinned" && !item.pinned) return false;
    if (!matchesTaskScope(item, options.scope)) return false;
    return matchesTaskStatus(item, options.status);
  });
  const time = (value: string): number => { const parsed = Date.parse(value); return Number.isFinite(parsed) ? parsed : 0; };
  return filtered.sort((a, b) => {
    if (options.sort === "title") return conversationTitle(a).localeCompare(conversationTitle(b), undefined, { numeric: true }) || b.rootRunId.localeCompare(a.rootRunId);
    if (options.sort === "oldest") return time(a.updatedAt) - time(b.updatedAt) || a.rootRunId.localeCompare(b.rootRunId);
    return Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || time(b.updatedAt) - time(a.updatedAt) || b.rootRunId.localeCompare(a.rootRunId);
  });
}

/** Archive responses may contain metadata only; never discard the saved run identity. */
export function patchTaskList(items: WorkspaceConversation[], rootRunId: string, patch: Partial<WorkspaceConversation>): WorkspaceConversation[] {
  return items.map((item) => item.rootRunId === rootRunId ? { ...item, ...patch, rootRunId: item.rootRunId, conversationId: item.conversationId, latestRunId: item.latestRunId } : item);
}

export function taskPromptExcerpt(prompt: string, limit = 170): string {
  const task = prompt.split("\n\nTask:\n").at(-1) ?? prompt;
  const line = task.replace(/\s+/g, " ").trim();
  return line.length > limit ? `${line.slice(0, limit - 1)}…` : line;
}
