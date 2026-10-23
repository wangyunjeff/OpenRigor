import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, writeFileSync, symlinkSync, mkdirSync, realpathSync, rmSync } from "node:fs";
import { get as httpGet } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { ApiError, readWorkspaceFile, resolvePublicWorkspacePath, workspaceTextContent, workspaceFileMime, canPreviewWorkspaceFile, WORKSPACE_TEXT_LIMIT } from "../src/workspace-files.js";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2QmcAAAAASUVORK5CYII=", "base64");

test("workspace file reads preserve UTF-8 boundaries and reject local symlinks and traversal", () => {
  const root = mkdtempSync(join(tmpdir(), "openrigor-safe-file-"));
  try {
    writeFileSync(join(root, "notes.md"), "a".repeat(WORKSPACE_TEXT_LIMIT - 1) + "汉字");
    writeFileSync(join(root, "invalid.txt"), Buffer.from([0xff, 0xfe]));
    mkdirSync(join(root, "docs"));
    symlinkSync(join(root, "notes.md"), join(root, "alias.md"));
    symlinkSync(join(root, "docs"), join(root, "linked"));
    const content = workspaceTextContent(readWorkspaceFile(root, "notes.md"));
    assert.equal(content.truncated, true); assert.equal(content.content, "a".repeat(WORKSPACE_TEXT_LIMIT - 1));
    assert.equal(content.content.includes("�"), false); assert.equal(content.editable, false);
    for (const path of ["alias.md", "linked", "../secret", "/etc/passwd", "C:/private", ".env", "docs/../notes.md"]) assert.throws(() => resolvePublicWorkspacePath(root, path), (error) => error instanceof ApiError && error.statusCode === 403, path);
    assert.throws(() => workspaceTextContent(readWorkspaceFile(root, "invalid.txt")), (error) => error instanceof ApiError && error.statusCode === 415);
    assert.equal(resolvePublicWorkspacePath(root, ""), realpathSync(root));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("workspace inline previews rely on byte signatures, never executable extensions", () => {
  for (const [name, bytes, expected] of [
    ["renamed.txt", png, "image/png"], ["photo.jpg", Buffer.from([0xff, 0xd8, 0xff, 0xe0]), "image/jpeg"],
    ["motion.gif", Buffer.from("GIF89a"), "image/gif"], ["image.webp", Buffer.from("RIFFxxxxWEBP"), "image/webp"],
    ["document.pdf", Buffer.from("%PDF-1.4\n%%EOF"), "application/pdf"]
  ] as const) { const mime = workspaceFileMime(name, bytes); assert.equal(mime, expected); assert.equal(canPreviewWorkspaceFile(mime), true); }
  for (const [name, value] of [["forged.png", "<script>alert(1)</script>"], ["unsafe.svg", "<svg onload='alert(1)'/>"], ["index.html", "<html>unsafe</html>"]]) assert.equal(canPreviewWorkspaceFile(workspaceFileMime(name!, Buffer.from(value!))), false);
});

test("HTTP metadata, content, guarded previews and web reader retain local Host/Origin protections", async () => {
  const root = mkdtempSync(join(tmpdir(), "openrigor-preview-http-"));
  writeFileSync(join(root, "image.png"), png);
  writeFileSync(join(root, "paper.pdf"), "%PDF-1.4\n%%EOF");
  writeFileSync(join(root, "notes.md"), "# Visible research notes");
  writeFileSync(join(root, "forged.png"), "<html>Not an image</html>");
  writeFileSync(join(root, "unsafe.svg"), "<svg onload='alert(1)'/>");
  writeFileSync(join(root, "index.html"), "<script>alert(1)</script>");
  writeFileSync(join(root, ".env"), "PRIVATE=secret");
  symlinkSync(join(root, "image.png"), join(root, "alias.png"));
  const child = spawn(process.execPath, ["--import", "tsx", fileURLToPath(new URL("../src/server.ts", import.meta.url))], { env: { ...process.env, PORT: "0", OPENRIGOR_EXECUTOR: "demo", OPENRIGOR_CODEX_CWD: root, OPENRIGOR_DATA_DIR: join(root, ".openrigor") }, stdio: ["pipe", "pipe", "pipe"] });
  let output = ""; let errors = "";
  child.stderr.on("data", (chunk: Buffer) => { errors += chunk.toString(); });
  try {
    const base = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`API start timed out: ${errors}`)), 10_000);
      child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString(); const match = output.match(/http:\/\/127\.0\.0\.1:\d+/); if (match) { clearTimeout(timer); resolve(match[0]); } });
      child.once("exit", () => { clearTimeout(timer); reject(new Error(`API exited: ${errors}`)); });
    });
    const get = (path: string) => fetch(base + path);
    const metadataResponse = await get("/api/files/metadata?path=image.png"); assert.equal(metadataResponse.status, 200);
    const metadata = await metadataResponse.json() as any;
    assert.equal(metadata.mimeType, "image/png"); assert.equal(metadata.sizeBytes, png.length); assert.equal(metadata.editable, false); assert.match(metadata.sha256, /^[a-f0-9]{64}$/);
    const preview = await get(metadata.previewUrl); assert.equal(preview.status, 200);
    assert.equal(preview.headers.get("content-type"), "image/png"); assert.equal(preview.headers.get("x-content-type-options"), "nosniff"); assert.match(preview.headers.get("content-security-policy") ?? "", /sandbox; default-src 'none'/); assert.equal(preview.headers.get("cache-control"), "no-store");
    assert.deepEqual(Buffer.from(await preview.arrayBuffer()), png);
    const pdf = await get("/api/files/preview?path=paper.pdf"); assert.equal(pdf.status, 200); assert.equal(pdf.headers.get("content-type"), "application/pdf");
    assert.equal((await get(metadata.contentUrl)).status, 415);
    const text = await (await get("/api/files/content?path=notes.md")).json() as any; assert.equal(text.content, "# Visible research notes"); assert.equal(text.mimeType, "text/markdown"); assert.equal(text.size, text.sizeBytes);
    const download = await get(metadata.downloadUrl); assert.match(download.headers.get("content-disposition") ?? "", /^attachment/); assert.deepEqual(Buffer.from(await download.arrayBuffer()), png);
    for (const path of ["forged.png", "unsafe.svg", "index.html"]) {
      assert.equal((await get(`/api/files/preview?path=${path}`)).status, 415);
      const info = await (await get(`/api/files/metadata?path=${path}`)).json() as any; assert.equal(info.previewUrl, undefined);
    }
    for (const path of [".env", "alias.png", "../outside", "/etc/passwd"]) for (const action of ["metadata", "preview", "content", "download"]) assert.equal((await get(`/api/files/${action}?path=${encodeURIComponent(path)}`)).status, 403, `${action} ${path}`);
    assert.equal((await get("/api/files/metadata?projectId=missing&path=image.png")).status, 404);
    const create = await fetch(`${base}/api/projects`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Scoped files" }) });
    const project = (await create.json() as any).project;
    writeFileSync(join(project.path, "image.png"), Buffer.from("GIF89a"));
    const scoped = await (await get(`/api/files/metadata?projectId=${project.id}&path=image.png`)).json() as any;
    assert.equal(scoped.mimeType, "image/gif"); assert.ok(scoped.previewUrl.includes(`projectId=${project.id}`));
    assert.deepEqual(Buffer.from(await (await get(scoped.previewUrl)).arrayBuffer()), Buffer.from("GIF89a"));
    for (const path of ["/api/files/preview?path=image.png", "/api/web/read?url=https%3A%2F%2Fexample.com"]) {
      assert.equal((await fetch(base + path, { headers: { origin: "https://untrusted.example" } })).status, 403);
      const badHost = await new Promise<number | undefined>((resolve, reject) => { httpGet(base + path, { headers: { host: "evil.example" } }, (response) => { response.resume(); resolve(response.statusCode); }).once("error", reject); });
      assert.equal(badHost, 403);
    }
    const denied = await get("/api/web/read?url=http%3A%2F%2F127.0.0.1%2Fprivate"); assert.equal(denied.status, 403); assert.match((await denied.json() as any).error, /Private|reserved/);
  } finally {
    if (child.exitCode === null && child.signalCode === null) { const done = once(child, "exit"); child.kill("SIGKILL"); await done; }
    rmSync(root, { recursive: true, force: true });
  }
});
