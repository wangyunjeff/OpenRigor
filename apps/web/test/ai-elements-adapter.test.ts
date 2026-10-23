import assert from "node:assert/strict";
import test from "node:test";
import { annotateSourceLinks, artifactDownloadFilename, artifactLanguage, artifactPreviewKind, extractAnswerReferences, isTerminalTool, linkArtifactMarkdown, parseCsvPreview, resolveArtifactUrl, resolveMarkdownArtifact, runStatusToChatStatus, summarizePlan, toolPhaseToAiState } from "../src/features/chat/ai-elements-adapter";

test("maps OpenRigor runtime states to AI Elements states", () => {
  assert.equal(toolPhaseToAiState("requested"), "input-streaming");
  assert.equal(toolPhaseToAiState("running"), "input-available");
  assert.equal(toolPhaseToAiState("succeeded"), "output-available");
  assert.equal(toolPhaseToAiState("failed"), "output-error");
  assert.equal(toolPhaseToAiState("succeeded", "no-result"), "output-available");
  assert.equal(toolPhaseToAiState("succeeded", "partial"), "output-available");
  assert.equal(toolPhaseToAiState("failed", "no-result"), "output-available");
  assert.equal(toolPhaseToAiState("failed", "partial"), "output-available");
  assert.equal(toolPhaseToAiState("failed", "declined"), "output-denied");
  assert.equal(runStatusToChatStatus("queued"), "submitted");
  assert.equal(runStatusToChatStatus("waiting_tool"), "streaming");
  assert.equal(runStatusToChatStatus("waiting_user"), "streaming");
  assert.equal(runStatusToChatStatus("completed"), "ready");
  assert.equal(runStatusToChatStatus("failed"), "error");
  assert.equal(isTerminalTool("command.execute"), true);
  assert.equal(isTerminalTool("web.search"), false);
});

test("artifact previews use only guarded server-issued URLs and verified media kinds", () => {
  const base = "http://localhost:8787";
  const returned = "/api/runs/run_1/files/file_1/preview?revision=2";
  assert.equal(resolveArtifactUrl(returned, base), `${base}${returned}`);
  assert.equal(resolveArtifactUrl("https://example.com/preview.html", base), undefined);
  assert.equal(resolveArtifactUrl("javascript:alert(1)", base), undefined);
  assert.equal(resolveArtifactUrl("/api/workspace", base), undefined);
  assert.equal(resolveArtifactUrl("http://user:password@localhost:8787/api/runs/run_1/files/file_1", base), undefined);
  assert.equal(artifactPreviewKind({ name: "figure.svg", mimeType: "image/svg+xml" }), "svg");
  assert.equal(artifactPreviewKind({ name: "report.pdf", mimeType: "application/pdf" }), "pdf");
  assert.equal(artifactPreviewKind({ name: "result.html", mimeType: "text/html" }), "code");
  assert.equal(artifactPreviewKind({ name: "fake.png", mimeType: "text/html" }), "code");
  assert.equal(artifactPreviewKind({ name: "fake.pdf", mimeType: "application/octet-stream" }), "download");
  assert.equal(artifactPreviewKind({ name: "report.md", mimeType: "text/plain" }), "markdown");
});

test("immutable artifact downloads retain server-provided UTF-8 filenames", () => {
  assert.equal(artifactDownloadFilename("attachment; filename*=UTF-8''%E7%A0%94%E7%A9%B6-report.md"), "研究-report.md");
  assert.equal(artifactDownloadFilename('attachment; filename="report.csv"'), "report.csv");
  assert.equal(artifactDownloadFilename('attachment; filename="../../report.csv"'), "report.csv");
  assert.equal(artifactDownloadFilename("attachment; filename*=UTF-8''%invalid"), "artifact");
});

test("answer file links follow immutable artifact paths without ambiguous basename matches", () => {
  const url = "/api/runs/run_1/files/file_1?revision=3";
  const files = [{ name: "report.md", path: "artifacts/report.md", downloadUrl: url }];
  assert.equal(linkArtifactMarkdown("[Report](artifacts/report.md)", files, "http://localhost:8787"), `[Report](http://localhost:8787${url})`);
  assert.equal(linkArtifactMarkdown("[Report](sandbox:/workspace/artifacts/report.md)", files, "http://localhost:8787"), `[Report](http://localhost:8787${url})`);
  assert.equal(linkArtifactMarkdown("[Report](report.md)", [...files, { ...files[0]!, path: "other/report.md", downloadUrl: "/api/runs/run_1/files/file_2?revision=1" }], "http://localhost:8787"), "[Report](report.md)");
});

test("Markdown reports resolve sibling images and file links relative to the registered report directory", () => {
  const base = "http://localhost:8787";
  const files = ["report.md", "paired-plot.svg", "paired-data.csv", "analysis.py", "statistics.json"].map((name, index) => ({ name, path: `artifacts/${name}`, downloadUrl: `/api/runs/run_stats/files/file_${index}?revision=3` }));
  const otherImage = { name: "paired-plot.svg", path: "other/paired-plot.svg", downloadUrl: "/api/runs/run_stats/files/other_image?revision=1" };
  const markdown = "![Synthetic paired data](paired-plot.svg)\n[报告](report.md) · [配对数据](paired-data.csv) · [SVG图](paired-plot.svg) · [Python脚本](analysis.py) · [统计JSON](statistics.json)";
  const linked = linkArtifactMarkdown(markdown, [...files, otherImage], base, "artifacts/report.md");
  assert.match(linked, /!\[Synthetic paired data\]\(http:\/\/localhost:8787\/api\/runs\/run_stats\/files\/file_1\?revision=3\)/);
  for (let index = 0; index < files.length; index += 1) assert.ok(linked.includes(`${base}${files[index]!.downloadUrl}`));
  assert.ok(!linked.includes("other_image"));
  assert.equal(resolveMarkdownArtifact("./paired-plot.svg", [...files, otherImage], base, "artifacts/report.md"), files[1]);
  assert.equal(resolveMarkdownArtifact("../other/paired-plot.svg", [...files, otherImage], base, "artifacts/report.md"), otherImage);
  assert.equal(resolveMarkdownArtifact(`${base}${files[1]!.downloadUrl}`, files, base, "artifacts/report.md"), files[1]);
});

test("document-relative artifact lookup rejects unknown paths, ambiguous files and directory escapes", () => {
  const base = "http://localhost:8787";
  const image = { name: "figure.svg", path: "other/figure.svg", downloadUrl: "/api/runs/run_1/files/file_1?revision=1" };
  assert.equal(resolveMarkdownArtifact("figure.svg", [image], base, "artifacts/report.md"), undefined);
  assert.equal(resolveMarkdownArtifact("../../other/figure.svg", [image], base, "artifacts/report.md"), undefined);
  assert.equal(resolveMarkdownArtifact("https://external.example/figure.svg", [image], base, "artifacts/report.md"), undefined);
  assert.equal(resolveMarkdownArtifact("file:///other/figure.svg", [image], base, "artifacts/report.md"), undefined);
  assert.equal(resolveMarkdownArtifact("data:image/svg+xml,svg", [image], base, "artifacts/report.md"), undefined);
  assert.equal(resolveMarkdownArtifact("/api/runs/unknown/files/file_1?revision=1", [image], base), undefined);
  assert.equal(resolveMarkdownArtifact("figure.svg", [image, { ...image, downloadUrl: "/api/runs/run_1/files/file_2?revision=1" }], base, "other/report.md"), undefined);
  const code = "`![literal](figure.svg)`\n```md\n[Example](figure.svg)\n```\n[Other](https://example.com/)";
  assert.equal(linkArtifactMarkdown(code, [image], base, "other/report.md"), code);
  assert.equal(linkArtifactMarkdown('[图](<figure.svg> "Caption")', [image], base, "other/report.md"), `[图](${base}${image.downloadUrl} "Caption")`);
});

test("answer references remain separate from actual search links and ignore code/image URLs", () => {
  const answer = '[Paper](https://example.org/paper#methods) [Extra](https://extra.org/notes) ![image](https://images.org/a.png) `https://code.org/`\n```js\nhttps://code-block.org/\n```\nMore at https://other.org/page.';
  assert.deepEqual(extractAnswerReferences(answer, ["https://example.org/paper"]), [{ url: "https://extra.org/notes", title: "Extra" }, { url: "https://other.org/page", title: "other.org" }]);
  assert.deepEqual(extractAnswerReferences("[unsafe](javascript:alert) [private](https://user:password@example.org/)"), []);
});

test("source hover details are added only to matching real-source links", () => {
  const sources = [{ url: "https://example.org/paper", title: 'Paper "title"', snippet: "Retrieved snippet" }];
  const result = annotateSourceLinks("[Paper](https://example.org/paper#part) [Other](https://other.org/)", sources);
  assert.match(result, /Retrieved snippet/);
  assert.match(result, /\[Other\]\(https:\/\/other.org\/\)/);
  assert.equal(annotateSourceLinks("![image](https://example.org/paper)", sources), "![image](https://example.org/paper)");
});

test("CSV previews preserve quoted delimiters, newlines, escaped quotes and plain script text", () => {
  const csv = '\uFEFFname,notes\r\n"Smith, A","line one\nline two"\r\n"Jones","said ""hello"""\r\nunsafe,<script>alert(1)</script>\r\n';
  const preview = parseCsvPreview(csv);
  assert.deepEqual(preview.headers, ["name", "notes"]);
  assert.deepEqual(preview.rows, [["Smith, A", "line one\nline two"], ["Jones", 'said "hello"'], ["unsafe", "<script>alert(1)</script>"]]);
  assert.equal(preview.truncated, false);
  assert.equal(parseCsvPreview("a,b\n1,2\n3,4\n5,6", ",", 2).truncated, true);
  assert.deepEqual(parseCsvPreview("a\tb\n1\t2", "\t").rows, [["1", "2"]]);
});

test("plan progress reports actual step states without inferring completion from run status", () => {
  assert.deepEqual(summarizePlan([{ step: "Search", status: "completed" }, { step: "Compare", status: "in_progress" }, { step: "Write", status: "pending" }]), { total: 3, completed: 1, percent: 33, current: "Compare" });
  assert.deepEqual(summarizePlan([{ step: "Unfinished", status: "pending" }]), { total: 1, completed: 0, percent: 0 });
  assert.deepEqual(summarizePlan([]), { total: 0, completed: 0, percent: 0 });
});

test("selects a stable renderer for artifacts", () => {
  assert.equal(artifactLanguage("diff:src/app.tsx"), "diff");
  assert.equal(artifactLanguage("report.md"), "markdown");
  assert.equal(artifactLanguage("result.json"), "json");
  assert.equal(artifactLanguage("notes.txt"), "markdown");
});

test("links only verified generated artifacts to their guarded download endpoint", () => {
  const files = [{ name: "/workspace/report.md", downloadUrl: "/api/files/download?path=report.md&projectId=project_1" }];
  const url = "http://localhost:8787/api/files/download?path=report.md&projectId=project_1";
  assert.equal(linkArtifactMarkdown("Created [report](/workspace/report.md).", files, "http://localhost:8787"), `Created [report](${url}).`);
  assert.equal(linkArtifactMarkdown("[report](sandbox:/workspace/report.md)", files, "http://localhost:8787"), `[report](${url})`);
  assert.equal(linkArtifactMarkdown("[report](report.md)", files, "http://localhost:8787"), `[report](${url})`);
  assert.equal(linkArtifactMarkdown("[secret](/etc/passwd) [web](https://example.com)", files, "http://localhost:8787"), "[secret](/etc/passwd) [web](https://example.com)");
  assert.equal(linkArtifactMarkdown("[report](report.md)", [...files, { name: "/other/report.md", downloadUrl: "/api/files/download?path=other/report.md" }], "http://localhost:8787"), "[report](report.md)");
});
