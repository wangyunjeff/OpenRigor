import type { RunEvent, RunSnapshot } from "@openrigor/protocol";

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

export interface RunProjection {
  answer: string;
  reasoning: string;
  toolOutput: Map<string, string>;
  tools: ToolProjection[];
  diffs: Array<Extract<RunEvent, { type: "part" }>>;
  files: Array<Extract<RunEvent, { type: "file" }>>;
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
  const toolOutput = new Map<string, string>();
  const projectedTools = new Map<string, ToolProjection>();
  const diffs: RunProjection["diffs"] = [];
  const files: RunProjection["files"] = [];

  events.forEach((event, index) => {
    if (event.type === "part-delta") {
      if (event.partId.startsWith("tool:")) {
        const callId = event.partId.slice(5);
        toolOutput.set(callId, `${toolOutput.get(callId) ?? ""}${event.delta}`);
      } else if (event.kind === "text") {
        answerParts.set(event.partId, `${answerParts.get(event.partId) ?? ""}${event.delta}`);
      } else {
        reasoningParts.set(event.partId, `${reasoningParts.get(event.partId) ?? ""}${event.delta}`);
      }
      return;
    }

    if (event.type === "part") {
      if (event.part.partId.startsWith("diff:")) {
        diffs.push(event);
      } else if (event.part.kind === "text" && !answerParts.has(event.part.partId)) {
        answerParts.set(event.part.partId, event.part.text);
      } else if (event.part.kind === "reasoning" && !reasoningParts.has(event.part.partId)) {
        reasoningParts.set(event.part.partId, event.part.text);
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
      return;
    }

    if (event.type === "file") files.push(event);
  });

  return {
    answer: [...answerParts.values()].join("\n\n"),
    reasoning: [...reasoningParts.values()].join("\n\n"),
    toolOutput,
    tools: [...projectedTools.values()].sort((left, right) => left.firstIndex - right.firstIndex),
    diffs,
    files
  };
}

function dedupeAndSortEvents(events: RunEvent[]): RunEvent[] {
  const byId = new Map<string, RunEvent>();
  for (const event of events) if (!byId.has(event.eventId)) byId.set(event.eventId, event);
  return [...byId.values()].sort((left, right) => left.sequence - right.sequence);
}
