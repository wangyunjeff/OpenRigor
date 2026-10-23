import { useRef, type ReactElement } from "react";
import { useGSAP } from "@gsap/react";
import { gsap } from "gsap";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import type { ExampleTask, TabId } from "./example-data";
import "./home.css";

export interface HomeViewProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  onOpenExample: (example: ExampleTask, trigger: HTMLButtonElement) => void;
  displayName?: string;
  onOpenSection?: (section: "research" | "guides" | "handoff") => void;
}

function greeting(): string {
  const hour = new Date().getHours();
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

function ResearchArt(): ReactElement {
  return <svg className="landing-art research-art" viewBox="0 0 280 230" fill="none" aria-hidden="true">
    <g stroke="currentColor" strokeWidth="1.15" strokeLinecap="round" strokeLinejoin="round">
      <path d="m143 30 28 12-9 22-28-12zM136 48l27 12-29 69-27-12zM109 118l23 10-6 14-23-10zM139 129l-13 31M131 126l-13 31M165 85c42 22 52 66 24 101M161 98c31 18 38 52 16 79M178 179l18 17M194 190l10 13M105 171h81M100 165h91v12h-91zM111 177l-8 26M174 177l11 26M86 203h116l10 9H76zM79 212v7h129v-7" />
      <path d="m145 32-3-7 30 13-2 7M140 38l26 11M148 67l-15 35M144 74l-11 26M111 122l16 7M114 139l8 4M105 168h73M93 207h85M115 211h17M146 211h17" opacity=".65" />
      <circle cx="181" cy="121" r="19"/><circle cx="181" cy="121" r="13"/><circle cx="181" cy="121" r="5"/>
      {Array.from({ length: 12 }, (_, i) => <path key={i} d="M181 103v5" transform={`rotate(${i * 30} 181 121)`}/>)}
      <circle cx="78" cy="122" r="25"/><circle cx="78" cy="122" r="19"/><circle cx="74" cy="117" r="7"/><circle cx="84" cy="129" r="4"/><path d="m72 131 6 3M88 113l3 4"/>
      <path d="M46 187h8m-4-4v8M216 178h8m-4-4v8M93 59h8m-4-4v8M224 104h11m-5-6v12" opacity=".65"/>
      <circle cx="55" cy="77" r="1"/><circle cx="205" cy="56" r="1"/><circle cx="93" cy="155" r="1"/>
    </g>
  </svg>;
}
function GuidesArt(): ReactElement {
  return <svg className="landing-art guides-art" viewBox="0 0 160 160" fill="none" aria-hidden="true"><g stroke="currentColor" strokeWidth=".9" strokeLinecap="round" strokeLinejoin="round"><circle cx="82" cy="82" r="45"/><circle cx="82" cy="82" r="40"/><circle cx="82" cy="82" r="34"/><circle cx="82" cy="82" r="6"/><path d="m68 53 24 21 10 36-24-21zM68 53l10 36 14-15M75 38v-9a7 7 0 0 1 14 0v9M78 35v-6a4 4 0 0 1 8 0v6M79 43h6M79 121h6M43 79v6M121 79v6M55 55l4 4M109 109l4 4M109 55l4 4M55 109l4 4"/><path d="M81 48v5M97 51l-2 5M110 62l-4 3M115 78h-5M112 94l-4-2M100 110l-3-4M84 116v-5M67 112l2-5M53 101l4-3M49 85h5M53 68l4 2M65 54l3 4"/><path d="m28 125-2 4 4 1 1-3zM139 39h6m-3-3v6M132 130h6m-3-3v6M21 51h4m-2-2v4" opacity=".7"/></g></svg>;
}
function HandoffArt(): ReactElement {
  return <svg className="landing-art handoff-art" viewBox="0 0 190 130" fill="none" aria-hidden="true"><g stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"><rect x="83" y="16" width="87" height="91" rx="5"/><rect x="87" y="20" width="79" height="83" rx="2"/><path d="M87 29h79M92 24h3m3 0h3m3 0h3M94 38h18v5H94zM118 38h40M118 43h24M94 51h64M94 56h64M94 61h45M94 72h19M94 77h30M94 82h24"/><path d="m20 83 16-21h25l17 21v31H20zM20 83h17l5 7h15l5-7h16M24 87v22h50V87M36 65h22M33 71h28M29 78h38M12 114h77M179 111h7m-3-3v6M78 48h4m-2-2v4"/><path d="m43 60 5-7 22 4 10 24M52 55l17 4M59 49l17 4 7 21" opacity=".7"/></g></svg>;
}

export function HomeView({ displayName = "Jeff", onOpenSection }: HomeViewProps): ReactElement {
  const launchRef = useRef<HTMLElement>(null);
  useGSAP(() => {
    const root = launchRef.current;
    if (!root || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    gsap.fromTo(root.querySelectorAll(".landing-identity, h1, .landing-subtitle, .landing-card"), { autoAlpha: 0, y: 6 }, { autoAlpha: 1, y: 0, duration: .28, stagger: .035, ease: "power2.out", clearProps: "transform,opacity,visibility" });
  }, { scope: launchRef });
  return <section ref={launchRef} className="launch-view">
    <div className="launch-inner">
      <div className="landing-identity"><svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M8 7h10a8 8 0 0 1 0 16H8V7Z" stroke="currentColor" strokeWidth="1.5"/><path d="M8 15h10M15 15l9 10M12 7v16" stroke="currentColor" strokeWidth="1.5"/></svg><span>OpenRigor</span><i /><span>Research workspace</span></div>
      <h1>{greeting()}, {displayName}</h1>
      <p className="landing-subtitle">Space to think. Tools to discover. Your next question starts here.</p>
      <div className="landing-cards">
        <button type="button" className="landing-card landing-research" onClick={() => onOpenSection?.("research")}>
          <span className="landing-card-category">Ideas into evidence</span>
          <span className="landing-card-title">Research, with rigor.</span>
          <span className="landing-card-copy">Explore methods, connect sources, and build work you can stand behind.</span>
          <span className="landing-card-action">Explore research <ArrowRight aria-hidden="true" /></span>
          <span className="generated-instrument instrument-research" aria-hidden="true" /><ResearchArt />
        </button>
        <button type="button" className="landing-card landing-guides" onClick={() => onOpenSection?.("guides")}>
          <span className="landing-card-category">Find your bearings</span>
          <span className="landing-card-title">A little guidance.</span>
          <span className="landing-card-copy">Get to know your agent.</span>
          <span className="landing-card-arrow"><ArrowUpRight aria-hidden="true" /></span>
          <span className="generated-instrument instrument-guides" aria-hidden="true" /><GuidesArt />
        </button>
        <button type="button" className="landing-card landing-handoff" onClick={() => onOpenSection?.("handoff")}>
          <span className="landing-card-category">Keep the thread</span>
          <span className="landing-card-title">Back to your work.</span>
          <span className="landing-card-copy">Pick up your projects.</span>
          <span className="landing-card-arrow"><ArrowUpRight aria-hidden="true" /></span>
          <span className="generated-instrument instrument-handoff" aria-hidden="true" /><HandoffArt />
        </button>
      </div>
    </div>
  </section>;
}
