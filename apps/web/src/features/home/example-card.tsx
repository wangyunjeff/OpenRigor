import { useRef, type ReactElement } from "react";
import { useGSAP } from "@gsap/react";
import { gsap } from "gsap";
import { companionVisuals, type ExampleTask } from "./example-data";
import { ExamplePreviewArt } from "./example-preview-art";

export interface ExampleCardProps {
  example: ExampleTask;
  onOpen: (example: ExampleTask, trigger: HTMLButtonElement) => void;
}

export function ExampleCard({ example, onOpen }: ExampleCardProps): ReactElement {
  const cardRef = useRef<HTMLButtonElement>(null);
  const { contextSafe } = useGSAP({ scope: cardRef });

  const animateHover = contextSafe(() => {
    const root = cardRef.current;
    if (!root || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const stack = root.querySelector<HTMLElement>(".example-art-stack");
    const media = Array.from(root.querySelectorAll<HTMLElement>(".example-art-stack .example-art-media"));
    const targets = [root, stack, ...media].filter((target): target is HTMLElement => Boolean(target));
    gsap.killTweensOf(targets);
    gsap.to(root, { y: -1, duration: 0.16, ease: "power2.out", overwrite: "auto" });
    if (stack) gsap.to(stack, { y: -2, scale: 1.012, duration: 0.2, ease: "power2.out", overwrite: "auto" });
    gsap.fromTo(media, { autoAlpha: 0.58, y: 3 }, { autoAlpha: 1, y: 0, duration: 0.22, stagger: 0.018, ease: "power2.out", overwrite: "auto", clearProps: "transform,opacity,visibility" });
  });

  const animatePointerHover = contextSafe(() => {
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    animateHover();
  });

  const resetHover = contextSafe(() => {
    const root = cardRef.current;
    if (!root || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const stack = root.querySelector<HTMLElement>(".example-art-stack");
    const media = Array.from(root.querySelectorAll<HTMLElement>(".example-art-stack .example-art-media"));
    const targets = [root, stack, ...media].filter((target): target is HTMLElement => Boolean(target));
    gsap.killTweensOf(targets);
    gsap.set(media, { clearProps: "transform,opacity,visibility" });
    gsap.to(root, { y: 0, duration: 0.26, ease: "power3.out", overwrite: "auto", clearProps: "transform" });
    if (stack) gsap.to(stack, { y: 0, scale: 1, duration: 0.28, ease: "power3.out", overwrite: "auto", clearProps: "transform" });
  });

  const resetPointerHover = contextSafe(() => {
    const root = cardRef.current;
    if (!root || !window.matchMedia("(hover: hover) and (pointer: fine)").matches || root.matches(":focus-visible")) return;
    resetHover();
  });

  const pressCard = contextSafe(() => {
    const root = cardRef.current;
    if (!root || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    gsap.to(root, { scale: 0.996, duration: 0.09, ease: "power1.out", overwrite: "auto" });
  });

  const releaseCard = contextSafe(() => {
    const root = cardRef.current;
    if (!root || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    gsap.to(root, { scale: 1, duration: 0.16, ease: "power2.out", overwrite: "auto" });
  });

  const Icon = example.icon;
  const visual = example.visual ?? "research";
  return <button
    ref={cardRef}
    type="button"
    className="example-card"
    onClick={(event) => onOpen(example, event.currentTarget)}
    onPointerEnter={animatePointerHover}
    onPointerLeave={resetPointerHover}
    onPointerDown={pressCard}
    onPointerUp={releaseCard}
    onPointerCancel={releaseCard}
    onFocus={animateHover}
    onBlur={resetHover}
    aria-label={`预览案例：${example.title}`}
  >
    <span className="example-body"><span className="example-kicker"><Icon aria-hidden="true" />工作流</span><strong>{example.title}</strong><span>{example.description}</span></span>
    <span className="example-art-stack" aria-hidden="true">
      <ExamplePreviewArt visual={companionVisuals[visual]} generated />
      <ExamplePreviewArt visual={visual} generated />
    </span>
  </button>;
}
