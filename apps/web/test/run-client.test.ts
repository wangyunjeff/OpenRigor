import assert from "node:assert/strict";
import test from "node:test";
import { isStaleContinuationResponse, parseRunStreamEvent, requestRunStart } from "../src/run-client.ts";

test("ignores native SSE connection errors while preserving named run errors", () => {
  assert.equal(parseRunStreamEvent({ type: "error" }), null);
  const event = { type: "error", runId: "run_1", seq: 2, ts: "2026-10-22T05:00:00Z", message: "Provider unavailable" };
  assert.deepEqual(parseRunStreamEvent({ type: "error", data: JSON.stringify(event) }), event);
});

test("malformed SSE message data still surfaces as an invalid event", () => {
  assert.throws(() => parseRunStreamEvent({ type: "status", data: "{" }), SyntaxError);
  assert.throws(() => parseRunStreamEvent({ type: "status" }), /missing its data/);
});

test("recognizes only the explicit stale continuation response", () => {
  assert.equal(isStaleContinuationResponse(404, "continueFromRunId was not found"), true);
  assert.equal(isStaleContinuationResponse(404, " ContinueFromRunId Was Not Found \n"), true);
});

test("does not downgrade unrelated request failures", () => {
  assert.equal(isStaleContinuationResponse(404, "route not found"), false);
  assert.equal(isStaleContinuationResponse(409, "continueFromRunId was not found"), false);
  assert.equal(isStaleContinuationResponse(404, undefined), false);
});

test("retries a stale continuation once as a fresh root run", async () => {
  const requests: Array<Record<string, unknown>> = [];
  const responses = [
    new Response(JSON.stringify({ error: "continueFromRunId was not found" }), { status: 404 }),
    new Response(JSON.stringify({ runId: "run_fresh", status: "queued", rootRunId: "run_fresh" }), { status: 202 })
  ];
  const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    const response = responses.shift();
    assert.ok(response);
    return response;
  }) as typeof fetch;

  const result = await requestRunStart({
    endpoint: "http://localhost/api/runs",
    body: { prompt: "continue", clientRequestId: "request_1" },
    continueFromRunId: "run_stale",
    fetchImpl
  });

  assert.equal(result.continuationExpired, true);
  assert.equal(result.response.status, 202);
  assert.equal(result.body.runId, "run_fresh");
  assert.deepEqual(requests, [
    { prompt: "continue", clientRequestId: "request_1", continueFromRunId: "run_stale" },
    { prompt: "continue", clientRequestId: "request_1" }
  ]);
});

test("does not retry an unrelated 404", async () => {
  let calls = 0;
  const fetchImpl = (async (): Promise<Response> => {
    calls += 1;
    return new Response(JSON.stringify({ error: "route not found" }), { status: 404 });
  }) as typeof fetch;

  const result = await requestRunStart({
    endpoint: "http://localhost/api/runs",
    body: { prompt: "continue" },
    continueFromRunId: "run_stale",
    fetchImpl
  });

  assert.equal(result.continuationExpired, false);
  assert.equal(result.response.status, 404);
  assert.equal(calls, 1);
});
