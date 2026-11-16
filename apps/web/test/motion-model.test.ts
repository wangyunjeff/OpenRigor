import assert from "node:assert/strict";
import test from "node:test";
import { planMark, revealStagger, smoothScrollPolicy, taskMark, toolMark } from "../src/features/motion/motion-model.ts";

test("task glyphs spin only for work this client is streaming", () => {
  assert.deepEqual(taskMark("running", true), { status: "running", tone: "live", label: "Working" });
  assert.deepEqual(taskMark("waiting_tool", true), { status: "running", tone: "live", label: "Working" });
  assert.deepEqual(taskMark("cancelling", true), { status: "running", tone: "live", label: "Stopping" });
  for (const status of ["running", "waiting_tool", "cancelling"] as const) {
    assert.deepEqual(taskMark(status, false), { status: "pending", tone: "live", label: "Last seen working" });
  }
  assert.equal(taskMark("completed", true).status, "done");
  assert.equal(taskMark("failed", false).status, "failed");
  assert.equal(taskMark("cancelled", false).status, "cancelled");
  assert.deepEqual(taskMark("waiting_user", true), { status: "pending", tone: "attention", label: "Needs input" });
  assert.deepEqual(taskMark("queued", true), { status: "pending", tone: "live", label: "Queued" });
});

test("tool and plan glyphs follow recorded outcomes", () => {
  assert.deepEqual(toolMark({ pending: true, live: true }), { status: "running", tone: "live" });
  assert.deepEqual(toolMark({ pending: true, live: false }), { status: "pending", tone: "neutral" });
  assert.deepEqual(toolMark({ pending: false, live: true, outcome: "success" }), { status: "done", tone: "neutral" });
  assert.deepEqual(toolMark({ pending: false, live: false, outcome: "no-result" }), { status: "done", tone: "neutral" });
  assert.deepEqual(toolMark({ pending: false, live: false, outcome: "partial" }), { status: "done", tone: "attention" });
  assert.deepEqual(toolMark({ pending: false, live: true, outcome: "error" }), { status: "failed", tone: "neutral" });
  assert.deepEqual(toolMark({ pending: false, live: false, outcome: "declined" }), { status: "cancelled", tone: "neutral" });
  assert.deepEqual(planMark("completed", true), { status: "done", tone: "neutral" });
  assert.deepEqual(planMark("in_progress", true), { status: "running", tone: "live" });
  assert.deepEqual(planMark("in_progress", false), { status: "pending", tone: "live" });
  assert.deepEqual(planMark("pending", true), { status: "pending", tone: "neutral" });
});

test("smooth scrolling yields to reduced motion and inactive areas", () => {
  assert.equal(smoothScrollPolicy({ active: true, reducedMotion: false }).enabled, true);
  assert.equal(smoothScrollPolicy({ active: true, reducedMotion: true }).enabled, false);
  assert.equal(smoothScrollPolicy({ active: false, reducedMotion: false }).enabled, false);
  const policy = smoothScrollPolicy({ active: true, reducedMotion: false });
  assert.ok(policy.lerp > 0 && policy.lerp < 1);
});

test("reveal stagger keeps long groups short", () => {
  assert.equal(revealStagger(0), 0);
  assert.equal(revealStagger(1), 0);
  assert.equal(revealStagger(4), 0.06);
  assert.ok(revealStagger(20) * 19 <= 0.36 + 1e-9);
});
