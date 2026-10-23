import { createHash } from "node:crypto";
import type { PlanStep, RunSource } from "@openrigor/protocol";
import type { CodexDynamicToolSpec } from "./codex-app-server.js";

export const OPENRIGOR_PLAN_TOOL: CodexDynamicToolSpec = {
  type: "function", name: "openrigor_update_plan", deferLoading: false,
  description: "Publish or update the real work plan shown to the user. Use for nontrivial multi-step work. Report actual pending, in_progress, or completed status, and update as work proceeds. This tool only records state and does not execute commands.",
  inputSchema: {
    type: "object", additionalProperties: false, required: ["steps"],
    properties: {
      steps: { type: "array", minItems: 1, maxItems: 60, items: { type: "object", additionalProperties: false, required: ["step", "status"], properties: { step: { type: "string", minLength: 1, maxLength: 1000 }, status: { type: "string", enum: ["pending", "in_progress", "completed"] } } } },
      explanation: { type: "string", maxLength: 4000 }
    }
  }
};

export function validatePlanToolArguments(value: unknown): { steps: PlanStep[]; explanation?: string } {
  const input = object(value);
  if (!input || Object.keys(input).some((key) => !["steps", "explanation"].includes(key)) || !Array.isArray(input.steps) || !input.steps.length || input.steps.length > 60) throw new Error("Provide 1–60 steps with step and status fields.");
  for (const step of input.steps) {
    const row = object(step);
    if (!row || Object.keys(row).some((key) => !["step", "status"].includes(key)) || typeof row.step !== "string" || !row.step.trim() || row.step.length > 1000 || !["pending", "in_progress", "completed"].includes(String(row.status))) throw new Error("Each step requires text and a valid status.");
  }
  if (input.explanation !== undefined && (typeof input.explanation !== "string" || input.explanation.length > 4000)) throw new Error("Plan explanation must be at most 4000 characters.");
  return parseCodexPlan({ plan: input.steps, explanation: input.explanation })!;
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
function text(value: unknown, maximum: number): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  return value.replace(/\b(?:sk|sess)-[a-zA-Z0-9_-]{12,}\b/g, "[redacted]")
    .replace(/\b(?:Bearer\s+)[a-zA-Z0-9._~+/-]+=*/gi, "Bearer [redacted]")
    .replace(/((?:api[_-]?key|access[_-]?token|password|cookie|authorization)\s*[=:]\s*)[^\s,;]+/gi, "$1[redacted]")
    .trim().slice(0, maximum);
}

export function parseCodexPlan(params: Record<string, unknown>): { steps: PlanStep[]; explanation?: string } | undefined {
  if (!Array.isArray(params.plan)) return undefined;
  const steps = params.plan.slice(0, 60).flatMap((value): PlanStep[] => {
    const row = object(value);
    const step = text(row?.step, 1_000);
    const status = row?.status;
    return step && (status === "pending" || status === "in_progress" || status === "completed") ? [{ step, status }] : [];
  });
  const explanation = text(params.explanation, 4_000);
  return { steps, ...(explanation ? { explanation } : {}) };
}

function sourceUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 4_000) return undefined;
  try {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return undefined;
    const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname === "::1" || hostname === "::" || /^(?:0|10|127|169\.254|192\.168|172\.(?:1[6-9]|2\d|3[01]))\./.test(hostname) || (hostname.includes(":") && /^(?:fc|fd|fe80:|::ffff:)/.test(hostname))) return undefined;
    if ([...url.searchParams.keys()].some((key) => /^(?:api[_-]?key|token|access[_-]?token|key|password|secret|auth|authorization|cookie)$/i.test(key))) return undefined;
    url.hash = "";
    return url.href;
  } catch { return undefined; }
}

/** Extract only structured evidence from a provider webSearch item, never answer prose. */
export function extractCodexSources(item: Record<string, unknown>): RunSource[] {
  if (item.type !== "webSearch") return [];
  const action = object(item.action);
  const query = text(item.query ?? action?.query ?? (Array.isArray(action?.queries) ? action.queries.join("; ") : undefined), 1_000);
  const toolCallId = text(item.id, 200);
  const candidates: unknown[] = [];
  const pageActions = new Set<unknown>();
  // Only provider-owned result containers are traversed; arbitrary output/text is not evidence.
  for (const container of [item, action, object(item.result)]) {
    if (!container) continue;
    for (const field of ["sources", "results", "searchResults"]) {
      const values = container[field];
      if (Array.isArray(values)) candidates.push(...values.slice(0, 60));
    }
  }
  if (action && ["openPage", "open_page", "open", "findInPage", "find_in_page", "find"].includes(String(action.type))) { candidates.push(action); pageActions.add(action); }
  const sources = new Map<string, RunSource>();
  for (const candidate of candidates.slice(0, 180)) {
    const row = object(candidate);
    if (!row) continue;
    const nested = object(row.source);
    const url = sourceUrl(row.url ?? row.link ?? nested?.url);
    if (!url || sources.has(url)) continue;
    const title = text(row.title ?? row.name ?? nested?.title, 500) ?? new URL(url).hostname;
    const snippet = text(row.snippet ?? row.description ?? nested?.snippet, 2_000);
    sources.set(url, {
      sourceId: `source_${createHash("sha256").update(url).digest("hex").slice(0, 24)}`,
      url, title, origin: "web-search", kind: pageActions.has(candidate) ? "page-request" : "search-result",
      ...(snippet ? { snippet } : {}), ...(query ? { query } : {}), ...(toolCallId ? { toolCallId } : {})
    });
    if (sources.size >= 40) break;
  }
  return [...sources.values()];
}
