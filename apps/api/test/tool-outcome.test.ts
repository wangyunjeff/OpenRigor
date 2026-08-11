import assert from "node:assert/strict";
import test, { after } from "node:test";
import { once } from "node:events";

// The classifier lives beside the Codex notification adapter. Importing the
// module starts the local HTTP server, so keep this test process isolated and
// close that listener when the focused unit tests finish.
process.env.PORT = "0";
process.env.OPENRIGOR_EXECUTOR = "demo";
const { classifyCodexToolOutcome, server } = await import("../src/server.js");
if (!server.listening) await once(server, "listening");

after(async () => {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

const searchAction = { type: "search", command: "rg", query: "needle", path: "." };
const listAction = { type: "listFiles", command: "rg --files", path: "." };

test("classifies an rg exit-1 search miss as no-result", () => {
  assert.deepEqual(
    classifyCodexToolOutcome({
      type: "commandExecution",
      status: "failed",
      command: "rg -n needle docs",
      commandActions: [searchAction],
      exitCode: 1,
      durationMs: 19
    }),
    {
      outcome: "no-result",
      exitCode: 1,
      durationMs: 19,
      diagnostic: "未找到匹配结果（退出码 1）"
    }
  );
});

test("reads Codex's wrapped exit marker and removes it from the displayed output", () => {
  const output = "__RG_EXIT_CODE__=1\r\n";
  assert.deepEqual(
    classifyCodexToolOutcome({
      type: "commandExecution",
      status: "completed",
      command: "rg -n needle docs",
      commandActions: [searchAction],
      exitCode: 0
    }, output),
    { outcome: "no-result", exitCode: 1, diagnostic: "未找到匹配结果（退出码 1）" }
  );
});

test("ignores marker-like text unless it occupies its own output line", () => {
  assert.deepEqual(
    classifyCodexToolOutcome({
      type: "commandExecution",
      status: "completed",
      command: "rg -n marker docs",
      commandActions: [searchAction],
      exitCode: 0
    }, "example=__RG_EXIT_CODE__=1"),
    { outcome: "success", exitCode: 0 }
  );
});

test("does not parse an exit marker from non-command tool output", () => {
  assert.deepEqual(
    classifyCodexToolOutcome({
      type: "fileSearch",
      status: "completed",
      exitCode: 0
    }, "__RG_EXIT_CODE__=1\n"),
    { outcome: "success", exitCode: 0 }
  );
});

test("allows quoted regex alternation in a standalone search", () => {
  assert.equal(
    classifyCodexToolOutcome({
      type: "commandExecution",
      status: "failed",
      command: "powershell -Command \"rg -n 'foo|bar' docs\"",
      commandActions: [searchAction],
      exitCode: 1
    })?.outcome,
    "no-result"
  );
});

test("classifies nonzero list/search output with stdout and warnings as partial", () => {
  const output = [
    "docs/README.md",
    "docs/PROTOCOL.md",
    "WARNING: skipped an inaccessible directory",
    "rg: papers: 系统找不到指定的文件。 (os error 2)",
    "rg: literature: 系统找不到指定的文件。 (os error 2)"
  ].join("\n");
  assert.deepEqual(
    classifyCodexToolOutcome({
      type: "commandExecution",
      status: "failed",
      command: "rg --files papers literature docs",
      commandActions: [listAction],
      exitCode: 2,
      durationMs: 31
    }, output),
    {
      outcome: "partial",
      exitCode: 2,
      durationMs: 31,
      diagnostic: "命令返回退出码 2，但产生了部分输出"
    }
  );
});

test("keeps PowerShell-only diagnostics as a real error", () => {
  const output = [
    "Get-Item : Cannot find path 'E:\\missing' because it does not exist.",
    "At line:1 char:1",
    "+ Get-Item E:\\missing | Select-String needle",
    "+ ~~~~~~~~~~~~~~~~~~~~",
    "    + CategoryInfo          : ObjectNotFound: (E:\\missing:String) [Get-Item], ItemNotFoundException",
    "    + FullyQualifiedErrorId : PathNotFound,Microsoft.PowerShell.Commands.GetItemCommand"
  ].join("\n");
  assert.deepEqual(
    classifyCodexToolOutcome({
      type: "commandExecution",
      status: "failed",
      command: "Get-Item E:\\missing | Select-String needle",
      commandActions: [searchAction],
      exitCode: 1,
      durationMs: 12
    }, output),
    {
      outcome: "error",
      exitCode: 1,
      durationMs: 12,
      diagnostic: "命令返回退出码 1"
    }
  );
});

test("does not turn a compound command failure into a search miss", () => {
  assert.equal(
    classifyCodexToolOutcome({
      type: "commandExecution",
      status: "failed",
      command: "cmd /c \"pnpm test & rg -n needle docs\"",
      commandActions: [searchAction],
      exitCode: 1
    })?.outcome,
    "error"
  );
});

test("classifies an exit-1 search wrapped after another command as partial when output exists", () => {
  const result = classifyCodexToolOutcome({
    type: "commandExecution",
    status: "failed",
    command: "Get-ChildItem -Force; rg -n needle .",
    commandActions: [listAction, searchAction],
    exitCode: 1,
    durationMs: 23
  }, "apps\npackages\n");
  assert.deepEqual(result, {
    outcome: "partial",
    exitCode: 1,
    durationMs: 23,
    diagnostic: "命令返回退出码 1，但产生了部分输出"
  });
});

test("keeps a search syntax failure as a real error", () => {
  const result = classifyCodexToolOutcome({
    type: "commandExecution",
    status: "failed",
    command: "rg --bad-option",
    commandActions: [searchAction],
    exitCode: 2,
    durationMs: 7
  }, "rg: unrecognized flag --bad-option");
  assert.deepEqual(result, {
    outcome: "error",
    exitCode: 2,
    durationMs: 7,
    diagnostic: "命令返回退出码 2"
  });
});

test("does not reinterpret a non-search exit-1 command", () => {
  assert.equal(
    classifyCodexToolOutcome({
      type: "commandExecution",
      status: "failed",
      command: "pnpm test",
      exitCode: 1
    })?.outcome,
    "error"
  );
});

test("preserves declined and successful outcomes with native metadata", () => {
  assert.deepEqual(
    classifyCodexToolOutcome({ type: "commandExecution", status: "declined", durationMs: 4 }),
    { outcome: "declined", durationMs: 4, diagnostic: "工具调用被拒绝" }
  );
  assert.deepEqual(
    classifyCodexToolOutcome({ type: "commandExecution", status: "completed", exitCode: 0, durationMs: 42 }),
    { outcome: "success", exitCode: 0, durationMs: 42 }
  );
  assert.equal(classifyCodexToolOutcome({ type: "commandExecution", status: "inProgress" }), undefined);
});
