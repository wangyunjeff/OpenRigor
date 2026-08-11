import { useRef, type ReactElement } from "react";
import { useGSAP } from "@gsap/react";
import { gsap } from "gsap";
import { Folder } from "lucide-react";
import { examples, tabs, type ExampleTask, type TabId } from "./example-data";
import { ExampleCard } from "./example-card";

export interface HomeViewProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  onOpenExample: (example: ExampleTask, trigger: HTMLButtonElement) => void;
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 11) return "早上好，Jeff";
  if (hour < 18) return "下午好，Jeff";
  return "晚上好，Jeff";
}

export function HomeView({ activeTab, onTabChange, onOpenExample }: HomeViewProps): ReactElement {
  const launchRef = useRef<HTMLElement>(null);
  const previousActiveTab = useRef(activeTab);
  const activeExamples = examples[activeTab];

  useGSAP(() => {
    const root = launchRef.current;
    if (!root) return;
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      gsap.timeline({ defaults: { ease: "power2.out" } })
        .fromTo(".launch-inner h1", { autoAlpha: 0, y: 8 }, { autoAlpha: 1, y: 0, duration: 0.36, ease: "power3.out", clearProps: "transform,opacity,visibility" })
        .fromTo(".workspace-context", { autoAlpha: 0, y: 5, scale: 0.98 }, { autoAlpha: 1, y: 0, scale: 1, duration: 0.24, clearProps: "transform,opacity,visibility" }, "<0.08")
        .fromTo(".category-tabs", { autoAlpha: 0, y: 5 }, { autoAlpha: 1, y: 0, duration: 0.24, clearProps: "transform,opacity,visibility" }, "<0.05")
        .fromTo(".example-card", { autoAlpha: 0, y: 9, scale: 0.992 }, { autoAlpha: 1, y: 0, scale: 1, duration: 0.28, stagger: 0.045, clearProps: "transform,opacity,visibility" }, "<0.04");
    }, root);
    return () => media.revert();
  }, { scope: launchRef });

  useGSAP(() => {
    const root = launchRef.current;
    if (!root) return;
    if (previousActiveTab.current === activeTab) return;
    previousActiveTab.current = activeTab;
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      gsap.fromTo(".category-tab.selected", { scale: 0.96 }, { scale: 1, duration: 0.2, ease: "power2.out", clearProps: "transform" });
      gsap.fromTo(".example-card", { autoAlpha: 0, y: 8, scale: 0.994 }, { autoAlpha: 1, y: 0, scale: 1, duration: 0.26, stagger: 0.035, ease: "power2.out", clearProps: "transform,opacity,visibility" });
    }, root);
    return () => media.revert();
  }, { scope: launchRef, dependencies: [activeTab], revertOnUpdate: true });

  return <section ref={launchRef} className="launch-view">
    <div className="launch-inner">
      <h1>{greeting()}</h1>
      <div className="workspace-context"><Folder aria-hidden="true" /><span>OpenRigor</span><small>main</small></div>
      <div className="category-tabs" role="tablist" aria-label="任务分类">{tabs.map((tab, index) => <button id={`task-tab-${tab.id}`} key={tab.id} type="button" role="tab" aria-selected={activeTab === tab.id} aria-controls="task-examples" tabIndex={activeTab === tab.id ? 0 : -1} className={activeTab === tab.id ? "category-tab selected" : "category-tab"} onClick={() => onTabChange(tab.id)} onKeyDown={(event) => {
        if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
        event.preventDefault();
        const offset = event.key === "ArrowRight" ? 1 : -1;
        const next = tabs[(index + offset + tabs.length) % tabs.length];
        if (!next) return;
        onTabChange(next.id);
        window.setTimeout(() => document.getElementById(`task-tab-${next.id}`)?.focus(), 0);
      }}>{tab.label}</button>)}</div>
      <div id="task-examples" className="example-grid" role="tabpanel" tabIndex={0} aria-labelledby={`task-tab-${activeTab}`}>{activeExamples.map((example) => <ExampleCard key={example.title} example={example} onOpen={onOpenExample} />)}</div>
    </div>
  </section>;
}
