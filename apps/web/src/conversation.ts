import type { RunEvent, RunSnapshot, UsageSummary } from "@openrigor/protocol";

export type ConversationRunSnapshot = RunSnapshot & {
  conversationId?: string;
  rootRunId?: string;
  parentRunId?: string;
};

export interface ConversationRunView {
  runId: string;
  visiblePrompt: string;
  snapshot: ConversationRunSnapshot;
  events: RunEvent[];
}

export interface ConversationViewState {
  conversationId: string;
  rootRunId: string;
  runs: ConversationRunView[];
}

export interface ConversationRestorePayload {
  snapshot?: ConversationRunSnapshot;
  events?: RunEvent[];
  conversation?: {
    conversationId: string;
    rootRunId: string;
    runs: Array<{ snapshot: ConversationRunSnapshot; events: RunEvent[] }>;
  };
}

export interface ToolProjection {
  event: Extract<RunEvent, { type: "tool" }>;
  firstAt: string;
  lastAt: string;
  firstIndex: number;
}

export interface SubagentProjection {
  event: Extract<RunEvent, { type: "subagent" }>;
  firstIndex: number;
}

export interface ReasoningProjection {
  /** Provider part id; separate blocks keep the activity rail chronological. */
  partId: string;
  text: string;
  firstAt: string;
  lastAt: string;
  firstIndex: number;
}

export type RunActivity =
  | { kind: "reasoning"; projection: ReasoningProjection }
  | { kind: "tool"; projection: ToolProjection }
  | { kind: "subagent"; projection: SubagentProjection }
  | { kind: "file"; event: Extract<RunEvent, { type: "file" }>; firstIndex: number }
  | { kind: "diff"; event: Extract<RunEvent, { type: "part" }>; firstIndex: number }
  | { kind: "error"; event: Extract<RunEvent, { type: "error" }>; firstIndex: number };

export interface RunProjection {
  answer: string;
  reasoning: string;
  reasoningProjection?: ReasoningProjection;
  toolOutput: Map<string, string>;
  tools: ToolProjection[];
  diffs: Array<Extract<RunEvent, { type: "part" }>>;
  files: Array<Extract<RunEvent, { type: "file" }>>;
  subagents: SubagentProjection[];
  errors: Array<Extract<RunEvent, { type: "error" }>>;
  /** Activities ordered by their first provider event, with tool lifecycles merged. */
  activities: RunActivity[];
  usage: UsageSummary | undefined;
}

export function cleanHistoryPrompt(prompt: string): string {
  const marker = prompt.lastIndexOf("\n\nTask:\n");
  return marker >= 0 ? prompt.slice(marker + "\n\nTask:\n".length) : prompt;
}

export function restoreConversation(payload: ConversationRestorePayload): ConversationViewState | null {
  const restoredRuns = payload.conversation?.runs?.length
    ? payload.conversation.runs
    : payload.snapshot
      ? [{ snapshot: payload.snapshot, events: payload.events ?? [] }]
      : [];
  const first = restoredRuns[0];
  if (!first) return null;

  const rootRunId = payload.conversation?.rootRunId ?? first.snapshot.rootRunId ?? first.snapshot.runId;
  const conversationId = payload.conversation?.conversationId ?? first.snapshot.conversationId ?? rootRunId;
  return {
    conversationId,
    rootRunId,
    runs: restoredRuns.map(({ snapshot, events }) => ({
      runId: snapshot.runId,
      visiblePrompt: cleanHistoryPrompt(snapshot.prompt),
      snapshot,
      events: dedupeAndSortEvents(events.filter((event) => event.runId === snapshot.runId))
    }))
  };
}

export function applyRunEvent(conversation: ConversationViewState, event: RunEvent): ConversationViewState {
  const runIndex = conversation.runs.findIndex((run) => run.runId === event.runId);
  if (runIndex < 0) {
    if (event.type !== "snapshot") return conversation;
    const snapshot = event.snapshot as ConversationRunSnapshot;
    if ((snapshot.rootRunId ?? snapshot.runId) !== conversation.rootRunId) return conversation;
    return {
      ...conversation,
      runs: [...conversation.runs, {
        runId: snapshot.runId,
        visiblePrompt: cleanHistoryPrompt(snapshot.prompt),
        snapshot,
        events: [event]
      }]
    };
  }

  const currentRun = conversation.runs[runIndex];
  if (!currentRun) return conversation;
  const lastSequence = currentRun.events.at(-1)?.sequence ?? 0;
  if (event.sequence <= lastSequence || currentRun.events.some((item) => item.eventId === event.eventId)) return conversation;

  let snapshot = currentRun.snapshot;
  if (event.type === "snapshot") {
    snapshot = event.snapshot as ConversationRunSnapshot;
  } else if (event.type === "status") {
    snapshot = {
      ...snapshot,
      status: event.status,
      progress: event.progress ?? snapshot.progress,
      updatedAt: event.ts,
      ...(event.currentStep === undefined ? {} : { currentStep: event.currentStep })
    };
  } else if (event.type === "run-finished") {
    snapshot = {
      ...snapshot,
      status: event.status,
      progress: event.status === "completed" ? 100 : snapshot.progress,
      currentStep: event.status === "completed" ? "已完成" : event.status === "cancelled" ? "已停止" : "执行失败",
      updatedAt: event.ts
    };
  }

  const nextRuns = conversation.runs.slice();
  nextRuns[runIndex] = { ...currentRun, snapshot, events: [...currentRun.events, event] };
  return { ...conversation, runs: nextRuns };
}

export function projectRunEvents(events: RunEvent[]): RunProjection {
  const answerParts = new Map<string, string>();
  const reasoningParts = new Map<string, string>();
  const reasoningMeta = new Map<string, { firstAt: string; lastAt: string; firstIndex: number }>();
  const toolOutput = new Map<string, string>();
  const projectedTools = new Map<string, ToolProjection>();
  const projectedSubagents = new Map<string, SubagentProjection>();
  const diffs: RunProjection["diffs"] = [];
  const files: RunProjection["files"] = [];
  const errors: RunProjection["errors"] = [];
  const activities = new Map<string, RunActivity>();
  let usage: UsageSummary | undefined;

  const recordReasoning = (partId: string, text: string, event: RunEvent, index: number, append: boolean): void => {
    if (append) reasoningParts.set(partId, `${reasoningParts.get(partId) ?? ""}${text}`);
    else if (!reasoningParts.has(partId)) reasoningParts.set(partId, text);
    const previous = reasoningMeta.get(partId);
    reasoningMeta.set(partId, {
      firstAt: previous?.firstAt ?? event.ts,
      lastAt: event.ts,
      firstIndex: previous?.firstIndex ?? index
    });
  };

  events.forEach((event, index) => {
    if (event.type === "part-delta") {
      if (event.partId.startsWith("tool:")) {
        const callId = event.partId.slice(5);
        toolOutput.set(callId, `${toolOutput.get(callId) ?? ""}${event.delta}`);
      } else if (event.kind === "text") {
        answerParts.set(event.partId, `${answerParts.get(event.partId) ?? ""}${event.delta}`);
      } else {
        recordReasoning(event.partId, event.delta, event, index, true);
      }
      return;
    }

    if (event.type === "part") {
      if (event.part.partId.startsWith("diff:")) {
        diffs.push(event);
        // Codex emits a new `part` for every diff refresh. Keep one activity
        // row per file while replacing its body with the latest revision.
        const activityKey = `diff:${event.part.partId}`;
        const previous = activities.get(activityKey);
        activities.set(activityKey, {
          kind: "diff",
          event,
          firstIndex: previous?.kind === "diff" ? previous.firstIndex : index
        });
      } else if (event.part.kind === "text" && !answerParts.has(event.part.partId)) {
        answerParts.set(event.part.partId, event.part.text);
      } else if (event.part.kind === "reasoning" && !reasoningParts.has(event.part.partId)) {
        recordReasoning(event.part.partId, event.part.text, event, index, false);
      }
      return;
    }

    if (event.type === "tool") {
      const existing = projectedTools.get(event.tool.callId);
      projectedTools.set(event.tool.callId, {
        event,
        firstAt: existing?.firstAt ?? event.ts,
        lastAt: event.ts,
        firstIndex: existing?.firstIndex ?? index
      });
      const projection = projectedTools.get(event.tool.callId);
      if (projection) activities.set(`tool:${event.tool.callId}`, { kind: "tool", projection });
      return;
    }

    if (event.type === "file") {
      files.push(event);
      activities.set(`file:${event.eventId}`, { kind: "file", event, firstIndex: index });
      return;
    }

    if (event.type === "subagent") {
      const existing = projectedSubagents.get(event.subagent.subagentRunId);
      projectedSubagents.set(event.subagent.subagentRunId, {
        event,
        firstIndex: existing?.firstIndex ?? index
      });
      const projection = projectedSubagents.get(event.subagent.subagentRunId);
      if (projection) activities.set(`subagent:${event.subagent.subagentRunId}`, { kind: "subagent", projection });
      return;
    }

    if (event.type === "error") {
      errors.push(event);
      activities.set(`error:${event.eventId}`, { kind: "error", event, firstIndex: index });
      return;
    }

    if (event.type === "run-finished") usage = event.usage;
  });

  const reasoningBlocks = [...reasoningParts.entries()]
    .map(([partId, text]) => {
      const meta = reasoningMeta.get(partId);
      return meta ? { partId, text, ...meta } : undefined;
    })
    .filter((block): block is ReasoningProjection => block !== undefined && block.text.length > 0)
    .sort((left, right) => left.firstIndex - right.firstIndex);
  const reasoning = reasoningBlocks.map((block) => block.text).join("\n\n");
  const firstReasoning = reasoningBlocks[0];
  const lastReasoning = reasoningBlocks.at(-1);
  const reasoningProjection = firstReasoning && lastReasoning
    ? reasoningBlocks.length === 1
      ? firstReasoning
      : {
          partId: "reasoning",
          text: reasoning,
          firstAt: firstReasoning.firstAt,
          lastAt: lastReasoning.lastAt,
          firstIndex: firstReasoning.firstIndex
        }
    : undefined;
  for (const block of reasoningBlocks) activities.set(`reasoning:${block.partId}`, { kind: "reasoning", projection: block });

  return {
    answer: [...answerParts.values()].join("\n\n"),
    reasoning,
    ...(reasoningProjection === undefined ? {} : { reasoningProjection }),
    toolOutput,
    tools: [...projectedTools.values()].sort((left, right) => left.firstIndex - right.firstIndex),
    diffs,
    files,
    subagents: [...projectedSubagents.values()].sort((left, right) => left.firstIndex - right.firstIndex),
    errors,
    activities: [...activities.values()].sort((left, right) => {
      const leftIndex = left.kind === "tool" || left.kind === "subagent" ? left.projection.firstIndex : left.kind === "reasoning" ? left.projection.firstIndex : left.firstIndex;
      const rightIndex = right.kind === "tool" || right.kind === "subagent" ? right.projection.firstIndex : right.kind === "reasoning" ? right.projection.firstIndex : right.firstIndex;
      return leftIndex - rightIndex;
    }),
    usage
  };
}

function dedupeAndSortEvents(events: RunEvent[]): RunEvent[] {
  const byId = new Map<string, RunEvent>();
  for (const event of events) if (!byId.has(event.eventId)) byId.set(event.eventId, event);
  return [...byId.values()].sort((left, right) => left.sequence - right.sequence);
}
