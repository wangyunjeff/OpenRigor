import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { useGSAP } from "@gsap/react";
import { gsap } from "gsap";
import { CircleHelp, Radio, WifiOff } from "lucide-react";
import type { ConversationRunView } from "../../conversation";
import { presentRunActivity, type RunActivityConnection, type RunActivityPresentation } from "../../run-presentation";
import { runActivityContext } from "./run-activity-model";
import "./run-activity.css";

export function useRunActivity(run: ConversationRunView, connection: RunActivityConnection): { view: RunActivityPresentation; nowMs: number } {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const terminal = ["completed", "failed", "cancelled"].includes(run.snapshot.status);
  useEffect(() => {
    setNowMs(Date.now());
    if (terminal) return;
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [run.runId, terminal]);
  const context = useMemo(() => runActivityContext(run, connection), [run.events, connection]);
  return { view: presentRunActivity(run.snapshot, run.events.at(-1)?.ts ?? run.snapshot.updatedAt, nowMs, context), nowMs };
}

/** Motion conveys an active state; timestamps still report only real provider events. */
export function ActivityGlyph({ animated, state = "working", className = "" }: { animated: boolean; state?: RunActivityPresentation["state"]; className?: string }): ReactElement {
  const glyph = useRef<HTMLSpanElement>(null);
  useGSAP(() => {
    const root = glyph.current;
    if (!root || !animated) return;
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      gsap.to(".activity-spinner", { rotation: 360, duration: 1.25, repeat: -1, ease: "none", transformOrigin: "50% 50%" });
      gsap.fromTo(".activity-glyph-core", { opacity: .35 }, { opacity: 1, duration: .8, yoyo: true, repeat: -1, ease: "sine.inOut" });
    }, root);
    return () => media.revert();
  }, { scope: glyph, dependencies: [animated, state], revertOnUpdate: true });
  return <span ref={glyph} className={`activity-glyph ${animated ? "is-moving" : ""} ${className}`} data-state={state} aria-hidden="true">
    {state === "disconnected" ? <WifiOff /> : state === "waiting-user" ? <CircleHelp /> : !animated ? <Radio /> : <svg className="activity-spinner" viewBox="0 0 24 24" fill="none"><circle className="activity-spinner-track" cx="12" cy="12" r="9" /><path d="M12 3a9 9 0 0 1 9 9" /><circle className="activity-glyph-core" cx="12" cy="12" r="2" /></svg>}
  </span>;
}

/**
 * A single quiet line at the end of a live turn. The helper sentence appears
 * only when the user has something to understand or do (input, reconnects,
 * silence); routine progress stays on one line.
 */
export function RunActivityIndicator({ view }: { view: RunActivityPresentation }): ReactElement {
  const root = useRef<HTMLDivElement>(null);
  useGSAP(() => {
    if (!root.current) return;
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      gsap.fromTo(root.current, { opacity: 0, y: 4 }, { opacity: 1, y: 0, duration: .22, clearProps: "opacity,transform" });
    });
    return () => media.revert();
  }, { scope: root });
  const showHelper = view.stale || view.state === "waiting-user" || view.state === "reconnecting" || view.state === "disconnected" || view.state === "queued";
  const showDetail = view.detail && view.detail !== view.headline;
  return <div ref={root} className="run-presence" data-state={view.state} data-animated={view.animated} data-stale={view.stale}>
    <ActivityGlyph animated={view.animated} state={view.state} />
    <div className="run-presence-copy">
      <p className="run-presence-line"><strong role="status" aria-live="polite">{view.headline}</strong>{showDetail ? <span className="run-presence-detail" title={view.detail}>{view.detail}</span> : null}</p>
      {showHelper && view.helper ? <small>{view.helper}</small> : null}
    </div>
    <span className="run-presence-time" title={view.lastUpdate}>{view.elapsed}</span>
  </div>;
}
