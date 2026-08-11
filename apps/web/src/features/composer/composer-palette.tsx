import { useEffect, useRef, type ReactElement } from "react";
import { useGSAP } from "@gsap/react";
import { AtSign, Check, Layers3, type LucideIcon } from "lucide-react";
import { gsap } from "gsap";

gsap.registerPlugin(useGSAP);

export interface ComposerPaletteItem {
  id: string;
  label: string;
  description: string;
  icon: LucideIcon;
  kind: "skill" | "context";
  path?: string;
}

interface ComposerPaletteProps {
  open: boolean;
  mode: "skill" | "context" | null;
  items: ComposerPaletteItem[];
  activeIndex: number;
  selected: string[];
  onSelect: (item: ComposerPaletteItem) => void;
}

/**
 * The slash/at command surface stays independent from the runtime shell. The
 * textarea remains the focus owner, so each option exposes a stable id and
 * separates keyboard highlight (`aria-selected`) from the persisted choice
 * (`data-configured` and the visible check mark).
 */
export function ComposerPalette({
  open,
  mode,
  items,
  activeIndex,
  selected,
  onSelect
}: ComposerPaletteProps): ReactElement | null {
  const paletteRef = useRef<HTMLDivElement>(null);

  useGSAP(() => {
    const root = paletteRef.current;
    if (!root || !open || !mode) return;
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      gsap.timeline({ defaults: { ease: "power2.out" } })
        .fromTo(root, { autoAlpha: 0, y: 7, scale: 0.992 }, { autoAlpha: 1, y: 0, scale: 1, duration: 0.16, clearProps: "transform,opacity,visibility" })
        .fromTo(".composer-command-header, .composer-command-item, .composer-command-footer", { autoAlpha: 0, y: 4 }, { autoAlpha: 1, y: 0, duration: 0.13, stagger: 0.022, clearProps: "transform,opacity,visibility" }, "<0.02");
    }, root);
    return () => media.revert();
  }, { scope: paletteRef, dependencies: [open, mode], revertOnUpdate: true });

  useEffect(() => {
    if (!open) return;
    paletteRef.current?.querySelector<HTMLElement>(".composer-command-item.highlighted")?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, items.length, open]);

  if (!open || !mode) return null;
  const HeaderIcon = mode === "skill" ? Layers3 : AtSign;
  return <div id={`composer-palette-${mode}`} ref={paletteRef} className="composer-command-menu" role="listbox" aria-label={mode === "skill" ? "选择技能" : "选择上下文"}>
    <div className="composer-command-header"><span><HeaderIcon aria-hidden="true" />{mode === "skill" ? "技能" : "上下文"}</span><kbd>{mode === "skill" ? "/" : "@"}</kbd></div>
    <div className="composer-command-list">
      {items.length ? items.map((item, index) => {
        const Icon = item.icon;
        const configured = selected.includes(item.id);
        const highlighted = index === activeIndex;
        const optionId = `composer-${mode}-${item.id}`;
        return <button
          id={optionId}
          type="button"
          role="option"
          aria-selected={highlighted}
          aria-label={`${item.label}${configured ? "，已添加" : ""}`}
          data-configured={configured ? "true" : "false"}
          className={highlighted ? "composer-command-item highlighted" : "composer-command-item"}
          key={item.id}
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => onSelect(item)}
        >
          <span className="composer-command-icon"><Icon aria-hidden="true" /></span>
          <span className="composer-command-copy"><strong>{item.label}</strong><small>{item.description}</small>{item.path ? <code>{item.path}</code> : null}</span>
          <span className={configured ? "composer-command-check selected" : "composer-command-check"}>{configured ? <Check aria-hidden="true" /> : <kbd>{index + 1}</kbd>}</span>
        </button>;
      }) : <div className="composer-command-empty" role="status">没有匹配的选项</div>}
    </div>
    <div className="composer-command-footer"><span><kbd>↑</kbd><kbd>↓</kbd>选择</span><span><kbd>Enter</kbd>添加</span></div>
  </div>;
}
