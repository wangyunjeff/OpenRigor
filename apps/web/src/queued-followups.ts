import type { AttachmentRef } from "@openrigor/protocol";

export interface QueuedAttachment { id: string; fileId?: string; name: string; path: string; mimeType: string; size: number; sizeBytes?: number }
export interface QueuedFollowup {
  id: string;
  rootRunId: string;
  predecessorRunId: string;
  projectId?: string;
  prompt: string;
  attachments: QueuedAttachment[];
  error?: string;
}
export const queuedFollowupsStorageKey = "openrigor.queued-followups";
export const maxQueuedFollowups = 32;

export function attachmentReferences(attachments: QueuedAttachment[]): AttachmentRef[] {
  return attachments.map((file) => ({ fileId: file.fileId ?? file.id, name: file.name, mimeType: file.mimeType, sizeBytes: file.sizeBytes ?? file.size }));
}

export function appendQueuedFollowup(items: QueuedFollowup[], item: QueuedFollowup): { accepted: boolean; items: QueuedFollowup[] } {
  if (items.length >= maxQueuedFollowups || items.some((existing) => existing.id === item.id)) return { accepted: false, items };
  return { accepted: true, items: [...items, item] };
}

export function normalizeQueuedFollowups(value: unknown): QueuedFollowup[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((entry): QueuedFollowup[] => {
    if (!entry || typeof entry !== "object") return [];
    const item = entry as Record<string, unknown>;
    if (typeof item.id !== "string" || !item.id || seen.has(item.id) || typeof item.rootRunId !== "string" || !item.rootRunId || typeof item.predecessorRunId !== "string" || !item.predecessorRunId || typeof item.prompt !== "string" || !item.prompt.trim() || item.prompt.length > 32768) return [];
    const attachments = Array.isArray(item.attachments) ? item.attachments.flatMap((entry): QueuedAttachment[] => {
      if (!entry || typeof entry !== "object") return [];
      const file = entry as Record<string, unknown>;
      return typeof file.id === "string" && typeof file.name === "string" && typeof file.path === "string" && typeof file.mimeType === "string" && typeof file.size === "number" && Number.isFinite(file.size) && file.size >= 0 ? [{ id: file.id, name: file.name, path: file.path, mimeType: file.mimeType, size: file.size, ...(typeof file.fileId === "string" && file.fileId ? { fileId: file.fileId } : {}), ...(typeof file.sizeBytes === "number" && Number.isFinite(file.sizeBytes) && file.sizeBytes >= 0 ? { sizeBytes: file.sizeBytes } : {}) }] : [];
    }) : [];
    seen.add(item.id);
    return [{ id: item.id, rootRunId: item.rootRunId, predecessorRunId: item.predecessorRunId, prompt: item.prompt, attachments, ...(typeof item.projectId === "string" && item.projectId ? { projectId: item.projectId } : {}), ...(typeof item.error === "string" && item.error ? { error: item.error } : {}) }];
  }).slice(0, maxQueuedFollowups);
}
export function loadQueuedFollowups(): QueuedFollowup[] {
  try { return typeof window === "undefined" ? [] : normalizeQueuedFollowups(JSON.parse(window.localStorage.getItem(queuedFollowupsStorageKey) ?? "[]")); } catch { return []; }
}
export function persistQueuedFollowups(items: QueuedFollowup[]): void {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(queuedFollowupsStorageKey, JSON.stringify(items)); } catch { /* The live queue stays usable when local storage is unavailable. */ }
}
export function queueMatchesConversation(item: QueuedFollowup, rootRunId: string | undefined, latestRunId: string | undefined, projectId: string | null | undefined): boolean {
  return projectId !== undefined && item.rootRunId === rootRunId && item.predecessorRunId === latestRunId && (item.projectId ?? null) === projectId && !item.error;
}
export function acknowledgeQueuedFollowup(items: QueuedFollowup[], id: string, acceptedRunId: string): QueuedFollowup[] {
  return items.filter((item) => item.id !== id).map((item) => item.predecessorRunId === id ? { ...item, predecessorRunId: acceptedRunId } : item);
}
export function removeQueuedFollowup(items: QueuedFollowup[], id: string): QueuedFollowup[] {
  const predecessor = items.find((item) => item.id === id)?.predecessorRunId;
  return items.filter((item) => item.id !== id).map((item) => item.predecessorRunId === id && predecessor ? { ...item, predecessorRunId: predecessor } : item);
}
