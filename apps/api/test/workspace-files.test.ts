import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { LocalStore } from "../src/local-store.js";
import { ApiError, WorkspaceService } from "../src/workspace.js";
import { WORKSPACE_FILE_LIMIT, WORKSPACE_TEXT_LIMIT } from "../src/workspace-files.js";
import { RunArtifactDiscovery, readCapturedArtifact } from "../src/run-artifacts.js";

const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

async function fixture(t: TestContext, dataName = ".openrigor") {
  const root = mkdtempSync(join(tmpdir(), "openrigor-file-api-"));
  const data = join(root, dataName);
  const workspace = new WorkspaceService(new LocalStore(data), root, "demo");
  const server = createServer((req, res) => {
    void workspace.handle(req, res, new URL(req.url ?? "/", "http://localhost"), () => []).then((handled) => {
      if (!handled) { res.statusCode = 404; res.end(); }
    }).catch((error: unknown) => {
      res.statusCode = error instanceof ApiError ? error.statusCode : 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : "unexpected error" }));
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  t.after(async () => {
    await new Promise<void>((done, reject) => server.close((error) => error ? reject(error) : done()));
    rmSync(root, { recursive: true, force: true });
  });
  const request = (path: string, method = "GET", value?: unknown) => fetch(`${base}${path}`, {
    method, ...(value === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) })
  });
  const json = async (path: string, method = "GET", value?: unknown) => {
    const response = await request(path, method, value);
    return { response, status: response.status, data: await response.json() as Record<string, any> };
  };
  const url = (operation: string, path: string, projectId?: string) => `/api/files/${operation}?${new URLSearchParams({ path, ...(projectId ? { projectId } : {}) })}`;
  const edit = (path: string, content: unknown, expectedSha256: unknown, projectId?: string) => json("/api/files/content", "PUT", { path, content, expectedSha256, ...(projectId ? { projectId } : {}) });
  return { root, data, workspace, request, json, url, edit };
}

test("workspace metadata and text content share canonical paths, hashes and scoped URLs", async (t) => {
  const f = await fixture(t);
  mkdirSync(join(f.root, "docs"));
  const path = "docs/研究 notes.md";
  const original = "\uFEFF# Research\n\n  中文 notes\t\n";
  writeFileSync(join(f.root, path), original);
  const meta = await f.json(f.url("meta", path));
  assert.equal(meta.status, 200);
  assert.equal(meta.data.name, "研究 notes.md");
  assert.equal(meta.data.path, path);
  assert.equal(meta.data.mimeType, "text/markdown");
  assert.equal(meta.data.sizeBytes, Buffer.byteLength(original));
  assert.equal(meta.data.sha256, hash(original));
  assert.equal(meta.data.editable, true);
  assert.equal(meta.data.previewUrl, undefined);
  assert.equal(new URL(meta.data.contentUrl, "http://localhost").searchParams.get("path"), path);
  const content = await f.json(meta.data.contentUrl);
  assert.equal(content.data.content, original);
  assert.equal(content.data.size, meta.data.sizeBytes);
  assert.equal(content.data.sha256, meta.data.sha256);
  assert.equal(content.data.truncated, false);
  assert.equal(content.response.headers.get("cache-control"), "no-store");
  assert.deepEqual((await f.json(f.url("metadata", path))).data, meta.data);
  const download = await f.request(meta.data.downloadUrl);
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), Buffer.from(original));
  assert.match(download.headers.get("content-disposition") ?? "", /^attachment;/);
});

test("only signature-verified images and PDF receive sandboxed inline responses", async (t) => {
  const f = await fixture(t);
  const media: [string, Buffer, string][] = [
    ["image.txt", png, "image/png"],
    ["report.pdf", Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF"), "application/pdf"],
    ["photo.jpg", Buffer.from([0xff, 0xd8, 0xff, 0xe0]), "image/jpeg"],
    ["picture.gif", Buffer.from("GIF89a\x01\0\x01\0"), "image/gif"],
    ["picture.webp", Buffer.from("RIFF\0\0\0\0WEBP"), "image/webp"]
  ];
  for (const [name, bytes, mime] of media) {
    writeFileSync(join(f.root, name), bytes);
    const meta = await f.json(f.url("meta", name));
    assert.equal(meta.data.mimeType, mime);
    assert.equal(meta.data.editable, false);
    assert.ok(meta.data.previewUrl);
    const preview = await f.request(meta.data.previewUrl);
    assert.equal(preview.status, 200);
    assert.equal(preview.headers.get("content-type"), mime);
    assert.equal(preview.headers.get("x-content-type-options"), "nosniff");
    assert.match(preview.headers.get("content-security-policy") ?? "", /sandbox; default-src 'none'/);
    assert.match(preview.headers.get("content-disposition") ?? "", /^inline;/);
    assert.deepEqual(Buffer.from(await preview.arrayBuffer()), bytes);
    assert.equal((await f.json(f.url("content", name))).status, 415);
    assert.equal((await f.edit(name, "replace", meta.data.sha256)).status, 415);
  }
  const markup = '<html><script>fetch("/api/projects",{method:"DELETE"})</script></html>';
  for (const name of ["unsafe.html", "fake.png", "fake.pdf", "vector.svg"]) {
    writeFileSync(join(f.root, name), markup);
    const meta = await f.json(f.url("meta", name));
    assert.equal(meta.data.previewUrl, undefined, name);
    assert.equal((await f.json(f.url("preview", name))).status, 415, name);
    const source = await f.json(meta.data.contentUrl);
    assert.match(source.response.headers.get("content-type") ?? "", /^application\/json/);
    assert.equal(source.data.content, markup);
    const download = await f.request(meta.data.downloadUrl);
    assert.equal(download.headers.get("content-type"), "application/octet-stream");
    assert.match(download.headers.get("content-disposition") ?? "", /^attachment;/);
    assert.equal(await download.text(), markup);
  }
});

test("saving preserves exact UTF-8 content and permissions, then reads the saved revision", async (t) => {
  const f = await fixture(t);
  const target = join(f.root, "notes.md");
  writeFileSync(target, "before\n");
  chmodSync(target, 0o640);
  const original = (await f.json(f.url("content", "notes.md"))).data;
  const content = "\n  # 修改后的内容\r\n\tretained spacing  \n";
  const saved = await f.edit("notes.md", content, original.sha256);
  assert.equal(saved.status, 200);
  assert.equal(saved.data.content, content);
  assert.equal(saved.data.sha256, hash(content));
  assert.notEqual(saved.data.sha256, original.sha256);
  assert.equal(readFileSync(target, "utf8"), content);
  assert.equal(statSync(target).mode & 0o777, 0o640);
  assert.deepEqual((await f.json(f.url("content", "notes.md"))).data, saved.data);
  assert.equal(readdirSync(f.root).some((name) => name.startsWith(".openrigor-edit-")), false);
  const emptied = await f.edit("notes.md", "", saved.data.sha256);
  assert.equal(emptied.status, 200);
  assert.equal(emptied.data.content, "");
});

test("stale saves and simultaneous editors cannot overwrite a newer revision", async (t) => {
  const f = await fixture(t);
  const target = join(f.root, "notes.md");
  writeFileSync(target, "initial");
  const oldHash = hash("initial");
  const results = await Promise.all([f.edit("notes.md", "editor one", oldHash), f.edit("notes.md", "editor two", oldHash)]);
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
  const winner = results.find((result) => result.status === 200)!;
  assert.equal(readFileSync(target, "utf8"), winner.data.content);
  writeFileSync(target, "external update");
  assert.equal((await f.edit("notes.md", "stale editor", winner.data.sha256)).status, 409);
  assert.equal(readFileSync(target, "utf8"), "external update");
  assert.equal(readdirSync(f.root).some((name) => name.startsWith(".openrigor-edit-")), false);
});

test("editing is bounded by UTF-8 bytes and refuses binary, malformed, missing and oversized inputs", async (t) => {
  const f = await fixture(t);
  writeFileSync(join(f.root, "notes.txt"), "original");
  const oldHash = hash("original");
  for (const content of ["\0", "\u0001", "\ud800", "%PDF-1.7\n"]) assert.equal((await f.edit("notes.txt", content, oldHash)).status, 415);
  for (const content of ["x".repeat(WORKSPACE_TEXT_LIMIT + 1), "中".repeat(Math.floor(WORKSPACE_TEXT_LIMIT / 3) + 1)]) assert.equal((await f.edit("notes.txt", content, oldHash)).status, 413);
  assert.equal((await f.edit("notes.txt", "ok", "wrong")).status, 400);
  assert.equal((await f.edit("notes.txt", 3, oldHash)).status, 400);
  assert.equal((await f.edit("missing.txt", "new", oldHash)).status, 404);
  assert.equal((await f.json("/api/files/content", "PUT", { path: 3, content: "ok", expectedSha256: oldHash })).status, 400);
  assert.equal((await f.json("/api/files/content", "PUT", { path: "notes.txt", content: "ok", expectedSha256: oldHash, projectId: 3 })).status, 400);
  assert.equal(readFileSync(join(f.root, "notes.txt"), "utf8"), "original");
  const boundary = "\n".repeat(WORKSPACE_TEXT_LIMIT);
  assert.equal((await f.edit("notes.txt", boundary, oldHash)).status, 200, "JSON escaping does not reduce the file byte limit");
  for (const [name, bytes] of [["invalid.txt", Buffer.from([0xc3, 0x28])], ["binary.txt", Buffer.concat([Buffer.alloc(9000, 65), Buffer.from([0])])]] as const) {
    writeFileSync(join(f.root, name), bytes);
    assert.equal((await f.json(f.url("content", name))).status, 415);
    assert.equal((await f.edit(name, "replacement", hash(bytes))).status, 415);
  }
  const longText = "x".repeat(WORKSPACE_TEXT_LIMIT - 1) + "中文";
  writeFileSync(join(f.root, "large.txt"), longText);
  const large = await f.json(f.url("content", "large.txt"));
  assert.equal(large.data.truncated, true);
  assert.equal(large.data.editable, false);
  assert.equal(large.data.content.endsWith("\uFFFD"), false, "truncation preserves UTF-8 character boundaries");
  assert.equal((await f.edit("large.txt", "shortened", hash(longText))).status, 413);
  writeFileSync(join(f.root, "huge.txt"), "");
  truncateSync(join(f.root, "huge.txt"), WORKSPACE_FILE_LIMIT + 1);
  assert.equal((await f.json(f.url("meta", "huge.txt"))).status, 413);
});

test("all file routes reject hidden, credential, traversal and symlink paths without modifying targets", async (t) => {
  const f = await fixture(t);
  mkdirSync(join(f.root, "docs"));
  writeFileSync(join(f.root, "docs", "safe.txt"), "safe");
  writeFileSync(join(f.root, ".env"), "private");
  for (const name of ["auth.json", "credentials.json", "id_rsa", "private_key.txt", "certificate.pfx"]) writeFileSync(join(f.root, name), "private");
  symlinkSync(join(f.root, "docs", "safe.txt"), join(f.root, "link.txt"));
  symlinkSync(join(f.root, "docs"), join(f.root, "linked-dir"));
  symlinkSync(tmpdir(), join(f.root, "outside"));
  const paths = ["../outside", join(f.root, "docs", "safe.txt"), "C:/Windows/file", "docs\\safe.txt", "x\0y", ".env", "auth.json", "credentials.json", "id_rsa", "private_key.txt", "certificate.pfx", ".openrigor/workspace.json", "link.txt", "linked-dir/safe.txt", "outside/file", "docs/../docs/safe.txt"];
  for (const path of paths) {
    for (const route of ["meta", "content", "preview", "download"]) assert.equal((await f.request(f.url(route, path))).status, 403, `${route}: ${path}`);
    assert.equal((await f.edit(path, "overwrite", hash("safe"))).status, 403, `PUT: ${path}`);
  }
  assert.equal(readFileSync(join(f.root, "docs", "safe.txt"), "utf8"), "safe");
  assert.equal(readFileSync(join(f.root, ".env"), "utf8"), "private");
  assert.deepEqual((await f.json("/api/files")).data.files.map((file: { name: string }) => file.name), ["docs"]);
  assert.equal((await f.json(f.url("content", "docs"))).status, 400);
});

test("project-relative files remain isolated and unknown projects never fall back to the workspace", async (t) => {
  const f = await fixture(t);
  const first = (await f.json("/api/projects", "POST", { name: "First" })).data.project;
  const second = (await f.json("/api/projects", "POST", { name: "Second" })).data.project;
  writeFileSync(join(first.path, "notes.md"), "first");
  writeFileSync(join(second.path, "notes.md"), "second");
  writeFileSync(join(f.root, "notes.md"), "workspace");
  const meta = (await f.json(f.url("meta", "notes.md", first.id))).data;
  assert.equal(new URL(meta.contentUrl, "http://localhost").searchParams.get("projectId"), first.id);
  assert.equal((await f.json(meta.contentUrl)).data.content, "first");
  assert.equal((await f.edit("notes.md", "first edit", meta.sha256, first.id)).status, 200);
  assert.equal(readFileSync(join(second.path, "notes.md"), "utf8"), "second");
  assert.equal(readFileSync(join(f.root, "notes.md"), "utf8"), "workspace");
  assert.equal((await f.edit("notes.md", "cross-project", meta.sha256, second.id)).status, 409);
  for (const path of [`../${second.id}/notes.md`, join(second.path, "notes.md")]) {
    assert.equal((await f.json(f.url("meta", path, first.id))).status, 403);
    assert.equal((await f.edit(path, "escape", hash("second"), first.id)).status, 403);
  }
  assert.equal((await f.json(f.url("meta", "notes.md", "missing"))).status, 404);
  assert.equal((await f.edit("notes.md", "missing", hash("workspace"), "missing")).status, 404);
});

test("workspace edits do not mutate immutable captured run artifacts", async (t) => {
  const f = await fixture(t, "state");
  mkdirSync(join(f.root, "artifacts"));
  const discovery = new RunArtifactDiscovery(f.root, f.data, "run_workspaceedit");
  writeFileSync(join(f.root, "artifacts", "report.md"), "captured original");
  const artifact = discovery.discover()[0]!;
  assert.ok(artifact);
  assert.equal((await f.edit("artifacts/report.md", "working file edit", hash("captured original"))).status, 200);
  assert.equal(readCapturedArtifact(f.data, "run_workspaceedit", artifact).toString(), "captured original");
  const capturedPath = `state/artifacts/run_workspaceedit/${artifact.fileId}.${artifact.revision}`;
  assert.equal((await f.edit(capturedPath, "mutate snapshot", artifact.sha256)).status, 403);
  assert.equal((await f.json(f.url("content", capturedPath))).status, 403, "a custom visible store directory cannot bypass the artifact API");
  assert.equal((await f.json("/api/files?path=state/artifacts")).status, 403);
  assert.equal(readCapturedArtifact(f.data, "run_workspaceedit", artifact).toString(), "captured original");
});
