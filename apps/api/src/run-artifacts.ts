import { createHash } from "node:crypto";
import { constants, closeSync, existsSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readSync, readdirSync, realpathSync, renameSync, statSync, writeFileSync, type Stats } from "node:fs";
import { basename, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { FileArtifact } from "@openrigor/protocol";
import { ApiError, resolvePublicWorkspacePath } from "./workspace.js";

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_TOTAL_BYTES = 80 * 1024 * 1024;
const MAX_REVISIONS = 60;
const OUTPUT_DIRECTORIES = ["artifacts", "output", "reports", "results", "figures"];
const TEXT_EXTENSIONS: Record<string, string> = {
  ".md": "text/markdown", ".markdown": "text/markdown", ".txt": "text/plain", ".csv": "text/csv", ".tsv": "text/tab-separated-values",
  ".json": "application/json", ".jsonl": "application/x-ndjson", ".yaml": "text/yaml", ".yml": "text/yaml", ".xml": "application/xml",
  ".svg": "image/svg+xml", ".html": "text/html", ".htm": "text/html", ".css": "text/css", ".js": "text/javascript",
  ".ts": "text/plain", ".tsx": "text/plain", ".jsx": "text/plain", ".py": "text/x-python", ".r": "text/plain", ".tex": "text/x-tex",
  ".bib": "text/plain", ".ipynb": "application/x-ipynb+json", ".sql": "text/plain", ".sh": "text/plain", ".m": "text/plain"
};
const BINARY_EXTENSIONS: Record<string, string> = {
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation", ".zip": "application/zip"
};
export function isTextArtifact(bytes: Buffer): boolean {
  if (bytes.includes(0)) return false;
  try { new TextDecoder("utf-8", { fatal: true }).decode(bytes); return true; } catch { return false; }
}
export function artifactMime(path: string, bytes: Buffer): string {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString())) return "image/gif";
  if (bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP") return "image/webp";
  if (bytes.subarray(0, 5).toString() === "%PDF-") return "application/pdf";
  const extension = extname(path).toLowerCase();
  if (bytes.subarray(0, 4).equals(Buffer.from([80, 75, 3, 4]))) return BINARY_EXTENSIONS[extension] ?? "application/zip";
  if (TEXT_EXTENSIONS[extension] && isTextArtifact(bytes)) return TEXT_EXTENSIONS[extension];
  return "application/octet-stream";
}
export function canPreviewArtifact(mime: string): boolean {
  return ["image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf"].includes(mime);
}
function signature(stats: Stats): string {
  return `${stats.dev}:${stats.ino}:${stats.size}:${stats.mtimeMs}:${stats.ctimeMs}`;
}
function noSymlinks(root: string, target: string): void {
  const path = relative(root, target);
  if (path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path)) throw new ApiError(403, "artifact must be inside its workspace");
  let current = root;
  for (const part of path.split(sep).filter(Boolean)) {
    current = join(current, part);
    if (lstatSync(current).isSymbolicLink()) throw new ApiError(403, "symbolic links are not available as artifacts");
  }
}
function boundedRead(fd: number, size: number): Buffer {
  const buffer = Buffer.alloc(size + 1);
  let offset = 0;
  while (offset < buffer.length) {
    const count = readSync(fd, buffer, offset, buffer.length - offset, null);
    if (!count) break;
    offset += count;
  }
  return buffer.subarray(0, offset);
}

/** Per-run bounded discovery. Baselines are taken before execution; unchanged files are never read. */
export class RunArtifactDiscovery {
  private readonly root: string;
  private readonly baseline: Map<string, string>;
  private readonly published = new Map<string, { sha256: string; revision: number }>();
  private revisions = 0;
  private totalBytes = 0;
  private scannedEntries = 0;
  private readonly directory: string;

  public constructor(root: string, storageRoot: string, private readonly runId: string) {
    this.root = realpathSync(root);
    this.directory = artifactDirectory(storageRoot, runId);
    this.baseline = this.scan();
  }

  private scan(): Map<string, string> {
    const found = new Map<string, string>();
    let entries = 0;
    const walk = (path: string, depth: number): void => {
      if (depth > 5 || entries >= 800 || this.scannedEntries >= 16_000) return;
      try {
        const safe = resolvePublicWorkspacePath(this.root, path);
        noSymlinks(this.root, resolve(this.root, path));
        if (!statSync(safe).isDirectory()) return;
        for (const item of readdirSync(safe, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
          if (entries++ >= 800 || this.scannedEntries++ >= 16_000) break;
          if (item.isSymbolicLink()) continue;
          const child = `${path}/${item.name}`;
          try {
            const actual = resolvePublicWorkspacePath(this.root, child);
            const stats = statSync(actual);
            if (stats.isDirectory()) walk(child, depth + 1);
            else if (stats.isFile() && stats.size <= MAX_FILE_BYTES) found.set(child, signature(stats));
          } catch { /* Private, disappeared, and unapproved paths are omitted. */ }
        }
      } catch { /* A run may create its output directory later. */ }
    };
    for (const directory of OUTPUT_DIRECTORIES) walk(directory, 0);
    return found;
  }

  public discover(): FileArtifact[] {
    const current = this.scan();
    const artifacts: FileArtifact[] = [];
    for (const [path, state] of current) {
      if (this.baseline.get(path) === state) continue;
      this.baseline.set(path, state);
      const artifact = this.capture(path);
      if (artifact) artifacts.push(artifact);
    }
    // Retain disappeared baseline entries: recreation with different metadata is still a change.
    return artifacts;
  }

  public mentioned(text: string): FileArtifact[] {
    const paths = new Set<string>();
    for (const match of text.matchAll(/\[[^\]\n]{0,300}\]\(<?([^\s)<>]+)>?(?:\s+["'][^\n]*?["'])?\)|`([^`\n]{1,1000})`|\b((?:artifacts|output|reports|results|figures)\/[^\s<>"'`),;]+)/g)) {
      let path = match[1] ?? match[2] ?? match[3];
      if (!path || /^(?:[a-z][a-z0-9+.-]*:|#)/i.test(path)) continue;
      try { path = decodeURIComponent(path); } catch { continue; }
      paths.add(path.replace(/#L\d+(?:-L\d+)?$/, ""));
      if (paths.size >= 60) break;
    }
    return [...paths].flatMap((path) => { const result = this.capture(path); return result ? [result] : []; });
  }

  public capture(input: string): FileArtifact | undefined {
    if (this.revisions >= MAX_REVISIONS || this.totalBytes >= MAX_TOTAL_BYTES || input.length > 2_000) return undefined;
    try {
      const candidate = (isAbsolute(input) ? relative(this.root, input) : input).split(sep).join("/");
      const actual = resolvePublicWorkspacePath(this.root, candidate);
      noSymlinks(this.root, resolve(this.root, candidate));
      const path = relative(this.root, actual).split(sep).join("/");
      const fd = openSync(actual, constants.O_RDONLY | constants.O_NOFOLLOW);
      let bytes: Buffer;
      try {
        const before = fstatSync(fd);
        if (!before.isFile() || before.size > MAX_FILE_BYTES || this.totalBytes + before.size > MAX_TOTAL_BYTES) return undefined;
        bytes = boundedRead(fd, before.size);
        const after = fstatSync(fd);
        if (signature(before) !== signature(after) || bytes.length !== before.size || bytes.length > MAX_FILE_BYTES) return undefined;
      } finally { closeSync(fd); }
      // Validate again after the bounded read, so a changed ancestor cannot redirect capture.
      if (resolvePublicWorkspacePath(this.root, path) !== actual) return undefined;
      noSymlinks(this.root, resolve(this.root, path));
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const previous = this.published.get(path);
      if (previous?.sha256 === sha256) return undefined;
      const revision = (previous?.revision ?? 0) + 1;
      const fileId = `artifact_${createHash("sha256").update(path).digest("hex").slice(0, 24)}`;
      const target = join(this.directory, `${fileId}.${revision}`);
      const temporary = `${target}.tmp`;
      writeFileSync(temporary, bytes, { mode: 0o600, flag: "wx" });
      const stored = openSync(temporary, "r"); try { fsyncSync(stored); } finally { closeSync(stored); }
      renameSync(temporary, target);
      this.published.set(path, { sha256, revision });
      this.revisions += 1; this.totalBytes += bytes.length;
      const mimeType = artifactMime(path, bytes);
      const base = `/api/runs/${this.runId}/files/${fileId}`;
      return {
        fileId, name: basename(path), path, mimeType, revision, sizeBytes: bytes.length, sha256,
        downloadUrl: `${base}?revision=${revision}`,
        ...(isTextArtifact(bytes) && TEXT_EXTENSIONS[extname(path).toLowerCase()] ? { contentUrl: `${base}/content?revision=${revision}` } : {}),
        ...(canPreviewArtifact(mimeType) ? { previewUrl: `${base}/preview?revision=${revision}` } : {})
      };
    } catch { return undefined; }
  }
}

function artifactDirectory(storageRoot: string, runId: string): string {
  if (!/^run_[a-zA-Z0-9]+$/.test(runId)) throw new ApiError(400, "invalid run");
  const root = realpathSync(storageRoot);
  const artifacts = join(root, "artifacts");
  if (!existsSync(artifacts)) mkdirSync(artifacts, { mode: 0o700 });
  noSymlinks(root, artifacts);
  const directory = join(artifacts, runId);
  if (!existsSync(directory)) mkdirSync(directory, { mode: 0o700 });
  noSymlinks(root, directory);
  return directory;
}

/** Only call with metadata already found in this run's persisted file events. */
export function readCapturedArtifact(storageRoot: string, runId: string, artifact: FileArtifact): Buffer {
  if (!/^artifact_[a-f0-9]{24}$/.test(artifact.fileId) || !Number.isSafeInteger(artifact.revision) || artifact.revision < 1 || !/^[a-f0-9]{64}$/.test(artifact.sha256 ?? "")) throw new ApiError(404, "artifact not found");
  const directory = artifactDirectory(storageRoot, runId);
  const target = join(directory, `${artifact.fileId}.${artifact.revision}`);
  if (!existsSync(target)) throw new ApiError(404, "artifact not found");
  noSymlinks(directory, target);
  const fd = openSync(target, constants.O_RDONLY | constants.O_NOFOLLOW);
  let bytes: Buffer;
  try {
    const before = fstatSync(fd);
    if (!before.isFile() || before.size > MAX_FILE_BYTES) throw new ApiError(413, "artifact exceeds the local download limit");
    bytes = boundedRead(fd, before.size);
    if (signature(before) !== signature(fstatSync(fd)) || bytes.length !== before.size) throw new ApiError(409, "the saved artifact changed while reading");
  } finally { closeSync(fd); }
  if (createHash("sha256").update(bytes).digest("hex") !== artifact.sha256) throw new ApiError(409, "the saved artifact failed its integrity check");
  return bytes;
}
