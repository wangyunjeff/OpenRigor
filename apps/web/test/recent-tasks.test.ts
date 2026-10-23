import assert from "node:assert/strict";
import test from "node:test";
import { maxCachedRecentTasks, parseRecentTasks, rememberRecentTask, serializeRecentTasks, type RecentTask } from "../src/recent-tasks";

test("restoring a renamed project conversation retains its title, project and pin", () => {
  const task = { rootRunId: "root", conversationId: "conversation", latestRunId: "followup", prompt: "Original research request", status: "completed", updatedAt: "2026-10-22T00:00:00Z", title: "Paired data analysis", projectId: "statistics", pinned: true };
  assert.deepEqual(parseRecentTasks(JSON.stringify([task])), [task]);
});

test("remembering a run does not erase tasks from other projects after the eighth item", () => {
  const items: RecentTask[] = Array.from({ length: 90 }, (_, index) => ({ rootRunId: `root_${index}`, conversationId: `conversation_${index}`, latestRunId: `latest_${index}`, prompt: `Research task ${index}`, status: "completed", updatedAt: "today", projectId: index % 2 ? "project_a" : "project_b" }));
  const updated = rememberRecentTask(items, { ...items[75]!, latestRunId: "followup_75", status: "running" });
  assert.equal(updated.length, items.length);
  assert.equal(updated[0]?.rootRunId, "root_75");
  assert.equal(updated[0]?.latestRunId, "followup_75");
  assert.ok(updated.some((item) => item.rootRunId === "root_89"));
  assert.equal(new Set(updated.map((item) => item.rootRunId)).size, items.length);
  assert.equal(parseRecentTasks(serializeRecentTasks(updated)).length, maxCachedRecentTasks);
});

test("task updates retain user metadata but accept the server's standalone project identity", () => {
  const original: RecentTask = { rootRunId: "root", conversationId: "conversation", latestRunId: "first", prompt: "Initial question", title: "My research", projectId: "stale_project", pinned: true, status: "completed", updatedAt: "today" };
  const update: RecentTask = { rootRunId: "root", conversationId: "conversation", latestRunId: "second", prompt: "Follow-up", status: "running", updatedAt: "later" };
  const retained = rememberRecentTask([original], update)[0]!;
  assert.equal(retained.projectId, "stale_project");
  const authoritative = rememberRecentTask([original], update, null)[0]!;
  assert.equal(authoritative.projectId, undefined);
  assert.equal(authoritative.title, "My research");
  assert.equal(authoritative.pinned, true);
  assert.equal(authoritative.prompt, "Initial question");
  assert.equal(authoritative.latestRunId, "second");
});

test("legacy run shortcuts migrate while malformed entries and optional metadata are ignored", () => {
  const restored = parseRecentTasks(JSON.stringify([
    null,
    { runId: "legacy", prompt: "Research task", status: "completed", updatedAt: "today", title: 3, projectId: false, pinned: "true" },
    { runId: "invalid", prompt: "Invalid state", status: "unknown", updatedAt: "today" }
  ]));
  assert.deepEqual(restored, [{ rootRunId: "legacy", conversationId: "legacy", latestRunId: "legacy", prompt: "Research task", status: "completed", updatedAt: "today" }]);
  assert.deepEqual(parseRecentTasks("{broken"), []);
  assert.deepEqual(parseRecentTasks(null), []);
});
