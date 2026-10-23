import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test, { type TestContext } from "node:test";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import type { PreviewFile } from "../src/features/preview/file-preview-model";

async function mountSource(t: TestContext, content: string) {
  const dom = new JSDOM("<!doctype html><html><body><main id=fixture></main></body></html>", { url: "http://localhost/", pretendToBeVisual: true });
  const globals = new Map<string, PropertyDescriptor | undefined>();
  for (const name of ["window", "document", "navigator", "HTMLElement", "Element", "Node", "MutationObserver", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "IS_REACT_ACT_ENVIRONMENT"]) {
    globals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    const value = name === "window" ? dom.window : name === "IS_REACT_ACT_ENVIRONMENT" ? true : (dom.window as unknown as Record<string, unknown>)[name];
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: ["getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame"].includes(name) ? (value as Function).bind(dom.window) : value });
  }
  const cssHook = registerHooks({ load(url, context, nextLoad) {
    return url.endsWith(".css") ? { format: "module", source: "export {};", shortCircuit: true } : nextLoad(url, context);
  } });
  const copied: string[] = [];
  Object.defineProperty(dom.window.navigator, "clipboard", { configurable: true, value: { writeText: async (text: string) => { copied.push(text); } } });
  t.mock.method(globalThis, "fetch", async () => Response.json({ content, mimeType: "text/x-python", truncated: false }));
  const { createRoot } = await import("react-dom/client");
  const { FilePreview } = await import("../src/features/preview/file-renderer.tsx");
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
  const file: PreviewFile = { origin: "artifact", runId: "run_source", fileId: "source", revision: 1, name: "example.py", path: "example.py", mimeType: "text/x-python", contentUrl: "/api/runs/run_source/files/source/content?revision=1" };
  await act(async () => root.render(createElement(FilePreview, { file, files: [file], mode: "source" })));
  return { container, copied, navigator: dom.window.navigator };
}

test("source uses native syntax highlighting and copies the exact literal file", async (t) => {
  const source = 'def example():\n    return "\\(literal\\) <script>alert(1)</script>"\n```\n# Literal heading\n\n';
  const { container, copied } = await mountSource(t, source);
  const block = container.querySelector('[data-streamdown="code-block"]');
  assert.ok(block, "Source should reuse the native Streamdown code block");
  assert.equal(block.getAttribute("data-language"), "python");
  assert.equal(container.querySelector("script"), null, "Literal source must never become live HTML");
  assert.equal(container.querySelector("h1"), null, "A source fence must never escape into Markdown");
  const button = container.querySelector<HTMLButtonElement>('button[aria-label="Copy source"]');
  assert.ok(button);
  await act(async () => button.click());
  assert.deepEqual(copied, [source], "Copy must retain literal LaTeX, fences, HTML and trailing newlines");
  for (let attempt = 0; attempt < 40 && !container.querySelector('[style*="--sdm-c: #"]'); attempt += 1) {
    await act(async () => new Promise((resolve) => setTimeout(resolve, 25)));
  }
  assert.ok(container.querySelector('[style*="--sdm-c: #"]'), "The existing Shiki plugin should highlight Python tokens");
});

test("a denied clipboard operation leaves source readable and provides feedback", async (t) => {
  const { container, navigator } = await mountSource(t, "print('readable')\n");
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => { throw new Error("Denied"); } } });
  const button = container.querySelector<HTMLButtonElement>('button[aria-label="Copy source"]');
  assert.ok(button);
  await act(async () => button.click());
  assert.match(container.querySelector('[role="status"]')?.textContent ?? "", /Unable to copy/);
  assert.match(container.querySelector('[aria-label="File source"]')?.textContent ?? "", /readable/);
});

test("a failed highlighter keeps literal source mounted inside the workspace", async (t) => {
  const { code } = await import("@streamdown/code");
  let attempts = 0;
  t.mock.method(code, "highlight", () => { attempts += 1; throw new Error("Highlighter chunk unavailable"); });
  // React reports caught render/effect failures in development; the assertions
  // below verify the boundary recovers instead of letting that error reach root.
  t.mock.method(console, "error", () => {});
  const source = "def fallback():\n    return '<script>literal</script>'\n\n";
  const { container } = await mountSource(t, source);
  const pre = container.querySelector("pre.file-text-preview");
  assert.ok(pre, "A failed code renderer should degrade to the lightweight source viewer");
  assert.equal(pre.textContent, source, "Recovery must retain the full literal file");
  assert.equal(pre.getAttribute("tabindex"), "0");
  assert.match(container.querySelector('[role="status"]')?.textContent ?? "", /Syntax highlighting is unavailable/);
  assert.equal(container.querySelector("script"), null);
  assert.ok(container.closest("main"), "The surrounding workspace should remain mounted");
  const attemptsAfterRecovery = attempts;
  await act(async () => new Promise((resolve) => setTimeout(resolve, 25)));
  assert.equal(attempts, attemptsAfterRecovery, "Recovery must not start an automatic retry loop");
});

test("large or very tall source stays literal without constructing a token DOM", async (t) => {
  for (const source of ["x".repeat(64 * 1024 + 1), "line\n".repeat(1502)]) {
    await t.test(`${source.length} characters`, async (subtest) => {
      const { container } = await mountSource(subtest, source);
      const pre = container.querySelector("pre.file-text-preview");
      assert.ok(pre, "Large source should keep the lightweight text fallback");
      assert.equal(pre.textContent, source);
      assert.equal(pre.getAttribute("tabindex"), "0", "Keyboard users must be able to scroll long source");
      assert.equal(container.querySelector('[data-streamdown="code-block"]'), null);
    });
  }
});
