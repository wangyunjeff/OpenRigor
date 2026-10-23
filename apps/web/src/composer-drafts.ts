import type { QueuedAttachment } from "./queued-followups";

export interface ComposerDraft {
  prompt: string;
  attachments: QueuedAttachment[];
  selectedSkills: string[];
  selectedContexts: string[];
}

export interface DraftToken { key: string; generation: number; draft: ComposerDraft }
interface StoredDraft { key: string; updatedAt: number; draft: ComposerDraft }
type DraftStorage = Pick<Storage, "getItem" | "setItem">;
export const composerDraftsStorageKey = "openrigor.composer-drafts.v1";
export const maxComposerDrafts = 32;
export const maxDraftCacheCharacters = 512 * 1024;
export const maxDraftPromptCharacters = 32768;
const maxDraftAttachments = 20;

export function composerDraftKey(context: { rootRunId?: string | null | undefined; projectId?: string | null | undefined }): string {
  return context.rootRunId ? `conversation:${context.rootRunId}` : context.projectId ? `project:${context.projectId}` : "standalone";
}

/** Cached drafts are UI state; they must never supply execution project ownership. */
export function draftMatchesExecutionContext(key: string, rootRunId: string | null, projectId: string | null | undefined): boolean {
  return (!rootRunId || projectId !== undefined) && key === composerDraftKey({ rootRunId, projectId });
}

function emptyDraft(): ComposerDraft { return { prompt: "", attachments: [], selectedSkills: [], selectedContexts: ["workspace"] }; }
function record(value: unknown): Record<string, unknown> | null { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function identifier(value: unknown): value is string { return typeof value === "string" && value.length > 0 && value.length <= 256; }
function validKey(value: unknown): value is string { return typeof value === "string" && value.length <= 270 && (value === "standalone" || /^(conversation|project):.+$/.test(value)); }
function strings(value: unknown, fallback: string[]): string[] {
  return Array.isArray(value) ? [...new Set(value.filter(identifier))].slice(0, 32) : fallback;
}

/** Only cache uploaded references and selection ids, never File objects, content, or server paths. */
export function normalizeComposerDraft(value: unknown): ComposerDraft {
  const draft = record(value);
  if (!draft) return emptyDraft();
  const attachments = Array.isArray(draft.attachments) ? draft.attachments.flatMap((entry): QueuedAttachment[] => {
    const file = record(entry);
    if (!file || !identifier(file.id) || !identifier(file.name) || typeof file.mimeType !== "string" || file.mimeType.length > 256 || typeof file.size !== "number" || !Number.isFinite(file.size) || file.size < 0) return [];
    return [{ id: file.id, name: file.name, path: "", mimeType: file.mimeType, size: file.size,
      ...(identifier(file.fileId) ? { fileId: file.fileId } : {}),
      ...(typeof file.sizeBytes === "number" && Number.isFinite(file.sizeBytes) && file.sizeBytes >= 0 ? { sizeBytes: file.sizeBytes } : {}) }];
  }).slice(0, maxDraftAttachments) : [];
  return {
    prompt: typeof draft.prompt === "string" ? draft.prompt.slice(0, maxDraftPromptCharacters) : "",
    attachments: [...new Map(attachments.map((file) => [file.id, file])).values()],
    selectedSkills: strings(draft.selectedSkills, []),
    selectedContexts: strings(draft.selectedContexts, ["workspace"])
  };
}

function isEmpty(draft: ComposerDraft): boolean {
  return !draft.prompt && !draft.attachments.length && !draft.selectedSkills.length && draft.selectedContexts.length === 1 && draft.selectedContexts[0] === "workspace";
}

/** One owner for the visible draft, its local cache, and asynchronous upload ownership. */
export class ComposerDraftSession {
  private entries: StoredDraft[] = [];
  private generation = 0;
  private currentKey: string;
  private currentDraft: ComposerDraft;

  constructor(private storage: DraftStorage | null, initialKey: string, private now = Date.now) {
    this.currentKey = initialKey;
    try {
      const saved = record(JSON.parse(storage?.getItem(composerDraftsStorageKey) ?? "null"));
      if (saved?.version === 1 && Array.isArray(saved.drafts)) {
        const seen = new Set<string>();
        this.entries = saved.drafts.flatMap((value): StoredDraft[] => {
          const item = record(value);
          if (!item || !validKey(item.key) || seen.has(item.key) || typeof item.updatedAt !== "number" || !Number.isFinite(item.updatedAt)) return [];
          seen.add(item.key);
          return [{ key: item.key, updatedAt: item.updatedAt, draft: normalizeComposerDraft(item.draft) }];
        }).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, maxComposerDrafts);
      }
    } catch { /* A corrupt cache must not prevent opening the composer. */ }
    this.currentDraft = this.entries.find((entry) => entry.key === initialKey)?.draft ?? emptyDraft();
  }

  get key(): string { return this.currentKey; }
  get draft(): ComposerDraft { return this.currentDraft; }
  capture(): DraftToken { return { key: this.currentKey, generation: this.generation, draft: this.currentDraft }; }
  owns(token: DraftToken): boolean { return token.key === this.currentKey && token.generation === this.generation; }

  update(updater: (draft: ComposerDraft) => ComposerDraft): ComposerDraft {
    this.currentDraft = updater(this.currentDraft);
    this.save(this.currentKey, this.currentDraft);
    return this.currentDraft;
  }

  activate(key: string): ComposerDraft {
    if (key === this.currentKey) return this.currentDraft;
    this.save(this.currentKey, this.currentDraft);
    this.generation += 1;
    this.currentKey = key;
    this.currentDraft = this.entries.find((entry) => entry.key === key)?.draft ?? emptyDraft();
    return this.currentDraft;
  }

  /** Clear accepted content only. A newer edit and another conversation's draft stay intact. */
  acknowledge(token: DraftToken): ComposerDraft {
    const current = token.key === this.currentKey ? this.currentDraft : this.entries.find((entry) => entry.key === token.key)?.draft;
    if (!current) return this.currentDraft;
    const sentIds = new Set(token.draft.attachments.map((file) => file.id));
    const next = { ...current, prompt: current.prompt === token.draft.prompt ? "" : current.prompt, attachments: current.attachments.filter((file) => !sentIds.has(file.id)) };
    if (token.key === this.currentKey) this.currentDraft = next;
    this.save(token.key, next);
    return this.currentDraft;
  }

  /** A newly accepted root takes ownership of edits written while its first turn was starting. */
  accept(token: DraftToken, conversationKey: string): ComposerDraft {
    const transfer = this.owns(token) && conversationKey !== this.currentKey;
    this.acknowledge(token);
    if (!transfer) return this.currentDraft;
    const remaining = this.currentDraft;
    const destination = this.entries.find((entry) => entry.key === conversationKey)?.draft;
    if (!destination || isEmpty(destination)) {
      this.currentDraft = { ...remaining, prompt: "", attachments: [] };
      this.save(this.currentKey, this.currentDraft);
      this.activate(conversationKey);
      return this.update(() => remaining);
    }
    return this.activate(conversationKey);
  }

  private save(key: string, draft: ComposerDraft): void {
    const normalized = normalizeComposerDraft(draft);
    this.entries = this.entries.filter((entry) => entry.key !== key);
    if (!isEmpty(normalized)) this.entries.unshift({ key, updatedAt: this.now(), draft: normalized });
    this.entries = this.entries.slice(0, maxComposerDrafts);
    let serialized = JSON.stringify({ version: 1, drafts: this.entries });
    while (serialized.length > maxDraftCacheCharacters && this.entries.length > 1) {
      this.entries.pop();
      serialized = JSON.stringify({ version: 1, drafts: this.entries });
    }
    try { this.storage?.setItem(composerDraftsStorageKey, serialized); } catch { /* Keep the live session usable when browser storage is full or disabled. */ }
  }
}
