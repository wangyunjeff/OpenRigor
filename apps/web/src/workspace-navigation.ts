const modalPages = new Set(["agent", "settings", "workspace", "search"]);
const returnStateKey = "openrigorModalReturn";
const historyStateKey = "openrigorModalHistory";
export function isModalWorkspacePage(page: string | null): boolean { return page !== null && modalPages.has(page); }
export function chatPath(rootRunId?: string | null): string { return rootRunId ? `/chat/${encodeURIComponent(rootRunId)}` : "/chat"; }
function returnPath(state: unknown): string | null {
  if (!state || typeof state !== "object") return null;
  const path = (state as Record<string, unknown>)[returnStateKey];
  return typeof path === "string" && /^\/(chat(?:\/[^/?#]+)?|images|skills|projects|research|guides|handoff)(?:\?[^#]*)?$/.test(path) ? path : null;
}

export function openModalNavigation(currentPath: string, currentPage: string | null, state: unknown, fallbackPath: string): { method: "push" | "replace"; state: Record<string, string> } {
  const alreadyModal = isModalWorkspacePage(currentPage);
  const priorPath = returnPath(state);
  const hasBackEntry = Boolean(priorPath && state && typeof state === "object" && (state as Record<string, unknown>)[historyStateKey] === "push");
  return { method: alreadyModal ? "replace" : "push", state: {
    [returnStateKey]: alreadyModal ? priorPath ?? fallbackPath : currentPath === "/" ? "/chat" : currentPath,
    [historyStateKey]: !alreadyModal || hasBackEntry ? "push" : "replace"
  } };
}

export function closeModalNavigation(state: unknown, fallbackPath: string): { method: "back" | "replace"; path: string } {
  const path = returnPath(state);
  const hasBackEntry = Boolean(state && typeof state === "object" && (state as Record<string, unknown>)[historyStateKey] === "push");
  return path ? { method: hasBackEntry ? "back" : "replace", path } : { method: "replace", path: fallbackPath };
}
