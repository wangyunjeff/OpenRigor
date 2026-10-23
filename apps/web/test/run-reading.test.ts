import assert from "node:assert/strict";
import test from "node:test";
import { executionShouldOpen, messageReadingRole, toolFailureSummary, toolReadingTitle, toolShouldOpen } from "../src/features/chat/run-reading.ts";

test("uses interface tool titles without exposing their JavaScript arguments", () => {
  const inputSummary = JSON.stringify({ code: "var tab = await cua.createBrowserTab('iab', 'https://example.org');", title: "使用内置浏览器查阅原论文" });
  assert.equal(toolReadingTitle({ name: "cua_repl.js", inputSummary }), "使用内置浏览器查阅原论文");
  assert.equal(toolReadingTitle({ name: "cua_repl.js", inputSummary: '{"code":"var tab = await cua.createBrowserTab(' }), "界面操作");
  assert.equal(toolReadingTitle({ name: "cua_repl.js", inputSummary: '{"title":"Inspect a paper","code":"truncated' }), "Inspect a paper");
  assert.equal(toolReadingTitle({ name: "command.execute", inputSummary: "python3 artifacts/analysis.py\ncat report.md" }), "python3 artifacts/analysis.py");
  assert.equal(toolReadingTitle({ name: "web.search", inputSummary: '{"query":"parameter efficient fine tuning"}' }), "parameter efficient fine tuning");
});

test("extracts a concise real provider failure while preserving documentation only in raw output", () => {
  const output = JSON.stringify({ content: [
    { type: "text", text: "Browser is not available: iab" },
    { type: "text", text: "## Computer Use\n\nControl native apps and browsers.\n\n## API\n```typescript\ntype Failure = Error;" }
  ] });
  assert.equal(toolFailureSummary(output, "工具执行失败"), "Browser is not available: iab");
  assert.equal(toolFailureSummary(output.slice(0, -20), "工具执行失败"), "Browser is not available: iab");
  assert.equal(toolFailureSummary('{"error":{"message":"Access denied to this resource"}}', "工具执行失败"), "Access denied to this resource");
  assert.equal(toolFailureSummary('{"message":"The request timed out"}', undefined), "The request timed out");
  assert.equal(toolFailureSummary('{"content":[{"type":"text","text":"## Computer Use\\nAPI reference"}]}', "工具执行失败"), "工具执行失败");
  assert.equal(toolFailureSummary("Browser is not available: iab\n\n## Computer Use\nDocumentation Error type", "工具执行失败"), "Browser is not available: iab");
});

test("keeps malformed JSON out of the summary and bounds multiline diagnostics", () => {
  assert.equal(toolFailureSummary('{"unknown":"large raw response', "命令返回退出码 2"), "命令返回退出码 2");
  assert.equal(toolFailureSummary(undefined, undefined, true), "工具调用被拒绝");
  assert.equal(toolFailureSummary("Traceback (most recent call last):\n  File analysis.py\nModuleNotFoundError: No module named pandas", "工具执行失败"), "ModuleNotFoundError: No module named pandas");
  const summary = toolFailureSummary(JSON.stringify({ error: { message: "error: " + "x".repeat(500) + "\nmore" } }), undefined);
  assert.equal(summary.length, 240);
  assert.equal(summary.endsWith("…"), true);
  assert.equal(summary.includes("\n"), false);
});

test("historical failures cannot auto-open completed or cancelled execution groups", () => {
  for (const status of ["completed", "cancelled"] as const) {
    assert.equal(executionShouldOpen(status, false, true, true), false);
    assert.equal(executionShouldOpen(status, true, true, true), false);
  }
  assert.equal(executionShouldOpen("running", true, true, true), true);
  assert.equal(executionShouldOpen("running", false, false, true), false);
  assert.equal(executionShouldOpen("failed", false, true, true), true);
  assert.equal(executionShouldOpen("failed", false, false, true), false);
  assert.equal(toolShouldOpen(false, false, true, false), false);
  assert.equal(toolShouldOpen(false, true, true, true), true);
  assert.equal(toolShouldOpen(true, false, false, false), false);
  assert.equal(toolShouldOpen(true, true, false, false), true);
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
