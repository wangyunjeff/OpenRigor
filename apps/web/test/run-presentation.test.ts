import assert from "node:assert/strict";
import test from "node:test";
import type { RunStatus } from "@openrigor/protocol";
import {
  STALE_EVENT_AFTER_MS,
  executionOpenTransition,
  formatElapsed,
  formatLastUpdate,
  formatToolDuration,
  isActivelyWorkingStatus,
  presentRunActivity,
  processSummary,
  runElapsedMs,
  toolElapsedMs
} from "../src/run-presentation";

test("preserves the user's execution rail choice during one run", () => {
  const current = { runId: "run_1", isRunning: true };
  assert.equal(executionOpenTransition(current, current), undefined);
  assert.equal(executionOpenTransition(current, { ...current, isRunning: false }), false);
  assert.equal(executionOpenTransition({ runId: "run_1", isRunning: false }, current), true);
  assert.equal(executionOpenTransition(current, { runId: "run_2", isRunning: true }), true);
});

test("only statuses that represent active work animate", () => {
  const expected: Record<RunStatus, boolean> = {
    queued: true,
    running: true,
    waiting_tool: true,
    waiting_user: false,
    cancelling: true,
    completed: false,
    failed: false,
    cancelled: false
  };
  for (const [status, active] of Object.entries(expected)) {
    assert.equal(isActivelyWorkingStatus(status as RunStatus), active);
  }
});

test("non-terminal elapsed time advances while terminal time freezes", () => {
  const now = Date.parse("2026-08-10T08:01:40.000Z");
  const base = { createdAt: "2026-08-10T08:00:00.000Z", updatedAt: "2026-08-10T08:00:35.000Z" };
  assert.equal(runElapsedMs({ ...base, status: "running" }, now), 100_000);
  assert.equal(runElapsedMs({ ...base, status: "completed" }, now), 35_000);
  assert.equal(runElapsedMs({ ...base, status: "waiting_user" }, now), 100_000);
});

test("stale active runs disclose silence without inventing runtime progress", () => {
  const now = Date.parse("2026-08-10T08:01:00.000Z");
  const view = presentRunActivity({
    status: "running",
    createdAt: "2026-08-10T08:00:00.000Z",
    updatedAt: "2026-08-10T08:00:40.000Z",
    currentStep: "Search project files"
  }, new Date(now - STALE_EVENT_AFTER_MS).toISOString(), now);
  assert.equal(view.animated, true);
  assert.equal(view.stale, true);
  assert.equal(view.headline, "Still working, waiting for output");
  assert.equal(view.state, "working");
  assert.equal(view.helper, "No new output yet. Updates appear here automatically.");
  assert.equal(view.detail, "Search project files");
  assert.equal(view.elapsed, "1m 00s");
  assert.equal(view.lastUpdate, "Updated 10s ago");
});

test("waiting for the user stays visible but static", () => {
  const now = Date.parse("2026-08-10T08:01:00.000Z");
  const view = presentRunActivity({
    status: "waiting_user",
    createdAt: "2026-08-10T08:00:00.000Z",
    updatedAt: "2026-08-10T08:00:20.000Z"
  }, "2026-08-10T08:00:20.000Z", now);
  assert.equal(view.animated, false);
  assert.equal(view.stale, false);
  assert.equal(view.headline, "Needs your input");
  assert.equal(view.state, "waiting-user");
  assert.equal(view.helper, "The task continues after you respond.");
  assert.equal(view.elapsed, "1m 00s");
});

test("queued and cancelling states never claim background processing", () => {
  const now = Date.parse("2026-08-10T08:01:00.000Z");
  for (const status of ["queued", "cancelling"] as const) {
    const view = presentRunActivity({
      status,
      createdAt: "2026-08-10T08:00:00.000Z",
      updatedAt: "2026-08-10T08:00:01.000Z"
    }, "2026-08-10T08:00:01.000Z", now);
    assert.equal(view.stale, false);
    assert.notEqual(view.headline, "Still working, waiting for output");
  }
});

test("common runtime step names are presented as readable status copy", () => {
  const now = Date.parse("2026-08-10T08:00:05.000Z");
  const view = presentRunActivity({
    status: "waiting_tool",
    createdAt: "2026-08-10T08:00:00.000Z",
    updatedAt: "2026-08-10T08:00:04.000Z",
    currentStep: "command.execute"
  }, "2026-08-10T08:00:04.000Z", now);
  assert.equal(view.headline, "Using a tool");
  assert.equal(view.detail, "Running a command");
});

test("duration labels remain compact", () => {
  assert.equal(formatElapsed(999), "0s");
  assert.equal(formatElapsed(65_000), "1m 05s");
  assert.equal(formatToolDuration(914), "914ms");
  assert.equal(formatToolDuration(2_650), "2.6s");
  assert.equal(formatLastUpdate(75_000), "Updated 1m ago");
  assert.equal(toolElapsedMs("2026-08-10T08:00:00.000Z", "2026-08-10T08:00:02.000Z", false, Date.parse("2026-08-10T08:00:20.000Z")), 2_000);
  assert.equal(toolElapsedMs("2026-08-10T08:00:00.000Z", "2026-08-10T08:00:02.000Z", true, Date.parse("2026-08-10T08:00:20.000Z")), 20_000);
});


test("observed live stages distinguish thinking, tools, and answer streaming", () => {
  const now = Date.parse("2026-08-10T08:00:05.000Z");
  const snapshot = { status: "running" as const, createdAt: "2026-08-10T08:00:00.000Z", updatedAt: "2026-08-10T08:00:04.000Z" };
  for (const [stage, headline] of [["reasoning", "Thinking"], ["tool", "Using a tool"], ["answer", "Writing the response"], ["working", "Working"]] as const) {
    const view = presentRunActivity(snapshot, snapshot.updatedAt, now, { connection: "open", stage, detail: "Check the paper and its sources" });
    assert.equal(view.headline, headline);
    assert.equal(view.detail, "Check the paper and its sources");
    assert.equal(view.animated, true);
    assert.equal(view.stale, false);
    assert.equal(view.elapsed, "5s");
  }
});

test("reconnecting and disconnected runs never claim to know current execution", () => {
  const now = Date.parse("2026-08-10T08:01:00.000Z");
  const snapshot = { status: "running" as const, createdAt: "2026-08-10T08:00:00.000Z", updatedAt: "2026-08-10T08:00:10.000Z" };
  for (const connection of ["idle", "connecting", "closed"] as const) {
    const view = presentRunActivity(snapshot, snapshot.updatedAt, now, { connection, stage: "tool", detail: "Running a command" });
    assert.equal(view.state, connection === "connecting" ? "reconnecting" : "disconnected");
    assert.equal(view.animated, connection === "connecting");
    assert.equal(view.stale, false);
    assert.equal(view.detail, "Last recorded: Working");
    assert.equal(view.lastUpdate, "Updated 50s ago");
    assert.doesNotMatch(view.headline, /Using a tool|Thinking|waiting for output/);
  }
});

test("terminal state wins over stale connection and freezes elapsed time", () => {
  const now = Date.parse("2026-08-10T08:01:00.000Z");
  for (const status of ["completed", "failed", "cancelled"] as const) {
    const snapshot = { status, createdAt: "2026-08-10T08:00:00.000Z", updatedAt: "2026-08-10T08:00:10.000Z" };
    const view = presentRunActivity(snapshot, snapshot.updatedAt, now, { connection: "connecting", stage: "answer" });
    assert.equal(view.state, status);
    assert.equal(view.animated, false);
    assert.equal(view.stale, false);
    assert.equal(view.elapsed, "10s");
    assert.equal(view.helper, "");
  }
});

test("the work summary reports recorded steps and never calls finished work live", () => {
  const base = { status: "running" as const, steps: 5, issues: 0, elapsed: "12s", connection: "open" as const };
  assert.deepEqual(processSummary({ ...base, liveHeadline: "Using a tool" }), { title: "Using a tool", meta: ["5 steps"] });
  assert.deepEqual(processSummary({ ...base, steps: 1 }), { title: "Working", meta: ["1 step"] });
  assert.deepEqual(processSummary({ ...base, steps: 0 }), { title: "Working", meta: [] });
  assert.deepEqual(processSummary({ ...base, status: "completed", liveHeadline: "Using a tool" }), { title: "Worked for 12s", meta: ["5 steps"] });
  assert.deepEqual(processSummary({ ...base, status: "failed", issues: 2 }), { title: "Failed after 12s", meta: ["5 steps", "2 issues"] });
  assert.deepEqual(processSummary({ ...base, status: "cancelled", issues: 1 }), { title: "Stopped after 12s", meta: ["5 steps", "1 issue"] });
  assert.equal(processSummary({ ...base, status: "waiting_user" }).title, "Waiting for your input");
  assert.equal(processSummary({ ...base, status: "cancelling" }).title, "Stopping");
  assert.equal(processSummary({ ...base, status: "queued" }).title, "Queued");
  assert.equal(processSummary({ ...base, connection: "closed", liveHeadline: "Using a tool" }).title, "Live connection lost");
  assert.equal(processSummary({ ...base, connection: "connecting" }).title, "Reconnecting");
  assert.equal(processSummary({ ...base, status: "completed", connection: "closed" }).title, "Worked for 12s");
});
