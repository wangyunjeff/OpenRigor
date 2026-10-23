import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { JSDOM } from "jsdom";
import { act, createElement, type ComponentProps } from "react";
import { PreviewProvider, usePreview } from "../src/features/preview/preview-context";
import { previewFileKey, type PreviewFile } from "../src/features/preview/file-preview-model";

type Context = NonNullable<ReturnType<typeof usePreview>>;
type ProviderProps = Omit<ComponentProps<typeof PreviewProvider>, "children">;

const artifact = (revision: number, runId = "run_a"): PreviewFile => ({
  origin: "artifact", runId, fileId: "report", name: "report.md", path: "reports/report.md", revision, mimeType: "text/markdown",
  downloadUrl: `/api/runs/${runId}/files/report?revision=${revision}`,
  contentUrl: `/api/runs/${runId}/files/report/content?revision=${revision}`
});
const workspace = (sha256 = "first-hash", projectId = "project_a"): PreviewFile => {
  const path = "reports/report.md";
  const query = new URLSearchParams({ path, projectId });
  return {
    origin: "workspace", projectId, fileId: path, path, name: path, revision: 1, sha256, mimeType: "text/markdown",
    downloadUrl: `/api/files/download?${query}`, contentUrl: `/api/files/content?${query}`
  };
};

async function mountProvider(t: TestContext, initial: Partial<ProviderProps> = {}) {
  const dom = new JSDOM("<!doctype html><html><body><main id=fixture></main></body></html>", { url: "http://localhost/", pretendToBeVisual: true });
  const globals = new Map<string, PropertyDescriptor | undefined>();
  const expose = (name: string, value: unknown) => {
    globals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  };
  for (const name of ["window", "document", "navigator", "HTMLElement", "Element", "Node", "requestAnimationFrame", "cancelAnimationFrame"]) {
    const value = name === "window" ? dom.window : (dom.window as unknown as Record<string, unknown>)[name];
    expose(name, name.endsWith("AnimationFrame") ? (value as Function).bind(dom.window) : value);
  }
  expose("IS_REACT_ACT_ENVIRONMENT", true);
  const { createRoot } = await import("react-dom/client");
  const container = dom.window.document.getElementById("fixture")!;
  const root = createRoot(container);
  let value: Context;
  let props: ProviderProps = { scope: "task:a", files: [], runs: [], ...initial };
  function Consumer() {
    value = usePreview()!;
    return createElement("section", { "data-scope": value.scope, "data-open": String(value.open) },
      createElement("output", { "data-library-count": true }, value.latestFiles.length),
      createElement("output", { "data-history-count": true }, value.files.length),
      createElement("ul", { "aria-label": "Library" }, value.latestFiles.map((file) => createElement("li", { key: previewFileKey(file) }, `${file.name}:v${file.revision}:${file.sha256 ?? ""}`))),
      createElement("ul", { "aria-label": "Tabs" }, value.tabs.map((tab) => createElement("li", { key: tab.id, "data-tab-id": tab.id, "data-kind": tab.kind }, tab.title))),
      createElement("p", { "data-projects": true }, value.projects.map((project) => `${project.id}:${project.name}`).join(",")));
  }
  const render = async (next: Partial<ProviderProps> = {}) => {
    props = { ...props, ...next };
    await act(async () => root.render(createElement(PreviewProvider, { ...props, children: createElement(Consumer) })));
  };
  t.after(async () => {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [name, descriptor] of globals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  });
  await render();
  return { render, container, value: () => value };
}

test("provider exposes scoped library counts while keeping exact artifact history available", async (t) => {
  const old = artifact(1), latest = artifact(3), otherRun = artifact(2, "run_b");
  const projects = [{ id: "project_a", name: "Research" }];
  const reader = await mountProvider(t, { files: [old, latest, otherRun], projects });
  assert.equal(reader.container.querySelector("[data-library-count]")?.textContent, "2");
  assert.equal(reader.container.querySelector("[data-history-count]")?.textContent, "3");
  assert.deepEqual(reader.value().latestFiles, [latest, otherRun]);
  assert.deepEqual(reader.value().files, [old, latest, otherRun]);
  assert.equal(reader.value().projects, projects);
  assert.equal(reader.container.querySelector("[data-projects]")?.textContent, "project_a:Research");
  await act(async () => reader.value().openArtifact(old));
  assert.equal(reader.value().tabs.length, 1);
  assert.equal(reader.value().tabs[0]?.kind, "file");
  assert.equal(reader.value().files.length, 3, "Opening an exact historic revision must not duplicate the registry");
  assert.deepEqual(reader.value().latestFiles, [latest, otherRun]);
  assert.equal(reader.value().scope, "task:a");
});

test("current workspace props win over an older open tab descriptor while exact descriptors remain available", async (t) => {
  const old = workspace("hash-a"), current = workspace("hash-b");
  const reader = await mountProvider(t, { files: [old] });
  await act(async () => reader.value().openFile(old));
  const selected = reader.value().activeId;
  await reader.render({ files: [current] });
  assert.deepEqual(reader.value().latestFiles, [current], "An open tab's cached descriptor must not replace current workspace metadata");
  assert.equal(reader.value().files.length, 2);
  assert.ok(reader.value().files.includes(old), "The open document's exact descriptor remains available");
  assert.ok(reader.value().files.includes(current), "The latest registry descriptor remains available");
  assert.equal(reader.value().activeId, selected);
  assert.equal(reader.value().open, true);
  assert.equal(reader.container.querySelector("[data-library-count]")?.textContent, "1");
  assert.equal(reader.container.querySelector("[data-history-count]")?.textContent, "2");
  const library = reader.container.querySelector('[aria-label="Library"]')?.textContent ?? "";
  assert.match(library, /hash-b/);
  assert.doesNotMatch(library, /hash-a/);
});

test("registerFile upgrades only the matching workspace placeholder and retains its id and basename", async (t) => {
  const reader = await mountProvider(t);
  await act(async () => reader.value().openWorkspace("reports/report.md", "project_a"));
  const placeholder = reader.value().tabs[0]!;
  assert.equal(placeholder.kind, "workspace");
  assert.equal(placeholder.title, "report.md");
  const id = placeholder.id;
  await act(async () => reader.value().registerFile(workspace("foreign", "project_b")));
  assert.equal(reader.value().tabs[0]?.kind, "workspace", "Metadata from another project cannot upgrade this tab");
  const file = workspace();
  await act(async () => reader.value().registerFile(file));
  const upgraded = reader.value().tabs[0]!;
  assert.equal(upgraded.kind, "file");
  assert.equal(upgraded.id, id);
  assert.equal(upgraded.title, "report.md", "A descriptor containing a directory still uses the basename for its tab");
  assert.equal(reader.value().activeId, id);
  assert.equal(reader.value().open, true);
  assert.deepEqual(reader.value().files, [file]);
  assert.equal(reader.container.querySelector('[aria-label="Tabs"]')?.textContent, "report.md");
});

test("web title updates normalize and cap existing titles without changing selection or viewer visibility", async (t) => {
  const reader = await mountProvider(t);
  await act(async () => reader.value().openWeb("https://example.org/paper", "Original title"));
  const webId = reader.value().activeId!;
  await act(async () => reader.value().openFile(artifact(1)));
  const fileId = reader.value().activeId!;
  await act(async () => reader.value().updateWebTitle(webId, "  Retrieved\n\t paper   title  "));
  assert.equal(reader.value().tabs.find((tab) => tab.id === webId)?.title, "Retrieved paper title");
  assert.equal(reader.value().activeId, fileId);
  assert.equal(reader.value().open, true);
  await act(async () => reader.value().hide());
  await act(async () => reader.value().updateWebTitle(webId, `  ${"x".repeat(250)}  `));
  assert.equal(reader.value().tabs.find((tab) => tab.id === webId)?.title, "x".repeat(200));
  assert.equal(reader.value().activeId, fileId);
  assert.equal(reader.value().open, false, "A background title response must not reopen a hidden viewer");
  await act(async () => {
    reader.value().updateWebTitle(webId, "  \n\t ");
    reader.value().updateWebTitle(fileId, "Incorrect file title");
  });
  assert.equal(reader.value().tabs.find((tab) => tab.id === webId)?.title, "x".repeat(200), "Empty titles retain the existing title");
  assert.equal(reader.value().tabs.find((tab) => tab.id === fileId)?.title, "report.md", "Title updates only apply to web tabs");
});

test("late web title responses cannot resurrect closed tabs or select another tab", async (t) => {
  const reader = await mountProvider(t);
  await act(async () => reader.value().openWeb("https://example.org/paper", "Original"));
  const webId = reader.value().activeId!;
  const update = reader.value().updateWebTitle;
  await act(async () => reader.value().openFile(artifact(1)));
  const fileId = reader.value().activeId!;
  await act(async () => {
    reader.value().closeTab(webId);
    reader.value().hide();
  });
  await act(async () => update(webId, "Late downloaded title"));
  assert.deepEqual(reader.value().tabs.map((tab) => tab.id), [fileId]);
  assert.equal(reader.value().activeId, fileId);
  assert.equal(reader.value().open, false);
  assert.doesNotMatch(reader.container.querySelector('[aria-label="Tabs"]')?.textContent ?? "", /Late downloaded title/);
});

test("callbacks captured by the previous scope cannot replace matching workspace or web tabs in the new scope", async (t) => {
  const reader = await mountProvider(t);
  await act(async () => {
    reader.value().openWorkspace("reports/report.md", "project_a");
    reader.value().openWeb("https://example.org/paper", "Scope A title");
  });
  const staleRegister = reader.value().registerFile;
  const staleUpdateTitle = reader.value().updateWebTitle;
  const webId = reader.value().activeId!;
  await reader.render({ scope: "task:b", projects: [{ id: "project_b", name: "Other project" }] });
  assert.equal(reader.value().scope, "task:b");
  assert.equal(reader.value().open, false);
  assert.equal(reader.value().tabs.length, 0);
  await act(async () => {
    reader.value().openWorkspace("reports/report.md", "project_a");
    reader.value().openWeb("https://example.org/paper", "Scope B title");
  });
  await act(async () => reader.value().hide());
  const before = reader.value().tabs;
  await act(async () => {
    staleRegister(workspace("scope-a-hash"));
    staleUpdateTitle(webId, "Scope A late title");
  });
  assert.equal(reader.value().scope, "task:b");
  assert.equal(reader.value().tabs, before, "Rejected stale callbacks preserve the new scope state");
  assert.equal(reader.value().tabs[0]?.kind, "workspace");
  assert.equal(reader.value().tabs.find((tab) => tab.id === webId)?.title, "Scope B title");
  assert.equal(reader.value().open, false);
  assert.equal(reader.value().activeId, webId);
  assert.equal(reader.container.querySelector("[data-projects]")?.textContent, "project_b:Other project");
  const currentFile = workspace("scope-b-hash");
  await act(async () => {
    reader.value().registerFile(currentFile);
    reader.value().updateWebTitle(webId, "Scope B retrieved title");
  });
  assert.equal(reader.value().tabs[0]?.kind, "file", "Current callbacks still work after rejecting the obsolete scope");
  assert.equal(reader.value().tabs.find((tab) => tab.id === webId)?.title, "Scope B retrieved title");
  assert.deepEqual(reader.value().latestFiles, [currentFile]);
});
