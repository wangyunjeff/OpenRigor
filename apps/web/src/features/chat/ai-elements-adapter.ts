import type { RunEvent, RunSnapshot } from "@openrigor/protocol";
import type { ChatStatus } from "ai";
import type { ToolPart } from "../../components/ai-elements/tool";

type ToolPhase = Extract<RunEvent, { type: "tool" }>["tool"]["phase"];
type ToolOutcome = Extract<RunEvent, { type: "tool" }>["tool"]["outcome"];

export function toolPhaseToAiState(phase: ToolPhase, outcome?: ToolOutcome): ToolPart["state"] {
  if (phase === "requested") return "input-streaming";
  if (phase === "running") return "input-available";
  if (outcome === "declined") return "output-denied";
  if (outcome === "error") return "output-error";
  if (outcome === "success" || outcome === "no-result" || outcome === "partial") return "output-available";
  if (phase === "succeeded") return "output-available";
  return "output-error";
}

export function runStatusToChatStatus(status: RunSnapshot["status"]): ChatStatus {
  if (status === "failed") return "error";
  if (status === "queued") return "submitted";
  if (status === "running" || status === "waiting_tool" || status === "waiting_user" || status === "cancelling") return "streaming";
  return "ready";
}

export function isTerminalTool(name: string): boolean {
  const normalized = name.toLowerCase();
  return normalized.includes("command") || normalized.includes("shell") || normalized.includes("bash") || normalized.includes("terminal");
}

export function artifactLanguage(name: string): "diff" | "json" | "markdown" {
  const normalized = name.toLowerCase();
  if (normalized.startsWith("diff:") || normalized.endsWith(".diff") || normalized.endsWith(".patch")) return "diff";
  if (normalized.endsWith(".json")) return "json";
  if (normalized.endsWith(".md") || normalized.endsWith(".mdx")) return "markdown";
  return "markdown";
}
