import createDOMPurify, { type Config, type DOMPurify, type WindowLike } from "dompurify";
import { resolveArtifactUrl, resolveMarkdownArtifact, type ResearchArtifact } from "../chat/ai-elements-adapter";

/** A workspace file is mutable; a run artifact identifies an immutable revision. */
export interface PreviewFile extends ResearchArtifact {
  origin: "artifact" | "workspace";
  projectId?: string;
  runId?: string;
}

export type PreviewFileUrlKind = "content" | "preview" | "download";
const artifactRoute = /^\/api\/runs\/([^/]+)\/files\/([^/]+)(?:\/(content|preview))?$/;

function artifactIdentityRun(file: PreviewFile): string | undefined {
  let run = file.runId;
  if (!run && file.origin === "artifact") {
    for (const value of [file.downloadUrl, file.contentUrl, file.previewUrl]) {
      if (!value) continue;
      try {
        const match = artifactRoute.exec(new URL(value, "http://preview.invalid").pathname);
        if (match && decodeURIComponent(match[2]!) === file.fileId) { run = decodeURIComponent(match[1]!); break; }
      } catch { /* An unrecognized URL cannot establish a run identity. */ }
    }
  }
  return run;
}

export function previewFileKey(file: PreviewFile): string {
  const run = artifactIdentityRun(file);
  return file.origin === "workspace"
    ? JSON.stringify(["workspace", file.projectId ?? null, file.path ?? file.name, file.sha256 ?? null])
    : JSON.stringify(["artifact", run ?? file.downloadUrl ?? file.contentUrl ?? file.previewUrl, file.fileId, file.revision]);
}

/** Library entries represent the latest descriptor without changing exact revision identities. */
export function latestPreviewFiles(files: readonly PreviewFile[]): PreviewFile[] {
  const latest = new Map<string, PreviewFile>();
  for (const file of files) {
    const key = file.origin === "workspace"
      ? JSON.stringify(["workspace", file.projectId ?? null, file.path ?? file.name])
      : JSON.stringify(["artifact", artifactIdentityRun(file) ?? file.downloadUrl ?? file.contentUrl ?? file.previewUrl, file.fileId]);
    const previous = latest.get(key);
    if (!previous || file.origin === "workspace" || file.revision > previous.revision) latest.set(key, file);
  }
  return [...latest.values()];
}

export function safeWorkspacePreviewPath(value: string): string | undefined {
  if (!value || value.length > 2000 || value.startsWith("/") || /^[a-z]:/i.test(value) || /[\\\u0000-\u001f\u007f]/.test(value)) return undefined;
  const parts = value.split("/");
  if (parts.some((part) => !part || part === ".." || part.startsWith("."))) return undefined;
  return parts.join("/");
}

/** Relative references stay below the document directory and never name hidden paths. */
export function workspaceRelativePreviewPath(destination: string, documentPath: string): string | undefined {
  if (!destination || destination.startsWith("#") || /^[a-z][a-z\d+.-]*:/i.test(destination) || destination.startsWith("/") || destination.includes("\\")) return undefined;
  let path: string;
  try { path = decodeURIComponent(destination.split(/[?#]/)[0] ?? ""); } catch { return undefined; }
  path = path.replace(/^(?:\.\/)+/, "");
  const safe = safeWorkspacePreviewPath(path);
  const current = safeWorkspacePreviewPath(documentPath);
  if (!safe || !current) return undefined;
  const directory = current.includes("/") ? current.slice(0, current.lastIndexOf("/") + 1) : "";
  return `${directory}${safe}`;
}

/** Resolve safe relative references and the scoped download URLs emitted before Markdown sanitization. */
export function resolveWorkspacePreviewLink(destination: string, file: PreviewFile, apiBase: string): string | undefined {
  if (file.origin !== "workspace") return undefined;
  const relative = workspaceRelativePreviewPath(destination, file.path ?? file.name);
  if (relative) return relative;
  // Inspect the literal route as well, so URL normalization cannot admit dot segments or backslashes.
  if (destination !== destination.trim() || /[\\\u0000-\u001f\u007f]/.test(destination)) return undefined;
  const route = /^https?:\/\/[^/?#]+(\/[^?#]*)/i.exec(destination)?.[1];
  if (route !== "/api/files/download") return undefined;
  try {
    const base = new URL(apiBase);
    const url = new URL(destination);
    if (!["http:", "https:"].includes(base.protocol) || base.username || base.password || url.origin !== base.origin || url.username || url.password) return undefined;
    if (url.pathname !== "/api/files/download" || url.searchParams.getAll("path").length !== 1) return undefined;
    if (url.searchParams.getAll("projectId").length > 1 || (url.searchParams.get("projectId") ?? undefined) !== file.projectId) return undefined;
    if ([...url.searchParams.keys()].some((key) => !["path", "projectId"].includes(key))) return undefined;
    return safeWorkspacePreviewPath(url.searchParams.get("path") ?? "");
  } catch { return undefined; }
}

/** Validate the route against the file identity as well as the API origin. */
export function previewFileUrl(file: PreviewFile, kind: PreviewFileUrlKind, apiBase: string): string | undefined {
  const value = kind === "content" ? file.contentUrl : kind === "preview" ? file.previewUrl : file.downloadUrl;
  if (!value) return undefined;
  try {
    const base = new URL(apiBase);
    const url = new URL(value, base);
    if (url.origin !== base.origin || url.username || url.password || !["http:", "https:"].includes(url.protocol)) return undefined;
    if (file.origin === "artifact") {
      if (!resolveArtifactUrl(value, apiBase)) return undefined;
      const match = artifactRoute.exec(url.pathname);
      const run = artifactIdentityRun(file);
      if (!match || decodeURIComponent(match[2]!) !== file.fileId || (run && decodeURIComponent(match[1]!) !== run)) return undefined;
      if ((match[3] ?? "download") !== kind || url.searchParams.getAll("revision").length !== 1 || url.searchParams.get("revision") !== String(file.revision)) return undefined;
      if ([...url.searchParams.keys()].some((key) => key !== "revision")) return undefined;
    } else {
      const path = safeWorkspacePreviewPath(file.path ?? file.name);
      if (!path || url.pathname !== `/api/files/${kind}` || url.searchParams.getAll("path").length !== 1 || url.searchParams.get("path") !== path) return undefined;
      if (url.searchParams.getAll("projectId").length > 1 || (url.searchParams.get("projectId") ?? undefined) !== file.projectId) return undefined;
      if ([...url.searchParams.keys()].some((key) => !["path", "projectId"].includes(key))) return undefined;
    }
    url.hash = "";
    return url.href;
  } catch { return undefined; }
}

function artifactRun(file: PreviewFile, apiBase: string): string | undefined {
  for (const kind of ["download", "content", "preview"] as const) {
    const value = previewFileUrl(file, kind, apiBase);
    if (value) return new URL(value).pathname.match(artifactRoute)?.[1];
  }
  return undefined;
}

/** Only files registered with this run, or known files in the same project, are link targets. */
export function resolvePreviewFileLink(destination: string, file: PreviewFile, files: PreviewFile[], apiBase: string): PreviewFile | undefined {
  if (!destination || destination.startsWith("#")) return undefined;
  const unique = (matches: PreviewFile[]): PreviewFile | undefined => {
    const deduplicated = [...new Map(matches.map((item) => [previewFileKey(item), item])).values()];
    return deduplicated.length === 1 ? deduplicated[0] : undefined;
  };
  if (file.origin === "artifact") {
    const run = artifactRun(file, apiBase);
    if (!run) return undefined;
    const candidates = [...new Map(files.filter((item) => item.origin === "artifact" && artifactRun(item, apiBase) === run && previewFileUrl(item, "download", apiBase)).map((item) => [previewFileKey(item), item])).values()];
    const exactUrl = resolveArtifactUrl(destination, apiBase);
    if (exactUrl) return unique(candidates.filter((item) => ["download", "content", "preview"].some((kind) => previewFileUrl(item, kind as PreviewFileUrlKind, apiBase) === exactUrl)));
    const latest = new Map<string, PreviewFile>();
    for (const candidate of candidates) {
      const previous = latest.get(candidate.fileId);
      if (!previous || candidate.revision > previous.revision) latest.set(candidate.fileId, candidate);
    }
    return resolveMarkdownArtifact(destination, [...latest.values()], apiBase, file.path ?? file.name);
  }
  const candidates = files.filter((item) => item.origin === "workspace" && item.projectId === file.projectId && previewFileUrl(item, "download", apiBase));
  try {
    const url = new URL(destination, apiBase);
    url.hash = "";
    if (url.origin === new URL(apiBase).origin && url.pathname.startsWith("/api/")) return unique(candidates.filter((item) => ["download", "content", "preview"].some((kind) => previewFileUrl(item, kind as PreviewFileUrlKind, apiBase) === url.href)));
  } catch { /* A document-relative path is handled below. */ }
  const path = workspaceRelativePreviewPath(destination, file.path ?? file.name);
  return path ? unique(candidates.filter((item) => (item.path ?? item.name) === path)) : undefined;
}

export function previewSourceLanguage(name: string): string {
  const extension = name.toLowerCase().split(".").at(-1) ?? "";
  return ({ md: "markdown", markdown: "markdown", json: "json", jsonl: "json", js: "javascript", mjs: "javascript", jsx: "jsx", ts: "typescript", tsx: "tsx", py: "python", r: "r", html: "html", htm: "html", css: "css", svg: "xml", xml: "xml", yaml: "yaml", yml: "yaml", sql: "sql", sh: "bash", tex: "latex" } as Record<string, string>)[extension] ?? "text";
}

/** Keep nested backticks inside their code block without spreading untrusted input into arguments. */
export function previewMarkdownFence(code: string): string {
  let length = 3;
  for (const match of code.matchAll(/`+/g)) length = Math.max(length, match[0].length + 1);
  return "`".repeat(length);
}

/** File destinations become validated absolute URLs before the Markdown renderer sanitizes URL schemes. */
export function linkPreviewMarkdown(content: string, file: PreviewFile, files: PreviewFile[], apiBase: string): string {
  return content.replace(/(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`)|\]\((<[^>\n]+>|[^\s)\n]+)(\s+(?:"[^"\n]*"|'[^'\n]*'))?\)/g, (match: string, code: string | undefined, destination: string | undefined, title: string | undefined) => {
    if (code || !destination) return match;
    const reference = destination.replace(/^<|>$/g, "");
    const target = resolvePreviewFileLink(reference, file, files, apiBase);
    let url = target && previewFileUrl(target, "download", apiBase);
    const path = file.origin === "workspace" && workspaceRelativePreviewPath(reference, file.path ?? file.name);
    if (!url && path) {
      try {
        const query = new URLSearchParams({ path, ...(file.projectId === undefined ? {} : { projectId: file.projectId }) });
        const download = new URL(`/api/files/download?${query}`, apiBase).href;
        if (resolveWorkspacePreviewLink(download, file, apiBase) === path) url = download;
      } catch { /* An invalid API base cannot establish a trusted workspace URL. */ }
    }
    return url ? `](${url}${title ?? ""})` : match;
  });
}

const staticPreviewCsp = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; media-src 'none'; base-uri 'none'; form-action 'none'";
const escapeHtml = (value: string): string => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const staticPreviewPolicy: Config = {
  ALLOWED_TAGS: "a abbr address article aside b bdi bdo blockquote br caption cite code col colgroup dd del details dfn div dl dt em figcaption figure footer h1 h2 h3 h4 h5 h6 header hgroup hr i img ins kbd li main mark nav ol p pre q rp rt ruby s samp section small span strong style sub summary sup table tbody td tfoot th thead time tr u ul var wbr".split(" "),
  ALLOWED_ATTR: "class id style title lang dir role aria-label aria-hidden width height colspan rowspan scope open datetime alt align valign href src".split(" "),
  ALLOWED_NAMESPACES: ["http://www.w3.org/1999/xhtml"],
  FORBID_TAGS: ["script", "form", "iframe", "object", "embed", "svg", "math", "template", "link", "meta", "base"],
  ADD_FORBID_CONTENTS: ["form", "svg", "math", "template", "iframe", "object"],
  FORBID_ATTR: ["srcset", "action", "formaction", "poster", "background", "xlink:href", "ping", "srcdoc"],
  ALLOW_DATA_ATTR: false,
  ALLOW_ARIA_ATTR: false,
  FORCE_BODY: true,
  RETURN_TRUSTED_TYPE: false
};
const previewPurifiers = new WeakMap<WindowLike, DOMPurify>();

function staticPreviewPurifier(view: WindowLike): DOMPurify {
  const existing = previewPurifiers.get(view);
  if (existing) return existing;
  const purifier = createDOMPurify(view);
  previewPurifiers.set(view, purifier);
  if (!purifier.isSupported) return purifier;
  // DOMPurify owns HTML parsing and XSS handling. This hook narrows its URL policy
  // for an offline preview: only local anchors and embedded raster bytes survive.
  purifier.addHook("uponSanitizeAttribute", (node, event) => {
    if (event.attrName === "src") event.keepAttr = node.localName === "img" && /^data:image\/(?:png|jpe?g|gif|webp);base64,[a-z\d+/=\s]+$/i.test(event.attrValue);
    if (event.attrName === "href") event.keepAttr = node.localName === "a" && /^#[^\s]*$/.test(event.attrValue);
  });
  return purifier;
}

/** Sanitize inert HTML, then render it in an opaque-origin sandbox with no script or network capabilities. */
export function staticHtmlPreviewDocument(content: string, view: WindowLike | undefined = typeof window === "undefined" ? undefined : window): string {
  const purifier = view ? staticPreviewPurifier(view) : undefined;
  const body = purifier?.isSupported ? purifier.sanitize(content, staticPreviewPolicy) : `<pre>${escapeHtml(content)}</pre>`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${staticPreviewCsp}"><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html{color-scheme:light}body{margin:24px;font:14px/1.6 system-ui,sans-serif;color:#20252b;background:#fff;overflow-wrap:anywhere}img,table,pre{max-width:100%}pre{overflow:auto}table{border-collapse:collapse}td,th{padding:6px 10px}</style></head><body>${body}</body></html>`;
}
