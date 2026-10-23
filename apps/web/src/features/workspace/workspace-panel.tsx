import { usePreview } from "../preview/preview-context";
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactElement, type ReactNode } from "react";
import {
  ArrowDownToLine, ArrowLeft, ArrowRight, ArrowUp, BookOpen, Bot, Check, CheckCircle2,
  ChevronRight, CircleAlert, CircleHelp, Clock3, Code2, Compass, Copy, Cpu, File,
  FileText, FlaskConical, Folder, FolderOpen, Image, ImagePlus, Layers3, LoaderCircle, Monitor,
  Moon, Pencil, Pin, Plus, RefreshCw, Search, Settings2, ShieldCheck, Sparkles, Sun,
  Terminal, Trash2, UserRound, UsersRound, WandSparkles, X, type LucideIcon
} from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../components/ui/dialog";
import { Button } from "../../components/ui/button";
import {
  conversationTitle, describeApiError, downloadWorkspaceFile, formatRelativeTime, imageFileUrl, workspaceApiBase, workspaceRequest,
  type WorkspaceConversation, type WorkspaceImage, type WorkspaceKnowledge, type WorkspaceOverview,
  type WorkspaceProfile, type WorkspaceProject, type WorkspaceSettings, type WorkspaceSkill
} from "./api";
import { directoryBreadcrumbs, fileBrowserPath, fileBrowserScope, knowledgeContentLimit, knowledgeSaveRequest, knowledgeTitleLimit, projectDraft, reconcileProjectDrafts, reconcileSettingsDraft, type KnowledgeDraft, type ProjectDraft } from "./workspace-detail";
import { TaskSurface } from "./task-surface";
import "./workspace-detail.css";

export type WorkspacePanelId = "images" | "skills" | "projects" | "agent" | "search" | "settings" | "workspace" | "research" | "guides" | "handoff";

export interface WorkspacePanelProps {
  panel: WorkspacePanelId | null;
  onClose: () => void;
  onOpenRun: (runId: string) => void | Promise<void>;
  onThemeChange: (theme: "light" | "dark" | "system") => void;
  onSelectProject: (project: WorkspaceProject | null) => void;
  onCompose: (prompt: string) => void;
  theme?: "light" | "dark" | "system";
  presentation?: "inline" | "dialog";
  onChanged?: () => void;
  onProfileChange?: (profile: WorkspaceProfile) => void;
  createProject?: boolean;
}

const panelTitles: Record<WorkspacePanelId, string> = {
  images: "Image Generation", skills: "Skill Market", projects: "Projects", agent: "Agent",
  search: "Search", settings: "Settings", workspace: "Personal workspace", research: "Research cases",
  guides: "Guides", handoff: "Continue your work"
};

const panelIcons: Record<WorkspacePanelId, LucideIcon> = {
  images: Image, skills: WandSparkles, projects: Folder, agent: Bot, search: Search, settings: Settings2,
  workspace: UsersRound, research: FlaskConical, guides: Compass, handoff: Layers3
};

function Busy({ label = "Loading workspace…" }: { label?: string }): ReactElement {
  return <div className="ws-busy" role="status"><LoaderCircle className="ws-spin" /><span>{label}</span></div>;
}

function ErrorNotice({ error, onRetry }: { error: string; onRetry?: () => void }): ReactElement {
  return <div className="ws-error" role="alert"><CircleAlert /><span>{error}</span>{onRetry && <button type="button" onClick={onRetry}><RefreshCw />Retry</button>}</div>;
}

function Empty({ icon: Icon, title, children, action }: { icon: LucideIcon; title: string; children: ReactNode; action?: ReactNode }): ReactElement {
  return <div className="ws-empty"><span className="ws-empty-icon"><Icon /></span><h3>{title}</h3><p>{children}</p>{action}</div>;
}

function SaveButton({ busy, children = "Save changes", ...props }: { busy: boolean; children?: ReactNode; type?: "submit" | "button"; disabled?: boolean; onClick?: () => void }): ReactElement {
  return <Button className="ws-button ws-button-primary" disabled={busy || props.disabled} type={props.type ?? "submit"} {...(props.onClick ? { onClick: props.onClick } : {})}>{busy ? <LoaderCircle className="ws-spin" /> : <Check />}{children}</Button>;
}

export function WorkspacePanel(props: WorkspacePanelProps): ReactElement | null {
  const { panel, onClose, presentation = "inline" } = props;
  const [overview, setOverview] = useState<WorkspaceOverview | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => { setVersion((value) => value + 1); props.onChanged?.(); }, [props.onChanged]);
  useEffect(() => {
    if (!panel) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    void workspaceRequest<WorkspaceOverview>("/api/workspace", { signal: controller.signal }).then((value) => {
      setOverview(value);
    }).catch((cause: unknown) => { if (!controller.signal.aborted) setError(describeApiError(cause)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [panel, version]);

  if (!panel) return null;
  const Icon = panelIcons[panel];
  const content = <div className={`ws-panel ws-panel-${panel}${presentation === "dialog" ? " ws-panel-modal" : ""}`}>
    <header className="ws-page-header"><div>{panel === "research" || panel === "guides" || panel === "handoff" ? <button type="button" className="ws-text-button" onClick={onClose}><ArrowLeft />Back</button> : <Icon />}<h1>{panelTitles[panel]}</h1>{panel === "images" && <span className="ws-badge">Studio</span>}</div><button type="button" className="ws-icon-button" onClick={onClose} aria-label="Back to chat" title="Back to chat"><X /></button></header>
    <div className={`ws-page-body${panel === "images" ? " ws-image-body" : ""}`}>
      {error && <ErrorNotice error={error} onRetry={refresh} />}
      {panel === "research" ? <ResearchPanel onCompose={props.onCompose} /> : panel === "guides" ? <GuidesPanel onCompose={props.onCompose} /> : loading && !overview ? <Busy /> : overview ? <>
        {panel === "images" && <ImagesPanel initialImages={overview.images ?? []} configured={Boolean(overview.runtime.imageGenerationConfigured)} onChanged={refresh} />}
        {panel === "skills" && <SkillsPanel skills={overview.skills ?? []} onChanged={refresh} />}
        {panel === "projects" && <ProjectsPanel overview={overview} onChanged={refresh} onSelectProject={props.onSelectProject} onOpenRun={props.onOpenRun} createProject={Boolean(props.createProject)} />}
        {panel === "search" && <TaskSurface conversations={overview.conversations ?? []} projects={overview.projects} onOpenRun={props.onOpenRun} onChanged={refresh} />}
        {panel === "handoff" && <HandoffPanel overview={overview} onOpenRun={props.onOpenRun} onSelectProject={props.onSelectProject} onCompose={props.onCompose} />}
        {(panel === "settings" || panel === "agent" || panel === "workspace") && <SettingsPanel overview={overview} initialTab={panel === "agent" ? "agent" : panel === "workspace" ? "workspace" : "profile"} theme={props.theme ?? "system"} onThemeChange={props.onThemeChange} onProfileChange={props.onProfileChange} onChanged={refresh} />}
      </> : null}
    </div>
  </div>;
  if (presentation === "dialog") return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}><DialogContent className="ws-dialog" showCloseButton={false}><DialogTitle className="sr-only">{panelTitles[panel]}</DialogTitle><DialogDescription className="sr-only">Manage your OpenRigor workspace.</DialogDescription>{content}</DialogContent></Dialog>;
  return content;
}

function ImagesPanel({ initialImages, configured, onChanged }: { initialImages: WorkspaceImage[]; configured: boolean; onChanged: () => void }): ReactElement {
  const [images, setImages] = useState(initialImages);
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState("gpt-image-2.5-sunburst");
  const [size, setSize] = useState("1k");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<WorkspaceImage | null>(null);
  const [referenceImage, setReferenceImage] = useState<WorkspaceImage | null>(null);
  useEffect(() => setImages(initialImages), [initialImages]);

  async function generate(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!prompt.trim() || busy) return;
    setBusy(true); setError("");
    try {
      const result = await workspaceRequest<{ image: WorkspaceImage }>("/api/images/generations", { method: "POST", body: { prompt: prompt.trim(), model, size, quality: "high", ...(referenceImage ? { referenceImageId: referenceImage.id } : {}) } });
      setImages((items) => [result.image, ...items.filter((item) => item.id !== result.image.id)]);
      onChanged();
    } catch (cause) { setError(describeApiError(cause)); }
    finally { setBusy(false); }
  }

  async function copyPrompt(image: WorkspaceImage): Promise<void> {
    try { await navigator.clipboard.writeText(image.prompt); setCopiedId(image.id); }
    catch { setPrompt(image.prompt); }
  }

  async function archiveImage(image: WorkspaceImage): Promise<void> {
    setError("");
    try { await workspaceRequest(`/api/images/${encodeURIComponent(image.id)}`, { method: "DELETE" }); setImages((items) => items.filter((item) => item.id !== image.id)); if (referenceImage?.id === image.id) setReferenceImage(null); onChanged(); }
    catch (cause) { setError(describeApiError(cause)); }
  }

  async function downloadImage(image: WorkspaceImage): Promise<void> {
    setError("");
    const extension = image.mimeType === "image/jpeg" ? "jpg" : image.mimeType === "image/webp" ? "webp" : "png";
    try { await downloadWorkspaceFile(imageFileUrl(image), `openrigor-${image.id}.${extension}`); }
    catch (cause) { setError(describeApiError(cause)); }
  }

  return <div className="ws-image-studio">
    <div className="ws-image-gallery">
      {images.length === 0 && !busy ? <Empty icon={Image} title="Give your ideas a new form">Create diagrams, illustrations, and visual explorations. Your original images stay in this local workspace.</Empty> : <div className="ws-image-grid">
        {busy && <div className="ws-generating-tile" role="status"><Sparkles className="ws-generation-spark" /><strong>Creating your image</strong><p>The image model is working on your prompt.</p><LoaderCircle className="ws-spin" /></div>}
        {images.map((image) => <article className="ws-image-tile" key={image.id}>
          <button type="button" className="ws-image-open" onClick={() => setExpanded(image)} aria-label={`View image: ${image.prompt}`}><img src={imageFileUrl(image)} alt={image.prompt} loading="lazy" /></button>
          <div className="ws-image-hover"><span>{image.model.replace("gpt-", "GPT ")}</span><div><button type="button" onClick={() => { void copyPrompt(image); }} aria-label="Copy prompt" title="Copy prompt">{copiedId === image.id ? <Check /> : <Copy />}</button><button type="button" onClick={() => { setReferenceImage(image); setPrompt("Create a variation of this image: "); }} aria-label="Use as reference" title="Use as reference"><ImagePlus /></button><button type="button" onClick={() => { void downloadImage(image); }} aria-label="Download original" title="Download original"><ArrowDownToLine /></button><button type="button" onClick={() => { void archiveImage(image); }} aria-label="Remove from gallery" title="Remove from gallery (original is preserved)"><Trash2 /></button></div></div>
        </article>)}
      </div>}
    </div>
    <div className="ws-image-composer-region">
      {error && <ErrorNotice error={error} />}
      {!configured && <div className="ws-inline-note"><ShieldCheck /><span>Configure the image provider key in the server environment or <code>.env.imagegen.local</code> to generate images.</span></div>}
      <form className="ws-image-composer" onSubmit={(event) => { void generate(event); }}>
        {referenceImage && <div className="ws-reference-chip"><img src={imageFileUrl(referenceImage)} alt="Selected reference" /><span>Reference image</span><button type="button" disabled={busy} onClick={() => setReferenceImage(null)} aria-label="Remove reference image"><X /></button></div>}
        <label className="sr-only" htmlFor="ws-image-prompt">Image prompt</label><textarea id="ws-image-prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Describe the image you want to create…" rows={3} maxLength={16000} disabled={busy} onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} />
        <div className="ws-image-toolbar"><WandSparkles /><label><span className="sr-only">Image model</span><select value={model} onChange={(event) => setModel(event.target.value)} disabled={busy}><option value="gpt-image-2.5-sunburst">GPT Image 2.5 Sunburst</option><option value="gpt-image-2.5-flare">GPT Image 2.5 Flare</option><option value="gpt-image-2">GPT Image 2</option></select></label><label><span className="sr-only">Image resolution</span><select value={size} onChange={(event) => setSize(event.target.value)} disabled={busy}><option value="1k">1K</option><option value="2k">2K</option><option value="4k">4K</option></select></label><details className="ws-template-picker"><summary>Templates</summary><div>{imageTemplates.map((item) => <button key={item.title} type="button" onClick={() => setPrompt(item.prompt)}><span>{item.title}</span><ArrowRight /></button>)}</div></details><button className="ws-generate-button" type="submit" disabled={!configured || !prompt.trim() || busy} aria-label="Generate image">{busy ? <LoaderCircle className="ws-spin" /> : <ArrowUp />}</button></div>
      </form><p className="ws-composer-footnote">High quality · Original files saved locally · ⌘ / Ctrl + Enter to generate</p>
    </div>
    <Dialog open={expanded !== null} onOpenChange={(open) => { if (!open) setExpanded(null); }}><DialogContent className="ws-image-preview-dialog"><DialogTitle className="sr-only">Generated image</DialogTitle><DialogDescription className="sr-only">The original generated image and prompt.</DialogDescription>{expanded && <><img className="ws-full-image" src={imageFileUrl(expanded)} alt={expanded.prompt} /><p className="ws-image-caption">{expanded.prompt}</p>{error && <ErrorNotice error={error} />}<button type="button" className="ws-button ws-button-primary" onClick={() => { void downloadImage(expanded); }}><ArrowDownToLine />Download original</button></>}</DialogContent></Dialog>
  </div>;
}

const imageTemplates = [
  { title: "Research figure", prompt: "Create a clear publication-ready scientific schematic illustrating [research process]. Use a white background, restrained blue and green palette, precise arrows, legible concise English labels, and a clean two-dimensional layout." },
  { title: "Editorial illustration", prompt: "An original editorial illustration about [topic]. Thoughtful composition, tactile paper texture, limited muted colors, soft natural light, and a distinctive visual metaphor. No logos or text." },
  { title: "Product concept", prompt: "A polished product concept photograph of [product], photographed in a quiet studio with soft directional lighting, subtle shadows, beautiful materials, and a warm neutral background. No text or branding." }
];

function SkillsPanel({ skills, onChanged }: { skills: WorkspaceSkill[]; onChanged: () => void }): ReactElement {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All skills");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<WorkspaceSkill | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const categories = ["All skills", "Installed", ...new Set(skills.map((item) => item.category || "General"))];
  const filtered = skills.filter((item) => (category === "All skills" || category === "Installed" && item.installed || item.category === category || !item.category && category === "General") && `${item.name ?? item.label} ${item.description}`.toLowerCase().includes(query.toLowerCase()));

  async function toggleSkill(skill: WorkspaceSkill): Promise<void> {
    setPending(skill.id); setError("");
    try { await workspaceRequest(`/api/skills/${encodeURIComponent(skill.id)}/install`, { method: skill.installed ? "DELETE" : "POST", body: {} }); onChanged(); setSelected(null); }
    catch (cause) { setError(describeApiError(cause)); }
    finally { setPending(null); }
  }

  async function addSkill(event: FormEvent): Promise<void> {
    event.preventDefault(); setPending("new"); setError("");
    try { await workspaceRequest("/api/skills", { method: "POST", body: { name: name.trim(), description: description.trim(), instructions: instructions.trim(), category: "Custom" } }); setAdding(false); setName(""); setDescription(""); setInstructions(""); onChanged(); }
    catch (cause) { setError(describeApiError(cause)); }
    finally { setPending(null); }
  }

  return <div className="ws-market"><p className="ws-lead">Add reusable expertise to your agent. Installed skills can be selected with <kbd>/</kbd> in any task.</p><div className="ws-market-toolbar"><label className="ws-search-field"><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search skills" aria-label="Search skills" /></label><Button className="ws-button ws-button-primary" onClick={() => setAdding(true)}><Plus />Add skill</Button></div><div className="ws-category-tabs" role="tablist" aria-label="Skill categories">{categories.map((item) => <button type="button" role="tab" aria-selected={category === item} className={category === item ? "active" : ""} key={item} onClick={() => setCategory(item)}>{item}{item === "Installed" && <span>{skills.filter((skill) => skill.installed).length}</span>}</button>)}</div>{error && <ErrorNotice error={error} />}
    {filtered.length ? <div className="ws-skill-grid">{filtered.map((skill, index) => { const Icon = skillIcon(skill.category, index); return <article className="ws-skill-card" key={skill.id}><button type="button" className="ws-skill-open" onClick={() => setSelected(skill)}><span className={`ws-skill-icon ws-tone-${index % 5}`}><Icon /></span><h2>{skill.name ?? skill.label}</h2><p>{skill.description}</p></button><footer><span><span className="ws-mini-logo">O</span>{skill.category === "Custom" ? "Your workspace" : "OpenRigor"}</span><button type="button" className={`ws-install-button${skill.installed ? " installed" : ""}`} disabled={pending === skill.id} onClick={() => { void toggleSkill(skill); }}>{pending === skill.id ? <LoaderCircle className="ws-spin" /> : skill.installed ? <Check /> : <Plus />}{skill.installed ? "Installed" : "Install"}</button></footer></article>; })}</div> : <Empty icon={Search} title="No matching skills">Try another search or add a skill with your own instructions.</Empty>}
    <Dialog open={adding} onOpenChange={setAdding}><DialogContent className="ws-form-dialog"><DialogTitle>Add a skill</DialogTitle><DialogDescription>Create reusable instructions for your agent.</DialogDescription><form className="ws-form" onSubmit={(event) => { void addSkill(event); }}><label>Name<input required maxLength={100} value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Evidence review" /></label><label>Description<input required maxLength={500} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What does this skill help with?" /></label><label>Instructions<textarea required rows={8} maxLength={16000} value={instructions} onChange={(event) => setInstructions(event.target.value)} placeholder="Describe the workflow, constraints, and expected output…" /></label>{error && <ErrorNotice error={error} />}<div className="ws-form-actions"><Button type="button" className="ws-button" onClick={() => setAdding(false)}>Cancel</Button><SaveButton busy={pending === "new"}>Create skill</SaveButton></div></form></DialogContent></Dialog>
    <Dialog open={selected !== null} onOpenChange={(open) => { if (!open) setSelected(null); }}><DialogContent className="ws-form-dialog"><DialogTitle>{selected?.name ?? selected?.label}</DialogTitle><DialogDescription>{selected?.description}</DialogDescription>{selected && <><span className="ws-badge">{selected.category || "General"}</span><div className="ws-instructions-preview">{selected.instructions || "Install this skill to make its workflow available in your task composer."}</div><div className="ws-form-actions"><button type="button" className="ws-button ws-button-primary" disabled={pending === selected.id} onClick={() => { void toggleSkill(selected); }}>{pending === selected.id ? <LoaderCircle className="ws-spin" /> : selected.installed ? <Check /> : <Plus />}{selected.installed ? "Remove from workspace" : "Install skill"}</button></div></>}</DialogContent></Dialog>
  </div>;
}

function skillIcon(category: string | undefined, index: number): LucideIcon {
  const text = category?.toLowerCase() ?? "";
  if (text.includes("research")) return FlaskConical;
  if (text.includes("code") || text.includes("engineer")) return Code2;
  if (text.includes("document")) return FileText;
  return [WandSparkles, BookOpen, Compass, Terminal, Layers3][index % 5] ?? WandSparkles;
}

function ProjectsPanel({ overview, onChanged, onSelectProject, onOpenRun, createProject = false }: { overview: WorkspaceOverview; onChanged: () => void; onSelectProject: WorkspacePanelProps["onSelectProject"]; onOpenRun: WorkspacePanelProps["onOpenRun"]; createProject?: boolean }): ReactElement {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, ProjectDraft>>({});
  const [creationDraft, setCreationDraft] = useState<ProjectDraft>({ name: "", description: "", instructions: "", dirty: false });
  const [savedProject, setSavedProject] = useState<WorkspaceProject | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"overview" | "knowledge" | "files" | "tasks">("overview");
  const project = overview.projects.find((item) => item.id === selectedId) ?? (savedProject?.id === selectedId ? savedProject : undefined);
  const draft = project ? drafts[project.id] ?? projectDraft(project) : creationDraft;
  useEffect(() => setDrafts((current) => reconcileProjectDrafts(current, overview.projects)), [overview.projects]);
  const openCreation = useCallback(() => { setCreating(true); setError(""); }, []);
  useEffect(() => { if (createProject || new URLSearchParams(window.location.search).get("create") === "1") openCreation(); }, [createProject, openCreation]);
  useEffect(() => { window.addEventListener("openrigor:new-project", openCreation); return () => window.removeEventListener("openrigor:new-project", openCreation); }, [openCreation]);

  function updateDraft(field: "name" | "description" | "instructions", value: string): void {
    setError("");
    if (creating || !project) setCreationDraft((current) => ({ ...current, [field]: value, dirty: true }));
    else setDrafts((current) => ({ ...current, [project.id]: { ...(current[project.id] ?? projectDraft(project)), [field]: value, dirty: true } }));
  }

  async function saveProject(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (busy) return;
    const submitted = creating ? creationDraft : draft;
    if (!submitted.name.trim()) return;
    const editingProject = !creating ? project : undefined;
    setBusy(true); setError("");
    try {
      const result = await workspaceRequest<{ project: WorkspaceProject }>(editingProject ? `/api/projects/${encodeURIComponent(editingProject.id)}` : "/api/projects", { method: editingProject ? "PATCH" : "POST", body: { name: submitted.name.trim(), description: submitted.description.trim(), instructions: submitted.instructions.trim() } });
      setDrafts((current) => ({ ...current, [result.project.id]: projectDraft(result.project) }));
      setSavedProject(result.project); setSelectedId(result.project.id); setCreating(false);
      if (!editingProject) setCreationDraft({ name: "", description: "", instructions: "", dirty: false });
      onChanged();
    } catch (cause) { setError(describeApiError(cause)); }
    finally { setBusy(false); }
  }

  return <div className="ws-projects"><div className="ws-section-heading"><div><h2>One project. Everything connected.</h2><p>Keep related tasks, instructions, and knowledge together.</p></div><Button className="ws-button ws-button-primary" disabled={busy} onClick={openCreation}><Plus />New project</Button></div>{error && !creating && <ErrorNotice error={error} />}
    {!project ? overview.projects.length ? <div className="ws-project-grid">{overview.projects.map((item) => <button type="button" className="ws-project-card" key={item.id} onClick={() => { setSelectedId(item.id); setTab("overview"); setError(""); }}><span className="ws-project-symbol"><Folder /></span><h3>{item.name}</h3><p>{item.description || "A shared context for related work."}</p><footer><span>{overview.conversations.filter((task) => task.projectId === item.id).length} tasks{drafts[item.id]?.dirty && <span className="ws-draft-indicator">Draft</span>}</span><ChevronRight /></footer></button>)}</div> : <Empty icon={FolderOpen} title="Make space for a project">Create a project to give related tasks a shared set of instructions and source material.</Empty> : <div className="ws-project-detail"><button className="ws-text-button" type="button" disabled={busy} onClick={() => { setSelectedId(null); setCreating(false); setError(""); }}><ArrowLeft />All projects</button><div className="ws-project-title"><Folder /><h2>{project.name}</h2><button type="button" className="ws-button ws-button-primary" onClick={() => onSelectProject(project)}><ArrowRight />Use in chat</button></div>
      <div className="ws-category-tabs" role="tablist" aria-label="Project details">{(["overview", "knowledge", "files", "tasks"] as const).map((item) => <button key={item} type="button" role="tab" aria-selected={tab === item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{item.charAt(0).toUpperCase() + item.slice(1)}</button>)}</div>
      {tab === "overview" && <form className="ws-form ws-project-form" onSubmit={(event) => { void saveProject(event); }}><label>Project name<input value={draft.name} onChange={(event) => updateDraft("name", event.target.value)} disabled={busy} required maxLength={100} placeholder="e.g. Literature review" /></label><label>Description<textarea rows={2} maxLength={2000} value={draft.description} disabled={busy} onChange={(event) => updateDraft("description", event.target.value)} placeholder="What are you working towards?" /></label><label>Project instructions<span className="ws-field-hint">These instructions are included when the agent works on this project.</span><textarea rows={7} maxLength={16000} value={draft.instructions} disabled={busy} onChange={(event) => updateDraft("instructions", event.target.value)} placeholder="Provide context, preferred methods, constraints, and expectations…" /></label>{project.path && <div className="ws-detail-row"><Folder /><span>Local directory</span><code>{project.path}</code></div>}<div className="ws-form-actions ws-project-save-actions"><span className={`ws-project-save-state${draft.dirty ? " is-dirty" : ""}`} role="status">{busy ? "Saving project…" : draft.dirty ? "Unsaved draft · kept while you browse projects" : "All changes saved"}</span><SaveButton busy={busy} disabled={!draft.name.trim() || !draft.dirty}>Save changes</SaveButton></div></form>}
      <div hidden={tab !== "knowledge"}><KnowledgePanel key={project.id} project={project} items={overview.knowledge.filter((item) => item.projectId === project.id)} onChanged={onChanged} /></div>
      {project && tab === "files" && <FilesPanel key={project.id} projectId={project.id} />}
      {project && tab === "tasks" && <TaskSurface conversations={overview.conversations} projects={overview.projects} projectId={project.id} onOpenRun={onOpenRun} onChanged={onChanged} compact />}
    </div>}
    <Dialog open={creating} onOpenChange={(open) => { if (!busy) { setCreating(open); setError(""); } }}><DialogContent className="ws-form-dialog"><DialogTitle>New project</DialogTitle><DialogDescription>One directory for related tasks, instructions, and source material.</DialogDescription><form className="ws-form" onSubmit={(event) => { void saveProject(event); }}><label>Project name<input autoFocus required disabled={busy} maxLength={100} value={creationDraft.name} onChange={(event) => updateDraft("name", event.target.value)} placeholder="Name your project" /></label><label>Source folder<div className="ws-source-folder"><Folder /><span>New folder in the local workspace</span><span className="ws-badge">Local</span></div><span className="ws-field-hint">A dedicated directory is created for this project. Add or edit project instructions after creation.</span></label><label>Description <span className="ws-field-hint">Optional</span><textarea rows={2} disabled={busy} maxLength={2000} value={creationDraft.description} onChange={(event) => updateDraft("description", event.target.value)} placeholder="What will you work on?" /></label>{error && <ErrorNotice error={error} />}<div className="ws-form-actions"><Button className="ws-button" type="button" disabled={busy} onClick={() => { setCreating(false); setError(""); }}>Cancel</Button><SaveButton busy={busy} disabled={!creationDraft.name.trim()}>Create project</SaveButton></div></form></DialogContent></Dialog>
  </div>;
}

function KnowledgePanel({ project, items, onChanged }: { project: WorkspaceProject; items: WorkspaceKnowledge[]; onChanged: () => void }): ReactElement {
  const [visibleItems, setVisibleItems] = useState(items);
  const sourceItems = useRef(items);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, KnowledgeDraft>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const draftKey = editingId ?? "new";
  const draft = drafts[draftKey] ?? { id: editingId, name: "", content: "" };
  useEffect(() => {
    // A parent refresh first re-renders its previous overview; keep the acknowledged save until new server data arrives.
    if (sourceItems.current.length === items.length && sourceItems.current.every((item, index) => item === items[index])) return;
    sourceItems.current = items;
    setVisibleItems(items);
  }, [items]);

  function openEditor(item?: WorkspaceKnowledge): void {
    if (busy) return;
    const id = item?.id ?? null;
    const key = id ?? "new";
    setDrafts((current) => current[key] ? current : { ...current, [key]: { id, name: item?.name ?? "", content: item?.content ?? "" } });
    setEditingId(id); setEditorOpen(true); setError(""); setSaved("");
    if (item) setExpanded(item.id);
  }

  function updateDraft(field: "name" | "content", value: string): void {
    setDrafts((current) => ({ ...current, [draftKey]: { ...draft, [field]: value } }));
    setError(""); setSaved("");
  }

  async function save(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError(""); setSaved("");
    try {
      const request = knowledgeSaveRequest(draft, project.id);
      const result = await workspaceRequest<{ item: WorkspaceKnowledge }>(request.path, { method: request.method, body: request.body });
      setVisibleItems((current) => draft.id === null ? [...current, result.item] : current.map((item) => item.id === result.item.id ? result.item : item));
      setDrafts((current) => { const next = { ...current }; delete next[draftKey]; return next; });
      setExpanded(result.item.id); setEditorOpen(false); setSaved(draft.id === null ? "Knowledge added" : "Knowledge updated");
      onChanged();
    }
    catch (cause) { setError(describeApiError(cause)); }
    finally { setBusy(false); }
  }
  async function remove(id: string): Promise<void> {
    if (busy) return;
    setBusy(true); setError(""); setSaved("");
    try {
      await workspaceRequest(`/api/knowledge/${encodeURIComponent(id)}`, { method: "DELETE" });
      setVisibleItems((current) => current.filter((item) => item.id !== id));
      setDrafts((current) => { const next = { ...current }; delete next[id]; return next; });
      if (editingId === id) setEditorOpen(false);
      setSaved("Knowledge removed"); onChanged();
    }
    catch (cause) { setError(describeApiError(cause)); }
    finally { setBusy(false); }
  }
  return <section className="ws-knowledge"><div className="ws-section-heading"><div><h3>Project knowledge</h3><p>Add notes and reference material for this project's tasks.</p></div><Button className="ws-button" disabled={busy} onClick={() => { if (editorOpen && editingId === null) { setEditorOpen(false); setError(""); } else openEditor(); }}>{editorOpen && editingId === null ? <X /> : <Plus />}{editorOpen && editingId === null ? "Close editor" : "Add knowledge"}</Button></div>
    {error && <ErrorNotice error={`${error}${editorOpen ? " Your draft is still here." : ""}`} />}
    {saved && <p className="ws-save-status ws-knowledge-saved" role="status"><Check />{saved}</p>}
    {editorOpen && <form className="ws-form ws-knowledge-editor" onSubmit={(event) => { void save(event); }}>
      <div className="ws-knowledge-editor-heading"><span><Pencil />{editingId === null ? "New knowledge" : "Edit knowledge"}</span><button className="ws-icon-button" type="button" disabled={busy} aria-label="Close knowledge editor" onClick={() => { setEditorOpen(false); setError(""); }}><X /></button></div>
      <label>Title<input required disabled={busy} value={draft.name} onChange={(event) => updateDraft("name", event.target.value)} maxLength={knowledgeTitleLimit} placeholder="e.g. Research context" /></label>
      <label>Reference content<textarea required disabled={busy} rows={8} maxLength={knowledgeContentLimit} value={draft.content} onChange={(event) => updateDraft("content", event.target.value)} placeholder="Paste notes, background material, or reference text…" /><span className="ws-knowledge-limit">{draft.content.length.toLocaleString()} / {knowledgeContentLimit.toLocaleString()} characters</span></label>
      <div className="ws-form-actions ws-knowledge-editor-actions"><span className="ws-field-hint">{busy ? "Saving your knowledge…" : "Draft stays here until it is saved."}</span><SaveButton busy={busy} disabled={!draft.name.trim() || !draft.content.trim()}>{editingId === null ? "Add to knowledge" : "Save knowledge"}</SaveButton></div>
    </form>}
    {visibleItems.length ? <div className="ws-knowledge-list">{visibleItems.map((item) => <article className={editorOpen && editingId === item.id ? "ws-knowledge-editing" : ""} key={item.id}><button type="button" className="ws-knowledge-toggle" aria-expanded={expanded === item.id} onClick={() => setExpanded(expanded === item.id ? null : item.id)}><FileText /><span><strong>{item.name}</strong><small>{item.content.length.toLocaleString()} characters{drafts[item.id] && " · Draft"}</small></span><ChevronRight className={expanded === item.id ? "ws-rotated" : ""} /></button>{expanded === item.id && <div className="ws-knowledge-content"><pre>{item.content}</pre><div className="ws-knowledge-actions"><button className="ws-text-button" type="button" disabled={busy} aria-label={`Edit ${item.name}`} onClick={() => openEditor(item)}><Pencil />Edit knowledge</button><button className="ws-text-button ws-danger" type="button" disabled={busy} onClick={() => { void remove(item.id); }}><Trash2 />Remove knowledge</button></div></div>}</article>)}</div> : !editorOpen && <Empty icon={BookOpen} title="Give your project context">Add research notes, requirements, or background text to help the agent understand your work.</Empty>}
  </section>;
}

interface WorkspaceFile { name: string; path: string; type: "file" | "directory"; size: number; modifiedAt: string }
interface FilePreview { path: string; name: string; content: string; mimeType: string; size: number; truncated: boolean }

function FilesPanel({ projectId }: { projectId?: string } = {}): ReactElement {
  const viewer = usePreview();
  const [location, setLocation] = useState({ projectId: projectId ?? null, path: "" });
  const path = fileBrowserPath(location, projectId);
  const scope = fileBrowserScope(projectId, path);
  const [directory, setDirectory] = useState<{ scope: string; files: WorkspaceFile[]; loading: boolean; error: string }>({ scope, files: [], loading: true, error: "" });
  const [filter, setFilter] = useState("");
  const [version, setVersion] = useState(0);
  const [previewState, setPreviewState] = useState<{ scope: string; value: FilePreview | null; loading: boolean; error: string }>({ scope, value: null, loading: false, error: "" });
  const previewAbort = useRef<AbortController | null>(null);
  const activeScope = useRef(scope);
  activeScope.current = scope;
  const projectQuery = projectId ? `&projectId=${encodeURIComponent(projectId)}` : "";
  const currentDirectory = directory.scope === scope ? directory : { scope, files: [], loading: true, error: "" };
  const currentPreview = previewState.scope === scope ? previewState : { scope, value: null, loading: false, error: "" };
  const files = currentDirectory.files.filter((file) => file.name.toLocaleLowerCase().includes(filter.trim().toLocaleLowerCase()));
  const breadcrumbs = directoryBreadcrumbs(path);

  useEffect(() => {
    const controller = new AbortController();
    previewAbort.current?.abort();
    setDirectory({ scope, files: [], loading: true, error: "" });
    setPreviewState({ scope, value: null, loading: false, error: "" });
    setFilter("");
    void workspaceRequest<{ files: WorkspaceFile[] }>(`/api/files?path=${encodeURIComponent(path)}${projectQuery}`, { signal: controller.signal }).then((result) => {
      if (!controller.signal.aborted) setDirectory({ scope, files: result.files, loading: false, error: "" });
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setDirectory({ scope, files: [], loading: false, error: describeApiError(cause) });
    });
    return () => { controller.abort(); previewAbort.current?.abort(); };
  }, [scope, path, projectQuery, version]);

  function closePreview(): void {
    previewAbort.current?.abort();
    setPreviewState({ scope, value: null, loading: false, error: "" });
  }

  function navigate(nextPath: string): void {
    closePreview(); setFilter("");
    setLocation({ projectId: projectId ?? null, path: nextPath });
  }

  async function openFile(file: WorkspaceFile): Promise<void> {
    closePreview();
    if (file.type === "directory") { navigate(file.path); return; }
    if (viewer) { viewer.openWorkspace(file.path, projectId); return; }
    const controller = new AbortController(); previewAbort.current = controller;
    setPreviewState({ scope, value: null, loading: true, error: "" });
    try {
      const result = await workspaceRequest<FilePreview>(`/api/files/content?path=${encodeURIComponent(file.path)}${projectQuery}`, { signal: controller.signal });
      if (!controller.signal.aborted) setPreviewState({ scope, value: result, loading: false, error: "" });
    } catch (cause) { if (!controller.signal.aborted) setPreviewState({ scope, value: null, loading: false, error: describeApiError(cause) }); }
  }
  async function downloadFile(file: { name: string; path: string }): Promise<void> {
    try { await downloadWorkspaceFile(`${workspaceApiBase}/api/files/download?path=${encodeURIComponent(file.path)}${projectQuery}`, file.name); }
    catch (cause) { if (activeScope.current === scope) setPreviewState((current) => ({ ...(current.scope === scope ? current : { scope, value: null, loading: false }), error: describeApiError(cause) })); }
  }
  return <section className="ws-files"><div className="ws-section-heading"><div><h3>Workspace files</h3><p>{projectId ? "Files stay within this project's local directory." : "Browse files in the configured local workspace."}</p></div><button className="ws-icon-button" type="button" disabled={currentDirectory.loading} onClick={() => setVersion((value) => value + 1)} aria-label="Refresh directory" title="Refresh directory"><RefreshCw /></button></div>
    <nav className="ws-file-breadcrumb ws-file-breadcrumb-links" aria-label="File location"><button type="button" aria-label="Open workspace root" aria-current={path ? undefined : "page"} onClick={() => navigate("")}><Folder />{projectId ? "Project" : "Workspace"}</button>{breadcrumbs.map((crumb, index) => <span className="ws-file-crumb" key={crumb.path}><ChevronRight aria-hidden="true" /><button type="button" aria-current={index === breadcrumbs.length - 1 ? "page" : undefined} onClick={() => navigate(crumb.path)}>{crumb.name}</button></span>)}{path && <button type="button" className="ws-icon-button" aria-label="Parent directory" title="Parent directory" onClick={() => navigate(breadcrumbs.at(-2)?.path ?? "")}><ArrowLeft /></button>}</nav>
    {currentDirectory.error && <ErrorNotice error={currentDirectory.error} onRetry={() => setVersion((value) => value + 1)} />}
    {currentDirectory.loading ? <Busy label="Reading directory…" /> : !currentDirectory.error && <>
      <div className="ws-file-toolbar"><label className="ws-search-field"><Search /><input value={filter} onChange={(event) => setFilter(event.target.value)} aria-label="Filter files in this folder" placeholder="Filter this folder…" />{filter && <button type="button" onClick={() => setFilter("")} aria-label="Clear file filter"><X /></button>}</label><span>{files.length}{filter ? ` of ${currentDirectory.files.length}` : ""} items</span></div>
      <div className="ws-file-list">{files.length ? files.map((file) => <article className="ws-file-row" key={file.path}><button type="button" onClick={() => { void openFile(file); }}>{file.type === "directory" ? <Folder /> : <File />}<span>{file.name}</span><small>{file.type === "directory" ? "Folder" : formatBytes(file.size)}</small><ChevronRight /></button>{file.type === "file" && <button type="button" className="ws-file-download" onClick={() => { void downloadFile(file); }} aria-label={`Download ${file.name}`} title={`Download ${file.name}`}><ArrowDownToLine /></button>}</article>) : <div className="ws-file-empty"><FolderOpen /><p>{filter ? "No files match this filter." : "This directory is empty."}</p>{filter && <button type="button" className="ws-text-button" onClick={() => setFilter("")}>Clear filter</button>}</div>}</div>
    </>}
    {currentPreview.error && <ErrorNotice error={currentPreview.error} />}
    {currentPreview.loading && <Busy label="Opening file…" />}
    {currentPreview.value && <div className="ws-file-preview"><header><FileText /><strong>{currentPreview.value.name}</strong><button type="button" className="ws-file-preview-download" onClick={() => { if (currentPreview.value) void downloadFile(currentPreview.value); }}><ArrowDownToLine />Download</button><button className="ws-icon-button" type="button" onClick={closePreview} aria-label="Close file preview"><X /></button></header><pre>{currentPreview.value.content}</pre>{currentPreview.value.truncated && <p className="ws-muted">Preview truncated. Download the file for its full contents.</p>}</div>}
  </section>;
}

function formatBytes(size: number): string { return size < 1024 ? `${size} B` : size < 1024 ** 2 ? `${(size / 1024).toFixed(1)} KB` : `${(size / 1024 ** 2).toFixed(1)} MB`; }

function TaskList({ items, onOpenRun, onChanged }: { items: WorkspaceConversation[]; onOpenRun: WorkspacePanelProps["onOpenRun"]; onChanged?: () => void }): ReactElement {
  const [editing, setEditing] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  async function patch(item: WorkspaceConversation, value: Record<string, unknown>): Promise<void> {
    setPending(item.rootRunId); setError("");
    try { await workspaceRequest(`/api/conversations/${encodeURIComponent(item.rootRunId)}`, { method: "PATCH", body: value }); setEditing(null); onChanged?.(); }
    catch (cause) { setError(describeApiError(cause)); }
    finally { setPending(null); }
  }
  return <>{error && <ErrorNotice error={error} />}{items.length ? <div className="ws-task-list">{items.map((item) => <article className="ws-task-item" key={item.rootRunId}><button type="button" className="ws-task-open" onClick={() => { void onOpenRun(item.latestRunId); }}><span className={`ws-task-status ws-status-${item.status}`}>{item.status === "completed" ? <CheckCircle2 /> : item.status === "running" || item.status === "queued" ? <LoaderCircle className="ws-spin" /> : <Clock3 />}</span><span><strong>{item.pinned && <Pin />}{conversationTitle(item)}</strong><small>{formatRelativeTime(item.updatedAt)}<span>·</span>{item.status.replaceAll("_", " ")}</small></span><ChevronRight /></button>{onChanged && <div className="ws-task-actions"><button type="button" className="ws-icon-button" title={item.pinned ? "Unpin task" : "Pin task"} aria-label={item.pinned ? "Unpin task" : "Pin task"} disabled={pending === item.rootRunId} onClick={() => { void patch(item, { pinned: !item.pinned }); }}><Pin /></button><button type="button" className="ws-icon-button" title="Rename task" aria-label="Rename task" onClick={() => { setEditing(item.rootRunId); setTitle(conversationTitle(item)); }}><Pencil /></button></div>}{editing === item.rootRunId && <form className="ws-rename-form" onSubmit={(event) => { event.preventDefault(); void patch(item, { title }); }}><input aria-label="Task title" required maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} autoFocus /><button type="submit" className="ws-icon-button" aria-label="Save task name" disabled={pending === item.rootRunId}><Check /></button><button type="button" className="ws-icon-button" aria-label="Cancel rename" onClick={() => setEditing(null)}><X /></button></form>}</article>)}</div> : <Empty icon={Search} title="No tasks found">Your completed and active tasks will appear here. Try a different search or start a new task.</Empty>}</>;
}

type SettingsTab = "profile" | "appearance" | "agent" | "capabilities" | "workspace" | "usage";

function SettingsPanel({ overview, initialTab, theme, onThemeChange, onProfileChange, onChanged }: { overview: WorkspaceOverview; initialTab: SettingsTab; theme: "light" | "dark" | "system"; onThemeChange: WorkspacePanelProps["onThemeChange"]; onProfileChange: WorkspacePanelProps["onProfileChange"]; onChanged: () => void }): ReactElement {
  const [tab, setTab] = useState(initialTab);
  const [profile, setProfile] = useState(overview.profile);
  const [settings, setSettings] = useState(overview.settings);
  const profileDirty = useRef(false);
  const agentDirty = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [models, setModels] = useState<Array<{ id: string; name: string; description?: string }>>([{ id: "auto", name: "Auto · Local Codex default" }]);
  useEffect(() => {
    if (!profileDirty.current) setProfile(overview.profile);
    setSettings((current) => reconcileSettingsDraft(current, overview.settings, agentDirty.current));
  }, [overview]);
  useEffect(() => { setTab(initialTab); }, [initialTab]);
  const agent = settings.agent ?? { name: "OpenRigor", instructions: "", defaultModel: "auto", effort: "medium" };
  useEffect(() => { const controller = new AbortController(); void workspaceRequest<{ models: Array<{ id: string; name: string; description?: string }> }>("/api/models", { signal: controller.signal }).then((result) => { if (Array.isArray(result.models)) setModels(result.models); }).catch((cause: unknown) => { if (!controller.signal.aborted) setError(describeApiError(cause)); }); return () => controller.abort(); }, []);
  const modelChoices = models.some((item) => item.id === agent.defaultModel) ? models : [...models, { id: agent.defaultModel, name: agent.defaultModel }];
  function updateAgent(key: string, value: string): void { agentDirty.current = true; setSettings((current) => ({ ...current, agent: { ...(current.agent ?? agent), [key]: value } })); setSaved(false); }
  function updateProfile(key: "displayName" | "email" | "language", value: string): void { profileDirty.current = true; setProfile((current) => ({ ...current, [key]: value })); setSaved(false); }

  async function save(event: FormEvent): Promise<void> {
    event.preventDefault(); if (busy) return; setBusy(true); setError(""); setSaved(false);
    try {
      if (tab === "profile") { const result = await workspaceRequest<{ profile: WorkspaceProfile }>("/api/profile", { method: "PATCH", body: profile }); profileDirty.current = false; setProfile(result.profile); onProfileChange?.(result.profile); }
      else { const result = await workspaceRequest<{ settings: WorkspaceSettings }>("/api/settings", { method: "PATCH", body: { agent } }); agentDirty.current = false; setSettings(result.settings); }
      setSaved(true); onChanged();
    } catch (cause) { setError(describeApiError(cause)); }
    finally { setBusy(false); }
  }

  async function changeTheme(value: "light" | "dark" | "system"): Promise<void> {
    onThemeChange(value); setSettings((current) => ({ ...current, theme: value })); setError("");
    try { await workspaceRequest("/api/settings", { method: "PATCH", body: { theme: value } }); onChanged(); }
    catch (cause) { setError(describeApiError(cause)); }
  }

  const tabs: Array<{ id: SettingsTab; label: string; icon: LucideIcon; group?: string }> = [
    { id: "profile", label: "Profile", icon: UserRound, group: "PERSONAL" }, { id: "appearance", label: "Appearance", icon: Monitor },
    { id: "agent", label: "Persona & Instructions", icon: Bot, group: "AGENT" }, { id: "capabilities", label: "Capabilities", icon: WandSparkles },
    { id: "workspace", label: "Workspace", icon: Folder, group: "LOCAL WORKSPACE" }, { id: "usage", label: "Usage", icon: Cpu }
  ];
  return <div className="ws-settings-layout">
    <nav className="ws-settings-nav" aria-label="Settings sections">
      <div className="ws-settings-nav-brand"><span className="ws-settings-brand-mark"><Layers3 aria-hidden="true" /></span><div><strong>{overview.workspace.name || "OpenRigor"}</strong><small>Workspace settings</small></div></div>
      <div className="ws-settings-links">{tabs.map((item) => <div key={item.id}>{item.group && <span className="ws-nav-group">{item.group}</span>}<button type="button" className={tab === item.id ? "active" : ""} aria-current={tab === item.id ? "page" : undefined} disabled={busy} onClick={() => { setTab(item.id); setError(""); setSaved(false); }}><item.icon aria-hidden="true" /><span>{item.label}</span></button></div>)}</div>
      <div className="ws-settings-nav-footer"><span className="ws-settings-owner-avatar">{(profile.displayName || "You").slice(0, 1).toUpperCase()}</span><div><strong>{profile.displayName || "You"}</strong><small>Personal workspace</small></div></div>
    </nav>
    <div className={`ws-settings-content${tab === "agent" ? " ws-settings-content-agent" : ""}`}>{error && <ErrorNotice error={error} />}
    {tab === "profile" && <form className="ws-form" onSubmit={(event) => { void save(event); }}><div className="ws-content-heading"><h2>Your profile</h2><p>Personalize the way your local workspace greets you.</p></div><div className="ws-profile-avatar">{(profile.displayName || "You").slice(0, 1).toUpperCase()}</div><label>Display name<input required disabled={busy} value={profile.displayName} maxLength={100} onChange={(event) => updateProfile("displayName", event.target.value)} /></label><label>Email <span className="ws-field-hint">Optional. Stored only in this workspace.</span><input type="email" disabled={busy} value={profile.email ?? ""} maxLength={200} onChange={(event) => updateProfile("email", event.target.value)} /></label><label>Language<select disabled={busy} value={profile.language ?? "en"} onChange={(event) => updateProfile("language", event.target.value)}><option value="en">English</option><option value="zh-CN">简体中文</option></select></label><div className="ws-form-actions">{saved && <span className="ws-save-status"><Check />Saved</span>}<SaveButton busy={busy} /></div></form>}
    {tab === "appearance" && <><div className="ws-content-heading"><h2>Appearance</h2><p>Choose a comfortable environment for focused work.</p></div><div className="ws-theme-options">{([{ id: "light", label: "Light", icon: Sun }, { id: "dark", label: "Dark", icon: Moon }, { id: "system", label: "System", icon: Monitor }] as const).map((item) => <button key={item.id} type="button" className={`ws-theme-option${theme === item.id ? " selected" : ""}`} onClick={() => { void changeTheme(item.id); }}><div className={`ws-theme-preview ws-preview-${item.id}`}><i /><span><i /><i /><i /></span></div><span><item.icon />{item.label}{theme === item.id && <Check />}</span></button>)}</div><div className="ws-info-card"><Monitor /><div><strong>System appearance</strong><p>The System setting follows your device's color preference automatically.</p></div></div></>}
    {tab === "agent" && <form className="ws-form ws-agent-form" onSubmit={(event) => { void save(event); }}>
      <div className="ws-content-heading ws-agent-heading"><span className="ws-eyebrow">YOUR AGENT, YOUR WAY</span><h2>Persona & Instructions</h2><p>Define how your agent reasons, communicates, and works with you.</p></div>
      <section className="ws-agent-identity" aria-label="Agent identity">
        <span className="ws-agent-emblem" aria-hidden="true"><svg viewBox="0 0 48 48" fill="none"><path d="m24 6 15.6 9v18L24 42 8.4 33V15L24 6Z" /><path d="m24 14 8.7 5v10L24 34l-8.7-5V19l8.7-5Zm0 0V6m8.7 13 6.9-4m-6.9 14 6.9 4M24 34v8m-8.7-13-6.9 4m6.9-14-6.9-4" /><circle cx="24" cy="24" r="3.5" /></svg></span>
        <label>Agent name<input required disabled={busy} maxLength={100} value={agent.name} onChange={(event) => updateAgent("name", event.target.value)} /></label>
        <span className="ws-agent-runtime"><Terminal aria-hidden="true" />{overview.runtime.executor === "codex-app-server" ? "Local Codex" : overview.runtime.executor === "demo" ? "Demo runtime" : overview.runtime.executor || "Local runtime"}</span>
      </section>
      <section className="ws-instruction-editor">
        <div className="ws-editor-heading"><div><label htmlFor="ws-agent-instructions">Instructions</label><p id="ws-agent-instructions-hint">Set your preferred approach, communication style, and standards.</p></div><span className="ws-editor-count">{agent.instructions.length.toLocaleString()}<span> / 16,000</span></span></div>
        <textarea disabled={busy} id="ws-agent-instructions" aria-describedby="ws-agent-instructions-hint" rows={5} maxLength={16000} value={agent.instructions} onChange={(event) => updateAgent("instructions", event.target.value)} placeholder="Describe how your agent should research, reason, and communicate…" />
        <div className="ws-editor-footnote"><FileText aria-hidden="true" /><span>Clear, specific guidance makes every task more consistent.</span></div>
      </section>
      <section className="ws-agent-defaults" aria-labelledby="ws-agent-defaults-title"><div className="ws-agent-section-title"><h3 id="ws-agent-defaults-title">Execution defaults</h3><span>A starting point for new tasks</span></div><div className="ws-form-columns"><label>Default model<select disabled={busy} value={agent.defaultModel} onChange={(event) => updateAgent("defaultModel", event.target.value)}>{modelChoices.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Reasoning effort<select disabled={busy} value={agent.effort} onChange={(event) => updateAgent("effort", event.target.value)}>{["low", "medium", "high", "xhigh", "max"].map((item) => <option key={item} value={item}>{item === "xhigh" ? "Extra high" : item.charAt(0).toUpperCase() + item.slice(1)}</option>)}</select></label></div></section>
      <div className="ws-form-actions ws-agent-footer"><span className="ws-agent-save-note">Changes apply to new tasks.</span>{saved && <span className="ws-save-status" role="status"><Check />Saved</span>}<SaveButton busy={busy} /></div>
    </form>}
    {tab === "capabilities" && <><div className="ws-content-heading"><h2>Capabilities</h2><p>Tools and reusable expertise available in this local runtime.</p></div><div className="ws-capability-grid"><Capability icon={Terminal} title="Local execution" detail={overview.runtime.executor === "codex-app-server" ? "Connected through Codex app-server" : "Deterministic demonstration runtime"} active={overview.runtime.executor === "codex-app-server"} /><Capability icon={Folder} title="Workspace files" detail="Browse, preview, and download local files" active /><Capability icon={Image} title="Image generation" detail={overview.runtime.imageGenerationConfigured ? "Server-side image provider configured" : "Provider key required in server environment"} active={Boolean(overview.runtime.imageGenerationConfigured)} /><Capability icon={Clock3} title="Durable history" detail="Tasks and ordered events are stored locally" active /></div><h3 className="ws-subheading">Installed skills</h3><div className="ws-installed-skills">{overview.skills.filter((skill) => skill.installed).length ? overview.skills.filter((skill) => skill.installed).map((skill) => <div key={skill.id}><WandSparkles /><span><strong>{skill.name ?? skill.label}</strong><small>{skill.description}</small></span><Check /></div>) : <p className="ws-muted">Install a skill from the Skill Market to add a reusable workflow.</p>}</div><div className="ws-info-card"><ShieldCheck /><div><strong>Local capability boundary</strong><p>Tool access follows the configured Codex sandbox. Server credentials are never sent to your browser.</p></div></div></>}
    {tab === "workspace" && <><div className="ws-content-heading"><h2>{overview.workspace.name || "Personal workspace"}</h2><p>A private workspace on this computer.</p></div><div className="ws-member-row"><span className="ws-profile-avatar">{profile.displayName.slice(0, 1).toUpperCase()}</span><div><strong>{profile.displayName}</strong><small>{profile.email || "Local operator"}</small></div><span className="ws-badge">Owner</span></div><div className="ws-detail-table"><div><span>Workspace directory</span><code>{overview.workspace.path}</code></div><div><span>Execution runtime</span><strong>{overview.runtime.executor || "local"}</strong></div><div><span>Persistence</span><strong>{String(overview.runtime.persistence ?? "Local workspace store")}</strong></div><div><span>Projects</span><strong>{overview.projects.length}</strong></div><div><span>Tasks</span><strong>{overview.conversations.length}</strong></div></div><div className="ws-info-card"><Monitor /><div><strong>Runs on your computer</strong><p>This workspace uses your local runtime and configured providers. Cloud host allocation and subscription billing are outside this local edition.</p></div></div><FilesPanel /></>}
    {tab === "usage" && <UsagePanel />}
  </div></div>;
}

function Capability({ icon: Icon, title, detail, active }: { icon: LucideIcon; title: string; detail: string; active: boolean }): ReactElement {
  return <div className="ws-capability"><span><Icon /></span><div><strong>{title}</strong><p>{detail}</p></div><span className={`ws-capability-status${active ? " active" : ""}`}>{active ? <CheckCircle2 /> : <CircleHelp />}</span></div>;
}

interface UsageResult { runs?: number; completedRuns?: number; inputTokens?: number; outputTokens?: number; entries?: Array<{ runId: string; model?: string; inputTokens?: number; outputTokens?: number; createdAt?: string; providerRequestId?: string }>; [key: string]: unknown }

function UsagePanel(): ReactElement {
  const [usage, setUsage] = useState<UsageResult | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { const controller = new AbortController(); void workspaceRequest<{ usage: UsageResult }>("/api/usage", { signal: controller.signal }).then((result) => setUsage(result.usage)).catch((cause: unknown) => { if (!controller.signal.aborted) setError(describeApiError(cause)); }); return () => controller.abort(); }, []);
  return <><div className="ws-content-heading"><h2>Usage</h2><p>Token usage reported by your local model runtime.</p></div>{error ? <ErrorNotice error={error} /> : !usage ? <Busy /> : <><div className="ws-stat-grid"><div><span>Input tokens</span><strong>{(usage.inputTokens ?? 0).toLocaleString()}</strong></div><div><span>Output tokens</span><strong>{(usage.outputTokens ?? 0).toLocaleString()}</strong></div><div><span>Recorded runs</span><strong>{usage.runs ?? usage.entries?.length ?? 0}</strong></div></div>{usage.entries?.length ? <div className="ws-usage-list">{usage.entries.slice(0, 30).map((entry) => <div key={entry.runId}><span><strong>{entry.model || "Local Codex"}</strong><small>{entry.createdAt ? formatRelativeTime(entry.createdAt) : entry.runId}</small></span><span>{(entry.inputTokens ?? 0).toLocaleString()} in · {(entry.outputTokens ?? 0).toLocaleString()} out</span></div>)}</div> : <Empty icon={Cpu} title="No recorded usage yet">Usage will appear after a model run reports its token counts.</Empty>}<div className="ws-info-card"><ShieldCheck /><div><strong>Provider billing</strong><p>Usage is reported by your configured model provider. Manage charges and subscriptions in your provider account.</p></div></div></>}</>;
}

function HandoffPanel({ overview, onOpenRun, onSelectProject, onCompose }: { overview: WorkspaceOverview; onOpenRun: WorkspacePanelProps["onOpenRun"]; onSelectProject: WorkspacePanelProps["onSelectProject"]; onCompose: WorkspacePanelProps["onCompose"] }): ReactElement {
  return <div className="ws-handoff"><div className="ws-content-heading"><h2>Pick up where you left off</h2><p>Your projects and conversations stay connected to their original context.</p></div>{overview.projects.length > 0 && <><h3 className="ws-subheading">Projects</h3><div className="ws-project-grid">{overview.projects.map((project) => <button className="ws-project-card" type="button" key={project.id} onClick={() => onSelectProject(project)}><Folder /><h3>{project.name}</h3><p>{project.description || "Continue in this project's shared context."}</p><footer>Open project<ArrowRight /></footer></button>)}</div></>}<h3 className="ws-subheading">Recent tasks</h3><TaskList items={overview.conversations.slice(0, 20)} onOpenRun={onOpenRun} /><div className="ws-handoff-new"><FolderOpen /><div><h3>Start from existing work</h3><p>Ask the agent to inspect the current workspace and propose the next step.</p></div><button className="ws-button" type="button" onClick={() => onCompose("Inspect the current workspace, summarize the project's status and recent work, then propose the most useful next steps. Read the project instructions before making changes.")}><ArrowRight />Inspect workspace</button></div></div>;
}

const researchCases = [
  { title: "Map a research field", tag: "Literature review", description: "Trace ideas across papers and organize the strongest evidence into a clear research map.", image: "/generated/research-lineage.webp", prompt: "Help me create a literature review for my research topic. First ask me for the research question and scope. Then find primary sources, compare methods and datasets, identify contradictory findings, and build an evidence matrix with citations. Clearly separate verified findings from hypotheses." },
  { title: "Reproduce an experiment", tag: "Reproducibility", description: "Turn a published method into a practical, inspectable reproduction plan.", image: "/generated/experiment-chart.webp", prompt: "Help me reproduce a published experiment. Ask me for the paper and any available code, then inspect the workspace. Build a reproducibility checklist covering data, dependencies, configuration, metrics, baselines, compute constraints, and expected outputs before running anything." },
  { title: "Build an evidence matrix", tag: "Evidence synthesis", description: "Compare questions, methods, limitations, and results across a set of sources.", image: "/generated/evidence-matrix.webp", prompt: "Create an evidence matrix from the research materials in this workspace. For each source capture its question, methods, dataset, main result, limitations, and exact source location. Highlight gaps and contradictions, and preserve uncertainty." },
  { title: "Analyze paired data", tag: "Data, code & figures", description: "Move from a dataset to a checked calculation, a clear figure, and a reproducible report.", image: "/generated/experiment-chart.webp", prompt: "Analyze the paired before/after data I provide. If I have not attached a dataset, ask for it and the measurement units. Check missing values, pairing, and assumptions; report descriptive statistics, the mean paired difference, a 95% confidence interval, and an appropriate effect size. Run and verify the calculations, label limitations, and generate a readable figure. Deliver a Markdown report, the analysis script, a CSV of the data, and the figure under artifacts/, with real file links in the final answer. Keep the original data intact." },
  { title: "Design a controlled study", tag: "Hypothesis to protocol", description: "Make a question testable with baselines, ablations, evaluation rules, and a clear stopping point.", image: "/generated/research-lineage.webp", prompt: "Help design a controlled study for my research question. Ask for the question and practical constraints if missing. State a falsifiable hypothesis, define a baseline and two useful ablations, specify the sampling unit, primary metric, uncertainty estimate, blinding, leakage controls, and failure criteria. Include a compact Mermaid workflow and an experiment matrix. Deliver artifacts/study-plan.md, artifacts/experiment-matrix.csv, and an empty annotation template. Clearly label proposed work and any illustrative examples; do not invent observed results." },
  { title: "Prepare a research story", tag: "Scientific communication", description: "Shape your findings into an argument supported by figures and a coherent narrative.", image: "/generated/research-storyboard.webp", prompt: "Help me prepare a research presentation using the current workspace materials. First identify the audience and time limit. Create a narrative outline with the research question, method, evidence, limitations, and next experiments, and map every key claim to supporting material." }
];

function ResearchPanel({ onCompose }: { onCompose: WorkspacePanelProps["onCompose"] }): ReactElement {
  return <div className="ws-research"><div className="ws-content-heading"><span className="ws-eyebrow">FROM QUESTION TO EVIDENCE</span><h2>A workspace for the whole research process.</h2><p>Choose a starting point. Review and adapt the task before sending it to your agent.</p></div><div className="ws-research-grid">{researchCases.map((item) => <article className="ws-research-card" key={item.title}><div className="ws-research-image"><img src={item.image} alt="" loading="lazy" /></div><div><span className="ws-eyebrow">{item.tag}</span><h3>{item.title}</h3><p>{item.description}</p><button type="button" className="ws-text-button" onClick={() => onCompose(item.prompt)}>Use this starting point<ArrowRight /></button></div></article>)}</div><div className="ws-info-card"><FlaskConical /><div><strong>From task to deliverable</strong><p>Keep source data, analysis code, figures, and reports together in a project. Open the generated files directly from your conversation, and return to the same work after a refresh.</p></div></div></div>;
}

const guideSections = [
  { id: "start", title: "Start a task", icon: ArrowUp, body: "Describe the result you need and the constraints that matter. Select a project to include its instructions and knowledge, then send. You can follow progress, inspect individual tool steps, stop a run, and continue in the same conversation.", prompt: "Help me turn an idea into a clear, executable task. Ask me about the intended outcome, available materials, constraints, and acceptance criteria, then propose a focused plan." },
  { id: "sources", title: "Work with sources", icon: BookOpen, body: "Use @ in the composer to select workspace context. Add longer notes in a project's Knowledge tab. Ask for primary sources, exact citations, and explicit uncertainty when you need evidence you can verify.", prompt: "Inspect the project materials and produce an evidence-backed summary. Link each important claim to a primary source or an exact workspace file, and label anything that remains uncertain." },
  { id: "models", title: "Choose model and reasoning", icon: Cpu, body: "Sol handles demanding synthesis; Terra is a balanced general model; Luna suits focused work. Reasoning effort controls the depth of a single model. Ultra requests multi-agent coordination through the local Codex runtime. Availability follows your configured provider.", prompt: "Assess the complexity of my task, recommend an appropriate model and reasoning budget, and explain which parts need deep reasoning versus straightforward execution." },
  { id: "skills", title: "Give your agent reusable skills", icon: WandSparkles, body: "Install a workflow from the Skill Market or add one with your own instructions. Select installed skills with / when composing a task. A skill supplies guidance for the agent; it does not install arbitrary executables on your computer.", prompt: "Help me write a reusable skill for a workflow I repeat. Ask about the trigger, inputs, process, constraints, expected deliverables, and validation steps, then draft concise instructions." },
  { id: "images", title: "Generate original images", icon: Image, body: "Open Image Generation, describe the visual you need, choose a model and resolution, and generate. Originals are saved locally. The provider key is configured on the server and stays out of browser requests.", prompt: "Help me write a precise image prompt. Ask me about the subject, purpose, composition, style, lighting, colors, dimensions, and any text that needs to appear." },
  { id: "history", title: "Resume and inspect your work", icon: Clock3, body: "Use Search or the sidebar task list to reopen a conversation. Runs replay their saved events in order. If the local execution process was interrupted, its status explains what happened so you can decide how to continue.", prompt: "Inspect the current workspace and summarize completed work, unresolved questions, and the next concrete step. Verify the actual files and state before proposing changes." }
];

function GuidesPanel({ onCompose }: { onCompose: WorkspacePanelProps["onCompose"] }): ReactElement {
  const [open, setOpen] = useState("start");
  return <div className="ws-guides"><div className="ws-content-heading"><span className="ws-eyebrow">A LITTLE ORIENTATION</span><h2>Make room for good work.</h2><p>A practical guide to your agent, tools, and local workspace.</p></div><div className="ws-guide-list">{guideSections.map((item, index) => <article className={open === item.id ? "open" : ""} key={item.id}><button type="button" aria-expanded={open === item.id} onClick={() => setOpen(open === item.id ? "" : item.id)}><span className="ws-guide-number">0{index + 1}</span><item.icon /><strong>{item.title}</strong><ChevronRight /></button>{open === item.id && <div className="ws-guide-content"><p>{item.body}</p><button type="button" className="ws-text-button" onClick={() => onCompose(item.prompt)}>Try it in a task<ArrowRight /></button></div>}</article>)}</div><div className="ws-info-card"><ShieldCheck /><div><strong>Your local workspace</strong><p>OpenRigor runs against the directory configured on this machine. Keep task instructions specific and inspect tool output before relying on a result.</p></div></div></div>;
}

export const WorkspaceView = WorkspacePanel;
export const WorkspacePage = WorkspacePanel;
