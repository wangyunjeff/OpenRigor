import { useMemo, type ReactElement } from "react";
import type { RunSnapshot } from "@openrigor/protocol";
import { ArrowUpRight, Check, ChevronDown, Circle, CircleDot, FileText, Files, GitBranch, Globe2, ListChecks } from "lucide-react";
import { projectRunEvents, type ConversationRunView } from "../../conversation";
import { artifactSizeLabel, safeWebUrl, sourceDomain } from "../chat/ai-elements-adapter";
import type { PreviewFile } from "./file-preview-model";
import "./preview-overview.css";

export interface PreviewOverviewProps {
  runs: ConversationRunView[];
  onOpenFile: (file: PreviewFile) => void;
  onOpenWeb: (url: string, title?: string) => void;
}

const statusLabels: Record<RunSnapshot["status"], string> = {
  queued: "Queued", running: "Running", waiting_tool: "Waiting for tool", waiting_user: "Waiting for you",
  cancelling: "Stopping", completed: "Completed", failed: "Failed", cancelled: "Stopped"
};

function tokenLabel(value: number | undefined): string | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value.toLocaleString() : null;
}

/** Every section is a projection of the latest turn; completion never rewrites its reported plan. */
export function PreviewOverview({ runs, onOpenFile, onOpenWeb }: PreviewOverviewProps): ReactElement {
  const latest = runs.at(-1);
  const projection = useMemo(() => latest ? projectRunEvents(latest.events) : null, [latest]);
  if (!latest || !projection) return <section className="preview-overview preview-overview-empty"><span className="overview-eyebrow">TASK OVERVIEW</span><h2>A place for your work</h2><p>Your task’s plan, files, sources and recorded usage appear here as the agent works.</p><div className="overview-empty-mark"><ListChecks aria-hidden="true" /></div><p>Start a conversation to build this overview.</p></section>;

  const files: PreviewFile[] = projection.files.map(({ file, runId }) => ({ ...file, runId, origin: "artifact" }));
  const sources = projection.sources.filter((source) => safeWebUrl(source.url));
  const agents = projection.subagents.map(({ event }) => event.subagent);
  const plan = projection.plan;
  const finished = latest.events.some((event) => event.type === "run-finished");
  const inputTokens = finished ? tokenLabel(projection.usage?.inputTokens) : null;
  const outputTokens = finished ? tokenLabel(projection.usage?.outputTokens) : null;
  const hasUsage = inputTokens !== null || outputTokens !== null;
  const recordedAt = new Date(latest.snapshot.updatedAt);
  const updated = Number.isNaN(recordedAt.getTime()) ? null : recordedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return <section className="preview-overview" aria-label="Task overview">
    <header className="overview-intro"><span className="overview-eyebrow">TASK OVERVIEW</span><div className="overview-heading"><h2>Your task at a glance</h2><span className="overview-status" data-status={latest.snapshot.status}><span aria-hidden="true" />{statusLabels[latest.snapshot.status]}</span></div><p className="overview-task-prompt" title={latest.visiblePrompt}>{latest.visiblePrompt}</p><div className="overview-turn-meta"><span>Latest turn · {runs.length} {runs.length === 1 ? "turn" : "turns"} in this task</span>{updated && <span>Updated {updated}</span>}</div></header>

    <dl className="overview-counts"><div><dt><Files aria-hidden="true" />Files</dt><dd>{files.length}</dd></div><div><dt><Globe2 aria-hidden="true" />Sources</dt><dd>{sources.length}</dd></div><div><dt><GitBranch aria-hidden="true" />Agents</dt><dd>{agents.length}</dd></div></dl>

    <details className="overview-section" open><summary><ListChecks aria-hidden="true" /><strong>Plan</strong><span>{plan?.steps.length ? plan.steps.filter((step) => step.status === "completed").length + " / " + plan.steps.length : "Not reported"}</span><ChevronDown className="overview-chevron" aria-hidden="true" /></summary><div className="overview-section-body">{plan?.steps.length ? <>{plan.explanation && <p className="overview-description">{plan.explanation}</p>}<ol className="overview-plan">{plan.steps.map((item, index) => <li key={index + ":" + item.step} data-state={item.status}><span className="overview-step-icon" aria-hidden="true">{item.status === "completed" ? <Check /> : item.status === "in_progress" ? <CircleDot /> : <Circle />}</span><div><span>{item.step}</span><small>{item.status === "completed" ? "Completed" : item.status === "in_progress" ? "In progress" : "Pending"}</small></div></li>)}</ol><p className="overview-note">Plan states are shown as last reported by the agent.</p></> : <p className="overview-description">The agent has not reported a structured plan for this turn.</p>}</div></details>

    <details className="overview-section" open={files.length > 0}><summary><Files aria-hidden="true" /><strong>Files</strong><span>{files.length}</span><ChevronDown className="overview-chevron" aria-hidden="true" /></summary><div className="overview-section-body">{files.length ? <ul className="overview-record-list overview-files">{files.map((file) => <li key={file.runId + ":" + file.fileId}><button type="button" onClick={() => onOpenFile(file)}><FileText aria-hidden="true" /><span><strong>{file.name.split(/[\\/]/).at(-1)}</strong><small>{file.path ?? file.name} · Revision {file.revision}{artifactSizeLabel(file.sizeBytes) ? " · " + artifactSizeLabel(file.sizeBytes) : ""}</small></span><ArrowUpRight aria-hidden="true" /></button></li>)}</ul> : <p className="overview-description">No saved files have been reported for this turn.</p>}</div></details>

    <details className="overview-section"><summary><Globe2 aria-hidden="true" /><strong>Sources</strong><span>{sources.length}</span><ChevronDown className="overview-chevron" aria-hidden="true" /></summary><div className="overview-section-body">{sources.length ? <><p className="overview-note">Search links and access attempts do not confirm that a page was retrieved.</p><ul className="overview-record-list overview-sources">{sources.map((source) => <li key={source.sourceId}><button type="button" onClick={() => onOpenWeb(source.url, source.title)}><Globe2 aria-hidden="true" /><span><small>{sourceDomain(source.url)}<em>{source.kind === "page-request" ? "Access attempt" : source.kind === "search-result" ? "Search result" : "Search link"}</em></small><strong>{source.title || sourceDomain(source.url)}</strong>{source.snippet && <span className="overview-source-snippet">{source.snippet}</span>}</span><ArrowUpRight aria-hidden="true" /></button></li>)}</ul></> : <p className="overview-description">No structured search sources have been reported for this turn.</p>}</div></details>

    {agents.length > 0 && <details className="overview-section"><summary><GitBranch aria-hidden="true" /><strong>Subagents</strong><span>{agents.length}</span><ChevronDown className="overview-chevron" aria-hidden="true" /></summary><div className="overview-section-body"><p className="overview-note">Latest recorded status for each reported subagent.</p><ul className="overview-agent-list">{agents.map((agent) => <li key={agent.subagentRunId}><GitBranch aria-hidden="true" /><strong>{agent.label || "Subagent"}</strong><span className="overview-status" data-status={agent.status}><span aria-hidden="true" />{statusLabels[agent.status]}</span></li>)}</ul></div></details>}

    <section className="overview-usage" aria-label="Recorded usage"><div><h3>Recorded usage</h3><span>Latest turn</span></div>{hasUsage ? <><dl><div><dt>Input tokens</dt><dd>{inputTokens ?? "Not reported"}</dd></div><div><dt>Output tokens</dt><dd>{outputTokens ?? "Not reported"}</dd></div></dl><p className="overview-note">Reported by the runtime when this turn finished.</p></> : <p className="overview-description">{finished ? "The runtime did not report token usage for this turn." : "Token usage appears when the runtime reports it at the end of the turn."}</p>}</section>
  </section>;
}
