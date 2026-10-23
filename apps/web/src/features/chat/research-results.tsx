import { usePreview } from "../preview/preview-context";
import { useEffect, useMemo, useRef, useState, type ReactElement, type MouseEvent } from "react";
import { useGSAP } from "@gsap/react";
import { gsap } from "gsap";
import { ArrowDownToLine, ArrowUpRight, BookOpen, Check, ChevronDown, Circle, CircleAlert, FileCode2, FileSpreadsheet, FileText, Files, Globe2, Image, ListChecks, LoaderCircle, Maximize2 } from "lucide-react";
import { Artifact, ArtifactDescription, ArtifactHeader, ArtifactTitle } from "../../components/ai-elements/artifact";
import { Plan, PlanContent, PlanDescription, PlanHeader, PlanTitle, PlanTrigger } from "../../components/ai-elements/plan";
import { Source, Sources, SourcesContent, SourcesTrigger } from "../../components/ai-elements/sources";
import type { PlanProjection, SourceProjection } from "../../conversation";
import { workspaceApiBase } from "../workspace/api";
import { artifactBasename, artifactPreviewKind, artifactSizeLabel, artifactTypeLabel, extractAnswerReferences, resolveArtifactUrl, safeWebUrl, sourceDomain, summarizePlan, type ResearchArtifact } from "./ai-elements-adapter";
import "./research-results.css";
import { ActivityGlyph } from "./run-activity";

function useResultEntrance(rootRef: { current: HTMLDivElement | null }, key: string): void {
  useGSAP(() => {
    const root = rootRef.current;
    if (!root || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const cards = root.querySelectorAll("[data-result-card]");
    if (!cards.length) return;
    gsap.fromTo(cards, { autoAlpha: 0, y: 5 }, { autoAlpha: 1, y: 0, duration: .24, stagger: .035, ease: "power2.out", clearProps: "transform,opacity,visibility" });
  }, { scope: rootRef, dependencies: [key], revertOnUpdate: true });
}

export function ResearchPlan({ plan, active }: { plan: PlanProjection; active: boolean }): ReactElement | null {
  const progress = summarizePlan(plan.steps);
  const completed = progress.total > 0 && progress.completed === progress.total;
  const [open, setOpen] = useState(active);
  const previousActive = useRef(active);
  const toolPlan = (plan as PlanProjection & { provenance?: string }).provenance === "tool";
  useEffect(() => { if (previousActive.current && !active) setOpen(false); previousActive.current = active; }, [active]);
  if (!progress.total) return null;
  return <Plan className="research-plan" data-complete={completed} isStreaming={false} open={open} onOpenChange={setOpen}>
    <PlanHeader className="research-plan-header">
      <span className="research-plan-icon" aria-hidden="true"><ListChecks /></span>
      <div className="research-plan-copy"><PlanTitle>Research plan</PlanTitle><PlanDescription>{progress.current ?? (progress.completed === progress.total ? "All planned steps completed" : "The agent's latest plan")}</PlanDescription></div>
      {toolPlan ? <span className="research-plan-provenance">Agent plan</span> : null}<span className="research-plan-count">{progress.completed}<span>/{progress.total}</span></span>
      <PlanTrigger className="research-plan-toggle" aria-label={open ? "Collapse research plan" : "Expand research plan"} />
    </PlanHeader>
    {!completed || active ? <div className="research-plan-progress" role="progressbar" aria-label="Completed plan steps" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.completed}><span style={{ width: `${progress.percent}%` }} /></div> : null}
    <PlanContent className="research-plan-content">
      {plan.explanation ? <p className="research-plan-explanation">{plan.explanation}</p> : null}
      <ol>{plan.steps.map((item, index) => <li key={`${index}:${item.step}`} data-state={item.status}><span className="research-plan-step-mark" aria-hidden="true">{item.status === "completed" ? <Check /> : item.status === "in_progress" ? active ? <ActivityGlyph animated /> : <span className="plan-current-dot" /> : <Circle />}</span><span>{item.step}</span><small>{item.status === "completed" ? "Done" : item.status === "in_progress" ? active ? "In progress" : "Last active" : "Pending"}</small></li>)}</ol>
    </PlanContent>
  </Plan>;
}

export function ResearchSources({ sources, answer }: { sources: SourceProjection[]; answer: string }): ReactElement | null {
  const preview = usePreview();
  const openLink = (event: MouseEvent<HTMLAnchorElement>, url: string, title: string) => { if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && event.button === 0 && preview) { event.preventDefault(); preview.openWeb(url, title); } };
  const searched = sources.filter((source) => source.origin === "web-search" && safeWebUrl(source.url));
  const references = useMemo(() => extractAnswerReferences(answer, sources.map((source) => source.url)), [answer, sources]);
  const domains = Array.from(new Set(searched.map((source) => sourceDomain(source.url))));
  if (!searched.length && !references.length) return null;
  return <div className="research-evidence">
    {searched.length ? <Sources className="research-sources">
      <SourcesTrigger count={searched.length} className="research-sources-trigger"><BookOpen aria-hidden="true" /><strong>{searched.length} search {searched.length === 1 ? "link" : "links"}</strong><span className="research-source-domains">{domains.slice(0, 3).map((domain) => <span key={domain}>{domain}</span>)}{domains.length > 3 ? <span>+{domains.length - 3}</span> : null}</span><ChevronDown aria-hidden="true" /></SourcesTrigger>
      <SourcesContent className="research-sources-content"><p className="research-source-note">Links returned by search or submitted for access. An access attempt does not confirm that the page was retrieved.</p>{searched.map((source, index) => <Source className="research-source-card" href={safeWebUrl(source.url)} title={source.title} key={source.sourceId} onClick={(event) => openLink(event, source.url, source.title)}><span className="research-source-number">{index + 1}</span><span className="research-source-copy"><small>{sourceDomain(source.url)}<em className="research-source-kind">{(source as SourceProjection & { kind?: string }).kind === "page-request" ? "Access attempt" : (source as SourceProjection & { kind?: string }).kind === "search-result" ? "Search result" : "Link"}</em></small><strong>{source.title || sourceDomain(source.url)}</strong>{source.snippet ? <span>{source.snippet}</span> : null}{source.query ? <em>Search: {source.query}</em> : null}</span><ArrowUpRight aria-hidden="true" /></Source>)}</SourcesContent>
    </Sources> : null}
    {references.length ? <Sources className="research-answer-links"><SourcesTrigger className="research-answer-links-trigger" count={references.length}><Globe2 aria-hidden="true" /><span>{references.length} {references.length === 1 ? "link" : "links"} in the answer</span><small>Answer references</small><ChevronDown aria-hidden="true" /></SourcesTrigger><SourcesContent className="research-reference-content"><p>Links included in the answer. A link alone does not show that the agent retrieved the page.</p>{references.map((reference) => <Source key={reference.url} href={reference.url} className="research-reference" onClick={(event) => openLink(event, reference.url, reference.title)}><span>{reference.title}</span><small>{sourceDomain(reference.url)}</small><ArrowUpRight aria-hidden="true" /></Source>)}</SourcesContent></Sources> : null}
  </div>;
}

/** SVG remains an image resource: its markup is never inserted into the document. */
function ArtifactMarkdownImage({ file, alt, variant = "document" }: { file: ResearchArtifact; alt: string; variant?: "document" | "thumbnail" }): ReactElement {
  const kind = artifactPreviewKind(file);
  const contentUrl = resolveArtifactUrl(file.contentUrl, workspaceApiBase);
  const previewUrl = resolveArtifactUrl(file.previewUrl, workspaceApiBase);
  const [svgUrl, setSvgUrl] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    setSvgUrl(""); setError("");
    if (kind !== "svg" || !contentUrl) return;
    const controller = new AbortController();
    let objectUrl: string | undefined;
    void fetch(contentUrl, { signal: controller.signal }).then(async (response) => {
      const body = await response.json() as { content?: unknown; mimeType?: unknown; truncated?: unknown; error?: string };
      if (!response.ok) throw new Error(body.error ?? "The image could not be loaded.");
      if (typeof body.content !== "string" || body.content.length > 1024 * 1024 || body.truncated || body.mimeType !== "image/svg+xml") throw new Error("Download the original file to view this image.");
      if (!controller.signal.aborted) {
        objectUrl = URL.createObjectURL(new Blob([body.content], { type: "image/svg+xml" }));
        setSvgUrl(objectUrl);
      }
    }).catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "The image could not be loaded."); });
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [contentUrl, kind]);
  const source = kind === "svg" ? svgUrl : kind === "image" ? previewUrl : undefined;
  const unavailable = error || (kind === "svg" ? !contentUrl : !previewUrl);
  return <span className={variant === "thumbnail" ? "research-artifact-thumbnail" : "research-markdown-image"}>{unavailable ? <span className="research-markdown-image-status"><CircleAlert aria-hidden="true" /><span>{variant === "thumbnail" ? "Preview unavailable" : `${alt || artifactBasename(file.name)} · Image unavailable`}</span></span> : source ? <img src={source} alt={variant === "thumbnail" ? "" : alt || artifactBasename(file.name)} loading="lazy" onError={() => setError("The image could not be displayed.")} /> : <span className="research-markdown-image-status" role="status"><LoaderCircle className="research-preview-spinner" aria-hidden="true" /><span>{variant === "thumbnail" ? "Loading preview…" : `Loading ${alt || artifactBasename(file.name)}…`}</span></span>}</span>;
}

export function ResearchDeliverables({ files }: { files: ResearchArtifact[] }): ReactElement | null {
  const preview = usePreview();
  const rootRef = useRef<HTMLDivElement>(null);
  useResultEntrance(rootRef, files.map((file) => file.fileId).join(":"));
  if (!files.length) return null;
  return <div ref={rootRef} className="research-deliverables">
    <div className="research-section-heading"><Files aria-hidden="true" /><h3>Deliverables</h3><span>{files.length}</span></div>
    <div className="research-deliverable-grid">{files.map((file) => {
      const kind = artifactPreviewKind(file);
      const hasImagePreview = kind === "image" || kind === "svg";
      const Icon = kind === "csv" ? FileSpreadsheet : ["image", "svg"].includes(kind) ? Image : kind === "code" ? FileCode2 : FileText;
      const downloadUrl = resolveArtifactUrl(file.downloadUrl, workspaceApiBase);
      return <Artifact className="research-deliverable" data-result-card data-preview-kind={kind} key={file.fileId}><ArtifactHeader><button type="button" className={`research-deliverable-open${hasImagePreview ? " has-image-preview" : ""}`} onClick={() => preview?.openArtifact(file)} aria-label={`Preview ${artifactBasename(file.name)}`}>{hasImagePreview ? <ArtifactMarkdownImage file={file} alt="" variant="thumbnail" /> : <span className={`research-file-icon kind-${kind}`}><Icon aria-hidden="true" /></span>}<span className="research-deliverable-summary"><ArtifactTitle>{artifactBasename(file.name)}</ArtifactTitle><ArtifactDescription>{artifactTypeLabel(file)}</ArtifactDescription></span><Maximize2 aria-hidden="true" /></button></ArtifactHeader><div className="research-deliverable-meta"><span>{[artifactSizeLabel(file.sizeBytes), `Revision ${file.revision}`].filter(Boolean).join(" · ")}</span>{downloadUrl ? <a href={downloadUrl} download={artifactBasename(file.name)} aria-label={`Download ${artifactBasename(file.name)}`} title="Download original"><ArrowDownToLine aria-hidden="true" /></a> : <span>Event only</span>}</div></Artifact>;
    })}</div>

  </div>;
}
