import assert from "node:assert/strict";
import test from "node:test";
import { matchesTaskStatus, patchTaskList, selectTasks, standaloneTaskScope, taskCollectionCounts, taskPromptExcerpt, taskSearchPath } from "../src/features/workspace/task-surface-model";
import type { WorkspaceConversation } from "../src/features/workspace/api";

const task = (id: string, value: Partial<WorkspaceConversation> = {}): WorkspaceConversation => ({ rootRunId: id, conversationId: `conversation-${id}`, latestRunId: `${id}-latest`, prompt: `Prompt ${id}`, status: "completed", updatedAt: "2026-10-22T00:00:00Z", ...value });
const options = { view: "tasks", status: "all", scope: "", sort: "recent" } as const;

test("search always requests archived records and safely encodes full-text queries and project scope", () => {
  const url = new URL(taskSearchPath("  LoRA & QLoRA?  ", "project/a"), "http://local");
  assert.equal(url.searchParams.get("archived"), "true");
  assert.equal(url.searchParams.get("q"), "LoRA & QLoRA?");
  assert.equal(url.searchParams.get("projectId"), "project/a");
  assert.equal(new URL(taskSearchPath(" "), "http://local").searchParams.has("q"), false);
});

test("archived tasks never leak into active or pinned views, and standalone is a real scope", () => {
  const items = [task("active", { pinned: true, projectId: "p" }), task("archived", { archived: true, pinned: true }), task("standalone")];
  assert.deepEqual(selectTasks(items, options).map((item) => item.rootRunId), ["active", "standalone"]);
  assert.deepEqual(selectTasks(items, { ...options, view: "pinned" }).map((item) => item.rootRunId), ["active"]);
  assert.deepEqual(selectTasks(items, { ...options, view: "archived" }).map((item) => item.rootRunId), ["archived"]);
  assert.deepEqual(selectTasks(items, { ...options, scope: standaloneTaskScope }).map((item) => item.rootRunId), ["standalone"]);
  assert.deepEqual(selectTasks(items, { ...options, scope: "p" }).map((item) => item.rootRunId), ["active"]);
});

test("status groups keep waiting-user visible as active and requiring attention", () => {
  const waiting = task("waiting", { status: "waiting_user" });
  assert.equal(matchesTaskStatus(waiting, "active"), true);
  assert.equal(matchesTaskStatus(waiting, "attention"), true);
  assert.equal(matchesTaskStatus(task("stopping", { status: "cancelling" }), "active"), true);
  assert.equal(matchesTaskStatus(task("cancelled", { status: "cancelled" }), "attention"), false);
  assert.equal(matchesTaskStatus(task("unknown", { status: "future-state" }), "completed"), false);
});

test("collection counts use the current status and project filters without counting archived pins as active", () => {
  const items = [task("running", { status: "running", projectId: "p", pinned: true }), task("completed", { projectId: "p" }), task("archive", { status: "running", projectId: "p", archived: true, pinned: true }), task("other", { status: "running", projectId: "q" })];
  assert.deepEqual(taskCollectionCounts(items, { status: "active", scope: "p" }), { tasks: 1, pinned: 1, archived: 1 });
  assert.deepEqual(taskCollectionCounts(items, { status: "all", scope: "p" }), { tasks: 2, pinned: 1, archived: 1 });
});

test("ordering is deterministic, preserves source order and puts pins first only for recent sorting", () => {
  const items = [task("new", { title: "Report 10", updatedAt: "2026-10-22T03:00:00Z" }), task("old", { title: "Report 2", pinned: true, updatedAt: "2026-10-21T00:00:00Z" })];
  assert.deepEqual(selectTasks(items, options).map((item) => item.rootRunId), ["old", "new"]);
  assert.deepEqual(selectTasks(items, { ...options, sort: "title" }).map((item) => item.rootRunId), ["old", "new"]);
  assert.deepEqual(selectTasks(items, { ...options, sort: "oldest" }).map((item) => item.rootRunId), ["old", "new"]);
  assert.deepEqual(items.map((item) => item.rootRunId), ["new", "old"]);
});

test("metadata-only archive and restore responses retain task identity and saved title", () => {
  const items = [task("a", { title: "A useful title", projectId: "p" })];
  const archived = patchTaskList(items, "a", { archived: true, rootRunId: "wrong", latestRunId: undefined });
  assert.equal(archived[0]?.rootRunId, "a");
  assert.equal(archived[0]?.latestRunId, "a-latest");
  assert.equal(archived[0]?.title, "A useful title");
  assert.equal(archived[0]?.projectId, "p");
  assert.equal(selectTasks(archived, options).length, 0);
  assert.equal(selectTasks(patchTaskList(archived, "a", { archived: false }), options).length, 1);
});

test("prompt excerpts exclude provider context and stay bounded", () => {
  assert.equal(taskPromptExcerpt("Private system context\n\nTask:\nResearch this question"), "Research this question");
  assert.equal(taskPromptExcerpt("a".repeat(300)).length, 170);
});
