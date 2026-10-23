import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, writeFileSync, symlinkSync, mkdirSync, readFileSync, readdirSync, realpathSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { get as httpGet } from "node:http";
import { LocalStore } from "../src/local-store.js";
import { WorkspaceService, resolvePublicWorkspacePath } from "../src/workspace.js";
import type { RunDetail } from "@openrigor/protocol";

async function start(root: string, data: string, extraEnv: NodeJS.ProcessEnv = {}): Promise<{ child: ChildProcessWithoutNullStreams; base: string }> {
  const child = spawn(process.execPath, ["--import", "tsx", fileURLToPath(new URL("../src/server.ts", import.meta.url))], { env: { ...process.env, PORT: "0", OPENRIGOR_EXECUTOR: "demo", OPENRIGOR_CODEX_CWD: root, OPENRIGOR_DATA_DIR: data, ...extraEnv }, stdio: ["pipe", "pipe", "pipe"] });
  let output = "";
  let errors = "";
  child.stderr.on("data", (chunk: Buffer) => { errors += chunk.toString(); });
  const base = await new Promise<string>((resolveReady, reject) => {
    const timer = setTimeout(() => reject(new Error(`API did not start: ${errors}`)), 10_000);
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      const match = output.match(/http:\/\/127\.0\.0\.1:(\d+)/);
      if (match?.[1]) { clearTimeout(timer); resolveReady(match[0]); }
    });
    child.once("exit", () => { clearTimeout(timer); reject(new Error(`API exited: ${errors}`)); });
  });
  return { child, base };
}
async function stop(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit"); child.kill("SIGKILL"); await exited;
}
async function json(base: string, path: string, method = "GET", value?: unknown): Promise<{ status: number; data: any }> {
  const result = await fetch(`${base}${path}`, { method, ...(value === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(value) }) });
  return { status: result.status, data: await result.json() };
}
async function terminal(base: string, runId: string): Promise<RunDetail> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const { data } = await json(base, `/api/runs/${runId}`);
    if (["completed", "failed", "cancelled"].includes(data.snapshot.status)) return data as RunDetail;
    await new Promise((done) => setTimeout(done, 30));
  }
  throw new Error("run did not finish");
}

test("workspace CRUD, guarded files, persisted history and interruption recovery", async () => {
  const root = mkdtempSync(join(tmpdir(), "openrigor-workspace-"));
  const data = join(root, ".openrigor");
  writeFileSync(join(root, "notes.md"), "Visible research notes");
  writeFileSync(join(root, ".env"), "PRIVATE_KEY=should-never-appear");
  symlinkSync(tmpdir(), join(root, "outside"));
  let running = await start(root, data);
  try {
    const workspace = await json(running.base, "/api/workspace");
    assert.equal(workspace.data.workspace.path, root);
    assert.equal(workspace.data.runtime.persistence, "local-disk");
    assert.equal(workspace.data.settings.agent.defaultModel, "auto");

    const hostile = await fetch(`${running.base}/api/projects`, { method: "POST", headers: { origin: "https://untrusted.example", "content-type": "application/json" }, body: JSON.stringify({ name: "bad" }) });
    assert.equal(hostile.status, 403);
    const badHost = await new Promise<number | undefined>((done, reject) => {
      httpGet(`${running.base}/healthz`, { headers: { host: "evil.example" } }, (res) => { res.resume(); done(res.statusCode); }).on("error", reject);
    });
    assert.equal(badHost, 403);
    assert.equal((await json(running.base, "/api/projects")).data.projects.length, 0);

    assert.equal((await json(running.base, "/api/projects", "POST", { name: "" })).status, 400);
    const created = await json(running.base, "/api/projects", "POST", { name: "Research", description: "Local science", instructions: "Cite primary evidence." });
    assert.equal(created.status, 201);
    const project = created.data.project;
    assert.ok(project.path.startsWith(join(data, "projects")));
    const updated = await json(running.base, `/api/projects/${project.id}`, "PATCH", { name: "Research lab" });
    assert.equal(updated.data.project.name, "Research lab");
    const knowledge = await json(running.base, "/api/knowledge", "POST", { name: "Experiment", content: "Retain uncertainties", projectId: project.id });
    assert.equal(knowledge.status, 201);
    const skill = await json(running.base, "/api/skills", "POST", { name: "Evidence audit", description: "Check evidence", instructions: "Distinguish observation from inference." });
    assert.equal(skill.status, 201);
    assert.equal(skill.data.skill.installed, true);
    assert.equal((await json(running.base, `/api/skills/${skill.data.skill.id}/install`, "DELETE")).data.skill.installed, false);
    await json(running.base, `/api/skills/${skill.data.skill.id}/install`, "POST", {});
    await json(running.base, "/api/settings", "PATCH", { agent: { instructions: "Be precise." }, theme: "light" });
    await json(running.base, "/api/profile", "PATCH", { displayName: "Test user" });

    const files = await json(running.base, "/api/files");
    assert.deepEqual(files.data.files.map((file: any) => file.name), ["notes.md"]);
    const preview = await json(running.base, "/api/files/content?path=notes.md");
    assert.equal(preview.data.content, "Visible research notes");
    for (const path of [".env", "../outside", "/etc/passwd", "outside", "notes.md/../../etc/passwd", ".openrigor/workspace.json"]) {
      assert.ok([403, 404].includes((await json(running.base, `/api/files/content?path=${encodeURIComponent(path)}`)).status), path);
    }
    const attachment = await json(running.base, "/api/attachments", "POST", { name: "paper.txt", content: Buffer.from("Attachment content").toString("base64"), mimeType: "text/plain" });
    assert.equal(attachment.status, 201);
    assert.equal(readFileSync(attachment.data.attachment.path, "utf8"), "Attachment content");
    assert.equal((await json(running.base, "/api/attachments", "POST", { name: "../../bad", content: "aA==" })).status, 400);
    assert.equal((await json(running.base, "/api/images/generations", "POST", { prompt: "A test", model: "invalid" })).status, 400);

    assert.equal((await json(running.base, "/api/runs", "POST", { prompt: "Forged attachment", attachments: [{ fileId: "file_missing", name: "secret.txt" }] })).status, 404);
    const request = { prompt: "Persistent evidence audit", projectId: project.id, skillIds: [skill.data.skill.id], clientRequestId: "persisted-key", attachments: [{ fileId: attachment.data.attachment.fileId, name: "forged-display-name.txt", mimeType: "text/plain", sizeBytes: 1 }], contextPaths: ["notes.md"] };
    const accepted = await json(running.base, "/api/runs", "POST", request);
    assert.equal(accepted.status, 202);
    const runId = accepted.data.runId;
    const completed = await terminal(running.base, runId);
    assert.equal(completed.snapshot.status, "completed");
    const authoritative = await json(running.base, `/api/runs/${runId}`);
    assert.equal(authoritative.data.projectId, project.id);
    assert.equal(authoritative.data.snapshot.projectId, project.id);
    assert.equal(authoritative.data.attachments[0].name, "paper.txt");
    assert.equal(authoritative.data.attachments[0].sizeBytes, Buffer.byteLength("Attachment content"));
    assert.equal(readFileSync(join(project.path, "attachments", attachment.data.attachment.path.split(/[\\/]/).at(-1)), "utf8"), "Attachment content");
    const stored = JSON.parse(readFileSync(join(data, "runs", `${runId}.json`), "utf8"));
    assert.match(stored.contextPrompt, /Visible research notes/);
    assert.deepEqual(stored.contextPaths, ["notes.md"]);
    assert.equal(completed.snapshot.prompt, "Persistent evidence audit");
    assert.match(stored.contextPrompt, /Be precise/);
    assert.match(stored.contextPrompt, /Retain uncertainties/);
    assert.match(stored.contextPrompt, /Distinguish observation/);
    assert.ok(stored.contextPrompt.includes(join(project.path, "attachments")));
    await json(running.base, `/api/conversations/${runId}`, "PATCH", { title: "Saved study", pinned: true });
    const history = await json(running.base, "/api/conversations?q=evidence");
    assert.equal(history.data.conversations[0].projectId, project.id);
    assert.equal(history.data.conversations[0].title, "Saved study");
    assert.equal((await json(running.base, "/api/usage")).data.usage.completedRuns, 1);

    // Crash while another run is active; recovery keeps its stream and appends one terminal event.
    const active = await json(running.base, "/api/runs", "POST", { prompt: "Interrupted work" });
    await stop(running.child);
    running = await start(root, data);
    const recovered = await json(running.base, `/api/runs/${active.data.runId}`);
    assert.equal(recovered.data.snapshot.status, "failed");
    assert.equal(recovered.data.projectId, null);
    assert.equal(recovered.data.snapshot.projectId, null);
    assert.equal(recovered.data.snapshot.error.code, "RUNTIME_RESTARTED");
    assert.equal(recovered.data.events.filter((event: any) => event.type === "run-finished").length, 1);
    const replay = await json(running.base, "/api/runs", "POST", request);
    assert.equal(replay.data.runId, runId);
    const conflict = await json(running.base, "/api/runs", "POST", { ...request, prompt: "Changed payload" });
    assert.equal(conflict.status, 409);
    assert.equal((await json(running.base, "/api/runs", "POST", { ...request, contextPaths: [] })).status, 409);
    for (const contextPath of [".env", "../outside", "outside", "/etc/passwd"]) {
      const invalidContext = await json(running.base, "/api/runs", "POST", { prompt: "Invalid context", contextPaths: [contextPath] });
      assert.ok([400, 403, 404].includes(invalidContext.status));
    }
    const restored = await json(running.base, `/api/runs/${runId}`);
    assert.deepEqual(restored.data.events, completed.events);
    assert.equal(restored.data.projectId, project.id);
    assert.equal(restored.data.snapshot.projectId, project.id);
    assert.equal(restored.data.attachments[0].name, "paper.txt");
    assert.equal((await json(running.base, "/api/profile")).data.profile.displayName, "Test user");
    assert.equal((await json(running.base, "/api/settings")).data.settings.theme, "light");
    assert.equal((await json(running.base, "/api/projects")).data.projects[0].name, "Research lab");
    const followup = await json(running.base, "/api/runs", "POST", { prompt: "Follow up", continueFromRunId: runId });
    assert.equal(followup.status, 202);
    assert.equal(followup.data.rootRunId, runId);
    const wrongProject = await json(running.base, "/api/projects", "POST", { name: "Different" });
    await terminal(running.base, followup.data.runId);
    const switched = await json(running.base, "/api/runs", "POST", { prompt: "Wrong directory", continueFromRunId: followup.data.runId, projectId: wrongProject.data.project.id });
    assert.equal(switched.status, 409);
    await json(running.base, `/api/projects/${project.id}`, "DELETE");
    assert.equal((await json(running.base, "/api/projects")).data.projects.length, 1);
    assert.ok(exists(project.path), "archive preserves workspace files");
  } finally { await stop(running.child); }
});
function exists(path: string): boolean { try { return readdirSync(path).length >= 0; } catch { return false; } }

test("knowledge edits preserve note identity and project ownership across restart", async () => {
  const root = mkdtempSync(join(tmpdir(), "openrigor-knowledge-edit-"));
  const data = join(root, ".openrigor");
  let running = await start(root, data);
  try {
    const project = (await json(running.base, "/api/projects", "POST", { name: "Original study" })).data.project;
    const otherProject = (await json(running.base, "/api/projects", "POST", { name: "Different study" })).data.project;
    const created = await json(running.base, "/api/knowledge", "POST", { name: "Study methods", content: "Original method marker", projectId: project.id });
    assert.equal(created.status, 201);
    const original = created.data.item;
    const edited = await json(running.base, `/api/knowledge/${original.id}`, "PATCH", {
      name: " Revised methods ", content: " Revised evidence marker ", id: "forged-note", projectId: otherProject.id
    });
    assert.equal(edited.status, 200);
    assert.equal(edited.data.item.id, original.id);
    assert.equal(edited.data.item.projectId, project.id);
    assert.equal(edited.data.item.createdAt, original.createdAt);
    assert.equal(edited.data.item.name, "Revised methods");
    assert.equal(edited.data.item.content, "Revised evidence marker");
    const service = new WorkspaceService(new LocalStore(data), root, "demo");
    assert.match(service.context(project.id), /Revised evidence marker/);
    assert.doesNotMatch(service.context(project.id), /Original method marker/);
    assert.doesNotMatch(service.context(otherProject.id), /Revised evidence marker/);

    await stop(running.child);
    running = await start(root, data);
    const notes = await json(running.base, "/api/knowledge");
    assert.equal(notes.status, 200);
    assert.deepEqual(notes.data.knowledge, [edited.data.item]);
    assert.deepEqual((await json(running.base, "/api/workspace")).data.knowledge, [edited.data.item]);
  } finally { await stop(running.child); rmSync(root, { recursive: true, force: true }); }
});

test("archived knowledge stays out of workspace and run context after restart", async () => {
  const root = mkdtempSync(join(tmpdir(), "openrigor-knowledge-archive-"));
  const data = join(root, ".openrigor");
  let running = await start(root, data);
  try {
    const project = (await json(running.base, "/api/projects", "POST", { name: "Study" })).data.project;
    const archived = (await json(running.base, "/api/knowledge", "POST", { name: "Obsolete evidence", content: "Archived evidence marker", projectId: project.id })).data.item;
    const retained = (await json(running.base, "/api/knowledge", "POST", { name: "Current evidence", content: "Retained evidence marker", projectId: project.id })).data.item;
    const removed = await json(running.base, `/api/knowledge/${archived.id}`, "DELETE");
    assert.equal(removed.status, 200);
    assert.equal(removed.data.item.id, archived.id);

    async function assertArchivedKnowledgeExcluded(): Promise<void> {
      assert.deepEqual((await json(running.base, "/api/knowledge")).data.knowledge, [retained]);
      assert.deepEqual((await json(running.base, "/api/workspace")).data.knowledge, [retained]);
      const service = new WorkspaceService(new LocalStore(data), root, "demo");
      const projectContext = service.context(project.id);
      assert.match(projectContext, /Retained evidence marker/);
      assert.doesNotMatch(projectContext, /Archived evidence marker/);
      const selectedContext = service.context(undefined, undefined, [archived.id, retained.id]);
      assert.match(selectedContext, /Retained evidence marker/);
      assert.doesNotMatch(selectedContext, /Archived evidence marker/);
      assert.equal((await json(running.base, `/api/knowledge/${archived.id}`, "PATCH", { content: "Cannot revive archived evidence" })).status, 404);
    }

    await assertArchivedKnowledgeExcluded();
    await stop(running.child);
    running = await start(root, data);
    await assertArchivedKnowledgeExcluded();
    assert.equal((await json(running.base, `/api/knowledge/${archived.id}`, "DELETE")).status, 404);
  } finally { await stop(running.child); rmSync(root, { recursive: true, force: true }); }
});

test("local store recovers a truncated final append and rejects interior corruption", () => {
  const directory = mkdtempSync(join(tmpdir(), "openrigor-journal-"));
  const store = new LocalStore(directory);
  const snapshot = { runId: "run_abc", status: "queued", prompt: "test", model: "auto", mode: "standard", effort: "medium", createdAt: "2026-01-01", updatedAt: "2026-01-01", progress: 0 } as const;
  store.writeRun({ snapshot });
  const event = { protocolVersion: 0, type: "snapshot", eventId: "run_abc:1", runId: "run_abc", sequence: 1, ts: "2026-01-01", snapshot } as const;
  store.appendEvent(event);
  const journal = join(directory, "runs", "run_abc.events.jsonl");
  writeFileSync(journal, `${JSON.stringify(event)}\n{"truncated":`);
  assert.equal(store.loadRuns()[0]?.events.length, 1);
  assert.equal(readFileSync(journal, "utf8"), `${JSON.stringify(event)}\n`);
  writeFileSync(journal, `broken\n${JSON.stringify(event)}\n`);
  assert.throws(() => store.loadRuns());
});

test("file path checks reject hidden credentials and escaping symlinks", () => {
  const root = mkdtempSync(join(tmpdir(), "openrigor-path-"));
  mkdirSync(join(root, "public")); writeFileSync(join(root, "public", "note.md"), "safe");
  symlinkSync(tmpdir(), join(root, "escape"));
  assert.equal(resolvePublicWorkspacePath(root, "public/note.md"), realpathSync(join(root, "public", "note.md")));
  assert.throws(() => resolvePublicWorkspacePath(root, "escape"));
  assert.throws(() => resolvePublicWorkspacePath(root, "../secret"));
  assert.throws(() => resolvePublicWorkspacePath(root, ".env"));
  const service = new WorkspaceService(new LocalStore(join(root, ".state")), root, "demo");
  assert.equal(service.imageConfigured(), false);
});

test("image generation keeps provider credentials server-side, saves originals and supports references", async () => {
  const root = mkdtempSync(join(tmpdir(), "openrigor-image-"));
  const store = new LocalStore(join(root, ".openrigor"));
  const service = new WorkspaceService(store, root, "demo");
  const oldKey = process.env.CIYUANZHIYAN_API_KEY;
  process.env.CIYUANZHIYAN_API_KEY = "test-secret-never-export";
  const originalFetch = globalThis.fetch;
  const providerCalls: { url: string; init?: RequestInit }[] = [];
  const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).startsWith("https://ciyuanzhiyan.com/")) {
      providerCalls.push({ url: String(url), ...(init ? { init } : {}) });
      return new Response(JSON.stringify({ data: [{ b64_json: bytes.toString("base64") }] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return originalFetch(url, init);
  }) as typeof fetch;
  const { createServer } = await import("node:http");
  const server = createServer((req, res) => {
    void service.handle(req, res, new URL(req.url ?? "/", "http://localhost"), () => []).catch((error: Error & { statusCode?: number }) => { res.statusCode = error.statusCode ?? 500; res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ error: error.message })); });
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address() as { port: number };
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const generated = await json(base, "/api/images/generations", "POST", { prompt: "A precise microscope illustration" });
    assert.equal(generated.status, 201);
    assert.equal(generated.data.image.model, "gpt-image-2.5-sunburst");
    assert.equal(providerCalls[0]?.url, "https://ciyuanzhiyan.com/v1/images/generations");
    assert.deepEqual(JSON.parse(String(providerCalls[0]?.init?.body)), { model: "gpt-image-2.5-sunburst", prompt: "A precise microscope illustration", size: "1k", quality: "high" });
    assert.deepEqual(readFileSync(join(root, "output", "imagegen", `${generated.data.image.id}.png`)), bytes);
    assert.ok(!JSON.stringify(generated.data).includes("test-secret"));
    assert.ok(!readFileSync(join(root, ".openrigor", "workspace.json"), "utf8").includes("test-secret"));
    const edited = await json(base, "/api/images/generations", "POST", { prompt: "Change the background to midnight blue", referenceImageId: generated.data.image.id });
    assert.equal(edited.status, 201);
    assert.equal(providerCalls[1]?.url, "https://ciyuanzhiyan.com/v1/images/edits");
    assert.ok(providerCalls[1]?.init?.body instanceof FormData);
    const multipart = providerCalls[1]?.init?.body as FormData;
    assert.equal(multipart.get("prompt"), "Change the background to midnight blue");
    assert.ok(multipart.get("image") instanceof Blob);
    const downloaded = await fetch(`${base}${edited.data.image.url}`);
    assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), bytes);
    assert.equal((await json(base, "/api/images")).data.images.length, 2);
    await json(base, `/api/images/${generated.data.image.id}`, "DELETE");
    assert.equal((await json(base, "/api/images")).data.images.length, 1);
    assert.deepEqual(readFileSync(join(root, "output", "imagegen", `${generated.data.image.id}.png`)), bytes);
    // A rejected upstream response never returns its potentially sensitive body.
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => String(url).startsWith("https://ciyuanzhiyan.com/") ? new Response("test-secret-never-export", { status: 401 }) : originalFetch(url, init)) as typeof fetch;
    const rejected = await json(base, "/api/images/generations", "POST", { prompt: "Provider failure" });
    assert.equal(rejected.status, 502);
    assert.ok(!JSON.stringify(rejected.data).includes("test-secret"));
  } finally {
    globalThis.fetch = originalFetch;
    if (oldKey === undefined) delete process.env.CIYUANZHIYAN_API_KEY; else process.env.CIYUANZHIYAN_API_KEY = oldKey;
    await new Promise<void>((done) => server.close(() => done()));
  }
});


test("interactive request API validates answers, resolves once, and clears pending work on cancel", async () => {
  const root = mkdtempSync(join(tmpdir(), "openrigor-interactive-"));
  const fixture = fileURLToPath(new URL("./fixtures/fake-codex-app-server.mjs", import.meta.url));
  const command = join(root, process.platform === "win32" ? "codex.cmd" : "codex");
  if (process.platform === "win32") writeFileSync(command, `@echo off\r\n"${process.execPath}" "${fixture}" %*\r\n`);
  else { writeFileSync(command, `#!/bin/sh\nexec '${process.execPath.replaceAll("'", "'\\''")}' '${fixture.replaceAll("'", "'\\''")}' "$@"\n`); chmodSync(command, 0o755); }
  const running = await start(root, join(root, ".openrigor"), { OPENRIGOR_EXECUTOR: "codex-app-server", OPENRIGOR_CODEX_BIN: command });
  const pending = async (runId: string): Promise<any> => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const value = await json(running.base, `/api/runs/${runId}/requests`);
      if (value.data.requests[0]) return value.data.requests[0];
      await new Promise((done) => setTimeout(done, 20));
    }
    throw new Error("request never appeared");
  };
  try {
    const first = await json(running.base, "/api/runs", "POST", { prompt: "approval" });
    const runId = first.data.runId;
    const request = await pending(runId);
    assert.equal(request.kind, "approval");
    assert.ok(request.id.startsWith("request_"));
    assert.match(request.description, /node --version/);
    assert.equal((await json(running.base, `/api/runs/${runId}`)).data.snapshot.status, "waiting_user");
    assert.equal((await json(running.base, `/api/runs/${runId}/requests/${request.id}`, "POST", { decision: "acceptForSession" })).status, 400);
    assert.equal((await json(running.base, `/api/runs/${runId}/requests/${request.id}`, "POST", { decision: "accept" })).status, 200);
    assert.equal((await json(running.base, `/api/runs/${runId}/requests/${request.id}`, "POST", { decision: "accept" })).status, 409);
    assert.equal((await terminal(running.base, runId)).snapshot.status, "completed");
    assert.deepEqual((await json(running.base, `/api/runs/${runId}/requests`)).data.requests, []);
    const second = await json(running.base, "/api/runs", "POST", { prompt: "question", continueFromRunId: runId });
    const question = await pending(second.data.runId);
    assert.equal(question.kind, "question");
    assert.equal(question.questions[0].id, "choice");
    assert.equal(question.questions[0].options[0].label, "Markdown");
    await json(running.base, `/api/runs/${second.data.runId}/requests/${question.id}`, "POST", { answers: { choice: ["Markdown"] } });
    const answered = await terminal(running.base, second.data.runId);
    assert.ok(answered.events.some((event) => event.type === "part-delta" && event.delta.includes('"answers":["Markdown"]')));
    const third = await json(running.base, "/api/runs", "POST", { prompt: "approval", continueFromRunId: second.data.runId });
    const cancelledRequest = await pending(third.data.runId);
    await json(running.base, `/api/runs/${third.data.runId}/cancel`, "POST", {});
    assert.equal((await terminal(running.base, third.data.runId)).snapshot.status, "cancelled");
    assert.deepEqual((await json(running.base, `/api/runs/${third.data.runId}/requests`)).data.requests, []);
    assert.equal((await json(running.base, `/api/runs/${third.data.runId}/requests/${cancelledRequest.id}`, "POST", { decision: "accept" })).status, 409);
    const fourth = await json(running.base, "/api/runs", "POST", { prompt: "artifact", continueFromRunId: third.data.runId });
    const delivered = await terminal(running.base, fourth.data.runId);
    const fileEvent = delivered.events.find((event) => event.type === "file");
    assert.ok(fileEvent && fileEvent.type === "file" && fileEvent.file.downloadUrl);
    if (fileEvent?.type === "file" && fileEvent.file.downloadUrl) {
      const download = await fetch(`${running.base}${fileEvent.file.downloadUrl}`);
      assert.equal(download.status, 200);
      assert.match(download.headers.get("content-disposition") ?? "", /attachment/);
      assert.match(download.headers.get("access-control-expose-headers") ?? "", /Content-Disposition/);
      assert.equal(await download.text(), "Verified generated artifact");
    }
  } finally { await stop(running.child); }
});

test("research plans, evidence and shell-generated artifacts are durable, deduplicated and safe to preview", async () => {
  const root = mkdtempSync(join(tmpdir(), "openrigor-research-http-"));
  const data = join(root, ".openrigor");
  const revisionBarrier = join(root, ".research-first-revision-captured");
  mkdirSync(join(root, "artifacts")); writeFileSync(join(root, "artifacts", "old.md"), "Old unrelated output");
  const fixture = fileURLToPath(new URL("./fixtures/fake-codex-app-server.mjs", import.meta.url));
  const command = join(root, process.platform === "win32" ? "codex.cmd" : "codex");
  if (process.platform === "win32") writeFileSync(command, `@echo off\r\n"${process.execPath}" "${fixture}" %*\r\n`);
  else { writeFileSync(command, `#!/bin/sh\nexec '${process.execPath.replaceAll("'", "'\\''")}' '${fixture.replaceAll("'", "'\\''")}' "$@"\n`); chmodSync(command, 0o755); }
  const env = { OPENRIGOR_EXECUTOR: "codex-app-server", OPENRIGOR_CODEX_BIN: command, OPENRIGOR_FAKE_RESEARCH_REVISION_BARRIER: revisionBarrier };
  let running = await start(root, data, env);
  try {
    const accepted = await json(running.base, "/api/runs", "POST", { prompt: "research-fixture", clientRequestId: "research-replay" });
    // The provider must not overwrite a revision before the API has durably captured it.
    let firstRevisionCaptured = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const detail = (await json(running.base, `/api/runs/${accepted.data.runId}`)).data as RunDetail;
      const report = detail.events.find((event) => event.type === "file" && event.file.name === "report.md" && event.file.revision === 1);
      if (report?.type === "file") {
        assert.equal(await (await fetch(`${running.base}${report.file.downloadUrl}`)).text(), "# First revision\n");
        firstRevisionCaptured = true;
        writeFileSync(revisionBarrier, "captured");
        break;
      }
      await new Promise((done) => setTimeout(done, 30));
    }
    assert.ok(firstRevisionCaptured, "the first report revision must be saved before the fixture overwrites it");
    const completed = await terminal(running.base, accepted.data.runId);
    assert.equal(completed.snapshot.status, "completed");
    assert.equal(completed.events.filter((event) => event.type === "plan").length, 2);
    const latestPlan = completed.events.filter((event) => event.type === "plan").at(-1);
    assert.ok(latestPlan?.type === "plan" && latestPlan.steps.every((step) => step.status === "completed"));
    const sources = completed.events.filter((event) => event.type === "source");
    assert.equal(sources.length, 1);
    assert.ok(sources[0]?.type === "source" && sources[0].source.url === "https://example.org/research");
    const files = completed.events.flatMap((event) => event.type === "file" ? [event.file] : []);
    assert.equal(files.length, 7, "five discovered files, one immutable revision, and one explicit link");
    assert.equal(files.filter((file) => file.name === "data.csv").length, 1, "fileChange and scan do not duplicate a file");
    assert.ok(!files.some((file) => ["old.md", "auth.json", "missing.csv"].includes(file.name)));
    const csv = files.find((file) => file.name === "data.csv")!;
    const csvContent = await json(running.base, csv.contentUrl!);
    assert.equal(csvContent.data.mimeType, "text/csv");
    assert.equal(csvContent.data.content, "x,y\n1,2\n");
    assert.equal(csvContent.data.sizeBytes, 8);
    const png = files.find((file) => file.name === "chart.png")!;
    const preview = await fetch(`${running.base}${png.previewUrl}`);
    assert.equal(preview.headers.get("content-type"), "image/png");
    assert.equal(preview.headers.get("x-content-type-options"), "nosniff");
    assert.match(preview.headers.get("content-security-policy") ?? "", /sandbox/);
    const html = files.find((file) => file.name === "page.html")!;
    assert.equal(html.previewUrl, undefined);
    assert.equal((await fetch(`${running.base}${html.downloadUrl!.replace("?", "/preview?")}`)).status, 415);
    assert.equal((await json(running.base, html.contentUrl!)).data.mimeType, "text/html");
    const download = await fetch(`${running.base}${html.downloadUrl}`);
    assert.match(download.headers.get("content-disposition") ?? "", /attachment/);
    assert.equal(download.headers.get("content-type"), "application/octet-stream");
    const firstReport = files.find((file) => file.name === "report.md" && file.revision === 1)!;
    assert.equal(await (await fetch(`${running.base}${firstReport.downloadUrl}`)).text(), "# First revision\n");
    assert.equal((await fetch(`${running.base}${csv.downloadUrl!.replace("revision=1", "revision=999")}`)).status, 404);
    completed.events.forEach((event, index) => assert.equal(event.sequence, index + 1));
    const eventCount = completed.events.length;
    const toolRun = await json(running.base, "/api/runs", "POST", { prompt: "dynamic-plan", continueFromRunId: accepted.data.runId });
    const toolDetail = await terminal(running.base, toolRun.data.runId);
    const actualToolPlan = toolDetail.events.find((event) => event.type === "plan");
    assert.ok(actualToolPlan?.type === "plan" && actualToolPlan.provenance === "tool");
    assert.equal(toolDetail.snapshot.status, "completed");
    assert.ok(toolDetail.events.some((event) => event.type === "part-delta" && event.delta.includes('"success":true')));
    const invalidTool = await json(running.base, "/api/runs", "POST", { prompt: "dynamic-invalid", continueFromRunId: toolRun.data.runId });
    const invalidDetail = await terminal(running.base, invalidTool.data.runId);
    assert.ok(!invalidDetail.events.some((event) => event.type === "plan"));
    assert.ok(invalidDetail.events.some((event) => event.type === "part-delta" && event.delta.includes('"success":false')));
    const cancelled = await json(running.base, "/api/runs", "POST", { prompt: "research-cancel", continueFromRunId: invalidTool.data.runId });
    await json(running.base, `/api/runs/${cancelled.data.runId}/cancel`, "POST", {});
    const cancelledDetail = await terminal(running.base, cancelled.data.runId);
    assert.equal(cancelledDetail.snapshot.status, "cancelled");
    assert.ok(!cancelledDetail.events.some((event) => event.type === "file"));
    await stop(running.child); running = await start(root, data, env);
    const restored = (await json(running.base, `/api/runs/${accepted.data.runId}`)).data;
    assert.equal(restored.events.length, eventCount);
    assert.deepEqual(restored.events, completed.events);
    assert.equal(await (await fetch(`${running.base}${firstReport.downloadUrl}`)).text(), "# First revision\n");
    const replay = await json(running.base, "/api/runs", "POST", { prompt: "research-fixture", clientRequestId: "research-replay" });
    assert.equal(replay.data.runId, accepted.data.runId);
    const lastSequence = completed.events.at(-2)!.sequence;
    const stream = await fetch(`${running.base}/api/runs/${accepted.data.runId}/events`, { headers: { "Last-Event-ID": `${accepted.data.runId}:${lastSequence}` } });
    const reader = stream.body!.getReader();
    let replayText = "";
    while (!replayText.includes("event: run-finished")) {
      const chunk = await reader.read();
      if (chunk.done) break;
      replayText += new TextDecoder().decode(chunk.value);
    }
    await reader.cancel();
    assert.equal((replayText.match(/^event: /gm) ?? []).length, 1);
    assert.match(replayText, /event: run-finished/);
  } finally { await stop(running.child); }
});
