import { projectRunEvents, segmentRunTimeline, type ConversationRunView } from "../../conversation";
import type { RunActivityConnection, RunActivityContext } from "../../run-presentation";
import { toolReadingTitle } from "./run-reading";

/** A completed tool list is a record of past work, not the model's current activity. */
export function runActivityContext(run: ConversationRunView, connection: RunActivityConnection): RunActivityContext {
  const last = segmentRunTimeline(projectRunEvents(run.events).timeline).at(-1);
  if (last?.kind === "execution") {
    const pending = last.activities.filter((activity) => activity.kind === "tool" && (activity.projection.event.tool.phase === "running" || activity.projection.event.tool.phase === "requested")).at(-1);
    if (pending?.kind === "tool") return { connection, stage: "tool", detail: toolReadingTitle(pending.projection.event.tool) };
  }
  if (last?.kind === "reasoning") return { connection, stage: "reasoning" };
  if (last?.kind === "message" && !last.projection.done) return { connection, stage: "answer" };
  return { connection, stage: "working" };
}
