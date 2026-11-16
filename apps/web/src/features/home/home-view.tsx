import { useRef, type ReactElement } from "react";
import { ArrowRight, Pin } from "lucide-react";
import type { RunSnapshot } from "@openrigor/protocol";
import { Greeting, Reveal, SpotlightSurface, TaskStatusMark, gsap, revealStagger, taskMark, useGSAP } from "../motion";
import type { ExampleTask, TabId } from "./example-data";
import { researchCases } from "./research-starters";
import "./home.css";

export interface HomeViewProps {
  /** Retained for compatibility with the earlier example-grid launcher. */
  activeTab?: TabId;
  onTabChange?: (tab: TabId) => void;
  onOpenExample?: (example: ExampleTask, trigger: HTMLButtonElement) => void;
  displayName?: string;
  onOpenSection?: (section: "research" | "guides" | "handoff") => void;
}

export interface HomeTask {
  rootRunId: string;
  title?: string;
  prompt: string;
  status: RunSnapshot["status"];
  updatedAt: string;
  pinned?: boolean;
}

export interface HomeSectionsProps {
  tasks: HomeTask[];
  onOpenTask: (rootRunId: string) => void;
  onUseStarter: (prompt: string) => void;
  onOpenSection: (section: "research" | "guides" | "handoff" | "search") => void;
}

function greeting(): string {
  const hour = new Date().getHours();
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

function relativeTime(value: string): string {
  const ms = Date.now() - Date.parse(value);
  if (!Number.isFinite(ms) || ms < 60_000) return "Just now";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(value).toLocaleDateString([], { month: "short", day: "numeric" });
}

/**
 * Greeting above the composer. The title comes into focus character by
 * character (React Bits SplitText on GSAP SplitText); the subtitle follows.
 * The composer itself is the page's primary action.
 */
export function HomeView({ displayName = "Jeff" }: HomeViewProps): ReactElement {
  const launchRef = useRef<HTMLElement>(null);
  useGSAP(() => {
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      gsap.fromTo(".landing-subtitle", { autoAlpha: 0, y: 8 }, { autoAlpha: 1, y: 0, duration: .6, delay: .35, ease: "power2.out", clearProps: "transform,opacity,visibility" });
    });
    return () => media.revert();
  }, { scope: launchRef });
  return <section ref={launchRef} className="launch-view">
    <div className="launch-inner">
      <Greeting text={`${greeting()}, ${displayName}`} className="home-greeting" />
      <p className="landing-subtitle">Ask a question or describe a task. OpenRigor plans the work, runs it in your local workspace, and shows every step.</p>
    </div>
  </section>;
}

/** Starting points and recent work, below the composer. */
export function HomeSections({ tasks, onOpenTask, onUseStarter, onOpenSection }: HomeSectionsProps): ReactElement {
  const starters = researchCases.slice(0, 4);
  const recent = tasks.slice(0, 4);
  return <Reveal className="home-sections" stagger={0.08} delay={0.25} distance={18}>
    {recent.length ? <section className="home-section" aria-labelledby="home-recent">
      <div className="home-section-heading"><h2 id="home-recent">Continue</h2><button type="button" className="home-section-link" onClick={() => onOpenSection("search")}>All tasks<ArrowRight aria-hidden="true" /></button></div>
      <ul className="home-recent-list">{recent.map((task) => {
        const status = taskMark(task.status, false);
        const title = task.title?.trim() || task.prompt.trim() || "Untitled task";
        return <li key={task.rootRunId}><button type="button" className="home-recent-item" onClick={() => onOpenTask(task.rootRunId)}>
          <span className="home-recent-status"><TaskStatusMark status={task.status} size={15} /><span className="sr-only">{status.label}: </span></span>
          <span className="home-recent-title">{task.pinned ? <Pin className="home-recent-pin" aria-label="Pinned" /> : null}<span className="home-recent-text">{title}</span></span>
          <time dateTime={task.updatedAt} title={new Date(task.updatedAt).toLocaleString()}>{relativeTime(task.updatedAt)}</time>
        </button></li>;
      })}</ul>
    </section> : null}

    <section className="home-section" aria-labelledby="home-starters">
      <div className="home-section-heading"><h2 id="home-starters">Start from a research workflow</h2><button type="button" className="home-section-link" onClick={() => onOpenSection("research")}>All workflows<ArrowRight aria-hidden="true" /></button></div>
      <Reveal className="home-starter-grid" stagger={revealStagger(starters.length)} distance={12}>{starters.map((starter) => <SpotlightSurface key={starter.title} className="home-starter-spot"><button type="button" className="home-starter" onClick={() => onUseStarter(starter.prompt)}>
        <span className="home-starter-image" aria-hidden="true"><img src={starter.image} alt="" loading="lazy" /></span>
        <span className="home-starter-copy"><small>{starter.tag}</small><strong>{starter.title}</strong><span>{starter.description}</span></span>
      </button></SpotlightSurface>)}</Reveal>
      <p className="home-starter-note">Choosing a workflow fills in the task so you can edit it first. Nothing runs until you send it.</p>
    </section>

    <p className="home-footnote">New to OpenRigor? <button type="button" onClick={() => onOpenSection("guides")}>Read the guide</button></p>
  </Reveal>;
}
