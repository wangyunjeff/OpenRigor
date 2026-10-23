import { createHash, randomUUID } from "node:crypto";
import { constants, closeSync, fchmodSync, fstatSync, fsyncSync, lstatSync, openSync, readSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync, type Stats } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";

export class ApiError extends Error {
  public constructor(public readonly statusCode: number, message: string) { super(message); }
}

export const WORKSPACE_TEXT_LIMIT = 256 * 1024;
export const WORKSPACE_FILE_LIMIT = 20 * 1024 * 1024;

export function secretPart(name: string): boolean {
  return name.startsWith(".") || /^(node_modules|dist|coverage|auth\.json|(?:credentials?|secrets?|private[-_]?keys?|api[-_]?keys?)(?:[._-].*)?|id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?|.*\.(?:pem|key|p12|pfx|jks|keystore))$/i.test(name);
}

function filesystemError(error: unknown): never {
  if (error instanceof ApiError) throw error;
  const code = (error as NodeJS.ErrnoException).code;
  if (code === "ENOENT" || code === "ENOTDIR") throw new ApiError(404, "file not found");
  if (["EACCES", "EPERM", "ELOOP"].includes(code ?? "")) throw new ApiError(403, "this path is not available");
  throw error;
}

/** A project root is trusted configuration; every requested component below it is untrusted. */
export function resolvePublicWorkspacePath(root: string, input: string): string {
  if (input.length > 2000 || isAbsolute(input) || /^[a-z]:/i.test(input) || input.includes("\0") || input.includes("\\") || input.split("/").some((part) => part === ".." || secretPart(part))) throw new ApiError(403, "this path is not available");
  try {
    const canonicalRoot = realpathSync(root);
    const target = resolve(canonicalRoot, input || ".");
    const path = relative(canonicalRoot, target);
    if (path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path)) throw new ApiError(403, "path must be inside the workspace");
    let current = canonicalRoot;
    for (const part of path.split(sep).filter(Boolean)) {
      current = join(current, part);
      if (lstatSync(current).isSymbolicLink()) throw new ApiError(403, "symbolic links are not available");
    }
    if (realpathSync(target) !== target) throw new ApiError(403, "this path is not available");
    return target;
  } catch (error) { return filesystemError(error); }
}

const TEXT_MIME: Record<string, string> = {
  ".md": "text/markdown", ".markdown": "text/markdown", ".txt": "text/plain", ".csv": "text/csv", ".tsv": "text/tab-separated-values",
  ".json": "application/json", ".jsonl": "application/x-ndjson", ".yaml": "text/yaml", ".yml": "text/yaml", ".xml": "application/xml",
  ".svg": "image/svg+xml", ".html": "text/html", ".htm": "text/html", ".css": "text/css", ".js": "text/javascript", ".mjs": "text/javascript",
  ".ts": "text/plain", ".tsx": "text/plain", ".jsx": "text/plain", ".py": "text/x-python", ".r": "text/plain", ".tex": "text/x-tex",
  ".bib": "text/plain", ".ipynb": "application/x-ipynb+json", ".sql": "text/plain", ".sh": "text/plain", ".m": "text/plain"
};

export function isWorkspaceText(bytes: Buffer): boolean {
  try {
    const value = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    return !/[\u0000-\u0008\u000B\u000E-\u001F\u007F]/.test(value);
  } catch { return false; }
}

/** Inline media types are determined from bytes, never from the filename. */
export function workspaceFileMime(name: string, bytes: Buffer): string {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString())) return "image/gif";
  if (bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP") return "image/webp";
  if (bytes.subarray(0, 5).toString() === "%PDF-") return "application/pdf";
  const extension = extname(name).toLowerCase();
  if (bytes.subarray(0, 4).equals(Buffer.from([80, 75, 3, 4]))) return ({ ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation" } as Record<string, string>)[extension] ?? "application/zip";
  return isWorkspaceText(bytes) ? TEXT_MIME[extension] ?? (extension ? "application/octet-stream" : "text/plain") : "application/octet-stream";
}

export function canPreviewWorkspaceFile(mimeType: string): boolean {
  return ["image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf"].includes(mimeType);
}

function signature(stats: Stats): string {
  return `${stats.dev}:${stats.ino}:${stats.size}:${stats.mtimeMs}:${stats.ctimeMs}:${stats.mode}`;
}

export interface WorkspaceFileRead {
  target: string;
  path: string;
  name: string;
  bytes: Buffer;
  stats: Stats;
  mimeType: string;
  sha256: string;
  text: boolean;
  editable: boolean;
}

export function readWorkspaceFile(root: string, input: string): WorkspaceFileRead {
  try {
    const target = resolvePublicWorkspacePath(root, input);
    if (!lstatSync(target).isFile()) throw new ApiError(400, "path is not a file");
    const fd = openSync(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const before = fstatSync(fd);
      if (!before.isFile()) throw new ApiError(400, "path is not a file");
      if (before.size > WORKSPACE_FILE_LIMIT) throw new ApiError(413, "file exceeds the local download limit");
      const buffer = Buffer.alloc(before.size + 1);
      let offset = 0;
      while (offset < buffer.length) {
        const read = readSync(fd, buffer, offset, buffer.length - offset, null);
        if (!read) break;
        offset += read;
      }
      const after = fstatSync(fd);
      const resolved = resolvePublicWorkspacePath(root, input);
      if (signature(before) !== signature(after) || offset !== before.size || resolved !== target || signature(statSync(resolved)) !== signature(after)) throw new ApiError(409, "file changed while being read; reload it and try again");
      const bytes = buffer.subarray(0, offset);
      const mimeType = workspaceFileMime(target, bytes);
      const text = isWorkspaceText(bytes) && !canPreviewWorkspaceFile(mimeType) && mimeType !== "application/zip" && !mimeType.startsWith("application/vnd.openxmlformats-");
      return { target, path: relative(realpathSync(root), target).split(sep).join("/"), name: basename(target), bytes, stats: after, mimeType, sha256: createHash("sha256").update(bytes).digest("hex"), text, editable: text && bytes.length <= WORKSPACE_TEXT_LIMIT };
    } finally { closeSync(fd); }
  } catch (error) { return filesystemError(error); }
}

export function workspaceFileMetadata(file: WorkspaceFileRead, projectId?: string): {
  name: string; path: string; mimeType: string; sizeBytes: number; sha256: string; contentUrl: string; downloadUrl: string; previewUrl?: string; editable: boolean;
} {
  const query = new URLSearchParams({ path: file.path, ...(projectId ? { projectId } : {}) }).toString();
  return { name: file.name, path: file.path, mimeType: file.mimeType, sizeBytes: file.bytes.length, sha256: file.sha256, contentUrl: `/api/files/content?${query}`, downloadUrl: `/api/files/download?${query}`, ...(canPreviewWorkspaceFile(file.mimeType) ? { previewUrl: `/api/files/preview?${query}` } : {}), editable: file.editable };
}

export function workspaceTextContent(file: WorkspaceFileRead, projectId?: string) {
  if (!file.text) throw new ApiError(415, "binary files can be downloaded but not previewed as text");
  const truncated = file.bytes.length > WORKSPACE_TEXT_LIMIT;
  const content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(file.bytes.subarray(0, WORKSPACE_TEXT_LIMIT), { stream: truncated });
  return { ...workspaceFileMetadata(file, projectId), size: file.bytes.length, content, truncated };
}

/** Synchronous compare-and-replace serializes API edits; the final read also detects external edits. */
export function saveWorkspaceText(root: string, path: string, content: unknown, expectedSha256: unknown): WorkspaceFileRead {
  if (typeof content !== "string") throw new ApiError(400, "content must be a string");
  if (typeof expectedSha256 !== "string" || !/^[a-f0-9]{64}$/i.test(expectedSha256)) throw new ApiError(400, "expectedSha256 must be a SHA-256 hash");
  const bytes = Buffer.from(content, "utf8");
  if (bytes.length > WORKSPACE_TEXT_LIMIT) throw new ApiError(413, "editable text files must not exceed 256 KiB");
  if (bytes.toString("utf8") !== content || !isWorkspaceText(bytes)) throw new ApiError(415, "content must be valid UTF-8 text");
  if (canPreviewWorkspaceFile(workspaceFileMime(path, bytes))) throw new ApiError(415, "content must remain a text file");
  const original = readWorkspaceFile(root, path);
  if (original.bytes.length > WORKSPACE_TEXT_LIMIT) throw new ApiError(413, "editable text files must not exceed 256 KiB");
  if (!original.editable) throw new ApiError(415, "only existing UTF-8 text files can be edited");
  if (original.sha256 !== expectedSha256.toLowerCase()) throw new ApiError(409, "file changed since it was opened; reload it before saving");
  const temporary = join(dirname(original.target), `.openrigor-edit-${randomUUID()}.tmp`);
  let renamed = false;
  try {
    const fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, original.stats.mode & 0o777);
    try {
      writeFileSync(fd, bytes);
      fchmodSync(fd, original.stats.mode & 0o777);
      fsyncSync(fd);
    } finally { closeSync(fd); }
    const current = readWorkspaceFile(root, path);
    if (current.target !== original.target || current.sha256 !== original.sha256 || signature(current.stats) !== signature(original.stats)) throw new ApiError(409, "file changed while saving; reload it before saving");
    renameSync(temporary, original.target);
    renamed = true;
    const directoryFd = openSync(dirname(original.target), constants.O_RDONLY | constants.O_NOFOLLOW);
    try { fsyncSync(directoryFd); } catch (error) {
      if (!["EINVAL", "ENOTSUP", "EBADF"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
    } finally { closeSync(directoryFd); }
    return readWorkspaceFile(root, path);
  } catch (error) { return filesystemError(error); }
  finally { if (!renamed) { try { unlinkSync(temporary); } catch { /* No temporary file was created, or it was already removed. */ } } }
}
