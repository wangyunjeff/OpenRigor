import assert from "node:assert/strict";
import test from "node:test";
import type { RunEvent } from "@openrigor/protocol";
import type { ConversationRunView } from "../src/conversation";
import { runActivityContext } from "../src/features/chat/run-activity-model";

const time = "2026-10-22T06:00:00Z";
const base = { runId: "run_activity", ts: time };
function run(events: RunEvent[]): ConversationRunView {
  return { runId: base.runId, visiblePrompt: "Review a paper", snapshot: { runId: base.runId, status: "running", prompt: "Review a paper", model: "auto", mode: "standard", effort: "medium", createdAt: time, updatedAt: time, progress: 0 }, events };
}
const requested: RunEvent = { ...base, sequence: 1, eventId: "1", type: "tool", tool: { callId: "search", name: "web.search", phase: "requested", inputSummary: '{"title":"核对论文原文"}' } };
const finished: RunEvent = { ...base, sequence: 2, eventId: "2", type: "tool", tool: { callId: "search", name: "web.search", phase: "succeeded" } };

test("active tool context names the real tool, while its completed record cannot remain live", () => {
  assert.deepEqual(runActivityContext(run([requested]), "open"), { connection: "open", stage: "tool", detail: "核对论文原文" });
  assert.deepEqual(runActivityContext(run([requested, finished]), "open"), { connection: "open", stage: "working" });
});

test("message generation stops being a live stage when the authoritative part completes", () => {
  const delta: RunEvent = { ...base, sequence: 1, eventId: "1", type: "part-delta", partId: "answer:a", kind: "text", delta: "Checking" };
  const done: RunEvent = { ...base, sequence: 2, eventId: "2", type: "part", part: { partId: "answer:a", kind: "text", text: "Checking", done: true } };
  assert.equal(runActivityContext(run([delta]), "open").stage, "answer");
  assert.equal(runActivityContext(run([delta, done]), "open").stage, "working");
});

test("reasoning stage and disconnected context preserve their distinct signals", () => {
  const event: RunEvent = { ...base, sequence: 1, eventId: "1", type: "part-delta", partId: "reasoning:a", kind: "reasoning", delta: "Inspect the evidence" };
  assert.deepEqual(runActivityContext(run([event]), "closed"), { connection: "closed", stage: "reasoning" });
  assert.deepEqual(runActivityContext(run([]), "connecting"), { connection: "connecting", stage: "working" });
});
