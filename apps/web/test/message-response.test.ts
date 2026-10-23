import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test, { type TestContext } from "node:test";
import { JSDOM } from "jsdom";
import { act, createElement, useState } from "react";
import type { CustomRendererProps } from "streamdown";
import type { PreviewFile } from "../src/features/preview/file-preview-model";

async function mountDocument(t: TestContext) {
  const dom = new JSDOM("<!doctype html><html><body><main id=fixture></main></body></html>", { url: "http://localhost/", pretendToBeVisual: true });
  const globals = new Map<string, PropertyDescriptor | undefined>();
  const expose = (name: string, value: unknown) => {
    globals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  };
  for (const name of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLButtonElement", "Element", "Node", "NodeFilter", "DocumentFragment", "CustomEvent", "MutationObserver", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame"]) {
    const value = name === "window" ? dom.window : (dom.window as unknown as Record<string, unknown>)[name];
    expose(name, ["getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame"].includes(name) ? (value as Function).bind(dom.window) : value);
  }
  expose("IS_REACT_ACT_ENVIRONMENT", true);
  const cssHook = registerHooks({ load(url, context, nextLoad) {
    return url.endsWith(".css") ? { format: "module", source: "export {};", shortCircuit: true } : nextLoad(url, context);
  } });
  const { createRoot } = await import("react-dom/client");
  const container = dom.window.document.getElementById("fixture")!;
  const root = createRoot(container);
  t.after(async () => {
    await act(async () => root.unmount());
    cssHook.deregister();
    dom.window.close();
    for (const [name, descriptor] of globals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  });
  return { root, container, document: dom.window.document };
}

test("new artifacts refresh document link handlers without closing the expanded table", async (t) => {
  const { root, document } = await mountDocument(t);
  const { FilePreview } = await import("../src/features/preview/file-renderer.tsx");
  const report: PreviewFile = {
    origin: "artifact", runId: "run_preview", fileId: "report", revision: 1,
    name: "report.md", path: "report.md", mimeType: "text/markdown",
    contentUrl: "/api/runs/run_preview/files/report/content?revision=1",
    downloadUrl: "/api/runs/run_preview/files/report?revision=1"
  };
  const newArtifact: PreviewFile = {
    ...report, fileId: "result", name: "result.csv", path: "result.csv", mimeType: "text/csv",
    contentUrl: "/api/runs/run_preview/files/result/content?revision=1",
    downloadUrl: "/api/runs/run_preview/files/result?revision=1"
  };
  const markdown = "| Evidence | Status |\n| --- | --- |\n| [Reference](https://example.org/reference) | Verified |\n| [Artifact](result.csv) | Pending |";
  let reads = 0;
  t.mock.method(globalThis, "fetch", async () => {
    reads += 1;
    return new Response(JSON.stringify({ content: markdown, mimeType: "text/markdown", truncated: false }), { headers: { "Content-Type": "application/json" } });
  });
  const opened: string[] = [];
  const openedFiles: PreviewFile[] = [];
  await act(async () => root.render(createElement(FilePreview, {
    file: report, files: [report], mode: "preview", onOpenWeb: () => opened.push("old handler")
  })));
  const expand = document.querySelector<HTMLButtonElement>('button[aria-label="View table fullscreen"]');
  assert.ok(expand, "The real Markdown table should expose its fullscreen control");
  await act(async () => expand.click());
  const dialog = document.querySelector('[role="dialog"]');
  assert.ok(dialog, "The real table dialog should be open before another artifact arrives");

  await act(async () => root.render(createElement(FilePreview, {
    file: report, files: [report, newArtifact], mode: "preview", onOpenWeb: () => opened.push("new handler"), onOpenFile: (file) => openedFiles.push(file)
  })));
  assert.equal(document.querySelector('[role="dialog"]'), dialog, "Artifact registration must preserve the mounted dialog and its open state");
  assert.match(dialog.textContent ?? "", /Verified/);
  const reference = dialog.querySelector<HTMLAnchorElement>('a[href="https://example.org/reference"]');
  assert.ok(reference);
  await act(async () => reference.click());
  assert.deepEqual(opened, ["new handler"], "Unchanged Markdown must use the updated link component configuration");
  const artifact = [...dialog.querySelectorAll<HTMLAnchorElement>("a")].find((link) => link.textContent === "Artifact");
  assert.ok(artifact, "A newly registered artifact should become available in the expanded table");
  await act(async () => artifact.click());
  assert.deepEqual(openedFiles, [newArtifact]);
  assert.equal(reads, 1, "An unrelated artifact must not reload the open document");
});

test("updated renderer plugins become available without resetting an existing expanded renderer", async (t) => {
  const { root, container } = await mountDocument(t);
  const { MessageResponse } = await import("../src/components/ai-elements/message.tsx");
  function StatefulChart({ code }: CustomRendererProps) {
    const [open, setOpen] = useState(false);
    return createElement("section", { "aria-label": "Chart preview" },
      createElement("button", { type: "button", "aria-expanded": open, onClick: () => setOpen(!open) }, "Expand chart"),
      open ? createElement("div", { role: "region", "aria-label": "Expanded chart" }, code) : null);
  }
  function AttachmentRenderer({ code }: CustomRendererProps) {
    return createElement("aside", { "aria-label": "Registered attachment" }, code);
  }
  const markdown = "```preview-chart\nChart content\n```\n\n```new-attachment\nNew artifact content\n```";
  const chart = { language: "preview-chart", component: StatefulChart };
  await act(async () => root.render(createElement(MessageResponse, {
    children: markdown, mode: "static", isAnimating: false, plugins: { renderers: [chart] }
  })));
  const expand = container.querySelector<HTMLButtonElement>('button[aria-expanded="false"]');
  assert.ok(expand);
  await act(async () => expand.click());
  const expanded = container.querySelector('[aria-label="Expanded chart"]');
  assert.ok(expanded);
  assert.equal(container.querySelector('[aria-label="Registered attachment"]'), null);

  await act(async () => root.render(createElement(MessageResponse, {
    children: markdown, mode: "static", isAnimating: false,
    plugins: { renderers: [chart, { language: "new-attachment", component: AttachmentRenderer }] }
  })));
  assert.equal(container.querySelector('[aria-label="Expanded chart"]'), expanded, "Refreshing plugins must preserve mounted renderer state");
  assert.equal(expand.getAttribute("aria-expanded"), "true");
  assert.equal(container.querySelector('[aria-label="Registered attachment"]')?.textContent?.trim(), "New artifact content");
});

test("unregistered workspace Markdown references survive sanitization and stay in their project", async (t) => {
  const { root, container } = await mountDocument(t);
  const { FilePreview } = await import("../src/features/preview/file-renderer.tsx");
  const { workspaceApiBase } = await import("../src/features/workspace/api.ts");
  const projectId = "project_a";
  const query = new URLSearchParams({ path: "reports/report.md", projectId });
  const report: PreviewFile = {
    origin: "workspace", fileId: "reports/report.md", revision: 1,
    name: "report.md", path: "reports/report.md", mimeType: "text/markdown", projectId,
    contentUrl: `/api/files/content?${query}`, downloadUrl: `/api/files/download?${query}`
  };
  const requests: URL[] = [];
  t.mock.method(globalThis, "fetch", async (input) => {
    const url = new URL(String(input));
    requests.push(url);
    assert.equal(url.origin, workspaceApiBase);
    assert.equal(url.searchParams.get("projectId"), projectId);
    if (url.pathname === "/api/files/metadata") {
      assert.equal(url.searchParams.get("path"), "reports/diagram.svg");
      const imageQuery = new URLSearchParams({ path: "reports/diagram.svg", projectId });
      return Response.json({ name: "diagram.svg", path: "reports/diagram.svg", mimeType: "image/svg+xml", projectId, contentUrl: `/api/files/content?${imageQuery}` });
    }
    assert.equal(url.pathname, "/api/files/content");
    if (url.searchParams.get("path") === "reports/diagram.svg") return Response.json({ content: '<svg xmlns="http://www.w3.org/2000/svg"><title>Diagram</title></svg>', mimeType: "image/svg+xml", truncated: false });
    assert.equal(url.searchParams.get("path"), report.path);
    return Response.json({ content: `[Measurements](./measurements.csv)\n\n![Diagram](./diagram.svg)\n\n![Foreign](${workspaceApiBase}/api/files/download?path=reports%2Fdiagram.svg&projectId=project_b)`, mimeType: "text/markdown", truncated: false });
  });
  const opened: [string, string | undefined][] = [];
  await act(async () => root.render(createElement(FilePreview, {
    file: report, files: [report], mode: "preview", onOpenWorkspace: (path, project) => opened.push([path, project])
  })));
  const measurements = [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Measurements");
  assert.ok(measurements, "A relative reference should become an in-page workspace action");
  await act(async () => measurements.click());
  assert.deepEqual(opened, [["reports/measurements.csv", projectId]]);
  assert.match(container.querySelector('img[alt="Diagram"]')?.getAttribute("src") ?? "", /^blob:/);
  assert.equal(container.querySelector('img[alt="Foreign"]'), null);
  assert.equal(requests.filter((url) => url.pathname === "/api/files/metadata").length, 1, "A foreign project image must not trigger metadata access");
});
