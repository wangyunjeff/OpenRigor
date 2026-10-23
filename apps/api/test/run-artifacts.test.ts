import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { RunArtifactDiscovery, artifactMime, readCapturedArtifact } from "../src/run-artifacts.js";

function fixture(): { root: string; store: string } {
  const root = mkdtempSync(join(tmpdir(), "openrigor-artifacts-"));
  const store = join(root, ".data"); mkdirSync(store);
  mkdirSync(join(root, "artifacts"));
  return { root, store };
}
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

test("discovers only changed bounded output files and preserves immutable revisions", () => {
  const { root, store } = fixture();
  writeFileSync(join(root, "artifacts", "old.csv"), "old,value\n1,2");
  const discovery = new RunArtifactDiscovery(root, store, "run_test");
  assert.deepEqual(discovery.discover(), []);
  writeFileSync(join(root, "artifacts", "analysis.csv"), "x,y\n1,4\n");
  writeFileSync(join(root, "artifacts", "plot.png"), png);
  writeFileSync(join(root, "unrelated.md"), "not in a controlled output directory");
  const artifacts = discovery.discover();
  assert.equal(artifacts.length, 2);
  const csv = artifacts.find((file) => file.name === "analysis.csv")!;
  assert.equal(csv.mimeType, "text/csv");
  assert.ok(csv.contentUrl?.endsWith("/content?revision=1"));
  assert.equal(csv.previewUrl, undefined);
  assert.equal(csv.path, "artifacts/analysis.csv");
  assert.deepEqual(readCapturedArtifact(store, "run_test", csv), Buffer.from("x,y\n1,4\n"));
  assert.equal(csv.sha256, createHash("sha256").update("x,y\n1,4\n").digest("hex"));
  const image = artifacts.find((file) => file.name === "plot.png")!;
  assert.equal(image.mimeType, "image/png");
  assert.ok(image.previewUrl);
  assert.equal(image.contentUrl, undefined);
  assert.deepEqual(discovery.discover(), []);
  assert.equal(discovery.capture("artifacts/analysis.csv"), undefined, "explicit mention does not duplicate an unchanged artifact");
  assert.equal(discovery.capture("./artifacts/analysis.csv"), undefined, "relative aliases share the same validated file identity");
  writeFileSync(join(root, "artifacts", "analysis.csv"), "x,y\n1,5\n2,6\n");
  const revised = discovery.discover()[0]!;
  assert.equal(revised.fileId, csv.fileId);
  assert.equal(revised.revision, 2);
  assert.notEqual(revised.sha256, csv.sha256);
  assert.equal(readCapturedArtifact(store, "run_test", csv).toString(), "x,y\n1,4\n", "original revision survives source-file edits");
  assert.equal(readCapturedArtifact(store, "run_test", revised).toString(), "x,y\n1,5\n2,6\n");
  const explicit = discovery.mentioned("Deliverable: [notes](unrelated.md), [missing](missing.md), [remote](https://example.org/a.pdf)");
  assert.equal(explicit.length, 1);
  assert.equal(explicit[0]?.name, "unrelated.md");
});

test("artifact capture rejects credentials, traversal, symlinks, directories and oversized files", () => {
  const { root, store } = fixture();
  writeFileSync(join(root, ".env"), "SECRET=hidden");
  writeFileSync(join(root, "artifacts", "auth.json"), "secret");
  writeFileSync(join(root, "artifacts", "safe.md"), "safe");
  symlinkSync(join(root, "artifacts", "safe.md"), join(root, "artifacts", "alias.md"));
  symlinkSync(tmpdir(), join(root, "artifacts", "escape"));
  writeFileSync(join(root, "artifacts", "large.csv"), "");
  truncateSync(join(root, "artifacts", "large.csv"), 21 * 1024 * 1024);
  const discovery = new RunArtifactDiscovery(root, store, "run_private");
  for (const path of [".env", "../secret", "artifacts/auth.json", "artifacts/alias.md", "artifacts/escape", "artifacts/large.csv", "artifacts", "/etc/passwd"]) assert.equal(discovery.capture(path), undefined, path);
  assert.deepEqual(discovery.mentioned("[private](.env) `artifacts/alias.md` [outside](/etc/passwd)"), []);
  const safe = discovery.capture("artifacts/safe.md")!;
  const saved = join(store, "artifacts", "run_private", `${safe.fileId}.${safe.revision}`);
  assert.equal(readFileSync(saved, "utf8"), "safe");
  writeFileSync(saved, "tampered");
  assert.throws(() => readCapturedArtifact(store, "run_private", safe), /integrity check/);
});

test("MIME uses verified binary signatures and active markup only receives JSON source previews", () => {
  const { root, store } = fixture();
  const discovery = new RunArtifactDiscovery(root, store, "run_mime");
  assert.equal(artifactMime("fake.png", Buffer.from("<html>unsafe</html>")), "application/octet-stream");
  assert.equal(artifactMime("plot.txt", png), "image/png");
  assert.equal(artifactMime("report.pdf", Buffer.from("%PDF-1.7\n")), "application/pdf");
  for (const [name, content, mime] of [["figure.svg", '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', "image/svg+xml"], ["page.html", "<html><script>alert(1)</script></html>", "text/html"]]) {
    writeFileSync(join(root, "artifacts", name!), content!);
    const file = discovery.capture(`artifacts/${name}`)!;
    assert.equal(file.mimeType, mime);
    assert.ok(file.contentUrl);
    assert.equal(file.previewUrl, undefined);
  }
});
