import { PreviewProvider } from "./features/preview/preview-context";
import { PreviewLauncher, PreviewLayout } from "./features/preview/preview-panel";
import type { PreviewFile } from "./features/preview/file-preview-model";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement
} from "react";
import { useGSAP } from "@gsap/react";
import type { RunEvent, RunSnapshot } from "@openrigor/protocol";
import { gsap } from "gsap";
import {
  ArrowDown,
  ArrowUp,
  Archive,
  Download,
  MoreHorizontal,
  Pencil,
  Pin,
  BookOpen,
  BrainCircuit,
  Check,
  ChevronRight,
  ChevronDown,
  ChevronsUpDown,
  CircleUserRound,
  FolderPlus,
  ImagePlus,
  Gift,
  PanelLeftClose,
  PanelLeftOpen,
  Paperclip,
  Users,
  Sparkles,
  CircleHelp,
  Clock3,
  Command,
  FileSpreadsheet,
  FileText,
  Folder,
  Globe2,
  HardDrive,
  Layers3,
  Library,
  Menu,
  Monitor,
  Moon,
  Palette,
  Plus,
  Presentation,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Square,
  Sun,
  Terminal,
  WandSparkles,
  X,
  type LucideIcon
} from "lucide-react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle
} from "./components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger
} from "./components/ui/dropdown-menu";
import {
  Tooltip as TooltipRoot,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from "./components/ui/tooltip";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton
} from "./components/ai-elements/conversation";
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputTextarea,
  PromptInputTools
} from "./components/ai-elements/prompt-input";
import { RunTurn } from "./features/chat/run-turn";
import { ActivityGlyph, ComposerRunActivity } from "./features/chat/run-activity";
import { isActivelyWorkingStatus } from "./run-presentation";
import { ComposerPalette, ExecutionSelector, type ComposerPaletteItem } from "./features/composer";
import {
  companionVisuals,
  ExamplePreviewArt,
  HomeView,
  type ExampleTask,
  type TabId
} from "./features/home";
import {
  applyRunEvent,
  cleanHistoryPrompt,
  restoreConversation,
  type ConversationRestorePayload,
  type ConversationRunSnapshot,
  type ConversationRunView,
  type ConversationViewState
} from "./conversation";
import {
  applyTheme,
  initialThemePreference,
  modelLabel,
  normalizeModeForModel,
  persistManualExecutionPreference,
  persistModelCatalog,
  readStoredModelCatalog,
  type RuntimeModel,
  persistRoutingPreference,
  persistTheme,
  readStoredManualExecutionPreference,
  readStoredRoutingPreference,
  resolveExecutionPreference,
  themeOptions,
  tokenResearchRoutingProfile,
  type Effort,
  type ModelId,
  type RoutingPreference,
  type RunMode,
  type ThemePreference
} from "./workspace-preferences";
import { parseRunStreamEvent, requestRunStart } from "./run-client";
import { isRunStatus, parseRecentTasks, rememberRecentTask, serializeRecentTasks, type RecentTask } from "./recent-tasks";
import { loadQueuedFollowups, persistQueuedFollowups, queueMatchesConversation, acknowledgeQueuedFollowup, appendQueuedFollowup, attachmentReferences, maxQueuedFollowups, removeQueuedFollowup, type QueuedAttachment, type QueuedFollowup } from "./queued-followups";
import { WorkspacePanel as ProductWorkspacePanel, type WorkspacePanelId, type WorkspaceProject, type WorkspaceSkill, type WorkspaceKnowledge } from "./features/workspace";
import { composerDraftKey, draftMatchesExecutionContext } from "./composer-drafts";
import { useComposerDraft } from "./use-composer-draft";
import { isComposerComposing } from "./composer-keyboard";
import { chatPath, closeModalNavigation, isModalWorkspacePage, openModalNavigation } from "./workspace-navigation";

gsap.registerPlugin(useGSAP);

const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "http://localhost:8787";

type ConnectionState = "idle" | "connecting" | "open" | "closed";
type WorkspacePanel = "knowledge" | "agent" | null;
type ComposerPaletteMode = "skill" | "context" | null;
interface LocalWorkspace {
  workspace: { id: string; name: string; path: string };
  profile: { displayName: string; email?: string; language?: string; avatar?: string };
  settings: { agent?: { name?: string; instructions?: string; defaultModel?: string; effort?: Effort }; theme?: ThemePreference };
  runtime: { executor: string; localOnly: boolean; persistence: string; imageGenerationConfigured?: boolean };
  projects: WorkspaceProject[];
  conversations: RecentTask[];
  skills?: WorkspaceSkill[];
  knowledge?: WorkspaceKnowledge[];
}
type ComposerAttachment = QueuedAttachment;
type ProjectRunSnapshot = ConversationRunSnapshot & { projectId?: string | null };
const productRoutes: Record<string, WorkspacePanelId> = { images: "images", skills: "skills", projects: "projects", agent: "agent", search: "search", settings: "settings", workspace: "workspace", research: "research", guides: "guides", handoff: "handoff" };
function currentPage(): WorkspacePanelId | null { return productRoutes[window.location.pathname.split("/")[1] ?? ""] ?? null; }


interface SkillOption {
  id: string;
  label: string;
  description: string;
  icon: LucideIcon;
}

interface ContextOption {
  id: string;
  knowledgeId?: string;
  label: string;
  path: string;
  description: string;
  icon: LucideIcon;
}

const recentTasksStorageKey = "openrigor.recent-tasks";
const activeConversationStorageKey = "openrigor.active-conversation";

function loadRecentTasks(): RecentTask[] {
  try {
    return parseRecentTasks(window.localStorage.getItem(recentTasksStorageKey));
  } catch {
    return [];
  }
}

function initialComposerDraftKey(): string {
  const routeRoot = window.location.pathname.match(/^\/chat\/([^/]+)$/)?.[1];
  if (routeRoot) return composerDraftKey({ rootRunId: decodeURIComponent(routeRoot) });
  const activeRoot = !currentPage() ? window.localStorage.getItem(activeConversationStorageKey) : null;
  if (activeRoot && loadRecentTasks().some((task) => task.rootRunId === activeRoot)) return composerDraftKey({ rootRunId: activeRoot });
  return composerDraftKey({ projectId: window.localStorage.getItem("openrigor.active-project") });
}

function createClientRequestId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return `web_${uuid ?? `${Date.now()}_${Math.random().toString(36).slice(2)}`}`;
}

const skillOptions: SkillOption[] = [
  { id: "browser", label: "浏览器", description: "检查网页与交互状态", icon: Globe2 },
  { id: "frontend-design", label: "前端设计", description: "优化产品界面与体验", icon: Palette },
  { id: "pdf", label: "PDF", description: "读取、生成与检查 PDF", icon: FileText },
  { id: "pptx", label: "演示文稿", description: "创建与编辑 PowerPoint", icon: Presentation },
  { id: "spreadsheets", label: "电子表格", description: "分析并生成表格文件", icon: FileSpreadsheet },
  { id: "research-lit", label: "文献检索", description: "检索和梳理研究资料", icon: BookOpen },
  { id: "docx", label: "Word 文档", description: "保留格式地创建与编辑文档", icon: FileText },
  { id: "playwright", label: "网页测试", description: "自动验收真实浏览器交互", icon: Terminal },
  { id: "paper-analyze", label: "论文分析", description: "深读论文并提炼方法与证据", icon: BrainCircuit },
  { id: "imagegen", label: "图像生成", description: "生成适合交付的位图素材", icon: Palette },
  { id: "skill-creator", label: "创建技能", description: "为 Codex 打包可复用工作流", icon: WandSparkles },
  { id: "openai-docs", label: "OpenAI 文档", description: "核对 Codex 与 OpenAI 官方能力", icon: BookOpen }
];

const contextOptions: ContextOption[] = [
  { id: "workspace", label: "当前项目", path: ".", description: "项目代码、文档与 Git 状态", icon: Folder },
  { id: "agents", label: "项目规则", path: "AGENTS.md", description: "仓库内的工程与安全约束", icon: ShieldCheck },
  { id: "report", label: "技术报告", path: "docs/TECHNICAL_REPORT.md", description: "ClawsGO 技术调研与复刻路线", icon: FileText },
  { id: "design", label: "设计系统", path: "design-system/openrigor/MASTER.md", description: "OpenRigor 的视觉与交互规则", icon: Palette }
];

const themeIcons: Record<ThemePreference, LucideIcon> = {
  light: Sun,
  dark: Moon,
  system: Monitor
};

// Require every protocol event to have an SSE subscription, including new additive events.
const eventTypes = Object.keys({
  snapshot: true, status: true, part: true, "part-delta": true,
  tool: true, plan: true, source: true, file: true, subagent: true,
  "run-finished": true, error: true
} satisfies Record<RunEvent["type"], true>) as RunEvent["type"][];

function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function statusLabel(status: RunSnapshot["status"]): string {
  const labels: Record<RunSnapshot["status"], string> = {
    queued: "排队中",
    running: "执行中",
    waiting_tool: "调用工具",
    waiting_user: "等待确认",
    cancelling: "正在停止",
    completed: "已完成",
    failed: "失败",
    cancelled: "已停止"
  };
  return labels[status];
}

function isTerminalStatus(status: RunSnapshot["status"]): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

function ComposerChip({ icon: Icon, label, onRemove }: { icon: LucideIcon; label: string; onRemove: () => void }): ReactElement {
  const chipRef = useRef<HTMLButtonElement>(null);
  useGSAP(() => {
    const root = chipRef.current;
    if (!root || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    gsap.fromTo(root, { autoAlpha: 0, y: 4, scale: 0.96 }, { autoAlpha: 1, y: 0, scale: 1, duration: 0.18, ease: "power2.out", clearProps: "transform,opacity,visibility" });
  }, { scope: chipRef });
  return <button ref={chipRef} type="button" onClick={onRemove}><Icon aria-hidden="true" />{label}<X aria-hidden="true" /></button>;
}

function useDialogEntrance(open: boolean, rootRef: { current: HTMLDivElement | null }, selector: string, key = ""): void {
  useGSAP(() => {
    const root = rootRef.current;
    if (!root || !open) return;
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      const overlay = root.parentElement?.querySelector<HTMLElement>('[data-slot="dialog-overlay"]');
      const timeline = gsap.timeline({ defaults: { ease: "power2.out" } });
      if (overlay) timeline.fromTo(overlay, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.15 }, 0);
      timeline
        .fromTo(root, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.16, clearProps: "opacity,visibility" }, 0)
        .fromTo(selector, { autoAlpha: 0, y: 6 }, { autoAlpha: 1, y: 0, duration: 0.16, stagger: 0.025, clearProps: "transform,opacity,visibility" }, 0.03);
    }, root);
    return () => media.revert();
  }, { scope: rootRef, dependencies: [open, key], revertOnUpdate: true });
}

function BrandMark(): ReactElement {
  return <span className="brand-mark" aria-hidden="true"><Command /></span>;
}

function IconTooltip({ label, children }: { label: string; children: ReactElement }): ReactElement {
  return <TooltipRoot>
    <TooltipTrigger asChild>{children}</TooltipTrigger>
    <TooltipContent className="radix-tooltip" sideOffset={7}>{label}</TooltipContent>
  </TooltipRoot>;
}

function ExampleDialogPanel({
  example,
  onUse,
  restoreFocus
}: {
  example: ExampleTask;
  onUse: (example: ExampleTask) => void;
  restoreFocus: () => void;
}): ReactElement {
  const Icon = example.icon;
  const visual = example.visual ?? "research";
  const contentRef = useRef<HTMLDivElement>(null);
  useDialogEntrance(true, contentRef, ".example-dialog-visual, .example-dialog-heading, .example-meta, .example-prompt, .dialog-actions", example.title);

  useGSAP(() => {
    const root = contentRef.current;
    if (!root) return;
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      const previews = gsap.utils.toArray<HTMLElement>(".example-dialog-stage > .example-art");
      const [primaryPreview, companionPreview] = previews;
      const timeline = gsap.timeline({ defaults: { ease: "power3.out" } });
      timeline
        .fromTo(".example-dialog-glow", { autoAlpha: 0, scale: 0.84 }, { autoAlpha: 1, scale: 1, duration: 0.62, clearProps: "transform,opacity,visibility" }, 0.02);
      if (primaryPreview) {
        timeline.fromTo(
          primaryPreview,
          { autoAlpha: 0, x: -72, y: 26, rotation: -13, scale: 1.68 },
          { autoAlpha: 1, x: 0, y: 0, rotation: -5, scale: 1.92, duration: 0.56, clearProps: "transform,opacity,visibility" },
          0.06
        );
      }
      if (companionPreview) {
        timeline.fromTo(
          companionPreview,
          { autoAlpha: 0, x: 76, y: 34, rotation: 12, scale: 1.64 },
          { autoAlpha: 1, x: 0, y: 0, rotation: 4, scale: 1.9, duration: 0.62, clearProps: "transform,opacity,visibility" },
          0.17
        );
      }
      timeline.fromTo(".example-dialog-icon", { autoAlpha: 0, scale: 0.84 }, { autoAlpha: 1, scale: 1, duration: 0.28, ease: "back.out(1.35)", clearProps: "transform,opacity,visibility" }, 0.2);
    }, root);
    return () => media.revert();
  }, { scope: contentRef, dependencies: [visual], revertOnUpdate: true });

  return <DialogContent ref={contentRef} className="dialog-content example-dialog" showCloseButton={false} onCloseAutoFocus={(event) => { event.preventDefault(); restoreFocus(); }}>
        <DialogClose asChild><button type="button" className="dialog-close example-dialog-close" aria-label="关闭"><X aria-hidden="true" /></button></DialogClose>
        <div className="example-dialog-visual" aria-hidden="true">
          <div className="example-dialog-stage">
            <span className="example-dialog-glow" />
            <ExamplePreviewArt visual={visual} generated />
            <ExamplePreviewArt visual={companionVisuals[visual]} generated />
          </div>
        </div>
        <div className="example-dialog-body">
          <div className="example-dialog-heading">
            <span className="example-dialog-icon"><Icon aria-hidden="true" /></span>
            <div>
              <DialogTitle className="dialog-title">{example.title}</DialogTitle>
              <DialogDescription className="dialog-description">{example.description}</DialogDescription>
            </div>
          </div>
          <div className="example-meta"><span>本地 Codex</span><span>工作区任务</span><small>确认后可编辑</small></div>
          <div className="example-prompt"><p>{example.prompt}</p></div>
          <div className="dialog-actions">
            <DialogClose asChild><button type="button" className="secondary-button">取消</button></DialogClose>
            <button type="button" className="primary-button" onClick={() => onUse(example)}>使用这个案例</button>
          </div>
        </div>
      </DialogContent>;
}

function ExampleDialog({
  example,
  onClose,
  onUse,
  restoreFocus
}: {
  example: ExampleTask | null;
  onClose: () => void;
  onUse: (example: ExampleTask) => void;
  restoreFocus: () => void;
}): ReactElement {
  return <Dialog open={Boolean(example)} onOpenChange={(open) => { if (!open) onClose(); }}>
    {example ? <ExampleDialogPanel key={example.title} example={example} onUse={onUse} restoreFocus={restoreFocus} /> : null}
  </Dialog>;
}

function KnowledgeDialog({
  open,
  onOpenChange,
  selected,
  onToggle,
  restoreFocus,
  contexts = contextOptions
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contexts?: ContextOption[];
  selected: string[];
  onToggle: (id: string) => void;
  restoreFocus: () => void;
}): ReactElement {
  const [query, setQuery] = useState("");
  const contentRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (open) setQuery(""); }, [open]);
  const filtered = contexts.filter((item) => `${item.label} ${item.path} ${item.description}`.toLowerCase().includes(query.toLowerCase()));
  useDialogEntrance(open, contentRef, ".dialog-header, .dialog-search, .context-list, .split-actions");
  useGSAP(() => {
    const root = contentRef.current;
    if (!root || !open) return;
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      gsap.fromTo(".context-item", { autoAlpha: 0, y: 5 }, { autoAlpha: 1, y: 0, duration: 0.15, stagger: 0.025, ease: "power2.out", clearProps: "transform,opacity,visibility" });
    }, root);
    return () => media.revert();
  }, { scope: contentRef, dependencies: [open], revertOnUpdate: true });
  return <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent ref={contentRef} className="dialog-content workspace-dialog" showCloseButton={false} onCloseAutoFocus={(event) => { event.preventDefault(); restoreFocus(); }}>
        <div className="dialog-header">
          <span className="dialog-icon"><Library aria-hidden="true" /></span>
          <div>
            <DialogTitle className="dialog-title">知识与上下文</DialogTitle>
            <DialogDescription className="dialog-description">选择本次任务优先读取的本地材料。</DialogDescription>
          </div>
          <DialogClose asChild><button type="button" className="dialog-close" aria-label="关闭"><X aria-hidden="true" /></button></DialogClose>
        </div>
        <label className="dialog-search"><Search aria-hidden="true" /><input aria-label="搜索项目材料" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索项目材料" /></label>
        <div className="context-list">
          {filtered.map((item) => {
            const Icon = item.icon;
            const active = selected.includes(item.id);
            return <button type="button" className={active ? "context-item selected" : "context-item"} key={item.id} onClick={() => onToggle(item.id)} aria-pressed={active}>
              <span className="context-icon"><Icon aria-hidden="true" /></span>
              <span className="context-copy"><strong>{item.label}</strong><code>{item.path}</code><small>{item.description}</small></span>
              <span className="selection-box">{active ? <Check aria-hidden="true" /> : null}</span>
            </button>;
          })}
        </div>
        <div className="dialog-actions split-actions"><span>{selected.length} 个上下文将在任务开始时提供给 Codex</span><DialogClose asChild><button type="button" className="primary-button">完成</button></DialogClose></div>
      </DialogContent>
  </Dialog>;
}

export function App(): ReactElement {
  const initialRoutingPreference = window.localStorage.getItem("openrigor.routing") ? readStoredRoutingPreference() : "manual";
  const initialManualExecutionPreference = window.localStorage.getItem("openrigor.execution.manual") ? readStoredManualExecutionPreference() : { model: "auto" as const, effort: "medium" as const, mode: "standard" as const };
  const browserExecutionWasSet = useRef(Boolean(window.localStorage.getItem("openrigor.execution.manual") || window.localStorage.getItem("openrigor.routing")));
  const { prompt, setPrompt, attachments, setAttachments, selectedSkills, setSelectedSkills, selectedContexts, setSelectedContexts, session: draftSession, activateDraft, acknowledgeDraft, acceptDraft } = useComposerDraft(initialComposerDraftKey);
  const [activeTab, setActiveTab] = useState<TabId>("research");
  const [conversation, setConversation] = useState<ConversationViewState | null>(null);
  const [conversationProject, setConversationProject] = useState<{ rootRunId: string; projectId: string | null } | null>(null);
  const [connection, setConnection] = useState<ConnectionState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [model, setModel] = useState<ModelId>(initialRoutingPreference === "tokenresearch" ? tokenResearchRoutingProfile.coordinator.model : initialManualExecutionPreference.model);
  const [effort, setEffort] = useState<Effort>(initialRoutingPreference === "tokenresearch" ? tokenResearchRoutingProfile.coordinator.effort : initialManualExecutionPreference.effort);
  const [mode, setMode] = useState<RunMode>(initialRoutingPreference === "tokenresearch" ? tokenResearchRoutingProfile.coordinator.mode : initialManualExecutionPreference.mode);
  const [routing, setRouting] = useState<RoutingPreference>(initialRoutingPreference);
  const browserThemeWasSet = useRef(Boolean(window.localStorage.getItem("openrigor.theme")));
  const [theme, setTheme] = useState<ThemePreference>(window.localStorage.getItem("openrigor.theme") ? initialThemePreference : "dark");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => window.localStorage.getItem("openrigor.sidebar-collapsed") === "true");
  const [page, setPage] = useState<WorkspacePanelId | null>(currentPage);
  const [projectCreationRequested, setProjectCreationRequested] = useState(() => currentPage() === "projects" && new URLSearchParams(window.location.search).get("create") === "1");
  const [workspace, setWorkspace] = useState<LocalWorkspace | null>(null);
  const [runtimeModels, setRuntimeModels] = useState<RuntimeModel[]>(readStoredModelCatalog);
  const [selectedProject, setSelectedProject] = useState<WorkspaceProject | null>(null);
  const [uploading, setUploading] = useState(false);
  const uploadAbortRef = useRef<AbortController | null>(null);
  const [renamingTask, setRenamingTask] = useState<RecentTask | null>(null);
  const [taskTitle, setTaskTitle] = useState("");
  const [savingTaskTitle, setSavingTaskTitle] = useState(false);
  const [queuedMessages, setQueuedMessages] = useState<QueuedFollowup[]>(loadQueuedFollowups);
  const [projectsExpanded, setProjectsExpanded] = useState(true);
  const [tasksExpanded, setTasksExpanded] = useState(true);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const availableSkills = useMemo<SkillOption[]>(() => workspace?.skills ? workspace.skills.filter((skill) => skill.installed).map((skill) => ({ id: skill.id, label: skill.name ?? skill.label ?? skill.id, description: skill.description, icon: skillOptions.find((item) => item.id === skill.id)?.icon ?? WandSparkles })) : skillOptions, [workspace?.skills]);
  const availableContexts = useMemo<ContextOption[]>(() => [
    ...contextOptions.map((item) => item.id === "workspace" ? { ...item, path: conversation ? workspace?.projects.find((project) => project.id === conversationProject?.projectId)?.path ?? (conversationProject?.projectId ? "." : workspace?.workspace.path ?? ".") : selectedProject?.path ?? workspace?.workspace.path ?? "." } : item),
    ...(workspace?.knowledge ?? []).map((item) => ({ id: `knowledge_${item.id}`, knowledgeId: item.id, label: item.name, path: "Knowledge source", description: item.content.slice(0, 100), icon: BookOpen }))
  ], [workspace?.workspace.path, workspace?.projects, workspace?.knowledge, selectedProject?.path, conversation?.rootRunId, conversationProject]);
  const [recentTasks, setRecentTasks] = useState<RecentTask[]>(loadRecentTasks);
  const [selectedExample, setSelectedExample] = useState<ExampleTask | null>(null);
  const [workspacePanel, setWorkspacePanel] = useState<WorkspacePanel>(null);
  const [paletteMode, setPaletteMode] = useState<ComposerPaletteMode>(null);
  const [paletteIndex, setPaletteIndex] = useState(0);
  const [copiedRunId, setCopiedRunId] = useState<string | null>(null);
  const eventSource = useRef<EventSource | null>(null);
  const activeRunIdRef = useRef<string | null>(null);
  const viewRequestRef = useRef(0);
  const restoreAbortRef = useRef<AbortController | null>(null);
  const startAbortRef = useRef<AbortController | null>(null);
  const startingRef = useRef(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isRestoringTask, setIsRestoringTask] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const appShellRef = useRef<HTMLDivElement | null>(null);
  const actionButtonRef = useRef<HTMLButtonElement | null>(null);
  const toastRef = useRef<HTMLDivElement | null>(null);
  const exampleTriggerRef = useRef<HTMLButtonElement | null>(null);
  const knowledgeTriggerRef = useRef<HTMLButtonElement | null>(null);
  const agentTriggerRef = useRef<HTMLButtonElement | null>(null);
  const addMenuTriggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => { persistQueuedFollowups(queuedMessages); }, [queuedMessages]);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${apiBase}/api/workspace`, { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error("Workspace is unavailable");
      const data = await response.json() as LocalWorkspace;
      setWorkspace(data);
      if (data.skills) setSelectedSkills((previous) => previous.filter((id) => data.skills!.some((skill) => skill.id === id && skill.installed)));
      if (!browserThemeWasSet.current && data.settings?.theme && ["light", "dark", "system"].includes(data.settings.theme)) { setTheme(data.settings.theme); applyTheme(data.settings.theme); }
      if (Array.isArray(data.conversations)) setRecentTasks(data.conversations.filter((item) => isRunStatus(item.status)).map((item) => ({ ...item, prompt: cleanHistoryPrompt(item.prompt) })));
      if (!browserExecutionWasSet.current && data.settings?.agent) {
        const preferences = data.settings.agent;
        if (preferences.defaultModel && /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.test(preferences.defaultModel)) setModel(preferences.defaultModel);
        if (preferences.effort && ["low", "medium", "high", "xhigh", "max"].includes(preferences.effort)) setEffort(preferences.effort);
        setRouting("manual"); setMode("standard");
      }
      const storedProjectId = window.localStorage.getItem("openrigor.active-project");
      if (Array.isArray(data.projects)) {
        const project = data.projects.find((item) => item.id === storedProjectId) ?? null;
        setSelectedProject(project);
        // A route being restored already owns its conversation draft, even before its API response arrives.
        if (!draftSession.key.startsWith("conversation:")) switchComposerDraft(composerDraftKey({ projectId: project?.id }));
      }
    }).catch(() => { /* The composer reports actionable API failures; retain cached navigation while offline. */ });
    return () => controller.abort();
  }, [refreshVersion]);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${apiBase}/api/models`, { signal: controller.signal }).then(async (response) => {
      if (!response.ok) return;
      const data = await response.json() as { models?: unknown };
      setRuntimeModels(persistModelCatalog(data.models));
    }).catch(() => { /* Auto follows the configured runtime when model discovery is unavailable. */ });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const navigate = () => {
      setPage(currentPage());
      setProjectCreationRequested(currentPage() === "projects" && new URLSearchParams(window.location.search).get("create") === "1");
      const runId = window.location.pathname.match(/^\/chat\/([^/]+)$/)?.[1];
      if (runId) { if (decodeURIComponent(runId) !== conversation?.rootRunId) void openTaskById(decodeURIComponent(runId), false); }
      else if (!currentPage()) { beginViewRequest(); switchComposerDraft(composerDraftKey({ projectId: selectedProject?.id })); setConversation(null); setConversationProject(null); closeStream("idle"); window.localStorage.removeItem(activeConversationStorageKey); }
    };
    window.addEventListener("popstate", navigate);
    const keyDown = (event: globalThis.KeyboardEvent) => {
      if (isComposerComposing(event)) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); navigatePage("search"); }
      if (event.key === "Escape") setSidebarOpen(false);
    };
    window.addEventListener("keydown", keyDown);
    return () => { window.removeEventListener("popstate", navigate); window.removeEventListener("keydown", keyDown); };
  }, [recentTasks, selectedProject, conversation?.rootRunId]);

  async function updateTask(task: RecentTask, patch: { title?: string; pinned?: boolean; archived?: boolean }): Promise<void> {
    const response = await fetch(`${apiBase}/api/conversations/${encodeURIComponent(task.rootRunId)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
    const body = await response.json() as { error?: string };
    if (!response.ok) throw new Error(body.error ?? "Unable to update task");
    if (patch.archived) { setRecentTasks((previous) => previous.filter((item) => item.rootRunId !== task.rootRunId)); if (conversation?.rootRunId === task.rootRunId) resetWorkspace(); }
    else setRecentTasks((previous) => previous.map((item) => item.rootRunId === task.rootRunId ? { ...item, ...patch } : item));
    setRefreshVersion((value) => value + 1);
  }
  async function exportTask(task: RecentTask): Promise<void> {
    try {
      const response = await fetch(`${apiBase}/api/runs/${encodeURIComponent(task.latestRunId)}`);
      if (!response.ok) throw new Error("Unable to export task");
      const body = await response.json() as unknown;
      const url = URL.createObjectURL(new Blob([JSON.stringify(body, null, 2)], { type: "application/json" }));
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${(task.title ?? task.prompt).replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, "_").slice(0, 64) || "openrigor-task"}.json`; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to export task"); }
  }

  function navigatePage(next: WorkspacePanelId | null): void {
    const nextPath = next ? `/${next}` : "/chat";
    if (window.location.pathname + window.location.search !== nextPath) {
      if (isModalWorkspacePage(next)) {
        const navigation = openModalNavigation(window.location.pathname + window.location.search, currentPage(), window.history.state, chatPath(conversation?.rootRunId));
        if (navigation.method === "replace") window.history.replaceState(navigation.state, "", nextPath);
        else window.history.pushState(navigation.state, "", nextPath);
      } else window.history.pushState({}, "", nextPath);
    }
    setProjectCreationRequested(false);
    setPage(next);
    setSidebarOpen(false);
  }

  function closeProductPanel(): void {
    const fallback = chatPath(conversation?.rootRunId ?? window.localStorage.getItem(activeConversationStorageKey));
    const navigation = isModalWorkspacePage(page) ? closeModalNavigation(window.history.state, fallback) : { method: "replace" as const, path: fallback };
    if (navigation.method === "back") window.history.back();
    else window.history.replaceState({}, "", navigation.path);
    setPage(productRoutes[navigation.path.split(/[/?]/)[1] ?? ""] ?? null);
    setProjectCreationRequested(false);
    const root = navigation.path.match(/^\/chat\/([^/?]+)$/)?.[1];
    if (navigation.method === "replace" && root && decodeURIComponent(root) !== conversation?.rootRunId) void openTaskById(decodeURIComponent(root), false);
    setRefreshVersion((value) => value + 1);
  }

  function openNewProject(): void {
    const nextPath = "/projects?create=1";
    if (window.location.pathname + window.location.search !== nextPath) window.history.pushState({}, "", nextPath);
    setProjectCreationRequested(true);
    setPage("projects");
    setSidebarOpen(false);
    window.dispatchEvent(new CustomEvent("openrigor:new-project"));
  }

  function selectProject(project: WorkspaceProject | null): void {
    setSelectedProject(project);
    if (project) window.localStorage.setItem("openrigor.active-project", project.id);
    else window.localStorage.removeItem("openrigor.active-project");
  }

  function chooseComposerProject(project: WorkspaceProject | null): void {
    selectProject(project);
    if (conversation) resetWorkspace(project);
    else switchComposerDraft(composerDraftKey({ projectId: project?.id }));
  }

  async function openTaskById(runId: string, updateUrl = true): Promise<void> {
    const record = recentTasks.find((task) => task.rootRunId === runId || task.latestRunId === runId);
    await openRecentTask(record ?? { rootRunId: runId, conversationId: runId, latestRunId: runId, prompt: "Task", status: "completed", updatedAt: new Date().toISOString() }, updateUrl);
  }

  async function attachFiles(files: FileList | null): Promise<void> {
    if (!files?.length) return;
    uploadAbortRef.current?.abort();
    const controller = new AbortController();
    uploadAbortRef.current = controller;
    const owner = draftSession.capture();
    const isCurrentUpload = (): boolean => !controller.signal.aborted && uploadAbortRef.current === controller && draftSession.owns(owner);
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        if (!isCurrentUpload()) return;
        if (file.size > 10 * 1024 * 1024) throw new Error(`${file.name}: maximum attachment size is 10 MB`);
        const content = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          const abort = () => reader.abort();
          controller.signal.addEventListener("abort", abort, { once: true });
          reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
          reader.onerror = () => reject(new Error("Unable to read attachment"));
          reader.onabort = () => reject(new DOMException("Upload cancelled", "AbortError"));
          reader.onloadend = () => controller.signal.removeEventListener("abort", abort);
          reader.readAsDataURL(file);
        });
        if (!isCurrentUpload()) return;
        const response = await fetch(`${apiBase}/api/attachments`, { method: "POST", signal: controller.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: file.name, content, mimeType: file.type || "application/octet-stream" }) });
        const body = await response.json() as { attachment?: ComposerAttachment; error?: string };
        if (!isCurrentUpload()) return;
        if (!response.ok || !body.attachment) throw new Error(body.error ?? "Unable to upload attachment");
        setAttachments((previous) => [...previous, body.attachment!]);
      }
    } catch (caught) { if (isCurrentUpload()) setError(caught instanceof Error ? caught.message : "Unable to upload attachment"); }
    finally {
      if (uploadAbortRef.current === controller) {
        uploadAbortRef.current = null;
        setUploading(false);
        if (attachmentInputRef.current) attachmentInputRef.current.value = "";
      }
    }
  }

  useEffect(() => () => {
    eventSource.current?.close();
    restoreAbortRef.current?.abort();
    startAbortRef.current?.abort();
    uploadAbortRef.current?.abort();
  }, []);

  useEffect(() => {
    try { window.localStorage.setItem(recentTasksStorageKey, serializeRecentTasks(recentTasks)); } catch { /* Cached navigation is optional when browser storage is unavailable. */ }
  }, [recentTasks]);

  useEffect(() => {
    applyTheme(theme);
    persistTheme(theme);
    if (theme !== "system") return;
    const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");
    const syncSystemTheme = () => applyTheme("system");
    systemTheme.addEventListener("change", syncSystemTheme);
    return () => systemTheme.removeEventListener("change", syncSystemTheme);
  }, [theme]);

  useEffect(() => {
    persistRoutingPreference(routing);
  }, [routing]);

  useEffect(() => {
    if (routing !== "manual") return;
    persistManualExecutionPreference({ model, effort, mode });
  }, [effort, mode, model, routing]);

  useEffect(() => {
    if (currentPage()) return;
    const routeRunId = window.location.pathname.match(/^\/chat\/([^/]+)$/)?.[1];
    if (routeRunId) { void openTaskById(decodeURIComponent(routeRunId)); return; }
    const activeRootRunId = window.localStorage.getItem(activeConversationStorageKey);
    if (!activeRootRunId) return;
    const task = recentTasks.find((item) => item.rootRunId === activeRootRunId);
    if (task) void openRecentTask(task);
    else window.localStorage.removeItem(activeConversationStorageKey);
  }, []);

  const latestRun = conversation?.runs.at(-1) ?? null;
  const snapshot = latestRun?.snapshot ?? null;
  const isRunning = Boolean(snapshot && !isTerminalStatus(snapshot.status));
  const activeProjectId = conversationProject?.rootRunId === conversation?.rootRunId ? conversationProject?.projectId : undefined;
  const isComposerContextReady = draftMatchesExecutionContext(draftSession.key, conversation?.rootRunId ?? null, conversation ? activeProjectId : selectedProject?.id ?? null);
  const composerProject = conversation ? workspace?.projects.find((project) => project.id === activeProjectId) ?? null : selectedProject;
  const activeTask = conversation ? recentTasks.find((task) => task.rootRunId === conversation.rootRunId) : undefined;
  const navigationProjectId = conversation && !page
    ? activeProjectId === undefined ? activeTask?.projectId ?? null : activeProjectId
    : selectedProject?.id ?? null;
  const navigationProject = workspace?.projects.find((project) => project.id === navigationProjectId) ?? null;
  const visibleRecentTasks = recentTasks
    .filter((task) => navigationProjectId ? task.projectId === navigationProjectId : !task.projectId)
    .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)));
  const conversationTitle = activeTask?.title || conversation?.runs[0]?.visiblePrompt || "";
  const conversationQueue = queuedMessages.filter((item) => item.rootRunId === conversation?.rootRunId);
  useEffect(() => {
    if (!conversation || !snapshot || isRunning || isRestoringTask || uploading || startingRef.current || activeProjectId === undefined) return;
    const next = conversationQueue[0];
    if (!next || !queueMatchesConversation(next, conversation.rootRunId, snapshot.runId, activeProjectId)) return;
    void startRun(next.prompt, next.attachments, next);
  }, [conversation?.rootRunId, snapshot?.runId, isRunning, isRestoringTask, uploading, queuedMessages, activeProjectId]);
  const hasExplicitContexts = selectedContexts.some((id) => id !== "workspace");
  const executionPreference = resolveExecutionPreference(routing, model, effort, mode);

  const paletteItems = useMemo<ComposerPaletteItem[]>(() => {
    if (!paletteMode) return [];
    const query = prompt.match(/(?:^|\s)[\/@]([^\s]*)$/)?.[1]?.toLowerCase() ?? "";
    if (paletteMode === "skill") {
      return availableSkills
        .filter((skill) => `${skill.label} ${skill.id} ${skill.description}`.toLowerCase().includes(query))
        .map((skill) => ({ id: skill.id, label: skill.label, description: skill.description, icon: skill.icon, kind: "skill" as const }));
    }
    return availableContexts
      .filter((context) => `${context.label} ${context.path} ${context.description}`.toLowerCase().includes(query))
      .map((context) => ({ id: context.id, label: context.label, description: context.description, path: context.path, icon: context.icon, kind: "context" as const }));
  }, [paletteMode, prompt, availableContexts, availableSkills]);

  useEffect(() => {
    setPaletteIndex((current) => paletteItems.length ? Math.min(current, paletteItems.length - 1) : 0);
  }, [paletteItems.length, paletteMode]);

  useGSAP(() => {
    const root = appShellRef.current;
    if (!root) return;
    const media = gsap.matchMedia();
    media.add("(min-width: 901px) and (prefers-reduced-motion: no-preference)", () => {
      const timeline = gsap.timeline({ defaults: { ease: "power2.out" } });
      const sidebar = root.querySelector(".sidebar");
      const controls = root.querySelectorAll(".sidebar .account-switcher, .sidebar .nav-item, .sidebar .sidebar-section, .sidebar-bottom");
      if (sidebar) timeline.fromTo(sidebar, { autoAlpha: 0, x: -8 }, { autoAlpha: 1, x: 0, duration: 0.28, clearProps: "transform,opacity,visibility" });
      if (controls.length) timeline.fromTo(controls, { autoAlpha: 0, x: -5 }, { autoAlpha: 1, x: 0, duration: 0.22, stagger: 0.025, clearProps: "transform,opacity,visibility" }, 0.03);
    }, root);
    media.add("(prefers-reduced-motion: no-preference)", () => {
      const timeline = gsap.timeline({ defaults: { ease: "power2.out" } });
      const header = root.querySelector(".main-header");
      const composer = root.querySelector(".composer-region");
      if (header) timeline.fromTo(header, { autoAlpha: 0, y: -4 }, { autoAlpha: 1, y: 0, duration: 0.26, clearProps: "transform,opacity,visibility" });
      if (composer) timeline.fromTo(composer, { autoAlpha: 0, y: 7 }, { autoAlpha: 1, y: 0, duration: 0.28, clearProps: "transform,opacity,visibility" }, 0.04);
    }, root);
    return () => media.revert();
  }, { scope: appShellRef });

  useGSAP(() => {
    const root = appShellRef.current;
    const view = root?.querySelector<HTMLElement>(".conversation-view");
    if (!root || !view || !conversation) return;
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      gsap.fromTo(view, { autoAlpha: 0, y: 7 }, { autoAlpha: 1, y: 0, duration: 0.26, ease: "power2.out", clearProps: "transform,opacity,visibility" });
    }, root);
    return () => media.revert();
  }, { scope: appShellRef, dependencies: [Boolean(conversation)], revertOnUpdate: true });

  useGSAP(() => {
    const button = actionButtonRef.current;
    if (!button) return;
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      gsap.fromTo(button, { autoAlpha: 0.45, scale: 0.82, rotation: isRunning ? -7 : 7 }, { autoAlpha: 1, scale: 1, rotation: 0, duration: 0.22, ease: "back.out(1.45)", clearProps: "transform,opacity,visibility" });
    }, button);
    return () => media.revert();
  }, { scope: appShellRef, dependencies: [isRunning], revertOnUpdate: true });

  useGSAP(() => {
    const toast = toastRef.current;
    if (!toast || !error) return;
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      gsap.timeline({ defaults: { ease: "power2.out" } })
        .fromTo(toast, { autoAlpha: 0, x: 12, y: 7 }, { autoAlpha: 1, x: 0, y: 0, duration: 0.22, clearProps: "transform,opacity,visibility" })
        .fromTo(".toast-icon", { scale: 0.8 }, { scale: 1, duration: 0.2, ease: "back.out(1.5)", clearProps: "transform" }, "<0.04");
    }, toast);
    return () => media.revert();
  }, { scope: appShellRef, dependencies: [Boolean(error)], revertOnUpdate: true });

  function rememberTask(task: RecentTask, authoritativeProjectId?: string | null): void {
    setRecentTasks((previous) => rememberRecentTask(previous, task, authoritativeProjectId));
  }

  function updateRecentTask(runId: string, patch: Partial<Pick<RecentTask, "status" | "updatedAt">>): void {
    setRecentTasks((previous) => previous.map((item) => item.latestRunId === runId ? { ...item, ...patch } : item));
  }

  function closeStream(nextConnection: ConnectionState = "closed"): void {
    eventSource.current?.close();
    eventSource.current = null;
    activeRunIdRef.current = null;
    setConnection(nextConnection);
  }

  function beginViewRequest(): number {
    viewRequestRef.current += 1;
    restoreAbortRef.current?.abort();
    restoreAbortRef.current = null;
    startAbortRef.current?.abort();
    startAbortRef.current = null;
    setIsRestoringTask(false);
    return viewRequestRef.current;
  }

  function cancelDraftUpload(): void {
    uploadAbortRef.current?.abort();
    uploadAbortRef.current = null;
    setUploading(false);
    if (attachmentInputRef.current) attachmentInputRef.current.value = "";
  }

  function switchComposerDraft(key: string): void {
    if (draftSession.key === key) return;
    cancelDraftUpload();
    activateDraft(key);
    setPaletteMode(null);
  }

  function resetWorkspace(project: WorkspaceProject | null = selectedProject): void {
    navigatePage(null);
    beginViewRequest();
    switchComposerDraft(composerDraftKey({ projectId: project?.id }));
    setConversation(null);
    setConversationProject(null);
    setSidebarOpen(false);
    setPaletteMode(null);
    setCopiedRunId(null);
    closeStream("idle");
    window.localStorage.removeItem(activeConversationStorageKey);
    window.setTimeout(() => textareaRef.current?.focus(), 0);
  }

  function openWorkspaceDialog(panel: Exclude<WorkspacePanel, null>, trigger: HTMLButtonElement | null): void {
    if (panel === "knowledge") knowledgeTriggerRef.current = trigger;
    else agentTriggerRef.current = trigger;
    setWorkspacePanel(panel);
  }

  function consumeEvent(event: RunEvent): void {
    setConversation((previous) => previous ? applyRunEvent(previous, event) : previous);
    if (event.type === "snapshot") {
      const eventSnapshot = event.snapshot as ProjectRunSnapshot;
      const rootRunId = eventSnapshot.rootRunId ?? eventSnapshot.runId;
      const projectId = typeof eventSnapshot.projectId === "string" ? eventSnapshot.projectId : null;
      setConversationProject({ rootRunId, projectId });
      rememberTask({
        rootRunId,
        conversationId: eventSnapshot.conversationId ?? rootRunId,
        latestRunId: eventSnapshot.runId,
        prompt: eventSnapshot.prompt,
        status: eventSnapshot.status,
        updatedAt: eventSnapshot.updatedAt
      }, projectId);
    }
    if (event.type === "status") {
      updateRecentTask(event.runId, { status: event.status, updatedAt: event.ts });
    }
    if (event.type === "run-finished") {
      updateRecentTask(event.runId, { status: event.status, updatedAt: event.ts });
      setRefreshVersion((value) => value + 1);
      closeStream("idle");
    }
    if (event.type === "error") setError(event.message);
  }

  function subscribe(runId: string): void {
    closeStream("idle");
    setConnection("connecting");
    const source = new EventSource(`${apiBase}/api/runs/${runId}/events`);
    eventSource.current = source;
    activeRunIdRef.current = runId;
    const isCurrentSource = (): boolean => eventSource.current === source && activeRunIdRef.current === runId;
    source.onopen = () => { if (isCurrentSource()) setConnection("open"); };
    source.onerror = () => { if (isCurrentSource()) setConnection(source.readyState === EventSource.CONNECTING ? "connecting" : "closed"); };
    for (const type of eventTypes) source.addEventListener(type, (raw) => {
      if (!isCurrentSource()) return;
      try {
        const event = parseRunStreamEvent(raw);
        if (!event || event.runId !== runId || !isCurrentSource()) return;
        consumeEvent(event);
      } catch {
        if (isCurrentSource()) setError("服务返回了无法识别的事件");
      }
    });
  }

  async function startRun(nextPrompt = prompt, nextAttachments = attachments, queuedMessage?: QueuedFollowup): Promise<void> {
    const cleanPrompt = nextPrompt.trim();
    if (!cleanPrompt || uploading || isRestoringTask || startingRef.current) return;
    if (draftSession.key.startsWith("conversation:") && draftSession.key !== composerDraftKey({ rootRunId: conversation?.rootRunId })) {
      setError("Reopen this task or choose New task before sending. Its conversation has not finished loading."); return;
    }
    if (!isComposerContextReady) { setError("Wait for the selected project to finish loading, or choose a project before sending."); return; }
    const sourceDraft = draftSession.capture();
    if (conversation && activeProjectId === undefined) { setError("Wait for this task's project to finish loading before sending a follow-up."); return; }
    if (isRunning && conversation && snapshot) {
      const prior = queuedMessages.filter((item) => item.rootRunId === conversation.rootRunId).at(-1);
      const queued = appendQueuedFollowup(queuedMessages, { id: createClientRequestId(), rootRunId: conversation.rootRunId, predecessorRunId: prior?.id ?? snapshot.runId, ...(activeProjectId ? { projectId: activeProjectId } : {}), prompt: cleanPrompt, attachments: nextAttachments });
      if (!queued.accepted) { setError(`The follow-up queue is full (${maxQueuedFollowups} messages). Remove a queued message or wait for one to finish. Your draft has been kept.`); return; }
      setQueuedMessages(queued.items);
      setError(null);
      acknowledgeDraft(sourceDraft); return;
    }
    const continueFromRunId = queuedMessage?.predecessorRunId ?? snapshot?.runId;
    const existingRootRunId = conversation?.rootRunId;
    const conversationTitle = conversation?.runs[0]?.visiblePrompt ?? cleanPrompt;
    startingRef.current = true;
    setIsStarting(true);
    const viewRequest = beginViewRequest();
    const controller = new AbortController();
    startAbortRef.current = controller;
    const clientRequestId = queuedMessage?.id ?? createClientRequestId();
    const enabledSkills = availableSkills.filter((skill) => selectedSkills.includes(skill.id));
    const executionProjectId = queuedMessage ? queuedMessage.projectId ?? null : conversation ? activeProjectId ?? null : selectedProject?.id ?? null;
    const enabledContexts = availableContexts.filter((context) => selectedContexts.includes(context.id));
    const contextPaths = enabledContexts.filter((context) => context.id !== "workspace" && !context.knowledgeId).map((context) => context.path);

    setError(null);
    closeStream("idle");
    try {
      // A browser can retain an id from an old local data directory. Retry
      // that explicit missing-continuation response as a fresh root run. This is limited
      // to the explicit continuation-not-found response so genuine failures
      // and route-level 404s remain visible.
      const { response, body, continuationExpired } = await requestRunStart({
        endpoint: `${apiBase}/api/runs`,
        body: {
          prompt: cleanPrompt,
          model: executionPreference.model,
          mode: executionPreference.mode,
          effort: executionPreference.effort,
          ...(routing === "tokenresearch" ? { routing } : {}),
          clientRequestId,
          ...(executionProjectId ? { projectId: executionProjectId } : {}),
          ...(nextAttachments.length ? { attachments: attachmentReferences(nextAttachments) } : {}),
          ...(enabledSkills.length ? { skillIds: enabledSkills.map((skill) => skill.id) } : {}),
          ...(contextPaths.length ? { contextPaths } : {}),
          ...(enabledContexts.some((context) => context.knowledgeId) ? { knowledgeIds: enabledContexts.flatMap((context) => context.knowledgeId ? [context.knowledgeId] : []) } : {})
        },
        ...(continueFromRunId === undefined ? {} : { continueFromRunId }),
        signal: controller.signal
      });
      if (!response.ok || !body.runId) throw new Error(body.error ?? "无法启动任务");
      if (queuedMessage) setQueuedMessages((previous) => acknowledgeQueuedFollowup(previous, queuedMessage.id, body.runId!));
      if (viewRequestRef.current !== viewRequest) { if (!queuedMessage) acknowledgeDraft(sourceDraft); return; }

      const acceptedAt = new Date().toISOString();
      const effectiveContinueFromRunId = continuationExpired ? undefined : continueFromRunId;
      const rootRunId = body.rootRunId ?? (effectiveContinueFromRunId === undefined ? body.runId : existingRootRunId ?? body.runId);
      const conversationId = body.conversationId ?? (effectiveContinueFromRunId === undefined ? rootRunId : conversation?.conversationId ?? rootRunId);
      const parentRunId = body.parentRunId ?? effectiveContinueFromRunId;
      const acceptedProject = (body as typeof body & { projectId?: string | null }).projectId;
      const acceptedProjectId = acceptedProject === null || typeof acceptedProject === "string" ? acceptedProject : executionProjectId;
      const acceptedSnapshot: ProjectRunSnapshot = {
        runId: body.runId,
        projectId: acceptedProjectId,
        conversationId,
        rootRunId,
        status: body.status ?? "queued",
        prompt: cleanPrompt,
        model: executionPreference.model,
        mode: executionPreference.mode,
        effort: executionPreference.effort,
        ...(routing === "tokenresearch" ? { routing } : {}),
        createdAt: acceptedAt,
        updatedAt: acceptedAt,
        progress: 0,
        ...(parentRunId === undefined ? {} : { parentRunId })
      };
      const acceptedRun: ConversationRunView = { runId: body.runId, visiblePrompt: cleanPrompt, snapshot: acceptedSnapshot, events: [] };
      const acceptedDraftKey = composerDraftKey({ rootRunId });
      if (queuedMessage) switchComposerDraft(acceptedDraftKey);
      else {
        if (draftSession.key !== acceptedDraftKey) cancelDraftUpload();
        acceptDraft(sourceDraft, acceptedDraftKey);
        setPaletteMode(null);
      }
      setConversation((previous) => {
        if (!effectiveContinueFromRunId) return { conversationId, rootRunId, runs: [acceptedRun] };
        if (!previous || previous.rootRunId !== rootRunId || previous.runs.at(-1)?.runId !== effectiveContinueFromRunId) return previous;
        return { ...previous, conversationId, runs: [...previous.runs, acceptedRun] };
      });
      setConversationProject({ rootRunId, projectId: acceptedProjectId });
      rememberTask({ rootRunId, conversationId, latestRunId: body.runId, prompt: continuationExpired ? cleanPrompt : conversationTitle, status: acceptedSnapshot.status, updatedAt: acceptedAt }, acceptedProjectId);
      window.localStorage.setItem(activeConversationStorageKey, rootRunId);
      setPage(null);
      if (window.location.pathname + window.location.search !== chatPath(rootRunId)) window.history.pushState({}, "", chatPath(rootRunId));
      subscribe(body.runId);
    } catch (caught) {
      if (viewRequestRef.current !== viewRequest || controller.signal.aborted) return;
      const message = caught instanceof Error ? caught.message : "无法启动任务";
      setError(message);
      if (queuedMessage) setQueuedMessages((previous) => previous.map((item) => item.id === queuedMessage.id ? { ...item, error: message } : item));
    } finally {
      if (startAbortRef.current === controller) startAbortRef.current = null;
      startingRef.current = false;
      setIsStarting(false);
    }
  }

  async function cancelRun(): Promise<void> {
    if (!snapshot || !isRunning) return;
    const runId = snapshot.runId;
    const viewRequest = viewRequestRef.current;
    try {
      const response = await fetch(`${apiBase}/api/runs/${runId}/cancel`, { method: "POST" });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "无法停止任务");
      if (viewRequestRef.current === viewRequest && connection === "closed") subscribe(runId);
    } catch (caught) {
      if (viewRequestRef.current !== viewRequest) return;
      setError(caught instanceof Error ? caught.message : "无法停止任务");
    }
  }

  async function openRecentTask(task: RecentTask, updateUrl = true): Promise<void> {
    const viewRequest = beginViewRequest();
    const controller = new AbortController();
    restoreAbortRef.current = controller;
    setIsRestoringTask(true);
    setError(null);
    try {
      const response = await fetch(`${apiBase}/api/runs/${task.latestRunId}`, { signal: controller.signal });
      const body = await response.json() as ConversationRestorePayload & { projectId?: string | null; error?: string };
      if (viewRequestRef.current !== viewRequest) return;
      const restored = restoreConversation(body);
      if (!response.ok || !restored) {
        // A replaced local data directory can leave a cached task whose
        // record no longer exists. Treat that as stale history,
        // not as a failed user operation, and quietly remove it.
        if (response.status === 404) {
          setRecentTasks((previous) => previous.filter((item) => item.rootRunId !== task.rootRunId));
          window.localStorage.removeItem(activeConversationStorageKey);
          closeStream("idle");
          switchComposerDraft(composerDraftKey({ projectId: selectedProject?.id }));
          setConversation(null);
          setConversationProject(null);
          window.history.replaceState({}, "", "/chat");
          return;
        }
        throw new Error(body.error ?? "无法读取任务");
      }
      if (viewRequestRef.current !== viewRequest) return;
      closeStream("idle");
      switchComposerDraft(composerDraftKey({ rootRunId: restored.rootRunId }));
      setConversation(restored);
      const restoredProjectId = typeof body.projectId === "string" ? body.projectId : null;
      setConversationProject({ rootRunId: restored.rootRunId, projectId: restoredProjectId });
      setPage(null);
      if (updateUrl && window.location.pathname + window.location.search !== chatPath(restored.rootRunId)) window.history.pushState({}, "", chatPath(restored.rootRunId));
      setPaletteMode(null);
      setSidebarOpen(false);
      setCopiedRunId(null);
      window.localStorage.setItem(activeConversationStorageKey, restored.rootRunId);
      const restoredLatest = restored.runs.at(-1)!;
      rememberTask({
        rootRunId: restored.rootRunId,
        conversationId: restored.conversationId,
        latestRunId: restoredLatest.runId,
        prompt: restored.runs[0]?.visiblePrompt ?? task.prompt,
        status: restoredLatest.snapshot.status,
        updatedAt: restoredLatest.snapshot.updatedAt
      }, restoredProjectId);
      if (!isTerminalStatus(restoredLatest.snapshot.status)) subscribe(restoredLatest.runId);
      else closeStream("idle");
    } catch (caught) {
      if (viewRequestRef.current !== viewRequest || controller.signal.aborted) return;
      setError(caught instanceof Error ? caught.message : "无法读取任务");
    } finally {
      if (viewRequestRef.current === viewRequest) { restoreAbortRef.current = null; setIsRestoringTask(false); }
    }
  }

  function updatePrompt(value: string): void {
    setPrompt(value);
    const token = value.match(/(?:^|\s)([\/@])[^\s]*$/);
    setPaletteMode(token ? (token[1] === "/" ? "skill" : "context") : null);
    setPaletteIndex(0);
  }

  function removePaletteToken(value: string): string {
    return value.replace(/(?:^|\s)[\/@][^\s]*$/, "").replace(/\s+$/, "");
  }

  function selectPaletteItem(item: ComposerPaletteItem): void {
    if (item.kind === "skill") {
      setSelectedSkills((current) => current.includes(item.id) ? current : [...current, item.id]);
    } else {
      setSelectedContexts((current) => current.includes(item.id) ? current : [...current, item.id]);
    }
    updatePrompt(removePaletteToken(prompt));
    window.setTimeout(() => textareaRef.current?.focus(), 0);
  }

  async function copyAnswer(runId: string, answer: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(answer);
      setCopiedRunId(runId);
      window.setTimeout(() => setCopiedRunId((current) => current === runId ? null : current), 1800);
    } catch {
      setError("无法复制回答，请检查浏览器权限");
    }
  }

  function useExample(example: ExampleTask): void {
    navigatePage(null);
    setPrompt(example.prompt);
    setPaletteMode(null);
    setSelectedExample(null);
    window.setTimeout(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(example.prompt.length, example.prompt.length);
    }, 30);
  }

  function toggleSelected(value: string, setter: (next: string[]) => void, current: string[]): void {
    setter(current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (isComposerComposing(event)) return;
    if (paletteMode && paletteItems.length) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setPaletteIndex((current) => (current + 1) % paletteItems.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setPaletteIndex((current) => (current - 1 + paletteItems.length) % paletteItems.length);
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        const item = paletteItems[paletteIndex] ?? paletteItems[0];
        if (item) selectPaletteItem(item);
        return;
      }
    }
    if (event.key === "Escape" && paletteMode) {
      event.preventDefault();
      setPaletteMode(null);
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void startRun();
    }
  }

  const connectionLabel = connection === "open" ? "实时" : connection === "connecting" ? "连接中" : connection === "closed" ? "断开" : "空闲";
  const visibleContextCount = selectedContexts.filter((id) => id !== "workspace").length;
  const runtimeLabel = connection === "open" ? "事件流已连接" : connection === "connecting" ? "正在连接事件流" : connection === "closed" ? "事件流已断开" : "等待新任务";
  const ThemeIcon = themeIcons[theme];

  function selectRouting(value: string): void {
    browserExecutionWasSet.current = true;
    const nextRouting = value as RoutingPreference;
    setRouting(nextRouting);
    if (nextRouting === "tokenresearch") {
      setModel(tokenResearchRoutingProfile.coordinator.model);
      setEffort(tokenResearchRoutingProfile.coordinator.effort);
      setMode(tokenResearchRoutingProfile.coordinator.mode);
    } else if (routing === "tokenresearch") {
      const manualPreference = readStoredManualExecutionPreference();
      setModel(manualPreference.model);
      setEffort(manualPreference.effort);
      setMode(manualPreference.mode);
    }
  }

  function selectModel(value: string): void {
    browserExecutionWasSet.current = true;
    const nextModel = value as ModelId;
    setRouting("manual");
    setModel(nextModel);
    setMode((currentMode) => normalizeModeForModel(nextModel, routing === "tokenresearch" ? "standard" : currentMode));
  }

  function selectEffort(value: string): void {
    browserExecutionWasSet.current = true;
    setRouting("manual");
    setEffort(value as Effort);
    if (routing === "tokenresearch") setMode("standard");
  }

  function selectTheme(nextTheme: ThemePreference): void {
    browserThemeWasSet.current = true;
    applyTheme(nextTheme);
    setTheme(nextTheme);
    void fetch(`${apiBase}/api/settings`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ theme: nextTheme }) }).catch(() => { /* The selected theme remains available locally while offline. */ });
  }

  function selectRunMode(value: string): void {
    browserExecutionWasSet.current = true;
    const nextMode = value as RunMode;
    setRouting("manual");
    setMode(nextMode);
    if (nextMode === "ultra") setEffort("max");
  }

  const isModalPage = isModalWorkspacePage(page);
  const previewFiles = useMemo<PreviewFile[]>(() => conversation?.runs.flatMap((run) => run.events.flatMap((event) => event.type === "file" ? [{ ...event.file, origin: "artifact" as const, runId: run.runId }] : [])) ?? [], [conversation]);
  const previewScope = conversation?.rootRunId ?? `draft:${navigationProjectId ?? "standalone"}`;

  const productPanelView = page ? <ProductWorkspacePanel panel={page} presentation={isModalPage ? "dialog" : "inline"} createProject={projectCreationRequested} onClose={closeProductPanel} onOpenRun={(runId) => { void openTaskById(runId); }} onThemeChange={selectTheme} onSelectProject={(project) => { selectProject(project); resetWorkspace(project); }} onCompose={(nextPrompt) => { resetWorkspace(); setPrompt(nextPrompt); window.setTimeout(() => textareaRef.current?.focus(), 0); }} onChanged={() => { setProjectCreationRequested(false); if (window.location.pathname === "/projects" && window.location.search) window.history.replaceState({}, "", "/projects"); setRefreshVersion((value) => value + 1); }} theme={theme} /> : null;

  return <PreviewProvider scope={previewScope} files={previewFiles} runs={conversation?.runs ?? []} projects={workspace?.projects ?? []} onOpen={() => { if (isModalPage) closeProductPanel(); }}><TooltipProvider><div ref={appShellRef} className={`app-shell${sidebarCollapsed ? " sidebar-collapsed" : ""}${(!page || isModalPage) && !conversation ? " home-mode" : ""}`}>
    {sidebarOpen ? <button type="button" className="sidebar-scrim" onClick={() => setSidebarOpen(false)} aria-label="Close navigation" /> : null}
    <aside className={sidebarOpen ? "sidebar sidebar-open" : "sidebar"} aria-label="Main navigation">
      <div className="brand-row">
        <button className="account-switcher" type="button" onClick={() => navigatePage("workspace")}><span className="workspace-symbol" aria-hidden="true"><svg viewBox="0 0 32 32" fill="none"><path d="M8 7h10a8 8 0 0 1 0 16H8V7Z" /><path d="M8 15h10M15 15l9 10M12 7v16" /></svg></span><span className="workspace-brand"><strong>OpenRigor</strong><small>Personal workspace</small></span><ChevronsUpDown aria-hidden="true" /></button>
        <IconTooltip label="Toggle sidebar"><button type="button" className="icon-control sidebar-toggle" onClick={() => { if (window.innerWidth <= 900) setSidebarOpen(false); else { setSidebarCollapsed(true); window.localStorage.setItem("openrigor.sidebar-collapsed", "true"); } }} aria-label="Toggle sidebar"><PanelLeftClose aria-hidden="true" /></button></IconTooltip>
      </div>
      <nav className="nav-list" aria-label="Product navigation">
        <button type="button" className={!page && !conversation ? "nav-item active" : "nav-item"} onClick={() => { if (navigationProjectId && !navigationProject) { setError("Project details are unavailable. Wait for the project to load or choose a project before starting a new task."); return; } const project = navigationProject; resetWorkspace(project); selectProject(project); }}><Sparkles aria-hidden="true" /><span>New task</span></button>
        <button type="button" className={page === "images" ? "nav-item active" : "nav-item"} onClick={() => navigatePage("images")}><ImagePlus aria-hidden="true" /><span>Image Studio</span></button>
        <button type="button" className={page === "agent" ? "nav-item active" : "nav-item"} onClick={() => navigatePage("agent")}><BrainCircuit aria-hidden="true" /><span>Agent</span></button>
        <button type="button" className={page === "workspace" ? "nav-item active" : "nav-item"} onClick={() => navigatePage("workspace")}><Users aria-hidden="true" /><span>Workspace</span></button>
        <button type="button" className={page === "skills" ? "nav-item active" : "nav-item"} onClick={() => navigatePage("skills")}><WandSparkles aria-hidden="true" /><span>Skill Market</span></button>
        <button type="button" className={page === "search" ? "nav-item active" : "nav-item"} onClick={() => navigatePage("search")}><Search aria-hidden="true" /><span>Search</span><kbd>⌘ K</kbd></button>
      </nav>
      <div className="sidebar-scroll">
        <section className="sidebar-section">
          <button type="button" className="sidebar-label" onClick={() => setProjectsExpanded((previous) => !previous)} aria-expanded={projectsExpanded}><span>Projects</span><ChevronDown className={projectsExpanded ? "" : "is-collapsed"} aria-hidden="true" /></button>
          {projectsExpanded ? <>
            {workspace?.projects.map((project) => <button type="button" key={project.id} className={navigationProjectId === project.id ? "project-item selected" : "project-item"} onClick={() => { selectProject(project); resetWorkspace(project); }}><Folder aria-hidden="true" /><span><strong>{project.name}</strong><small>{project.description || project.path}</small></span></button>)}
            <button type="button" className="project-item new-project" onClick={openNewProject}><FolderPlus aria-hidden="true" /><span><strong>New project</strong><small>One directory, all related tasks</small></span></button>
          </> : null}
        </section>
        <section className="sidebar-section recent-section">
          <button type="button" className="sidebar-label" onClick={() => setTasksExpanded((previous) => !previous)} aria-expanded={tasksExpanded}><span>{navigationProject?.name ?? (navigationProjectId ? "Project tasks" : "Standalone tasks")}</span><ChevronDown className={tasksExpanded ? "" : "is-collapsed"} aria-hidden="true" /></button>
          {tasksExpanded ? visibleRecentTasks.map((task) => <div className="recent-row" key={task.rootRunId}><button type="button" className={conversation?.rootRunId === task.rootRunId && !page ? "recent-item active" : "recent-item"} onClick={() => void openRecentTask(task)}>{task.pinned ? <Pin className="recent-pin" aria-hidden="true" /> : (task.rootRunId === conversation?.rootRunId && connection === "open" && isActivelyWorkingStatus(task.status) ? <ActivityGlyph animated /> : <span className={`recent-status status-${task.status}`} />)}<span><strong>{task.title ?? task.prompt}</strong><small>{statusLabel(task.status)} · {formatTime(task.updatedAt)}</small></span></button><DropdownMenu><DropdownMenuTrigger asChild><button type="button" className="recent-more" aria-label={`More actions for ${task.title ?? task.prompt}`}><MoreHorizontal aria-hidden="true" /></button></DropdownMenuTrigger><DropdownMenuContent className="radix-menu" align="start" sideOffset={5}><DropdownMenuItem className="simple-menu-item" onSelect={() => { setRenamingTask(task); setTaskTitle(task.title ?? task.prompt); }}><Pencil aria-hidden="true" /><span>Rename</span></DropdownMenuItem><DropdownMenuItem className="simple-menu-item" onSelect={() => { void updateTask(task, { pinned: !task.pinned }).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Unable to pin task")); }}><Pin aria-hidden="true" /><span>{task.pinned ? "Unpin" : "Pin"}</span></DropdownMenuItem><DropdownMenuItem className="simple-menu-item" onSelect={() => { void exportTask(task); }}><Download aria-hidden="true" /><span>Export conversation</span></DropdownMenuItem><DropdownMenuItem className="simple-menu-item" onSelect={() => { void updateTask(task, { archived: true }).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Unable to archive task")); }}><Archive aria-hidden="true" /><span>Archive</span></DropdownMenuItem></DropdownMenuContent></DropdownMenu></div>) : null}
          {tasksExpanded && !visibleRecentTasks.length ? <div className="history-empty"><span>Your tasks will appear here</span></div> : null}
        </section>
      </div>
      <div className="sidebar-bottom">
        <button type="button" className="workspace-footer-link" onClick={() => navigatePage("guides")}><CircleHelp aria-hidden="true" /><span><strong>Make yourself at home</strong><small>Explore your local agent workspace</small></span></button>
        <DropdownMenu><DropdownMenuTrigger asChild><button type="button" className="profile"><span className="avatar">{(workspace?.profile.displayName ?? "Jeff").slice(0, 1).toUpperCase()}</span><strong>{workspace?.profile.displayName ?? "Jeff"}</strong><ChevronsUpDown aria-hidden="true" /></button></DropdownMenuTrigger>
          <DropdownMenuContent className="radix-menu profile-menu" align="start" side="top" sideOffset={8}>
            <DropdownMenuLabel className="menu-caption">OpenRigor · Local workspace</DropdownMenuLabel>
            <DropdownMenuItem className="simple-menu-item" onSelect={() => navigatePage("settings")}><Settings aria-hidden="true" /><span>Settings</span></DropdownMenuItem>
            <DropdownMenuItem className="simple-menu-item" onSelect={() => navigatePage("workspace")}><Users aria-hidden="true" /><span>Workspace</span></DropdownMenuItem>
            <DropdownMenuLabel className="menu-caption">Appearance</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={theme} onValueChange={(value) => selectTheme(value as ThemePreference)}>{themeOptions.map((option) => { const Icon = themeIcons[option.value]; return <DropdownMenuRadioItem className="radio-menu-item" value={option.value} key={option.value}><Icon aria-hidden="true" /><span>{option.value === "system" ? "System" : option.value === "dark" ? "Dark" : "Light"}</span></DropdownMenuRadioItem>; })}</DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </aside>

    <PreviewLayout><main className="main-area">
      <header className="main-header">
        <div className="header-left">
          <IconTooltip label="Toggle sidebar"><button type="button" className="icon-control main-sidebar-toggle" onClick={() => { if (window.innerWidth <= 900) setSidebarOpen(true); else { setSidebarCollapsed((previous) => !previous); window.localStorage.setItem("openrigor.sidebar-collapsed", String(!sidebarCollapsed)); } }} aria-label="Open navigation"><PanelLeftOpen aria-hidden="true" /></button></IconTooltip>
          {conversation && !page ? <><span className="header-divider" /><div className="header-title-group"><strong title={conversationTitle}>{conversationTitle}</strong><small>{snapshot ? `${composerProject ? `${composerProject.name} · ` : ""}${modelLabel(snapshot.model)} · ${formatTime(snapshot.updatedAt)}` : "OpenRigor"}</small></div></> : null}
          {!conversation && !page ? <div className="header-workspace-name"><span>Workspace</span><ChevronRight aria-hidden="true" /><strong>Personal</strong></div> : null}
        </div>
        <div className="header-actions"><PreviewLauncher />
          {conversation && !page ? <span className={`connection connection-${connection}`} data-working={isRunning && connection === "open"} role="status" aria-live="polite" title={runtimeLabel}>{isRunning && connection === "open" && snapshot && isActivelyWorkingStatus(snapshot.status) ? <ActivityGlyph animated /> : <span className="status-dot" />}{isRunning && snapshot && connection === "open" ? snapshot.status === "waiting_user" ? "等待确认" : snapshot.status === "cancelling" ? "正在停止" : snapshot.status === "queued" ? "排队中" : "执行中" : connectionLabel}</span> : null}
          <DropdownMenu><DropdownMenuTrigger asChild><button type="button" className="icon-control theme-toggle" aria-label="Change appearance" title="Change appearance"><ThemeIcon aria-hidden="true" /></button></DropdownMenuTrigger><DropdownMenuContent className="radix-menu theme-menu" align="end" sideOffset={8}><DropdownMenuLabel className="menu-caption">Appearance</DropdownMenuLabel><DropdownMenuRadioGroup value={theme} onValueChange={(value) => selectTheme(value as ThemePreference)}>{themeOptions.map((option) => { const Icon = themeIcons[option.value]; return <DropdownMenuRadioItem className="radio-menu-item theme-menu-item" value={option.value} key={option.value}><Icon aria-hidden="true" /><span><strong>{option.value === "system" ? "System" : option.value === "dark" ? "Dark" : "Light"}</strong></span>{theme === option.value ? <Check aria-hidden="true" /> : null}</DropdownMenuRadioItem>; })}</DropdownMenuRadioGroup></DropdownMenuContent></DropdownMenu>
        </div>
      </header>

      {page && !isModalPage ? <div className="product-panel-host">{productPanelView}</div> : <div className={conversation ? "main-body conversation-mode" : "main-body"}>
        {!conversation ? <HomeView activeTab={activeTab} onTabChange={setActiveTab} displayName={workspace?.profile.displayName ?? "Jeff"} onOpenSection={navigatePage} onOpenExample={(example, trigger) => { exampleTriggerRef.current = trigger; setSelectedExample(example); }} /> : <section className="conversation-view">
          <Conversation className="ai-conversation"><ConversationContent className="conversation-column" scrollClassName="conversation-scroll">{conversation.runs.map((run) => <RunTurn key={run.runId} run={run} copied={copiedRunId === run.runId} onCopy={(runId, answer) => { void copyAnswer(runId, answer); }} connection={connection} />)}</ConversationContent><ConversationScrollButton className="jump-latest" aria-label="Jump to latest"><ArrowDown aria-hidden="true" /></ConversationScrollButton></Conversation>
        </section>}
      </div>}
      {(!page || isModalPage || ["research", "guides", "handoff"].includes(page)) ? <div className="composer-region"><div className="composer-wrap">
        {isRunning && latestRun ? <ComposerRunActivity run={latestRun} connection={connection} /> : null}
        {conversationQueue.length ? <div className="queued-messages" aria-label="Queued follow-up messages">{conversationQueue.map((message, index) => <div key={message.id}><Clock3 aria-hidden="true" /><span><small>{message.error ? `Could not send: ${message.error}` : message.predecessorRunId !== snapshot?.runId && index === 0 ? "Waiting for the original preceding turn" : `Queued ${index + 1}`}</small>{message.prompt}</span>{message.error ? <button type="button" aria-label="Retry queued message" onClick={() => setQueuedMessages((previous) => previous.map((item) => { if (item.id !== message.id) return item; const { error: _error, ...retry } = item; return retry; }))}><ArrowUp aria-hidden="true" /></button> : null}<button type="button" onClick={() => setQueuedMessages((previous) => removeQueuedFollowup(previous, message.id))} aria-label="Remove queued message"><X aria-hidden="true" /></button></div>)}</div> : null}
        <div className="composer-context-row"><button type="button" onClick={() => navigatePage("workspace")}><HardDrive aria-hidden="true" /><span>Local workspace</span></button><DropdownMenu><DropdownMenuTrigger asChild><button type="button"><Folder aria-hidden="true" /><span>{composerProject?.name ?? (conversation && activeProjectId ? "Project task" : "Choose a project")}</span><ChevronDown aria-hidden="true" /></button></DropdownMenuTrigger><DropdownMenuContent className="radix-menu project-select-menu" align="start" side="top" sideOffset={8}><DropdownMenuLabel className="menu-caption">Projects</DropdownMenuLabel><DropdownMenuItem className="simple-menu-item" onSelect={() => chooseComposerProject(null)}><Folder aria-hidden="true" /><span>Standalone task</span>{!composerProject ? <Check aria-hidden="true" /> : null}</DropdownMenuItem>{workspace?.projects.map((project) => <DropdownMenuItem className="simple-menu-item" key={project.id} onSelect={() => chooseComposerProject(project)}><Folder aria-hidden="true" /><span>{project.name}</span>{composerProject?.id === project.id ? <Check aria-hidden="true" /> : null}</DropdownMenuItem>)}<DropdownMenuItem className="simple-menu-item" onSelect={openNewProject}><FolderPlus aria-hidden="true" /><span>New project</span></DropdownMenuItem></DropdownMenuContent></DropdownMenu></div>
        <ComposerPalette open={Boolean(paletteMode)} mode={paletteMode} items={paletteItems} activeIndex={paletteIndex} selected={paletteMode === "skill" ? selectedSkills : selectedContexts} onSelect={selectPaletteItem} />
        <input ref={attachmentInputRef} type="file" multiple hidden onChange={(event) => { void attachFiles(event.target.files); }} />
        <PromptInput className="composer" onSubmit={async (message) => { await startRun(message.text); }}>
          {(selectedSkills.length || hasExplicitContexts || attachments.length) ? <div className="composer-chips">{selectedContexts.filter((id) => id !== "workspace").map((id) => { const item = availableContexts.find((context) => context.id === id); return item ? <ComposerChip key={id} icon={Library} label={item.label} onRemove={() => setSelectedContexts((current) => current.filter((value) => value !== id))} /> : null; })}{selectedSkills.map((id) => { const item = availableSkills.find((skill) => skill.id === id); return item ? <ComposerChip key={id} icon={Layers3} label={item.label} onRemove={() => setSelectedSkills((current) => current.filter((value) => value !== id))} /> : null; })}{attachments.map((attachment) => <ComposerChip key={attachment.id} icon={Paperclip} label={attachment.name} onRemove={() => setAttachments((current) => current.filter((item) => item.id !== attachment.id))} />)}</div> : null}
          <PromptInputBody><PromptInputTextarea ref={textareaRef} value={prompt} onChange={(event) => updatePrompt(event.target.value)} onPaste={(event) => { if (event.clipboardData.files.length) { event.preventDefault(); void attachFiles(event.clipboardData.files); } }} onKeyDown={handleComposerKeyDown} onFocus={() => { const token = prompt.match(/(?:^|\s)([\/@])[^\s]*$/); if (token) setPaletteMode(token[1] === "/" ? "skill" : "context"); }} placeholder={isRestoringTask ? "Loading task…" : uploading ? "Uploading attachment…" : isRunning ? "Add a follow-up. It will run when the current task finishes…" : "Describe your task, / for commands and skills, @ for files, tasks & knowledge"} rows={2} aria-label="Task description" aria-controls={paletteMode ? `composer-palette-${paletteMode}` : undefined} aria-activedescendant={paletteMode && paletteItems[paletteIndex] ? `composer-${paletteMode}-${paletteItems[paletteIndex].id}` : undefined} /></PromptInputBody>
          <PromptInputFooter className="composer-toolbar"><PromptInputTools className="composer-left"><DropdownMenu><DropdownMenuTrigger asChild><button ref={addMenuTriggerRef} type="button" className="icon-tool" aria-label="Add" title="Add"><Plus aria-hidden="true" /></button></DropdownMenuTrigger><DropdownMenuContent className="radix-menu add-menu" align="start" side="top" sideOffset={10}><DropdownMenuItem className="simple-menu-item" onSelect={() => attachmentInputRef.current?.click()}><Paperclip aria-hidden="true" /><span><strong>Upload files</strong><small>Attach local documents or images</small></span></DropdownMenuItem><DropdownMenuItem className="simple-menu-item" onSelect={() => openWorkspaceDialog("knowledge", addMenuTriggerRef.current)}><Library aria-hidden="true" /><span><strong>Add context</strong><small>Workspace files and sources</small></span></DropdownMenuItem><DropdownMenuItem className="simple-menu-item" onSelect={() => { updatePrompt(`${prompt}${prompt && !prompt.endsWith(" ") ? " " : ""}/`); window.setTimeout(() => textareaRef.current?.focus(), 0); }}><WandSparkles aria-hidden="true" /><span><strong>Use a skill</strong><small>Specialized agent workflows</small></span></DropdownMenuItem><DropdownMenuItem className="simple-menu-item" onSelect={() => navigatePage("images")}><ImagePlus aria-hidden="true" /><span><strong>Generate an image</strong><small>Open image studio</small></span></DropdownMenuItem></DropdownMenuContent></DropdownMenu><ExecutionSelector runtimeModels={runtimeModels} routing={routing} model={model} effort={effort} mode={mode} onRoutingChange={selectRouting} onModelChange={selectModel} onEffortChange={selectEffort} onModeChange={selectRunMode} /></PromptInputTools><div className="composer-right">{isRunning && prompt.trim() ? <button type="submit" className="queue-button" disabled={uploading || isRestoringTask || !isComposerContextReady} aria-label="Queue follow-up"><ArrowUp aria-hidden="true" /></button> : null}{isRunning ? <button ref={actionButtonRef} type="button" className="stop-button" onClick={() => void cancelRun()} disabled={snapshot?.status === "cancelling"} aria-label="Stop task"><Square aria-hidden="true" /><span>{snapshot?.status === "cancelling" ? "正在停止" : "停止"}</span></button> : <button ref={actionButtonRef} type="submit" className="send-button" disabled={isStarting || isRestoringTask || !isComposerContextReady || uploading || !prompt.trim()} aria-label="Send task"><ArrowUp aria-hidden="true" /></button>}</div></PromptInputFooter>
        </PromptInput>
      </div>{!conversation ? <p className="composer-hint"><span><kbd>/</kbd> Skills <span>·</span> <kbd>@</kbd> Context</span><span><kbd>↵</kbd> Send <span>·</span> <kbd>⇧ ↵</kbd> New line</span></p> : null}</div> : null}
    </main></PreviewLayout>
    {isModalPage ? productPanelView : null}
    <Dialog open={Boolean(renamingTask)} onOpenChange={(open) => { if (!open) setRenamingTask(null); }}><DialogContent className="dialog-content rename-task-dialog" showCloseButton={false}><DialogTitle className="dialog-title">Rename task</DialogTitle><DialogDescription className="dialog-description">Give this conversation a name you can find later.</DialogDescription><form onSubmit={(event) => { event.preventDefault(); if (!renamingTask || !taskTitle.trim()) return; setSavingTaskTitle(true); void updateTask(renamingTask, { title: taskTitle.trim() }).then(() => setRenamingTask(null)).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Unable to rename task")).finally(() => setSavingTaskTitle(false)); }}><input autoFocus aria-label="Task title" value={taskTitle} maxLength={200} onChange={(event) => setTaskTitle(event.target.value)} /><div className="dialog-actions"><button type="button" className="secondary-button" onClick={() => setRenamingTask(null)}>Cancel</button><button type="submit" className="primary-button" disabled={savingTaskTitle || !taskTitle.trim()}>{savingTaskTitle ? "Saving…" : "Save"}</button></div></form></DialogContent></Dialog>
    <ExampleDialog example={selectedExample} onClose={() => setSelectedExample(null)} onUse={useExample} restoreFocus={() => exampleTriggerRef.current?.focus()} />
    <KnowledgeDialog open={workspacePanel === "knowledge"} onOpenChange={(open) => setWorkspacePanel(open ? "knowledge" : null)} contexts={availableContexts} selected={selectedContexts} onToggle={(id) => toggleSelected(id, setSelectedContexts, selectedContexts)} restoreFocus={() => knowledgeTriggerRef.current?.focus()} />
    {error ? <div ref={toastRef} className="toast" role="alert"><span className="toast-icon"><CircleHelp aria-hidden="true" /></span><span>{error}</span><button type="button" onClick={() => setError(null)} aria-label="Dismiss"><X aria-hidden="true" /></button></div> : null}
  </div></TooltipProvider></PreviewProvider>;
}
