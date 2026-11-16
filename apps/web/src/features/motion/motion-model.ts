import type { RunStatus } from "@openrigor/protocol";

/** The five states the React Bits StatusMark glyph can draw. */
export type MarkStatus = "pending" | "running" | "done" | "failed" | "cancelled";
export type MarkTone = "neutral" | "live" | "attention";

export interface TaskMark {
  status: MarkStatus;
  tone: MarkTone;
  label: string;
}

const workingStatuses = new Set<RunStatus>(["running", "waiting_tool", "cancelling"]);

/**
 * Map a run status to its glyph. The spinning arc is reserved for work this
 * client is watching live; a task last recorded as running, with no live
 * stream, shows a still ring rather than claiming activity.
 */
export function taskMark(status: RunStatus, live: boolean): TaskMark {
  if (status === "completed") return { status: "done", tone: "neutral", label: "Completed" };
  if (status === "failed") return { status: "failed", tone: "neutral", label: "Failed" };
  if (status === "cancelled") return { status: "cancelled", tone: "neutral", label: "Stopped" };
  if (status === "waiting_user") return { status: "pending", tone: "attention", label: "Needs input" };
  if (status === "queued") return { status: "pending", tone: "live", label: "Queued" };
  if (workingStatuses.has(status)) {
    return live
      ? { status: "running", tone: "live", label: status === "cancelling" ? "Stopping" : "Working" }
      : { status: "pending", tone: "live", label: "Last seen working" };
  }
  return { status: "pending", tone: "neutral", label: "Pending" };
}

/** Map one tool call to its glyph. Only a call this client is streaming may spin. */
export function toolMark({ pending, live, outcome }: { pending: boolean; live: boolean; outcome?: "success" | "no-result" | "partial" | "error" | "declined" | undefined }): { status: MarkStatus; tone: MarkTone } {
  if (pending) return live ? { status: "running", tone: "live" } : { status: "pending", tone: "neutral" };
  if (outcome === "error") return { status: "failed", tone: "neutral" };
  if (outcome === "declined") return { status: "cancelled", tone: "neutral" };
  if (outcome === "partial") return { status: "done", tone: "attention" };
  return { status: "done", tone: "neutral" };
}

/** Map a plan step to its glyph; the current step spins only while the run is live. */
export function planMark(status: "pending" | "in_progress" | "completed", live: boolean): { status: MarkStatus; tone: MarkTone } {
  if (status === "completed") return { status: "done", tone: "neutral" };
  if (status === "in_progress") return live ? { status: "running", tone: "live" } : { status: "pending", tone: "live" };
  return { status: "pending", tone: "neutral" };
}

export interface SmoothScrollPolicy {
  /** Whether to run Lenis at all. Native scrolling is the fallback. */
  enabled: boolean;
  /** Per-frame interpolation toward the wheel target; lower is silkier. */
  lerp: number;
  wheelMultiplier: number;
}

/**
 * Smooth scrolling is an enhancement for pointer-wheel reading surfaces. It is
 * off when the reader prefers reduced motion, and touch scrolling always stays
 * native so momentum and overscroll feel like the platform.
 */
export function smoothScrollPolicy({ active, reducedMotion }: { active: boolean; reducedMotion: boolean }): SmoothScrollPolicy {
  return { enabled: active && !reducedMotion, lerp: 0.12, wheelMultiplier: 1 };
}

/** Stagger for a revealed group: quick enough that a long grid never keeps the reader waiting. */
export function revealStagger(count: number, each = 0.06, cap = 0.36): number {
  if (count <= 1) return 0;
  return Math.min(each, cap / (count - 1));
}
