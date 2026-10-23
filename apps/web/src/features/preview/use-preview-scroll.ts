import { useCallback, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject, type SyntheticEvent, type UIEvent } from "react";

interface PreviewScrollOptions {
  /** Include task scope, selected document/view, and preview/source mode. */
  contentKey: string;
  /** Changes when the scroll DOM moves between the dock and dialog portal. */
  layoutKey: string;
  open: boolean;
  scrollRef: RefObject<HTMLElement | null>;
  bodyRef: RefObject<HTMLElement | null>;
}

interface ScrollSession {
  key: string;
  container: HTMLElement;
  target: number;
  pending: boolean;
}

const tolerance = 1;
const scrollKeys = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "]);
const maxOffset = (container: HTMLElement) => Math.max(0, container.scrollHeight - container.clientHeight);
const currentOffset = (container: HTMLElement) => Math.max(0, container.scrollTop);

/** Keeps reading positions across asynchronous content and portal remounts. */
export function usePreviewScroll({ contentKey, layoutKey, open, scrollRef, bodyRef }: PreviewScrollOptions) {
  const positions = useRef(new Map<string, number>());
  const current = useRef<ScrollSession | null>(null);
  const attachedScroll = useRef<HTMLElement | null>(null);
  const attachedBody = useRef<HTMLElement | null>(null);
  const [attachment, setAttachment] = useState(0);

  // Dialog portals may mount after this hook's layout effect has already run.
  // Stable callback refs explicitly rerun binding when those DOM nodes arrive.
  const attachScroll = useCallback((node: HTMLElement | null) => {
    scrollRef.current = node;
    if (attachedScroll.current === node) return;
    attachedScroll.current = node;
    setAttachment((previous) => previous + 1);
  }, [scrollRef]);
  const attachBody = useCallback((node: HTMLElement | null) => {
    bodyRef.current = node;
    if (attachedBody.current === node) return;
    attachedBody.current = node;
    setAttachment((previous) => previous + 1);
  }, [bodyRef]);

  useLayoutEffect(() => {
    const container = scrollRef.current;
    const body = bodyRef.current;
    if (!open || !container || !body) { current.current = null; return; }
    const session: ScrollSession = { key: contentKey, container, target: positions.current.get(contentKey) ?? 0, pending: true };
    current.current = session;

    const restore = () => {
      if (current.current !== session) return;
      const available = maxOffset(container);
      // A late loading placeholder or a resize can temporarily clamp a restored
      // document. Keep the saved offset until content grows or the reader moves.
      if (!session.pending && session.target > available + tolerance && currentOffset(container) < session.target - tolerance) session.pending = true;
      if (!session.pending) return;
      container.scrollTop = Math.min(session.target, available);
      if (available + tolerance >= session.target) session.pending = false;
    };

    restore();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(restore);
    observer?.observe(body);
    if (body !== container) observer?.observe(container);
    return () => {
      observer?.disconnect();
      // Do not sample scrollTop here: React may already have installed shorter
      // content and the browser may already have clamped the old view to zero.
      if (current.current === session) current.current = null;
    };
  }, [contentKey, layoutKey, open, scrollRef, bodyRef, attachment]);

  const interruptRestoration = useCallback((event: SyntheticEvent<HTMLElement>) => {
    const session = current.current;
    if (!session || session.container !== event.currentTarget) return;
    session.pending = false;
    session.target = currentOffset(session.container);
    positions.current.set(session.key, session.target);
  }, []);

  const onScroll = useCallback((event: UIEvent<HTMLElement>) => {
    const session = current.current;
    if (!session || session.container !== event.currentTarget || session.pending) return;
    const offset = currentOffset(session.container);
    if (session.target > maxOffset(session.container) + tolerance && offset < session.target - tolerance) {
      session.pending = true;
      return;
    }
    session.target = offset;
    positions.current.set(session.key, offset);
  }, []);

  const onKeyDown = useCallback((event: KeyboardEvent<HTMLElement>) => {
    if (event.defaultPrevented || !scrollKeys.has(event.key)) return;
    const target = event.target;
    if (target instanceof Element && target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return;
    if (event.key === " " && target instanceof Element && target.closest('button, [role="button"]')) return;
    interruptRestoration(event);
  }, [interruptRestoration]);

  const onPointerDown = useCallback((event: PointerEvent<HTMLElement>) => {
    // Native scrollbar drags target the scroll container itself. Clicking a
    // document link or control should not cancel a pending reading position.
    if (event.target === event.currentTarget) interruptRestoration(event);
  }, [interruptRestoration]);

  return { scrollRef: attachScroll, bodyRef: attachBody, onScroll, onWheel: interruptRestoration, onTouchStart: interruptRestoration, onKeyDown, onPointerDown };
}
