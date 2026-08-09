import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactElement } from "react";
import type { RunEvent, RunSnapshot } from "@openrigor/protocol";

const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "http://localhost:8787";

type ConnectionState = "idle" | "connecting" | "open" | "closed";
type TabId = "research" | "services" | "engineering" | "marketing" | "management" | "creative";

interface ExampleTask {
  title: string;
  description: string;
  prompt: string;
  icon: string;
}

const tabs: Array<{ id: TabId; label: string }> = [
  { id: "research", label: "科研学术" },
  { id: "services", label: "专业服务" },
  { id: "engineering", label: "工程开发" },
  { id: "marketing", label: "运营市场" },
  { id: "management", label: "经营管理" },
  { id: "creative", label: "创意创作" }
];

const examples: Record<TabId, ExampleTask[]> = {
  research: [
    { title: "梳理一组论文", description: "提炼研究脉络、方法差异和可验证的空白。", prompt: "请检索并梳理这个方向近三年的代表性论文，给出方法对比、证据来源和下一步研究机会。", icon: "◇" },
    { title: "准备组会汇报", description: "把材料变成结构清晰、可讲述的演示提纲。", prompt: "请阅读当前工作区的论文材料，整理成一份 15 分钟组会汇报提纲，并标注关键图表。", icon: "▤" },
    { title: "复核实验结果", description: "检查数据、脚本和结论之间是否一致。", prompt: "请检查项目中的实验脚本和结果，找出可复现性风险，并提出最小修正方案。", icon: "⌁" },
    { title: "搭建文献矩阵", description: "按问题、数据、指标和限制组织阅读记录。", prompt: "请为这批文献建立一个可持续更新的阅读矩阵，包含问题、数据、指标、结论和局限。", icon: "▦" }
  ],
  services: [
    { title: "审阅一份合同", description: "标出风险条款、缺失项和需要确认的问题。", prompt: "请审阅工作区中的合同，按风险等级列出条款问题、影响和建议修改。", icon: "§" },
    { title: "做一份尽调摘要", description: "把公开材料压缩成有引用的决策备忘录。", prompt: "请对目标公司做一份尽调摘要，区分已验证事实、推断和待确认信息。", icon: "◎" },
    { title: "整理客户访谈", description: "从访谈记录中提取需求、异议和行动项。", prompt: "请整理当前目录的客户访谈记录，提取共性需求、异议、证据和待办事项。", icon: "◫" },
    { title: "生成服务方案", description: "从目标和约束出发形成可执行的交付计划。", prompt: "请根据这份需求说明生成服务方案、交付里程碑、风险和报价假设。", icon: "↗" }
  ],
  engineering: [
    { title: "搭建一个原型", description: "从需求开始，交付可运行的最小版本。", prompt: "请先检查当前项目，然后实现需求中最小可运行的切片，并说明验证步骤。", icon: "⌘" },
    { title: "定位一个 bug", description: "复现问题、找到根因并给出可审阅的修复。", prompt: "请检查项目中最近的错误日志和相关代码，定位根因，提出并验证一个小范围修复。", icon: "⊘" },
    { title: "整理技术债", description: "按影响和成本排列真正值得处理的事项。", prompt: "请审计当前代码库的技术债，按用户影响、风险和工作量排序，给出执行顺序。", icon: "≡" },
    { title: "补齐测试", description: "围绕关键行为补测试并运行验证。", prompt: "请找出当前项目最重要的未覆盖行为，补上聚焦测试并运行相关检查。", icon: "✓" }
  ],
  marketing: [
    { title: "扫描竞品", description: "比较定位、功能、价格和证据强弱。", prompt: "请对这几个竞品做一份证据驱动的对比，覆盖定位、功能、价格和差异化机会。", icon: "⌕" },
    { title: "设计内容计划", description: "把业务目标拆成可执行的内容节奏。", prompt: "请根据业务目标制定四周内容计划，包含主题、渠道、负责人和衡量指标。", icon: "▥" },
    { title: "分析用户反馈", description: "聚合反馈主题，区分信号和噪声。", prompt: "请分析工作区中的用户反馈，聚类主题，标出证据和优先级建议。", icon: "◌" },
    { title: "准备发布清单", description: "在发布前检查内容、链接和风险。", prompt: "请为这次发布创建一份可执行的检查清单，并指出缺失材料。", icon: "□" }
  ],
  management: [
    { title: "整理经营数据", description: "把分散数据变成可讨论的经营视图。", prompt: "请检查当前经营数据，整理关键指标、异常和需要管理层决定的问题。", icon: "▤" },
    { title: "写一份决策备忘录", description: "清晰呈现选项、取舍和建议。", prompt: "请把这些材料整理成一份决策备忘录，明确选项、取舍、风险和建议。", icon: "✦" },
    { title: "规划季度目标", description: "把方向拆成可追踪的结果和节奏。", prompt: "请根据现有目标制定季度计划，包含结果指标、依赖关系和复盘节奏。", icon: "◷" },
    { title: "准备会议材料", description: "让会议聚焦在事实、选择和行动。", prompt: "请把这批材料整理成会议议程、背景摘要、决策问题和会后行动项。", icon: "▣" }
  ],
  creative: [
    { title: "构思一个故事", description: "从主题和受众出发形成完整创意。", prompt: "请围绕这个主题提出三个故事方向，并展开最有潜力的一版。", icon: "✧" },
    { title: "制作视觉脚本", description: "把想法转成可拍摄、可制作的镜头表。", prompt: "请把这个创意整理成视觉脚本，包含镜头、旁白、节奏和素材需求。", icon: "◈" },
    { title: "润色一篇文章", description: "保留观点，改善结构、语气和可读性。", prompt: "请在不改变事实和观点的前提下润色这篇文章，并列出重要改动。", icon: "A" },
    { title: "做一套命名方案", description: "给出有理由、可筛选的命名候选。", prompt: "请为这个产品提出一组命名候选，说明含义、语气和潜在风险。", icon: "#" }
  ]
};

const eventTypes: RunEvent["type"][] = ["snapshot", "status", "part", "part-delta", "tool", "file", "subagent", "run-finished", "error"];

function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function compactId(value: string): string {
  return value.length > 18 ? `${value.slice(0, 9)}…${value.slice(-6)}` : value;
}

function statusLabel(status: RunSnapshot["status"]): string {
  const labels: Record<RunSnapshot["status"], string> = {
    queued: "排队中", running: "执行中", waiting_tool: "等待工具", waiting_user: "等待确认",
    cancelling: "正在停止", completed: "已完成", failed: "失败", cancelled: "已停止"
  };
  return labels[status];
}

function eventText(event: RunEvent): string {
  switch (event.type) {
    case "status": return `${statusLabel(event.status)}${event.currentStep ? ` · ${event.currentStep}` : ""}`;
    case "tool": return `${event.tool.name} · ${event.tool.phase}`;
    case "file": return `${event.file.name} · ${event.file.revision ? `修订 ${event.file.revision}` : "文件"}`;
    case "subagent": return `${event.subagent.label} · ${statusLabel(event.subagent.status)}`;
    case "run-finished": return event.status === "completed" ? "任务已完成" : event.status === "cancelled" ? "任务已停止" : "任务失败";
    case "error": return `${event.code}: ${event.message}`;
    default: return "";
  }
}

function MarkdownText({ text }: { text: string }): ReactElement {
  const blocks = text.split(/```/g);
  return <div className="markdown">{blocks.map((block, index) => index % 2 === 1 ? <pre key={index}><code>{block.replace(/^\w+\n/, "")}</code></pre> : block.split(/\n\n+/g).map((paragraph, partIndex) => paragraph.trim() ? <p key={`${index}-${partIndex}`}>{paragraph}</p> : null))}</div>;
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
  const eventSource = useRef<EventSource | null>(null);
  const timelineEnd = useRef<HTMLDivElement | null>(null);

  useEffect(() => () => eventSource.current?.close(), []);
  useEffect(() => { timelineEnd.current?.scrollIntoView({ behavior: "smooth" }); }, [events.length]);

  const answer = useMemo(() => {
    const parts = new Map<string, string>();
    for (const event of events) {
      if (event.type === "part-delta" && event.kind === "text" && !event.partId.startsWith("tool:")) {
        parts.set(event.partId, `${parts.get(event.partId) ?? ""}${event.delta}`);
      }
      if (event.type === "part" && event.part.kind === "text" && !event.part.partId.startsWith("diff:") && !parts.has(event.part.partId)) {
        parts.set(event.part.partId, event.part.text);
      }
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
    if (!cleanPrompt) return;
    setError(null); closeStream(); setSnapshot(null); setEvents([]); setPrompt(cleanPrompt);
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

  function submit(event: FormEvent): void { event.preventDefault(); void startRun(); }

  const activeExamples = examples[activeTab];

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="主导航">
        <div className="brand"><span className="brand-mark">O</span><span>OpenRigor</span></div>
        <button className="new-task" type="button" onClick={() => { setSnapshot(null); setEvents([]); setPrompt(""); closeStream(); }}><span className="button-glyph">+</span>新任务</button>
        <nav className="nav-list">
          <button type="button" className="nav-item active"><span className="nav-icon">▧</span>任务</button>
          <button type="button" className="nav-item"><span className="nav-icon">◫</span>知识库</button>
          <button type="button" className="nav-item"><span className="nav-icon">◇</span>技能</button>
          <button type="button" className="nav-item"><span className="nav-icon">▣</span>工作区</button>
          <button type="button" className="nav-item"><span className="nav-icon">⌕</span>搜索</button>
        </nav>
        <div className="sidebar-section"><div className="sidebar-label">项目</div><button type="button" className="project-item"><span className="project-dot" />OpenRigor</button><button type="button" className="project-add"><span>+</span> 新建项目</button></div>
        <div className="sidebar-section history-section"><div className="sidebar-label"><span>最近任务</span><button type="button" className="tiny-action" disabled aria-label="历史任务尚未启用">···</button></div><div className="history-empty">完成的任务会出现在这里</div></div>
        <div className="sidebar-bottom"><button type="button" className="nav-item"><span className="nav-icon">?</span>帮助</button><button type="button" className="profile"><span className="avatar">J</span><span className="profile-copy"><strong>Jeff</strong><small>本地工作区</small></span><span className="profile-more">···</span></button></div>
      </aside>

      <main className="main-area">
        <header className="main-header"><div className="header-title"><span className="mobile-brand">O</span><span>{snapshot ? (snapshot.prompt.length > 40 ? `${snapshot.prompt.slice(0, 40)}…` : snapshot.prompt) : "新任务"}</span></div><div className="header-actions"><span className={`connection connection-${connection}`}><span className="status-dot" />{connection === "open" ? "已连接" : connection === "connecting" ? "连接中" : "本地"}</span><span className="credits"><span className="credits-dot" />本地模式</span><button type="button" className="icon-button" aria-label="更多选项">···</button></div></header>

        {!snapshot ? <section className="launch-view">
          <div className="greeting"><p className="greeting-kicker">OPENRIGOR WORKSPACE</p><h1>晚上好，Jeff</h1><p>告诉我你想完成什么，我会在你的工作区里一步步执行。</p></div>
          <div className="category-tabs" role="tablist" aria-label="任务分类">{tabs.map((tab) => <button key={tab.id} type="button" role="tab" aria-selected={activeTab === tab.id} className={activeTab === tab.id ? "category-tab selected" : "category-tab"} onClick={() => setActiveTab(tab.id)}>{tab.label}</button>)}</div>
          <div className="example-grid">{activeExamples.map((example) => <button type="button" className="example-card" key={example.title} onClick={() => { setPrompt(example.prompt); void startRun(example.prompt); }}><span className="example-icon">{example.icon}</span><span className="example-body"><strong>{example.title}</strong><span>{example.description}</span></span><span className="example-arrow">↗</span></button>)}</div>
        </section> : <section className="conversation-view">
          <div className="conversation-scroll">
            <div className="user-message"><div className="avatar small">J</div><div><div className="message-label">你</div><p>{snapshot.prompt}</p></div></div>
            <div className="agent-stream"><div className="agent-heading"><span className="agent-orb">O</span><div><strong>OpenRigor Agent</strong><span className={`run-status status-${snapshot.status}`}>{statusLabel(snapshot.status)}</span></div><span className="run-seq">{compactId(snapshot.runId)}</span></div>
              {reasoning ? <details className="reasoning-block" open={isRunning}><summary><span className="summary-chevron">⌄</span><span>思考过程</span><span className="summary-status">{isRunning ? "处理中" : "已完成"}</span></summary><div className="reasoning-copy">{reasoning}</div></details> : isRunning ? <div className="thinking-line"><span className="thinking-dots"><i /><i /><i /></span><span>{snapshot.currentStep ?? "正在分析任务"}</span></div> : null}
              {tools.length ? <div className="tool-stack">{tools.map((event) => <div className="tool-card" key={event.tool.callId}><div className="tool-card-top"><span className="tool-symbol">⌁</span><strong>{event.tool.name}</strong><span className={`tool-phase phase-${event.tool.phase}`}>{event.tool.phase === "succeeded" ? "完成" : event.tool.phase === "failed" ? "失败" : event.tool.phase === "running" ? "运行中" : "准备中"}</span></div>{event.tool.inputSummary ? <div className="tool-detail"><span>输入</span><code>{event.tool.inputSummary}</code></div> : null}{event.tool.outputSummary || toolOutput.get(event.tool.callId) ? <details className="command-output"><summary>查看输出</summary><pre>{event.tool.outputSummary ?? toolOutput.get(event.tool.callId)}</pre></details> : null}</div>)}</div> : null}
              {files.length ? <div className="file-stack">{files.map((event) => <div className="file-card" key={event.eventId}><span className="file-symbol">□</span><span><strong>{event.file.name}</strong><small>{event.file.mimeType} · 修订 {event.file.revision}</small></span><span className="file-action">查看</span></div>)}</div> : null}
              {diffs.length ? <details className="diff-block"><summary><span>文件变更</span><span>{diffs.length} 个更新</span></summary><pre>{diffs.at(-1)?.part.text}</pre></details> : null}
              {answer ? <div className="answer-block"><MarkdownText text={answer} /></div> : null}
              {snapshot.status === "completed" ? <div className="completion-line"><span className="completion-check">✓</span>任务已完成 <span>{formatTime(snapshot.updatedAt)}</span></div> : null}
            </div><div ref={timelineEnd} />
          </div>
        </section>}

        <form className={`composer ${snapshot ? "composer-in-conversation" : ""}`} onSubmit={submit}>
          <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void startRun(); } }} placeholder="描述你的任务，输入 / 选择指令与技能" rows={snapshot ? 2 : 3} aria-label="任务描述" />
          <div className="composer-toolbar"><div className="composer-left"><button type="button" className="tool-button" disabled title="第一版暂不支持附件" aria-label="附件功能尚未启用"><span>＋</span><span className="control-label">附件</span></button><div className="menu-wrap"><button type="button" className={`tool-button ${openMenu === "mode" ? "menu-open" : ""}`} onClick={() => setOpenMenu(openMenu === "mode" ? null : "mode")}><span>◈</span><span className="control-label">{mode === "cluster" ? "集群" : "标准"}</span><span className="down">⌄</span></button>{openMenu === "mode" ? <div className="menu"><button type="button" onClick={() => { setMode("standard"); setOpenMenu(null); }}><strong>标准模式</strong><small>单个 Agent，适合当前版本</small></button><button type="button" disabled><strong>Agent 集群</strong><small>后续版本开放</small></button></div> : null}</div><div className="menu-wrap"><button type="button" className={`tool-button ${openMenu === "model" ? "menu-open" : ""}`} onClick={() => setOpenMenu(openMenu === "model" ? null : "model")}><span>◉</span><span className="control-label">{model === "auto" ? "Auto" : model}</span><span className="down">⌄</span></button>{openMenu === "model" ? <div className="menu"><button type="button" onClick={() => { setModel("auto"); setOpenMenu(null); }}><strong>Auto</strong><small>使用 Codex 当前默认模型</small></button><button type="button" onClick={() => { setModel("gpt-5.6-sol"); setOpenMenu(null); }}><strong>GPT-5.6 Sol</strong><small>复杂推理与代码任务</small></button><button type="button" onClick={() => { setModel("gpt-5.6-terra"); setOpenMenu(null); }}><strong>GPT-5.6 Terra</strong><small>日常任务与快速执行</small></button></div> : null}</div><div className="menu-wrap"><button type="button" className={`tool-button ${openMenu === "effort" ? "menu-open" : ""}`} onClick={() => setOpenMenu(openMenu === "effort" ? null : "effort")}><span>≋</span><span className="control-label">{effort === "deep" ? "极限" : effort === "fast" ? "快速" : "均衡"}</span><span className="down">⌄</span></button>{openMenu === "effort" ? <div className="menu"><button type="button" onClick={() => { setEffort("fast"); setOpenMenu(null); }}><strong>快速</strong><small>更快响应</small></button><button type="button" onClick={() => { setEffort("balanced"); setOpenMenu(null); }}><strong>均衡</strong><small>速度与质量平衡</small></button><button type="button" onClick={() => { setEffort("deep"); setOpenMenu(null); }}><strong>极限</strong><small>更长的推理预算</small></button></div> : null}</div></div><div className="composer-right"><button type="button" className="voice-button" disabled title="第一版暂不支持语音" aria-label="语音输入尚未启用">◌</button>{isRunning ? <button type="button" className="stop-button" onClick={() => void cancelRun()} aria-label="停止任务"><span className="stop-square" />停止</button> : <button type="submit" className="send-button" disabled={!prompt.trim()} aria-label="发送任务"><span>发送</span><span className="send-arrow">↑</span></button>}</div></div>
        </form>
        <div className="footer-note">OpenRigor 在本机运行 · 你的 Codex 登录态不会发送到浏览器</div>
      </main>
      {error ? <div className="toast" role="alert"><span>{error}</span><button type="button" onClick={() => setError(null)} aria-label="关闭">×</button></div> : null}
    </div>
  );
}
