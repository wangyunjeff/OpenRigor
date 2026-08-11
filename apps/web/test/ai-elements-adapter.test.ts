import assert from "node:assert/strict";
import test from "node:test";
import { artifactLanguage, isTerminalTool, runStatusToChatStatus, toolPhaseToAiState } from "../src/features/chat/ai-elements-adapter";

test("maps OpenRigor runtime states to AI Elements states", () => {
  assert.equal(toolPhaseToAiState("requested"), "input-streaming");
  assert.equal(toolPhaseToAiState("running"), "input-available");
  assert.equal(toolPhaseToAiState("succeeded"), "output-available");
  assert.equal(toolPhaseToAiState("failed"), "output-error");
  assert.equal(runStatusToChatStatus("queued"), "submitted");
  assert.equal(runStatusToChatStatus("waiting_tool"), "streaming");
  assert.equal(runStatusToChatStatus("waiting_user"), "streaming");
  assert.equal(runStatusToChatStatus("completed"), "ready");
  assert.equal(runStatusToChatStatus("failed"), "error");
  assert.equal(isTerminalTool("command.execute"), true);
  assert.equal(isTerminalTool("web.search"), false);
});

test("selects a stable renderer for artifacts", () => {
  assert.equal(artifactLanguage("diff:src/app.tsx"), "diff");
  assert.equal(artifactLanguage("report.md"), "markdown");
  assert.equal(artifactLanguage("result.json"), "json");
  assert.equal(artifactLanguage("notes.txt"), "markdown");
});
