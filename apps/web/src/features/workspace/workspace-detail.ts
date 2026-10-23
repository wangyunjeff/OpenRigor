import type { WorkspaceProject, WorkspaceSettings } from "./api";

export interface ProjectDraft {
  name: string;
  description: string;
  instructions: string;
  dirty: boolean;
}

export function projectDraft(project: WorkspaceProject): ProjectDraft {
  return { name: project.name, description: project.description ?? "", instructions: project.instructions ?? "", dirty: false };
}

/** Server refreshes may update clean forms, but never replace an unsaved project draft. */
export function reconcileProjectDrafts(drafts: Record<string, ProjectDraft>, projects: WorkspaceProject[]): Record<string, ProjectDraft> {
  const next = { ...drafts };
  for (const project of projects) if (!drafts[project.id]?.dirty) next[project.id] = projectDraft(project);
  return next;
}

/** Appearance refreshes must not replace a persona the operator is still editing. */
export function reconcileSettingsDraft(draft: WorkspaceSettings, latest: WorkspaceSettings, agentDirty: boolean): WorkspaceSettings {
  return agentDirty ? { ...latest, ...(draft.agent ? { agent: draft.agent } : {}) } : latest;
}

export const knowledgeContentLimit = 64_000;
export const knowledgeTitleLimit = 200;

export interface KnowledgeDraft { id: string | null; name: string; content: string }

export function knowledgeSaveRequest(draft: KnowledgeDraft, projectId: string): {
  path: string;
  method: "POST" | "PATCH";
  body: { name: string; content: string; projectId?: string };
} {
  const name = draft.name.trim();
  const content = draft.content.trim();
  if (!name || !content) throw new Error("Add a title and reference content before saving.");
  if (name.length > knowledgeTitleLimit || content.length > knowledgeContentLimit) throw new Error("Keep the title within 200 characters and reference content within 64,000 characters.");
  return draft.id === null
    ? { path: "/api/knowledge", method: "POST", body: { name, content, projectId } }
    : { path: `/api/knowledge/${encodeURIComponent(draft.id)}`, method: "PATCH", body: { name, content } };
}

export interface FileBrowserLocation { projectId: string | null; path: string }

/** A folder path belongs to one project root and must not carry into another root. */
export function fileBrowserPath(location: FileBrowserLocation, projectId?: string): string {
  return location.projectId === (projectId ?? null) ? location.path : "";
}

export function fileBrowserScope(projectId: string | undefined, path: string): string {
  return JSON.stringify([projectId ?? null, path]);
}

export function directoryBreadcrumbs(path: string): Array<{ name: string; path: string }> {
  const segments = path.split("/").filter(Boolean);
  return segments.map((name, index) => ({ name, path: segments.slice(0, index + 1).join("/") }));
}
