import assert from "node:assert/strict";
import test from "node:test";
import { latestPreviewFiles, previewFileKey, resolvePreviewFileLink, type PreviewFile } from "../src/features/preview/file-preview-model";

const artifact = (fileId: string, revision: number, runId = "run_a"): PreviewFile => ({
  origin: "artifact", fileId, runId, revision, name: "report.md", path: "reports/report.md", mimeType: "text/markdown",
  downloadUrl: `/api/runs/${encodeURIComponent(runId)}/files/${encodeURIComponent(fileId)}?revision=${revision}`,
  contentUrl: `/api/runs/${encodeURIComponent(runId)}/files/${encodeURIComponent(fileId)}/content?revision=${revision}`,
  previewUrl: `/api/runs/${encodeURIComponent(runId)}/files/${encodeURIComponent(fileId)}/preview?revision=${revision}`
});
const workspace = (path = "reports/report.md", projectId = "project_a", sha256 = "old-hash"): PreviewFile => {
  const query = new URLSearchParams({ path, projectId });
  return {
    origin: "workspace", fileId: path, revision: 1, path, projectId, sha256, name: path.split("/").at(-1)!, mimeType: "text/markdown",
    downloadUrl: `/api/files/download?${query}`, contentUrl: `/api/files/content?${query}`
  };
};

test("library chooses the highest artifact revision despite out-of-order delivery and retains first appearance order", () => {
  const report3 = artifact("report", 3), report1 = artifact("report", 1), report5 = artifact("report", 5);
  const figure1 = artifact("figure", 1), figure4 = artifact("figure", 4);
  assert.deepEqual(latestPreviewFiles([report3, figure1, report1, report5, figure4, report3]), [report5, figure4]);
});

test("same names and paths never merge different runs, file identities, projects or origins", () => {
  const files = [artifact("report", 1), artifact("report", 2, "run_b"), artifact("another-file-id", 3), workspace(), workspace("reports/report.md", "project_b")];
  assert.deepEqual(latestPreviewFiles(files), files);
});

test("artifact library infers missing run identity from download, content or preview routes", () => {
  const first = artifact("report", 1, "run space");
  const { runId: _downloadRun, ...downloadOnly } = artifact("report", 2, "run space");
  const { runId: _contentRun, downloadUrl: _download, previewUrl: _preview, ...contentOnly } = artifact("report", 3, "run space");
  const { runId: _previewRun, downloadUrl: _otherDownload, contentUrl: _content, ...previewOnly } = artifact("report", 4, "run space");
  const otherRun = artifact("report", 5, "another run");
  assert.deepEqual(latestPreviewFiles([first, otherRun, downloadOnly, contentOnly, previewOnly]), [previewOnly, otherRun]);
});

test("workspace library keeps the last descriptor for its project and path regardless of hash or revision", () => {
  const first = { ...workspace(), revision: 20 };
  const otherProject = workspace("reports/report.md", "project_b");
  const changed = workspace("reports/report.md", "project_a", "new-hash");
  const { sha256: _hash, ...last } = { ...workspace(), mimeType: "text/plain", contentUrl: "/api/files/content?path=reports%2Freport.md&projectId=project_a" };
  assert.deepEqual(latestPreviewFiles([first, otherProject, changed, last]), [last, otherProject]);
  assert.notEqual(previewFileKey(first), previewFileKey(changed), "Exact descriptors remain distinct outside the library projection");
});

test("workspace path identity preserves same-basename files and projectless workspace scope", () => {
  const root = workspace("report.md"), nested = workspace("reports/report.md");
  const { projectId: _projectId, ...projectless } = workspace("report.md");
  const { path: _path, ...nameOnly } = workspace("report.md");
  assert.deepEqual(latestPreviewFiles([root, nested, projectless, nameOnly]), [nameOnly, nested, projectless]);
});

test("library projection does not mutate descriptors or remove historic exact-link targets", () => {
  const old = Object.freeze(artifact("report", 1));
  const latest = Object.freeze(artifact("report", 2));
  const files = Object.freeze([old, latest]);
  const result = latestPreviewFiles(files);
  assert.deepEqual(result, [latest]);
  assert.notEqual(result, files);
  assert.equal(files.length, 2);
  assert.equal(result[0], latest, "Selected descriptors retain their original identity");
  assert.equal(resolvePreviewFileLink(old.downloadUrl!, old, [...files], "http://localhost:8787"), old);
  assert.equal(resolvePreviewFileLink(latest.downloadUrl!, old, [...files], "http://localhost:8787"), latest);
});

test("empty libraries return a fresh empty result", () => {
  const input = Object.freeze([]);
  const first = latestPreviewFiles(input);
  assert.deepEqual(first, []);
  assert.notEqual(first, input);
  assert.notEqual(first, latestPreviewFiles(input));
});
