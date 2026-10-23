import assert from "node:assert/strict";
import test from "node:test";
import { ComposerDraftSession, composerDraftKey, composerDraftsStorageKey, draftMatchesExecutionContext, maxComposerDrafts, maxDraftCacheCharacters, maxDraftPromptCharacters, normalizeComposerDraft } from "../src/composer-drafts";

function memoryStorage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}
const attachment = { id: "upload_1", fileId: "file_1", name: "paired-data.csv", path: "/server/private/paired-data.csv", mimeType: "text/csv", size: 128 };

test("cached drafts cannot resolve a conversation's project or send under a different project", () => {
  assert.equal(draftMatchesExecutionContext("conversation:root", "root", undefined), false);
  assert.equal(draftMatchesExecutionContext("conversation:root", "root", null), true);
  assert.equal(draftMatchesExecutionContext("conversation:root", "root", "server_project"), true);
  assert.equal(draftMatchesExecutionContext("conversation:root", null, null), false);
  assert.equal(draftMatchesExecutionContext("project:analysis", null, null), false);
  assert.equal(draftMatchesExecutionContext("project:analysis", null, "other_project"), false);
  assert.equal(draftMatchesExecutionContext("project:analysis", null, "analysis"), true);
  assert.equal(draftMatchesExecutionContext("standalone", null, null), true);
});

test("conversation roots, project new tasks, and standalone tasks have separate drafts", () => {
  const storage = memoryStorage();
  const standalone = composerDraftKey({});
  const project = composerDraftKey({ projectId: "analysis" });
  const rootA = composerDraftKey({ rootRunId: "root_a", projectId: "analysis" });
  const rootB = composerDraftKey({ rootRunId: "root_b", projectId: "analysis" });
  const session = new ComposerDraftSession(storage, standalone);
  session.update((draft) => ({ ...draft, prompt: "A standalone question" }));
  session.activate(project);
  session.update((draft) => ({ ...draft, prompt: "Start an analysis", selectedSkills: ["statistics"], selectedContexts: ["workspace", "knowledge_design"] }));
  session.activate(rootA);
  session.update((draft) => ({ ...draft, prompt: "Check the paired samples", attachments: [attachment] }));
  session.activate(rootB);
  assert.equal(session.draft.prompt, "");
  assert.deepEqual(session.draft.attachments, []);
  session.update((draft) => ({ ...draft, prompt: "A different follow-up" }));
  assert.equal(session.activate(rootA).prompt, "Check the paired samples");
  assert.equal(session.draft.attachments[0]?.fileId, "file_1");
  assert.equal(session.activate(project).prompt, "Start an analysis");
  assert.deepEqual(session.draft.selectedContexts, ["workspace", "knowledge_design"]);
  assert.deepEqual(session.draft.selectedSkills, ["statistics"]);
  assert.equal(session.activate(standalone).prompt, "A standalone question");
  assert.equal(new ComposerDraftSession(storage, rootB).draft.prompt, "A different follow-up");
});

test("a reload restores uploaded metadata without persisting content or server paths", () => {
  const storage = memoryStorage();
  const session = new ComposerDraftSession(storage, "conversation:root");
  session.update((draft) => ({ ...draft, prompt: "Analyze this file", attachments: [{ ...attachment, content: "PRIVATE_FILE_CONTENT", providerKey: "PRIVATE_KEY" } as typeof attachment] }));
  const serialized = storage.getItem(composerDraftsStorageKey)!;
  assert.ok(!serialized.includes("PRIVATE_FILE_CONTENT"));
  assert.ok(!serialized.includes("PRIVATE_KEY"));
  assert.ok(!serialized.includes("/server/private"));
  const restored = new ComposerDraftSession(storage, "conversation:root");
  assert.equal(restored.draft.prompt, "Analyze this file");
  assert.deepEqual(restored.draft.attachments, [{ ...attachment, path: "" }]);
});

test("failed requests retain their draft, and accepting a turn clears only that submitted content", () => {
  const storage = memoryStorage();
  const session = new ComposerDraftSession(storage, "conversation:root");
  session.update((draft) => ({ ...draft, prompt: "Run the analysis", attachments: [attachment], selectedSkills: ["statistics"] }));
  const sent = session.capture();
  // No acknowledgment occurs on an API rejection or network failure.
  assert.equal(new ComposerDraftSession(storage, session.key).draft.prompt, "Run the analysis");
  assert.equal(session.acknowledge(sent).prompt, "");
  assert.deepEqual(session.draft.attachments, []);
  assert.deepEqual(session.draft.selectedSkills, ["statistics"]);
  assert.equal(new ComposerDraftSession(storage, session.key).draft.prompt, "");
});

test("acceptance preserves newer typing and never clears another task's draft", () => {
  const session = new ComposerDraftSession(memoryStorage(), "conversation:root_a");
  session.update((draft) => ({ ...draft, prompt: "First question", attachments: [attachment] }));
  const sent = session.capture();
  session.update((draft) => ({ ...draft, prompt: "A new question while the request starts", attachments: [...draft.attachments, { ...attachment, id: "upload_2" }] }));
  session.acknowledge(sent);
  assert.equal(session.draft.prompt, "A new question while the request starts");
  assert.deepEqual(session.draft.attachments.map((file) => file.id), ["upload_2"]);
  session.activate("conversation:root_b");
  session.update((draft) => ({ ...draft, prompt: "Task B draft", attachments: [attachment] }));
  session.acknowledge(sent);
  assert.equal(session.draft.prompt, "Task B draft");
  assert.equal(session.draft.attachments.length, 1);
});

test("an accepted first turn transfers pending new edits and selections to its conversation root", () => {
  const session = new ComposerDraftSession(memoryStorage(), "project:analysis");
  session.update((draft) => ({ ...draft, prompt: "First turn", attachments: [attachment], selectedSkills: ["statistics"], selectedContexts: ["workspace", "knowledge_design"] }));
  const sent = session.capture();
  session.update((draft) => ({ ...draft, prompt: "Then compare the effect sizes" }));
  session.accept(sent, "conversation:new_root");
  assert.equal(session.key, "conversation:new_root");
  assert.equal(session.draft.prompt, "Then compare the effect sizes");
  assert.deepEqual(session.draft.attachments, []);
  assert.deepEqual(session.draft.selectedSkills, ["statistics"]);
  assert.deepEqual(session.draft.selectedContexts, ["workspace", "knowledge_design"]);
  session.activate("project:analysis");
  assert.equal(session.draft.prompt, "");
});

test("switching away invalidates an upload even after returning to the same context", () => {
  const session = new ComposerDraftSession(memoryStorage(), "conversation:root_a");
  const pendingUpload = session.capture();
  session.update((draft) => ({ ...draft, prompt: "Typing keeps this upload owned by A" }));
  assert.equal(session.owns(pendingUpload), true);
  session.activate("conversation:root_b");
  assert.equal(session.owns(pendingUpload), false);
  session.activate("conversation:root_a");
  assert.equal(session.owns(pendingUpload), false);
  assert.equal(session.owns(session.capture()), true);
  assert.deepEqual(session.draft.attachments, []);
});

test("local drafts stay bounded by count, per-prompt size, and total cache characters", () => {
  const storage = memoryStorage();
  let now = 0;
  const session = new ComposerDraftSession(storage, "standalone", () => ++now);
  for (let index = 0; index < maxComposerDrafts + 10; index += 1) {
    session.activate(`conversation:root_${index}`);
    session.update((draft) => ({ ...draft, prompt: "x".repeat(maxDraftPromptCharacters + 100) }));
  }
  const serialized = storage.getItem(composerDraftsStorageKey)!;
  const saved = JSON.parse(serialized) as { drafts: { key: string; draft: { prompt: string } }[] };
  assert.ok(serialized.length <= maxDraftCacheCharacters);
  assert.ok(saved.drafts.length <= maxComposerDrafts);
  assert.equal(saved.drafts[0]?.key, `conversation:root_${maxComposerDrafts + 9}`);
  assert.ok(saved.drafts.every((entry) => entry.draft.prompt.length <= maxDraftPromptCharacters));
  // Cache limits do not discard text in the current live input.
  assert.equal(session.draft.prompt.length, maxDraftPromptCharacters + 100);
});

test("corrupt caches and unavailable storage do not disable the composer", () => {
  const corrupt = memoryStorage();
  corrupt.setItem(composerDraftsStorageKey, "{broken");
  assert.equal(new ComposerDraftSession(corrupt, "standalone").draft.prompt, "");
  const unavailable = { getItem: () => { throw new Error("disabled"); }, setItem: () => { throw new Error("full"); } };
  const session = new ComposerDraftSession(unavailable, "standalone");
  session.update((draft) => ({ ...draft, prompt: "Keep my text" }));
  session.activate("project:a");
  assert.equal(session.activate("standalone").prompt, "Keep my text");
  const normalized = normalizeComposerDraft({ attachments: [null, { ...attachment, size: -1 }], selectedSkills: [null, "statistics", "statistics"], selectedContexts: "invalid" });
  assert.deepEqual(normalized.attachments, []);
  assert.deepEqual(normalized.selectedSkills, ["statistics"]);
  assert.deepEqual(normalized.selectedContexts, ["workspace"]);
});
