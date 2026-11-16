import { createContext, useContext, useEffect, useMemo, useRef, useState, type HTMLAttributes, type ReactElement, type ReactNode } from "react";
import Lenis from "lenis";
import "lenis/dist/lenis.css";
import { gsap, ScrollTrigger, useReducedMotion } from "./motion-core";
import { smoothScrollPolicy } from "./motion-model";

export interface SmoothScrollValue {
  /** True for descendants of a SmoothScrollArea, even before it has mounted. */
  present: boolean;
  /** The element that scrolls; pass it to ScrollTrigger as `scroller`. Null while the area is inactive. */
  scroller: HTMLElement | null;
  /** The Lenis instance, or null when scrolling is native (reduced motion, inactive area). */
  lenis: Lenis | null;
}

const SmoothScrollContext = createContext<SmoothScrollValue>({ present: false, scroller: null, lenis: null });

export function useSmoothScroll(): SmoothScrollValue {
  return useContext(SmoothScrollContext);
}

// GSAP's lag smoothing would make Lenis jump after a stalled frame, so it is
// off while any smooth area exists and restored to GSAP's default afterwards.
let activeAreas = 0;
function retainTicker(): () => void {
  activeAreas += 1;
  if (activeAreas === 1) gsap.ticker.lagSmoothing(0);
  return () => {
    activeAreas -= 1;
    if (activeAreas === 0) gsap.ticker.lagSmoothing(500, 33);
  };
}

export interface SmoothScrollAreaProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  /** Whether this area is the scroll container right now. Inactive areas create no Lenis instance. */
  active?: boolean;
  contentClassName?: string;
  /** Changing this value returns the area to the top, for example when the page changes. */
  resetKey?: string;
  children: ReactNode;
}

/**
 * A scroll container with Lenis smooth wheel scrolling, driven by GSAP's
 * ticker so scroll position and ScrollTrigger animations update in the same
 * frame. Keyboard, touch, and scrollbar scrolling stay native. With reduced
 * motion the area is an ordinary scroll container and ScrollTrigger still works.
 *
 * The conversation transcript does not use this: its stick-to-bottom
 * controller owns that scroll position while answers stream.
 */
export function SmoothScrollArea({ active = true, className, contentClassName, resetKey, children, ...rest }: SmoothScrollAreaProps): ReactElement {
  const [wrapper, setWrapper] = useState<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [lenis, setLenis] = useState<Lenis | null>(null);
  const reducedMotion = useReducedMotion();
  const policy = smoothScrollPolicy({ active, reducedMotion });

  useEffect(() => {
    const content = contentRef.current;
    if (!wrapper || !content || !policy.enabled) return undefined;
    const instance = new Lenis({
      wrapper,
      content,
      eventsTarget: wrapper,
      autoRaf: false,
      smoothWheel: true,
      syncTouch: false,
      lerp: policy.lerp,
      wheelMultiplier: policy.wheelMultiplier,
      allowNestedScroll: true,
      anchors: false
    });
    const release = retainTicker();
    const tick = (time: number) => instance.raf(time * 1000);
    gsap.ticker.add(tick);
    const offScroll = instance.on("scroll", ScrollTrigger.update);
    setLenis(instance);
    return () => {
      offScroll();
      gsap.ticker.remove(tick);
      release();
      instance.destroy();
      setLenis(null);
    };
  }, [wrapper, policy.enabled, policy.lerp, policy.wheelMultiplier]);

  // Scroll-linked triggers measure positions once; re-measure when content
  // grows (images, loaded lists) and expose a scrolled flag for the header.
  useEffect(() => {
    const content = contentRef.current;
    if (!wrapper || !content || !active) return undefined;
    const sync = () => wrapper.toggleAttribute("data-scrolled", wrapper.scrollTop > 8);
    sync();
    wrapper.addEventListener("scroll", sync, { passive: true });
    let timer = 0;
    const observer = new ResizeObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => ScrollTrigger.refresh(), 160);
    });
    observer.observe(content);
    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
      wrapper.removeEventListener("scroll", sync);
      wrapper.removeAttribute("data-scrolled");
    };
  }, [wrapper, active]);

  useEffect(() => {
    if (!wrapper || !active) return;
    if (lenis) lenis.scrollTo(0, { immediate: true, force: true });
    else wrapper.scrollTop = 0;
    // Only a new key resets the position; a Lenis instance appearing must not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  const value = useMemo<SmoothScrollValue>(() => ({ present: true, scroller: active ? wrapper : null, lenis }), [active, wrapper, lenis]);

  return <SmoothScrollContext.Provider value={value}>
    <div ref={setWrapper} className={className} data-smooth-scroll={active ? (policy.enabled ? "smooth" : "native") : "off"} {...rest}>
      <div ref={contentRef} className={contentClassName}>{children}</div>
    </div>
  </SmoothScrollContext.Provider>;
}
