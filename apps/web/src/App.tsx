import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactElement } from "react";
import type { RunEvent, RunSnapshot } from "@openrigor/protocol";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Activity,
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
  Database,
  FileCode2,
  FileText,
  FlaskConical,
  Folder,
  Gauge,
  GitCompare,
  Globe2,
  Layers3,
  Library,
  ListTodo,
  Menu,
  MessageSquare,
  Mic,
  MoreHorizontal,
  Paperclip,
  PenLine,
  Plus,
  Radar,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger
} from "./components/ui/dropdown-menu";
import {
  TooltipContent,
  TooltipProvider,
  TooltipRoot,
  TooltipTrigger
} from "./components/ui/tooltip";

const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "http://localhost:8787";

type ConnectionState = "idle" | "connecting" | "open" | "closed";
type TabId = "research" | "services" | "engineering" | "marketing" | "management" | "creative";

interface ExampleTask {
  title: string;
  description: string;
  prompt: string;
  icon: LucideIcon;
  tone: "coral" | "blue" | "green" | "gold";
}

const tabs: Array<{ id: TabId; label: string }> = [
  { id: "research", label: "科研" },
  { id: "services", label: "专业服务" },
  { id: "engineering", label: "工程" },
  { id: "marketing", label: "运营" },
  { id: "management", label: "管理" },
  { id: "creative", label: "创意" }
];

const modelOptions = [
  { value: "auto", label: "Auto", description: "使用 Codex 当前默认模型" },
  { value: "gpt-5.6-sol", label: "GPT-5.6 Sol", description: "复杂推理与代码任务" },
  { value: "gpt-5.6-terra", label: "GPT-5.6 Terra", description: "日常任务与快速执行" }
];

const effortOptions: Array<{ value: "fast" | "balanced" | "deep"; label: string; description: string }> = [
  { value: "fast", label: "快速", description: "更快响应" },
  { value: "balanced", label: "均衡", description: "速度与质量平衡" },
  { value: "deep", label: "极限", description: "更长推理预算" }
];

const examples: Record<TabId, ExampleTask[]> = {
  research: [
    { title: "梳理一组论文", description: "提炼研究脉络、方法差异和可验证的空白。", prompt: "请检索并梳理这个方向近三年的代表性论文，给出方法对比、证据来源和下一步研究机会。", icon: BookOpen, tone: "coral" },
    { title: "准备组会汇报", description: "把材料变成结构清晰、可讲述的演示提纲。", prompt: "请阅读当前工作区的论文材料，整理成一份 15 分钟组会汇报提纲，并标注关键图表。", icon: FileText, tone: "blue" },
    { title: "复核实验结果", description: "检查数据、脚本和结论之间是否一致。", prompt: "请检查项目中的实验脚本和结果，找出可复现性风险，并提出最小修正方案。", icon: FlaskConical, tone: "green" },
    { title: "搭建文献矩阵", description: "按问题、数据、指标和限制组织阅读记录。", prompt: "请为这批文献建立一个可持续更新的阅读矩阵，包含问题、数据、指标、结论和局限。", icon: Database, tone: "gold" }
  ],
  services: [
    { title: "审阅一份合同", description: "标出风险条款、缺失项和需要确认的问题。", prompt: "请审阅工作区中的合同，按风险等级列出条款问题、影响和建议修改。", icon: ShieldCheck, tone: "green" },
    { title: "做一份尽调摘要", description: "把公开材料压缩成有引用的决策备忘录。", prompt: "请对目标公司做一份尽调摘要，区分已验证事实、推断和待确认信息。", icon: Search, tone: "blue" },
    { title: "整理客户访谈", description: "从访谈记录中提取需求、异议和行动项。", prompt: "请整理当前目录的客户访谈记录，提取共性需求、异议、证据和待办事项。", icon: MessageSquare, tone: "coral" },
    { title: "生成服务方案", description: "从目标和约束出发形成可执行的交付计划。", prompt: "请根据这份需求说明生成服务方案、交付里程碑、风险和报价假设。", icon: BriefcaseBusiness, tone: "gold" }
  ],
  engineering: [
    { title: "搭建一个原型", description: "从需求开始，交付可运行的最小版本。", prompt: "请先检查当前项目，然后实现需求中最小可运行的切片，并说明验证步骤。", icon: Code2, tone: "blue" },
    { title: "定位一个 bug", description: "复现问题、找到根因并给出可审阅的修复。", prompt: "请检查项目中最近的错误日志和相关代码，定位根因，提出并验证一个小范围修复。", icon: Bug, tone: "coral" },
    { title: "整理技术债", description: "按影响和成本排列真正值得处理的事项。", prompt: "请审计当前代码库的技术债，按用户影响、风险和工作量排序，给出执行顺序。", icon: ListTodo, tone: "gold" },
    { title: "补齐测试", description: "围绕关键行为补测试并运行验证。", prompt: "请找出当前项目最重要的未覆盖行为，补上聚焦测试并运行相关检查。", icon: CheckCircle2, tone: "green" }
  ],
  marketing: [
    { title: "扫描竞品", description: "比较定位、功能、价格和证据强弱。", prompt: "请对这几个竞品做一份证据驱动的对比，覆盖定位、功能、价格和差异化机会。", icon: Radar, tone: "blue" },
    { title: "设计内容计划", description: "把业务目标拆成可执行的内容节奏。", prompt: "请根据业务目标制定四周内容计划，包含主题、渠道、负责人和衡量指标。", icon: Calendar, tone: "gold" },
    { title: "分析用户反馈", description: "聚合反馈主题，区分信号和噪声。", prompt: "请分析工作区中的用户反馈，聚类主题，标出证据和优先级建议。", icon: MessageSquare, tone: "coral" },
    { title: "准备发布清单", description: "在发布前检查内容、链接和风险。", prompt: "请为这次发布创建一份可执行的检查清单，并指出缺失材料。", icon: ClipboardCheck, tone: "green" }
  ],
  management: [
    { title: "整理经营数据", description: "把分散数据变成可讨论的经营视图。", prompt: "请检查当前经营数据，整理关键指标、异常和需要管理层决定的问题。", icon: Gauge, tone: "blue" },
    { title: "写一份决策备忘录", description: "清晰呈现选项、取舍和建议。", prompt: "请把这些材料整理成一份决策备忘录，明确选项、取舍、风险和建议。", icon: FileText, tone: "coral" },
    { title: "规划季度目标", description: "把方向拆成可追踪的结果和节奏。", prompt: "请根据现有目标制定季度计划，包含结果指标、依赖关系和复盘节奏。", icon: Target, tone: "green" },
    { title: "准备会议材料", description: "让会议聚焦在事实、选择和行动。", prompt: "请把这批材料整理成会议议程、背景摘要、决策问题和会后行动项。", icon: Calendar, tone: "gold" }
  ],
  creative: [
    { title: "构思一个故事", description: "从主题和受众出发形成完整创意。", prompt: "请围绕这个主题提出三个故事方向，并展开最有潜力的一版。", icon: Sparkles, tone: "coral" },
    { title: "制作视觉脚本", description: "把想法转成可拍摄、可制作的镜头表。", prompt: "请把这个创意整理成视觉脚本，包含镜头、旁白、节奏和素材需求。", icon: WandSparkles, tone: "blue" },
    { title: "润色一篇文章", description: "保留观点，改善结构、语气和可读性。", prompt: "请在不改变事实和观点的前提下润色这篇文章，并列出重要改动。", icon: PenLine, tone: "green" },
    { title: "做一套命名方案", description: "给出有理由、可筛选的命名候选。", prompt: "请为这个产品提出一组命名候选，说明含义、语气和潜在风险。", icon: Tags, tone: "gold" }
  ]
};

const eventTypes: RunEvent["type"][] = ["snapshot", "status", "part", "part-delta", "tool", "file", "subagent", "run-finished", "error"];

function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function compactId(value: string): string {
  return value.length > 18 ? `${value.slice(0, 9)}...${value.slice(-6)}` : value;
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 11) return "早上好，Jeff";
  if (hour < 18) return "下午好，Jeff";
  return "晚上好，Jeff";
}

function statusLabel(status: RunSnapshot["status"]): string {
  const labels: Record<RunSnapshot["status"], string> = {
    queued: "排队中", running: "执行中", waiting_tool: "调用工具", waiting_user: "等待确认",
    cancelling: "正在停止", completed: "已完成", failed: "失败", cancelled: "已停止"
  };
  return labels[status];
}

function phaseLabel(phase: Extract<RunEvent, { type: "tool" }>["tool"]["phase"]): string {
  if (phase === "succeeded") return "完成";
  if (phase === "failed") return "失败";
  if (phase === "running") return "运行中";
  return "准备中";
}

function eventText(event: RunEvent): string {
  switch (event.type) {
    case "status": return event.currentStep ?? statusLabel(event.status);
    case "tool": return `${event.tool.name} ${phaseLabel(event.tool.phase)}`;
    case "file": return `更新 ${event.file.name}`;
    case "subagent": return `${event.subagent.label} ${statusLabel(event.subagent.status)}`;
    case "run-finished": return event.status === "completed" ? "任务完成" : event.status === "cancelled" ? "任务停止" : "任务失败";
    case "error": return event.message;
    default: return "";
  }
}

function toolIcon(name: string): LucideIcon {
  if (name.includes("command")) return Terminal;
  if (name.includes("file")) return FileCode2;
  if (name.includes("search")) return Globe2;
  if (name.includes("subagent")) return Bot;
  return Zap;
}

function eventIcon(event: RunEvent): LucideIcon {
  if (event.type === "tool") return toolIcon(event.tool.name);
  if (event.type === "file") return FileText;
  if (event.type === "error") return X;
  if (event.type === "run-finished") return CheckCircle2;
  return Activity;
}

function MarkdownText({ text }: { text: string }): ReactElement {
  return <div className="markdown"><ReactMarkdown
    remarkPlugins={[remarkGfm]}
    components={{
      a: ({ ...props }) => <a {...props} target="_blank" rel="noreferrer" />
    }}
  >{text}</ReactMarkdown></div>;
}

function BrandMark({ small = false }: { small?: boolean }): ReactElement {
  return <span className={small ? "brand-mark brand-mark-small" : "brand-mark"}><Command aria-hidden="true" /></span>;
}

function IconTooltip({ label, children }: { label: string; children: ReactElement }): ReactElement {
  return <TooltipRoot>
    <TooltipTrigger asChild>{children}</TooltipTrigger>
    <TooltipContent className="radix-tooltip" sideOffset={7}>{label}</TooltipContent>
  </TooltipRoot>;
}

function RunInspector({ snapshot, events }: { snapshot: RunSnapshot; events: RunEvent[] }): ReactElement {
  const activity = events.filter((event) => eventText(event)).slice(-6).reverse();
  return <aside className="run-inspector" aria-label="任务详情">
    <div className="inspector-heading"><span>任务详情</span><button type="button" className="icon-control" disabled title="更多任务操作尚未启用" aria-label="更多任务操作"><MoreHorizontal aria-hidden="true" /></button></div>
    <section className="inspector-section">
      <div className="progress-heading"><span className={`status-indicator status-${snapshot.status}`} /><strong>{statusLabel(snapshot.status)}</strong><span>{snapshot.progress}%</span></div>
      <div className="progress-track" aria-label={`任务进度 ${snapshot.progress}%`}><span style={{ width: `${snapshot.progress}%` }} /></div>
      <p className="inspector-step">{snapshot.currentStep ?? "正在准备任务"}</p>
    </section>
    <section className="inspector-section detail-list">
      <div><span>运行方式</span><strong>本机 Codex</strong></div>
      <div><span>模型</span><strong>{snapshot.model === "auto" ? "Auto" : snapshot.model}</strong></div>
      <div><span>推理强度</span><strong>{snapshot.effort === "deep" ? "极限" : snapshot.effort === "fast" ? "快速" : "均衡"}</strong></div>
      <div><span>沙箱</span><strong>Workspace write</strong></div>
      <div><span>Run ID</span><code>{compactId(snapshot.runId)}</code></div>
    </section>
    <section className="inspector-section activity-section">
      <div className="section-heading"><span>实时动态</span><Activity aria-hidden="true" /></div>
      {activity.length ? <div className="activity-list">{activity.map((event) => {
        const Icon = eventIcon(event);
        return <div className="activity-item" key={event.eventId}><span className="activity-icon"><Icon aria-hidden="true" /></span><span><strong>{eventText(event)}</strong><small>{formatTime(event.ts)}</small></span></div>;
      })}</div> : <p className="activity-empty">事件将在任务开始后出现</p>}
    </section>
  </aside>;
}

export function App(): ReactElement {
  const [prompt, setPrompt] = useState("");
  const [activeTab, setActiveTab] = useState<TabId>("research");
  const [snapshot, setSnapshot] = useState<RunSnapshot | null>(null);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [connection, setConnection] = useState<ConnectionState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"standard" | "cluster">("standard");
  const [model, setModel] = useState("auto");
  const [effort, setEffort] = useState<"fast" | "balanced" | "deep">("balanced");
  const [openMenu, setOpenMenu] = useState<"mode" | "model" | "effort" | null>(null);
  const [reasoningOpen, setReasoningOpen] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const eventSource = useRef<EventSource | null>(null);
  const timelineEnd = useRef<HTMLDivElement | null>(null);

  useEffect(() => () => eventSource.current?.close(), []);
  useEffect(() => { timelineEnd.current?.scrollIntoView({ behavior: "smooth" }); }, [events.length]);

  const answer = useMemo(() => {
    const parts = new Map<string, string>();
    for (const event of events) {
      if (event.type === "part-delta" && event.kind === "text" && !event.partId.startsWith("tool:")) parts.set(event.partId, `${parts.get(event.partId) ?? ""}${event.delta}`);
      if (event.type === "part" && event.part.kind === "text" && !event.part.partId.startsWith("diff:") && !parts.has(event.part.partId)) parts.set(event.part.partId, event.part.text);
    }
    return [...parts.values()].join("\n\n");
  }, [events]);
  const reasoning = useMemo(() => {
    const parts = new Map<string, string>();
    for (const event of events) {
      if (event.type === "part-delta" && event.kind === "reasoning") parts.set(event.partId, `${parts.get(event.partId) ?? ""}${event.delta}`);
      if (event.type === "part" && event.part.kind === "reasoning" && !parts.has(event.part.partId)) parts.set(event.part.partId, event.part.text);
    }
    return [...parts.values()].join("\n\n");
  }, [events]);
  const tools = useMemo(() => {
    const projected = new Map<string, Extract<RunEvent, { type: "tool" }>>();
    for (const event of events) if (event.type === "tool") projected.set(event.tool.callId, event);
    return [...projected.values()];
  }, [events]);
  const toolOutput = useMemo(() => {
    const output = new Map<string, string>();
    for (const event of events) if (event.type === "part-delta" && event.partId.startsWith("tool:")) {
      const callId = event.partId.slice(5);
      output.set(callId, `${output.get(callId) ?? ""}${event.delta}`);
    }
    return output;
  }, [events]);
  const diffs = useMemo(() => events.filter((event): event is Extract<RunEvent, { type: "part" }> => event.type === "part" && event.part.partId.startsWith("diff:")), [events]);
  const files = useMemo(() => events.filter((event): event is Extract<RunEvent, { type: "file" }> => event.type === "file"), [events]);
  const isRunning = Boolean(snapshot && !["completed", "failed", "cancelled"].includes(snapshot.status));

  function closeStream(): void {
    eventSource.current?.close();
    eventSource.current = null;
    setConnection("closed");
  }

  function resetWorkspace(): void {
    setSnapshot(null);
    setEvents([]);
    setPrompt("");
    setOpenMenu(null);
    setReasoningOpen(true);
    setSidebarOpen(false);
    closeStream();
  }

  function consumeEvent(event: RunEvent): void {
    setEvents((previous) => previous.some((item) => item.eventId === event.eventId) ? previous : [...previous, event]);
    if (event.type === "snapshot") setSnapshot(event.snapshot);
    if (event.type === "status") setSnapshot((previous) => {
      if (!previous) return previous;
      const next: RunSnapshot = { ...previous, status: event.status, progress: event.progress ?? previous.progress, updatedAt: event.ts };
      if (event.currentStep !== undefined) next.currentStep = event.currentStep;
      return next;
    });
    if (event.type === "run-finished") {
      setSnapshot((previous) => previous ? { ...previous, status: event.status, progress: event.status === "completed" ? 100 : previous.progress, currentStep: event.status === "completed" ? "已完成" : event.status === "cancelled" ? "已停止" : "执行失败", updatedAt: event.ts } : previous);
      closeStream();
    }
    if (event.type === "error") setError(event.message);
  }

  function subscribe(runId: string): void {
    closeStream();
    setConnection("connecting");
    const source = new EventSource(`${apiBase}/api/runs/${runId}/events`);
    eventSource.current = source;
    source.onopen = () => setConnection("open");
    source.onerror = () => setConnection("closed");
    for (const type of eventTypes) source.addEventListener(type, (raw) => {
      try { consumeEvent(JSON.parse((raw as MessageEvent<string>).data) as RunEvent); }
      catch { setError("服务返回了无法识别的事件"); }
    });
  }

  async function startRun(nextPrompt = prompt): Promise<void> {
    const cleanPrompt = nextPrompt.trim();
    if (!cleanPrompt || isRunning) return;
    setError(null);
    closeStream();
    setSnapshot(null);
    setEvents([]);
    setReasoningOpen(true);
    setPrompt(cleanPrompt);
    try {
      const response = await fetch(`${apiBase}/api/runs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: cleanPrompt, model, mode, effort }) });
      const body = await response.json() as { runId?: string; error?: string };
      if (!response.ok || !body.runId) throw new Error(body.error ?? "无法启动任务");
      subscribe(body.runId);
      setPrompt("");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "无法启动任务"); }
  }

  async function cancelRun(): Promise<void> {
    if (!snapshot || !isRunning) return;
    try { await fetch(`${apiBase}/api/runs/${snapshot.runId}/cancel`, { method: "POST" }); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "无法停止任务"); }
  }

  function submit(event: FormEvent): void {
    event.preventDefault();
    void startRun();
  }

  const activeExamples = examples[activeTab];
  const connectionLabel = connection === "open" ? "Live" : connection === "connecting" ? "连接中" : "Local";

  return <TooltipProvider><div className="app-shell">
    {sidebarOpen ? <button type="button" className="sidebar-scrim" onClick={() => setSidebarOpen(false)} aria-label="关闭导航" /> : null}
    <aside className={sidebarOpen ? "sidebar sidebar-open" : "sidebar"} aria-label="主导航">
       <div className="brand-row"><div className="brand"><BrandMark /><span><strong>OpenRigor</strong><small>Agent workspace</small></span></div><IconTooltip label="关闭导航"><button type="button" className="icon-control sidebar-close" onClick={() => setSidebarOpen(false)} aria-label="关闭导航"><X aria-hidden="true" /></button></IconTooltip></div>
      <button className="workspace-switcher" type="button" disabled title="当前仅支持一个本地工作区"><span className="workspace-icon"><Folder aria-hidden="true" /></span><span><strong>OpenRigor</strong><small>E:\\0_Code\\OpenRigor</small></span><ChevronDown aria-hidden="true" /></button>
      <button className="new-task" type="button" onClick={resetWorkspace}><Plus aria-hidden="true" /><span>新任务</span><kbd>N</kbd></button>

      <nav className="nav-list" aria-label="产品导航">
        <button type="button" className="nav-item active"><MessageSquare aria-hidden="true" /><span>任务</span></button>
        <button type="button" className="nav-item" disabled title="知识库将在后续版本开放"><Library aria-hidden="true" /><span>知识库</span></button>
        <button type="button" className="nav-item" disabled title="技能市场将在后续版本开放"><Layers3 aria-hidden="true" /><span>技能</span></button>
        <button type="button" className="nav-item" disabled title="工作区浏览将在后续版本开放"><Database aria-hidden="true" /><span>工作区</span></button>
      </nav>

      <section className="sidebar-section">
        <div className="sidebar-label"><span>项目</span><button type="button" className="icon-control" disabled aria-label="添加项目" title="项目管理尚未启用"><Plus aria-hidden="true" /></button></div>
        <button type="button" className="project-item"><span className="project-monogram">OR</span><span><strong>OpenRigor</strong><small>本地项目</small></span><ChevronRight aria-hidden="true" /></button>
      </section>

      <section className="sidebar-section recent-section">
        <div className="sidebar-label"><span>最近任务</span><button type="button" className="icon-control" disabled aria-label="更多历史任务"><MoreHorizontal aria-hidden="true" /></button></div>
        {snapshot ? <button type="button" className="recent-item"><span className={`recent-status status-${snapshot.status}`} /><span><strong>{snapshot.prompt}</strong><small>{statusLabel(snapshot.status)} · {formatTime(snapshot.updatedAt)}</small></span></button> : <div className="history-empty"><Clock3 aria-hidden="true" /><span>完成的任务会出现在这里</span></div>}
      </section>

      <div className="sidebar-bottom">
        <div className="runtime-row"><span className="runtime-pulse" /><span><strong>Codex runtime</strong><small>本机运行</small></span><ShieldCheck aria-hidden="true" /></div>
        <button type="button" className="profile" disabled><span className="avatar">J</span><span><strong>Jeff</strong><small>Owner</small></span><Settings aria-hidden="true" /></button>
      </div>
    </aside>

    <main className="main-area">
      <header className="main-header">
         <div className="header-left"><IconTooltip label="打开导航"><button type="button" className="icon-control mobile-menu" onClick={() => setSidebarOpen(true)} aria-label="打开导航"><Menu aria-hidden="true" /></button></IconTooltip><BrandMark small /><div className="header-title"><small>{snapshot ? "TASK" : "WORKSPACE"}</small><strong>{snapshot ? (snapshot.prompt.length > 54 ? `${snapshot.prompt.slice(0, 54)}...` : snapshot.prompt) : "New task"}</strong></div></div>
        <div className="header-actions">
          <button type="button" className="header-search" disabled title="全局搜索尚未启用"><Search aria-hidden="true" /><span>搜索</span><kbd>⌘ K</kbd></button>
          <span className={`connection connection-${connection}`}><span className="status-dot" />{connectionLabel}</span>
          <button type="button" className="icon-control" disabled title="更多选项尚未启用" aria-label="更多选项"><MoreHorizontal aria-hidden="true" /></button>
        </div>
      </header>

      <div className={snapshot ? "main-body conversation-mode" : "main-body"}>
        {!snapshot ? <section className="launch-view">
          <div className="launch-header"><div className="eyebrow"><Sparkles aria-hidden="true" /><span>LOCAL CODEX WORKSPACE</span></div><h1>{greeting()}</h1><p>把目标交给我，我会读取项目、调用工具，并把执行过程完整呈现出来。</p></div>
          <div className="launch-meta" aria-label="运行环境"><span><ShieldCheck aria-hidden="true" />Workspace write</span><span><Bot aria-hidden="true" />Codex app-server</span><span><Globe2 aria-hidden="true" />仅本机访问</span></div>
          <div className="category-tabs" role="tablist" aria-label="任务分类">{tabs.map((tab) => <button key={tab.id} type="button" role="tab" aria-selected={activeTab === tab.id} className={activeTab === tab.id ? "category-tab selected" : "category-tab"} onClick={() => setActiveTab(tab.id)}>{tab.label}</button>)}</div>
          <div className="example-grid">{activeExamples.map((example) => {
            const Icon = example.icon;
            return <button type="button" className="example-card" key={example.title} onClick={() => void startRun(example.prompt)}><span className={`example-icon tone-${example.tone}`}><Icon aria-hidden="true" /></span><span className="example-body"><strong>{example.title}</strong><span>{example.description}</span></span><ChevronRight className="example-arrow" aria-hidden="true" /></button>;
          })}</div>
        </section> : <section className="conversation-view">
          <div className="conversation-scroll">
            <article className="message-row user-message"><div className="message-avatar user-avatar"><User aria-hidden="true" /></div><div className="message-content"><div className="message-meta"><strong>Jeff</strong><span>{formatTime(snapshot.createdAt)}</span></div><p>{snapshot.prompt}</p></div></article>
            <article className="message-row agent-message"><div className="message-avatar agent-avatar"><Command aria-hidden="true" /></div><div className="message-content agent-stream"><div className="message-meta agent-heading"><span><strong>OpenRigor</strong><span className={`run-status status-${snapshot.status}`}><span />{statusLabel(snapshot.status)}</span></span><code>{compactId(snapshot.runId)}</code></div>
              {reasoning ? <Collapsible className="reasoning-block" open={reasoningOpen} onOpenChange={setReasoningOpen}>
                <CollapsibleTrigger asChild>
                  <button type="button" className="reasoning-trigger">
                    <span className="summary-icon"><BrainCircuit aria-hidden="true" /></span>
                    <span><strong>Reasoning</strong><small>{snapshot.currentStep ?? "分析任务与工作区"}</small></span>
                    <span className="summary-status">{isRunning ? "处理中" : "已完成"}</span>
                    <ChevronDown className="summary-chevron" aria-hidden="true" />
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent className="reasoning-copy">{reasoning}</CollapsibleContent>
              </Collapsible> : isRunning ? <div className="thinking-line"><span className="thinking-mark"><span /><span /><span /></span><span>{snapshot.currentStep ?? "正在分析任务"}</span></div> : null}
              {tools.length ? <div className="tool-stack">{tools.map((event) => {
                const ToolIcon = toolIcon(event.tool.name);
                const output = event.tool.outputSummary ?? toolOutput.get(event.tool.callId);
                return <div className="tool-card" key={event.tool.callId}><div className="tool-card-top"><span className="tool-symbol"><ToolIcon aria-hidden="true" /></span><span className="tool-title"><strong>{event.tool.name}</strong>{event.tool.inputSummary ? <code>{event.tool.inputSummary}</code> : null}</span><span className={`tool-phase phase-${event.tool.phase}`}><span />{phaseLabel(event.tool.phase)}</span></div>{output ? <details className="command-output"><summary><Terminal aria-hidden="true" /><span>查看输出</span><ChevronDown aria-hidden="true" /></summary><pre>{output}</pre></details> : null}</div>;
              })}</div> : null}
              {files.length ? <div className="file-stack"><div className="stack-label"><FileText aria-hidden="true" /><span>文件</span></div>{files.map((event) => <div className="file-card" key={event.eventId}><span className="file-symbol"><FileCode2 aria-hidden="true" /></span><span><strong>{event.file.name}</strong><small>{event.file.mimeType} · 修订 {event.file.revision}</small></span><span className="file-state">已记录</span></div>)}</div> : null}
              {diffs.length ? <details className="diff-block"><summary><span><GitCompare aria-hidden="true" /><strong>文件变更</strong></span><span>{diffs.length} 个更新</span></summary><pre>{diffs.at(-1)?.part.text}</pre></details> : null}
              {answer ? <div className="answer-block"><MarkdownText text={answer} /></div> : null}
              {snapshot.status === "completed" ? <div className="completion-line"><span className="completion-check"><Check aria-hidden="true" /></span><span><strong>任务已完成</strong><small>{formatTime(snapshot.updatedAt)}</small></span></div> : null}
            </div></article>
            <div ref={timelineEnd} />
          </div>
          <RunInspector snapshot={snapshot} events={events} />
        </section>}
      </div>

      <div className="composer-region">
        <form className={snapshot ? "composer composer-in-conversation" : "composer"} onSubmit={submit}>
          <div className="composer-input-row"><textarea value={prompt} disabled={isRunning} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void startRun(); } }} placeholder={isRunning ? "任务正在执行，可先停止当前任务" : "描述你想完成的任务..."} rows={snapshot ? 2 : 3} aria-label="任务描述" />{isRunning ? <button type="button" className="stop-button" onClick={() => void cancelRun()} title="停止任务"><Square aria-hidden="true" /><span>停止</span></button> : <button type="submit" className="send-button" disabled={!prompt.trim()} title="发送任务" aria-label="发送任务"><ArrowUp aria-hidden="true" /></button>}</div>
          <div className="composer-toolbar"><div className="composer-left"><button type="button" className="icon-tool" disabled title="附件将在后续版本开放" aria-label="添加附件"><Paperclip aria-hidden="true" /></button><span className="toolbar-separator" />
            <DropdownMenu open={openMenu === "mode"} onOpenChange={(open) => setOpenMenu(open ? "mode" : null)}>
              <DropdownMenuTrigger asChild><button type="button" className={openMenu === "mode" ? "tool-button menu-open" : "tool-button"}><Bot aria-hidden="true" /><span>{mode === "cluster" ? "Agent 集群" : "标准 Agent"}</span><ChevronDown aria-hidden="true" /></button></DropdownMenuTrigger>
              <DropdownMenuContent className="menu-popover radix-menu" align="start" side="top" sideOffset={10}>
                <DropdownMenuLabel className="menu-caption">运行方式</DropdownMenuLabel>
                <DropdownMenuItem className="menu-option" onSelect={() => { setMode("standard"); setOpenMenu(null); }}><span><strong>标准 Agent</strong><small>单线程执行，适合当前版本</small></span>{mode === "standard" ? <Check aria-hidden="true" /> : null}</DropdownMenuItem>
                <DropdownMenuItem className="menu-option" disabled><span><strong>Agent 集群</strong><small>多 Agent 编排暂未开放</small></span></DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu open={openMenu === "model"} onOpenChange={(open) => setOpenMenu(open ? "model" : null)}>
              <DropdownMenuTrigger asChild><button type="button" className={openMenu === "model" ? "tool-button menu-open" : "tool-button"}><Zap aria-hidden="true" /><span>{model === "auto" ? "Auto" : model.replace("gpt-5.6-", "GPT ")}</span><ChevronDown aria-hidden="true" /></button></DropdownMenuTrigger>
              <DropdownMenuContent className="menu-popover radix-menu" align="start" side="top" sideOffset={10}>
                <DropdownMenuLabel className="menu-caption">模型</DropdownMenuLabel>
                {modelOptions.map((option) => <DropdownMenuItem className="menu-option" key={option.value} onSelect={() => { setModel(option.value); setOpenMenu(null); }}><span><strong>{option.label}</strong><small>{option.description}</small></span>{model === option.value ? <Check aria-hidden="true" /> : null}</DropdownMenuItem>)}
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu open={openMenu === "effort"} onOpenChange={(open) => setOpenMenu(open ? "effort" : null)}>
              <DropdownMenuTrigger asChild><button type="button" className={openMenu === "effort" ? "tool-button menu-open" : "tool-button"}><Gauge aria-hidden="true" /><span>{effort === "deep" ? "极限" : effort === "fast" ? "快速" : "均衡"}</span><ChevronDown aria-hidden="true" /></button></DropdownMenuTrigger>
              <DropdownMenuContent className="menu-popover compact-menu radix-menu" align="start" side="top" sideOffset={10}>
                <DropdownMenuLabel className="menu-caption">推理强度</DropdownMenuLabel>
                {effortOptions.map((option) => <DropdownMenuItem className="menu-option" key={option.value} onSelect={() => { setEffort(option.value); setOpenMenu(null); }}><span><strong>{option.label}</strong><small>{option.description}</small></span>{effort === option.value ? <Check aria-hidden="true" /> : null}</DropdownMenuItem>)}
              </DropdownMenuContent>
            </DropdownMenu>
          </div><div className="composer-right"><span className="composer-runtime"><span />workspace-write</span><button type="button" className="icon-tool" disabled title="语音输入将在后续版本开放" aria-label="语音输入"><Mic aria-hidden="true" /></button></div></div>
        </form>
        <div className="composer-footnote"><ShieldCheck aria-hidden="true" /><span>任务由本机 Codex 执行，登录凭据不会发送到浏览器</span></div>
      </div>
    </main>

    {error ? <div className="toast" role="alert"><span className="toast-icon"><CircleHelp aria-hidden="true" /></span><span>{error}</span><button type="button" onClick={() => setError(null)} aria-label="关闭"><X aria-hidden="true" /></button></div> : null}
  </div></TooltipProvider>;
}
