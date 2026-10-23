import assert from "node:assert/strict";
import { test } from "node:test";
import { WorkspaceApiError, conversationTitle, describeApiError, imageFileUrl, workspaceApiBase, workspaceRequest } from "../src/features/workspace/api.ts";

test("workspace client sends mutations as JSON without adding provider credentials", async () => {
  const originalFetch = globalThis.fetch;
  let observed: { url: string; init?: RequestInit } | undefined;
  globalThis.fetch = async (input, init) => {
    observed = { url: String(input), ...(init ? { init } : {}) };
    return new Response(JSON.stringify({ project: { id: "project_1", name: "Evidence review" } }), { status: 201, headers: { "Content-Type": "application/json" } });
  };
  try {
    const result = await workspaceRequest<{ project: { id: string } }>("/api/projects", { method: "POST", body: { name: "Evidence review" } });
    assert.equal(result.project.id, "project_1");
    assert.equal(observed?.url, `${workspaceApiBase}/api/projects`);
    assert.equal(observed?.init?.method, "POST");
    assert.equal(observed?.init?.body, '{"name":"Evidence review"}');
    assert.equal(new Headers(observed?.init?.headers).get("Authorization"), null);
    assert.equal(new Headers(observed?.init?.headers).get("Content-Type"), "application/json");
  } finally { globalThis.fetch = originalFetch; }
});

test("workspace client preserves actionable backend errors", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { code: "image_provider_unconfigured", message: "Configure the image provider before generating." } }), { status: 503 });
  try {
    await assert.rejects(workspaceRequest("/api/images/generations", { method: "POST", body: { prompt: "A research figure" } }), (error: unknown) => error instanceof WorkspaceApiError && error.status === 503 && error.message === "Configure the image provider before generating.");
  } finally { globalThis.fetch = originalFetch; }
});

test("workspace client handles a non-JSON error without showing an HTML response", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("<html>Proxy failed</html>", { status: 502, headers: { "Content-Type": "text/html" } });
  try {
    await assert.rejects(workspaceRequest("/api/workspace"), (error: unknown) => error instanceof WorkspaceApiError && error.message === "Request failed (502).");
  } finally { globalThis.fetch = originalFetch; }
});

test("workspace connectivity errors explain the local service requirement", () => {
  assert.match(describeApiError(new TypeError("Failed to fetch")), /local workspace API/);
  assert.equal(describeApiError(new WorkspaceApiError("Project was not found.", 404)), "Project was not found.");
});

test("gallery URLs point at the local original-file endpoint", () => {
  assert.equal(imageFileUrl({ id: "image 1", prompt: "A diagram", model: "gpt-image-2.5-sunburst", size: "1k", createdAt: "2026-10-21T00:00:00Z" }), `${workspaceApiBase}/api/images/image%201/file`);
});

test("task labels prefer edited titles and safely recover an untitled task", () => {
  const base = { rootRunId: "run_1", conversationId: "conversation_1", latestRunId: "run_1", prompt: "\n  Inspect the workspace\nThen plan", status: "completed", updatedAt: "2026-10-21T00:00:00Z" };
  assert.equal(conversationTitle(base), "Inspect the workspace");
  assert.equal(conversationTitle({ ...base, title: "  Evidence review  " }), "Evidence review");
  assert.equal(conversationTitle({ ...base, prompt: "\n   \n" }), "Untitled task");
});
