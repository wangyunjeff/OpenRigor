import assert from "node:assert/strict";
import test from "node:test";
import { createInitialSnapshot, isTerminalStatus, validateRunRequest } from "../src/index.js";

test("validates a run request and applies safe defaults", () => {
  const request = validateRunRequest({ prompt: "  inspect this repo  ", mode: "cluster" });
  assert.equal(request.prompt, "inspect this repo");
  const snapshot = createInitialSnapshot("run_test", request, "2026-08-09T00:00:00.000Z");
  assert.equal(snapshot.status, "queued");
  assert.equal(snapshot.mode, "cluster");
  assert.equal(snapshot.model, "auto");
});

test("rejects an empty prompt and identifies terminal states", () => {
  assert.throws(() => validateRunRequest({ prompt: "   " }), /prompt is required/);
  assert.equal(isTerminalStatus("completed"), true);
  assert.equal(isTerminalStatus("running"), false);
});
