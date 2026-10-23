import assert from "node:assert/strict";
import test from "node:test";
import { TOOL_OUTCOMES, createInitialSnapshot, isTerminalEvent, isTerminalStatus, validateRunRequest, type RunEvent } from "../src/index.js";

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

test("normalizes TokenResearch routing to a deterministic Sol Ultra/max coordinator", () => {
  const request = validateRunRequest({
    prompt: "route this research",
    model: "gpt-5.6-luna",
    mode: "ultra",
    effort: "low",
    routing: { id: "tokenresearch" }
  });
  assert.equal(request.routing, "tokenresearch");
  assert.equal(request.model, "gpt-5.6-sol");
  assert.equal(request.mode, "ultra");
  assert.equal(request.effort, "max");
  assert.equal(validateRunRequest({ prompt: "canonical route", routing: "tokenresearch" }).routing, "tokenresearch");
  assert.throws(() => validateRunRequest({ prompt: "bad route", routing: { id: "unknown" } }), /routing\.id must be tokenresearch/);
});

test("exposes additive tool outcomes without changing the lifecycle contract", () => {
  assert.deepEqual(TOOL_OUTCOMES, ["success", "no-result", "partial", "error", "declined"]);
});

test("plan, source and verified artifact metadata remain additive protocol-v0 events", () => {
  const base = { protocolVersion: 0, runId: "run_research", eventId: "run_research:1", sequence: 1, ts: "2026-10-22T00:00:00Z" } as const;
  const events: RunEvent[] = [
    { ...base, type: "plan", steps: [{ step: "Read evidence", status: "in_progress" }], explanation: "Actual state", provenance: "tool" },
    { ...base, type: "source", source: { sourceId: "source_paper", url: "https://example.org/paper", title: "Primary paper", origin: "web-search", kind: "page-request" } },
    { ...base, type: "file", file: { fileId: "artifact_csv", name: "results.csv", path: "artifacts/results.csv", mimeType: "text/csv", revision: 1, sizeBytes: 20, contentUrl: "/api/runs/run_research/files/artifact_csv/content?revision=1", downloadUrl: "/api/runs/run_research/files/artifact_csv?revision=1" } }
  ];
  assert.deepEqual(JSON.parse(JSON.stringify(events)), events);
  assert.ok(events.every((event) => !isTerminalEvent(event)));
  const legacy: RunEvent = { ...base, type: "file", file: { fileId: "old", name: "old.txt", mimeType: "text/plain", revision: 1 } };
  assert.equal(legacy.file.path, undefined);
});
