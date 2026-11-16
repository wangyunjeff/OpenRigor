import { useRef, useState, type CSSProperties, type HTMLAttributes, type ReactElement, type ReactNode } from "react";
import type { RunStatus } from "@openrigor/protocol";
import AnimatedContent from "../../components/reactbits/AnimatedContent";
import CountUp from "../../components/reactbits/CountUp";
import DotGrid from "../../components/reactbits/DotGrid";
import LatticeLoader from "../../components/reactbits/LatticeLoader";
import ShinyText from "../../components/reactbits/ShinyText";
import SplitText from "../../components/reactbits/SplitText";
import SpotlightCard from "../../components/reactbits/SpotlightCard";
import StatusMark from "../../components/reactbits/StatusMark";
import { cn } from "../../lib/utils";
import { gsap, useGSAP, useReducedMotion, useResolvedTheme, useThemeTokens } from "./motion-core";
import { taskMark, type MarkStatus, type MarkTone } from "./motion-model";
import { useSmoothScroll } from "./smooth-scroll";
import "./motion.css";

/*
 * OpenRigor's motion vocabulary. Each piece wraps one React Bits component
 * with the app's tokens, scroll container, and reduced-motion policy, so
 * product code never configures an effect from scratch.
 *
 *   Greeting          SplitText        the home title, once per visit
 *   Reveal            AnimatedContent  content entering on scroll or mount
 *   SpotlightSurface  SpotlightCard    cards that open something
 *   TaskStatusMark    StatusMark       the state of a task or step
 *   LiveLattice       LatticeLoader    "the agent is working right now"
 *   Shine             ShinyText        live text that is still changing
 *   StatNumber        CountUp          measured totals
 *   HeroGrid          DotGrid          the notebook grid behind the greeting
 *   ParallaxImage     GSAP ScrollTrigger scrub, driven by Lenis
 */

export interface RevealProps extends Omit<HTMLAttributes<HTMLDivElement>, "onAnimationStart"> {
  children: ReactNode;
  /** Seconds between direct children. Zero reveals the block as one piece. */
  stagger?: number;
  delay?: number;
  distance?: number;
  /** Play on mount instead of when scrolled into view. */
  immediate?: boolean;
}

/** Content rises into place when it enters the scroll area. Shown instantly under reduced motion. */
export function Reveal({ children, stagger = 0, delay = 0, distance = 14, immediate = false, className, style, ...rest }: RevealProps): ReactElement {
  const { present, scroller } = useSmoothScroll();
  const onScroll = present && !immediate;
  return <AnimatedContent
    container={onScroll ? scroller : null}
    trigger={onScroll ? "scroll" : "mount"}
    distance={distance}
    duration={0.55}
    ease="power2.out"
    threshold={0.04}
    delay={delay}
    stagger={stagger}
    {...(className === undefined ? {} : { className })}
    {...(style === undefined ? {} : { style })}
    {...rest}
  >{children}</AnimatedContent>;
}

/**
 * The home title comes into focus character by character, once. A blur
 * rather than a masked rise: masks would clip the serif's descenders.
 * GSAP SplitText keeps the sentence readable to screen readers.
 */
export function Greeting({ text, className }: { text: string; className?: string }): ReactElement {
  return <SplitText
    text={text}
    tag="h1"
    splitType="chars"
    effect="blur"
    trigger="load"
    textAlign="left"
    delay={22}
    duration={0.8}
    {...(className === undefined ? {} : { className })}
  />;
}

export interface SpotlightSurfaceProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

/** A card surface with a soft accent light that follows the pointer or keyboard focus. */
export function SpotlightSurface({ children, className, style, ...rest }: SpotlightSurfaceProps): ReactElement {
  const theme = useResolvedTheme();
  return <SpotlightCard
    theme={theme}
    spotlightColor="var(--accent)"
    intensity={theme === "dark" ? 0.13 : 0.42}
    spotlightSize={280}
    softness={0.85}
    borderGlow={theme === "dark" ? 0.75 : 0.9}
    proximity={0}
    smoothing={0.25}
    flare={false}
    className={cn("spotlight-surface rounded-[14px] p-0", className)}
    style={{
      "--spotlight-card-surface": "var(--surface)",
      "--spotlight-card-border": "var(--line)",
      "--spotlight-card-shadow": "var(--shadow-card)",
      ...style
    } as CSSProperties}
    {...rest}
  >{children}</SpotlightCard>;
}

export interface TaskStatusMarkProps {
  status: RunStatus;
  /** True only while this client is streaming the run; otherwise working states stay still. */
  live?: boolean;
  size?: number;
  className?: string;
}

/**
 * The state of a task as one morphing glyph: ring, arc, check, or cross.
 * Decorative by design; every caller pairs it with visible or screen-reader text.
 */
export function TaskStatusMark({ status, live = false, size = 14, className }: TaskStatusMarkProps): ReactElement {
  const mark = taskMark(status, live);
  return <span className={cn("task-status-mark", className)} data-tone={mark.tone} data-mark={mark.status} title={mark.label} aria-hidden="true">
    <StatusMark status={mark.status} size={size} strokeWidth={2} doneColor="var(--green)" errorColor="var(--danger)" fillOpacity={0.1} />
  </span>;
}

/** The same glyph for a single step (a tool call or plan item), addressed by mark rather than run status. */
export function StepMark({ mark, tone = "neutral", size = 14, label, className }: { mark: MarkStatus; tone?: MarkTone; size?: number; label?: string; className?: string }): ReactElement {
  return <span className={cn("task-status-mark", className)} data-tone={tone} data-mark={mark} {...(label ? { title: label } : {})} aria-hidden="true">
    <StatusMark status={mark} size={size} strokeWidth={2} doneColor="var(--green)" errorColor="var(--danger)" fillOpacity={0.1} />
  </span>;
}

/** The single "working right now" indicator. Hidden from assistive tech; the caller owns the live region. */
export function LiveLattice({ label, className }: { label: string; className?: string }): ReactElement {
  return <span className={cn("live-lattice", className)} aria-hidden="true">
    <LatticeLoader label={label} status="working" pattern="orbit" grid={3} shape="round" cellSize={4} gap={2} fontSize={13} step={95} idleOpacity={0.22} showTimer={false} />
  </span>;
}

/** Text with a slow sheen while something is live; plain text otherwise and under reduced motion. */
export function Shine({ children, active = true, className }: { children: string; active?: boolean; className?: string }): ReactElement {
  const tokens = useThemeTokens();
  const reduced = useReducedMotion();
  if (!active || reduced) return <span className={className}>{children}</span>;
  return <ShinyText
    text={children}
    color={tokens.textSoft}
    shineColor={tokens.faint}
    speed={2.4}
    shineWidth={38}
    softness={0.9}
    direction="left"
    easing="linear"
    {...(className === undefined ? {} : { className })}
  />;
}

/** A measured total that counts up once when first seen. The final value is always in the accessible name. */
export function StatNumber({ value, className }: { value: number; className?: string }): ReactElement {
  const safe = Number.isFinite(value) ? value : 0;
  return <CountUp to={safe} from={0} duration={1.1} separator="," easing="expo" trigger="view" {...(className === undefined ? {} : { className })} />;
}

function supportsWebGL2(): boolean {
  try { return Boolean(document.createElement("canvas").getContext("webgl2")); } catch { return false; }
}

// DotGrid takes opaque hex colors only; these are the notebook-grid dot on each theme's background.
const gridDot: Record<"dark" | "light", string> = { dark: "#2b2c31", light: "#d6d2c8" };

/**
 * The notebook grid behind the home greeting. With WebGL2 and motion allowed
 * the dots lean away from the pointer and settle; otherwise a static CSS grid
 * of the same pitch is drawn. It idles when nothing moves.
 */
export function HeroGrid(): ReactElement {
  const reduced = useReducedMotion();
  const theme = useResolvedTheme();
  const tokens = useThemeTokens();
  const [webgl] = useState(supportsWebGL2);
  if (reduced || !webgl) return <div className="hero-grid is-static" aria-hidden="true" />;
  return <div className="hero-grid" aria-hidden="true">
    <DotGrid
      dotSize={2}
      gap={20}
      baseColor={gridDot[theme]}
      activeColor={tokens.accent}
      proximity={120}
      strength={0.55}
      bounce={0.45}
      returnDuration={0.9}
      shockRadius={200}
      shockStrength={2}
      swell={1.6}
      stretch={0.25}
      glow={0}
      intro={false}
    />
  </div>;
}

export interface ParallaxImageProps {
  src: string;
  alt?: string;
  className?: string;
  /** Total travel as a percentage of the image height. */
  travel?: number;
}

/**
 * An image that drifts inside its frame as the page scrolls: a GSAP
 * ScrollTrigger scrub on the Lenis-driven scroller. Static under reduced motion.
 */
export function ParallaxImage({ src, alt = "", className, travel = 10 }: ParallaxImageProps): ReactElement {
  const frameRef = useRef<HTMLDivElement>(null);
  const { scroller } = useSmoothScroll();
  useGSAP(() => {
    const frame = frameRef.current;
    const image = frame?.querySelector("img");
    if (!frame || !image || !scroller) return;
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      gsap.fromTo(image, { yPercent: -travel / 2 }, {
        yPercent: travel / 2,
        ease: "none",
        scrollTrigger: { trigger: frame, scroller, start: "top bottom", end: "bottom top", scrub: true }
      });
    });
    return () => media.revert();
  }, { scope: frameRef, dependencies: [scroller, travel], revertOnUpdate: true });
  return <div ref={frameRef} className={cn("parallax-image", className)}>
    <img src={src} alt={alt} loading="lazy" />
  </div>;
}
