import assert from "node:assert/strict";
import test from "node:test";
import { createInitialSnapshot, isTerminalStatus, validateRunRequest } from "../src/index.js";

test("validates a run request and applies safe defaults", () => {
  const request = validateRunRequest({ prompt: "  inspect this repo  " });
  assert.equal(request.prompt, "inspect this repo");
  const snapshot = createInitialSnapshot("run_test", request, "2026-08-09T00:00:00.000Z");
  assert.equal(snapshot.status, "queued");
  assert.equal(snapshot.mode, "standard");
  assert.equal(snapshot.model, "auto");
  assert.equal(snapshot.effort, "medium");
});

test("accepts native Codex effort levels and normalizes protocol-v0 aliases", () => {
  for (const effort of ["low", "medium", "high", "xhigh", "max"] as const) {
    assert.equal(validateRunRequest({ prompt: "test", effort }).effort, effort);
  }
  assert.equal(validateRunRequest({ prompt: "test", effort: "fast" }).effort, "low");
  assert.equal(validateRunRequest({ prompt: "test", effort: "balanced" }).effort, "medium");
  assert.equal(validateRunRequest({ prompt: "test", effort: "deep" }).effort, "max");
});

test("keeps Ultra separate from reasoning effort and rejects Luna", () => {
  assert.deepEqual(
    validateRunRequest({ prompt: "parallelize", model: "gpt-5.6-sol", mode: "ultra", effort: "high" }),
    { prompt: "parallelize", model: "gpt-5.6-sol", mode: "ultra", effort: "max" }
  );
  assert.deepEqual(
    validateRunRequest({ prompt: "legacy ultra", model: "gpt-5.6-terra", effort: "ultra" }),
    { prompt: "legacy ultra", model: "gpt-5.6-terra", mode: "ultra", effort: "max" }
  );
  assert.deepEqual(
    validateRunRequest({ prompt: "legacy cluster", model: "gpt-5.6-sol", mode: "cluster" }),
    { prompt: "legacy cluster", model: "gpt-5.6-sol", mode: "ultra", effort: "max" }
  );
  assert.throws(
    () => validateRunRequest({ prompt: "unsupported", model: "gpt-5.6-luna", mode: "ultra" }),
    /gpt-5\.6-luna does not support ultra mode/
  );
  assert.throws(
    () => validateRunRequest({ prompt: "ambiguous", model: "auto", mode: "ultra" }),
    /ultra mode requires an explicit gpt-5\.6-sol or gpt-5\.6-terra model/
  );
});

test("rejects an empty prompt and identifies terminal states", () => {
  assert.throws(() => validateRunRequest({ prompt: "   " }), /prompt is required/);
  assert.equal(isTerminalStatus("completed"), true);
  assert.equal(isTerminalStatus("running"), false);
});

test("normalizes and bounds the client request id used for idempotency", () => {
  assert.equal(validateRunRequest({ prompt: "test", clientRequestId: "  web_123  " }).clientRequestId, "web_123");
  assert.throws(
    () => validateRunRequest({ prompt: "test", clientRequestId: "x".repeat(201) }),
    /clientRequestId exceeds 200 characters/
  );
});

test("normalizes and bounds the run id used for conversation continuation", () => {
  assert.equal(validateRunRequest({ prompt: "follow up", continueFromRunId: "  run_parent  " }).continueFromRunId, "run_parent");
  assert.throws(
    () => validateRunRequest({ prompt: "follow up", continueFromRunId: "x".repeat(201) }),
    /continueFromRunId exceeds 200 characters/
  );
});
