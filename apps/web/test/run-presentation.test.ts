import assert from "node:assert/strict";
import test from "node:test";
import type { RunStatus } from "@openrigor/protocol";
import {
  STALE_EVENT_AFTER_MS,
  formatElapsed,
  formatLastUpdate,
  formatToolDuration,
  isActivelyWorkingStatus,
  presentRunActivity,
  runElapsedMs,
  toolElapsedMs
} from "../src/run-presentation";

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

test("stale active runs explain that Codex is still working", () => {
  const now = Date.parse("2026-08-10T08:01:00.000Z");
  const view = presentRunActivity({
    status: "running",
    createdAt: "2026-08-10T08:00:00.000Z",
    updatedAt: "2026-08-10T08:00:40.000Z",
    currentStep: "检索项目文件"
  }, new Date(now - STALE_EVENT_AFTER_MS).toISOString(), now);
  assert.equal(view.animated, true);
  assert.equal(view.stale, true);
  assert.equal(view.headline, "Codex 仍在处理");
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
  assert.equal(view.headline, "等待你的确认");
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
    assert.notEqual(view.headline, "Codex 仍在处理");
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
  assert.equal(view.headline, "正在执行工具");
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
