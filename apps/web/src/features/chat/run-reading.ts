import type { RunStatus, ToolCall } from "@openrigor/protocol";

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function jsonRecord(value: string | undefined): Record<string, unknown> | undefined {
  if (!value || value.length > 64_000) return undefined;
  try { return record(JSON.parse(value)); } catch { return undefined; }
}

function oneLine(value: string, limit: number): string {
  const text = value.replace(/\u001b\[[0-9;]*m/g, "").replace(/[\u0000-\u001f\u007f\s]+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

/** Recover a complete string field even when the surrounding provider summary was truncated. */
function stringField(value: string | undefined, key: "title" | "text" | "message"): string | undefined {
  const match = value?.match(new RegExp(`"${key}"\\s*:\\s*("(?:\\\\.|[^"\\\\])*")`));
  if (!match?.[1]) return undefined;
  try { const parsed: unknown = JSON.parse(match[1]); return typeof parsed === "string" ? parsed : undefined; } catch { return undefined; }
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

/** Parameters stay in diagnostic details; a title never becomes a code dump. */
export function toolReadingTitle(tool: Pick<ToolCall, "name" | "inputSummary">): string {
  const input = jsonRecord(tool.inputSummary);
  const title = text(input?.title) ?? (/^\s*\{/.test(tool.inputSummary ?? "") ? stringField(tool.inputSummary, "title") : undefined);
  if (title) return oneLine(title, 140);
  if (/cua(?:_repl)?[._]/i.test(tool.name)) return "Interface action";
  const parameter = text(input?.query) ?? text(input?.command) ?? text(input?.cmd) ?? text(input?.path);
  if (parameter) return oneLine(parameter, 140);
  const raw = tool.inputSummary?.trim();
  if (raw && !/^[{[]/.test(raw)) return oneLine(raw.split(/\r?\n/)[0] ?? raw, 140);
  if (/web[._]search|search/i.test(tool.name)) return "Web search";
  if (/command|shell|bash|terminal/i.test(tool.name)) return "Run a command";
  if (/plan/i.test(tool.name)) return "Update the plan";
  if (/file/i.test(tool.name)) return "Edit files";
  return oneLine(tool.name.replaceAll("_", " "), 140);
}

const FAILURE_LINE = /error|failed|failure|cannot|not (?:available|found)|denied|timed? ?out|exception|panic|fatal|✖|✗|失败|错误|不可用|找不到|拒绝|超时/i;
/** Test-runner verdicts are upper case; a lower-case "fail 1" tally is not a reason. */
const FAILURE_VERDICT = /\bFAIL\b/;

/** The most specific failure line; with `strict`, nothing when no line reads as a failure. */
function errorLine(value: string | undefined, strict = false): string | undefined {
  if (!value) return undefined;
  const lines = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  // Tool bootstrap documentation is retained in Details, never used as an error summary.
  const documentation = lines.findIndex((line) => /^#{1,6}\s*(?:Computer Use|API|Documentation|Usage|Tools?)\b/i.test(line));
  const relevant = documentation === -1 ? lines : lines.slice(0, documentation);
  const usable = relevant.filter((line) => !/^(?:```|~~~|#{1,6}\s)/.test(line) && !/^traceback \(most recent call last\)/i.test(line));
  const failure = [...usable].reverse().find((line) => FAILURE_LINE.test(line) || FAILURE_VERDICT.test(line));
  return text(failure ?? (strict ? undefined : usable[0]));
}

/** Read only known error envelopes. Unknown or malformed JSON stays in raw Details. */
export function toolFailureSummary(output: string | undefined, diagnostic: string | undefined, declined = false): string {
  const result = jsonRecord(output);
  let reason: string | undefined;
  if (result) {
    reason = text(record(result.error)?.message) ?? text(result.error) ?? text(result.message);
    if (!reason && Array.isArray(result.content)) {
      for (const item of result.content) {
        const content = record(item);
        if (content?.type !== "text") continue;
        reason = errorLine(text(content.text));
        if (reason) break;
      }
    }
  } else if (/^\s*[{[]/.test(output ?? "")) {
    reason = errorLine(stringField(output, "message") ?? stringField(output, "text"));
  } else {
    // Plain command output: a recognizable failure line beats the runtime
    // diagnostic, which beats an arbitrary first line such as a script banner.
    reason = errorLine(output, true) ?? diagnostic ?? errorLine(output);
  }
  return oneLine(reason ?? diagnostic ?? (declined ? "The tool call was declined" : "The tool failed"), 240);
}

/**
 * The work log is open while the agent works and after a failure, so the
 * cause stays visible. Completed or stopped history collapses behind its
 * one-line summary, regardless of any tool that once failed.
 */
export function processShouldOpen(status: RunStatus): boolean {
  return status !== "completed" && status !== "cancelled";
}

export type ToolKind = "command" | "search" | "file" | "browser" | "subagent" | "image" | "plan" | "wait" | "mcp" | "tool";

/** Choose a presentation family from the provider tool name; never from its arguments. */
export function toolKind(name: string): ToolKind {
  const normalized = name.toLowerCase();
  if (/command|shell|bash|terminal|exec/.test(normalized)) return "command";
  if (/web[._]search|search/.test(normalized)) return "search";
  if (/cua(?:_repl)?[._]|browser/.test(normalized)) return "browser";
  if (/^file[._]|[._]file|patch/.test(normalized)) return "file";
  if (/subagent|collab/.test(normalized)) return "subagent";
  if (/image/.test(normalized)) return "image";
  if (/plan/.test(normalized)) return "plan";
  if (/sleep|wait/.test(normalized)) return "wait";
  if (normalized.includes(".")) return "mcp";
  return "tool";
}

export function toolShouldOpen(pending: boolean, live: boolean, hasFailure: boolean, attention: boolean): boolean {
  return (pending && live) || (hasFailure && attention);
}

export function messageReadingRole(status: RunStatus, latest: boolean, done: boolean): "answer" | "update" | "partial" {
  if (latest && status === "completed" && done) return "answer";
  if (latest && (status === "failed" || status === "cancelled")) return "partial";
  return "update";
}

interface SegmentLike {
  kind: "message" | "reasoning" | "execution";
  activities?: Array<{ kind: string }>;
}

/**
 * Find the message that reads as the turn's response. Generated-file records
 * published right after that message do not demote it to work-log commentary;
 * any later reasoning, tool call, or error does.
 */
export function responseTailIndex(segments: SegmentLike[]): number {
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index]!;
    if (segment.kind === "message") return index;
    if (segment.kind === "execution" && segment.activities?.every((activity) => activity.kind === "file" || activity.kind === "diff")) continue;
    return -1;
  }
  return -1;
}
