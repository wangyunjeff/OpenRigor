import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { useGSAP } from "@gsap/react";
import type { RunSnapshot, UsageSummary } from "@openrigor/protocol";
import { gsap } from "gsap";
import {
  Bot,
  BrainCircuit,
  Check,
  ChevronDown,
  Circle,
  CircleAlert,
  CircleSlash,
  Clock3,
  Copy,
  Download,
  FilePen,
  FileText,
  GitCompare,
  ImageIcon,
  ListChecks,
  MousePointerClick,
  Plug,
  Search,
  SquareTerminal,
  Wrench
} from "lucide-react";
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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../../components/ui/collapsible";
import {
  projectRunEvents,
  segmentRunTimeline,
  type AssistantMessageProjection,
  type ConversationRunView,
  type PlanProjection,
  type ReasoningProjection,
  type RunActivity,
  type RunTimelineSegment,
  type SourceProjection,
  type ToolProjection
} from "../../conversation";
import {
  executionOpenTransition,
  formatElapsed,
  formatToolDuration,
  isActivelyWorkingStatus,
  processSummary,
  toolElapsedMs,
  type RunActivityPresentation
} from "../../run-presentation";
import { modelLabel } from "../../workspace-preferences";
import { usePreview } from "../preview/preview-context";
import {
  annotateSourceLinks,
  artifactBasename,
  artifactLanguage,
  isTerminalTool,
  linkArtifactMarkdown,
  resolveArtifactUrl,
  summarizePlan,
  toolPhaseToAiState
} from "./ai-elements-adapter";
import { RunRequestPanel } from "./request-panel";
import { ResearchDeliverables, ResearchSources } from "./research-results";
import { workspaceApiBase } from "../workspace/api";
import {
  messageReadingRole,
  processShouldOpen,
  responseTailIndex,
  toolFailureSummary,
  toolKind,
  toolReadingTitle,
  toolShouldOpen,
  type ToolKind
} from "./run-reading";
import "./run-turn.css";
import { ActivityGlyph, RunActivityIndicator, useRunActivity } from "./run-activity";

export type ConnectionState = "idle" | "connecting" | "open" | "closed";

type ToolOutcome = NonNullable<ToolProjection["event"]["tool"]["outcome"]>;
type DownloadableFile = { name: string; path?: string; downloadUrl?: string };

const toolIcons: Record<ToolKind, typeof Wrench> = {
  command: SquareTerminal,
  search: Search,
  file: FilePen,
  browser: MousePointerClick,
  subagent: Bot,
  image: ImageIcon,
  plan: ListChecks,
  wait: Clock3,
  mcp: Plug,
  tool: Wrench
};

function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function isTerminalStatus(status: RunSnapshot["status"]): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

function subagentStatusLabel(status: RunSnapshot["status"]): string {
  const labels: Record<RunSnapshot["status"], string> = {
    queued: "Queued",
    running: "Working",
    waiting_tool: "Using a tool",
    waiting_user: "Needs input",
    cancelling: "Stopping",
    completed: "Done",
    failed: "Failed",
    cancelled: "Stopped"
  };
  return labels[status];
}

/** Changed paths named by a unified diff; the diff part id only identifies the turn. */
function diffPaths(diff: string): string[] {
  const paths = new Set<string>();
  for (const match of diff.matchAll(/^\+\+\+ (?:b\/)?(.+)$/gm)) {
    const path = match[1]?.trim();
    if (path && path !== "/dev/null") paths.add(path);
  }
  return [...paths];
}

function AnimatedStep({ children, className = "" }: { children: ReactElement; className?: string }): ReactElement {
  const stepRef = useRef<HTMLDivElement>(null);
  useGSAP(() => {
    const root = stepRef.current;
    if (!root) return;
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      gsap.fromTo(root, { autoAlpha: 0, y: 4 }, { autoAlpha: 1, y: 0, duration: 0.24, ease: "power2.out", clearProps: "transform,opacity,visibility" });
    }, root);
    return () => media.revert();
  }, { scope: stepRef });
  return <div ref={stepRef} className={`process-step ${className}`}>{children}</div>;
}

function toolOutcome(projection: ToolProjection): ToolOutcome | undefined {
  const explicit = projection.event.tool.outcome;
  if (explicit) return explicit;
  if (projection.event.tool.phase === "failed") return "error";
  if (projection.event.tool.phase === "succeeded") return "success";
  return undefined;
}

function outcomeLabel(outcome: ToolOutcome | undefined): string | undefined {
  if (outcome === "no-result") return "No matches";
  if (outcome === "partial") return "Finished with warnings";
  if (outcome === "declined") return "Declined";
  if (outcome === "error") return "Failed";
  if (outcome === "success") return "Completed";
  return undefined;
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

  return <AnimatedStep className="is-reasoning">
    <Reasoning className="openrigor-reasoning" isStreaming={isStreaming} open={open} onOpenChange={setOpen} {...(duration === undefined ? {} : { duration })}>
      <ReasoningTrigger className="process-row-trigger">
        <span className="step-icon" aria-hidden="true"><BrainCircuit /></span>
        <span className={isStreaming ? "process-row-title text-shimmer" : "process-row-title"}>{isStreaming ? "Thinking" : duration ? `Thought for ${duration}s` : "Reasoning"}</span>
        <ChevronDown className="process-row-chevron" aria-hidden="true" />
      </ReasoningTrigger>
      <ReasoningContent className="process-reasoning-text">{projection.text}</ReasoningContent>
    </Reasoning>
  </AnimatedStep>;
}

function ToolDiagnostics({ tool, output }: { tool: ToolProjection["event"]["tool"]; output: string | undefined }): ReactElement | null {
  if (!output && !tool.inputSummary && !tool.diagnostic) return null;
  return <details className="tool-diagnostics">
    <summary><span className="tool-diagnostics-chevron" aria-hidden="true">›</span><span>Details</span><small>Raw output and arguments</small></summary>
    <div className="tool-diagnostics-body" tabIndex={0} role="region" aria-label="Raw tool diagnostics">
      {tool.diagnostic ? <section><h4>Runtime diagnostic</h4><pre>{tool.diagnostic}</pre></section> : null}
      {output ? <section><h4>Raw output</h4><pre>{output}</pre></section> : null}
      {tool.inputSummary ? <section><h4>Arguments</h4><pre>{tool.inputSummary}</pre></section> : null}
    </div>
  </details>;
}

function ToolStep({ projection, output, nowMs, live, attention }: { projection: ToolProjection; output: string | undefined; nowMs: number; live: boolean; attention: boolean }): ReactElement {
  const tool = projection.event.tool;
  const phase = tool.phase;
  const outcome = toolOutcome(projection);
  const hasFailure = outcome === "error" || outcome === "declined";
  const pending = phase === "requested" || phase === "running";
  const liveTool = live && pending;
  const rawDuration = tool.durationMs !== undefined
    ? formatToolDuration(tool.durationMs)
    : phase === "requested" && !liveTool
    ? null
    : liveTool
    ? formatElapsed(toolElapsedMs(projection.firstAt, projection.lastAt, true, nowMs))
    : formatToolDuration(toolElapsedMs(projection.firstAt, projection.lastAt, false, nowMs));
  // A zero-length record (for example a file change reported once) has no meaningful duration.
  const duration = rawDuration === "0ms" ? null : rawDuration;
  const autoOpen = toolShouldOpen(pending, live, hasFailure, attention);
  const [open, setOpen] = useState(autoOpen);

  useEffect(() => {
    setOpen(autoOpen);
  }, [autoOpen]);

  const kind = toolKind(tool.name);
  const Icon = toolIcons[kind];
  const title = toolReadingTitle(tool);
  const state = liveTool ? "input-available" : pending ? "input-streaming" : toolPhaseToAiState(phase, tool.outcome);
  const statusText = liveTool ? "Running" : pending ? "Not finished" : outcomeLabel(outcome);
  const note = outcome === "partial" || outcome === "no-result"
    ? tool.diagnostic ?? (outcome === "no-result" ? "No matches found" : "Finished with warnings")
    : undefined;
  const input = !hasFailure && tool.inputSummary && tool.inputSummary.trim() !== title ? tool.inputSummary.trim() : undefined;
  const hasDetails = Boolean(output || note || hasFailure || input);

  return <AnimatedStep className={`is-tool kind-${kind}`}>
    <Tool className={liveTool ? "openrigor-tool is-live" : "openrigor-tool"} open={hasDetails && open} onOpenChange={setOpen} data-outcome={outcome} data-kind={kind}>
      <ToolHeader
        className="process-row-trigger"
        type="dynamic-tool"
        toolName={tool.name}
        title={title}
        icon={<span className="step-icon"><Icon /></span>}
        state={state}
        statusDisplay="icon"
        expandable={hasDetails}
        {...(statusText === undefined ? {} : { statusText })}
        {...(duration === null ? {} : { durationText: duration })}
      />
      {hasDetails ? <ToolContent className="openrigor-tool-content">
        {note ? <p className="tool-note"><CircleAlert aria-hidden="true" /><span>{note}</span>{tool.exitCode !== undefined ? <code>exit {tool.exitCode}</code> : null}</p> : null}
        {hasFailure
          ? <div className="tool-failure-reading"><p className="tool-failure-reason"><CircleAlert aria-hidden="true" /><span>{toolFailureSummary(output, tool.diagnostic, outcome === "declined")}</span>{tool.exitCode !== undefined ? <code>exit {tool.exitCode}</code> : null}</p><ToolDiagnostics tool={tool} output={output} /></div>
          : <>
            {input ? <pre className="tool-input">{input}</pre> : null}
            {output && isTerminalTool(tool.name)
              ? <Terminal className="openrigor-terminal" output={output} isStreaming={liveTool} />
              : output ? <ToolOutput className="openrigor-tool-output" output={output} errorText={undefined} /> : null}
          </>}
      </ToolContent> : null}
    </Tool>
  </AnimatedStep>;
}

function ErrorStep({ event }: { event: Extract<RunActivity, { kind: "error" }>["event"] }): ReactElement {
  const title = event.retryable ? "Codex reported a recoverable problem" : event.code === "CODEX_ERROR" ? "Codex failed" : "Runtime error";
  return <AnimatedStep className={event.retryable ? "is-error is-warning" : "is-error"}>
    <div className="process-error" role="alert">
      <span className="step-icon" aria-hidden="true"><CircleAlert /></span>
      <div><strong>{title}</strong><span>{event.message}{event.retryable ? " The runtime may retry." : ""}</span></div>
    </div>
  </AnimatedStep>;
}

function FileStep({ event }: { event: Extract<RunActivity, { kind: "file" }>["event"] }): ReactElement {
  const preview = usePreview();
  const file = event.file;
  const name = artifactBasename(file.name);
  const downloadUrl = resolveArtifactUrl(file.downloadUrl, workspaceApiBase);
  return <AnimatedStep className="is-file">
    <div className="process-file">
      <span className="step-icon" aria-hidden="true"><FileText /></span>
      <button type="button" className="process-file-open" onClick={() => preview?.openArtifact(file)} disabled={!preview} title={`Preview ${name}`}>
        <span>{file.revision > 1 ? "Updated" : "Created"}</span><strong>{name}</strong>
      </button>
      <span className="process-file-revision">r{file.revision}</span>
      {downloadUrl ? <a href={downloadUrl} download={name} target="_blank" rel="noreferrer" aria-label={`Download ${name}`} title={`Download ${name}`}><Download aria-hidden="true" /></a> : null}
    </div>
  </AnimatedStep>;
}

function DiffStep({ event }: { event: Extract<RunActivity, { kind: "diff" }>["event"] }): ReactElement {
  const [open, setOpen] = useState(false);
  const paths = diffPaths(event.part.text);
  const title = paths.length === 1 ? `Edited ${paths[0]}` : paths.length > 1 ? `Edited ${paths.length} files` : "Code changes";
  return <AnimatedStep className="is-tool kind-diff">
    <Tool className="openrigor-tool" open={open} onOpenChange={setOpen} data-kind="diff">
      <ToolHeader className="process-row-trigger" type="dynamic-tool" toolName="diff" title={title} icon={<span className="step-icon"><GitCompare /></span>} state="output-available" statusDisplay="icon" statusText="Recorded" />
      <ToolContent className="openrigor-tool-content"><CodeBlock code={event.part.text} language={artifactLanguage(event.part.partId)} /></ToolContent>
    </Tool>
  </AnimatedStep>;
}

function SubagentStep({ event, snapshot }: { event: Extract<RunActivity, { kind: "subagent" }>["projection"]["event"]; snapshot: RunSnapshot }): ReactElement {
  return <AnimatedStep className="is-subagent">
    <div className="process-subagent" data-status={event.subagent.status}>
      <span className="step-icon" aria-hidden="true"><Bot /></span>
      <strong>{event.subagent.label}</strong>
      <small>{snapshot.routing === "tokenresearch" ? "Luna Max" : "Subagent"}</small>
      <span className="process-subagent-status"><span aria-hidden="true" />{subagentStatusLabel(event.subagent.status)}</span>
    </div>
  </AnimatedStep>;
}

function CommentaryStep({ projection, files, sources, isStreaming }: { projection: AssistantMessageProjection; files: DownloadableFile[]; sources: SourceProjection[]; isStreaming: boolean }): ReactElement {
  return <AnimatedStep className="is-commentary">
    <div className="process-commentary">
      <span className="step-icon" aria-hidden="true"><span className="step-dot" /></span>
      <MessageResponse className="process-commentary-text" isAnimating={isStreaming}>{annotateSourceLinks(linkArtifactMarkdown(projection.text, files, workspaceApiBase), sources)}</MessageResponse>
    </div>
  </AnimatedStep>;
}

function PlanChecklist({ plan, active }: { plan: PlanProjection; active: boolean }): ReactElement | null {
  const progress = summarizePlan(plan.steps);
  if (!progress.total) return null;
  return <div className="process-plan" aria-label={`Plan, ${progress.completed} of ${progress.total} steps complete`}>
    <div className="process-plan-heading"><ListChecks aria-hidden="true" /><span>Plan</span><small>{progress.completed}/{progress.total}</small></div>
    <ol>{plan.steps.map((item, index) => <li key={`${index}:${item.step}`} data-state={item.status}>
      <span className="process-plan-mark" aria-hidden="true">{item.status === "completed" ? <Check /> : item.status === "in_progress" ? active ? <ActivityGlyph animated /> : <span className="plan-current-dot" /> : <Circle />}</span>
      <span>{item.step}</span>
      <span className="sr-only">{item.status === "completed" ? "Done" : item.status === "in_progress" ? "In progress" : "Pending"}</span>
    </li>)}</ol>
  </div>;
}

function RunProcess({
  runId,
  snapshot,
  segments,
  plan,
  toolOutput,
  nowMs,
  connection,
  view,
  files,
  sources
}: {
  runId: string;
  snapshot: RunSnapshot;
  segments: RunTimelineSegment[];
  plan: PlanProjection | undefined;
  toolOutput: Map<string, string>;
  nowMs: number;
  connection: ConnectionState;
  view: RunActivityPresentation;
  files: DownloadableFile[];
  sources: SourceProjection[];
}): ReactElement {
  const live = isActivelyWorkingStatus(snapshot.status) && connection === "open";
  const activities = segments.flatMap((segment) => segment.kind === "execution" ? segment.activities : []);
  const steps = activities.filter((activity) => activity.kind !== "error" && activity.kind !== "reasoning").length;
  const issues = activities.filter((activity) => {
    if (activity.kind === "error") return !activity.event.retryable;
    if (activity.kind !== "tool") return false;
    const outcome = toolOutcome(activity.projection);
    return outcome === "error" || outcome === "declined";
  }).length;
  const newestSequence = Math.max(0, ...activities.map((activity) => activity.kind === "reasoning" ? 0 : activity.kind === "tool" || activity.kind === "subagent" ? activity.projection.event.sequence : activity.event.sequence));
  const latestSegment = segments.at(-1);
  const activeReasoningPartId = live && latestSegment?.kind === "reasoning" ? latestSegment.projection.partId : undefined;
  const attentionAllowed = !isTerminalStatus(snapshot.status) || snapshot.status === "failed";

  const autoOpen = processShouldOpen(snapshot.status);
  const [open, setOpen] = useState(autoOpen);
  const previousOpenRef = useRef<{ runId: string; isRunning: boolean }>({ runId, isRunning: autoOpen });
  useEffect(() => {
    // A status change inside one phase keeps the reader's choice; only the
    // transition into or out of active work opens or collapses the log.
    const nextOpen = executionOpenTransition(previousOpenRef.current, { runId, isRunning: autoOpen });
    if (nextOpen !== undefined) setOpen(nextOpen);
    previousOpenRef.current = { runId, isRunning: autoOpen };
  }, [autoOpen, runId]);

  const summary = processSummary({ status: snapshot.status, steps, issues, elapsed: view.elapsed, liveHeadline: view.headline, connection });
  const StatusIcon = snapshot.status === "failed" ? CircleAlert : snapshot.status === "cancelled" ? CircleSlash : undefined;

  return <Collapsible className="run-process" open={open} onOpenChange={setOpen} data-status={snapshot.status} data-live={live}>
    <CollapsibleTrigger asChild>
      <button type="button" className="run-process-summary" aria-label={`${open ? "Hide" : "Show"} work log: ${summary.title}${summary.meta.length ? `, ${summary.meta.join(", ")}` : ""}`}>
        <span className="run-process-mark" aria-hidden="true">{live
          ? <ActivityGlyph animated />
          : StatusIcon ? <StatusIcon />
          : <svg viewBox="0 0 32 32" fill="none"><path d="M8 7h10a8 8 0 0 1 0 16H8V7Z" /><path d="M8 15h10M15 15l9 10M12 7v16" /></svg>}</span>
        <span className={live ? "run-process-title text-shimmer" : "run-process-title"}>{summary.title}</span>
        {summary.meta.map((item) => <span key={item} className={/issue/.test(item) ? "run-process-meta is-issue" : "run-process-meta"}>{item}</span>)}
        <ChevronDown className="run-process-chevron" aria-hidden="true" />
      </button>
    </CollapsibleTrigger>
    <CollapsibleContent className="run-process-body">
      {plan ? <PlanChecklist plan={plan} active={live} /> : null}
      <div className="run-process-steps">
        {segments.map((segment) => {
          if (segment.kind === "message") return <CommentaryStep key={`message-${segment.projection.partId}`} projection={segment.projection} files={files} sources={sources} isStreaming={live && !segment.projection.done} />;
          if (segment.kind === "reasoning") return <ReasoningStep key={`reasoning-${segment.projection.partId}`} projection={segment.projection} isStreaming={segment.projection.partId === activeReasoningPartId} />;
          return segment.activities.map((activity) => {
            if (activity.kind === "reasoning") return null;
            if (activity.kind === "tool") return <ToolStep key={`tool-${activity.projection.event.tool.callId}`} projection={activity.projection} output={activity.projection.event.tool.outputSummary ?? toolOutput.get(activity.projection.event.tool.callId)} nowMs={nowMs} live={live} attention={attentionAllowed && activity.projection.event.sequence === newestSequence} />;
            if (activity.kind === "subagent") return <SubagentStep key={`subagent-${activity.projection.event.subagent.subagentRunId}`} event={activity.projection.event} snapshot={snapshot} />;
            if (activity.kind === "file") return <FileStep key={`file-${activity.event.eventId}`} event={activity.event} />;
            if (activity.kind === "diff") return <DiffStep key={`diff-${activity.event.eventId}`} event={activity.event} />;
            return <ErrorStep key={`error-${activity.event.eventId}`} event={activity.event} />;
          });
        })}
      </div>
    </CollapsibleContent>
  </Collapsible>;
}

function ResponseMessage({ projection, role, isStreaming, files, sources }: {
  projection: AssistantMessageProjection;
  role: ReturnType<typeof messageReadingRole>;
  isStreaming: boolean;
  files: DownloadableFile[];
  sources: SourceProjection[];
}): ReactElement {
  return <div className={`run-response is-${role}`}>
    {role === "partial" ? <p className="run-response-note"><CircleAlert aria-hidden="true" />{projection.done ? "The run ended before the task finished. This is the agent's last message." : "Partial message. The run ended while this was being written."}</p> : null}
    <MessageContent className="assistant-response-text">
      <MessageResponse isAnimating={isStreaming}>{annotateSourceLinks(linkArtifactMarkdown(projection.text, files, workspaceApiBase), sources)}</MessageResponse>
    </MessageContent>
  </div>;
}

function TurnFooter({ snapshot, answer, copied, onCopy, elapsed, usage, showError }: {
  snapshot: RunSnapshot;
  answer: string | undefined;
  copied: boolean;
  onCopy: (answer: string) => void;
  elapsed: string;
  usage: UsageSummary | undefined;
  showError: boolean;
}): ReactElement {
  const footerRef = useRef<HTMLDivElement>(null);
  useGSAP(() => {
    const root = footerRef.current;
    if (!root) return;
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      gsap.timeline({ defaults: { ease: "power2.out" } })
        .fromTo(root, { autoAlpha: 0, y: 4 }, { autoAlpha: 1, y: 0, duration: 0.28, clearProps: "transform,opacity,visibility" })
        .fromTo(".turn-outcome > svg", { scale: 0.6 }, { scale: 1, duration: 0.36, ease: "back.out(2)", clearProps: "transform" }, "<0.04");
    }, root);
    return () => media.revert();
  }, { scope: footerRef });

  const status = snapshot.status;
  const tokenTotal = (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0);
  const outcome = status === "completed" ? { Icon: Check, label: "Completed" } : status === "failed" ? { Icon: CircleAlert, label: "Failed" } : { Icon: CircleSlash, label: "Stopped" };
  const meta = [modelLabel(snapshot.model), elapsed, tokenTotal ? `${tokenTotal.toLocaleString()} tokens` : undefined, formatTime(snapshot.updatedAt)].filter(Boolean).join(" · ");
  return <div ref={footerRef} className="turn-footer" data-status={status}>
    {answer ? <MessageActions className="turn-actions">
      <MessageAction className="turn-action" tooltip={copied ? "Copied" : "Copy response"} label={copied ? "Copied" : "Copy response"} onClick={() => onCopy(answer)}>{copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}</MessageAction>
    </MessageActions> : null}
    <span className="turn-outcome"><outcome.Icon aria-hidden="true" />{outcome.label}</span>
    <span className="turn-footer-meta">{meta}</span>
    {showError && snapshot.error ? <p className="turn-error" role="alert">{snapshot.error.message}</p> : null}
  </div>;
}

export function RunTurn({ run, copied, onCopy, connection }: { run: ConversationRunView; copied: boolean; onCopy: (runId: string, answer: string) => void; connection: ConnectionState }): ReactElement {
  const { answer, toolOutput, timeline, usage, files, plan, sources } = useMemo(() => projectRunEvents(run.events), [run.events]);
  const downloadableFiles = files.map((event) => event.file);
  const snapshot = run.snapshot;
  const isRunning = !isTerminalStatus(snapshot.status);
  const live = isActivelyWorkingStatus(snapshot.status) && connection === "open";
  const { view: activity, nowMs } = useRunActivity(run, connection);
  const segments = useMemo(() => segmentRunTimeline(timeline), [timeline]);
  const tailIndex = responseTailIndex(segments);
  const tailSegment = tailIndex >= 0 ? segments[tailIndex] : undefined;
  const tail = tailSegment?.kind === "message" ? tailSegment.projection : undefined;
  const processSegments = tailIndex >= 0 ? segments.filter((_, index) => index !== tailIndex) : segments;
  const tailRole = tail ? messageReadingRole(snapshot.status, true, tail.done) : "update";
  const hasProcess = processSegments.length > 0 || Boolean(plan && plan.steps.length);
  const hasErrorStep = processSegments.some((segment) => segment.kind === "execution" && segment.activities.some((item) => item.kind === "error"));

  return <section className="conversation-turn" data-run-id={run.runId} data-status={snapshot.status} aria-busy={live}>
    <Message from="user" className="openrigor-message user-turn">
      <MessageContent className="user-bubble">{run.visiblePrompt}</MessageContent>
      <div className="turn-meta"><time dateTime={snapshot.createdAt}>{formatTime(snapshot.createdAt)}</time></div>
    </Message>

    <Message from="assistant" className="openrigor-message assistant-turn">
      {hasProcess ? <RunProcess runId={snapshot.runId} snapshot={snapshot} segments={processSegments} plan={plan} toolOutput={toolOutput} nowMs={nowMs} connection={connection} view={activity} files={downloadableFiles} sources={sources} /> : null}
      {tail ? <ResponseMessage projection={tail} role={tailRole} isStreaming={live && !tail.done} files={downloadableFiles} sources={sources} /> : null}
      <ResearchDeliverables files={downloadableFiles} />
      <ResearchSources sources={sources} answer={answer} />
      {isRunning ? <RunActivityIndicator view={activity} /> : <TurnFooter snapshot={snapshot} answer={tail?.text} copied={copied} onCopy={(text) => onCopy(run.runId, text)} elapsed={activity.elapsed} usage={usage} showError={!hasErrorStep} />}
      <RunRequestPanel runId={snapshot.runId} status={snapshot.status} />
    </Message>
  </section>;
}
