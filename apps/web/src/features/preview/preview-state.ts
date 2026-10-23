/** Small, synchronous transitions keep a viewer scoped to the visible task. */
export interface IdentifiedPreviewTab { id: string }

export interface PreviewState<T extends IdentifiedPreviewTab = IdentifiedPreviewTab> {
  scope: string;
  tabs: T[];
  activeId: string | null;
  open: boolean;
}

export const maxPreviewTabs = 12;

export function emptyPreviewState<T extends IdentifiedPreviewTab = IdentifiedPreviewTab>(scope: string): PreviewState<T> {
  return { scope, tabs: [], activeId: null, open: false };
}

/** Derive this during render as well as inside state setters; no effect is required. */
export function previewStateForScope<T extends IdentifiedPreviewTab>(stored: PreviewState<T>, scope: string): PreviewState<T> {
  return stored.scope === scope ? stored : emptyPreviewState<T>(scope);
}

function uniqueTabs<T extends IdentifiedPreviewTab>(tabs: T[]): T[] {
  // Keep the first position and latest descriptor for an already-known identity.
  return [...new Map(tabs.map((tab) => [tab.id, tab])).values()];
}

/** Ids are canonical identities supplied by the file/web model, never filenames. */
export function upsertPreviewTab<T extends IdentifiedPreviewTab>(state: PreviewState<T>, tab: T): PreviewState<T> {
  const unique = uniqueTabs(state.tabs);
  const updated = unique.some((item) => item.id === tab.id)
    ? unique.map((item) => item.id === tab.id ? tab : item)
    : [...unique, tab];
  let tabs = updated.slice(-maxPreviewTabs);
  // This branch also repairs an oversized imported state without losing selection.
  if (!tabs.some((item) => item.id === tab.id)) tabs = [...tabs.slice(1), tab];
  return { ...state, tabs, activeId: tab.id, open: true };
}

/** Closing an active tab selects its next neighbor, then its previous neighbor. */
export function closePreviewTab<T extends IdentifiedPreviewTab>(state: PreviewState<T>, id: string): PreviewState<T> {
  const unique = uniqueTabs(state.tabs);
  const closedIndex = unique.findIndex((tab) => tab.id === id);
  const tabs = unique.filter((tab) => tab.id !== id);
  const activeId = state.activeId !== id && tabs.some((tab) => tab.id === state.activeId)
    ? state.activeId
    : tabs[Math.min(closedIndex >= 0 ? closedIndex : tabs.length - 1, tabs.length - 1)]?.id ?? null;
  // An empty, open viewer intentionally returns to its task-file library.
  return { ...state, tabs, activeId };
}

export function selectPreviewTab<T extends IdentifiedPreviewTab>(state: PreviewState<T>, id: string): PreviewState<T> {
  return state.tabs.some((tab) => tab.id === id) ? { ...state, activeId: id, open: true } : state;
}
