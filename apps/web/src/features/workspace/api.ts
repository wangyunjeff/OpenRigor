export interface WorkspaceProject {
  id: string;
  name: string;
  description?: string;
  instructions?: string;
  path?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface WorkspaceSkill {
  id: string;
  name?: string;
  label?: string;
  description: string;
  category?: string;
  installed: boolean;
  instructions?: string;
}

export interface WorkspaceKnowledge {
  id: string;
  name: string;
  content: string;
  projectId?: string;
  createdAt?: string;
}

export interface WorkspaceImage {
  id: string;
  prompt: string;
  model: string;
  size: string;
  quality?: string;
  createdAt: string;
  url?: string;
  fileUrl?: string;
  mimeType?: string;
}

export interface WorkspaceConversation {
  rootRunId: string;
  conversationId: string;
  latestRunId: string;
  prompt: string;
  title?: string;
  status: string;
  updatedAt: string;
  projectId?: string;
  pinned?: boolean;
  archived?: boolean;
}

export interface WorkspaceProfile {
  displayName: string;
  email?: string;
  language?: string;
  avatar?: string;
}

export interface WorkspaceSettings {
  theme?: "light" | "dark" | "system";
  language?: string;
  agent?: { name: string; instructions: string; defaultModel: string; effort: string };
  [key: string]: unknown;
}

export interface WorkspaceRuntime {
  executor?: string;
  workspace?: string;
  cwd?: string;
  sandbox?: string;
  imageGenerationConfigured?: boolean;
  [key: string]: unknown;
}

export interface WorkspaceOverview {
  workspace: { id: string; name: string; path: string };
  profile: WorkspaceProfile;
  settings: WorkspaceSettings;
  runtime: WorkspaceRuntime;
  projects: WorkspaceProject[];
  skills: WorkspaceSkill[];
  knowledge: WorkspaceKnowledge[];
  images: WorkspaceImage[];
  conversations: WorkspaceConversation[];
}

export const workspaceApiBase = (import.meta.env?.VITE_API_BASE_URL as string | undefined) ?? "http://localhost:8787";

export class WorkspaceApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "WorkspaceApiError";
  }
}

export function describeApiError(error: unknown): string {
  if (error instanceof WorkspaceApiError) return error.message;
  if (error instanceof Error && error.name === "AbortError") return "The request took too long. Please try again.";
  if (error instanceof TypeError) return "Cannot reach the local workspace API. Check that the API is running, then retry.";
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}

export async function workspaceRequest<T>(path: string, options: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const response = await fetch(`${workspaceApiBase}${path}`, {
    method: options.method ?? "GET",
    headers: options.body === undefined ? { Accept: "application/json" } : { Accept: "application/json", "Content-Type": "application/json" },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    ...(options.signal === undefined ? {} : { signal: options.signal })
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
    const nested = record.error && typeof record.error === "object" ? record.error as Record<string, unknown> : {};
    const message = typeof record.error === "string" ? record.error : typeof record.message === "string" ? record.message : typeof nested.message === "string" ? nested.message : `Request failed (${response.status}).`;
    throw new WorkspaceApiError(message, response.status);
  }
  return payload as T;
}

export function imageFileUrl(image: WorkspaceImage): string {
  const value = image.fileUrl ?? image.url ?? `/api/images/${encodeURIComponent(image.id)}/file`;
  return value.startsWith("/") ? `${workspaceApiBase}${value}` : value;
}

/** The API and UI use different local origins, so the HTML download attribute alone is insufficient. */
export async function downloadWorkspaceFile(url: string, filename: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) throw new WorkspaceApiError(`Could not download this file (${response.status}).`, response.status);
  const objectUrl = URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

export function conversationTitle(item: WorkspaceConversation): string {
  return item.title?.trim() || item.prompt.split("\n").find((line) => line.trim())?.trim() || "Untitled task";
}

export function formatRelativeTime(value: string): string {
  const ms = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(ms)) return "";
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
