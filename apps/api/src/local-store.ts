import { existsSync, mkdirSync, openSync, closeSync, fsyncSync, readFileSync, renameSync, writeFileSync, appendFileSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { AttachmentRef, RunEvent, RunSnapshot } from "@openrigor/protocol";

/** Atomic local documents plus append-only, fsynced run journals. Never stores provider credentials. */
export class LocalStore {
  public constructor(public readonly directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    mkdirSync(join(directory, "runs"), { recursive: true, mode: 0o700 });
  }

  public acquireLock(): () => void {
    const path = join(this.directory, "runtime.lock");
    const acquire = (): void => {
      try { writeFileSync(path, String(process.pid), { flag: "wx", mode: 0o600 }); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const owner = Number.parseInt(readFileSync(path, "utf8"), 10);
        let alive = false;
        if (Number.isInteger(owner) && owner > 0) { try { process.kill(owner, 0); alive = true; } catch (probe) { if ((probe as NodeJS.ErrnoException).code === "EPERM") alive = true; } }
        if (alive) throw new Error("Another OpenRigor API is already using this data directory");
        unlinkSync(path); acquire();
      }
    };
    acquire();
    let released = false;
    return () => { if (!released) { released = true; try { if (readFileSync(path, "utf8") === String(process.pid)) unlinkSync(path); } catch { /* already removed */ } } };
  }

  public read<T>(name: string, fallback: T): T {
    const path = join(this.directory, `${name}.json`);
    if (!existsSync(path)) return fallback;
    // Corrupt state must be visible to the operator, never silently overwritten.
    return JSON.parse(readFileSync(path, "utf8")) as T;
  }

  public write(name: string, value: unknown): void {
    const path = join(this.directory, `${name}.json`);
    const temporary = `${path}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify(value), { mode: 0o600 });
    const fd = openSync(temporary, "r");
    try { fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(temporary, path);
  }

  public writeRun(metadata: PersistedRun): void {
    this.write(`runs/${metadata.snapshot.runId}`, metadata);
  }

  public appendEvent(event: RunEvent): void {
    const path = join(this.directory, "runs", `${event.runId}.events.jsonl`);
    appendFileSync(path, `${JSON.stringify(event)}\n`, { mode: 0o600 });
    const fd = openSync(path, "r");
    try { fsyncSync(fd); } finally { closeSync(fd); }
  }

  public loadRuns(): { metadata: PersistedRun; events: RunEvent[] }[] {
    return readdirSync(join(this.directory, "runs"))
      .filter((name) => /^run_[a-zA-Z0-9]+\.json$/.test(name))
      .map((name) => {
        const metadata = this.read<PersistedRun>(`runs/${name.slice(0, -5)}`, null as never);
        const eventsPath = join(this.directory, "runs", `${metadata.snapshot.runId}.events.jsonl`);
        const text = existsSync(eventsPath) ? readFileSync(eventsPath, "utf8") : "";
        const events: RunEvent[] = [];
        const lines = text.split("\n");
        for (let index = 0; index < lines.length; index += 1) {
          const line = lines[index];
          if (!line) continue;
          try {
            const event = JSON.parse(line) as RunEvent;
            if (event.runId !== metadata.snapshot.runId || event.sequence !== events.length + 1) throw new Error("invalid event sequence");
            events.push(event);
          } catch (error) {
            // A crash can truncate the last append, but never discard an interior event.
            if (index === lines.length - 1 && !text.endsWith("\n")) {
              writeFileSync(eventsPath, events.map((event) => JSON.stringify(event)).join("\n") + (events.length ? "\n" : ""), { mode: 0o600 });
              break;
            }
            throw error;
          }
        }
        return { metadata, events };
      })
      .sort((a, b) => a.metadata.snapshot.createdAt.localeCompare(b.metadata.snapshot.createdAt));
  }
}

export interface PersistedRun {
  snapshot: RunSnapshot;
  clientRequestId?: string;
  fingerprint?: string;
  codexThreadId?: string;
  projectId?: string;
  skillIds?: string[];
  contextPrompt?: string;
  attachments?: AttachmentRef[];
  contextPaths?: string[];
}
