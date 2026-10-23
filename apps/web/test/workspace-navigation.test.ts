import assert from "node:assert/strict";
import test from "node:test";
import { chatPath, closeModalNavigation, openModalNavigation } from "../src/workspace-navigation";

test("closing Agent returns to its exact conversation through back without adding history", () => {
  const opened = openModalNavigation("/chat/root_a", null, null, "/chat/root_a");
  assert.equal(opened.method, "push");
  assert.deepEqual(closeModalNavigation(opened.state, "/chat"), { method: "back", path: "/chat/root_a" });
});

test("switching modal pages replaces one overlay entry and retains its original return path", () => {
  const opened = openModalNavigation("/projects?create=1", "projects", null, "/chat/root_a");
  const switched = openModalNavigation("/agent", "agent", opened.state, "/chat/root_a");
  assert.equal(switched.method, "replace");
  assert.deepEqual(closeModalNavigation(switched.state, "/chat/root_a"), { method: "back", path: "/projects?create=1" });
});

test("direct modal routes and invalid return state replace the location with the current chat", () => {
  assert.deepEqual(closeModalNavigation(null, chatPath("root_a")), { method: "replace", path: "/chat/root_a" });
  for (const path of ["https://example.com", "//example.com", "/agent", "/chat/root#unsafe"]) {
    assert.deepEqual(closeModalNavigation({ openrigorModalReturn: path }, "/chat/root_a"), { method: "replace", path: "/chat/root_a" });
  }
  assert.deepEqual(closeModalNavigation(null, chatPath()), { method: "replace", path: "/chat" });
});

test("switching away from a directly opened modal never backs out of the application", () => {
  const switched = openModalNavigation("/agent", "agent", null, "/chat/root_a");
  assert.equal(switched.method, "replace");
  assert.deepEqual(closeModalNavigation(switched.state, "/chat"), { method: "replace", path: "/chat/root_a" });
});
