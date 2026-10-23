import assert from "node:assert/strict";
import test from "node:test";
import { directoryBreadcrumbs, fileBrowserPath, fileBrowserScope, knowledgeContentLimit, knowledgeSaveRequest, projectDraft, reconcileProjectDrafts, reconcileSettingsDraft } from "../src/features/workspace/workspace-detail";

test("overview refresh retains each project's unsaved draft and refreshes clean forms", () => {
  const first = { id: "one", name: "First project", description: "Original description" };
  const second = { id: "two", name: "Second project" };
  const drafts = { one: { ...projectDraft(first), instructions: "Unsaved methods", dirty: true }, two: projectDraft(second) };
  const refreshed = reconcileProjectDrafts(drafts, [{ ...first, name: "Server rename" }, { ...second, name: "Updated second" }]);
  assert.equal(refreshed.one?.instructions, "Unsaved methods");
  assert.equal(refreshed.one?.name, "First project");
  assert.equal(refreshed.two?.name, "Updated second");
  assert.equal(refreshed.one, drafts.one);
  assert.equal(drafts.two.name, "Second project");
});

test("a theme refresh keeps unsaved persona edits while applying other saved settings", () => {
  const agent = { name: "Research partner", instructions: "Unsaved evidence standards", defaultModel: "auto", effort: "high" };
  const draft = { theme: "light" as const, agent };
  const latest = { theme: "dark" as const, language: "zh-CN", agent: { ...agent, instructions: "Saved instructions" } };
  const reconciled = reconcileSettingsDraft(draft, latest, true);
  assert.equal(reconciled.agent, agent);
  assert.equal(reconciled.theme, "dark");
  assert.equal(reconciled.language, "zh-CN");
  assert.equal(draft.theme, "light");
  assert.equal(reconcileSettingsDraft(draft, latest, false), latest);
});

test("saving knowledge edits retains the note identity and cannot change its project", () => {
  assert.deepEqual(knowledgeSaveRequest({ id: "note/1", name: " Updated title ", content: " Revised evidence " }, "different-project"), {
    path: "/api/knowledge/note%2F1", method: "PATCH", body: { name: "Updated title", content: "Revised evidence" }
  });
  assert.deepEqual(knowledgeSaveRequest({ id: null, name: "New note", content: "Evidence" }, "project-one"), {
    path: "/api/knowledge", method: "POST", body: { name: "New note", content: "Evidence", projectId: "project-one" }
  });
});

test("knowledge editing observes the API content limit and rejects blank drafts", () => {
  assert.doesNotThrow(() => knowledgeSaveRequest({ id: "note", name: "At limit", content: "x".repeat(knowledgeContentLimit) }, "project"));
  assert.throws(() => knowledgeSaveRequest({ id: "note", name: "Over limit", content: "x".repeat(knowledgeContentLimit + 1) }, "project"), /64,000/);
  assert.throws(() => knowledgeSaveRequest({ id: null, name: "  ", content: "Evidence" }, "project"), /title/);
});

test("changing a project root resets its folder and distinguishes results with identical paths", () => {
  const location = { projectId: "one", path: "data/processed" };
  assert.equal(fileBrowserPath(location, "one"), "data/processed");
  assert.equal(fileBrowserPath(location, "two"), "");
  assert.equal(fileBrowserPath(location), "");
  assert.notEqual(fileBrowserScope("one", location.path), fileBrowserScope("two", location.path));
  assert.notEqual(fileBrowserScope("one", ""), fileBrowserScope("one", location.path));
  assert.deepEqual(directoryBreadcrumbs(location.path), [{ name: "data", path: "data" }, { name: "processed", path: "data/processed" }]);
});
