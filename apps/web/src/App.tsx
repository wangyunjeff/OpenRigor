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
  BookOpen,
  BrainCircuit,
  Check,
  ChevronRight,
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

gsap.registerPlugin(useGSAP);

const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "http://localhost:8787";

type ConnectionState = "idle" | "connecting" | "open" | "closed";
type WorkspacePanel = "knowledge" | "agent" | null;
type ComposerPaletteMode = "skill" | "context" | null;

interface SkillOption {
  id: string;
  label: string;
  description: string;
  icon: LucideIcon;
}

interface ContextOption {
  id: string;
  label: string;
  path: string;
  description: string;
  icon: LucideIcon;
}

interface RecentTask {
  rootRunId: string;
  conversationId: string;
  latestRunId: string;
  prompt: string;
  status: RunSnapshot["status"];
  updatedAt: string;
}

const recentTasksStorageKey = "openrigor.recent-tasks";
const activeConversationStorageKey = "openrigor.active-conversation";
const runStatuses: RunSnapshot["status"][] = ["queued", "running", "waiting_tool", "waiting_user", "cancelling", "completed", "failed", "cancelled"];

function isRunStatus(value: unknown): value is RunSnapshot["status"] {
  return typeof value === "string" && runStatuses.some((status) => status === value);
}

function loadRecentTasks(): RecentTask[] {
  try {
    const value = JSON.parse(window.localStorage.getItem(recentTasksStorageKey) ?? "[]") as unknown;
    if (!Array.isArray(value)) return [];
    return value.flatMap((item): RecentTask[] => {
      if (!item || typeof item !== "object") return [];
      const candidate = item as Record<string, unknown>;
      const legacyRunId = typeof candidate.runId === "string" ? candidate.runId : undefined;
      const rootRunId = typeof candidate.rootRunId === "string" ? candidate.rootRunId : legacyRunId;
      const latestRunId = typeof candidate.latestRunId === "string" ? candidate.latestRunId : legacyRunId;
      if (!rootRunId || !latestRunId || typeof candidate.prompt !== "string" || !isRunStatus(candidate.status) || typeof candidate.updatedAt !== "string") return [];
      return [{
        rootRunId,
        conversationId: typeof candidate.conversationId === "string" ? candidate.conversationId : rootRunId,
        latestRunId,
        prompt: cleanHistoryPrompt(candidate.prompt),
        status: candidate.status,
        updatedAt: candidate.updatedAt
      }];
    }).slice(0, 8);
  } catch {
    return [];
  }
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
  { id: "workspace", label: "当前项目", path: "E:\\0_Code\\OpenRigor", description: "项目代码、文档与 Git 状态", icon: Folder },
  { id: "agents", label: "项目规则", path: "AGENTS.md", description: "仓库内的工程与安全约束", icon: ShieldCheck },
  { id: "report", label: "技术报告", path: "docs/TECHNICAL_REPORT.md", description: "ClawsGO 技术调研与复刻路线", icon: FileText },
  { id: "design", label: "设计系统", path: "design-system/openrigor/MASTER.md", description: "OpenRigor 的视觉与交互规则", icon: Palette }
];

const themeIcons: Record<ThemePreference, LucideIcon> = {
  light: Sun,
  dark: Moon,
  system: Monitor
};

const eventTypes: RunEvent["type"][] = ["snapshot", "status", "part", "part-delta", "tool", "file", "subagent", "run-finished", "error"];

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
  restoreFocus
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selected: string[];
  onToggle: (id: string) => void;
  restoreFocus: () => void;
}): ReactElement {
  const [query, setQuery] = useState("");
  const contentRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (open) setQuery(""); }, [open]);
  const filtered = contextOptions.filter((item) => `${item.label} ${item.path} ${item.description}`.toLowerCase().includes(query.toLowerCase()));
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

function AgentDialog({
  open,
  onOpenChange,
  selectedSkills,
  onToggleSkill,
  customInstructions,
  onSaveInstructions,
  restoreFocus
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedSkills: string[];
  onToggleSkill: (id: string) => void;
  customInstructions: string;
  onSaveInstructions: (value: string) => void;
  restoreFocus: () => void;
}): ReactElement {
  const [tab, setTab] = useState<"skills" | "preferences">("skills");
  const [query, setQuery] = useState("");
  const [draftInstructions, setDraftInstructions] = useState(customInstructions);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setDraftInstructions(customInstructions);
      setQuery("");
      setTab("skills");
    }
  }, [customInstructions, open]);

  const filtered = skillOptions.filter((skill) => `${skill.label} ${skill.id} ${skill.description}`.toLowerCase().includes(query.toLowerCase()));
  useDialogEntrance(open, contentRef, ".agent-dialog-nav, .agent-dialog-main");
  useGSAP(() => {
    const root = contentRef.current;
    if (!root || !open) return;
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      gsap.fromTo(".agent-dialog-nav > *, .agent-dialog-heading, .agent-dialog-main > .dialog-search, .agent-dialog-main > .skill-list, .agent-dialog-main > .preferences-form", { autoAlpha: 0, y: 5 }, { autoAlpha: 1, y: 0, duration: 0.16, stagger: 0.025, ease: "power2.out", clearProps: "transform,opacity,visibility" });
    }, root);
    return () => media.revert();
  }, { scope: contentRef, dependencies: [open], revertOnUpdate: true });
  useGSAP(() => {
    const root = contentRef.current;
    if (!root || !open) return;
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      gsap.fromTo(".agent-dialog-main > .skill-list, .agent-dialog-main > .preferences-form", { autoAlpha: 0, y: 6 }, { autoAlpha: 1, y: 0, duration: 0.18, ease: "power2.out", clearProps: "transform,opacity,visibility" });
    }, root);
    return () => media.revert();
  }, { scope: contentRef, dependencies: [tab], revertOnUpdate: true });

  return <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent ref={contentRef} className="dialog-content agent-dialog" showCloseButton={false} onCloseAutoFocus={(event) => { event.preventDefault(); restoreFocus(); }}>
        <DialogTitle className="sr-only">Agent 设置</DialogTitle>
        <DialogDescription className="sr-only">管理本地 Codex 的技能与任务偏好。</DialogDescription>
        <aside className="agent-dialog-nav">
          <div className="agent-dialog-brand"><BrandMark /><span><strong>Agent 设置</strong><small>本机 Codex</small></span></div>
           <span className="agent-nav-label">Agent</span>
           <button type="button" className={tab === "skills" ? "agent-nav-item active" : "agent-nav-item"} onClick={() => setTab("skills")}><Layers3 aria-hidden="true" />技能</button>
           <button type="button" className={tab === "preferences" ? "agent-nav-item active" : "agent-nav-item"} onClick={() => setTab("preferences")}><SlidersHorizontal aria-hidden="true" />指令与偏好</button>
           <span className="agent-nav-label agent-nav-label-secondary">运行环境</span>
           <button type="button" className="agent-nav-item agent-nav-item-disabled" disabled><BrainCircuit aria-hidden="true" />记忆<span>alpha</span></button>
           <button type="button" className="agent-nav-item agent-nav-item-disabled" disabled><Terminal aria-hidden="true" />SSH<span>后续</span></button>
           <button type="button" className="agent-nav-item agent-nav-item-disabled" disabled><Globe2 aria-hidden="true" />环境<span>后续</span></button>
           <button type="button" className="agent-nav-item agent-nav-item-disabled" disabled><HardDrive aria-hidden="true" />存储<span>后续</span></button>
           <div className="agent-runtime-card"><span className="runtime-pulse" /><span><strong>Codex runtime</strong><small>已连接本机</small></span></div>
        </aside>
        <section className="agent-dialog-main">
          <div className="agent-dialog-heading">
            <div><h2>{tab === "skills" ? "技能" : "指令与偏好"}</h2><p>{tab === "skills" ? "为任务启用专门的工作方法；选中的技能会随下一次请求发送。" : "这些偏好只保存在当前浏览器，并应用到后续新任务。"}</p></div>
            <DialogClose asChild><button type="button" className="dialog-close" aria-label="关闭"><X aria-hidden="true" /></button></DialogClose>
          </div>
          {tab === "skills" ? <>
            <label className="dialog-search"><Search aria-hidden="true" /><input aria-label="搜索技能" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索技能" /></label>
            <div className="skill-list">{filtered.map((skill) => {
              const Icon = skill.icon;
              const active = selectedSkills.includes(skill.id);
              return <button type="button" className={active ? "skill-item selected" : "skill-item"} key={skill.id} onClick={() => onToggleSkill(skill.id)} aria-pressed={active}>
                <span className="skill-icon"><Icon aria-hidden="true" /></span>
                <span className="skill-copy"><span><strong>{skill.label}</strong><code>${skill.id}</code></span><small>{skill.description}</small></span>
                <span className={active ? "skill-switch checked" : "skill-switch"}><span /></span>
              </button>;
            })}</div>
          </> : <div className="preferences-form">
            <label><span>输出语言</span><div className="readonly-field">跟随对话语言</div></label>
            <label><span>自定义指令</span><textarea value={draftInstructions} onChange={(event) => setDraftInstructions(event.target.value)} placeholder="例如：结论先行；重要判断附证据；修改代码后运行相关测试。" rows={8} /></label>
            <div className="preference-footer"><span>{draftInstructions.length} / 32768</span><button type="button" className="primary-button" onClick={() => { onSaveInstructions(draftInstructions); onOpenChange(false); }}>保存</button></div>
          </div>}
        </section>
      </DialogContent>
  </Dialog>;
}

export function App(): ReactElement {
  const initialRoutingPreference = readStoredRoutingPreference();
  const initialManualExecutionPreference = readStoredManualExecutionPreference();
  const [prompt, setPrompt] = useState("");
  const [activeTab, setActiveTab] = useState<TabId>("research");
  const [conversation, setConversation] = useState<ConversationViewState | null>(null);
  const [connection, setConnection] = useState<ConnectionState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [model, setModel] = useState<ModelId>(initialRoutingPreference === "tokenresearch" ? tokenResearchRoutingProfile.coordinator.model : initialManualExecutionPreference.model);
  const [effort, setEffort] = useState<Effort>(initialRoutingPreference === "tokenresearch" ? tokenResearchRoutingProfile.coordinator.effort : initialManualExecutionPreference.effort);
  const [mode, setMode] = useState<RunMode>(initialRoutingPreference === "tokenresearch" ? tokenResearchRoutingProfile.coordinator.mode : initialManualExecutionPreference.mode);
  const [routing, setRouting] = useState<RoutingPreference>(initialRoutingPreference);
  const [theme, setTheme] = useState<ThemePreference>(initialThemePreference);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [recentTasks, setRecentTasks] = useState<RecentTask[]>(loadRecentTasks);
  const [selectedExample, setSelectedExample] = useState<ExampleTask | null>(null);
  const [workspacePanel, setWorkspacePanel] = useState<WorkspacePanel>(null);
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [selectedContexts, setSelectedContexts] = useState<string[]>(["workspace"]);
  const [paletteMode, setPaletteMode] = useState<ComposerPaletteMode>(null);
  const [paletteIndex, setPaletteIndex] = useState(0);
  const [copiedRunId, setCopiedRunId] = useState<string | null>(null);
  const [customInstructions, setCustomInstructions] = useState(() => window.localStorage.getItem("openrigor.instructions") ?? "");
  const eventSource = useRef<EventSource | null>(null);
  const activeRunIdRef = useRef<string | null>(null);
  const viewRequestRef = useRef(0);
  const restoreAbortRef = useRef<AbortController | null>(null);
  const startAbortRef = useRef<AbortController | null>(null);
  const startingRef = useRef(false);
  const [isStarting, setIsStarting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const appShellRef = useRef<HTMLDivElement | null>(null);
  const actionButtonRef = useRef<HTMLButtonElement | null>(null);
  const toastRef = useRef<HTMLDivElement | null>(null);
  const exampleTriggerRef = useRef<HTMLButtonElement | null>(null);
  const knowledgeTriggerRef = useRef<HTMLButtonElement | null>(null);
  const agentTriggerRef = useRef<HTMLButtonElement | null>(null);
  const addMenuTriggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => () => {
    eventSource.current?.close();
    restoreAbortRef.current?.abort();
    startAbortRef.current?.abort();
  }, []);

  useEffect(() => {
    window.localStorage.setItem(recentTasksStorageKey, JSON.stringify(recentTasks.slice(0, 8)));
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
    const activeRootRunId = window.localStorage.getItem(activeConversationStorageKey);
    if (!activeRootRunId) return;
    const task = recentTasks.find((item) => item.rootRunId === activeRootRunId);
    if (task) void openRecentTask(task);
    else window.localStorage.removeItem(activeConversationStorageKey);
  }, []);

  const latestRun = conversation?.runs.at(-1) ?? null;
  const snapshot = latestRun?.snapshot ?? null;
  const isRunning = Boolean(snapshot && !isTerminalStatus(snapshot.status));
  const visiblePrompt = latestRun?.visiblePrompt ?? "";
  const hasExplicitContexts = selectedContexts.some((id) => id !== "workspace");
  const executionPreference = resolveExecutionPreference(routing, model, effort, mode);

  const paletteItems = useMemo<ComposerPaletteItem[]>(() => {
    if (!paletteMode) return [];
    const query = prompt.match(/(?:^|\s)[\/@]([^\s]*)$/)?.[1]?.toLowerCase() ?? "";
    if (paletteMode === "skill") {
      return skillOptions
        .filter((skill) => `${skill.label} ${skill.id} ${skill.description}`.toLowerCase().includes(query))
        .map((skill) => ({ id: skill.id, label: skill.label, description: skill.description, icon: skill.icon, kind: "skill" as const }));
    }
    return contextOptions
      .filter((context) => `${context.label} ${context.path} ${context.description}`.toLowerCase().includes(query))
      .map((context) => ({ id: context.id, label: context.label, description: context.description, path: context.path, icon: context.icon, kind: "context" as const }));
  }, [paletteMode, prompt]);

  useEffect(() => {
    setPaletteIndex((current) => paletteItems.length ? Math.min(current, paletteItems.length - 1) : 0);
  }, [paletteItems.length, paletteMode]);

  useGSAP(() => {
    const root = appShellRef.current;
    if (!root) return;
    const media = gsap.matchMedia();
    media.add("(min-width: 721px) and (prefers-reduced-motion: no-preference)", () => {
      gsap.timeline({ defaults: { ease: "power2.out" } })
        .fromTo(".sidebar", { autoAlpha: 0, x: -8 }, { autoAlpha: 1, x: 0, duration: 0.28, clearProps: "transform,opacity,visibility" })
        .fromTo(".sidebar .brand-mark", { autoAlpha: 0, scale: 0.86, rotation: -5 }, { autoAlpha: 1, scale: 1, rotation: 0, duration: 0.32, ease: "back.out(1.35)", clearProps: "transform,opacity,visibility" }, "<0.05")
        .fromTo(".sidebar .account-switcher, .sidebar .nav-item, .sidebar .sidebar-section, .sidebar-bottom", { autoAlpha: 0, x: -5 }, { autoAlpha: 1, x: 0, duration: 0.22, stagger: 0.025, clearProps: "transform,opacity,visibility" }, "<0.03");
    }, root);
    media.add("(prefers-reduced-motion: no-preference)", () => {
      gsap.timeline({ defaults: { ease: "power2.out" } })
        .fromTo(".main-header", { autoAlpha: 0, y: -4 }, { autoAlpha: 1, y: 0, duration: 0.26, clearProps: "transform,opacity,visibility" })
        .fromTo(".composer-region", { autoAlpha: 0, y: 7 }, { autoAlpha: 1, y: 0, duration: 0.28, clearProps: "transform,opacity,visibility" }, 0.04);
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

  function rememberTask(task: RecentTask): void {
    setRecentTasks((previous) => {
      const existing = previous.find((item) => item.rootRunId === task.rootRunId);
      const next = { ...task, prompt: cleanHistoryPrompt(existing?.prompt ?? task.prompt) };
      return [next, ...previous.filter((item) => item.rootRunId !== task.rootRunId)].slice(0, 8);
    });
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
    return viewRequestRef.current;
  }

  function resetWorkspace(): void {
    beginViewRequest();
    setConversation(null);
    setPrompt("");
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
      const eventSnapshot = event.snapshot as ConversationRunSnapshot;
      const rootRunId = eventSnapshot.rootRunId ?? eventSnapshot.runId;
      rememberTask({
        rootRunId,
        conversationId: eventSnapshot.conversationId ?? rootRunId,
        latestRunId: eventSnapshot.runId,
        prompt: eventSnapshot.prompt,
        status: eventSnapshot.status,
        updatedAt: eventSnapshot.updatedAt
      });
    }
    if (event.type === "status") {
      updateRecentTask(event.runId, { status: event.status, updatedAt: event.ts });
    }
    if (event.type === "run-finished") {
      updateRecentTask(event.runId, { status: event.status, updatedAt: event.ts });
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
        const event = JSON.parse((raw as MessageEvent<string>).data) as RunEvent;
        if (event.runId !== runId || !isCurrentSource()) return;
        consumeEvent(event);
      } catch {
        if (isCurrentSource()) setError("服务返回了无法识别的事件");
      }
    });
  }

  async function startRun(nextPrompt = prompt): Promise<void> {
    const cleanPrompt = nextPrompt.trim();
    if (!cleanPrompt || isRunning || startingRef.current) return;
    const continueFromRunId = snapshot?.runId;
    const existingRootRunId = conversation?.rootRunId;
    const conversationTitle = conversation?.runs[0]?.visiblePrompt ?? cleanPrompt;
    startingRef.current = true;
    setIsStarting(true);
    const viewRequest = beginViewRequest();
    const controller = new AbortController();
    startAbortRef.current = controller;
    const clientRequestId = createClientRequestId();
    const enabledSkills = skillOptions.filter((skill) => selectedSkills.includes(skill.id));
    const enabledContexts = contextOptions.filter((context) => selectedContexts.includes(context.id));
    const directives = [
      enabledSkills.length ? `Use these skills when relevant: ${enabledSkills.map((skill) => `$${skill.id}`).join(", ")}.` : "",
      enabledContexts.length ? `Prioritize these local contexts: ${enabledContexts.map((context) => context.path).join(", ")}.` : "",
      customInstructions ? `User preferences:\n${customInstructions}` : ""
    ].filter(Boolean);
    const requestPrompt = directives.length ? `${directives.join("\n")}\n\nTask:\n${cleanPrompt}` : cleanPrompt;

    setError(null);
    closeStream("idle");
    try {
      const response = await fetch(`${apiBase}/api/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: requestPrompt,
          model: executionPreference.model,
          mode: executionPreference.mode,
          effort: executionPreference.effort,
          ...(routing === "tokenresearch" ? { routing } : {}),
          clientRequestId,
          ...(continueFromRunId === undefined ? {} : { continueFromRunId })
        }),
        signal: controller.signal
      });
      const body = await response.json() as {
        runId?: string;
        status?: "queued" | "running";
        conversationId?: string;
        rootRunId?: string;
        parentRunId?: string;
        error?: string;
      };
      if (!response.ok || !body.runId) throw new Error(body.error ?? "无法启动任务");
      if (viewRequestRef.current !== viewRequest) return;

      const acceptedAt = new Date().toISOString();
      const rootRunId = body.rootRunId ?? existingRootRunId ?? body.runId;
      const conversationId = body.conversationId ?? conversation?.conversationId ?? rootRunId;
      const parentRunId = body.parentRunId ?? continueFromRunId;
      const acceptedSnapshot: ConversationRunSnapshot = {
        runId: body.runId,
        conversationId,
        rootRunId,
        status: body.status ?? "queued",
        prompt: requestPrompt,
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
      setConversation((previous) => {
        if (!continueFromRunId) return { conversationId, rootRunId, runs: [acceptedRun] };
        if (!previous || previous.rootRunId !== rootRunId || previous.runs.at(-1)?.runId !== continueFromRunId) return previous;
        return { ...previous, conversationId, runs: [...previous.runs, acceptedRun] };
      });
      rememberTask({ rootRunId, conversationId, latestRunId: body.runId, prompt: conversationTitle, status: acceptedSnapshot.status, updatedAt: acceptedAt });
      window.localStorage.setItem(activeConversationStorageKey, rootRunId);
      subscribe(body.runId);
      setPrompt("");
    } catch (caught) {
      if (viewRequestRef.current !== viewRequest || controller.signal.aborted) return;
      setError(caught instanceof Error ? caught.message : "无法启动任务");
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

  async function openRecentTask(task: RecentTask): Promise<void> {
    const viewRequest = beginViewRequest();
    const controller = new AbortController();
    restoreAbortRef.current = controller;
    setError(null);
    try {
      const response = await fetch(`${apiBase}/api/runs/${task.latestRunId}`, { signal: controller.signal });
      const body = await response.json() as ConversationRestorePayload & { error?: string };
      const restored = restoreConversation(body);
      if (!response.ok || !restored) throw new Error(body.error ?? "无法读取任务");
      if (viewRequestRef.current !== viewRequest) return;
      closeStream("idle");
      setConversation(restored);
      setPrompt("");
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
      });
      if (!isTerminalStatus(restoredLatest.snapshot.status)) subscribe(restoredLatest.runId);
      else closeStream("idle");
    } catch (caught) {
      if (viewRequestRef.current !== viewRequest || controller.signal.aborted) return;
      setError(caught instanceof Error ? caught.message : "无法读取任务");
    } finally {
      if (viewRequestRef.current === viewRequest) restoreAbortRef.current = null;
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
      if (!isRunning) void startRun();
    }
  }

  const connectionLabel = connection === "open" ? "实时" : connection === "connecting" ? "连接中" : connection === "closed" ? "断开" : "空闲";
  const visibleContextCount = selectedContexts.filter((id) => id !== "workspace").length;
  const runtimeLabel = connection === "open" ? "事件流已连接" : connection === "connecting" ? "正在连接事件流" : connection === "closed" ? "事件流已断开" : "等待新任务";
  const ThemeIcon = themeIcons[theme];

  function selectRouting(value: string): void {
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
    const nextModel = value as ModelId;
    setRouting("manual");
    setModel(nextModel);
    setMode((currentMode) => normalizeModeForModel(nextModel, routing === "tokenresearch" ? "standard" : currentMode));
  }

  function selectEffort(value: string): void {
    setRouting("manual");
    setEffort(value as Effort);
    if (routing === "tokenresearch") setMode("standard");
  }

  function selectTheme(nextTheme: ThemePreference): void {
    applyTheme(nextTheme);
    setTheme(nextTheme);
  }

  function selectRunMode(value: string): void {
    const nextMode = value as RunMode;
    setRouting("manual");
    setMode(nextMode);
    if (nextMode === "ultra") setEffort("max");
  }

  return <TooltipProvider><div ref={appShellRef} className="app-shell">
    {sidebarOpen ? <button type="button" className="sidebar-scrim" onClick={() => setSidebarOpen(false)} aria-label="关闭导航" /> : null}
    <aside className={sidebarOpen ? "sidebar sidebar-open" : "sidebar"} aria-label="主导航">
      <div className="brand-row">
        <button type="button" className="brand" onClick={resetWorkspace}><BrandMark /><span><strong>OpenRigor</strong><small>Local agent</small></span></button>
        <IconTooltip label="关闭导航"><button type="button" className="icon-control sidebar-close" onClick={() => setSidebarOpen(false)} aria-label="关闭导航"><X aria-hidden="true" /></button></IconTooltip>
      </div>

      <button className="account-switcher" type="button" onClick={(event) => openWorkspaceDialog("agent", event.currentTarget)}><span><strong>Personal</strong><small>Owner</small></span><span className="plan-label">Local</span></button>

      <nav className="nav-list" aria-label="产品导航">
        <button type="button" className={conversation ? "nav-item" : "nav-item active"} onClick={resetWorkspace}><Plus aria-hidden="true" /><span>新任务</span></button>
        <button type="button" className="nav-item" onClick={(event) => openWorkspaceDialog("knowledge", event.currentTarget)}><Library aria-hidden="true" /><span>知识与上下文</span>{visibleContextCount ? <small>{visibleContextCount}</small> : null}</button>
        <button type="button" className="nav-item" onClick={(event) => openWorkspaceDialog("agent", event.currentTarget)}><Layers3 aria-hidden="true" /><span>Agent 与技能</span>{selectedSkills.length ? <small>{selectedSkills.length}</small> : null}</button>
      </nav>

      <section className="sidebar-section">
        <div className="sidebar-label"><span>项目</span></div>
        <button type="button" className="project-item" onClick={resetWorkspace}><span className="project-monogram">OR</span><span><strong>OpenRigor</strong><small>E:\\0_Code\\OpenRigor</small></span><ChevronRight aria-hidden="true" /></button>
      </section>

      <section className="sidebar-section recent-section">
        <div className="sidebar-label"><span>任务</span></div>
        {recentTasks.length ? recentTasks.slice(0, 5).map((task) => <button type="button" className={conversation?.rootRunId === task.rootRunId ? "recent-item active" : "recent-item"} key={task.rootRunId} onClick={() => void openRecentTask(task)}><span className={`recent-status status-${task.status}`} /><span><strong>{task.prompt}</strong><small>{statusLabel(task.status)} · {formatTime(task.updatedAt)}</small></span></button>) : <div className="history-empty"><Clock3 aria-hidden="true" /><span>发送任务后，最近活动会显示在这里</span></div>}
      </section>

      <div className="sidebar-bottom">
        <div className="runtime-row"><span className={`runtime-pulse runtime-${connection}`} /><span><strong>Codex runtime</strong><small>{runtimeLabel}</small></span><ShieldCheck aria-hidden="true" /></div>
        <button type="button" className="profile" onClick={(event) => openWorkspaceDialog("agent", event.currentTarget)}><span className="avatar">J</span><span><strong>Jeff</strong><small>本地工作区</small></span><Settings aria-hidden="true" /></button>
      </div>
    </aside>

    <main className="main-area">
      <header className="main-header">
        <div className="header-left">
          <IconTooltip label="打开导航"><button type="button" className="icon-control mobile-menu" onClick={() => setSidebarOpen(true)} aria-label="打开导航"><Menu aria-hidden="true" /></button></IconTooltip>
          <span className="header-divider" />
          <div className="header-title-group"><strong>{snapshot ? (visiblePrompt.length > 58 ? `${visiblePrompt.slice(0, 58)}...` : visiblePrompt) : "新任务"}</strong><small>{snapshot ? `${modelLabel(snapshot.model)} · ${formatTime(snapshot.updatedAt)}` : "OpenRigor · main"}</small></div>
        </div>
        <div className="header-actions">
          <span className={`connection connection-${connection}`} role="status" aria-live="polite"><span className="status-dot" />{connectionLabel}</span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><button type="button" className="icon-control" aria-label="切换外观" title="切换外观"><ThemeIcon aria-hidden="true" /></button></DropdownMenuTrigger>
              <DropdownMenuContent className="radix-menu theme-menu" align="end" sideOffset={8}>
                <DropdownMenuLabel className="menu-caption">外观</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={theme} onValueChange={(value) => selectTheme(value as ThemePreference)}>
                  {themeOptions.map((option) => {
                    const OptionIcon = themeIcons[option.value];
                    return <DropdownMenuRadioItem className="radio-menu-item theme-menu-item" value={option.value} key={option.value}><OptionIcon aria-hidden="true" /><span><strong>{option.label}</strong><small>{option.description}</small></span>{theme === option.value ? <Check aria-hidden="true" /> : null}</DropdownMenuRadioItem>;
                  })}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
          </DropdownMenu>
          <IconTooltip label="Agent 设置"><button type="button" className="icon-control" onClick={(event) => openWorkspaceDialog("agent", event.currentTarget)} aria-label="Agent 设置"><Settings aria-hidden="true" /></button></IconTooltip>
        </div>
      </header>

      <div className={conversation ? "main-body conversation-mode" : "main-body"}>
        {!conversation ? <HomeView activeTab={activeTab} onTabChange={setActiveTab} onOpenExample={(example, trigger) => { exampleTriggerRef.current = trigger; setSelectedExample(example); }} /> : <section className="conversation-view">
          <Conversation className="ai-conversation">
            <ConversationContent className="conversation-column" scrollClassName="conversation-scroll">
              {conversation.runs.map((run) => <RunTurn key={run.runId} run={run} copied={copiedRunId === run.runId} onCopy={(runId, answer) => { void copyAnswer(runId, answer); }} connection={connection} />)}
            </ConversationContent>
            <ConversationScrollButton className="jump-latest" aria-label="跳到最新"><ArrowDown aria-hidden="true" /></ConversationScrollButton>
          </Conversation>
        </section>}
      </div>

      <div className="composer-region">
        <div className="composer-wrap">
          <ComposerPalette open={Boolean(paletteMode)} mode={paletteMode} items={paletteItems} activeIndex={paletteIndex} selected={paletteMode === "skill" ? selectedSkills : selectedContexts} onSelect={selectPaletteItem} />
        <PromptInput className="composer" onSubmit={async (message) => { await startRun(message.text); }}>
          {(selectedSkills.length || hasExplicitContexts) ? <div className="composer-chips">
            {selectedContexts.filter((id) => id !== "workspace").map((id) => { const item = contextOptions.find((context) => context.id === id); return item ? <ComposerChip key={id} icon={Library} label={item.label} onRemove={() => setSelectedContexts((current) => current.filter((value) => value !== id))} /> : null; })}
            {selectedSkills.map((id) => { const item = skillOptions.find((skill) => skill.id === id); return item ? <ComposerChip key={id} icon={Layers3} label={item.label} onRemove={() => setSelectedSkills((current) => current.filter((value) => value !== id))} /> : null; })}
          </div> : null}
          <PromptInputBody><PromptInputTextarea ref={textareaRef} value={prompt} onChange={(event) => updatePrompt(event.target.value)} onKeyDown={handleComposerKeyDown} onFocus={() => { const token = prompt.match(/(?:^|\s)([\/@])[^\s]*$/); if (token) setPaletteMode(token[1] === "/" ? "skill" : "context"); }} placeholder={isRunning ? "当前任务执行中，可先准备下一条任务" : "描述你的任务，输入 / 选择技能与上下文"} rows={2} aria-label="任务描述" aria-controls={paletteMode ? `composer-palette-${paletteMode}` : undefined} aria-activedescendant={paletteMode && paletteItems[paletteIndex] ? `composer-${paletteMode}-${paletteItems[paletteIndex].id}` : undefined} /></PromptInputBody>
          <PromptInputFooter className="composer-toolbar">
            <PromptInputTools className="composer-left">
              <DropdownMenu>
                <DropdownMenuTrigger asChild><button ref={addMenuTriggerRef} type="button" className="icon-tool" aria-label="添加技能或上下文" title="添加技能或上下文"><Plus aria-hidden="true" /></button></DropdownMenuTrigger>
                  <DropdownMenuContent className="radix-menu add-menu" align="start" side="top" sideOffset={10}>
                    <DropdownMenuItem className="simple-menu-item" onSelect={() => openWorkspaceDialog("knowledge", addMenuTriggerRef.current)}><Library aria-hidden="true" /><span><strong>添加上下文</strong><small>项目文件与调研材料</small></span></DropdownMenuItem>
                    <DropdownMenuItem className="simple-menu-item" onSelect={() => openWorkspaceDialog("agent", addMenuTriggerRef.current)}><Layers3 aria-hidden="true" /><span><strong>使用技能</strong><small>选择专门的工作方法</small></span></DropdownMenuItem>
                  </DropdownMenuContent>
              </DropdownMenu>

              <ExecutionSelector
                routing={routing}
                model={model}
                effort={effort}
                mode={mode}
                onRoutingChange={(value) => selectRouting(value)}
                onModelChange={(value) => selectModel(value)}
                onEffortChange={(value) => selectEffort(value)}
                onModeChange={(value) => selectRunMode(value)}
              />
            </PromptInputTools>
            <div className="composer-right">
              <span className="context-meter" title="本次任务将使用当前工作区"><span className="meter-ring" />本机</span>
              {isRunning ? <button ref={actionButtonRef} type="button" className="stop-button" onClick={() => void cancelRun()} aria-label="停止任务"><Square aria-hidden="true" /></button> : <button ref={actionButtonRef} type="submit" className="send-button" disabled={isStarting || !prompt.trim()} aria-label="发送任务"><ArrowUp aria-hidden="true" /></button>}
            </div>
          </PromptInputFooter>
        </PromptInput>
        </div>
      </div>
    </main>

    <ExampleDialog example={selectedExample} onClose={() => setSelectedExample(null)} onUse={useExample} restoreFocus={() => exampleTriggerRef.current?.focus()} />
    <KnowledgeDialog open={workspacePanel === "knowledge"} onOpenChange={(open) => setWorkspacePanel(open ? "knowledge" : null)} selected={selectedContexts} onToggle={(id) => toggleSelected(id, setSelectedContexts, selectedContexts)} restoreFocus={() => knowledgeTriggerRef.current?.focus()} />
    <AgentDialog open={workspacePanel === "agent"} onOpenChange={(open) => setWorkspacePanel(open ? "agent" : null)} selectedSkills={selectedSkills} onToggleSkill={(id) => toggleSelected(id, setSelectedSkills, selectedSkills)} customInstructions={customInstructions} onSaveInstructions={(value) => { setCustomInstructions(value); window.localStorage.setItem("openrigor.instructions", value); }} restoreFocus={() => agentTriggerRef.current?.focus()} />

    {error ? <div ref={toastRef} className="toast" role="alert"><span className="toast-icon"><CircleHelp aria-hidden="true" /></span><span>{error}</span><button type="button" onClick={() => setError(null)} aria-label="关闭"><X aria-hidden="true" /></button></div> : null}
  </div></TooltipProvider>;
}
