import assert from "node:assert/strict";
import test from "node:test";
import { messageReadingRole, processShouldOpen, responseTailIndex, toolFailureSummary, toolKind, toolReadingTitle, toolShouldOpen } from "../src/features/chat/run-reading.ts";

test("uses interface tool titles without exposing their JavaScript arguments", () => {
  const inputSummary = JSON.stringify({ code: "var tab = await cua.createBrowserTab('iab', 'https://example.org');", title: "使用内置浏览器查阅原论文" });
  assert.equal(toolReadingTitle({ name: "cua_repl.js", inputSummary }), "使用内置浏览器查阅原论文");
  assert.equal(toolReadingTitle({ name: "cua_repl.js", inputSummary: '{"code":"var tab = await cua.createBrowserTab(' }), "Interface action");
  assert.equal(toolReadingTitle({ name: "cua_repl.js", inputSummary: '{"title":"Inspect a paper","code":"truncated' }), "Inspect a paper");
  assert.equal(toolReadingTitle({ name: "command.execute", inputSummary: "python3 artifacts/analysis.py\ncat report.md" }), "python3 artifacts/analysis.py");
  assert.equal(toolReadingTitle({ name: "web.search", inputSummary: '{"query":"parameter efficient fine tuning"}' }), "parameter efficient fine tuning");
});

test("extracts a concise real provider failure while preserving documentation only in raw output", () => {
  const output = JSON.stringify({ content: [
    { type: "text", text: "Browser is not available: iab" },
    { type: "text", text: "## Computer Use\n\nControl native apps and browsers.\n\n## API\n```typescript\ntype Failure = Error;" }
  ] });
  assert.equal(toolFailureSummary(output, "The tool failed"), "Browser is not available: iab");
  assert.equal(toolFailureSummary(output.slice(0, -20), "The tool failed"), "Browser is not available: iab");
  assert.equal(toolFailureSummary('{"error":{"message":"Access denied to this resource"}}', "The tool failed"), "Access denied to this resource");
  assert.equal(toolFailureSummary('{"message":"The request timed out"}', undefined), "The request timed out");
  assert.equal(toolFailureSummary('{"content":[{"type":"text","text":"## Computer Use\\nAPI reference"}]}', "The tool failed"), "The tool failed");
  assert.equal(toolFailureSummary("Browser is not available: iab\n\n## Computer Use\nDocumentation Error type", "The tool failed"), "Browser is not available: iab");
});

test("keeps malformed JSON out of the summary and bounds multiline diagnostics", () => {
  assert.equal(toolFailureSummary('{"unknown":"large raw response', "Command exited with code 2"), "Command exited with code 2");
  assert.equal(toolFailureSummary(undefined, undefined, true), "The tool call was declined");
  assert.equal(toolFailureSummary("Traceback (most recent call last):\n  File analysis.py\nModuleNotFoundError: No module named pandas", "The tool failed"), "ModuleNotFoundError: No module named pandas");
  const testRun = "> @openrigor/api test\n> tsx --test test/*.test.ts\n\n✔ replays events (41ms)\n✖ settles usage exactly once under retry (12ms)\n\nℹ tests 64\nℹ fail 1";
  assert.equal(toolFailureSummary(testRun, "Command exited with code 1"), "✖ settles usage exactly once under retry (12ms)");
  assert.equal(toolFailureSummary("> build\n> tsc", "Command exited with code 2"), "Command exited with code 2");
  const summary = toolFailureSummary(JSON.stringify({ error: { message: "error: " + "x".repeat(500) + "\nmore" } }), undefined);
  assert.equal(summary.length, 240);
  assert.equal(summary.endsWith("…"), true);
  assert.equal(summary.includes("\n"), false);
});

test("historical success collapses the work log while live work and failures stay open", () => {
  for (const status of ["completed", "cancelled"] as const) assert.equal(processShouldOpen(status), false);
  for (const status of ["queued", "running", "waiting_tool", "waiting_user", "cancelling", "failed"] as const) assert.equal(processShouldOpen(status), true);
  assert.equal(toolShouldOpen(false, false, true, false), false);
  assert.equal(toolShouldOpen(false, true, true, true), true);
  assert.equal(toolShouldOpen(true, false, false, false), false);
  assert.equal(toolShouldOpen(true, true, false, false), true);
});

test("tool rows are grouped by provider tool family", () => {
  assert.equal(toolKind("command.execute"), "command");
  assert.equal(toolKind("web.search"), "search");
  assert.equal(toolKind("file.change"), "file");
  assert.equal(toolKind("cua_repl.js"), "browser");
  assert.equal(toolKind("subagent"), "subagent");
  assert.equal(toolKind("image.generate"), "image");
  assert.equal(toolKind("openrigor_update_plan"), "plan");
  assert.equal(toolKind("clock.sleep"), "wait");
  assert.equal(toolKind("github.get_issue"), "mcp");
  assert.equal(toolKind("lookup"), "tool");
});

test("a latest message is only an answer after the run and the message finish", () => {
  for (const status of ["queued", "running", "waiting_tool", "waiting_user", "cancelling"] as const) {
    assert.equal(messageReadingRole(status, true, true), "update");
  }
  assert.equal(messageReadingRole("completed", true, true), "answer");
  assert.equal(messageReadingRole("completed", false, true), "update");
  assert.equal(messageReadingRole("completed", true, false), "update");
  assert.equal(messageReadingRole("failed", true, true), "partial");
  assert.equal(messageReadingRole("cancelled", true, false), "partial");
});

test("the response stays outside the work log even when file records follow it", () => {
  const message = { kind: "message" as const };
  const tool = { kind: "execution" as const, activities: [{ kind: "tool" }] };
  const files = { kind: "execution" as const, activities: [{ kind: "file" }, { kind: "diff" }] };
  const reasoning = { kind: "reasoning" as const };
  assert.equal(responseTailIndex([]), -1);
  assert.equal(responseTailIndex([tool, message]), 1);
  assert.equal(responseTailIndex([tool, message, files]), 1);
  assert.equal(responseTailIndex([message, tool]), -1);
  assert.equal(responseTailIndex([message, reasoning]), -1);
  assert.equal(responseTailIndex([message, files, tool]), -1);
});
