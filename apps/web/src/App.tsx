import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactElement
} from "react";
import type { RunEvent, RunSnapshot } from "@openrigor/protocol";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Activity,
  ArrowDown,
  ArrowUp,
  BookOpen,
  Bot,
  BrainCircuit,
  BriefcaseBusiness,
  Bug,
  Calendar,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  ClipboardCheck,
  Clock3,
  Code2,
  Command,
  Copy,
  Database,
  FileCode2,
  FileSpreadsheet,
  FileText,
  FlaskConical,
  Folder,
  Gauge,
  GitCompare,
  Globe2,
  HardDrive,
  Layers3,
  Library,
  ListTodo,
  Menu,
  MessageSquare,
  AtSign,
  Palette,
  PenLine,
  Plus,
  Presentation,
  Radar,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Square,
  Tags,
  Target,
  Terminal,
  User,
  WandSparkles,
  X,
  Zap,
  type LucideIcon
} from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from "./components/ui/collapsible";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogTitle
} from "./components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from "./components/ui/dropdown-menu";
import {
  TooltipContent,
  TooltipProvider,
  TooltipRoot,
  TooltipTrigger
} from "./components/ui/tooltip";
import {
  applyRunEvent,
  cleanHistoryPrompt,
  projectRunEvents,
  restoreConversation,
  type ConversationRestorePayload,
  type ConversationRunSnapshot,
  type ConversationRunView,
  type ConversationViewState,
  type ToolProjection
} from "./conversation";

const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "http://localhost:8787";

type ConnectionState = "idle" | "connecting" | "open" | "closed";
type TabId = "research" | "services" | "engineering" | "marketing" | "management" | "creative";
type ModelId = "auto" | "gpt-5.6-terra" | "gpt-5.6-sol";
type Effort = "fast" | "balanced" | "deep";
type WorkspacePanel = "knowledge" | "agent" | null;
type ComposerPaletteMode = "skill" | "context" | null;
type ToolEvent = Extract<RunEvent, { type: "tool" }>;

interface ExampleTask {
  title: string;
  description: string;
  prompt: string;
  icon: LucideIcon;
  visual?: ExampleVisual;
}

type ExampleVisual = "research" | "slides" | "chart" | "matrix" | "code" | "terminal" | "brief" | "calendar";

const companionVisuals: Record<ExampleVisual, ExampleVisual> = {
  research: "chart",
  slides: "brief",
  chart: "matrix",
  matrix: "research",
  code: "terminal",
  terminal: "code",
  brief: "chart",
  calendar: "brief"
};

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

const tabs: Array<{ id: TabId; label: string }> = [
  { id: "research", label: "科研学术" },
  { id: "services", label: "专业服务" },
  { id: "engineering", label: "工程开发" },
  { id: "marketing", label: "运营市场" },
  { id: "management", label: "经营管理" },
  { id: "creative", label: "创意创作" }
];

const modelOptions: Array<{ value: ModelId; label: string; description: string }> = [
  { value: "auto", label: "Auto", description: "使用 Codex 当前默认模型" },
  { value: "gpt-5.6-terra", label: "GPT-5.6 Terra", description: "日常任务与快速执行" },
  { value: "gpt-5.6-sol", label: "GPT-5.6 Sol", description: "复杂推理与代码任务" }
];

const effortOptions: Array<{ value: Effort; label: string; description: string }> = [
  { value: "fast", label: "快速", description: "缩短响应时间" },
  { value: "balanced", label: "均衡", description: "速度与质量平衡" },
  { value: "deep", label: "极限", description: "投入更多推理预算" }
];

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

const examples: Record<TabId, ExampleTask[]> = {
  research: [
    { title: "梳理一组论文", description: "提炼研究脉络、方法差异和可验证空白。", prompt: "请检索并梳理这个方向近三年的代表性论文，给出方法对比、证据来源和下一步研究机会。", icon: BookOpen, visual: "research" },
    { title: "准备组会汇报", description: "把材料变成结构清晰、可讲述的演示提纲。", prompt: "请阅读当前工作区的论文材料，整理成一份 15 分钟组会汇报提纲，并标注关键图表。", icon: FileText, visual: "slides" },
    { title: "复核实验结果", description: "检查数据、脚本和结论之间是否一致。", prompt: "请检查项目中的实验脚本和结果，找出可复现性风险，并提出最小修正方案。", icon: FlaskConical, visual: "chart" },
    { title: "搭建文献矩阵", description: "按问题、数据、指标和限制组织阅读记录。", prompt: "请为这批文献建立一个可持续更新的阅读矩阵，包含问题、数据、指标、结论和局限。", icon: Database, visual: "matrix" }
  ],
  services: [
    { title: "审阅一份合同", description: "标出风险条款、缺失项和待确认问题。", prompt: "请审阅工作区中的合同，按风险等级列出条款问题、影响和建议修改。", icon: ShieldCheck, visual: "brief" },
    { title: "做一份尽调摘要", description: "把公开材料压缩成有引用的决策备忘录。", prompt: "请对目标公司做一份尽调摘要，区分已验证事实、推断和待确认信息。", icon: Search, visual: "research" },
    { title: "整理客户访谈", description: "从访谈记录中提取需求、异议和行动项。", prompt: "请整理当前目录的客户访谈记录，提取共性需求、异议、证据和待办事项。", icon: MessageSquare, visual: "matrix" },
    { title: "生成服务方案", description: "从目标和约束出发形成可执行交付计划。", prompt: "请根据这份需求说明生成服务方案、交付里程碑、风险和报价假设。", icon: BriefcaseBusiness, visual: "slides" }
  ],
  engineering: [
    { title: "搭建一个原型", description: "从需求开始，交付可运行的最小版本。", prompt: "请先检查当前项目，然后实现需求中最小可运行的切片，并说明验证步骤。", icon: Code2, visual: "code" },
    { title: "定位一个 bug", description: "复现问题、找到根因并给出可审阅修复。", prompt: "请检查项目中最近的错误日志和相关代码，定位根因，提出并验证一个小范围修复。", icon: Bug, visual: "terminal" },
    { title: "整理技术债", description: "按影响和成本排列真正值得处理的事项。", prompt: "请审计当前代码库的技术债，按用户影响、风险和工作量排序，给出执行顺序。", icon: ListTodo, visual: "matrix" },
    { title: "补齐测试", description: "围绕关键行为补测试并运行验证。", prompt: "请找出当前项目最重要的未覆盖行为，补上聚焦测试并运行相关检查。", icon: CheckCircle2, visual: "terminal" }
  ],
  marketing: [
    { title: "扫描竞品", description: "比较定位、功能、价格和证据强弱。", prompt: "请对这几个竞品做一份证据驱动的对比，覆盖定位、功能、价格和差异化机会。", icon: Radar, visual: "research" },
    { title: "设计内容计划", description: "把业务目标拆成可执行的内容节奏。", prompt: "请根据业务目标制定四周内容计划，包含主题、渠道、负责人和衡量指标。", icon: Calendar, visual: "calendar" },
    { title: "分析用户反馈", description: "聚合反馈主题，区分信号和噪声。", prompt: "请分析工作区中的用户反馈，聚类主题，标出证据和优先级建议。", icon: MessageSquare, visual: "chart" },
    { title: "准备发布清单", description: "在发布前检查内容、链接和风险。", prompt: "请为这次发布创建一份可执行的检查清单，并指出缺失材料。", icon: ClipboardCheck, visual: "brief" }
  ],
  management: [
    { title: "整理经营数据", description: "把分散数据变成可讨论的经营视图。", prompt: "请检查当前经营数据，整理关键指标、异常和需要管理层决定的问题。", icon: Gauge, visual: "chart" },
    { title: "写决策备忘录", description: "清晰呈现选项、取舍和建议。", prompt: "请把这些材料整理成一份决策备忘录，明确选项、取舍、风险和建议。", icon: FileText, visual: "brief" },
    { title: "规划季度目标", description: "把方向拆成可追踪的结果和节奏。", prompt: "请根据现有目标制定季度计划，包含结果指标、依赖关系和复盘节奏。", icon: Target, visual: "calendar" },
    { title: "准备会议材料", description: "让会议聚焦事实、选择和行动。", prompt: "请把这批材料整理成会议议程、背景摘要、决策问题和会后行动项。", icon: Calendar, visual: "slides" }
  ],
  creative: [
    { title: "构思一个故事", description: "从主题和受众出发形成完整创意。", prompt: "请围绕这个主题提出三个故事方向，并展开最有潜力的一版。", icon: WandSparkles, visual: "research" },
    { title: "制作视觉脚本", description: "把想法转成可拍摄、可制作的镜头表。", prompt: "请把这个创意整理成视觉脚本，包含镜头、旁白、节奏和素材需求。", icon: Palette, visual: "slides" },
    { title: "润色一篇文章", description: "保留观点，改善结构、语气和可读性。", prompt: "请在不改变事实和观点的前提下润色这篇文章，并列出重要改动。", icon: PenLine, visual: "research" },
    { title: "做一套命名方案", description: "给出有理由、可筛选的命名候选。", prompt: "请为这个产品提出一组命名候选，说明含义、语气和潜在风险。", icon: Tags, visual: "matrix" }
  ]
};

const eventTypes: RunEvent["type"][] = ["snapshot", "status", "part", "part-delta", "tool", "file", "subagent", "run-finished", "error"];

function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function compactId(value: string): string {
  return value.length > 18 ? `${value.slice(0, 8)}...${value.slice(-5)}` : value;
}

function formatDuration(firstAt: string, lastAt: string): string | null {
  const duration = new Date(lastAt).getTime() - new Date(firstAt).getTime();
  if (duration <= 0) return null;
  if (duration < 1000) return `${duration}ms`;
  if (duration < 60_000) return `${(duration / 1000).toFixed(duration < 10_000 ? 1 : 0)}s`;
  return `${Math.floor(duration / 60_000)}m ${Math.round((duration % 60_000) / 1000)}s`;
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 11) return "早上好，Jeff";
  if (hour < 18) return "下午好，Jeff";
  return "晚上好，Jeff";
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

function phaseLabel(phase: ToolEvent["tool"]["phase"]): string {
  if (phase === "succeeded") return "完成";
  if (phase === "failed") return "失败";
  if (phase === "running") return "运行中";
  return "准备中";
}

function modelLabel(model: string): string {
  return modelOptions.find((option) => option.value === model)?.label ?? model;
}

function effortLabel(effort: Effort): string {
  return effortOptions.find((option) => option.value === effort)?.label ?? effort;
}

function toolLabel(name: string): string {
  const normalized = name.toLowerCase();
  if (normalized.includes("command") || normalized.includes("shell") || normalized.includes("bash")) return "运行命令";
  if (normalized.includes("write") || normalized.includes("edit")) return "更新文件";
  if (normalized.includes("read") || normalized.includes("file")) return "读取文件";
  if (normalized.includes("search") || normalized.includes("grep") || normalized.includes("glob")) return "检索资料";
  if (normalized.includes("browser") || normalized.includes("web")) return "浏览网页";
  if (normalized.includes("subagent") || normalized.includes("task")) return "委派子任务";
  return name.replaceAll("_", " ").replaceAll(".", " · ");
}

function toolIcon(name: string): LucideIcon {
  const normalized = name.toLowerCase();
  if (normalized.includes("command") || normalized.includes("shell") || normalized.includes("bash")) return Terminal;
  if (normalized.includes("file") || normalized.includes("read") || normalized.includes("write") || normalized.includes("edit")) return FileCode2;
  if (normalized.includes("search") || normalized.includes("browser") || normalized.includes("web")) return Globe2;
  if (normalized.includes("subagent") || normalized.includes("task")) return Bot;
  return Zap;
}

function MarkdownText({ text }: { text: string }): ReactElement {
  return <div className="markdown"><ReactMarkdown
    remarkPlugins={[remarkGfm]}
    components={{ a: ({ ...props }) => <a {...props} target="_blank" rel="noreferrer" /> }}
  >{text}</ReactMarkdown></div>;
}

function ExamplePreviewArt({ visual }: { visual: ExampleVisual }): ReactElement {
  if (visual === "research") return <span className="example-art art-research" aria-hidden="true"><span className="art-window"><i /><i /><i /></span><span className="art-sheet"><b /><b /><b /><em /></span><span className="art-pin" /></span>;
  if (visual === "slides") return <span className="example-art art-slides" aria-hidden="true"><span className="art-slide art-slide-back" /><span className="art-slide art-slide-main"><b /><i /><i /><i /></span><span className="art-slide art-slide-front"><b /><i /><i /></span></span>;
  if (visual === "chart") return <span className="example-art art-chart" aria-hidden="true"><span className="art-axis" /><span className="art-line line-one" /><span className="art-line line-two" /><span className="art-bar bar-one" /><span className="art-bar bar-two" /><span className="art-bar bar-three" /><span className="art-bar bar-four" /></span>;
  if (visual === "matrix") return <span className="example-art art-matrix" aria-hidden="true"><span className="matrix-head"><i /><i /><i /><i /></span><span className="matrix-row"><i /><i /><i /><i /></span><span className="matrix-row"><i /><i /><i /><i /></span><span className="matrix-row"><i /><i /><i /><i /></span><span className="matrix-row"><i /><i /><i /><i /></span></span>;
  if (visual === "code") return <span className="example-art art-code" aria-hidden="true"><span className="code-rail"><i /><i /><i /><i /></span><span className="code-lines"><i /><i /><i /><i /><i /><i /></span><span className="code-card"><b /><i /><i /></span></span>;
  if (visual === "terminal") return <span className="example-art art-terminal" aria-hidden="true"><span className="terminal-head"><b /><b /><b /></span><span className="terminal-copy"><i /><i /><i /><i /></span><span className="terminal-cursor" /></span>;
  if (visual === "calendar") return <span className="example-art art-calendar" aria-hidden="true"><span className="calendar-head"><b /><i /><i /></span><span className="calendar-grid"><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /></span></span>;
  return <span className="example-art art-brief" aria-hidden="true"><span className="brief-ring" /><span className="brief-lines"><i /><i /><i /><i /></span><span className="brief-chip" /></span>;
}

interface ComposerPaletteItem {
  id: string;
  label: string;
  description: string;
  icon: LucideIcon;
  kind: "skill" | "context";
  path?: string;
}

function ComposerPalette({
  open,
  mode,
  items,
  activeIndex,
  selected,
  onSelect
}: {
  open: boolean;
  mode: "skill" | "context" | null;
  items: ComposerPaletteItem[];
  activeIndex: number;
  selected: string[];
  onSelect: (item: ComposerPaletteItem) => void;
}): ReactElement | null {
  if (!open || !mode) return null;
  const HeaderIcon = mode === "skill" ? Layers3 : AtSign;
  return <div className="composer-command-menu" role="listbox" aria-label={mode === "skill" ? "选择技能" : "选择上下文"}>
    <div className="composer-command-header"><span><HeaderIcon aria-hidden="true" />{mode === "skill" ? "技能" : "上下文"}</span><kbd>{mode === "skill" ? "/" : "@"}</kbd></div>
    {items.length ? items.map((item, index) => {
      const Icon = item.icon;
      const active = selected.includes(item.id);
      return <button
        type="button"
        role="option"
        aria-selected={active}
        className={index === activeIndex ? "composer-command-item highlighted" : "composer-command-item"}
        key={item.id}
        onPointerDown={(event) => event.preventDefault()}
        onClick={() => onSelect(item)}
      >
        <span className="composer-command-icon"><Icon aria-hidden="true" /></span>
        <span className="composer-command-copy"><strong>{item.label}</strong><small>{item.description}</small>{item.path ? <code>{item.path}</code> : null}</span>
        <span className={active ? "composer-command-check selected" : "composer-command-check"}>{active ? <Check aria-hidden="true" /> : <kbd>{index + 1}</kbd>}</span>
      </button>;
    }) : <div className="composer-command-empty">没有匹配的选项</div>}
    <div className="composer-command-footer"><span><kbd>↑</kbd><kbd>↓</kbd>选择</span><span><kbd>Enter</kbd>添加</span></div>
  </div>;
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

function ToolRow({ projection, output }: { projection: ToolProjection; output: string | undefined }): ReactElement {
  const phase = projection.event.tool.phase;
  const [open, setOpen] = useState(phase === "running" || phase === "failed");
  const Icon = toolIcon(projection.event.tool.name);
  const duration = formatDuration(projection.firstAt, projection.lastAt);

  useEffect(() => {
    if (phase === "running" || phase === "failed") setOpen(true);
    if (phase === "succeeded") setOpen(false);
  }, [phase]);

  return <Collapsible className="activity-row" open={open} onOpenChange={setOpen}>
    <CollapsibleTrigger asChild>
      <button type="button" className="activity-trigger">
        <span className={`activity-state phase-${phase}`}><Icon aria-hidden="true" /></span>
        <span className="activity-copy">
          <strong>{toolLabel(projection.event.tool.name)}</strong>
          {projection.event.tool.inputSummary ? <small>{projection.event.tool.inputSummary}</small> : null}
        </span>
        <span className={`activity-phase phase-${phase}`}>{duration ?? phaseLabel(phase)}</span>
        <ChevronDown className="activity-chevron" aria-hidden="true" />
      </button>
    </CollapsibleTrigger>
    {output ? <CollapsibleContent className="activity-output"><pre>{output}</pre></CollapsibleContent> : null}
  </Collapsible>;
}

function ConversationRunTurn({
  run,
  copied,
  onCopy
}: {
  run: ConversationRunView;
  copied: boolean;
  onCopy: (runId: string, answer: string) => void;
}): ReactElement {
  const { answer, reasoning, toolOutput, tools, diffs, files } = useMemo(() => projectRunEvents(run.events), [run.events]);
  const snapshot = run.snapshot;
  const isRunning = !isTerminalStatus(snapshot.status);
  const [reasoningOpen, setReasoningOpen] = useState(isRunning);
  const [executionOpen, setExecutionOpen] = useState(isRunning);
  const activityCount = tools.length + files.length + diffs.length + (reasoning ? 1 : 0);

  useEffect(() => {
    setExecutionOpen(isRunning);
    setReasoningOpen(isRunning);
  }, [isRunning]);

  return <section className="conversation-turn" data-run-id={run.runId}>
    <article className="user-turn">
      <div className="user-bubble">{run.visiblePrompt}</div>
      <div className="turn-meta"><span>{formatTime(snapshot.createdAt)}</span><span>{modelLabel(snapshot.model)}</span></div>
    </article>

    <article className="assistant-turn">
      <div className="assistant-heading"><span className="assistant-mark"><Command aria-hidden="true" /></span><span><strong>OpenRigor</strong><small className={`run-status status-${snapshot.status}`}><span />{statusLabel(snapshot.status)}</small></span><code>{compactId(snapshot.runId)}</code></div>

      {!answer && isRunning ? <div className="thinking-line"><span className="thinking-mark"><span /><span /><span /></span><span>{snapshot.currentStep ?? "正在分析任务"}</span></div> : null}

      {activityCount ? <Collapsible className="execution-group" open={executionOpen} onOpenChange={setExecutionOpen}>
        <CollapsibleTrigger asChild><button type="button" className="execution-summary"><Activity aria-hidden="true" /><span>{isRunning ? `正在执行 · ${activityCount} 个步骤` : `执行了 ${activityCount} 个步骤`}</span><small>{snapshot.progress}%</small><ChevronDown aria-hidden="true" /></button></CollapsibleTrigger>
        <CollapsibleContent className="execution-content">
          {reasoning ? <Collapsible className="activity-row reasoning-row" open={reasoningOpen} onOpenChange={setReasoningOpen}>
            <CollapsibleTrigger asChild><button type="button" className="activity-trigger"><span className="activity-state reasoning-state"><BrainCircuit aria-hidden="true" /></span><span className="activity-copy"><strong>深度思考</strong><small>{snapshot.currentStep ?? "分析任务与工作区"}</small></span><span className="activity-phase">{isRunning ? "进行中" : "完成"}</span><ChevronDown className="activity-chevron" aria-hidden="true" /></button></CollapsibleTrigger>
            <CollapsibleContent className="reasoning-copy">{reasoning}</CollapsibleContent>
          </Collapsible> : null}
          {tools.map((projection) => <ToolRow key={projection.event.tool.callId} projection={projection} output={projection.event.tool.outputSummary ?? toolOutput.get(projection.event.tool.callId)} />)}
          {files.map((event) => <div className="activity-row artifact-row" key={event.eventId}><span className="activity-state file-state"><FileCode2 aria-hidden="true" /></span><span className="activity-copy"><strong>生成文件</strong><small>{event.file.name}</small></span><span className="activity-phase">修订 {event.file.revision}</span></div>)}
          {diffs.map((event) => <Collapsible className="activity-row" key={event.eventId}><CollapsibleTrigger asChild><button type="button" className="activity-trigger"><span className="activity-state diff-state"><GitCompare aria-hidden="true" /></span><span className="activity-copy"><strong>文件变更</strong><small>{event.part.partId.replace("diff:", "")}</small></span><span className="activity-phase">查看差异</span><ChevronDown className="activity-chevron" aria-hidden="true" /></button></CollapsibleTrigger><CollapsibleContent className="activity-output"><pre>{event.part.text}</pre></CollapsibleContent></Collapsible>)}
        </CollapsibleContent>
      </Collapsible> : null}

      {answer ? <div className="answer-block"><MarkdownText text={answer} /><div className="answer-actions"><button type="button" onClick={() => onCopy(run.runId, answer)}><Copy aria-hidden="true" />{copied ? "已复制" : "复制回答"}</button></div></div> : null}
      {snapshot.status === "completed" ? <div className="completion-line"><span><Check aria-hidden="true" /></span><strong>任务完成</strong><small>{formatTime(snapshot.updatedAt)}</small></div> : null}
    </article>
  </section>;
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
  const Icon = example?.icon ?? BookOpen;
  const visual = example?.visual ?? "research";
  return <Dialog open={Boolean(example)} onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogPortal>
      <DialogOverlay className="dialog-overlay" />
      <DialogContent className="dialog-content example-dialog" onCloseAutoFocus={(event) => { event.preventDefault(); restoreFocus(); }}>
        <DialogClose asChild><button type="button" className="dialog-close example-dialog-close" aria-label="关闭"><X aria-hidden="true" /></button></DialogClose>
        <div className="example-dialog-visual" aria-hidden="true">
          <div className="example-dialog-stage">
            <ExamplePreviewArt visual={visual} />
            <ExamplePreviewArt visual={companionVisuals[visual]} />
          </div>
        </div>
        <div className="example-dialog-body">
          <div className="example-dialog-heading">
            <span className="example-dialog-icon"><Icon aria-hidden="true" /></span>
            <div>
              <DialogTitle className="dialog-title">{example?.title ?? "示例任务"}</DialogTitle>
              <DialogDescription className="dialog-description">{example?.description}</DialogDescription>
            </div>
          </div>
          <div className="example-meta"><span>本地 Codex</span><span>工作区任务</span><small>确认后可编辑</small></div>
          <div className="example-prompt"><p>{example?.prompt}</p></div>
          <div className="dialog-actions">
            <DialogClose asChild><button type="button" className="secondary-button">取消</button></DialogClose>
            <button type="button" className="primary-button" onClick={() => { if (example) onUse(example); }}>使用这个案例</button>
          </div>
        </div>
      </DialogContent>
    </DialogPortal>
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
  useEffect(() => { if (open) setQuery(""); }, [open]);
  const filtered = contextOptions.filter((item) => `${item.label} ${item.path} ${item.description}`.toLowerCase().includes(query.toLowerCase()));
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogPortal>
      <DialogOverlay className="dialog-overlay" />
      <DialogContent className="dialog-content workspace-dialog" onCloseAutoFocus={(event) => { event.preventDefault(); restoreFocus(); }}>
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
    </DialogPortal>
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

  useEffect(() => {
    if (open) {
      setDraftInstructions(customInstructions);
      setQuery("");
      setTab("skills");
    }
  }, [customInstructions, open]);

  const filtered = skillOptions.filter((skill) => `${skill.label} ${skill.id} ${skill.description}`.toLowerCase().includes(query.toLowerCase()));

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogPortal>
      <DialogOverlay className="dialog-overlay" />
      <DialogContent className="dialog-content agent-dialog" onCloseAutoFocus={(event) => { event.preventDefault(); restoreFocus(); }}>
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
    </DialogPortal>
  </Dialog>;
}

export function App(): ReactElement {
  const [prompt, setPrompt] = useState("");
  const [activeTab, setActiveTab] = useState<TabId>("research");
  const [conversation, setConversation] = useState<ConversationViewState | null>(null);
  const [connection, setConnection] = useState<ConnectionState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [model, setModel] = useState<ModelId>("auto");
  const [effort, setEffort] = useState<Effort>("balanced");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [recentTasks, setRecentTasks] = useState<RecentTask[]>(loadRecentTasks);
  const [selectedExample, setSelectedExample] = useState<ExampleTask | null>(null);
  const [workspacePanel, setWorkspacePanel] = useState<WorkspacePanel>(null);
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [selectedContexts, setSelectedContexts] = useState<string[]>(["workspace"]);
  const [followLatest, setFollowLatest] = useState(true);
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
  const conversationScroll = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
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
  const renderedEventCount = conversation?.runs.reduce((total, run) => total + run.events.length, 0) ?? 0;
  const hasExplicitContexts = selectedContexts.some((id) => id !== "workspace");

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

  useEffect(() => {
    const node = conversationScroll.current;
    if (!node || !followLatest) return;
    node.scrollTo({ top: node.scrollHeight, behavior: isRunning ? "auto" : "smooth" });
  }, [conversation?.runs.length, renderedEventCount, followLatest, isRunning]);

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
    setFollowLatest(true);
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
    setFollowLatest(true);
    try {
      const response = await fetch(`${apiBase}/api/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: requestPrompt,
          model,
          mode: "standard",
          effort,
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
        model,
        mode: "standard",
        effort,
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
      setFollowLatest(true);
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

  function submit(event: FormEvent): void {
    event.preventDefault();
    void startRun();
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

  function handleConversationScroll(): void {
    const node = conversationScroll.current;
    if (!node) return;
    setFollowLatest(node.scrollHeight - node.scrollTop - node.clientHeight < 96);
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

  const activeExamples = examples[activeTab];
  const connectionLabel = connection === "open" ? "实时" : connection === "connecting" ? "连接中" : connection === "closed" ? "断开" : "本机就绪";
  const visibleContextCount = selectedContexts.filter((id) => id !== "workspace").length;
  const runtimeLabel = connection === "open" ? "事件流已连接" : connection === "connecting" ? "正在连接事件流" : connection === "closed" ? "事件流已断开" : "本机执行器";

  return <TooltipProvider><div className="app-shell">
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
          <IconTooltip label="Agent 设置"><button type="button" className="icon-control" onClick={(event) => openWorkspaceDialog("agent", event.currentTarget)} aria-label="Agent 设置"><Settings aria-hidden="true" /></button></IconTooltip>
        </div>
      </header>

      <div className={conversation ? "main-body conversation-mode" : "main-body"}>
        {!conversation ? <section className="launch-view">
          <div className="launch-inner">
            <h1>{greeting()}</h1>
            <div className="workspace-context"><Folder aria-hidden="true" /><span>OpenRigor</span><small>main</small></div>
            <div className="category-tabs" role="tablist" aria-label="任务分类">{tabs.map((tab, index) => <button id={`task-tab-${tab.id}`} key={tab.id} type="button" role="tab" aria-selected={activeTab === tab.id} aria-controls="task-examples" tabIndex={activeTab === tab.id ? 0 : -1} className={activeTab === tab.id ? "category-tab selected" : "category-tab"} onClick={() => setActiveTab(tab.id)} onKeyDown={(event) => {
              if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
              event.preventDefault();
              const offset = event.key === "ArrowRight" ? 1 : -1;
              const next = tabs[(index + offset + tabs.length) % tabs.length];
              if (!next) return;
              setActiveTab(next.id);
              window.setTimeout(() => document.getElementById(`task-tab-${next.id}`)?.focus(), 0);
            }}>{tab.label}</button>)}</div>
            <div id="task-examples" className="example-grid" role="tabpanel" tabIndex={0} aria-labelledby={`task-tab-${activeTab}`}>{activeExamples.map((example) => {
              const Icon = example.icon;
              return <button type="button" className="example-card" key={example.title} onClick={(event) => { exampleTriggerRef.current = event.currentTarget; setSelectedExample(example); }} aria-label={`预览案例：${example.title}`}>
                <span className="example-body"><span className="example-kicker"><Icon aria-hidden="true" />工作流</span><strong>{example.title}</strong><span>{example.description}</span></span>
                <ExamplePreviewArt visual={example.visual ?? "research"} />
              </button>;
            })}</div>
          </div>
        </section> : <section className="conversation-view">
          <div className="conversation-scroll" ref={conversationScroll} onScroll={handleConversationScroll}>
            <div className="conversation-column">
              {conversation.runs.map((run) => <ConversationRunTurn key={run.runId} run={run} copied={copiedRunId === run.runId} onCopy={(runId, answer) => { void copyAnswer(runId, answer); }} />)}
            </div>
          </div>
          {!followLatest ? <button type="button" className="jump-latest" onClick={() => { setFollowLatest(true); conversationScroll.current?.scrollTo({ top: conversationScroll.current.scrollHeight, behavior: "smooth" }); }}><ArrowDown aria-hidden="true" />跳到最新</button> : null}
        </section>}
      </div>

      <div className="composer-region">
        <div className="composer-wrap">
          <ComposerPalette open={Boolean(paletteMode)} mode={paletteMode} items={paletteItems} activeIndex={paletteIndex} selected={paletteMode === "skill" ? selectedSkills : selectedContexts} onSelect={selectPaletteItem} />
        <form className="composer" onSubmit={submit}>
          {(selectedSkills.length || hasExplicitContexts) ? <div className="composer-chips">
            {selectedContexts.filter((id) => id !== "workspace").map((id) => { const item = contextOptions.find((context) => context.id === id); return item ? <button type="button" key={id} onClick={() => setSelectedContexts((current) => current.filter((value) => value !== id))}><Library aria-hidden="true" />{item.label}<X aria-hidden="true" /></button> : null; })}
            {selectedSkills.map((id) => { const item = skillOptions.find((skill) => skill.id === id); return item ? <button type="button" key={id} onClick={() => setSelectedSkills((current) => current.filter((value) => value !== id))}><Layers3 aria-hidden="true" />{item.label}<X aria-hidden="true" /></button> : null; })}
          </div> : null}
          <textarea ref={textareaRef} value={prompt} onChange={(event) => updatePrompt(event.target.value)} onKeyDown={handleComposerKeyDown} onFocus={() => { const token = prompt.match(/(?:^|\s)([\/@])[^\s]*$/); if (token) setPaletteMode(token[1] === "/" ? "skill" : "context"); }} placeholder={isRunning ? "当前任务执行中，可先准备下一条任务" : "描述你的任务，输入 / 选择技能与上下文"} rows={2} aria-label="任务描述" />
          <div className="composer-toolbar">
            <div className="composer-left">
              <DropdownMenu>
                <DropdownMenuTrigger asChild><button ref={addMenuTriggerRef} type="button" className="icon-tool" aria-label="添加技能或上下文" title="添加技能或上下文"><Plus aria-hidden="true" /></button></DropdownMenuTrigger>
                <DropdownMenuContent className="radix-menu add-menu" align="start" side="top" sideOffset={10}>
                  <DropdownMenuItem className="simple-menu-item" onSelect={() => openWorkspaceDialog("knowledge", addMenuTriggerRef.current)}><Library aria-hidden="true" /><span><strong>添加上下文</strong><small>项目文件与调研材料</small></span></DropdownMenuItem>
                  <DropdownMenuItem className="simple-menu-item" onSelect={() => openWorkspaceDialog("agent", addMenuTriggerRef.current)}><Layers3 aria-hidden="true" /><span><strong>使用技能</strong><small>选择专门的工作方法</small></span></DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <DropdownMenu>
                <DropdownMenuTrigger asChild><button type="button" className="model-trigger"><span>{modelLabel(model)}</span><span>·</span><span>{effortLabel(effort)}</span><ChevronDown aria-hidden="true" /></button></DropdownMenuTrigger>
                <DropdownMenuContent className="radix-menu settings-menu" align="start" side="top" sideOffset={10}>
                  <DropdownMenuLabel className="menu-caption">运行设置</DropdownMenuLabel>
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger className="submenu-trigger"><span>模式</span><strong>均衡</strong><ChevronRight aria-hidden="true" /></DropdownMenuSubTrigger>
                    <DropdownMenuPortal><DropdownMenuSubContent className="radix-menu submenu-content" sideOffset={7}>
                      <DropdownMenuRadioGroup value="standard">
                        <DropdownMenuRadioItem className="radio-menu-item" value="standard"><span><strong>均衡</strong><small>单 Agent 完成当前任务</small></span><Check aria-hidden="true" /></DropdownMenuRadioItem>
                        <DropdownMenuRadioItem className="radio-menu-item" value="cluster" disabled><span><strong>Agent 集群</strong><small>多 Agent 编排将在后续开放</small></span></DropdownMenuRadioItem>
                      </DropdownMenuRadioGroup>
                    </DropdownMenuSubContent></DropdownMenuPortal>
                  </DropdownMenuSub>
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger className="submenu-trigger"><span>模型</span><strong>{modelLabel(model)}</strong><ChevronRight aria-hidden="true" /></DropdownMenuSubTrigger>
                    <DropdownMenuPortal><DropdownMenuSubContent className="radix-menu submenu-content model-submenu" sideOffset={7}>
                      <DropdownMenuLabel className="menu-caption">本机 Codex</DropdownMenuLabel>
                      <DropdownMenuRadioGroup value={model} onValueChange={(value) => setModel(value as ModelId)}>{modelOptions.map((option) => <DropdownMenuRadioItem className="radio-menu-item" value={option.value} key={option.value}><span><strong>{option.label}</strong><small>{option.description}</small></span>{model === option.value ? <Check aria-hidden="true" /> : null}</DropdownMenuRadioItem>)}</DropdownMenuRadioGroup>
                    </DropdownMenuSubContent></DropdownMenuPortal>
                  </DropdownMenuSub>
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger className="submenu-trigger"><span>推理强度</span><strong>{effortLabel(effort)}</strong><ChevronRight aria-hidden="true" /></DropdownMenuSubTrigger>
                    <DropdownMenuPortal><DropdownMenuSubContent className="radix-menu submenu-content" sideOffset={7}>
                      <DropdownMenuRadioGroup value={effort} onValueChange={(value) => setEffort(value as Effort)}>{effortOptions.map((option) => <DropdownMenuRadioItem className="radio-menu-item" value={option.value} key={option.value}><span><strong>{option.label}</strong><small>{option.description}</small></span>{effort === option.value ? <Check aria-hidden="true" /> : null}</DropdownMenuRadioItem>)}</DropdownMenuRadioGroup>
                    </DropdownMenuSubContent></DropdownMenuPortal>
                  </DropdownMenuSub>
                  <DropdownMenuSeparator className="menu-separator" />
                  <DropdownMenuItem className="menu-status" onSelect={(event) => event.preventDefault()}><HardDrive aria-hidden="true" /><span>工作区可写</span><ShieldCheck aria-hidden="true" /></DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <div className="composer-right">
              <span className="context-meter" title="本次任务将使用当前工作区"><span className="meter-ring" />本机</span>
              {isRunning ? <button type="button" className="stop-button" onClick={() => void cancelRun()} aria-label="停止任务"><Square aria-hidden="true" /></button> : <button type="submit" className="send-button" disabled={isStarting || !prompt.trim()} aria-label="发送任务"><ArrowUp aria-hidden="true" /></button>}
            </div>
          </div>
        </form>
        </div>
      </div>
    </main>

    <ExampleDialog example={selectedExample} onClose={() => setSelectedExample(null)} onUse={useExample} restoreFocus={() => exampleTriggerRef.current?.focus()} />
    <KnowledgeDialog open={workspacePanel === "knowledge"} onOpenChange={(open) => setWorkspacePanel(open ? "knowledge" : null)} selected={selectedContexts} onToggle={(id) => toggleSelected(id, setSelectedContexts, selectedContexts)} restoreFocus={() => knowledgeTriggerRef.current?.focus()} />
    <AgentDialog open={workspacePanel === "agent"} onOpenChange={(open) => setWorkspacePanel(open ? "agent" : null)} selectedSkills={selectedSkills} onToggleSkill={(id) => toggleSelected(id, setSelectedSkills, selectedSkills)} customInstructions={customInstructions} onSaveInstructions={(value) => { setCustomInstructions(value); window.localStorage.setItem("openrigor.instructions", value); }} restoreFocus={() => agentTriggerRef.current?.focus()} />

    {error ? <div className="toast" role="alert"><span className="toast-icon"><CircleHelp aria-hidden="true" /></span><span>{error}</span><button type="button" onClick={() => setError(null)} aria-label="关闭"><X aria-hidden="true" /></button></div> : null}
  </div></TooltipProvider>;
}
