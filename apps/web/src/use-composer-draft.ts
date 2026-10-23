import { useCallback, useState, type SetStateAction } from "react";
import { ComposerDraftSession, type ComposerDraft, type DraftToken } from "./composer-drafts";
import type { QueuedAttachment } from "./queued-followups";

function resolve<T>(next: SetStateAction<T>, current: T): T { return typeof next === "function" ? (next as (value: T) => T)(current) : next; }

export function useComposerDraft(initialKey: () => string) {
  const [session] = useState(() => {
    let storage: Storage | null = null;
    try { storage = window.localStorage; } catch { /* In-memory drafts still work with storage disabled. */ }
    return new ComposerDraftSession(storage, initialKey());
  });
  const [draft, setDraft] = useState<ComposerDraft>(() => session.draft);
  const setPrompt = useCallback((next: SetStateAction<string>) => setDraft(session.update((current) => ({ ...current, prompt: resolve(next, current.prompt) }))), [session]);
  const setAttachments = useCallback((next: SetStateAction<QueuedAttachment[]>) => setDraft(session.update((current) => ({ ...current, attachments: resolve(next, current.attachments) }))), [session]);
  const setSelectedSkills = useCallback((next: SetStateAction<string[]>) => setDraft(session.update((current) => ({ ...current, selectedSkills: resolve(next, current.selectedSkills) }))), [session]);
  const setSelectedContexts = useCallback((next: SetStateAction<string[]>) => setDraft(session.update((current) => ({ ...current, selectedContexts: resolve(next, current.selectedContexts) }))), [session]);
  const activateDraft = useCallback((key: string) => setDraft(session.activate(key)), [session]);
  const acknowledgeDraft = useCallback((token: DraftToken) => setDraft(session.acknowledge(token)), [session]);
  const acceptDraft = useCallback((token: DraftToken, key: string) => setDraft(session.accept(token, key)), [session]);
  return { ...draft, setPrompt, setAttachments, setSelectedSkills, setSelectedContexts, session, activateDraft, acknowledgeDraft, acceptDraft };
}
