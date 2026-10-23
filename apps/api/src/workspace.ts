import type { AttachmentRef } from "@openrigor/protocol";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync, realpathSync, statSync, readdirSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { resolve, join, relative, basename, extname, sep, isAbsolute } from "node:path";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { LocalStore } from "./local-store.js";
import { ApiError, WORKSPACE_TEXT_LIMIT, canPreviewWorkspaceFile, readWorkspaceFile, resolvePublicWorkspacePath, saveWorkspaceText, secretPart, workspaceFileMetadata, workspaceTextContent } from "./workspace-files.js";

export { ApiError, resolvePublicWorkspacePath } from "./workspace-files.js";
export interface Project { id: string; name: string; description: string; instructions: string; path: string; createdAt: string; updatedAt: string; archived?: boolean }
export interface Knowledge { id: string; name: string; content: string; projectId?: string; createdAt: string; updatedAt: string; archived?: boolean }
export interface ImageRecord { id: string; prompt: string; model: string; size: string; quality: string; url: string; filename: string; mimeType: string; createdAt: string; archived?: boolean; referenceImageId?: string }
export interface ConversationMetadata { title?: string; projectId?: string; pinned?: boolean; archived?: boolean }
interface Attachment { id: string; fileId: string; name: string; path: string; mimeType: string; size: number; sizeBytes: number }
export interface WorkspaceState {
  version: 1;
  profile: { displayName: string; email: string; language: string; avatar: string };
  settings: { theme: string; language: string; agent: { name: string; instructions: string; defaultModel: string; effort: string } };
  projects: Project[];
  knowledge: Knowledge[];
  installedSkills: string[];
  images: ImageRecord[];
  conversations: Record<string, ConversationMetadata>;
  attachments: Attachment[];
  customSkills: { id: string; name: string; description: string; category: string; instructions: string; icon: string }[];
}
const catalog = [
  ["browser", "Browser", "Browse websites and inspect interactions.", "Tools", "globe"],
  ["research-lit", "Literature research", "Find sources, compare evidence, and build a research review.", "Research", "book"],
  ["paper-analyze", "Paper analysis", "Read scientific papers and explain methods and findings.", "Research", "brain"],
  ["imagegen", "Image generation", "Create images with your configured image provider.", "Creative", "image"],
  ["frontend-design", "Frontend design", "Build considered, accessible websites and applications.", "Development", "palette"],
  ["pdf", "PDF", "Read and create PDF documents.", "Documents", "file"],
  ["pptx", "Presentations", "Create editable presentation decks.", "Documents", "presentation"],
  ["spreadsheets", "Spreadsheets", "Analyze tables and build spreadsheets.", "Documents", "table"],
  ["docx", "Word documents", "Write and edit structured documents.", "Documents", "file"],
  ["playwright", "Web testing", "Check user flows and responsive behavior.", "Development", "terminal"],
  ["skill-creator", "Skill creator", "Turn repeatable processes into reusable instructions.", "Development", "sparkles"],
  ["code", "Code workspace", "Inspect and modify files in your local project.", "Development", "code"]
] as const;
const workflowInstructions: Record<string, string> = {
  browser: "Inspect the current page before interacting. Use the configured browser tools, follow visible navigation, and verify each meaningful state change. Do not submit private data, publish, purchase, or change permissions without the operator's authorization.",
  "research-lit": "Define the research question and scope. Search primary sources and original papers, record URLs and dates, compare methods and limitations, and separate direct evidence from inference. Deliver a concise synthesis with an evidence table and explicit uncertainties. Never invent citations.",
  "paper-analyze": "Read the paper's abstract, methods, results, and limitations. Identify the hypothesis, data, baselines, evaluation design, and reproducibility requirements. Explain conclusions with supporting figures or sections and distinguish the authors' claims from independently verified facts.",
  imagegen: "Read AGENTS.md for the project's configured image provider, model, size, and quality. Write a concrete visual prompt. Keep provider keys server-side and save original image bytes before making derivatives. Inspect references before edits and show the saved result for review.",
  "frontend-design": "Inspect existing UI, components, and design tokens first. Build responsive, keyboard-accessible layouts using the established component system. Include loading, empty, error, and success states; respect reduced motion. Verify real browser interactions at desktop and narrow widths.",
  pdf: "Inspect the input PDF and determine whether text extraction or page rendering is needed. Preserve page sizes and typography when editing. For a new PDF, generate selectable text where possible, render the pages, inspect layout and overflow, and deliver the saved original and final file.",
  pptx: "Plan a clear slide narrative, then create an editable deck using native text, shapes, and connectors where appropriate. Use consistent typography and spacing. Render and inspect all slides for clipping and overlap; deliver the actual presentation file with reusable visual assets.",
  spreadsheets: "Inspect sheet structure, types, formulas, and units before changing data. Preserve source data, use formulas for derived values, label assumptions and units, and check totals and edge cases. Deliver a usable workbook and explain any missing or uncertain data.",
  docx: "Establish document structure and styles before writing. Preserve native editable paragraphs, lists, tables, headers, and references. Render the result and inspect page breaks, alignment, tables, and overflow. Deliver the saved editable document and a brief change description.",
  playwright: "Identify critical user flows and meaningful expected outcomes. Test the application using supported browser tools, inspect current UI state before actions, and verify visible results. Cover relevant keyboard, responsive, loading, and failure behavior. Report reproducible defects with evidence.",
  "skill-creator": "Identify the reusable task, triggers, inputs, constraints, and acceptance checks. Write concise instructions with safe defaults and explicit tool boundaries. Keep secrets and transient state outside the skill; add only necessary examples or scripts. Validate the workflow against a representative task.",
  code: "Read repository instructions and inspect the existing implementation before editing. Preserve unrelated work, keep changes scoped, and use established conventions. Handle relevant failure cases and run the checks that exercise the behavior changed. Explain the result and any remaining limitations."
};
const defaultState = (): WorkspaceState => ({
  version: 1,
  profile: { displayName: "Jeff", email: "", language: "en", avatar: "J" },
  settings: { theme: "dark", language: "en", agent: { name: "OpenRigor Science Agent", instructions: "", defaultModel: "auto", effort: "medium" } },
  projects: [], knowledge: [], installedSkills: ["browser", "research-lit", "code"], images: [], conversations: {}, attachments: [], customSkills: []
});
function json(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}
function text(value: unknown, name: string, max = 20_000, required = false): string {
  if (value === undefined && !required) return "";
  if (typeof value !== "string") throw new ApiError(400, `${name} must be a string`);
  const cleaned = value.trim();
  if (required && !cleaned) throw new ApiError(400, `${name} is required`);
  if (cleaned.length > max) throw new ApiError(400, `${name} is too long`);
  return cleaned;
}
async function body(req: IncomingMessage, max = 256 * 1024): Promise<Record<string, unknown>> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > max) throw new ApiError(413, "request body is too large");
    chunks.push(buffer);
  }
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch { throw new ApiError(400, "request body must be a JSON object"); }
}
function keyFromFile(workspaceRoot: string): string | undefined {
  const direct = process.env.CIYUANZHIYAN_API_KEY?.trim();
  if (direct) return direct;
  const path = join(workspaceRoot, ".env.imagegen.local");
  if (!existsSync(path)) return undefined;
  const match = readFileSync(path, "utf8").match(/^\s*(?:export\s+)?CIYUANZHIYAN_API_KEY\s*=\s*(.+?)\s*$/m);
  return match?.[1]?.replace(/^['"]|['"]$/g, "").trim() || undefined;
}
function mime(path: string): string {
  return ({ ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".pdf": "application/pdf", ".json": "application/json", ".txt": "text/plain", ".md": "text/markdown", ".csv": "text/csv", ".ts": "text/plain", ".tsx": "text/plain", ".js": "text/plain", ".css": "text/css", ".html": "text/html", ".svg": "image/svg+xml" } as Record<string, string>)[extname(path).toLowerCase()] ?? "application/octet-stream";
}
function privateAddress(address: string): boolean {
  return address === "::1" || address === "::" || address.startsWith("fc") || address.startsWith("fd") || address.startsWith("fe80:") || address.startsWith("::ffff:") || /^(0|10|127|169\.254|192\.168|172\.(1[6-9]|2\d|3[01]))\./.test(address);
}
async function fetchPublicImage(url: string): Promise<Buffer> {
  const target = new URL(url);
  if (target.protocol !== "https:" || target.username || target.password || (target.port && target.port !== "443")) throw new ApiError(502, "image provider returned an unsupported image URL");
  const addresses = isIP(target.hostname) ? [{ address: target.hostname }] : await lookup(target.hostname, { all: true });
  if (!addresses.length || addresses.some(({ address }) => privateAddress(address))) throw new ApiError(502, "image provider returned an unsafe image URL");
  const response = await fetch(target, { signal: AbortSignal.timeout(60_000), redirect: "error" });
  if (!response.ok) throw new ApiError(502, "could not download the generated image");
  const length = Number(response.headers.get("content-length") ?? 0);
  if (length > 30 * 1024 * 1024) throw new ApiError(502, "generated image is too large");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 30 * 1024 * 1024) throw new ApiError(502, "generated image is too large");
  return bytes;
}
function imageFormat(bytes: Buffer): { extension: string; mimeType: string } {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return { extension: "png", mimeType: "image/png" };
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return { extension: "jpg", mimeType: "image/jpeg" };
  if (bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP") return { extension: "webp", mimeType: "image/webp" };
  throw new ApiError(502, "image provider returned an unsupported image format");
}
export class WorkspaceService {
  public readonly state: WorkspaceState;
  private imageBusy = false;
  public constructor(private readonly store: LocalStore, public readonly root: string, private readonly executor: string) {
    this.state = store.read("workspace", defaultState());
    this.state.customSkills ??= [];
  }
  public save(): void { this.store.write("workspace", this.state); }
  public skills(): { id: string; name: string; description: string; category: string; icon: string; installed: boolean; instructions?: string; custom?: boolean }[] {
    return [...catalog.map(([id, name, description, category, icon]) => ({ id, name, description, category, icon, instructions: workflowInstructions[id] ?? description, installed: this.state.installedSkills.includes(id) })), ...this.state.customSkills.map((skill) => ({ ...skill, custom: true, installed: this.state.installedSkills.includes(skill.id) }))];
  }
  public project(id: string): Project {
    const item = this.state.projects.find((project) => project.id === id && !project.archived);
    if (!item) throw new ApiError(404, "project not found");
    return item;
  }
  private protectCapturedArtifacts(target: string): void {
    const directory = join(this.store.directory, "artifacts");
    if (!existsSync(directory)) return;
    const path = relative(realpathSync(directory), target);
    if (path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path))) throw new ApiError(403, "captured run artifacts are only available through their immutable artifact URLs");
  }
  public attachments(refs: AttachmentRef[] = [], projectId?: string): { refs: AttachmentRef[]; context: string } {
    if (refs.length > 20) throw new ApiError(400, "a run may include at most 20 attachments");
    const files = refs.map((reference) => {
      const file = this.state.attachments.find((attachment) => attachment.fileId === reference.fileId);
      if (!file) throw new ApiError(404, "attachment not found; upload the file first");
      if (!existsSync(file.path)) throw new ApiError(404, "uploaded attachment is no longer available");
      let path = file.path;
      if (projectId) {
        const projectRoot = realpathSync(this.project(projectId).path);
        const directory = join(projectRoot, "attachments"); mkdirSync(directory, { recursive: true });
        const actualDirectory = realpathSync(directory);
        const rel = relative(projectRoot, actualDirectory);
        if (rel === ".." || rel.startsWith(`..${sep}`)) throw new ApiError(403, "project attachment directory escapes its workspace");
        path = join(actualDirectory, basename(file.path));
        if (!existsSync(path)) writeFileSync(path, readFileSync(file.path), { mode: 0o600, flag: "wx" });
        else if (relative(actualDirectory, realpathSync(path)).startsWith("..")) throw new ApiError(403, "attachment path is not available");
      }
      return { file, path };
    });
    return { refs: files.map(({ file }) => ({ fileId: file.fileId, name: file.name, mimeType: file.mimeType, sizeBytes: file.sizeBytes })), context: files.length ? `Attached local files (read the original file; do not infer its contents from its name):\n${files.map(({ file, path }) => `${file.name} (${file.mimeType}, ${file.sizeBytes} bytes): ${path}`).join("\n")}` : "" };
  }
  public imageConfigured(): boolean { return Boolean(keyFromFile(this.root)); }
  public context(projectId?: string, skillIds?: string[], knowledgeIds?: string[], contextPaths: string[] = []): string {
    const sections: string[] = [];
    const instructions = this.state.settings.agent.instructions;
    if (instructions) sections.push(`Workspace instructions:\n${instructions}`);
    if (projectId) {
      const project = this.project(projectId);
      sections.push(`Project: ${project.name}\nProject directory: ${project.path}\n${project.description}\n${project.instructions}`);
    }
    const installed = this.skills().filter((skill) => skill.installed && skillIds?.includes(skill.id));
    if (installed.length) sections.push(`Selected workflows: ${installed.map((skill) => `${skill.name}: ${skill.instructions || skill.description}`).join("\n")}`);
    const notes = this.state.knowledge.filter((item) => !item.archived && (knowledgeIds?.includes(item.id) || (projectId && item.projectId === projectId)));
    for (const note of notes) sections.push(`Knowledge note (${note.name}):\n${note.content}`);
    let remainingBytes = 128 * 1024;
    for (const path of contextPaths) {
      if (isAbsolute(path)) throw new ApiError(400, "contextPaths must be relative workspace file paths");
      const projectRoot = projectId ? this.project(projectId).path : undefined;
      let actual: string;
      try { actual = resolvePublicWorkspacePath(projectRoot ?? this.root, path); }
      catch (error) {
        if (!projectRoot || !(error instanceof ApiError) || error.statusCode !== 404) throw error;
        actual = resolvePublicWorkspacePath(this.root, path);
      }
      const info = statSync(actual);
      if (!info.isFile()) throw new ApiError(400, "document context must be a file");
      if (info.size > 128 * 1024 || info.size > remainingBytes) throw new ApiError(413, "selected document context exceeds 128KB");
      const bytes = readFileSync(actual);
      if (bytes.subarray(0, 8192).includes(0)) throw new ApiError(415, "document context must be a text file");
      remainingBytes -= bytes.length;
      sections.push(`Selected document (${path}):\n${bytes.toString("utf8")}`);
    }
    return sections.join("\n\n");
  }
  public async handle(req: IncomingMessage, res: ServerResponse, url: URL, conversations: () => unknown[]): Promise<boolean> {
    const path = url.pathname;
    const method = req.method;
    if (method === "GET" && path === "/api/workspace") {
      json(res, 200, { workspace: { id: "local", name: basename(this.root), path: this.root }, profile: this.state.profile, settings: this.state.settings, runtime: { executor: this.executor, localOnly: true, persistence: "local-disk", imageGenerationConfigured: this.imageConfigured() }, projects: this.state.projects.filter((p) => !p.archived), skills: this.skills(), knowledge: this.state.knowledge.filter((k) => !k.archived), images: this.publicImages(), conversations: conversations() });
      return true;
    }
    if (path === "/api/profile" && method === "GET") { json(res, 200, { profile: this.state.profile }); return true; }
    if (path === "/api/profile" && method === "PATCH") {
      const input = await body(req);
      for (const name of ["displayName", "email", "language", "avatar"] as const) {
        if (input[name] !== undefined) this.state.profile[name] = text(input[name], name, name === "avatar" ? 100 : 200, name === "displayName");
      }
      this.save(); json(res, 200, { profile: this.state.profile }); return true;
    }
    if (path === "/api/settings" && method === "GET") { json(res, 200, { settings: this.state.settings, profile: this.state.profile }); return true; }
    if (path === "/api/settings" && method === "PATCH") {
      const input = await body(req);
      if (input.theme !== undefined) {
        if (!["dark", "light", "system"].includes(String(input.theme))) throw new ApiError(400, "invalid theme");
        this.state.settings.theme = String(input.theme);
      }
      if (input.language !== undefined) this.state.settings.language = text(input.language, "language", 20, true);
      if (input.agent !== undefined) {
        if (!input.agent || typeof input.agent !== "object" || Array.isArray(input.agent)) throw new ApiError(400, "agent must be an object");
        const agent = input.agent as Record<string, unknown>;
        for (const name of ["name", "instructions", "defaultModel", "effort"] as const) {
          if (agent[name] !== undefined) this.state.settings.agent[name] = text(agent[name], name, name === "instructions" ? 16_000 : 200, name !== "instructions");
        }
      }
      this.save(); json(res, 200, { settings: this.state.settings }); return true;
    }
    if (path === "/api/projects" && method === "GET") { json(res, 200, { projects: this.state.projects.filter((p) => !p.archived) }); return true; }
    if (path === "/api/projects" && method === "POST") {
      const input = await body(req);
      const id = `project_${randomUUID().slice(0, 12)}`;
      const createdAt = new Date().toISOString();
      const project: Project = { id, name: text(input.name, "name", 120, true), description: text(input.description, "description", 2_000), instructions: text(input.instructions, "instructions", 16_000), path: join(this.root, ".openrigor", "projects", id, "workspace"), createdAt, updatedAt: createdAt };
      mkdirSync(project.path, { recursive: true }); this.state.projects.push(project); this.save(); json(res, 201, { project }); return true;
    }
    const projectMatch = path.match(/^\/api\/projects\/([^/]+)$/);
    if (projectMatch?.[1] && ["GET", "PATCH", "DELETE"].includes(method ?? "")) {
      const project = this.project(projectMatch[1]);
      if (method === "PATCH") {
        const input = await body(req);
        for (const name of ["name", "description", "instructions"] as const) if (input[name] !== undefined) project[name] = text(input[name], name, name === "name" ? 120 : 16_000, name === "name");
        project.updatedAt = new Date().toISOString(); this.save();
      }
      if (method === "DELETE") { project.archived = true; this.save(); }
      json(res, 200, { project }); return true;
    }
    if (path === "/api/skills" && method === "GET") { json(res, 200, { skills: this.skills() }); return true; }
    if (path === "/api/skills" && method === "POST") {
      const input = await body(req);
      const skill = { id: `custom_${randomUUID().slice(0, 12)}`, name: text(input.name, "name", 120, true), description: text(input.description, "description", 2000), category: text(input.category, "category", 60) || "Custom", instructions: text(input.instructions, "instructions", 32_000, true), icon: "sparkles" };
      this.state.customSkills.push(skill); this.state.installedSkills.push(skill.id); this.save(); json(res, 201, { skill: { ...skill, installed: true, custom: true } }); return true;
    }
    const skillMatch = path.match(/^\/api\/skills\/([^/]+)\/(install|uninstall)$/);
    if (skillMatch?.[1] && (method === "POST" || method === "DELETE")) {
      const id = skillMatch[1];
      if (!this.skills().some((skill) => skill.id === id)) throw new ApiError(404, "skill not found");
      const install = method === "POST" && skillMatch[2] === "install";
      this.state.installedSkills = this.state.installedSkills.filter((skill) => skill !== id);
      if (install) this.state.installedSkills.push(id);
      this.save(); json(res, 200, { skill: this.skills().find((skill) => skill.id === id), skills: this.skills() }); return true;
    }
    if (path === "/api/knowledge" && method === "GET") { json(res, 200, { knowledge: this.state.knowledge.filter((item) => !item.archived) }); return true; }
    if (path === "/api/knowledge" && method === "POST") {
      const input = await body(req);
      const projectId = input.projectId === undefined ? undefined : text(input.projectId, "projectId", 100, true);
      if (projectId) this.project(projectId);
      const now = new Date().toISOString();
      const item: Knowledge = { id: `knowledge_${randomUUID().slice(0, 12)}`, name: text(input.name, "name", 200, true), content: text(input.content, "content", 64_000, true), createdAt: now, updatedAt: now, ...(projectId ? { projectId } : {}) };
      this.state.knowledge.push(item); this.save(); json(res, 201, { item }); return true;
    }
    const knowledgeMatch = path.match(/^\/api\/knowledge\/([^/]+)$/);
    if (knowledgeMatch?.[1] && ["PATCH", "DELETE"].includes(method ?? "")) {
      const item = this.state.knowledge.find((entry) => entry.id === knowledgeMatch[1] && !entry.archived);
      if (!item) throw new ApiError(404, "knowledge note not found");
      if (method === "DELETE") item.archived = true;
      else {
        const input = await body(req);
        if (input.name !== undefined) item.name = text(input.name, "name", 200, true);
        if (input.content !== undefined) item.content = text(input.content, "content", 64_000, true);
        item.updatedAt = new Date().toISOString();
      }
      this.save(); json(res, 200, { item }); return true;
    }
    if (path === "/api/search" && method === "GET") {
      const query = (url.searchParams.get("q") ?? "").toLowerCase();
      const matches = (value: unknown): boolean => JSON.stringify(value).toLowerCase().includes(query);
      json(res, 200, { runs: conversations().filter(matches), projects: this.state.projects.filter((p) => !p.archived && matches(p)), knowledge: this.state.knowledge.filter((k) => !k.archived && matches(k)), skills: this.skills().filter(matches) }); return true;
    }
    if (path === "/api/images" && method === "GET") { json(res, 200, { images: this.publicImages(), configured: this.imageConfigured() }); return true; }
    if (path === "/api/images/generations" && method === "POST") { await this.generateImage(await body(req), res); return true; }
    const archiveImageMatch = path.match(/^\/api\/images\/([^/]+)$/);
    if (archiveImageMatch?.[1] && method === "DELETE") {
      const image = this.state.images.find((item) => item.id === archiveImageMatch[1] && !item.archived);
      if (!image) throw new ApiError(404, "image not found");
      image.archived = true; this.save(); json(res, 200, { archived: true, imageId: image.id }); return true;
    }
    const imageMatch = path.match(/^\/api\/images\/([^/]+)\/file$/);
    if (method === "GET" && imageMatch?.[1]) {
      const image = this.state.images.find((item) => item.id === imageMatch[1]);
      if (!image) throw new ApiError(404, "image not found");
      const bytes = readFileSync(join(this.root, "output", "imagegen", basename(image.filename)));
      res.setHeader("Content-Type", image.mimeType); res.setHeader("X-Content-Type-Options", "nosniff"); res.end(bytes); return true;
    }
    if (path === "/api/attachments" && method === "POST") {
      const input = await body(req, 14 * 1024 * 1024);
      const name = text(input.name, "name", 180, true);
      if (name !== basename(name) || secretPart(name)) throw new ApiError(400, "invalid attachment name");
      const content = text(input.content, "content", 14 * 1024 * 1024, true);
      if (!/^[a-zA-Z0-9+/]*={0,2}$/.test(content)) throw new ApiError(400, "content must be base64");
      const bytes = Buffer.from(content, "base64");
      if (bytes.length > 10 * 1024 * 1024) throw new ApiError(413, "attachment exceeds 10MB");
      const id = `file_${randomUUID().slice(0, 12)}`;
      const directory = join(this.root, ".openrigor", "attachments"); mkdirSync(directory, { recursive: true });
      const filePath = join(directory, `${id}-${name.replace(/[^a-zA-Z0-9._-]/g, "_")}`);
      writeFileSync(filePath, bytes, { mode: 0o600 });
      const attachment: Attachment = { id, fileId: id, name, path: filePath, mimeType: text(input.mimeType, "mimeType", 120) || mime(name), size: bytes.length, sizeBytes: bytes.length };
      this.state.attachments.push(attachment); this.save(); json(res, 201, { attachment }); return true;
    }
    if (method === "GET" && ["/api/files", "/api/files/meta", "/api/files/content", "/api/files/download", "/api/files/metadata", "/api/files/preview"].includes(path)) {
      const relativePath = url.searchParams.get("path") ?? "";
      const projectId = url.searchParams.get("projectId") || undefined;
      const fileRoot = realpathSync(projectId ? this.project(projectId).path : this.root);
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      if (path === "/api/files") {
        const target = resolvePublicWorkspacePath(fileRoot, relativePath);
        this.protectCapturedArtifacts(target);
        const stats = statSync(target);
        if (!stats.isDirectory()) throw new ApiError(400, "path is not a directory");
        const files = readdirSync(target, { withFileTypes: true }).filter((item) => !secretPart(item.name)).flatMap((item) => {
          try {
            const itemPath = relative(fileRoot, join(target, item.name)).split(sep).join("/");
            const safe = resolvePublicWorkspacePath(fileRoot, itemPath);
            this.protectCapturedArtifacts(safe);
            const data = statSync(safe);
            if (!data.isDirectory() && !data.isFile()) return [];
            return [{ name: item.name, path: itemPath, type: data.isDirectory() ? "directory" : "file", size: data.size, modifiedAt: data.mtime.toISOString() }];
          } catch { return []; }
        }).sort((a, b) => Number(b.type === "directory") - Number(a.type === "directory") || a.name.localeCompare(b.name));
        json(res, 200, { path: relativePath, files }); return true;
      }
      const file = readWorkspaceFile(fileRoot, relativePath);
      this.protectCapturedArtifacts(file.target);
      if (path === "/api/files/meta" || path === "/api/files/metadata") {
        json(res, 200, workspaceFileMetadata(file, projectId)); return true;
      }
      if (path === "/api/files/preview" || path === "/api/files/download") {
        const preview = path === "/api/files/preview";
        if (preview && !canPreviewWorkspaceFile(file.mimeType)) throw new ApiError(415, "only verified images and PDF files can be previewed inline");
        res.setHeader("Content-Type", preview ? file.mimeType : "application/octet-stream");
        res.setHeader("Content-Disposition", `${preview ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.name)}`);
        res.setHeader("Content-Security-Policy", "sandbox; default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self' http://127.0.0.1:5173 http://localhost:5173");
        res.end(file.bytes); return true;
      }
      json(res, 200, workspaceTextContent(file, projectId)); return true;
    }
    if (method === "PUT" && path === "/api/files/content") {
      // JSON escaping can expand a valid 256 KiB text file by up to six times.
      const input = await body(req, WORKSPACE_TEXT_LIMIT * 6 + 8192);
      if (typeof input.path !== "string" || !input.path || input.path.length > 2000) throw new ApiError(400, "path must be a non-empty relative file path");
      const projectId = input.projectId === undefined ? undefined : text(input.projectId, "projectId", 100, true);
      const fileRoot = projectId ? this.project(projectId).path : this.root;
      this.protectCapturedArtifacts(resolvePublicWorkspacePath(fileRoot, input.path));
      const file = saveWorkspaceText(fileRoot, input.path, input.content, input.expectedSha256);
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      json(res, 200, workspaceTextContent(file, projectId)); return true;
    }
    return false;
  }
  private publicImages(): Omit<ImageRecord, "filename">[] { return this.state.images.filter((image) => !image.archived).map(({ filename: _filename, ...image }) => image).reverse(); }
  private async generateImage(input: Record<string, unknown>, res: ServerResponse): Promise<void> {
    const prompt = text(input.prompt, "prompt", 16_000, true);
    const model = text(input.model, "model", 100) || "gpt-image-2.5-sunburst";
    const size = text(input.size, "size", 20) || "1k";
    const quality = text(input.quality, "quality", 20) || "high";
    if (!["gpt-image-2.5-sunburst", "gpt-image-2", "gpt-image-2.5-flare"].includes(model)) throw new ApiError(400, "unsupported image model");
    if (!["1k", "2k", "4k"].includes(size) || !["high", "medium", "low", "auto"].includes(quality)) throw new ApiError(400, "invalid image size or quality");
    const referenceImageId = input.referenceImageId === undefined ? undefined : text(input.referenceImageId, "referenceImageId", 100, true);
    const reference = referenceImageId ? this.state.images.find((image) => image.id === referenceImageId) : undefined;
    if (referenceImageId && !reference) throw new ApiError(404, "reference image not found");
    const key = keyFromFile(this.root);
    if (!key) throw new ApiError(503, "Image generation is not configured. Set CIYUANZHIYAN_API_KEY in the server environment or .env.imagegen.local.");
    if (this.imageBusy) throw new ApiError(409, "an image generation is already running");
    this.imageBusy = true;
    try {
      let requestBody: string | FormData = JSON.stringify({ model, prompt, size, quality });
      const headers: Record<string, string> = { Authorization: `Bearer ${key}` };
      if (reference) {
        const source = readFileSync(join(this.root, "output", "imagegen", basename(reference.filename)));
        const form = new FormData();
        for (const [name, value] of Object.entries({ model, prompt, size, quality })) form.append(name, value);
        form.append("image", new Blob([new Uint8Array(source)], { type: reference.mimeType }), reference.filename);
        requestBody = form;
      } else headers["Content-Type"] = "application/json";
      const response = await fetch(`https://ciyuanzhiyan.com/v1/images/${reference ? "edits" : "generations"}`, { method: "POST", headers, body: requestBody, signal: AbortSignal.timeout(240_000), redirect: "error" });
      if (!response.ok) throw new ApiError(502, `Image provider request failed (${response.status}).`);
      const result = await response.json() as { data?: { b64_json?: string; url?: string }[] };
      const first = result.data?.[0];
      if (!first) throw new ApiError(502, "image provider returned no image");
      const bytes = first.b64_json ? Buffer.from(first.b64_json, "base64") : first.url ? await fetchPublicImage(first.url) : null;
      if (!bytes || bytes.length > 30 * 1024 * 1024) throw new ApiError(502, "image provider returned an invalid image");
      const format = imageFormat(bytes);
      const id = `image_${randomUUID().slice(0, 12)}`;
      const filename = `${id}.${format.extension}`;
      const directory = join(this.root, "output", "imagegen"); mkdirSync(directory, { recursive: true });
      writeFileSync(join(directory, filename), bytes, { mode: 0o600 });
      const image: ImageRecord = { id, prompt, model, size, quality, filename, mimeType: format.mimeType, url: `/api/images/${id}/file`, createdAt: new Date().toISOString(), ...(referenceImageId ? { referenceImageId } : {}) };
      this.state.images.push(image); this.save();
      const { filename: _filename, ...publicImage } = image;
      json(res, 201, { image: publicImage });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(502, "Image generation could not finish. Check provider connectivity and try again.");
    } finally { this.imageBusy = false; }
  }
}
