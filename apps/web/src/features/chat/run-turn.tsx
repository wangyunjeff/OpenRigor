import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { useGSAP } from "@gsap/react";
import type { RunSnapshot, UsageSummary } from "@openrigor/protocol";
import { gsap } from "gsap";
import {
  Activity,
  BrainCircuit,
  Check,
  CheckCircle2,
  CircleAlert,
  CircleDashed,
  Copy,
  Download,
  FileCode2,
  GitCompare,
  TriangleAlert,
  XCircle
} from "lucide-react";
import { Agent, AgentContent, AgentHeader } from "../../components/ai-elements/agent";
import {
  Artifact,
  ArtifactContent,
  ArtifactDescription,
  ArtifactHeader,
  ArtifactTitle
} from "../../components/ai-elements/artifact";
import { CodeBlock } from "../../components/ai-elements/code-block";
import {
  Message,
  MessageAction,
  MessageActions,
  MessageContent,
  MessageResponse
} from "../../components/ai-elements/message";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger
} from "../../components/ai-elements/reasoning";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolOutput
} from "../../components/ai-elements/tool";
import { Terminal } from "../../components/ai-elements/terminal";
import { Alert, AlertDescription, AlertTitle } from "../../components/ui/alert";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../../components/ui/collapsible";
import {
  projectRunEvents,
  segmentRunTimeline,
  type AssistantMessageProjection,
  type ConversationRunView,
  type ReasoningProjection,
  type RunActivity,
  type SourceProjection,
  type ToolProjection
} from "../../conversation";
import {
  executionOpenTransition,
  formatToolDuration,
  isActivelyWorkingStatus,
  toolElapsedMs,
  executionSummary
} from "../../run-presentation";
import { modelLabel } from "../../workspace-preferences";
import { annotateSourceLinks, artifactLanguage, isTerminalTool, linkArtifactMarkdown, resolveArtifactUrl, toolPhaseToAiState } from "./ai-elements-adapter";
import { RunRequestPanel } from "./request-panel";
import { ResearchDeliverables, ResearchPlan, ResearchSources } from "./research-results";
import { workspaceApiBase } from "../workspace/api";
import { executionShouldOpen, messageReadingRole, toolFailureSummary, toolReadingTitle, toolShouldOpen } from "./run-reading";
import "./run-reading.css";
import { ActivityGlyph, RunActivityIndicator, useRunActivity } from "./run-activity";

export type ConnectionState = "idle" | "connecting" | "open" | "closed";

function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function compactId(value: string): string {
  return value.length > 18 ? `${value.slice(0, 8)}...${value.slice(-5)}` : value;
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

function AnimatedStep({ children, className = "" }: { children: ReactElement; className?: string }): ReactElement {
  const stepRef = useRef<HTMLDivElement>(null);
  useGSAP(() => {
    const root = stepRef.current;
    if (!root) return;
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      gsap.fromTo(root, { autoAlpha: 0, y: 6, scale: 0.995 }, { autoAlpha: 1, y: 0, scale: 1, duration: 0.28, ease: "power2.out", clearProps: "transform,opacity,visibility" });
    }, root);
    return () => media.revert();
  }, { scope: stepRef });
  return <div ref={stepRef} className={`ai-run-step ${className}`}>{children}</div>;
}

function toolOutcome(projection: ToolProjection): NonNullable<ToolProjection["event"]["tool"]["outcome"]> | undefined {
  const explicit = projection.event.tool.outcome;
  if (explicit) return explicit;
  if (projection.event.tool.phase === "failed") return "error";
  if (projection.event.tool.phase === "succeeded") return "success";
  return undefined;
}

function outcomeCopy(outcome: NonNullable<ReturnType<typeof toolOutcome>>): { label: string; Icon: typeof CheckCircle2; className: string } {
  if (outcome === "no-result") return { label: "未找到匹配", Icon: CircleDashed, className: "no-result" };
  if (outcome === "partial") return { label: "部分完成 · 有警告", Icon: TriangleAlert, className: "partial" };
  if (outcome === "declined") return { label: "已拒绝", Icon: XCircle, className: "declined" };
  if (outcome === "error") return { label: "执行失败", Icon: CircleAlert, className: "error" };
  return { label: "已完成", Icon: CheckCircle2, className: "success" };
}

function ReasoningStep({ projection, isStreaming }: { projection: ReasoningProjection; isStreaming: boolean }): ReactElement {
  const [open, setOpen] = useState(isStreaming);
  const elapsedMs = Math.max(0, Date.parse(projection.lastAt) - Date.parse(projection.firstAt));
  const duration = elapsedMs > 0 ? Math.ceil(elapsedMs / 1_000) : undefined;

  useEffect(() => {
    // Only the latest provider reasoning block streams. Older blocks settle
    // independently instead of all appearing active together.
    setOpen(isStreaming);
  }, [isStreaming]);

  return <AnimatedStep className="assistant-reasoning-step">
    <Reasoning className="openrigor-reasoning" isStreaming={isStreaming} open={open} onOpenChange={setOpen} {...(duration === undefined ? {} : { duration })}>
      <ReasoningTrigger getThinkingMessage={(streaming, seconds) => <span>{streaming ? "正在深度思考" : seconds ? `思考 · ${seconds}s` : "思考过程"}</span>}><BrainCircuit aria-hidden="true" /><span>{isStreaming ? "正在深度思考" : duration ? `思考 · ${duration}s` : "思考过程"}</span></ReasoningTrigger>
      <ReasoningContent>{projection.text}</ReasoningContent>
    </Reasoning>
  </AnimatedStep>;
}

function ToolDiagnostics({ tool, output }: { tool: ToolProjection["event"]["tool"]; output: string | undefined }): ReactElement | null {
  if (!output && !tool.inputSummary && !tool.diagnostic) return null;
  return <details className="tool-diagnostics">
    <summary><span className="tool-diagnostics-chevron" aria-hidden="true">›</span><span>诊断详情</span><small>原始返回与调用参数</small></summary>
    <div className="tool-diagnostics-body" tabIndex={0} role="region" aria-label="原始工具诊断">
      {tool.diagnostic ? <section><h4>运行时诊断</h4><pre>{tool.diagnostic}</pre></section> : null}
      {output ? <section><h4>工具原始返回</h4><pre>{output}</pre></section> : null}
      {tool.inputSummary ? <section><h4>调用参数</h4><pre>{tool.inputSummary}</pre></section> : null}
    </div>
  </details>;
}

function ToolStep({ projection, output, nowMs, active, attention }: { projection: ToolProjection; output: string | undefined; nowMs: number; active: boolean; attention: boolean }): ReactElement {
  const phase = projection.event.tool.phase;
  const outcome = toolOutcome(projection);
  const hasFailure = outcome === "error" || outcome === "declined";
  const pendingTool = phase === "requested" || phase === "running";
  const liveTool = active && pendingTool;
  const duration = projection.event.tool.durationMs !== undefined
    ? formatToolDuration(projection.event.tool.durationMs)
    : phase === "requested" && !liveTool
    ? null
    : formatToolDuration(toolElapsedMs(projection.firstAt, projection.lastAt, liveTool, nowMs));
  const autoOpen = toolShouldOpen(pendingTool, active, hasFailure, attention);
  const [open, setOpen] = useState(autoOpen);

  useEffect(() => {
    setOpen(autoOpen);
  }, [autoOpen]);

  const copy = outcome ? outcomeCopy(outcome) : undefined;
  const OutcomeIcon = copy?.Icon;

  return <AnimatedStep>
    <Tool className={liveTool ? "openrigor-tool is-live" : "openrigor-tool"} open={open} onOpenChange={setOpen} data-outcome={outcome}>
      <ToolHeader
        type="dynamic-tool"
        toolName={projection.event.tool.name}
        title={toolReadingTitle(projection.event.tool)}
        state={toolPhaseToAiState(phase, projection.event.tool.outcome)}
        {...(copy === undefined ? {} : { statusText: copy.label })}
        {...(duration === null ? {} : { durationText: duration })}
      />
      <ToolContent>
        <div className="openrigor-tool-meta"><span>{projection.event.tool.name}</span></div>
        {copy && OutcomeIcon ? <div className={`openrigor-tool-outcome outcome-${copy.className}`}><OutcomeIcon aria-hidden="true" /><strong>{copy.label}</strong>{projection.event.tool.exitCode !== undefined ? <code>exit {projection.event.tool.exitCode}</code> : null}</div> : null}
        {hasFailure
          ? <div className="tool-failure-reading"><p className="tool-failure-reason"><CircleAlert aria-hidden="true" /><span>{toolFailureSummary(output, projection.event.tool.diagnostic, outcome === "declined")}</span></p><ToolDiagnostics tool={projection.event.tool} output={output} /></div>
          : output && isTerminalTool(projection.event.tool.name)
          ? <Terminal className="openrigor-terminal" output={output} isStreaming={liveTool} />
          : <ToolOutput
            className="openrigor-tool-output"
            output={output}
            errorText={undefined}
          />}
      </ToolContent>
    </Tool>
  </AnimatedStep>;
}

function ActivityError({ event }: { event: Extract<RunActivity, { kind: "error" }>["event"] }): ReactElement {
  const recoverable = event.retryable;
  const title = recoverable ? "Codex 运行提示" : event.code === "CODEX_ERROR" ? "Codex 执行失败" : "运行时错误";
  return <AnimatedStep className="activity-error-step"><Alert className={recoverable ? "run-inline-warning" : "run-inline-error"} variant={recoverable ? "default" : "destructive"}>
    <CircleAlert aria-hidden="true" /><AlertTitle>{title}</AlertTitle>
    <AlertDescription>{event.message}{event.retryable ? " · 可以重试" : ""}</AlertDescription>
  </Alert></AnimatedStep>;
}

function ActivityArtifact({ activity }: { activity: Extract<RunActivity, { kind: "file" | "diff" }> }): ReactElement {
  if (activity.kind === "file") {
    const event = activity.event;
    const downloadUrl = resolveArtifactUrl(event.file.downloadUrl, workspaceApiBase);
    return <AnimatedStep><Artifact className="openrigor-artifact compact-artifact"><ArtifactHeader><div><ArtifactTitle>生成文件</ArtifactTitle><ArtifactDescription>{event.file.name}</ArtifactDescription></div><div className="artifact-file-actions"><span className="artifact-revision"><FileCode2 aria-hidden="true" />r{event.file.revision}</span>{downloadUrl ? <a href={downloadUrl} download={event.file.name} target="_blank" rel="noreferrer" aria-label={`下载 ${event.file.name}`} title={`下载 ${event.file.name}`}><Download aria-hidden="true" /></a> : null}</div></ArtifactHeader></Artifact></AnimatedStep>;
  }
  const event = activity.event;
  const filename = event.part.partId.replace("diff:", "");
  return <AnimatedStep><Artifact className="openrigor-artifact"><ArtifactHeader><div><ArtifactTitle>文件变更</ArtifactTitle><ArtifactDescription>{filename}</ArtifactDescription></div><GitCompare aria-hidden="true" /></ArtifactHeader><ArtifactContent><CodeBlock code={event.part.text} language={artifactLanguage(event.part.partId)} /></ArtifactContent></Artifact></AnimatedStep>;
}

function ActivitySubagent({ event, snapshot }: { event: Extract<RunActivity, { kind: "subagent" }>["projection"]["event"]; snapshot: RunSnapshot }): ReactElement {
  return <AnimatedStep><Agent className="openrigor-agent"><AgentHeader name={event.subagent.label} model={snapshot.routing === "tokenresearch" ? "Luna Max" : "Subagent"} /><AgentContent><span className={`subagent-status status-${event.subagent.status}`}><span />{statusLabel(event.subagent.status)}</span><code>{compactId(event.subagent.subagentRunId)}</code></AgentContent></Agent></AnimatedStep>;
}

function AssistantMessageStep({
  projection,
  isStreaming,
  readingRole,
  copied,
  files,
  sources,
  onCopy
}: {
  projection: AssistantMessageProjection;
  isStreaming: boolean;
  readingRole: ReturnType<typeof messageReadingRole>;
  copied: boolean;
  files: Array<{ name: string; path?: string; downloadUrl?: string }>;
  sources: SourceProjection[];
  onCopy: (answer: string) => void;
}): ReactElement {
  const isFinal = readingRole === "answer";
  const label = isFinal ? "回答" : readingRole === "partial" ? "运行结束前的回复" : "进展更新";
  return <AnimatedStep className={`assistant-message-step reading-message is-${readingRole}`}>
    <MessageContent className="assistant-response-text">
      <div className="assistant-reading-label">{label}</div>
      <MessageResponse isAnimating={isStreaming}>{annotateSourceLinks(linkArtifactMarkdown(projection.text, files, workspaceApiBase), sources)}</MessageResponse>
      {isFinal ? <MessageActions className="answer-actions"><MessageAction size="sm" tooltip="复制回答" label="复制回答" aria-label={copied ? "已复制" : "复制回答"} onClick={() => onCopy(projection.text)}><Copy aria-hidden="true" /><span>{copied ? "已复制" : "复制回答"}</span></MessageAction></MessageActions> : null}
    </MessageContent>
  </AnimatedStep>;
}

function ExecutionGroup({
  id,
  activities,
  snapshot,
  toolOutput,
  nowMs,
  connection,
  current,
  latest
}: {
  id: string;
  activities: RunActivity[];
  snapshot: RunSnapshot;
  toolOutput: Map<string, string>;
  nowMs: number;
  connection: ConnectionState;
  current: boolean;
  latest: boolean;
}): ReactElement {
  const isWorking = isActivelyWorkingStatus(snapshot.status);
  const runningToolCount = activities.filter((activity) => activity.kind === "tool" && (activity.projection.event.tool.phase === "running" || activity.projection.event.tool.phase === "requested")).length;
  const failureCount = activities.filter((activity) => {
    if (activity.kind === "error") return !activity.event.retryable;
    if (activity.kind !== "tool") return false;
    const outcome = toolOutcome(activity.projection);
    return outcome === "error" || outcome === "declined";
  }).length;
  const autoOpen = executionShouldOpen(snapshot.status, current, latest, failureCount > 0);
  const newestActivitySequence = Math.max(0, ...activities.map((activity) => activity.kind === "reasoning" ? 0 : activity.kind === "tool" || activity.kind === "subagent" ? activity.projection.event.sequence : activity.event.sequence));
  const [open, setOpen] = useState(autoOpen);
  const previousOpenRef = useRef<{ runId: string; isRunning: boolean }>({ runId: id, isRunning: autoOpen });

  useEffect(() => {
    const previous = previousOpenRef.current;
    const nextOpen = executionOpenTransition(previous, { runId: id, isRunning: autoOpen });
    if (nextOpen !== undefined) setOpen(nextOpen);
    previousOpenRef.current = { runId: id, isRunning: autoOpen };
  }, [autoOpen, id]);

  return <Collapsible className="execution-group" open={open} onOpenChange={setOpen}>
    <CollapsibleTrigger asChild><button type="button" className="execution-summary" aria-label={`${open ? "收起执行过程" : "展开执行过程"}${failureCount ? `，含 ${failureCount} 条异常` : ""}`}>{current && isWorking && connection === "open" && runningToolCount > 0 ? <ActivityGlyph animated /> : <Activity aria-hidden="true" />}<span>{executionSummary({ status: snapshot.status, current, total: activities.length, runningTools: runningToolCount, connection })}</span>{failureCount ? <span className="execution-issue-count"><CircleAlert aria-hidden="true" />{failureCount} 条异常</span> : null}<span className="execution-chevron" aria-hidden="true">⌄</span></button></CollapsibleTrigger>
    <CollapsibleContent className="execution-content ai-execution-content">
      {activities.map((activity) => {
        if (activity.kind === "reasoning") return null;
        if (activity.kind === "tool") return <ToolStep key={`tool-${activity.projection.event.tool.callId}`} projection={activity.projection} output={activity.projection.event.tool.outputSummary ?? toolOutput.get(activity.projection.event.tool.callId)} nowMs={nowMs} active={current && isWorking && connection === "open"} attention={activity.projection.event.sequence === newestActivitySequence && (current || (latest && snapshot.status === "failed"))} />;
        if (activity.kind === "subagent") return <ActivitySubagent key={`subagent-${activity.projection.event.subagent.subagentRunId}`} event={activity.projection.event} snapshot={snapshot} />;
        if (activity.kind === "file" || activity.kind === "diff") return <ActivityArtifact key={`${activity.kind}-${activity.event.eventId}`} activity={activity} />;
        return <ActivityError key={`error-${activity.event.eventId}`} event={activity.event} />;
      })}
    </CollapsibleContent>
  </Collapsible>;
}

function CompletionLine({ elapsed, updatedAt, usage }: { elapsed: string; updatedAt: string; usage: UsageSummary | undefined }): ReactElement {
  const completionRef = useRef<HTMLDivElement>(null);
  useGSAP(() => {
    const root = completionRef.current;
    if (!root) return;
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      gsap.timeline({ defaults: { ease: "power2.out" } })
        .fromTo(root, { autoAlpha: 0, y: 6 }, { autoAlpha: 1, y: 0, duration: 0.3, clearProps: "transform,opacity,visibility" })
        .fromTo(".completion-mark", { scale: 0.58, rotation: -18 }, { scale: 1, rotation: 0, duration: 0.46, ease: "back.out(2)", clearProps: "transform" }, "<0.02")
        .fromTo(".completion-line strong, .completion-line small", { autoAlpha: 0, x: -4 }, { autoAlpha: 1, x: 0, duration: 0.24, stagger: 0.055, clearProps: "transform,opacity,visibility" }, "<0.08");
    }, root);
    return () => media.revert();
  }, { scope: completionRef });

  const tokenTotal = (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0);
  return <div ref={completionRef} className="completion-line"><span className="completion-mark"><Check aria-hidden="true" /></span><strong>任务完成</strong><small>用时 {elapsed} · {formatTime(updatedAt)}{tokenTotal ? ` · ${tokenTotal.toLocaleString()} tokens` : ""}</small></div>;
}

export function RunTurn({ run, copied, onCopy, connection }: { run: ConversationRunView; copied: boolean; onCopy: (runId: string, answer: string) => void; connection: ConnectionState }): ReactElement {
  const { answer, messages, toolOutput, timeline, usage, files, plan, sources } = useMemo(() => projectRunEvents(run.events), [run.events]);
  const downloadableFiles = files.map((event) => event.file);
  const snapshot = run.snapshot;
  const isRunning = !isTerminalStatus(snapshot.status);
  const isWorking = isActivelyWorkingStatus(snapshot.status);
  const { view: activity, nowMs } = useRunActivity(run, connection);
  const timelineSegments = useMemo(() => segmentRunTimeline(timeline), [timeline]);
  const latestTimelineSegment = timelineSegments.at(-1);
  const activeExecutionId = isRunning && latestTimelineSegment?.kind === "execution" ? latestTimelineSegment.id : undefined;
  const latestExecutionId = timelineSegments.filter((segment) => segment.kind === "execution").at(-1)?.id;
  const latestMessagePartId = messages.at(-1)?.partId;
  const activeReasoningPartId = isWorking && connection === "open" && latestTimelineSegment?.kind === "reasoning" ? latestTimelineSegment.projection.partId : undefined;
  return <section className="conversation-turn" data-run-id={run.runId} aria-busy={isWorking && connection === "open"}>
    <Message from="user" className="openrigor-message user-turn">
      <MessageContent className="user-bubble">{run.visiblePrompt}</MessageContent>
      <div className="turn-meta"><span>{formatTime(snapshot.createdAt)}</span><span>{modelLabel(snapshot.model)}</span></div>
    </Message>

    <Message from="assistant" className="openrigor-message assistant-turn">
      <div className="assistant-heading"><span className="assistant-mark" aria-hidden="true"><svg viewBox="0 0 32 32" fill="none"><path d="M8 7h10a8 8 0 0 1 0 16H8V7Z" /><path d="M8 15h10M15 15l9 10M12 7v16" /></svg></span><span><strong>OpenRigor</strong><small className={`run-status status-${snapshot.status}`}><span />{statusLabel(snapshot.status)}</small></span><code>{compactId(snapshot.runId)}</code></div>

      {plan ? <ResearchPlan plan={plan} active={isWorking && connection === "open"} /> : null}

      {timelineSegments.length ? <div className="run-timeline">
        {timelineSegments.map((segment) => segment.kind === "message"
          ? <AssistantMessageStep key={`message-${segment.projection.partId}`} projection={segment.projection} files={downloadableFiles} sources={sources} isStreaming={isWorking && connection === "open" && !segment.projection.done && segment.projection.partId === latestMessagePartId} readingRole={messageReadingRole(snapshot.status, segment.projection.partId === latestMessagePartId, segment.projection.done)} copied={copied} onCopy={(answer) => onCopy(run.runId, answer)} />
          : segment.kind === "reasoning"
            ? <ReasoningStep key={`reasoning-${segment.projection.partId}`} projection={segment.projection} isStreaming={segment.projection.partId === activeReasoningPartId} />
            : <ExecutionGroup key={segment.id} id={`${snapshot.runId}:${segment.id}`} activities={segment.activities} snapshot={snapshot} toolOutput={toolOutput} nowMs={nowMs} connection={connection} current={segment.id === activeExecutionId} latest={segment.id === latestExecutionId} />)}
      </div> : null}
      {isRunning ? <RunActivityIndicator view={activity} /> : null}
      <ResearchSources sources={sources} answer={answer} />
      <ResearchDeliverables files={downloadableFiles} />
      {snapshot.status === "completed" ? <CompletionLine elapsed={activity.elapsed} updatedAt={snapshot.updatedAt} usage={usage} /> : null}
      <RunRequestPanel runId={snapshot.runId} status={snapshot.status} />
    </Message>
  </section>;
}
