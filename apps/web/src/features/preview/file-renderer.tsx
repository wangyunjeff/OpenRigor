import { Component, createContext, lazy, Suspense, useContext, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";
import { CodeBlock, CodeBlockCopyButton, Streamdown, TableCopyDropdown, TableDownloadDropdown, type Components, type ControlsConfig, type CustomRendererProps } from "streamdown";
import { CircleAlert, FileText, LoaderCircle, Maximize2, Minus, Plus, RotateCcw, X } from "lucide-react";
import { MessageResponse } from "../../components/ai-elements/message";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "../../components/ui/dialog";
import { useStreamdownPlugins } from "../../lib/streamdown-plugins";
import { workspaceApiBase } from "../workspace/api";
import { artifactBasename, artifactPreviewKind, parseCsvPreview, safeWebUrl } from "../chat/ai-elements-adapter";
import { linkPreviewMarkdown, previewFileKey, previewFileUrl, previewMarkdownFence, previewSourceLanguage, resolvePreviewFileLink, resolveWorkspacePreviewLink, staticHtmlPreviewDocument, type PreviewFile } from "./file-preview-model";
import "./file-renderer.css";

const PdfPreview = lazy(() => import("./pdf-preview"));
class FilePreviewBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } { return { failed: true }; }
  render(): ReactNode { return this.state.failed ? this.props.fallback : this.props.children; }
}
export type { PreviewFile } from "./file-preview-model";
export interface FilePreviewProps {
  file: PreviewFile;
  files: PreviewFile[];
  mode: "preview" | "source";
  onOpenFile?: (file: PreviewFile) => void;
  onOpenWeb?: (url: string, title?: string) => void;
  onOpenWorkspace?: (path: string, projectId?: string) => void;
}
interface FileTextContent { content: string; mimeType: string; truncated: boolean }
interface FileMarkdownContextValue {
  file: PreviewFile;
  files: PreviewFile[];
  onOpenFile: FilePreviewProps["onOpenFile"];
  onOpenWeb: FilePreviewProps["onOpenWeb"];
  onOpenWorkspace: FilePreviewProps["onOpenWorkspace"];
}
const FileMarkdownContext = createContext<FileMarkdownContextValue | null>(null);

/** Bound both Shiki work and the per-line DOM created by Streamdown's code block. */
function FileSourcePreview({ content, language }: { content: string; language: string }): ReactElement {
  const { code } = useStreamdownPlugins(undefined);
  const [copyError, setCopyError] = useState(false);
  const isLarge = content.length > 64 * 1024 || (content.match(/\n/g)?.length ?? 0) > 1500;
  const plugins = useMemo(() => ({ ...(code ? { code } : {}), renderers: [{ language: "openrigor-source", component: () => <CodeBlock code={content} language={language} role="region" aria-label="File source" tabIndex={0}>
    <CodeBlockCopyButton aria-label="Copy source" onCopy={() => setCopyError(false)} onError={() => setCopyError(true)} />
  </CodeBlock> }] }), [code, content, language]);
  const plainSource = <pre className="file-text-preview" data-language={language} tabIndex={0} aria-label="File source"><code>{content}</code></pre>;
  if (isLarge) return plainSource;
  return <div className="file-source-preview">
    {/* A fixed fence mounts the public renderer under Streamdown's plugin context.
        The actual source stays literal, including fences, HTML and trailing newlines. */}
    <FilePreviewBoundary fallback={<><p className="file-preview-notice" role="status">Syntax highlighting is unavailable. Showing plain source.</p>{plainSource}</>}>
      <Streamdown mode="static" plugins={plugins} skipHtml>{"```openrigor-source\nsource\n```"}</Streamdown>
    </FilePreviewBoundary>
    {copyError ? <p className="file-preview-notice" role="status">Unable to copy. Select the source text and copy it manually.</p> : null}
  </div>;
}

function useFileMarkdownContext(): FileMarkdownContextValue {
  const value = useContext(FileMarkdownContext);
  if (!value) throw new Error("File Markdown components require a preview context.");
  return value;
}

async function readPreviewText(url: string, signal: AbortSignal): Promise<FileTextContent> {
  const response = await fetch(url, { signal, headers: { Accept: "application/json" } });
  const payload = await response.json() as { content?: unknown; mimeType?: unknown; truncated?: unknown; error?: unknown };
  if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "The file preview could not be loaded.");
  if (typeof payload.content !== "string" || payload.content.length > 1024 * 1024 || typeof payload.mimeType !== "string") throw new Error("The API did not return a supported file preview. Download the original to inspect it.");
  return { content: payload.content, mimeType: payload.mimeType, truncated: payload.truncated === true };
}

/** Reset synchronously on identity changes so a previous file never flashes under a new title. */
export function FilePreview(props: FilePreviewProps): ReactElement {
  const key = [previewFileKey(props.file), props.file.contentUrl, props.file.previewUrl].join(":");
  return <FilePreviewContent key={key} {...props} />;
}

/** SVG is only an image resource; its markup never enters the application DOM. */
function FileMarkdownImage({ file, alt }: { file: PreviewFile; alt: string }): ReactElement {
  const kind = artifactPreviewKind(file);
  const contentUrl = previewFileUrl(file, "content", workspaceApiBase);
  const previewUrl = previewFileUrl(file, "preview", workspaceApiBase);
  const [svgUrl, setSvgUrl] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    if (kind !== "svg" || !contentUrl) return;
    const controller = new AbortController();
    let objectUrl: string | undefined;
    void readPreviewText(contentUrl, controller.signal).then((text) => {
      if (text.truncated || text.mimeType !== "image/svg+xml") throw new Error("Download the original file to view this image.");
      if (!controller.signal.aborted) {
        objectUrl = URL.createObjectURL(new Blob([text.content], { type: "image/svg+xml" }));
        setSvgUrl(objectUrl);
      }
    }).catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Image unavailable."); });
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [contentUrl, kind]);
  const source = kind === "svg" ? svgUrl : kind === "image" ? previewUrl : undefined;
  const unavailable = error || (kind === "svg" ? !contentUrl : !previewUrl);
  return <span className="file-markdown-image">{unavailable ? <span className="file-markdown-image-status"><CircleAlert aria-hidden="true" /><span>{alt || file.name} · Image unavailable</span></span> : source ? <img src={source} alt={alt || artifactBasename(file.name)} loading="lazy" onError={() => setError("The image could not be displayed.")} /> : <span className="file-markdown-image-status" role="status"><LoaderCircle className="file-preview-spinner" aria-hidden="true" />Loading image…</span>}</span>;
}

function WorkspaceMarkdownImage({ path, projectId, alt }: { path: string; projectId?: string; alt: string }): ReactElement {
  const [image, setImage] = useState<PreviewFile | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({ path, ...(projectId ? { projectId } : {}) });
    void fetch(`${workspaceApiBase}/api/files/metadata?${query}`, { signal: controller.signal, headers: { Accept: "application/json" } }).then(async (response) => {
      const metadata: unknown = await response.json();
      if (!response.ok || !metadata || typeof metadata !== "object") throw new Error("The referenced image is unavailable.");
      const value = metadata as Record<string, unknown>;
      if (value.path !== path || typeof value.name !== "string" || typeof value.mimeType !== "string" || (value.projectId !== undefined && value.projectId !== projectId)) throw new Error("The image metadata does not match this document.");
      const file: PreviewFile = { origin: "workspace", fileId: path, revision: 1, path, name: value.name, mimeType: value.mimeType, ...(projectId ? { projectId } : {}), ...(typeof value.sha256 === "string" ? { sha256: value.sha256 } : {}), ...(typeof value.contentUrl === "string" ? { contentUrl: value.contentUrl } : {}), ...(typeof value.previewUrl === "string" ? { previewUrl: value.previewUrl } : {}), ...(typeof value.downloadUrl === "string" ? { downloadUrl: value.downloadUrl } : {}) };
      const kind = artifactPreviewKind(file);
      if (!(["image", "svg"].includes(kind)) || !previewFileUrl(file, kind === "svg" ? "content" : "preview", workspaceApiBase)) throw new Error("This reference is not a supported image.");
      if (!controller.signal.aborted) setImage(file);
    }).catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "The referenced image is unavailable."); });
    return () => controller.abort();
  }, [path, projectId]);
  if (image) return <FileMarkdownImage key={previewFileKey(image)} file={image} alt={alt} />;
  return <span className="file-markdown-image-status" role={error ? undefined : "status"}>{error ? <CircleAlert aria-hidden="true" /> : <LoaderCircle className="file-preview-spinner" aria-hidden="true" />}<span>{alt || "Image"} · {error || "Loading referenced image…"}</span></span>;
}

// Context updates reach links and images inside Streamdown's memoized table/paragraph
// nodes while stable component identities preserve expanded document state.
const PreviewMarkdownLink: NonNullable<Components["a"]> = ({ node: _node, href, children, ...props }) => {
  const { file, files, onOpenFile, onOpenWeb, onOpenWorkspace } = useFileMarkdownContext();
  const linked = href ? resolvePreviewFileLink(href, file, files, workspaceApiBase) : undefined;
  const workspacePath = href && !linked ? resolveWorkspacePreviewLink(href, file, workspaceApiBase) : undefined;
  const external = href && !linked ? safeWebUrl(href) : undefined;
  const url = linked ? previewFileUrl(linked, "download", workspaceApiBase) : external;
  if (href?.startsWith("#")) return <a {...props} href={href}>{children}</a>;
  if (workspacePath && onOpenWorkspace) return <button type="button" className="file-document-link" title={props.title} onClick={() => onOpenWorkspace(workspacePath, file.projectId)}>{children}</button>;
  if (!url) return <span className="file-unavailable-link" title="This file is not registered in the current preview.">{children}</span>;
  return <a {...props} href={url} target={linked ? undefined : "_blank"} rel="noreferrer" onClick={(event) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (linked && onOpenFile) { event.preventDefault(); onOpenFile(linked); }
    else if (external && onOpenWeb) { event.preventDefault(); onOpenWeb(external, props.title); }
  }}>{children}</a>;
};

const PreviewMarkdownImage: NonNullable<Components["img"]> = ({ src, alt }) => {
  const { file, files } = useFileMarkdownContext();
  const image = typeof src === "string" ? resolvePreviewFileLink(src, file, files, workspaceApiBase) : undefined;
  const workspacePath = typeof src === "string" && !image ? resolveWorkspacePreviewLink(src, file, workspaceApiBase) : undefined;
  return image && ["image", "svg"].includes(artifactPreviewKind(image))
    ? <FileMarkdownImage key={previewFileKey(image)} file={image} alt={alt ?? ""} />
    : workspacePath ? <WorkspaceMarkdownImage key={JSON.stringify([file.projectId ?? null, workspacePath])} path={workspacePath} {...(file.projectId ? { projectId: file.projectId } : {})} alt={alt ?? ""} />
    : <span className="file-markdown-image-status"><CircleAlert aria-hidden="true" /><span>{alt || "Image"} · No registered image file</span></span>;
};

function FilePreviewContent({ file, files, mode, onOpenFile, onOpenWeb, onOpenWorkspace }: FilePreviewProps): ReactElement {
  const kind = artifactPreviewKind(file);
  const contentUrl = previewFileUrl(file, "content", workspaceApiBase);
  const previewUrl = previewFileUrl(file, "preview", workspaceApiBase);
  const downloadUrl = previewFileUrl(file, "download", workspaceApiBase);
  const needsText = ["markdown", "csv", "code", "text", "svg"].includes(kind);
  const isHtml = file.mimeType.toLowerCase().split(";")[0]?.trim() === "text/html";
  const [text, setText] = useState<FileTextContent | null>(null);
  const [error, setError] = useState("");
  const [svgUrl, setSvgUrl] = useState("");
  const plugins = useStreamdownPlugins(text?.content);
  const previewPlugins = useMemo(() => ({ ...plugins, renderers: [{ language: "mermaid", component: PreviewMarkdownDiagram }] }), [plugins]);
  const markdownContext = useMemo(() => ({ file, files, onOpenFile, onOpenWeb, onOpenWorkspace }), [file, files, onOpenFile, onOpenWeb, onOpenWorkspace]);
  useEffect(() => {
    if (!needsText || !contentUrl) return;
    const controller = new AbortController();
    void readPreviewText(contentUrl, controller.signal).then((body) => {
      if (!controller.signal.aborted) setText(body);
    }).catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "The file preview could not be loaded."); });
    return () => controller.abort();
  }, [contentUrl, needsText]);
  useEffect(() => {
    if (kind !== "svg" || !text || text.truncated || text.mimeType !== "image/svg+xml") return;
    const url = URL.createObjectURL(new Blob([text.content], { type: "image/svg+xml" }));
    setSvgUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [kind, text]);
  const csv = useMemo(() => text && kind === "csv" ? parseCsvPreview(text.content, /\.tsv$/i.test(file.name) || file.mimeType === "text/tab-separated-values" ? "\t" : ",") : null, [text, kind, file.name, file.mimeType]);
  const html = useMemo(() => isHtml && text && !text.truncated ? staticHtmlPreviewDocument(text.content) : "", [isHtml, text]);
  const fallback = <div className="file-preview-empty"><FileText aria-hidden="true" /><strong>Preview unavailable for this file</strong><span>{downloadUrl ? "Download the original file to view its contents." : "This file does not include a verified preview URL."}</span>{downloadUrl ? <a className="file-preview-original" href={downloadUrl} download={artifactBasename(file.name)}>Download original</a> : null}</div>;
  if (error) return <div className="file-preview-empty" role="alert"><CircleAlert aria-hidden="true" /><strong>Unable to preview</strong><span>{error}</span>{downloadUrl ? <a className="file-preview-original" href={downloadUrl} download={artifactBasename(file.name)}>Download original</a> : null}</div>;
  if (mode === "source" && !needsText) return <div className="file-preview-empty"><FileText aria-hidden="true" /><strong>No text source for this file</strong><span>Choose Preview to view this file, or download the original.</span></div>;
  if (kind === "image" && previewUrl) return <div className="file-image-preview"><img src={previewUrl} alt={artifactBasename(file.name)} onError={() => setError("The image could not be loaded. Download the original file to inspect it.")} /></div>;
  if (kind === "pdf" && previewUrl) return <FilePreviewBoundary fallback={fallback}><Suspense fallback={<div className="file-preview-empty" role="status"><LoaderCircle className="file-preview-spinner" aria-hidden="true" /><span>Preparing PDF viewer…</span></div>}><PdfPreview url={previewUrl} name={artifactBasename(file.name)} {...(downloadUrl ? { downloadUrl } : {})} /></Suspense></FilePreviewBoundary>;
  if (needsText && !contentUrl) return fallback;
  if (needsText && !text) return <div className="file-preview-empty" role="status"><LoaderCircle className="file-preview-spinner" aria-hidden="true" /><span>Loading file preview…</span></div>;
  if (!text) return fallback;
  const source = <FileSourcePreview content={text.content} language={previewSourceLanguage(file.name)} />;
  return <div className="file-renderer" data-kind={kind} data-mode={mode}>
    {text.truncated ? <p className="file-preview-notice">Preview shows the beginning of this file. Download the original for the complete contents.</p> : null}
    {mode === "source" ? source
      : isHtml && html ? <div className="file-html-preview"><p className="file-preview-notice">Static preview · Scripts, forms and remote resources are disabled.</p><iframe title={`Static HTML preview: ${artifactBasename(file.name)}`} srcDoc={html} sandbox="" referrerPolicy="no-referrer" /></div>
        : kind === "markdown" ? <div className="file-markdown-preview"><FileMarkdownContext.Provider value={markdownContext}><MessageResponse key={previewFileKey(file)} plugins={previewPlugins} components={previewMarkdownComponents} skipHtml mode="static" isAnimating={false}>{linkPreviewMarkdown(text.content, file, files, workspaceApiBase)}</MessageResponse></FileMarkdownContext.Provider></div>
          : kind === "csv" && csv ? <div className="file-csv-preview"><div className="file-table-scroll"><table><thead><tr>{csv.headers.map((cell, index) => <th key={index}>{cell || `Column ${index + 1}`}</th>)}</tr></thead><tbody>{csv.rows.map((row, index) => <tr key={index}>{csv.headers.map((_header, column) => <td key={column}>{row[column] ?? ""}</td>)}</tr>)}</tbody></table></div><p>{csv.rows.length} {csv.rows.length === 1 ? "row" : "rows"} · {csv.headers.length} {csv.headers.length === 1 ? "column" : "columns"}{csv.truncated ? " · Showing a limited preview" : ""}</p></div>
            : kind === "svg" && svgUrl ? <div className="file-image-preview"><img src={svgUrl} alt={artifactBasename(file.name)} onError={() => setError("The SVG could not be displayed as an image. Download the original to inspect it.")} /></div>
              : source}
  </div>;
}

/** Native Streamdown fullscreen portals sit outside Radix's modal focus boundary. Keep preview tables in a nested Radix layer instead. */
const PreviewMarkdownTable: NonNullable<Components["table"]> = ({ children, node: _node, ...props }) => {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const actions = <><TableCopyDropdown /><TableDownloadDropdown /></>;
  return <div className="file-markdown-table" data-streamdown="table-wrapper">
    <div className="file-markdown-table-actions">{actions}<button ref={triggerRef} type="button" title="View fullscreen" aria-label="View table fullscreen" onClick={() => setOpen(true)}><Maximize2 aria-hidden="true" /></button></div>
    <div className="file-markdown-table-scroll"><table {...props} data-streamdown="table">{children}</table></div>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="file-expanded-preview" showCloseButton={false} onCloseAutoFocus={(event) => { event.preventDefault(); triggerRef.current?.focus(); }}><div className="file-expanded-table" data-streamdown="table-wrapper"><div className="file-expanded-header"><div><DialogTitle>Table</DialogTitle><DialogDescription>Expanded table from this document</DialogDescription></div><div className="file-markdown-table-actions">{actions}<DialogClose asChild><button type="button" title="Exit fullscreen" aria-label="Exit table fullscreen"><X aria-hidden="true" /></button></DialogClose></div></div><div className="file-expanded-body"><table {...props} data-streamdown="table">{children}</table></div></div></DialogContent></Dialog>
  </div>;
};

const previewMarkdownComponents: Components = { table: PreviewMarkdownTable, a: PreviewMarkdownLink, img: PreviewMarkdownImage };

const embeddedDiagramControls: ControlsConfig = { mermaid: { fullscreen: false } };
/** A direct button avoids depending on the event delegation used inside Streamdown's diagram controls. */
function PreviewMarkdownDiagram({ code }: CustomRendererProps): ReactElement {
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [expanded, setExpanded] = useState<{ svg: string; width: number } | null>(null);
  const [imageUrl, setImageUrl] = useState("");
  const [zoom, setZoom] = useState(1);
  const [notice, setNotice] = useState("");
  const [ready, setReady] = useState(false);
  const fence = useMemo(() => previewMarkdownFence(code), [code]);
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const check = (): void => setReady(Boolean(root.querySelector('[data-streamdown="mermaid"] svg[aria-roledescription]')));
    const observer = new MutationObserver(check);
    observer.observe(root, { childList: true, subtree: true });
    check();
    return () => observer.disconnect();
  }, [code]);
  useEffect(() => {
    if (!expanded) { setImageUrl(""); return; }
    const url = URL.createObjectURL(new Blob([expanded.svg], { type: "image/svg+xml" }));
    setImageUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [expanded]);
  const openDiagram = (): void => {
    const svg = rootRef.current?.querySelector<SVGSVGElement>('[data-streamdown="mermaid"] [role="img"][aria-label="Mermaid chart"] > svg[aria-roledescription]');
    if (!svg) { setNotice("The diagram is still rendering. Try again once it is visible."); return; }
    const width = Number(svg.getAttribute("viewBox")?.trim().split(/[\s,]+/)[2]) || svg.getBoundingClientRect().width;
    const Serializer = svg.ownerDocument.defaultView?.XMLSerializer ?? XMLSerializer;
    setZoom(1); setNotice("");
    setExpanded({ svg: new Serializer().serializeToString(svg), width: Math.max(300, width) });
  };
  return <div ref={rootRef} className="file-preview-diagram">
    <button ref={triggerRef} type="button" className="file-preview-diagram-expand" title={ready ? "View fullscreen" : "Preparing diagram…"} aria-label="View diagram fullscreen" disabled={!ready} onClick={openDiagram}><Maximize2 aria-hidden="true" /></button>
    <MessageResponse controls={embeddedDiagramControls} skipHtml mode="static" isAnimating={false}>{`${fence}mermaid\n${code}\n${fence}`}</MessageResponse>
    {notice ? <p className="file-preview-notice" role="status">{notice}</p> : null}
    <Dialog open={Boolean(expanded)} onOpenChange={(open) => { if (!open) setExpanded(null); }}><DialogContent className="file-expanded-preview" showCloseButton={false} onCloseAutoFocus={(event) => { event.preventDefault(); triggerRef.current?.focus(); }}><div className="file-expanded-header"><div><DialogTitle>Diagram</DialogTitle><DialogDescription>Expanded diagram from this document</DialogDescription></div><div className="file-markdown-table-actions"><button type="button" title="Zoom out" aria-label="Zoom diagram out" disabled={zoom <= .5} onClick={() => setZoom((value) => Math.max(.5, value - .25))}><Minus aria-hidden="true" /></button><button type="button" title="Reset zoom" aria-label="Reset diagram zoom" onClick={() => setZoom(1)}><RotateCcw aria-hidden="true" /></button><button type="button" title="Zoom in" aria-label="Zoom diagram in" disabled={zoom >= 3} onClick={() => setZoom((value) => Math.min(3, value + .25))}><Plus aria-hidden="true" /></button><DialogClose asChild><button type="button" title="Exit fullscreen" aria-label="Exit diagram fullscreen"><X aria-hidden="true" /></button></DialogClose></div></div><div className="file-expanded-body">{expanded && imageUrl ? <div className="file-expanded-diagram" style={{ width: zoom === 1 ? "100%" : `${expanded.width * zoom}px` }}><img src={imageUrl} alt="Expanded Mermaid diagram" style={{ width: `${expanded.width * zoom}px`, maxWidth: zoom === 1 ? "100%" : undefined }} /></div> : null}</div></DialogContent></Dialog>
  </div>;
}
