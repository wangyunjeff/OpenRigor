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
  if (/cua(?:_repl)?[._]/i.test(tool.name)) return "界面操作";
  const parameter = text(input?.query) ?? text(input?.command) ?? text(input?.cmd) ?? text(input?.path);
  if (parameter) return oneLine(parameter, 140);
  const raw = tool.inputSummary?.trim();
  if (raw && !/^[{[]/.test(raw)) return oneLine(raw.split(/\r?\n/)[0] ?? raw, 140);
  if (/web[._]search|search/i.test(tool.name)) return "检索资料";
  if (/command|shell|bash|terminal/i.test(tool.name)) return "运行命令";
  if (/plan/i.test(tool.name)) return "更新研究计划";
  if (/file/i.test(tool.name)) return "处理文件";
  return oneLine(tool.name.replaceAll("_", " "), 140);
}

function errorLine(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const lines = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  // Tool bootstrap documentation is retained in Details, never used as an error summary.
  const documentation = lines.findIndex((line) => /^#{1,6}\s*(?:Computer Use|API|Documentation|Usage|Tools?)\b/i.test(line));
  const relevant = documentation === -1 ? lines : lines.slice(0, documentation);
  const usable = relevant.filter((line) => !/^(?:```|~~~|#{1,6}\s)/.test(line));
  const failure = [...usable].reverse().find((line) => /error|failed|cannot|not (?:available|found)|denied|timed? ?out|exception|失败|错误|不可用|找不到|拒绝|超时/i.test(line));
  return text(failure ?? usable[0]);
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
    reason = errorLine(output);
  }
  return oneLine(reason ?? diagnostic ?? (declined ? "工具调用被拒绝" : "工具执行失败"), 240);
}

/** Completed or cancelled history should never reopen because a tool once failed. */
export function executionShouldOpen(status: RunStatus, current: boolean, latest: boolean, hasFailure: boolean): boolean {
  if (status === "completed" || status === "cancelled") return false;
  if (status === "failed") return latest && hasFailure;
  return current;
}

export function toolShouldOpen(pending: boolean, live: boolean, hasFailure: boolean, attention: boolean): boolean {
  return (pending && live) || (hasFailure && attention);
}

export function messageReadingRole(status: RunStatus, latest: boolean, done: boolean): "answer" | "update" | "partial" {
  if (latest && status === "completed" && done) return "answer";
  if (latest && (status === "failed" || status === "cancelled")) return "partial";
  return "update";
}
