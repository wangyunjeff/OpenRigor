import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { JSDOM } from "jsdom";
import { act, createElement, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { usePreviewScroll } from "../src/features/preview/use-preview-scroll";

interface View {
  contentKey: string;
  layoutKey: string;
  open: boolean;
  height: number;
  delayedPortal?: boolean;
}

async function mountReader(t: TestContext) {
  const dom = new JSDOM("<!doctype html><html><body><main id=fixture></main></body></html>", { url: "http://localhost/", pretendToBeVisual: true });
  const globals = new Map<string, PropertyDescriptor | undefined>();
  const expose = (name: string, value: unknown) => {
    globals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  };
  for (const name of ["window", "document", "navigator", "HTMLElement", "Element", "Node"]) expose(name, name === "window" ? dom.window : (dom.window as unknown as Record<string, unknown>)[name]);
  expose("IS_REACT_ACT_ENVIRONMENT", true);
  const observers = new Set<MockResizeObserver>();
  class MockResizeObserver {
    targets = new Set<Element>();
    constructor(readonly callback: ResizeObserverCallback) { observers.add(this); }
    observe(target: Element) { this.targets.add(target); }
    unobserve(target: Element) { this.targets.delete(target); }
    disconnect() { this.targets.clear(); observers.delete(this); }
  }
  expose("ResizeObserver", MockResizeObserver);
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(dom.window.document.getElementById("fixture")!);
  let view: View = { contentKey: "task-a:file:preview", layoutKey: "docked", open: true, height: 2000 };
  let revealPortal = () => {};
  function DelayedPortal({ children }: { children: ReactNode }) {
    const [mounted, setMounted] = useState(false);
    useEffect(() => {
      revealPortal = () => setMounted(true);
      return () => { revealPortal = () => {}; };
    }, []);
    return mounted ? createPortal(children, dom.window.document.body) : null;
  }
  function Reader(props: View) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const bodyRef = useRef<HTMLDivElement>(null);
    const geometry = useRef(props.height);
    geometry.current = props.height;
    const { scrollRef: attachScroll, bodyRef: attachBody, ...handlers } = usePreviewScroll({ ...props, scrollRef, bodyRef });
    const setScroll = useCallback((node: HTMLDivElement | null) => {
      if (!node) { attachScroll(null); return; }
      let offset = 0;
      // JSDOM has DOM events and portal reconciliation but no layout engine.
      // Model only native scroll geometry/clamping; the hook is mounted intact.
      Object.defineProperties(node, {
        scrollHeight: { configurable: true, get: () => geometry.current },
        clientHeight: { configurable: true, get: () => 100 },
        scrollTop: {
          configurable: true,
          get: () => { offset = Math.min(offset, Math.max(0, geometry.current - 100)); return offset; },
          set: (value: number) => { offset = Math.max(0, Math.min(value, Math.max(0, geometry.current - 100))); }
        }
      });
      attachScroll(node);
    }, [attachScroll]);
    if (!props.open) return null;
    const pane = createElement("div", { ref: setScroll, "data-reader": true, tabIndex: 0, ...handlers },
      createElement("div", { ref: attachBody }, createElement("input", { "aria-label": "Document search" }), props.contentKey));
    return props.layoutKey === "modal" ? props.delayedPortal ? createElement(DelayedPortal, { children: pane }) : createPortal(pane, dom.window.document.body) : pane;
  }
  t.after(async () => {
    await act(async () => root.unmount());
    assert.equal(observers.size, 0, "Unmount must release every resize observer");
    dom.window.close();
    for (const [name, descriptor] of globals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  });
  const render = async (change: Partial<View> = {}) => {
    view = { ...view, ...change };
    await act(async () => root.render(createElement(Reader, view)));
  };
  const scroll = () => dom.window.document.querySelector<HTMLDivElement>("[data-reader]")!;
  const resize = async (height: number) => {
    await render({ height });
    await act(async () => { for (const observer of observers) observer.callback([], observer as unknown as ResizeObserver); });
  };
  const scrollTo = async (offset: number) => {
    await act(async () => {
      scroll().scrollTop = offset;
      scroll().dispatchEvent(new dom.window.Event("scroll"));
    });
  };
  const input = async (kind: "wheel" | "touchstart" | "pointerdown" | "keydown", target: Element = scroll()) => {
    await act(async () => {
      const event = kind === "keydown" ? new dom.window.KeyboardEvent(kind, { key: "PageDown", bubbles: true }) : new dom.window.Event(kind, { bubbles: true });
      target.dispatchEvent(event);
    });
  };
  await render();
  const mountPortal = async () => { await act(async () => revealPortal()); };
  return { render, resize, scroll, scrollTo, input, observers, mountPortal };
}

test("documents, overview, files, source mode and task scopes keep separate reading positions", async (t) => {
  const reader = await mountReader(t);
  await reader.scrollTo(650);
  await reader.render({ contentKey: "task-a:overview", height: 400 });
  assert.equal(reader.scroll().scrollTop, 0);
  await reader.scrollTo(120);
  await reader.render({ contentKey: "task-a:files", height: 300 });
  await reader.scrollTo(75);
  await reader.render({ contentKey: "task-a:file:source", height: 2000 });
  await reader.scrollTo(250);
  await reader.render({ contentKey: "task-b:file:preview" });
  assert.equal(reader.scroll().scrollTop, 0, "The same filename in another task starts independently");
  await reader.render({ contentKey: "task-a:file:preview" });
  assert.equal(reader.scroll().scrollTop, 650);
  await reader.render({ contentKey: "task-a:overview", height: 400 });
  assert.equal(reader.scroll().scrollTop, 120);
  await reader.render({ contentKey: "task-a:files", height: 300 });
  assert.equal(reader.scroll().scrollTop, 75);
  await reader.render({ contentKey: "task-a:file:source", height: 2000 });
  assert.equal(reader.scroll().scrollTop, 250);
});

test("asynchronous loading and intermediate browser clamping do not erase the saved offset", async (t) => {
  const reader = await mountReader(t);
  await reader.scrollTo(800);
  await reader.render({ contentKey: "task-a:overview", height: 100 });
  await reader.render({ contentKey: "task-a:file:preview", height: 80 });
  assert.equal(reader.scroll().scrollTop, 0);
  await reader.scrollTo(0);
  await reader.resize(600);
  assert.equal(reader.scroll().scrollTop, 500, "A partially loaded document can only reach its current maximum");
  await reader.scrollTo(500);
  await reader.resize(2000);
  assert.equal(reader.scroll().scrollTop, 800, "The original offset survives intermediate clamp scroll events");
  await reader.render({ contentKey: "task-a:overview", height: 100 });
  await reader.render({ contentKey: "task-a:file:preview", height: 2000 });
  assert.equal(reader.scroll().scrollTop, 800);
});

test("dock/dialog portal remounts and closing/reopening restore the same document", async (t) => {
  const reader = await mountReader(t);
  await reader.scrollTo(620);
  const dock = reader.scroll();
  const previousObserver = [...reader.observers][0]!;
  await reader.render({ layoutKey: "modal" });
  assert.notEqual(reader.scroll(), dock, "The regression covers a real portal DOM replacement");
  assert.equal(reader.scroll().scrollTop, 620);
  assert.equal(previousObserver.targets.size, 0, "The observer must detach from the previous dock DOM");
  assert.equal(reader.observers.size, 1);
  await reader.scrollTo(730);
  await reader.render({ layoutKey: "docked" });
  assert.equal(reader.scroll().scrollTop, 730);
  await reader.render({ open: false });
  assert.equal(reader.observers.size, 0);
  await reader.render({ open: true });
  assert.equal(reader.scroll().scrollTop, 730);
});

test("a dialog portal mounting after the parent layout effect still attaches and restores its reading position", async (t) => {
  const reader = await mountReader(t);
  await reader.resize(4103);
  await reader.scrollTo(751);
  const dock = reader.scroll();
  await reader.render({ layoutKey: "modal", delayedPortal: true });
  assert.equal(reader.scroll(), null, "The parent hook has committed while the portal body is still absent");
  assert.equal(reader.observers.size, 0);
  await reader.mountPortal();
  assert.notEqual(reader.scroll(), dock);
  assert.equal(reader.scroll().scrollTop, 751, "Late callback-ref attachment restores the modal without another parent input");
  assert.equal(reader.observers.size, 1);
  await reader.resize(5000);
  assert.equal(reader.scroll().scrollTop, 751, "The observer is bound to the late portal body");
  await reader.render({ layoutKey: "docked" });
  assert.equal(reader.scroll().scrollTop, 751);
});

test("wheel, touch, scrollbar and keyboard input cancel a pending asynchronous restoration", async (t) => {
  const reader = await mountReader(t);
  for (const kind of ["wheel", "touchstart", "pointerdown", "keydown"] as const) {
    await reader.render({ contentKey: `task-a:file:${kind}`, height: 2000 });
    await reader.scrollTo(800);
    await reader.render({ contentKey: "task-a:overview", height: 100 });
    await reader.render({ contentKey: `task-a:file:${kind}`, height: 80 });
    await reader.input(kind);
    await reader.resize(2000);
    assert.equal(reader.scroll().scrollTop, 0, `${kind} must stop a late jump back to the old position`);
    await reader.scrollTo(140);
    await reader.render({ contentKey: "task-a:overview", height: 100 });
    await reader.render({ contentKey: `task-a:file:${kind}`, height: 2000 });
    assert.equal(reader.scroll().scrollTop, 140, `${kind} leaves the new position usable`);
  }
});

test("typing in document controls does not cancel restoration, and a later content shrink preserves it", async (t) => {
  const reader = await mountReader(t);
  await reader.scrollTo(800);
  await reader.render({ contentKey: "task-a:overview", height: 100 });
  await reader.render({ contentKey: "task-a:file:preview", height: 80 });
  await reader.input("keydown", reader.scroll().querySelector("input")!);
  await reader.input("pointerdown", reader.scroll().querySelector("input")!);
  await reader.resize(2000);
  assert.equal(reader.scroll().scrollTop, 800);
  await reader.render({ height: 80 });
  await reader.scrollTo(0);
  await reader.resize(2000);
  assert.equal(reader.scroll().scrollTop, 800, "A temporary rerender clamp must not become the new reading position");
});
