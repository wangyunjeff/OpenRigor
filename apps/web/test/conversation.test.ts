import assert from "node:assert/strict";
import test from "node:test";
import type { RunEvent, RunSnapshot } from "@openrigor/protocol";
import { applyRunEvent, projectRunEvents, restoreConversation } from "../src/conversation.ts";

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
    { ...eventBase("run_child", 6), type: "tool", tool: { callId: "call_1", name: "shell", phase: "succeeded" } },
    { ...eventBase("run_child", 7), type: "file", file: { fileId: "file_1", name: "report.md", mimeType: "text/markdown", revision: 1 } },
    { ...eventBase("run_child", 8), type: "part", part: { partId: "diff:report.md", kind: "text", text: "+done" } },
    { ...eventBase("run_child", 9), type: "subagent", subagent: { subagentRunId: "sub_1", label: "Luna reviewer", status: "running", parentRunId: "run_child" } },
    { ...eventBase("run_child", 10), type: "subagent", subagent: { subagentRunId: "sub_1", label: "Luna reviewer", status: "completed", parentRunId: "run_child" } },
    { ...eventBase("run_child", 11), type: "error", code: "tool_warning", message: "Recovered warning", retryable: true },
    { ...eventBase("run_child", 12), type: "run-finished", status: "completed", usage: { inputTokens: 20, outputTokens: 10 } }
  ];

  const projection = projectRunEvents(events);
  assert.equal(projection.answer, "Hello world");
  assert.equal(projection.reasoning, "Checked state");
  assert.equal(projection.tools.length, 1);
  assert.equal(projection.tools[0]?.event.tool.phase, "succeeded");
  assert.equal(projection.toolOutput.get("call_1"), "ok");
  assert.equal(projection.files[0]?.file.name, "report.md");
  assert.equal(projection.diffs[0]?.part.partId, "diff:report.md");
  assert.equal(projection.subagents.length, 1);
  assert.equal(projection.subagents[0]?.event.subagent.status, "completed");
  assert.equal(projection.errors[0]?.message, "Recovered warning");
  assert.deepEqual(projection.usage, { inputTokens: 20, outputTokens: 10 });
});
