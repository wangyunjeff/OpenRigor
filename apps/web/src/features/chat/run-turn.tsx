import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { useGSAP } from "@gsap/react";
import type { RunSnapshot, UsageSummary } from "@openrigor/protocol";
import { gsap } from "gsap";
import {
  Activity,
  BrainCircuit,
  Check,
  CircleAlert,
  Command,
  Copy,
  Download,
  FileCode2,
  GitCompare
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
import { projectRunEvents, type ConversationRunView, type ToolProjection } from "../../conversation";
import {
  formatToolDuration,
  isActivelyWorkingStatus,
  presentRunActivity,
  toolElapsedMs,
  type RunActivityPresentation
} from "../../run-presentation";
import { modelLabel } from "../../workspace-preferences";
import { artifactLanguage, isTerminalTool, toolPhaseToAiState } from "./ai-elements-adapter";

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

function useLiveNow(enabled: boolean, resetKey: string): number {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    setNowMs(Date.now());
    if (!enabled) return;
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [enabled, resetKey]);

  return nowMs;
}

function RunActivityIndicator({ view, status }: { view: RunActivityPresentation; status: RunSnapshot["status"] }): ReactElement {
  const indicatorRef = useRef<HTMLDivElement>(null);

  useGSAP(() => {
    const root = indicatorRef.current;
    if (!root) return;
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      gsap.timeline({ defaults: { ease: "power2.out" } })
        .fromTo(root, { autoAlpha: 0, y: 5 }, { autoAlpha: 1, y: 0, duration: 0.28, clearProps: "transform,opacity,visibility" })
        .fromTo(".run-activity-orb", { scale: 0.86 }, { scale: 1, duration: 0.36, ease: "back.out(1.6)", clearProps: "transform" }, "<")
        .fromTo(".run-activity-copy > *", { autoAlpha: 0, y: 3 }, { autoAlpha: 1, y: 0, duration: 0.24, stagger: 0.045, clearProps: "transform,opacity,visibility" }, "<0.04")
        .fromTo(".run-activity-meta", { autoAlpha: 0, x: 4 }, { autoAlpha: 1, x: 0, duration: 0.24, clearProps: "transform,opacity,visibility" }, "<0.05");

      if (!view.animated) return;
      const dots = gsap.utils.toArray<HTMLElement>(".run-activity-orb i", root);
      gsap.timeline({ repeat: -1, repeatDelay: 0.16 })
        .to(dots, { opacity: 0.96, scale: 1.24, duration: 0.34, stagger: { each: 0.075, from: "start" }, ease: "sine.out" })
        .to(dots, { opacity: 0.2, scale: 0.88, duration: 0.46, stagger: { each: 0.075, from: "start" }, ease: "sine.in" }, 0.22);
    }, root);
    return () => media.revert();
  }, { scope: indicatorRef, dependencies: [view.animated], revertOnUpdate: true });

  useGSAP(() => {
    const root = indicatorRef.current;
    if (!root || !view.stale) return;
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      gsap.fromTo(".run-activity-copy strong", { autoAlpha: 0.42, x: -3 }, { autoAlpha: 1, x: 0, duration: 0.34, ease: "power2.out", clearProps: "transform,opacity,visibility" });
    }, root);
    return () => media.revert();
  }, { scope: indicatorRef, dependencies: [view.stale], revertOnUpdate: true });

  return <div ref={indicatorRef} className={`run-activity${view.animated ? " is-animated" : ""}${view.stale ? " is-stale" : ""}`} data-status={status}>
    <span className="run-activity-orb" aria-hidden="true">{Array.from({ length: 9 }, (_, index) => <i key={index} />)}</span>
    <span className="run-activity-copy"><strong role="status" aria-live="polite">{view.headline}</strong><small>{view.detail}</small></span>
    <span className="run-activity-meta" aria-hidden="true"><span>已用时 {view.elapsed}</span><i>·</i><span>{view.lastUpdate}</span></span>
  </div>;
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

function ToolStep({ projection, output, nowMs, active }: { projection: ToolProjection; output: string | undefined; nowMs: number; active: boolean }): ReactElement {
  const phase = projection.event.tool.phase;
  const liveDuration = active && (phase === "requested" || phase === "running");
  const duration = phase === "requested" && !liveDuration
    ? null
    : formatToolDuration(toolElapsedMs(projection.firstAt, projection.lastAt, liveDuration, nowMs));
  const [open, setOpen] = useState(phase === "failed" || liveDuration);

  useEffect(() => {
    if (phase === "failed") setOpen(true);
    else if (phase === "succeeded") setOpen(false);
    else setOpen(active);
  }, [active, phase]);

  return <AnimatedStep>
    <Tool className={active ? "openrigor-tool is-live" : "openrigor-tool"} open={open} onOpenChange={setOpen}>
      <ToolHeader
        type="dynamic-tool"
        toolName={projection.event.tool.name}
        title={projection.event.tool.inputSummary ?? projection.event.tool.name.replaceAll("_", " ")}
        state={toolPhaseToAiState(phase)}
      />
      <ToolContent>
        <div className="openrigor-tool-meta"><span>{projection.event.tool.name}</span>{duration ? <span>{duration}</span> : null}</div>
        {output && phase !== "failed" && isTerminalTool(projection.event.tool.name)
          ? <Terminal className="openrigor-terminal" output={output} isStreaming={liveDuration} />
          : <ToolOutput output={phase === "failed" ? undefined : output} errorText={phase === "failed" ? (output ?? "工具执行失败") : undefined} />}
      </ToolContent>
    </Tool>
  </AnimatedStep>;
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
  const { answer, reasoning, toolOutput, tools, diffs, files, subagents, errors, usage } = useMemo(() => projectRunEvents(run.events), [run.events]);
  const snapshot = run.snapshot;
  const isRunning = !isTerminalStatus(snapshot.status);
  const isWorking = isActivelyWorkingStatus(snapshot.status);
  const nowMs = useLiveNow(isRunning, snapshot.runId);
  const latestEventAt = run.events.at(-1)?.ts ?? snapshot.updatedAt;
  const activity = presentRunActivity(snapshot, latestEventAt, nowMs);
  const visibleActivity: RunActivityPresentation = connection === "open"
    ? activity
    : connection === "connecting"
      ? { ...activity, animated: true, stale: false, headline: "正在恢复实时状态", detail: "正在重新连接事件流" }
      : { ...activity, animated: false, stale: false, headline: "实时状态未连接", detail: "任务可能仍在后台运行" };
  const [reasoningOpen, setReasoningOpen] = useState(isRunning);
  const [executionOpen, setExecutionOpen] = useState(isRunning);
  const activityCount = tools.length + files.length + diffs.length + subagents.length + errors.length + (reasoning ? 1 : 0);

  useEffect(() => {
    setExecutionOpen(isRunning);
    setReasoningOpen(isRunning);
  }, [isRunning]);

  return <section className="conversation-turn" data-run-id={run.runId}>
    <Message from="user" className="openrigor-message user-turn">
      <MessageContent className="user-bubble">{run.visiblePrompt}</MessageContent>
      <div className="turn-meta"><span>{formatTime(snapshot.createdAt)}</span><span>{modelLabel(snapshot.model)}</span></div>
    </Message>

    <Message from="assistant" className="openrigor-message assistant-turn">
      <div className="assistant-heading"><span className="assistant-mark"><Command aria-hidden="true" /></span><span><strong>OpenRigor</strong><small className={`run-status status-${snapshot.status}`}><span />{statusLabel(snapshot.status)}</small></span><code>{compactId(snapshot.runId)}</code></div>

      {isRunning ? <RunActivityIndicator view={visibleActivity} status={snapshot.status} /> : null}

      {activityCount ? <Collapsible className="execution-group" open={executionOpen} onOpenChange={setExecutionOpen}>
        <CollapsibleTrigger asChild><button type="button" className="execution-summary"><Activity aria-hidden="true" /><span>{isWorking ? `正在执行 · ${activityCount} 个步骤` : snapshot.status === "waiting_user" ? `等待继续 · ${activityCount} 个步骤` : `执行了 ${activityCount} 个步骤`}</span><small>{snapshot.progress}%</small><span className="execution-chevron" aria-hidden="true">⌄</span></button></CollapsibleTrigger>
        <CollapsibleContent className="execution-content ai-execution-content">
          {reasoning ? <AnimatedStep><Reasoning className="openrigor-reasoning" isStreaming={isWorking} open={reasoningOpen} onOpenChange={setReasoningOpen}>
            <ReasoningTrigger getThinkingMessage={(streaming) => <span>{streaming ? "正在深度思考" : "思考过程"}</span>}><BrainCircuit aria-hidden="true" /><span>{isWorking ? "正在深度思考" : "思考过程"}</span></ReasoningTrigger>
            <ReasoningContent>{reasoning}</ReasoningContent>
          </Reasoning></AnimatedStep> : null}
          {tools.map((projection) => <ToolStep key={projection.event.tool.callId} projection={projection} output={projection.event.tool.outputSummary ?? toolOutput.get(projection.event.tool.callId)} nowMs={nowMs} active={isWorking && connection === "open"} />)}
          {subagents.map(({ event }) => <AnimatedStep key={event.subagent.subagentRunId}><Agent className="openrigor-agent"><AgentHeader name={event.subagent.label} model={snapshot.routing === "tokenresearch" ? "Luna Max" : "Subagent"} /><AgentContent><span className={`subagent-status status-${event.subagent.status}`}><span />{statusLabel(event.subagent.status)}</span><code>{compactId(event.subagent.subagentRunId)}</code></AgentContent></Agent></AnimatedStep>)}
          {files.map((event) => <AnimatedStep key={event.eventId}><Artifact className="openrigor-artifact compact-artifact"><ArtifactHeader><div><ArtifactTitle>生成文件</ArtifactTitle><ArtifactDescription>{event.file.name}</ArtifactDescription></div><div className="artifact-file-actions"><span className="artifact-revision"><FileCode2 aria-hidden="true" />r{event.file.revision}</span>{event.file.downloadUrl ? <a href={event.file.downloadUrl} download={event.file.name} target="_blank" rel="noreferrer" aria-label={`下载 ${event.file.name}`} title={`下载 ${event.file.name}`}><Download aria-hidden="true" /></a> : null}</div></ArtifactHeader></Artifact></AnimatedStep>)}
          {diffs.map((event) => {
            const filename = event.part.partId.replace("diff:", "");
            return <AnimatedStep key={event.eventId}><Artifact className="openrigor-artifact"><ArtifactHeader><div><ArtifactTitle>文件变更</ArtifactTitle><ArtifactDescription>{filename}</ArtifactDescription></div><GitCompare aria-hidden="true" /></ArtifactHeader><ArtifactContent><CodeBlock code={event.part.text} language={artifactLanguage(event.part.partId)} /></ArtifactContent></Artifact></AnimatedStep>;
          })}
          {errors.map((event) => <AnimatedStep key={event.eventId}><Alert className="run-inline-error" variant="destructive"><CircleAlert aria-hidden="true" /><AlertTitle>{event.code}</AlertTitle><AlertDescription>{event.message}{event.retryable ? " · 可以重试" : ""}</AlertDescription></Alert></AnimatedStep>)}
        </CollapsibleContent>
      </Collapsible> : null}

      {answer ? <MessageContent className="answer-block"><MessageResponse isAnimating={isWorking}>{answer}</MessageResponse><MessageActions className="answer-actions"><MessageAction tooltip="复制回答" label="复制回答" onClick={() => onCopy(run.runId, answer)}><Copy aria-hidden="true" /><span>{copied ? "已复制" : "复制回答"}</span></MessageAction></MessageActions></MessageContent> : null}
      {snapshot.status === "completed" ? <CompletionLine elapsed={activity.elapsed} updatedAt={snapshot.updatedAt} usage={usage} /> : null}
    </Message>
  </section>;
}
