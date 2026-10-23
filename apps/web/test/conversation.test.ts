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

test("replays ordered provider plans without inventing completed steps", () => {
  const initial: RunEvent = {
    ...eventBase("run_child", 1),
    type: "plan",
    explanation: "Inspect the evidence before calculating.",
    steps: [{ step: "Find primary papers", status: "in_progress" }, { step: "Compare methods", status: "pending" }]
  };
  const updated: RunEvent = {
    ...eventBase("run_child", 3),
    type: "plan",
    steps: [{ step: "Find primary papers", status: "completed" }, { step: "Compare methods", status: "in_progress" }]
  };
  const events: RunEvent[] = [
    initial,
    { ...eventBase("run_child", 2), type: "part-delta", partId: "answer", kind: "text", delta: "The evidence " },
    updated,
    { ...eventBase("run_child", 4), type: "part-delta", partId: "answer", kind: "text", delta: "is limited." },
    { ...eventBase("run_child", 5), type: "run-finished", status: "completed" }
  ];

  const projection = projectRunEvents(events);
  const replay = projectRunEvents([events[4]!, events[3]!, initial, updated, events[1]!, initial, events[1]!, updated]);
  assert.deepEqual(replay, projection);
  assert.equal(projection.answer, "The evidence is limited.");
  assert.equal(projection.plan?.eventId, updated.eventId);
  assert.equal(projection.plan?.firstAt, initial.ts);
  assert.equal(projection.plan?.lastAt, updated.ts);
  assert.equal(projection.plan?.firstIndex, 0);
  assert.equal(projection.plan?.explanation, undefined);
  assert.deepEqual(projection.plan?.steps, [
    { step: "Find primary papers", status: "completed" },
    { step: "Compare methods", status: "in_progress" }
  ]);
  assert.deepEqual(projection.timeline.map((item) => item.kind), ["message"]);
});

test("collects only event-backed search sources, merges metadata, and preserves first-seen order", () => {
  const events: RunEvent[] = [
    { ...eventBase("run_child", 1), type: "part", part: { partId: "answer", kind: "text", text: "See [a claimed paper](https://unverified.example/paper)." } },
    { ...eventBase("run_child", 2), type: "source", source: { sourceId: "source_a", url: "https://papers.example/a#abstract", title: "First paper", toolCallId: "search_1", query: "evaluation methods", origin: "web-search" } },
    { ...eventBase("run_child", 3), type: "source", source: { sourceId: "source_b", url: "https://papers.example/b", title: "Second paper", origin: "web-search" } },
    { ...eventBase("run_child", 4), type: "source", source: { sourceId: "source_a", url: "https://papers.example/a#methods", title: "First paper, full title", snippet: "A reported result.", toolCallId: "search_2", origin: "web-search" } },
    { ...eventBase("run_child", 5), type: "source", source: { sourceId: "same_document", url: "https://papers.example/a", title: "First paper, updated metadata", snippet: "An actual search snippet.", origin: "web-search" } }
  ];

  const projection = projectRunEvents([events[4]!, ...events, events[1]!, events[4]!]);
  assert.equal(projection.sources.length, 2);
  assert.deepEqual(projection.sources.map((source) => source.url), ["https://papers.example/a", "https://papers.example/b"]);
  assert.equal(projection.sources[0]?.title, "First paper, updated metadata");
  assert.equal(projection.sources[0]?.snippet, "An actual search snippet.");
  assert.equal(projection.sources[0]?.firstAt, events[1]?.ts);
  assert.equal(projection.sources[0]?.lastAt, events[4]?.ts);
  assert.equal(projection.sources[0]?.firstIndex, 1);
  assert.equal(projection.sources[1]?.firstIndex, 2);
  assert.equal(projection.sources.some((source) => source.url.includes("unverified.example")), false);
  assert.deepEqual(projection.timeline.map((item) => item.kind), ["message"]);
  assert.deepEqual(projectRunEvents([events[0]!]).sources, []);
});

test("does not expose malformed or executable source URLs from replayed events", () => {
  const urls = ["javascript:alert(1)", "data:text/html,<h1>Example</h1>", "https://user:password@example.com/paper", "not a URL"];
  const events: RunEvent[] = urls.map((url, index) => ({
    ...eventBase("run_child", index + 1),
    type: "source",
    source: { sourceId: `invalid_${index}`, url, title: "Untrusted source", origin: "web-search" }
  }));
  assert.deepEqual(projectRunEvents(events).sources, []);
});

test("merges artifact revisions at their first timeline position and keeps the latest content", () => {
  const initial: RunEvent = { ...eventBase("run_child", 1), type: "file", file: { fileId: "report", name: "report.md", mimeType: "text/markdown", revision: 1 } };
  const updated: RunEvent = { ...eventBase("run_child", 4), type: "file", file: { fileId: "report", name: "report.md", mimeType: "text/markdown", revision: 2, sha256: "current", downloadUrl: "/api/files/download?path=report.md" } };
  const events: RunEvent[] = [
    initial,
    { ...eventBase("run_child", 2), type: "part", part: { partId: "answer", kind: "text", text: "I revised the report." } },
    { ...eventBase("run_child", 3), type: "file", file: { fileId: "figure", name: "figure.png", mimeType: "image/png", revision: 1 } },
    updated,
    { ...eventBase("run_child", 5), type: "file", file: { ...initial.file, revision: 1 } }
  ];
  const projection = projectRunEvents([updated, ...events, initial, updated]);
  assert.equal(projection.files.length, 2);
  assert.deepEqual(projection.files.map((event) => event.file.fileId), ["report", "figure"]);
  assert.equal(projection.files[0]?.file.revision, 2);
  assert.equal(projection.files[0]?.file.sha256, "current");
  assert.deepEqual(projection.timeline.map((item) => item.kind), ["file", "message", "file"]);
  const fileActivities = projection.activities.filter((activity) => activity.kind === "file");
  assert.equal(fileActivities[0]?.firstIndex, 0);
  assert.equal(fileActivities[0]?.event.eventId, updated.eventId);
  const firstSegment = segmentRunTimeline(projection.timeline)[0];
  assert.equal(firstSegment?.kind, "execution");
  if (firstSegment?.kind === "execution") assert.equal(firstSegment.id, "execution:file:report");
});
