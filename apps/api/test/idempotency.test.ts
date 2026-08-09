import assert from "node:assert/strict";
import test from "node:test";
import { getOrCreateIdempotent } from "../src/idempotency.js";

test("replays a request with the same idempotency key without creating twice", () => {
  const index = new Map<string, { runId: string }>();
  let creations = 0;
  const create = () => ({ runId: `run_${++creations}` });

  const first = getOrCreateIdempotent("request_1", index, create);
  const replay = getOrCreateIdempotent("request_1", index, create);

  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.equal(replay.value.runId, first.value.runId);
  assert.equal(creations, 1);
});

test("creates independent runs when no idempotency key is supplied", () => {
  const index = new Map<string, { runId: string }>();
  let creations = 0;
  const create = () => ({ runId: `run_${++creations}` });

  const first = getOrCreateIdempotent(undefined, index, create);
  const second = getOrCreateIdempotent(undefined, index, create);

  assert.notEqual(first.value.runId, second.value.runId);
  assert.equal(creations, 2);
});
