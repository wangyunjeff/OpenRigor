import type { ConversationRunView } from "../../conversation";
import { createContext, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { emptyPreviewState, previewStateForScope, upsertPreviewTab, closePreviewTab, selectPreviewTab, type PreviewState as ViewerState } from "./preview-state";
import { safeWebUrl, type ResearchArtifact } from "../chat/ai-elements-adapter";
import { workspaceApiBase } from "../workspace/api";
import { latestPreviewFiles, previewFileKey, previewFileUrl, safeWorkspacePreviewPath, type PreviewFile } from "./file-preview-model";

export type PreviewTab = { id: string; kind: "file"; title: string; file: PreviewFile }
  | { id: string; kind: "workspace"; title: string; path: string; projectId?: string }
  | { id: string; kind: "web"; title: string; url: string };
type PreviewState = ViewerState<PreviewTab>;
interface PreviewContextValue {
  scope: string; tabs: PreviewTab[]; activeId: string | null; open: boolean; files: PreviewFile[]; latestFiles: PreviewFile[]; runs: ConversationRunView[];
  projects: readonly { id: string; name: string }[];
  openArtifact: (file: ResearchArtifact) => void; openFile: (file: PreviewFile) => void;
  openWorkspace: (path: string, projectId?: string) => void; openWeb: (url: string, title?: string) => void;
  openHref: (url: string, title?: string) => boolean; select: (id: string) => void; closeTab: (id: string) => void;
  show: () => void; hide: () => void; registerFile: (file: PreviewFile) => void;
  updateWebTitle: (id: string, title: string) => void;
}
const PreviewContext = createContext<PreviewContextValue | null>(null);
export function usePreview(): PreviewContextValue | null { return useContext(PreviewContext); }
const emptyState = (scope: string): PreviewState => emptyPreviewState<PreviewTab>(scope);

export function PreviewProvider({ scope, files, runs, projects = [], children, onOpen }: { scope: string; files: PreviewFile[]; runs: ConversationRunView[]; projects?: readonly { id: string; name: string }[]; children: ReactNode; onOpen?: () => void }) {
  const [stored, setStored] = useState<PreviewState>(() => emptyState(scope));
  const state = previewStateForScope(stored, scope);
  const trigger = useRef<HTMLElement | null>(null);
  const available = useMemo(() => [...new Map([...files, ...state.tabs.flatMap((tab) => tab.kind === "file" ? [tab.file] : [])].map((file) => [previewFileKey(file), file])).values()], [files, state.tabs]);
  // Current workspace metadata takes precedence over an older open tab; the
  // complete registry above still retains exact artifact revisions for links.
  const latestFiles = useMemo(() => latestPreviewFiles([...state.tabs.flatMap((tab) => tab.kind === "file" ? [tab.file] : []), ...files]), [files, state.tabs]);
  const mutate = (action: (previous: PreviewState) => PreviewState) => setStored((previous) => action(previewStateForScope(previous, scope)));
  function openTab(tab: PreviewTab) {
    onOpen?.();
    if (!state.open && document.activeElement instanceof HTMLElement) trigger.current = document.activeElement;
    mutate((previous) => upsertPreviewTab(previous, tab));
  }
  const openFile = (file: PreviewFile) => openTab({ id: file.origin === "workspace" ? JSON.stringify(["workspace", file.projectId ?? null, file.path ?? file.name]) : previewFileKey(file), kind: "file", title: file.name.split("/").at(-1) ?? file.name, file });
  const openArtifact = (file: ResearchArtifact) => openFile({ ...file, origin: "artifact" });
  const openWorkspace = (path: string, projectId?: string) => {
    const safe = safeWorkspacePreviewPath(path);
    if (safe) openTab({ id: JSON.stringify(["workspace", projectId ?? null, safe]), kind: "workspace", title: safe.split("/").at(-1)!, path: safe, ...(projectId ? { projectId } : {}) });
  };
  const openWeb = (url: string, title?: string) => {
    const safe = safeWebUrl(url);
    if (safe) openTab({ id: `web:${safe}`, kind: "web", url: safe, title: title?.trim() || new URL(safe).hostname });
  };
  function openHref(href: string, title?: string): boolean {
    let url: URL;
    try { url = new URL(href, workspaceApiBase); } catch { return false; }
    const file = available.find((candidate) => ["download", "content", "preview"].some((kind) => previewFileUrl(candidate, kind as "download" | "content" | "preview", workspaceApiBase) === url.href));
    if (file) { openFile(file); return true; }
    if (url.origin === new URL(workspaceApiBase).origin) {
      if (url.pathname === "/api/files/download" && url.searchParams.getAll("path").length === 1 && url.searchParams.getAll("projectId").length <= 1 && [...url.searchParams.keys()].every((key) => ["path", "projectId"].includes(key)) && safeWorkspacePreviewPath(url.searchParams.get("path") ?? "")) {
        openWorkspace(url.searchParams.get("path")!, url.searchParams.get("projectId") ?? undefined); return true;
      }
      return false;
    }
    if ((href.startsWith("https://") || href.startsWith("http://")) && safeWebUrl(href)) { openWeb(href, title); return true; }
    return false;
  }
  const hide = () => { mutate((previous) => ({ ...previous, open: false })); requestAnimationFrame(() => { if (trigger.current?.isConnected) trigger.current.focus(); else document.querySelector<HTMLElement>(".preview-launcher")?.focus(); }); };
  return <PreviewContext.Provider value={{ ...state, files: available, latestFiles, runs, projects, openArtifact, openFile, openWorkspace, openWeb, openHref,
    registerFile: (file) => setStored((previous) => previous.scope !== scope ? previous : ({ ...previous, tabs: previous.tabs.map((tab) => tab.kind === "workspace" && tab.path === file.path && tab.projectId === file.projectId ? { id: tab.id, kind: "file", title: file.name.split("/").at(-1) ?? file.name, file } : tab) })),
    updateWebTitle: (id, title) => {
      const clean = title.replace(/\s+/g, " ").trim().slice(0, 200);
      if (clean) setStored((previous) => previous.scope !== scope ? previous : ({ ...previous, tabs: previous.tabs.map((tab) => tab.id === id && tab.kind === "web" && tab.title !== clean ? { ...tab, title: clean } : tab) }));
    },
    select: (id) => mutate((previous) => selectPreviewTab(previous, id)),
    closeTab: (id) => mutate((previous) => closePreviewTab(previous, id)),
    show: () => { onOpen?.(); if (!state.open && document.activeElement instanceof HTMLElement) trigger.current = document.activeElement; mutate((previous) => ({ ...previous, open: true })); }, hide
  }}>{children}</PreviewContext.Provider>;
}
