import assert from "node:assert/strict";
import test from "node:test";
import type { RunStatus } from "@openrigor/protocol";
import {
  STALE_EVENT_AFTER_MS,
  executionOpenTransition,
  executionSummary,
  formatElapsed,
  formatLastUpdate,
  formatToolDuration,
  isActivelyWorkingStatus,
  presentRunActivity,
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
    currentStep: "检索项目文件"
  }, new Date(now - STALE_EVENT_AFTER_MS).toISOString(), now);
  assert.equal(view.animated, true);
  assert.equal(view.stale, true);
  assert.equal(view.headline, "任务运行中，等待下一条输出");
  assert.equal(view.state, "working");
  assert.equal(view.helper, "暂时没有新的输出；有更新时会自动显示。");
  assert.equal(view.detail, "检索项目文件");
  assert.equal(view.elapsed, "1m 00s");
  assert.equal(view.lastUpdate, "10s 前更新");
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
  assert.equal(view.headline, "需要你的确认");
  assert.equal(view.state, "waiting-user");
  assert.equal(view.helper, "确认或回答后，任务才会继续。");
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
    assert.notEqual(view.headline, "任务运行中，等待下一条输出");
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
  assert.equal(view.headline, "正在调用工具");
  assert.equal(view.detail, "正在执行命令");
});

test("duration labels remain compact", () => {
  assert.equal(formatElapsed(999), "0s");
  assert.equal(formatElapsed(65_000), "1m 05s");
  assert.equal(formatToolDuration(914), "914ms");
  assert.equal(formatToolDuration(2_650), "2.6s");
  assert.equal(formatLastUpdate(75_000), "1m 前更新");
  assert.equal(toolElapsedMs("2026-08-10T08:00:00.000Z", "2026-08-10T08:00:02.000Z", false, Date.parse("2026-08-10T08:00:20.000Z")), 2_000);
  assert.equal(toolElapsedMs("2026-08-10T08:00:00.000Z", "2026-08-10T08:00:02.000Z", true, Date.parse("2026-08-10T08:00:20.000Z")), 20_000);
});


test("observed live stages distinguish thinking, tools, and answer streaming", () => {
  const now = Date.parse("2026-08-10T08:00:05.000Z");
  const snapshot = { status: "running" as const, createdAt: "2026-08-10T08:00:00.000Z", updatedAt: "2026-08-10T08:00:04.000Z" };
  for (const [stage, headline] of [["reasoning", "正在思考"], ["tool", "正在调用工具"], ["answer", "正在生成回答"], ["working", "任务运行中"]] as const) {
    const view = presentRunActivity(snapshot, snapshot.updatedAt, now, { connection: "open", stage, detail: "核对论文与来源" });
    assert.equal(view.headline, headline);
    assert.equal(view.detail, "核对论文与来源");
    assert.equal(view.animated, true);
    assert.equal(view.stale, false);
    assert.equal(view.elapsed, "5s");
  }
});

test("reconnecting and disconnected runs never claim to know current execution", () => {
  const now = Date.parse("2026-08-10T08:01:00.000Z");
  const snapshot = { status: "running" as const, createdAt: "2026-08-10T08:00:00.000Z", updatedAt: "2026-08-10T08:00:10.000Z" };
  for (const connection of ["idle", "connecting", "closed"] as const) {
    const view = presentRunActivity(snapshot, snapshot.updatedAt, now, { connection, stage: "tool", detail: "正在运行命令" });
    assert.equal(view.state, connection === "connecting" ? "reconnecting" : "disconnected");
    assert.equal(view.animated, connection === "connecting");
    assert.equal(view.stale, false);
    assert.equal(view.detail, "最后记录：任务运行中");
    assert.equal(view.lastUpdate, "50s 前更新");
    assert.doesNotMatch(view.headline, /正在调用工具|正在思考|等待下一条输出/);
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

test("execution records do not describe finished tool rows as still executing", () => {
  const base = { status: "running" as const, current: true, total: 5, connection: "open" as const };
  assert.equal(executionSummary({ ...base, runningTools: 0 }), "5 条执行记录 · 等待下一步输出");
  assert.equal(executionSummary({ ...base, runningTools: 1 }), "正在执行 1 个工具 · 5 条执行记录");
  assert.equal(executionSummary({ ...base, runningTools: 2 }), "正在执行 2 个工具 · 5 条执行记录");
  assert.equal(executionSummary({ ...base, current: false, runningTools: 1 }), "5 条执行记录");
  for (const status of ["completed", "failed", "cancelled"] as const) {
    assert.equal(executionSummary({ ...base, status, runningTools: 1 }), "5 条执行记录");
  }
  assert.equal(executionSummary({ ...base, status: "waiting_user", runningTools: 0 }), "等待你的确认 · 5 条执行记录");
  assert.equal(executionSummary({ ...base, status: "cancelling", runningTools: 1 }), "正在停止 · 5 条执行记录");
  assert.equal(executionSummary({ ...base, runningTools: 1, connection: "closed" }), "实时连接已断开 · 5 条执行记录");
});
