import { useEffect, useState } from "react";
import { useGSAP } from "@gsap/react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";

/**
 * One place registers GSAP plugins. Product motion is scoped with useGSAP or
 * gsap.context and must have a reduced-motion path; scroll-linked motion uses
 * ScrollTrigger with the scroller provided by SmoothScrollArea.
 */
gsap.registerPlugin(ScrollTrigger, SplitText, useGSAP);

export { gsap, ScrollTrigger, useGSAP };

const reducedMotionQuery = "(prefers-reduced-motion: reduce)";

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && (window.matchMedia?.(reducedMotionQuery).matches ?? false);
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(prefersReducedMotion);
  useEffect(() => {
    const media = window.matchMedia(reducedMotionQuery);
    const sync = () => setReduced(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
  return reduced;
}

export type ResolvedTheme = "dark" | "light";

function readTheme(): ResolvedTheme {
  return typeof document !== "undefined" && document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

/** The applied theme (never "system"), tracked from the root element. */
export function useResolvedTheme(): ResolvedTheme {
  const [theme, setTheme] = useState<ResolvedTheme>(readTheme);
  useEffect(() => {
    const sync = () => setTheme(readTheme());
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);
  return theme;
}

export interface ThemeTokens {
  text: string;
  textSoft: string;
  muted: string;
  faint: string;
  accent: string;
  gold: string;
  bg: string;
}

const tokenNames: Record<keyof ThemeTokens, string> = {
  text: "--text",
  textSoft: "--text-soft",
  muted: "--muted",
  faint: "--faint",
  accent: "--accent",
  gold: "--gold",
  bg: "--bg"
};

function readTokens(): ThemeTokens {
  const style = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  return {
    text: read(tokenNames.text, "#eeece6"),
    textSoft: read(tokenNames.textSoft, "#d6d3cb"),
    muted: read(tokenNames.muted, "#a8a59d"),
    faint: read(tokenNames.faint, "#918e87"),
    accent: read(tokenNames.accent, "#9aaaff"),
    gold: read(tokenNames.gold, "#e3c07c"),
    bg: read(tokenNames.bg, "#111214")
  };
}

/**
 * Resolved color values for canvas and WebGL components, which cannot read
 * CSS custom properties. Recomputed when the theme changes.
 */
export function useThemeTokens(): ThemeTokens {
  const theme = useResolvedTheme();
  const [tokens, setTokens] = useState<ThemeTokens>(readTokens);
  useEffect(() => { setTokens(readTokens()); }, [theme]);
  return tokens;
}
