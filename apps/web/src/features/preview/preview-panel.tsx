import { Group, Panel, Separator, usePanelRef } from "react-resizable-panels";
import { Dialog as DialogPrimitive, Tabs } from "radix-ui";
import { PreviewOverview } from "./preview-overview";
import { useEffect, useRef, useState, type ReactNode, type ReactElement } from "react";
import { useGSAP } from "@gsap/react";
import { gsap } from "gsap";
import { ArrowDownToLine, ArrowUpRight, BookOpen, Check, CircleAlert, Code2, Copy, FileText, Files, Globe2, LayoutDashboard, LoaderCircle, Maximize2, Minimize2, PanelRight, RefreshCw, X } from "lucide-react";
import { artifactPreviewKind, artifactSizeLabel, artifactTypeLabel } from "../chat/ai-elements-adapter";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../components/ui/tooltip";
import { describeApiError, workspaceApiBase, workspaceRequest } from "../workspace/api";
import { FilePreview, type PreviewFile } from "./file-renderer";
import { previewFileKey, previewFileUrl } from "./file-preview-model";
import { usePreview, type PreviewTab } from "./preview-context";
import { usePreviewScroll } from "./use-preview-scroll";
import "./preview-panel.css";

export function PreviewLauncher(): ReactElement | null {
  const preview = usePreview();
  if (!preview) return null;
  return <button type="button" className="preview-launcher" onClick={preview.open ? preview.hide : preview.show} aria-label={preview.open ? "Close workspace viewer" : "Open workspace viewer"} aria-expanded={preview.open}><PanelRight aria-hidden="true" /><span>Workspace</span>{preview.latestFiles.length > 0 && <small>{preview.latestFiles.length}</small>}</button>;
}

function ActionHint({ label, children }: { label: string; children: ReactElement }): ReactElement {
  return <Tooltip delayDuration={450}><TooltipTrigger asChild>{children}</TooltipTrigger><TooltipContent className="viewer-tooltip" side="bottom" sideOffset={6}>{label}</TooltipContent></Tooltip>;
}

interface ReaderPage { requestedUrl: string; finalUrl: string; title: string; text: string; truncated: boolean; fetchedAt: string; contentType: string }
function WebReader({ tab }: { tab: Extract<PreviewTab, { kind: "web" }> }): ReactElement {
  const preview = usePreview()!;
  const updateTitle = useRef(preview.updateWebTitle); updateTitle.current = preview.updateWebTitle;
  const [page, setPage] = useState<ReaderPage | null>(null);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  const [view, setView] = useState<"reader" | "website">("reader");
  useEffect(() => {
    const controller = new AbortController(); setPage(null); setError("");
    void workspaceRequest<ReaderPage>(`/api/web/read?url=${encodeURIComponent(tab.url)}`, { signal: controller.signal }).then((result) => {
      if (typeof result.text !== "string" || typeof result.title !== "string" || result.text.length > 300_000) throw new Error("This page did not return readable text. Open the original website to continue.");
      if (!controller.signal.aborted) { setPage(result); updateTitle.current(tab.id, result.title); }
    }).catch((cause: unknown) => { if (!controller.signal.aborted) setError(describeApiError(cause)); });
    return () => controller.abort();
  }, [tab.id, tab.url, version]);
  return <div className="viewer-web"><div className="viewer-web-controls"><div className="viewer-mode" aria-label="Web view"><button type="button" aria-pressed={view === "reader"} onClick={() => setView("reader")}><BookOpen />Reader</button><button type="button" aria-pressed={view === "website"} disabled={!page} title={!page ? "Available after public page retrieval" : "Show the original public page"} onClick={() => setView("website")}><Globe2 />Website</button></div><ActionHint label="Reload webpage"><button className="viewer-icon" type="button" onClick={() => setVersion((value) => value + 1)} aria-label="Reload webpage"><RefreshCw /></button></ActionHint></div>
    {view === "website" && page ? <><p className="viewer-notice">Some websites block embedded views or require sign-in. If the page is blank, open the original website.</p><iframe key={`${tab.url}:${version}`} className="viewer-website" src={page.finalUrl} title={`Website: ${tab.title}`} sandbox="" referrerPolicy="no-referrer" loading="lazy" /></>
      : error ? <div className="viewer-empty" role="alert"><CircleAlert /><h3>Reader unavailable</h3><p>{error}</p><a href={tab.url} target="_blank" rel="noopener noreferrer">Open original website<ArrowUpRight /></a><button type="button" onClick={() => setVersion((value) => value + 1)}>Try again</button></div>
      : !page ? <div className="viewer-empty" role="status"><LoaderCircle className="research-preview-spinner" /><p>Retrieving readable page content…</p></div>
      : <article className="viewer-article"><small className="viewer-eyebrow">WEB READER</small><h1>{page.title}</h1><p className="viewer-article-meta">{new URL(page.finalUrl).hostname} · Retrieved {new Date(page.fetchedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p><p className="viewer-notice">Public page text retrieved for this viewer. This does not change the agent’s source or verification record.</p><div className="viewer-article-text">{page.text}</div>{page.truncated && <p className="viewer-notice">This is a limited preview. Open the original website for the complete page.</p>}</article>}
  </div>;
}

function FileView({ file, mode }: { file: PreviewFile; mode: "preview" | "source" }) {
  const preview = usePreview()!;
  const download = previewFileUrl(file, "download", workspaceApiBase);
  return <><div className="viewer-file-meta"><span>{artifactTypeLabel(file)}{file.origin === "artifact" ? ` · Revision ${file.revision}` : " · Workspace file"}{file.sizeBytes !== undefined ? ` · ${artifactSizeLabel(file.sizeBytes)}` : ""}</span>{download && <a href={download} download={file.name.split("/").at(-1)} aria-label={`Download original ${file.name.split("/").at(-1)}`}><ArrowDownToLine />Download</a>}</div><FilePreview file={file} files={[...preview.files, file]} mode={mode} onOpenFile={preview.openFile} onOpenWeb={preview.openWeb} onOpenWorkspace={preview.openWorkspace} /></>;
}

function WorkspaceFileView({ tab, mode }: { tab: Extract<PreviewTab, { kind: "workspace" }>; mode: "preview" | "source" }) {
  const viewer = usePreview()!;
  const register = useRef(viewer.registerFile); register.current = viewer.registerFile;
  const [file, setFile] = useState<PreviewFile | null>(null);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setFile(null); setError("");
    const query = new URLSearchParams({ path: tab.path, ...(tab.projectId ? { projectId: tab.projectId } : {}) });
    void workspaceRequest<Omit<PreviewFile, "origin" | "fileId" | "revision">>(`/api/files/metadata?${query}`, { signal: controller.signal }).then((metadata) => {
      if (metadata.path !== tab.path || typeof metadata.name !== "string" || typeof metadata.mimeType !== "string") throw new Error("The file metadata does not match the requested path.");
      if (!controller.signal.aborted) { const resolved: PreviewFile = { ...metadata, origin: "workspace", ...(tab.projectId ? { projectId: tab.projectId } : {}), fileId: tab.path, revision: 1 }; setFile(resolved); register.current(resolved); }
    }).catch((cause: unknown) => { if (!controller.signal.aborted) setError(describeApiError(cause)); });
    return () => controller.abort();
  }, [tab.path, tab.projectId, version]);
  return error ? <div className="viewer-empty" role="alert"><CircleAlert /><h3>File unavailable</h3><p>{error}</p><button type="button" onClick={() => setVersion((value) => value + 1)}>Try again</button></div> : file ? <FileView file={file} mode={mode} /> : <div className="viewer-empty" role="status"><LoaderCircle className="research-preview-spinner" /><p>Opening file…</p></div>;
}

export function PreviewPanel(): ReactElement | null {
  const preview = usePreview()!;
  const [expanded, setExpanded] = useState(false);
  const [narrow, setNarrow] = useState(() => window.matchMedia("(max-width: 1100px)").matches);
  const overlay = expanded || narrow;
  const [showOverview, setShowOverview] = useState(false);
  const [showFiles, setShowFiles] = useState(false);
  const [modes, setModes] = useState<Record<string, "preview" | "source">>({});
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const root = useRef<HTMLElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const overview = useRef<HTMLButtonElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const documentBody = useRef<HTMLDivElement>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const active = preview.tabs.find((tab) => tab.id === preview.activeId);
  const mode = active ? modes[active.id] ?? "preview" : "preview";
  const selectedTab = showFiles ? "files" : showOverview || !active ? "overview" : active.id;
  const showingDocument = selectedTab !== "overview" && selectedTab !== "files";
  const { scrollRef: attachScroll, bodyRef: attachBody, ...scrollHandlers } = usePreviewScroll({ contentKey: JSON.stringify([preview.scope, selectedTab, showingDocument ? mode : null]), layoutKey: overlay ? "modal" : "docked", open: preview.open, scrollRef: scroll, bodyRef: documentBody });
  useEffect(() => { setShowFiles(false); setShowOverview(false); }, [active, preview.open]);
  const address = !showingDocument ? selectedTab === "files" ? "Latest task artifacts and opened project files" : "Task overview · latest turn" : active?.kind === "web" ? active.url : active?.kind === "file" ? active.file.path ?? active.file.name : active?.kind === "workspace" ? active.path : "Files and webpages beside your conversation";
  const projectLabel = (id?: string) => id ? preview.projects.find((project) => project.id === id)?.name ?? "Project files" : "Local workspace";
  const tabDescription = (tab: PreviewTab) => tab.kind === "web" ? `${tab.title} · ${tab.url}` : tab.kind === "workspace" ? `${projectLabel(tab.projectId)} · ${tab.path}` : tab.file.origin === "workspace" ? `${projectLabel(tab.file.projectId)} · ${tab.file.path ?? tab.file.name}` : `${tab.file.path ?? tab.file.name} · Revision ${tab.file.revision}`;
  const sourceAvailable = active?.kind === "file" && !["pdf", "image", "download"].includes(artifactPreviewKind(active.file));
  useEffect(() => { if (preview.open) close.current?.focus(); else setExpanded(false); }, [preview.open, overlay]);
  useEffect(() => { if (active && preview.open) root.current?.querySelector<HTMLElement>('[role="tab"][data-state="active"]')?.focus(); }, [active?.id]);
  useEffect(() => { const media = window.matchMedia("(max-width: 1100px)"); const sync = () => setNarrow(media.matches); media.addEventListener("change", sync); return () => media.removeEventListener("change", sync); }, []);
  useEffect(() => { setCopied(false); setCopyError(""); if (copyTimer.current) clearTimeout(copyTimer.current); }, [active?.id, preview.open, selectedTab]);
  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current); }, []);
  useGSAP(() => { if (!root.current || !preview.open || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return; gsap.fromTo(root.current, { opacity: 0, x: 10 }, { opacity: 1, x: 0, duration: .2, ease: "power2.out", clearProps: "opacity,transform" }); }, { scope: root, dependencies: [preview.open], revertOnUpdate: true });
  if (!preview.open) return null;
  async function copyAddress() { try { await navigator.clipboard.writeText(address!); setCopied(true); if (copyTimer.current) clearTimeout(copyTimer.current); copyTimer.current = setTimeout(() => setCopied(false), 1800); } catch { setCopyError("Clipboard unavailable. Select the address to copy it."); } }
  function closeTab(id: string, button: HTMLButtonElement) {
    const restoreFocus = button === document.activeElement;
    preview.closeTab(id);
    if (restoreFocus) requestAnimationFrame(() => { (root.current?.querySelector<HTMLElement>('[role="tab"][data-state="active"]') ?? overview.current)?.focus(); });
  }
  const pane = <Tabs.Root value={selectedTab} onValueChange={(id) => { preview.select(id); setShowFiles(false); setShowOverview(false); }} asChild><aside ref={root} className={`inspection-panel${expanded ? " is-expanded" : ""}${overlay ? " viewer-modal" : ""}`} aria-label="Workspace viewer" onKeyDown={(event) => {
    if (!overlay && !event.defaultPrevented && event.key === "Escape") { event.preventDefault(); preview.hide(); }
  }}>
    {overlay && <DialogPrimitive.Title className="sr-only">Workspace viewer</DialogPrimitive.Title>}
    <header className="viewer-header"><div><PanelRight /><strong>Workspace</strong><span>{preview.tabs.length ? `${preview.tabs.length} open` : "Viewer"}</span></div><div>
      <ActionHint label="Task overview"><button ref={overview} className="viewer-icon" type="button" onClick={() => { setShowOverview(true); setShowFiles(false); }} aria-label="Task overview" aria-pressed={selectedTab === "overview"}><LayoutDashboard /></button></ActionHint>
      <ActionHint label="Task and project files"><button className="viewer-icon" type="button" onClick={() => { setShowFiles(!showFiles); setShowOverview(false); }} aria-label="Show task files" aria-pressed={showFiles}><Files /></button></ActionHint>
      {!narrow && <ActionHint label={expanded ? "Return to conversation" : "Expand viewer"}><button className="viewer-icon" type="button" onClick={() => setExpanded(!expanded)} aria-label={expanded ? "Exit expanded viewer" : "Expand viewer"}>{expanded ? <Minimize2 /> : <Maximize2 />}</button></ActionHint>}
      <button ref={close} className="viewer-icon" type="button" onClick={preview.hide} aria-label="Close viewer" title="Close viewer (Esc)"><X /></button>
    </div></header>
    {preview.tabs.length > 0 && <Tabs.List className="viewer-tabs" aria-label="Open files and webpages">{preview.tabs.map((tab) => <div className="viewer-tab" data-active={tab.id === selectedTab} key={tab.id}>
      <Tabs.Trigger value={tab.id} title={tabDescription(tab)} aria-label={tabDescription(tab)}>{tab.kind === "web" ? <Globe2 /> : <FileText />}<span>{tab.title}</span>{tab.kind === "file" && tab.file.origin === "artifact" ? <small>v{tab.file.revision}</small> : tab.kind !== "web" && <small className="viewer-tab-project">{projectLabel(tab.kind === "workspace" ? tab.projectId : tab.file.projectId)}</small>}</Tabs.Trigger>
      <button type="button" className="viewer-tab-close" aria-label={`Close ${tab.title}`} title={`Close ${tabDescription(tab)}`} onClick={(event) => closeTab(tab.id, event.currentTarget)}><X /></button>
    </div>)}</Tabs.List>}
    <div className="viewer-address">{showingDocument && active && active.kind !== "web" && (active.kind === "workspace" || active.file.origin === "workspace") && <small className="viewer-address-project" title={projectLabel(active.kind === "workspace" ? active.projectId : active.file.projectId)}>{projectLabel(active.kind === "workspace" ? active.projectId : active.file.projectId)}</small>}<span title={address}>{address}</span>{showingDocument && active && <><ActionHint label={copied ? "Address copied" : "Copy address"}><button type="button" className="viewer-icon" onClick={() => void copyAddress()} aria-label="Copy viewer address">{copied ? <Check /> : <Copy />}</button></ActionHint>{active.kind === "web" && <ActionHint label="Open original website"><a className="viewer-icon" href={active.url} target="_blank" rel="noopener noreferrer" aria-label="Open original website"><ArrowUpRight /></a></ActionHint>}</>}</div>
    {copyError && <p className="viewer-notice" role="status">{copyError}</p>}
    {active && sourceAvailable && showingDocument && <div className="viewer-mode viewer-file-mode" aria-label="File view"><button type="button" aria-pressed={mode === "preview"} onClick={() => setModes((previous) => ({ ...previous, [active.id]: "preview" }))}><BookOpen />Preview</button><button type="button" aria-pressed={mode === "source"} onClick={() => setModes((previous) => ({ ...previous, [active.id]: "source" }))}><Code2 />Source</button></div>}
    <Tabs.Content value={selectedTab} asChild {...(selectedTab === "overview" || selectedTab === "files" ? { "aria-label": selectedTab === "overview" ? "Task overview" : "Task files", "aria-labelledby": undefined } : {})}><div ref={attachScroll} className="viewer-content" {...scrollHandlers}><div ref={attachBody} className="viewer-document">
      {selectedTab === "overview" ? <PreviewOverview runs={preview.runs} onOpenFile={preview.openFile} onOpenWeb={preview.openWeb} /> : selectedTab === "files" || !active ? <section className="viewer-library"><small className="viewer-eyebrow">TASK & PROJECT FILES</small><h2>Your work, within reach</h2><p>Latest saved revisions from this task and project files you have opened. Earlier revisions stay available from their original links.</p>{preview.latestFiles.length ? <div className="viewer-library-list">{preview.latestFiles.map((file) => <button type="button" key={previewFileKey(file)} onClick={() => { preview.openFile(file); setShowFiles(false); }}><FileText /><span><strong>{file.name.split("/").at(-1)}</strong><small title={file.path ?? file.name}>{file.path ?? file.name} · {file.origin === "artifact" ? `Revision ${file.revision}` : projectLabel(file.projectId)}</small></span><ArrowUpRight /></button>)}</div> : <div className="viewer-empty"><Files /><p>Files created by this task will appear here. You can also open files from your project.</p></div>}</section>
        : active.kind === "file" ? <FileView key={active.id} file={active.file} mode={sourceAvailable ? mode : "preview"} />
        : active.kind === "workspace" ? <WorkspaceFileView key={active.id} tab={active} mode={mode} />
        : <WebReader key={active.id} tab={active} />}
    </div></div></Tabs.Content>
    <footer className="viewer-footer"><span>{!showingDocument ? "Your task workspace" : active?.kind === "web" ? "Read alongside your task" : active?.kind === "file" && active.file.origin === "artifact" ? "Saved artifact · original preserved" : "Your local workspace"}</span><span>{expanded && !narrow ? "Esc to return" : "Esc to close"}</span></footer>
  </aside></Tabs.Root>;
  return overlay ? <DialogPrimitive.Root open={preview.open} onOpenChange={(open) => { if (!open) preview.hide(); }}><DialogPrimitive.Portal><DialogPrimitive.Overlay className="viewer-modal-overlay" /><DialogPrimitive.Content asChild aria-describedby={undefined} onOpenAutoFocus={(event) => { event.preventDefault(); close.current?.focus(); }} onCloseAutoFocus={(event) => event.preventDefault()} onEscapeKeyDown={(event) => { if (expanded && !narrow) { event.preventDefault(); setExpanded(false); } }}>{pane}</DialogPrimitive.Content></DialogPrimitive.Portal></DialogPrimitive.Root> : pane;
}

/** Standard OSS layout owns pointer, touch and keyboard resizing. */
export function PreviewLayout({ children }: { children: ReactNode }) {
  const preview = usePreview()!;
  const panel = usePanelRef();
  const lastSize = useRef(48);
  const [narrow, setNarrow] = useState(() => window.matchMedia("(max-width: 1100px)").matches);
  useEffect(() => { const media = window.matchMedia("(max-width: 1100px)"); const sync = () => setNarrow(media.matches); media.addEventListener("change", sync); return () => media.removeEventListener("change", sync); }, []);
  useEffect(() => { if (preview.open && !narrow) panel.current?.resize(`${lastSize.current}%`); else panel.current?.collapse(); }, [preview.open, narrow, panel]);
  return <Group className="workspace-split-layout" orientation="horizontal" id="workspace-viewer-layout" onLayoutChanged={(layout, meta) => { if (meta.isUserInteraction && layout.viewer === 0 && preview.open && !narrow) preview.hide(); }}>
    <Panel id="conversation" minSize="30%" defaultSize="100%">{children}</Panel>
    {preview.open && !narrow && <Separator className="workspace-split-handle" aria-label="Resize workspace viewer" />}
    <Panel id="viewer" panelRef={panel} collapsible collapsedSize="0%" defaultSize="0%" minSize="32%" maxSize="70%" onResize={(size) => { if (size.asPercentage >= 32) lastSize.current = size.asPercentage; }}><PreviewPanel /></Panel>
  </Group>;
}
