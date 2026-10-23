import assert from "node:assert/strict";
import test, { after } from "node:test";
import { JSDOM } from "jsdom";
import type { WindowLike } from "dompurify";
import { linkPreviewMarkdown, previewFileKey, previewFileUrl, previewMarkdownFence, resolvePreviewFileLink, resolveWorkspacePreviewLink, safeWorkspacePreviewPath, staticHtmlPreviewDocument, workspaceRelativePreviewPath, type PreviewFile } from "../src/features/preview/file-preview-model";

const previewDom = new JSDOM("<!doctype html><html></html>");
after(() => previewDom.window.close());
const sanitizePreview = (source: string): Document => new previewDom.window.DOMParser().parseFromString(
  staticHtmlPreviewDocument(source, previewDom.window as unknown as WindowLike), "text/html"
);

const base = "http://localhost:8787";
const artifact = (name: string, runId = "run_1", revision = 2): PreviewFile => ({
  origin: "artifact", fileId: name, runId, name, path: `reports/${name}`, mimeType: "text/plain", revision,
  downloadUrl: `/api/runs/${runId}/files/${name}?revision=${revision}`,
  contentUrl: `/api/runs/${runId}/files/${name}/content?revision=${revision}`
});
const workspace = (path: string, projectId?: string): PreviewFile => {
  const query = new URLSearchParams({ path, ...(projectId ? { projectId } : {}) });
  return { origin: "workspace", fileId: path, name: path.split("/").at(-1)!, path, mimeType: "text/plain", revision: 1, ...(projectId ? { projectId } : {}), downloadUrl: `/api/files/download?${query}`, contentUrl: `/api/files/content?${query}`, previewUrl: `/api/files/preview?${query}` };
};

test("Markdown fences preserve nested backtick runs and handle large valid preview contents", () => {
  assert.equal(previewMarkdownFence("flowchart LR\nA --> B"), "```");
  assert.equal(previewMarkdownFence("one `tick`, then ````nested````"), "`````");
  const manyRuns = "` ".repeat(130_000);
  assert.ok(Buffer.byteLength(manyRuns) < 256 * 1024);
  assert.equal(previewMarkdownFence(manyRuns), "```", "a bounded file must not overflow the function argument limit");
  const longestRun = "`".repeat(256 * 1024);
  assert.equal(previewMarkdownFence(longestRun).length, longestRun.length + 1);
});

test("preview identities separate run revisions and workspace projects", () => {
  assert.notEqual(previewFileKey(artifact("report.md")), previewFileKey(artifact("report.md", "run_2")));
  assert.notEqual(previewFileKey(artifact("report.md")), previewFileKey(artifact("report.md", "run_1", 3)));
  assert.notEqual(previewFileKey(workspace("report.md", "project_a")), previewFileKey(workspace("report.md", "project_b")));
  assert.notEqual(previewFileKey(workspace("report.md")), previewFileKey({ ...workspace("report.md"), sha256: "new-version" }));
  const withRun = artifact("report.md");
  const { runId: _runId, ...withoutRun } = withRun;
  assert.equal(previewFileKey(withRun), previewFileKey(withoutRun));
});

test("artifact endpoints must match file, run, revision and requested purpose", () => {
  const file = artifact("report.md");
  assert.equal(previewFileUrl(file, "content", base), `${base}${file.contentUrl}`);
  for (const contentUrl of [
    "https://remote.example/api/runs/run_1/files/report.md/content?revision=2",
    "http://name:secret@localhost:8787/api/runs/run_1/files/report.md/content?revision=2",
    "/api/runs/run_2/files/report.md/content?revision=2",
    "/api/runs/run_1/files/other/content?revision=2",
    "/api/runs/run_1/files/report.md?revision=2",
    "/api/runs/run_1/files/report.md/content?revision=3",
    "/api/runs/run_1/files/report.md/content?revision=2&revision=3",
    "/api/runs/run_1/files/report.md/content?revision=2&token=secret",
    "/api/files/content?path=report.md"
  ]) assert.equal(previewFileUrl({ ...file, contentUrl }, "content", base), undefined, contentUrl);
  const { runId: _runId, ...inferred } = file;
  assert.equal(previewFileUrl({ ...inferred, contentUrl: "/api/runs/run_2/files/report.md/content?revision=2" }, "content", base), undefined);
});

test("workspace endpoints remain scoped to the exact public path and project", () => {
  const file = workspace("reports/report.md", "project_a");
  assert.equal(previewFileUrl(file, "content", base), `${base}${file.contentUrl}`);
  assert.equal(previewFileUrl(file, "preview", base), `${base}${file.previewUrl}`);
  for (const contentUrl of [
    "/api/files/content?path=reports/report.md&projectId=project_b",
    "/api/files/content?path=reports/other.md&projectId=project_a",
    "/api/files/content?path=reports/report.md&projectId=project_a&projectId=project_b",
    "/api/files/content?path=reports/report.md&path=.env&projectId=project_a",
    "/api/files/download?path=reports/report.md&projectId=project_a",
    "/api/files/content?path=reports/report.md&projectId=project_a&extra=true",
    "https://remote.example/api/files/content?path=reports/report.md&projectId=project_a"
  ]) assert.equal(previewFileUrl({ ...file, contentUrl }, "content", base), undefined, contentUrl);
  assert.equal(previewFileUrl({ ...file, path: "reports/.env", contentUrl: "/api/files/content?path=reports/.env&projectId=project_a" }, "content", base), undefined);
});

test("document links remain in their run and relative links choose the latest revision", () => {
  const report = artifact("report.md"), image = artifact("figure.svg"), otherRun = artifact("figure.svg", "run_2");
  assert.equal(resolvePreviewFileLink("figure.svg", report, [report, image, otherRun], base), image);
  assert.equal(resolvePreviewFileLink(otherRun.downloadUrl!, report, [report, image, otherRun], base), undefined);
  const newer = artifact("figure.svg", "run_1", 3);
  assert.equal(resolvePreviewFileLink("figure.svg", report, [report, newer, image], base), newer);
  assert.equal(resolvePreviewFileLink("../../figure.svg", report, [report, image], base), undefined);
});

test("explicit file URLs preserve historic revisions while relative links follow the newest file", () => {
  const report = artifact("report.md"), older = artifact("figure.svg", "run_1", 2), newer = artifact("figure.svg", "run_1", 3);
  const files = [report, newer, older];
  assert.equal(resolvePreviewFileLink(older.downloadUrl!, report, files, base), older);
  assert.equal(resolvePreviewFileLink(older.contentUrl!, report, files, base), older);
  assert.equal(resolvePreviewFileLink(newer.downloadUrl!, report, files, base), newer);
  assert.equal(resolvePreviewFileLink("figure.svg", report, files, base), newer);
  assert.equal(resolvePreviewFileLink("/api/runs/run_1/files/figure.svg?revision=1", report, files, base), undefined);
  assert.equal(resolvePreviewFileLink("/api/runs/run_1/files/figure.svg?revision=2&revision=3", report, files, base), undefined);
});

test("opening a file tab does not make registered links ambiguous", () => {
  const report = artifact("report.md"), image = artifact("figure.svg");
  const { runId: _reportRun, ...openReport } = report;
  const { runId: _imageRun, ...openImage } = image;
  const available = [report, image, openReport, openImage, openReport];
  assert.equal(resolvePreviewFileLink("report.md", openReport, available, base)?.fileId, report.fileId);
  assert.equal(resolvePreviewFileLink("figure.svg", openReport, available, base)?.fileId, image.fileId);
  assert.equal(resolvePreviewFileLink(image.downloadUrl!, openReport, available, base)?.revision, image.revision);
});

test("workspace document links only open known siblings in the same project", () => {
  const report = workspace("reports/report.md", "project_a"), csv = workspace("reports/data.csv", "project_a"), other = workspace("reports/data.csv", "project_b");
  assert.equal(resolvePreviewFileLink("./data.csv", report, [report, csv, other], base), csv);
  assert.equal(resolvePreviewFileLink(csv.downloadUrl!, report, [report, csv, other], base), csv);
  assert.equal(resolvePreviewFileLink(other.downloadUrl!, report, [report, csv, other], base), undefined);
  for (const href of ["../reports/data.csv", "%2e%2e/reports/data.csv", "/reports/data.csv", "https://remote.example/data.csv", "file:///reports/data.csv", "data:text/plain,hello", ".env", "#chapter", "unregistered.csv"]) {
    assert.equal(resolvePreviewFileLink(href, report, [report, csv, other], base), undefined, href);
  }
});

test("workspace path validation rejects hidden, traversal and control characters", () => {
  assert.equal(safeWorkspacePreviewPath("reports/研究报告.md"), "reports/研究报告.md");
  for (const path of ["", "/absolute", "../secret", "reports/../secret", "reports/.secret", "reports//file", "C:/secret", "reports\\file", "reports/evil\nfile", "reports/evil\0file"]) assert.equal(safeWorkspacePreviewPath(path), undefined, path);
});

test("unregistered workspace references are confined to a safe document-relative path", () => {
  assert.equal(workspaceRelativePreviewPath("./figure.svg", "reports/report.md"), "reports/figure.svg");
  assert.equal(workspaceRelativePreviewPath("./figures/plot%20one.png#image", "reports/report.md"), "reports/figures/plot one.png");
  assert.equal(workspaceRelativePreviewPath("data.csv?download=true", "report.md"), "data.csv");
  for (const path of ["", "#figure", "../figure.svg", "./../figure.svg", "%2e%2e/figure.svg", "%2fetc/passwd", ".env", "figures/.secret", "/absolute/file.png", "//remote.example/image.png", "https://remote.example/image.png", "data:image/png;base64,AAAA", "file:///tmp/image.png", "C:/image.png", "figure%00.png", "figure%5cname.png"]) {
    assert.equal(workspaceRelativePreviewPath(path, "reports/report.md"), undefined, path);
  }
});

test("workspace link fallback resolves safe relative paths and absolute scoped download routes", () => {
  const report = workspace("reports/report.md", "project_a");
  assert.equal(resolveWorkspacePreviewLink("./measurements.csv", report, base), "reports/measurements.csv");
  assert.equal(resolveWorkspacePreviewLink("./figures/plot%20one.svg#figure", report, base), "reports/figures/plot one.svg");
  assert.equal(resolveWorkspacePreviewLink(`${base}/api/files/download?path=reports%2Fdiagram.svg&projectId=project_a#figure`, report, base), "reports/diagram.svg");
  assert.equal(resolveWorkspacePreviewLink(`${base}/api/files/download?projectId=project_a&path=reports%2F研究报告.md`, report, base), "reports/研究报告.md");
  assert.equal(resolveWorkspacePreviewLink(`${base}/api/files/download?path=reports%2Fdata.csv`, workspace("reports/report.md"), base), "reports/data.csv");
  assert.equal(resolveWorkspacePreviewLink("./measurements.csv", artifact("report.md"), base), undefined);
  assert.equal(resolveWorkspacePreviewLink(`${base}/api/files/download?path=reports%2Fdata.csv&projectId=project_a`, artifact("report.md"), base), undefined);
});

test("workspace link fallback rejects foreign origins, project changes, route aliases and unexpected parameters", () => {
  const report = workspace("reports/report.md", "project_a");
  const query = "path=reports%2Fdiagram.svg&projectId=project_a";
  for (const destination of [
    `https://remote.example/api/files/download?${query}`,
    `http://localhost:8788/api/files/download?${query}`,
    `http://name:secret@localhost:8787/api/files/download?${query}`,
    `${base}/api/files/download?path=reports%2Fdiagram.svg&projectId=project_b`,
    `${base}/api/files/download?path=reports%2Fdiagram.svg`,
    `${base}/api/files/download?${query}&projectId=project_a`,
    `${base}/api/files/download?${query}&path=reports%2Fdiagram.svg`,
    `${base}/api/files/download?${query}&token=secret`,
    `${base}/api/files/content?${query}`,
    `${base}/api/files/preview?${query}`,
    `${base}/api/files/download/?${query}`,
    `${base}/ignored/../api/files/download?${query}`,
    `${base}/api/files/%64ownload?${query}`,
    `${base}/api\\files/download?${query}`,
    `${base}/api/files/down\nload?${query}`,
    ` ${base}/api/files/download?${query}`,
    `/api/files/download?${query}`,
    `//localhost:8787/api/files/download?${query}`
  ]) assert.equal(resolveWorkspacePreviewLink(destination, report, base), undefined, destination);
  assert.equal(resolveWorkspacePreviewLink(`${base}/api/files/download?${query}`, workspace("reports/report.md"), base), undefined);
});

test("workspace link fallback rejects hidden, traversal and invalid paths after URL decoding", () => {
  const report = workspace("reports/report.md", "project_a");
  for (const path of ["", ".env", "reports/.secret", "../secret", "reports/../secret", "/absolute", "reports//file", "reports\\file", "reports/evil\nfile", "reports/evil\0file"]) {
    const query = new URLSearchParams({ path, projectId: "project_a" });
    assert.equal(resolveWorkspacePreviewLink(`${base}/api/files/download?${query}`, report, base), undefined, path);
  }
  for (const destination of ["../diagram.svg", "./../diagram.svg", "%2e%2e/diagram.svg", "./.env", "figures/%2esecret", "%2fetc/passwd", "data:image/png;base64,AAAA"]) {
    assert.equal(resolveWorkspacePreviewLink(destination, report, base), undefined, destination);
  }
});

test("Markdown rewriting preserves code and only rewrites registered links in this scope", () => {
  const report = artifact("report.md"), image = artifact("figure.svg");
  const content = '[Figure](sandbox:/workspace/reports/figure.svg) ![Figure](figure.svg) `![literal](figure.svg)`\n```md\n[Example](figure.svg)\n```\n[Web](https://example.com)';
  const linked = linkPreviewMarkdown(content, report, [report, image], base);
  assert.ok(linked.startsWith(`[Figure](${base}${image.downloadUrl}) ![Figure](${base}${image.downloadUrl})`));
  assert.ok(linked.includes('`![literal](figure.svg)`'));
  assert.ok(linked.includes('```md\n[Example](figure.svg)\n```'));
  assert.ok(linked.endsWith('[Web](https://example.com)'));
});

test("workspace Markdown rewrites unregistered links and images before URL sanitization", () => {
  const report = workspace("reports/report.md", "project_a");
  const content = '[Data](./measurements.csv "Download data") ![Diagram](./diagram.svg)\n![Plot](<./figures/plot one.svg> \'Plot title\')\n`[Literal](./measurements.csv)`\n```md\n![Literal](./diagram.svg)\n```';
  const linked = linkPreviewMarkdown(content, report, [report], base);
  assert.ok(linked.startsWith(`[Data](${base}/api/files/download?path=reports%2Fmeasurements.csv&projectId=project_a "Download data") ![Diagram](${base}/api/files/download?path=reports%2Fdiagram.svg&projectId=project_a)`));
  assert.ok(linked.includes(`![Plot](${base}/api/files/download?path=reports%2Ffigures%2Fplot+one.svg&projectId=project_a 'Plot title')`));
  assert.ok(linked.includes('`[Literal](./measurements.csv)`'));
  assert.ok(linked.endsWith('```md\n![Literal](./diagram.svg)\n```'));
  assert.equal(linkPreviewMarkdown('[Data](data.csv)', workspace("report.md"), [], base), `[Data](${base}/api/files/download?path=data.csv)`);
});

test("workspace Markdown prefers registered destinations and leaves unsafe references untouched", () => {
  const report = workspace("reports/report.md", "project_a");
  const known = { ...workspace("reports/measurements.csv", "project_a"), downloadUrl: "/api/files/download?projectId=project_a&path=reports%2Fmeasurements.csv" };
  assert.equal(linkPreviewMarkdown('[Data](./measurements.csv)', report, [report, known], base), `[Data](${base}${known.downloadUrl})`);
  const unsafe = '[Parent](../secret.csv) ![Hidden](./.secret.svg) [Web](https://example.com) [Other](http://localhost:8787/api/files/download?path=reports%2Fdata.csv&projectId=project_b)';
  assert.equal(linkPreviewMarkdown(unsafe, report, [report], base), unsafe);
  assert.equal(linkPreviewMarkdown('[Data](./measurements.csv)', artifact("report.md"), [], base), '[Data](./measurements.csv)');
  assert.equal(linkPreviewMarkdown('[Data](./measurements.csv)', report, [report], "invalid"), '[Data](./measurements.csv)');
});

test("HTML preview uses a restrictive policy and escapes markup when DOM parsing is unavailable", () => {
  const source = '<meta http-equiv="refresh" content="0;url=https://example.com"><script>alert(1)</script><img src="https://example.com/tracker"><form action="/api/run">run</form>';
  const output = staticHtmlPreviewDocument(source);
  assert.match(output, /default-src 'none'/);
  assert.match(output, /script-src 'none'/);
  assert.match(output, /connect-src 'none'/);
  assert.match(output, /form-action 'none'/);
  assert.match(output, /base-uri 'none'/);
  assert.ok(!output.includes("<script>"));
  assert.ok(!output.includes('<img src="https:'));
  assert.ok(!output.includes('<form action='));
  assert.ok(output.includes("&lt;script&gt;"));
});

test("DOMPurify keeps static document formatting and embedded raster images", () => {
  const document = sanitizePreview('<!doctype html><html><head><style>.report{color:navy}</style></head><body><h1 id="chapter" class="report">Report</h1><details open><summary>Table</summary><table><tbody><tr><th scope="row">A</th><td colspan="2" style="text-align:right">42</td></tr></tbody></table></details><a href="#chapter">Jump</a><img alt="chart" src="data:image/png;base64,iVBORw0KGgo="></body></html>');
  assert.equal(document.querySelector("h1.report")?.textContent, "Report");
  assert.equal(document.querySelector("td")?.getAttribute("colspan"), "2");
  assert.equal(document.querySelector("td")?.getAttribute("style"), "text-align:right");
  assert.equal(document.querySelector("details")?.hasAttribute("open"), true);
  assert.equal(document.querySelector("a")?.getAttribute("href"), "#chapter");
  assert.equal(document.querySelector("img")?.getAttribute("src"), "data:image/png;base64,iVBORw0KGgo=");
  assert.ok([...document.querySelectorAll("style")].some((style) => style.textContent === ".report{color:navy}"));
});

test("DOMPurify removes active elements, events, foreign namespaces and document overrides", () => {
  const document = sanitizePreview('<meta http-equiv="refresh" content="0;url=https://evil.test"><base href="https://evil.test"><link rel="stylesheet" href="https://evil.test/style"><script>alert(1)</script><form action="/api/run"><input name="prompt"><button>Run</button></form><iframe srcdoc="<script>alert(1)</script>"></iframe><object data="https://evil.test"></object><embed src="https://evil.test"><svg><a xlink:href="javascript:alert(1)">x</a></svg><math><mtext>x</mtext></math><template><img src=x onerror=alert(1)></template><p onclick="alert(1)" onmouseover="alert(1)" data-secret="value">Visible text</p>');
  assert.equal(document.querySelector("script,form,input,button,iframe,object,embed,svg,math,template,base,link"), null);
  assert.equal(document.querySelector('meta[http-equiv="refresh"]'), null);
  assert.equal(document.querySelector("p")?.textContent, "Visible text");
  for (const element of document.querySelectorAll("*")) {
    assert.equal(element.namespaceURI, "http://www.w3.org/1999/xhtml");
    for (const attribute of element.attributes) assert.ok(!/^on|^data-/i.test(attribute.name), attribute.name);
  }
});

test("DOMPurify offline URL policy permits only fragment anchors and raster data sources", () => {
  const sources = ["https://evil.test/track", "//evil.test/track", "/api/private", "javascript:alert(1)", "data:text/html;base64,PHNjcmlwdD4=", "data:image/svg+xml;base64,PHN2Zz4="];
  const source = sources.map((url) => '<img src="' + url + '" srcset="https://evil.test/other 2x" onerror="alert(1)"><a href="' + url + '" ping="https://evil.test/ping">Link</a>').join("")
    + '<a href="java&#x73;cript:alert(1)">Encoded</a><img src="data:image/webp;base64,AAAA"><a href="#local">Local</a>';
  const document = sanitizePreview(source);
  assert.deepEqual([...document.querySelectorAll("[src]")].map((element) => element.getAttribute("src")), ["data:image/webp;base64,AAAA"]);
  assert.deepEqual([...document.querySelectorAll("[href]")].map((element) => element.getAttribute("href")), ["#local"]);
  assert.equal(document.querySelector("[srcset],[ping],[onerror]"), null);
});

test("DOMPurify handles malformed namespace markup without reopening script or network paths", () => {
  const document = sanitizePreview('<p id="safe">Start</p><math><mtext><table><mglyph><style><!--</style><img title="--><img src=https://evil.test onerror=alert(1)>"></math><svg><foreignObject><p><img src="https://evil.test" onerror="alert(1)"></p></foreignObject></svg><p id="safe">End</p>');
  assert.equal(document.querySelector("svg,math,foreignObject,script,[onerror],[src],[href]"), null);
  assert.equal(document.querySelector("#safe")?.textContent, "Start");
});

test("reused DOMPurify instances keep the same restrictive policy across previews", () => {
  sanitizePreview('<a href="#safe">Safe</a><img src="data:image/png;base64,AAAA">');
  const document = sanitizePreview('<a href="https://evil.test">External</a><img src="https://evil.test"><p>Second preview</p>');
  assert.equal(document.querySelector("[src],[href]"), null);
  assert.equal(document.querySelector("p")?.textContent, "Second preview");
  const csp = document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute("content") ?? "";
  for (const policy of ["default-src 'none'", "script-src 'none'", "connect-src 'none'", "img-src data:", "frame-src 'none'", "form-action 'none'"]) assert.ok(csp.includes(policy), policy);
  assert.equal(document.querySelectorAll('meta[http-equiv="Content-Security-Policy"]').length, 1);
});

test("unsupported DOM environments fail closed to escaped source", () => {
  const output = staticHtmlPreviewDocument('<img src=x onerror=alert(1)><script>alert(1)</script>', {} as WindowLike);
  assert.ok(output.includes("&lt;script&gt;"));
  assert.ok(output.includes("&lt;img"));
  assert.ok(!output.includes("<script>"));
});
