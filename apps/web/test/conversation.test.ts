import assert from "node:assert/strict";
import test from "node:test";
import type { RunEvent, RunSnapshot } from "@openrigor/protocol";
import { applyRunEvent, projectRunEvents, restoreConversation, segmentRunTimeline } from "../src/conversation.ts";

function snapshot(runId: string, prompt: string, parentRunId?: string): RunSnapshot {
  return {
    runId,
    conversationId: "conversation_1",
    rootRunId: "run_root",
    ...(parentRunId === undefined ? {} : { parentRunId }),
    status: "completed",
    prompt,
    model: "auto",
    mode: "standard",
    effort: "balanced",
    createdAt: "2026-08-10T00:00:00.000Z",
    updatedAt: "2026-08-10T00:00:01.000Z",
    progress: 100
  };
}

function eventBase(runId: string, sequence: number) {
  return {
    protocolVersion: 0 as const,
    eventId: `${runId}:${sequence}`,
    runId,
    sequence,
    ts: `2026-08-10T00:00:0${sequence}.000Z`
  };
}

test("restores the complete ordered run chain and keeps each visible prompt", () => {
  const root = snapshot("run_root", "Use this skill.\n\nTask:\nInspect the repo");
  const child = snapshot("run_child", "User preferences:\nBe concise.\n\nTask:\nNow fix the tests", "run_root");
  const restored = restoreConversation({
    snapshot: child,
    events: [],
    conversation: {
      conversationId: "conversation_1",
      rootRunId: "run_root",
      runs: [
        { snapshot: root, events: [] },
        { snapshot: child, events: [] }
      ]
    }
  });

  assert.ok(restored);
  assert.equal(restored.rootRunId, "run_root");
  assert.deepEqual(restored.runs.map((run) => run.runId), ["run_root", "run_child"]);
  assert.deepEqual(restored.runs.map((run) => run.visiblePrompt), ["Inspect the repo", "Now fix the tests"]);
});

test("applies events only to their run and ignores at-least-once duplicates", () => {
  const root = snapshot("run_root", "First turn");
  const child = { ...snapshot("run_child", "Follow up", "run_root"), status: "running" as const, progress: 10 };
  const restored = restoreConversation({
    conversation: {
      conversationId: "conversation_1",
      rootRunId: "run_root",
      runs: [{ snapshot: root, events: [] }, { snapshot: child, events: [] }]
    }
  });
  assert.ok(restored);

  const statusEvent: RunEvent = {
    ...eventBase("run_child", 2),
    type: "status",
    status: "waiting_tool",
    progress: 45,
    currentStep: "Running tests"
  };
  const updated = applyRunEvent(restored, statusEvent);
  assert.equal(updated.runs[0]?.snapshot.status, "completed");
  assert.equal(updated.runs[1]?.snapshot.status, "waiting_tool");
  assert.equal(updated.runs[1]?.events.length, 1);
  assert.equal(applyRunEvent(updated, statusEvent), updated);

  const finished: RunEvent = { ...eventBase("run_child", 3), type: "run-finished", status: "completed" };
  const completed = applyRunEvent(updated, finished);
  assert.equal(completed.runs[1]?.snapshot.status, "completed");
  assert.equal(completed.runs[1]?.snapshot.progress, 100);
  assert.equal(completed.runs[0]?.events.length, 0);
});

test("projects answer, reasoning, tool output, files, and diffs per run", () => {
  const events: RunEvent[] = [
    { ...eventBase("run_child", 1), type: "part-delta", partId: "answer", kind: "text", delta: "Hello " },
    { ...eventBase("run_child", 2), type: "part-delta", partId: "answer", kind: "text", delta: "world" },
    { ...eventBase("run_child", 3), type: "part", part: { partId: "reasoning", kind: "reasoning", text: "Checked state" } },
    { ...eventBase("run_child", 4), type: "tool", tool: { callId: "call_1", name: "shell", phase: "running" } },
    { ...eventBase("run_child", 5), type: "part-delta", partId: "tool:call_1", kind: "text", delta: "ok" },
    { ...eventBase("run_child", 6), type: "tool", tool: { callId: "call_1", name: "shell", phase: "succeeded", outcome: "success", durationMs: 120 } },
    { ...eventBase("run_child", 7), type: "file", file: { fileId: "file_1", name: "report.md", mimeType: "text/markdown", revision: 1 } },
    { ...eventBase("run_child", 8), type: "part", part: { partId: "diff:report.md", kind: "text", text: "+done" } },
    { ...eventBase("run_child", 9), type: "subagent", subagent: { subagentRunId: "sub_1", label: "Luna reviewer", status: "running", parentRunId: "run_child" } },
    { ...eventBase("run_child", 10), type: "subagent", subagent: { subagentRunId: "sub_1", label: "Luna reviewer", status: "completed", parentRunId: "run_child" } },
    { ...eventBase("run_child", 11), type: "error", code: "tool_warning", message: "Recovered warning", retryable: true },
    { ...eventBase("run_child", 12), type: "run-finished", status: "completed", usage: { inputTokens: 20, outputTokens: 10 } }
  ];

  const projection = projectRunEvents(events);
  assert.equal(projection.answer, "Hello world");
  assert.deepEqual(projection.messages.map((message) => message.text), ["Hello world"]);
  assert.equal(projection.reasoning, "Checked state");
  assert.equal(projection.tools.length, 1);
  assert.equal(projection.tools[0]?.event.tool.phase, "succeeded");
  assert.equal(projection.toolOutput.get("call_1"), "ok");
  assert.equal(projection.files[0]?.file.name, "report.md");
  assert.equal(projection.diffs[0]?.part.partId, "diff:report.md");
  assert.equal(projection.subagents.length, 1);
  assert.equal(projection.subagents[0]?.event.subagent.status, "completed");
  assert.equal(projection.errors[0]?.message, "Recovered warning");
  assert.equal(projection.activities.map((activity) => activity.kind).join(","), "reasoning,tool,file,diff,subagent,error");
  assert.equal(projection.timeline.map((activity) => activity.kind).join(","), "message,reasoning,tool,file,diff,subagent,error");
  assert.deepEqual(segmentRunTimeline(projection.timeline).map((segment) => segment.kind), ["message", "reasoning", "execution"]);
  assert.equal(projection.activities.find((activity) => activity.kind === "tool")?.kind, "tool");
  assert.equal(projection.activities.find((activity) => activity.kind === "tool" && activity.projection.event.tool.callId === "call_1")?.projection.event.tool.durationMs, 120);
  assert.deepEqual(projection.usage, { inputTokens: 20, outputTokens: 10 });
});

test("keeps interleaved activities in first-seen order while merging tool updates", () => {
  const events: RunEvent[] = [
    { ...eventBase("run_child", 1), type: "tool", tool: { callId: "search", name: "command.execute", phase: "requested" } },
    { ...eventBase("run_child", 2), type: "part-delta", partId: "reasoning:one", kind: "reasoning", delta: "think" },
    { ...eventBase("run_child", 3), type: "tool", tool: { callId: "search", name: "command.execute", phase: "succeeded", outcome: "no-result", exitCode: 1 } },
    { ...eventBase("run_child", 4), type: "error", code: "CODEX_ERROR", message: "recoverable", retryable: true },
    { ...eventBase("run_child", 5), type: "part-delta", partId: "reasoning:one", kind: "reasoning", delta: " more" }
  ];
  const projection = projectRunEvents(events);
  assert.deepEqual(projection.activities.map((activity) => activity.kind), ["tool", "reasoning", "error"]);
  assert.deepEqual(segmentRunTimeline(projection.timeline).map((segment) => segment.kind), ["execution", "reasoning", "execution"]);
  const tool = projection.activities[0];
  assert.equal(tool?.kind, "tool");
  if (tool?.kind === "tool") {
    assert.equal(tool.projection.event.tool.phase, "succeeded");
    assert.equal(tool.projection.event.tool.outcome, "no-result");
  }
  assert.equal(projection.reasoningProjection?.text, "think more");
});

test("keeps separate reasoning blocks at their provider positions", () => {
  const events: RunEvent[] = [
    { ...eventBase("run_child", 1), ts: "2026-08-10T00:00:01.000Z", type: "part-delta", partId: "reasoning:before", kind: "reasoning", delta: "before" },
    { ...eventBase("run_child", 2), ts: "2026-08-10T00:00:02.000Z", type: "tool", tool: { callId: "search", name: "command.execute", phase: "running" } },
    { ...eventBase("run_child", 3), ts: "2026-08-10T00:00:03.000Z", type: "tool", tool: { callId: "search", name: "command.execute", phase: "succeeded", outcome: "success" } },
    { ...eventBase("run_child", 4), ts: "2026-08-10T00:00:04.000Z", type: "part-delta", partId: "reasoning:after", kind: "reasoning", delta: "after" }
  ];

  const projection = projectRunEvents(events);
  assert.deepEqual(projection.activities.map((activity) => activity.kind), ["reasoning", "tool", "reasoning"]);
  const reasoningActivities = projection.activities.filter((activity) => activity.kind === "reasoning");
  assert.deepEqual(reasoningActivities.map((activity) => activity.projection.partId), ["reasoning:before", "reasoning:after"]);
  assert.equal(reasoningActivities[0]?.projection.firstAt, "2026-08-10T00:00:01.000Z");
  assert.equal(reasoningActivities[0]?.projection.lastAt, "2026-08-10T00:00:01.000Z");
  assert.equal(reasoningActivities[1]?.projection.firstAt, "2026-08-10T00:00:04.000Z");
  assert.equal(projection.reasoning, "before\n\nafter");
  assert.deepEqual(segmentRunTimeline(projection.timeline).map((segment) => segment.kind), ["reasoning", "execution", "reasoning"]);
});

test("coalesces repeated diff refreshes into one latest activity", () => {
  const events: RunEvent[] = [
    { ...eventBase("run_child", 1), type: "part", part: { partId: "diff:src/app.tsx", kind: "text", text: "-old", done: false } },
    { ...eventBase("run_child", 2), type: "part", part: { partId: "diff:src/app.tsx", kind: "text", text: "+new", done: true } }
  ];

  const projection = projectRunEvents(events);
  const diffActivities = projection.activities.filter((activity) => activity.kind === "diff");
  assert.equal(diffActivities.length, 1);
  assert.equal(diffActivities[0]?.kind, "diff");
  if (diffActivities[0]?.kind === "diff") assert.equal(diffActivities[0].event.part.text, "+new");
});

test("keeps provider messages around tools as separate chronological timeline blocks", () => {
  const events: RunEvent[] = [
    { ...eventBase("run_child", 1), type: "part-delta", partId: "answer:item_before", kind: "text", delta: "I will inspect this." },
    { ...eventBase("run_child", 2), type: "part", part: { partId: "answer:item_before", kind: "text", text: "I will inspect this.", done: true } },
    { ...eventBase("run_child", 3), type: "tool", tool: { callId: "inspect", name: "command.execute", phase: "running" } },
    { ...eventBase("run_child", 4), type: "tool", tool: { callId: "inspect", name: "command.execute", phase: "succeeded", outcome: "success" } },
    { ...eventBase("run_child", 5), type: "part-delta", partId: "answer:item_final", kind: "text", delta: "Inspection complete." },
    { ...eventBase("run_child", 6), type: "part", part: { partId: "answer:item_final", kind: "text", text: "Inspection complete.", done: true } }
  ];

  const projection = projectRunEvents(events);
  assert.equal(projection.answer, "Inspection complete.");
  assert.deepEqual(projection.messages.map((message) => message.partId), ["answer:item_before", "answer:item_final"]);
  assert.deepEqual(projection.timeline.map((item) => item.kind), ["message", "tool", "message"]);
  const segments = segmentRunTimeline(projection.timeline);
  assert.deepEqual(segments.map((segment) => segment.kind), ["message", "execution", "message"]);
  assert.equal(segments[1]?.kind, "execution");
  if (segments[1]?.kind === "execution") assert.deepEqual(segments[1].activities.map((activity) => activity.kind), ["tool"]);
});

test("uses complete parts as authoritative replacements for legacy reused answer ids", () => {
  const events: RunEvent[] = [
    { ...eventBase("run_child", 1), type: "part-delta", partId: "answer", kind: "text", delta: "jeff" },
    { ...eventBase("run_child", 2), type: "part", part: { partId: "answer", kind: "text", text: "jeff", done: true } },
    { ...eventBase("run_child", 3), type: "tool", tool: { callId: "sleep", name: "command.execute", phase: "succeeded", outcome: "success" } },
    { ...eventBase("run_child", 4), type: "part-delta", partId: "answer", kind: "text", delta: "jeff\n\nDONE" },
    { ...eventBase("run_child", 5), type: "part", part: { partId: "answer", kind: "text", text: "jeff\n\nDONE", done: true } }
  ];

  const projection = projectRunEvents(events);
  assert.equal(projection.answer, "jeff\n\nDONE");
  assert.deepEqual(projection.messages.map((message) => message.text), ["jeff\n\nDONE"]);
});
