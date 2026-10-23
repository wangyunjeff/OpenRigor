import assert from "node:assert/strict";
import test from "node:test";
import { previewFileKey, type PreviewFile } from "../src/features/preview/file-preview-model";
import { closePreviewTab, emptyPreviewState, maxPreviewTabs, previewStateForScope, selectPreviewTab, upsertPreviewTab, type PreviewState } from "../src/features/preview/preview-state";

interface Tab { id: string; title: string }
const tab = (id: string, title = id): Tab => ({ id, title });
const open = (ids: string[], scope = "task:a"): PreviewState<Tab> => ids.reduce((state, id) => upsertPreviewTab(state, tab(id)), emptyPreviewState<Tab>(scope));
const file = (runId = "run_a", revision = 1): PreviewFile => ({ origin: "artifact", runId, fileId: "report", name: "report.md", path: "reports/report.md", mimeType: "text/markdown", revision, downloadUrl: "/api/runs/" + runId + "/files/report?revision=" + revision });

test("scope changes expose an empty closed viewer synchronously before effects", () => {
  const stored = open(["report", "article"], "task:a");
  const next = previewStateForScope(stored, "task:b");
  assert.deepEqual(next, { scope: "task:b", tabs: [], activeId: null, open: false });
  assert.equal(previewStateForScope(stored, "task:a"), stored);
  assert.deepEqual(stored.tabs.map((item) => item.id), ["report", "article"]);
  const opened = upsertPreviewTab(next, tab("other-report"));
  assert.equal(opened.scope, "task:b");
  assert.deepEqual(opened.tabs.map((item) => item.id), ["other-report"]);
  assert.equal(opened.activeId, "other-report");
});

test("scope isolation also applies inside delayed state-setter transitions", () => {
  const stored = open(["task-a-file"], "task:a");
  const next = upsertPreviewTab(previewStateForScope(stored, "project:b"), tab("project-b-file"));
  assert.deepEqual(next.tabs.map((item) => item.id), ["project-b-file"]);
  assert.equal(next.scope, "project:b");
  assert.equal(stored.activeId, "task-a-file");
});

test("opening the same immutable revision updates one tab using its canonical identity", () => {
  const registered = file();
  const { runId: _runId, ...fromCard } = registered;
  assert.equal(previewFileKey(registered), previewFileKey(fromCard));
  let state = emptyPreviewState<Tab>("task:a");
  state = upsertPreviewTab(state, tab(previewFileKey(registered), "Report"));
  state = upsertPreviewTab(state, tab(previewFileKey(fromCard), "Report · selected from card"));
  assert.equal(state.tabs.length, 1);
  assert.equal(state.tabs[0]?.title, "Report · selected from card");
  assert.equal(state.activeId, previewFileKey(registered));
  assert.equal(state.open, true);
  state = upsertPreviewTab(state, tab(previewFileKey(file("run_a", 2))));
  state = upsertPreviewTab(state, tab(previewFileKey(file("run_b", 1))));
  assert.equal(state.tabs.length, 3, "another revision and another run are distinct identities");
});

test("opening tabs remains bounded, deduplicated and selected without changing input", () => {
  const empty = emptyPreviewState<Tab>("task:a");
  let state = empty;
  for (let index = 0; index < maxPreviewTabs + 8; index++) state = upsertPreviewTab(state, tab("file-" + index));
  assert.equal(state.tabs.length, maxPreviewTabs);
  assert.equal(new Set(state.tabs.map((item) => item.id)).size, maxPreviewTabs);
  assert.equal(state.tabs[0]?.id, "file-8");
  assert.equal(state.activeId, "file-19");
  assert.deepEqual(empty.tabs, []);
  const reopened = upsertPreviewTab(state, tab("file-8", "Reopened"));
  assert.equal(reopened.tabs.length, maxPreviewTabs);
  assert.equal(reopened.tabs[0]?.title, "Reopened");
  assert.equal(reopened.activeId, "file-8");
  assert.equal(state.tabs[0]?.title, "file-8");
});

test("an oversized or duplicate incoming state cannot evict the newly selected tab", () => {
  const tabs = Array.from({length: 20}, (_, index) => tab("file-" + index));
  const state: PreviewState<Tab> = { scope: "task:a", tabs: [...tabs, tab("file-0", "Duplicate")], activeId: "file-19", open: false };
  const repaired = upsertPreviewTab(state, tab("file-0", "Chosen"));
  assert.equal(repaired.tabs.length, maxPreviewTabs);
  assert.equal(new Set(repaired.tabs.map((item) => item.id)).size, maxPreviewTabs);
  assert.equal(repaired.activeId, "file-0");
  assert.equal(repaired.tabs.find((item) => item.id === "file-0")?.title, "Chosen");
});

test("closing the active tab selects the adjacent tab and preserves background selection", () => {
  const base = selectPreviewTab(open(["a", "b", "c", "d"]), "b");
  const closeMiddle = closePreviewTab(base, "b");
  assert.equal(closeMiddle.activeId, "c");
  assert.deepEqual(closeMiddle.tabs.map((item) => item.id), ["a", "c", "d"]);
  const closeLast = closePreviewTab(selectPreviewTab(base, "d"), "d");
  assert.equal(closeLast.activeId, "c");
  assert.equal(closePreviewTab(base, "a").activeId, "b");
  assert.equal(base.activeId, "b");
});

test("closing the final tab retains an empty open task-file library", () => {
  const closed = closePreviewTab(open(["only"]), "only");
  assert.deepEqual(closed, { scope: "task:a", tabs: [], activeId: null, open: true });
  assert.deepEqual(closePreviewTab(closed, "already-gone"), closed);
});

test("closing repairs a stale active id and selecting a missing tab is a no-op", () => {
  const valid = open(["a", "b", "c"]);
  assert.equal(selectPreviewTab(valid, "missing"), valid);
  const invalid = { ...valid, activeId: "missing" };
  assert.equal(closePreviewTab(invalid, "c").activeId, "b");
  assert.equal(closePreviewTab(invalid, "already-gone").activeId, "c");
  const hidden = { ...valid, open: false };
  assert.equal(selectPreviewTab(hidden, "a").open, true);
  assert.equal(selectPreviewTab(hidden, "a").activeId, "a");
});
