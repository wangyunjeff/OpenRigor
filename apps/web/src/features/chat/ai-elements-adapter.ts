import type { FileArtifact, RunEvent, RunSnapshot } from "@openrigor/protocol";
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

interface ArtifactLinkMetadata { name: string; path?: string; downloadUrl?: string }

function relativeArtifactPath(value: string): string | undefined {
  if (value.startsWith("/") || value.includes("\\") || /[\u0000-\u001f\u007f]/.test(value)) return undefined;
  const segments: string[] = [];
  for (const segment of value.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") { if (!segments.length) return undefined; segments.pop(); }
    else segments.push(segment);
  }
  return segments.join("/") || undefined;
}

/** Resolve only this run's registered files. Document-relative links never fall back to another directory's basename. */
export function resolveMarkdownArtifact<T extends ArtifactLinkMetadata>(destination: string, files: T[], apiBase: string, documentPath?: string): T | undefined {
  const available = files.filter((file) => resolveArtifactUrl(file.downloadUrl, apiBase));
  const unique = (matches: T[]): T | undefined => matches.length === 1 ? matches[0] : undefined;
  const returnedUrl = resolveArtifactUrl(destination, apiBase);
  if (returnedUrl) return unique(available.filter((file) => resolveArtifactUrl(file.downloadUrl, apiBase) === returnedUrl));
  let path = destination.replace(/^sandbox:/, "");
  if (/^[a-z][a-z\d+.-]*:/i.test(path) || path.startsWith("//")) return undefined;
  try { path = decodeURIComponent(path.split(/[?#]/)[0] ?? ""); } catch { return undefined; }
  if (!path || /[\u0000-\u001f\u007f]/.test(path)) return undefined;
  if (path.startsWith("/")) {
    const exact = available.filter((file) => file.name === path || file.path === path);
    if (exact.length) return unique(exact);
    return unique(available.filter((file) => file.path && path.endsWith(`/${file.path.replace(/^\.\//, "")}`)));
  }
  const base = documentPath ? relativeArtifactPath(documentPath) : undefined;
  if (base) {
    const directory = base.includes("/") ? base.slice(0, base.lastIndexOf("/") + 1) : "";
    const resolved = relativeArtifactPath(`${directory}${path}`);
    if (!resolved) return undefined;
    return unique(available.filter((file) => relativeArtifactPath(file.path ?? file.name) === resolved));
  }
  const normalized = relativeArtifactPath(path);
  if (!normalized) return undefined;
  const exact = available.filter((file) => file.name === path || relativeArtifactPath(file.path ?? "") === normalized);
  if (exact.length) return unique(exact);
  return path.includes("/") ? undefined : unique(available.filter((file) => file.name.split(/[\\/]/).at(-1) === path));
}

/** Only generated files with server-validated download links become local links; code remains literal. */
export function linkArtifactMarkdown(text: string, files: ArtifactLinkMetadata[], apiBase: string, documentPath?: string): string {
  return text.replace(/(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`)|\]\((<[^>\n]+>|[^\s)\n]+)(\s+(?:"[^"\n]*"|'[^'\n]*'))?\)/g, (match: string, code: string | undefined, destination: string | undefined, title: string | undefined) => {
    if (code || !destination) return match;
    const file = resolveMarkdownArtifact(destination.replace(/^<|>$/g, ""), files, apiBase, documentPath);
    return file ? `](${resolveArtifactUrl(file.downloadUrl, apiBase)}${title ?? ""})` : match;
  });
}

export type ResearchArtifact = FileArtifact & { path?: string; contentUrl?: string; previewUrl?: string };
export type ArtifactPreviewKind = "markdown" | "csv" | "code" | "text" | "image" | "svg" | "pdf" | "download";

/** File URLs must be server-issued guarded artifact routes, never arbitrary document URLs. */
export function resolveArtifactUrl(value: string | undefined, apiBase: string): string | undefined {
  if (!value) return undefined;
  try {
    const base = new URL(apiBase);
    const url = new URL(value, base);
    if (url.origin !== base.origin || url.username || url.password || !["http:", "https:"].includes(url.protocol)) return undefined;
    if (url.pathname !== "/api/files/download" && !/^\/api\/runs\/[^/]+\/files\/[^/]+(?:\/(?:content|preview))?$/.test(url.pathname)) return undefined;
    url.hash = "";
    return url.href;
  } catch { return undefined; }
}

export function artifactPreviewKind(file: Pick<ResearchArtifact, "name" | "mimeType">): ArtifactPreviewKind {
  const mime = file.mimeType.toLowerCase().split(";")[0]?.trim() ?? "";
  if (mime === "application/pdf") return "pdf";
  if (mime === "image/svg+xml") return "svg";
  if (["image/png", "image/jpeg", "image/webp", "image/gif"].includes(mime)) return "image";
  if (mime === "text/markdown" || (mime === "text/plain" && /\.md(?:own|arkdown)?$/i.test(file.name))) return "markdown";
  if (["text/csv", "application/csv", "text/tab-separated-values"].includes(mime) || (mime === "text/plain" && /\.(?:csv|tsv)$/i.test(file.name))) return "csv";
  if (mime.startsWith("text/") || ["application/json", "application/ld+json", "application/javascript", "application/xml", "application/x-yaml", "application/yaml"].includes(mime)) {
    return /\.(?:txt|log)$/i.test(file.name) && mime === "text/plain" ? "text" : "code";
  }
  return "download";
}

export function artifactBasename(name: string): string { return name.split(/[\\/]/).filter(Boolean).at(-1) ?? name; }
export function artifactDownloadFilename(disposition: string | null, fallback = "artifact"): string {
  const encoded = disposition?.match(/filename\*\s*=\s*UTF-8''([^;]+)/i)?.[1];
  let value = disposition?.match(/filename\s*=\s*"([^"]+)"/i)?.[1] ?? fallback;
  if (encoded) { try { value = decodeURIComponent(encoded.trim()); } catch { /* Use a safe fallback when a filename header is malformed. */ } }
  return artifactBasename(value).replace(/[\u0000-\u001f\u007f]/g, "") || fallback;
}
export function artifactSizeLabel(size: number | undefined): string {
  if (size === undefined || !Number.isFinite(size) || size < 0) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
export function artifactTypeLabel(file: Pick<ResearchArtifact, "name" | "mimeType">): string {
  const kind = artifactPreviewKind(file);
  return ({ markdown: "Markdown document", csv: "Data table", code: "Code & text", text: "Text document", image: "Image", svg: "SVG image", pdf: "PDF document", download: "File" })[kind];
}

export interface AnswerReference { url: string; title: string }
export function safeWebUrl(value: string): string | undefined {
  try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : undefined; } catch { return undefined; }
}
export function sourceDomain(value: string): string {
  try { return new URL(value).hostname.replace(/^www\./, ""); } catch { return ""; }
}
export function extractAnswerReferences(text: string, searchedUrls: string[] = []): AnswerReference[] {
  const normalize = (value: string): string => { const url = new URL(value); url.hash = ""; return url.href; };
  const seen = new Set(searchedUrls.flatMap((value) => { const url = safeWebUrl(value); return url ? [normalize(url)] : []; }));
  const references: AnswerReference[] = [];
  const prose = text.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`/g, "");
  const append = (value: string, title: string): void => {
    const url = safeWebUrl(value);
    if (!url || seen.has(normalize(url)) || references.length >= 30) return;
    seen.add(normalize(url)); references.push({ url, title: title.trim() || sourceDomain(url) });
  };
  const withoutMarkdown = prose.replace(/(!?)\[([^\]\n]*)\]\((https?:\/\/[^\s)]+)(?:\s+"[^"]*")?\)/g, (_match, image: string, title: string, value: string) => { if (!image) append(value, title); return ""; });
  for (const match of withoutMarkdown.matchAll(/https?:\/\/[^\s<>"'\])]+/g)) append(match[0].replace(/[.,;:!?]+$/, ""), "");
  return references;
}

/** Hover text is attached only when a real web-search source matches the answer link. */
export function annotateSourceLinks(text: string, sources: Array<{ url: string; title: string; snippet?: string }>): string {
  const normalize = (value: string): string | undefined => { const safe = safeWebUrl(value); if (!safe) return undefined; const url = new URL(safe); url.hash = ""; return url.href; };
  const available = new Map(sources.flatMap((source) => { const url = normalize(source.url); return url ? [[url, source] as const] : []; }));
  return text.replace(/(!?)\[([^\]\n]*)\]\((https?:\/\/[^\s)]+)(?:\s+"[^"]*")?\)/g, (match: string, image: string, title: string, value: string) => {
    if (image) return match;
    const source = available.get(normalize(value) ?? "");
    if (!source) return match;
    const hover = [source.title, sourceDomain(source.url), source.snippet?.slice(0, 260)].filter(Boolean).join(" · ").replace(/["\\\r\n]/g, " ");
    return `[${title}](${value} "${hover}")`;
  });
}

export interface CsvPreview { headers: string[]; rows: string[][]; truncated: boolean }
/** Bounded RFC-4180-style parsing keeps quoted commas and newlines intact. */
export function parseCsvPreview(content: string, delimiter = ",", maxRows = 100, maxColumns = 24): CsvPreview {
  const records: string[][] = [];
  let row: string[] = [], cell = "", quoted = false, truncated = false;
  const pushCell = (): void => { if (row.length < maxColumns) row.push(cell); else truncated = true; cell = ""; };
  const pushRow = (): void => { pushCell(); if (records.length <= maxRows) records.push(row); else truncated = true; row = []; };
  const input = content.replace(/^\uFEFF/, "");
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (char === '"') {
      if (quoted && input[index + 1] === '"') { cell += '"'; index += 1; }
      else if (quoted || !cell) quoted = !quoted;
      else cell += char;
    } else if (!quoted && char === delimiter) pushCell();
    else if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && input[index + 1] === "\n") index += 1;
      pushRow(); if (records.length > maxRows) { truncated ||= index < input.length - 1; break; }
    } else cell += char;
  }
  if (cell || row.length) pushRow();
  const headers = records.shift() ?? [];
  return { headers, rows: records.slice(0, maxRows), truncated };
}

export function summarizePlan(steps: Array<{ step: string; status: "pending" | "in_progress" | "completed" }>): { total: number; completed: number; percent: number; current?: string } {
  const completed = steps.filter((item) => item.status === "completed").length;
  const current = steps.find((item) => item.status === "in_progress")?.step;
  return { total: steps.length, completed, percent: steps.length ? Math.round(completed / steps.length * 100) : 0, ...(current ? { current } : {}) };
}
