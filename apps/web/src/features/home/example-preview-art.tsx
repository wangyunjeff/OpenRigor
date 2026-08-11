import type { ReactElement } from "react";
import { generatedVisualAssets, type ExampleVisual } from "./example-data";

export interface ExamplePreviewArtProps {
  visual: ExampleVisual;
  generated?: boolean;
}

export function ExamplePreviewArt({ visual, generated = false }: ExamplePreviewArtProps): ReactElement {
  if (generated) {
    return <span className={`example-art example-art-generated art-${visual}`} aria-hidden="true">
      <img className="example-art-media" src={generatedVisualAssets[visual]} alt="" draggable={false} decoding="async" />
    </span>;
  }
  if (visual === "research") return <span className="example-art art-research" aria-hidden="true"><span className="art-window"><i /><i /><i /></span><span className="art-sheet"><b /><b /><b /><em /></span><span className="art-pin" /></span>;
  if (visual === "slides") return <span className="example-art art-slides" aria-hidden="true"><span className="art-slide art-slide-back" /><span className="art-slide art-slide-main"><b /><i /><i /><i /></span><span className="art-slide art-slide-front"><b /><i /><i /></span></span>;
  if (visual === "chart") return <span className="example-art art-chart" aria-hidden="true"><span className="art-axis" /><span className="art-line line-one" /><span className="art-line line-two" /><span className="art-bar bar-one" /><span className="art-bar bar-two" /><span className="art-bar bar-three" /><span className="art-bar bar-four" /></span>;
  if (visual === "matrix") return <span className="example-art art-matrix" aria-hidden="true"><span className="matrix-head"><i /><i /><i /><i /></span><span className="matrix-row"><i /><i /><i /><i /></span><span className="matrix-row"><i /><i /><i /><i /></span><span className="matrix-row"><i /><i /><i /><i /></span><span className="matrix-row"><i /><i /><i /><i /></span></span>;
  if (visual === "code") return <span className="example-art art-code" aria-hidden="true"><span className="code-rail"><i /><i /><i /><i /></span><span className="code-lines"><i /><i /><i /><i /><i /><i /></span><span className="code-card"><b /><i /><i /></span></span>;
  if (visual === "terminal") return <span className="example-art art-terminal" aria-hidden="true"><span className="terminal-head"><b /><b /><b /></span><span className="terminal-copy"><i /><i /><i /><i /></span><span className="terminal-cursor" /></span>;
  if (visual === "calendar") return <span className="example-art art-calendar" aria-hidden="true"><span className="calendar-head"><b /><i /><i /></span><span className="calendar-grid"><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /></span></span>;
  return <span className="example-art art-brief" aria-hidden="true"><span className="brief-ring" /><span className="brief-lines"><i /><i /><i /><i /></span><span className="brief-chip" /></span>;
}
