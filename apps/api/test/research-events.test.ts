import assert from "node:assert/strict";
import test from "node:test";
import { extractCodexSources, parseCodexPlan, validatePlanToolArguments } from "../src/research-events.js";

test("preserves the real plan and valid provider statuses with bounded public text", () => {
  assert.deepEqual(parseCodexPlan({ plan: [{ step: "Inspect evidence", status: "completed" }, { step: "Analyse", status: "in_progress" }, { step: "Report", status: "pending" }], explanation: "Track actual work" }), {
    steps: [{ step: "Inspect evidence", status: "completed" }, { step: "Analyse", status: "in_progress" }, { step: "Report", status: "pending" }], explanation: "Track actual work"
  });
  assert.deepEqual(parseCodexPlan({ plan: [{ step: "invented", status: "almost_done" }, { text: "missing step", status: "pending" }] }), { steps: [] });
  assert.equal(parseCodexPlan({ explanation: "no plan structure" }), undefined);
  const result = parseCodexPlan({ plan: [{ step: `Bearer ${"s".repeat(40)}`, status: "pending" }], explanation: `api_key=${"k".repeat(30)}` });
  assert.ok(!JSON.stringify(result).includes("k".repeat(30)));
  assert.ok(!JSON.stringify(result).includes("s".repeat(40)));
});

test("only provider web-search results and actual page actions become sources", () => {
  const source = { url: "https://arxiv.org/abs/2106.09685#abstract", title: "LoRA", snippet: "Primary research" };
  const result = extractCodexSources({ type: "webSearch", id: "search_1", action: { type: "search", query: "LoRA original paper", sources: [source] }, results: [source] });
  assert.equal(result.length, 1);
  assert.equal(result[0]?.url, "https://arxiv.org/abs/2106.09685");
  assert.equal(result[0]?.title, "LoRA");
  assert.equal(result[0]?.origin, "web-search");
  assert.equal(result[0]?.kind, "search-result");
  assert.equal(result[0]?.toolCallId, "search_1");
  assert.equal(result[0]?.query, "LoRA original paper");
  assert.deepEqual(extractCodexSources({ type: "webSearch", query: "a search with no actual result structure", text: "https://example.org/paper" }), []);
  assert.deepEqual(extractCodexSources({ type: "agentMessage", text: "[Paper](https://example.org/paper)", sources: [source] }), []);
  const opened = extractCodexSources({ type: "webSearch", action: { type: "openPage", url: "https://example.org/paper" } });
  assert.equal(opened[0]?.title, "example.org");
  assert.equal(opened[0]?.kind, "page-request", "page attempts are not claimed as successful retrieval");
  assert.equal(opened[0]?.sourceId, extractCodexSources({ type: "webSearch", results: [{ url: "https://example.org/paper" }] })[0]?.sourceId);
});

test("dynamic plan arguments are strictly validated before recording state", () => {
  assert.deepEqual(validatePlanToolArguments({ steps: [{ step: "Measure", status: "in_progress" }] }), { steps: [{ step: "Measure", status: "in_progress" }] });
  for (const input of [null, {}, { steps: [] }, { steps: [{ step: "Guess", status: "done" }] }, { steps: [{ step: "", status: "pending" }] }, { steps: [{ step: "Measure", status: "pending", command: "rm" }] }, { steps: [{ step: "Measure", status: "pending" }], extra: "forbidden" }]) assert.throws(() => validatePlanToolArguments(input));
});

test("source extraction rejects unsafe URLs, credentials, and unbounded output", () => {
  const bad = ["javascript:alert(1)", "file:///etc/passwd", "https://user:pass@example.org", "http://127.0.0.1/private", "http://localhost/private", "http://[::1]/", "https://example.org?token=private", "https://example.org?api_key=private"];
  assert.deepEqual(extractCodexSources({ type: "webSearch", results: bad.map((url) => ({ url })) }), []);
  const many = extractCodexSources({ type: "webSearch", results: Array.from({ length: 200 }, (_, id) => ({ url: `https://example.org/${id}`, title: "T".repeat(1_000), snippet: "D".repeat(3_000) })) });
  assert.equal(many.length, 40);
  assert.equal(many[0]?.title.length, 500);
  assert.equal(many[0]?.snippet?.length, 2_000);
  // DNS labels must not be mistaken for IPv6 private-address prefixes.
  assert.equal(extractCodexSources({ type: "webSearch", results: [{ url: "https://fda.gov/science" }] }).length, 1);
});
