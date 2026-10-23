import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { get, type IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

async function start(root: string): Promise<{ child: ChildProcessWithoutNullStreams; base: string }> {
  const child = spawn(process.execPath, ["--import", "tsx", fileURLToPath(new URL("../src/server.ts", import.meta.url))], {
    env: { ...process.env, PORT: "0", OPENRIGOR_EXECUTOR: "demo", OPENRIGOR_CODEX_CWD: root, OPENRIGOR_DATA_DIR: join(root, ".openrigor") },
    stdio: ["pipe", "pipe", "pipe"]
  });
  let output = "";
  let errors = "";
  child.stderr.on("data", (chunk: Buffer) => { errors += chunk.toString(); });
  const base = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => { child.kill("SIGKILL"); reject(new Error(`API failed to start: ${errors}`)); }, 10_000);
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      const address = output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
      if (address) { clearTimeout(timeout); resolve(address); }
    });
    child.once("exit", () => { clearTimeout(timeout); reject(new Error(`API exited before listening: ${errors}`)); });
  });
  return { child, base };
}

async function kill(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  child.kill("SIGKILL");
  await exited;
}

test("SIGTERM closes an open event stream and releases the store for immediate restart", async () => {
  const root = mkdtempSync(join(tmpdir(), "openrigor-shutdown-"));
  const children: ChildProcessWithoutNullStreams[] = [];
  let stream: IncomingMessage | undefined;
  try {
    const first = await start(root); children.push(first.child);
    const response = await fetch(`${first.base}/api/runs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt: "Keep a stream open during restart" }) });
    assert.equal(response.status, 202);
    const { runId } = await response.json() as { runId: string };
    stream = await new Promise<IncomingMessage>((resolve, reject) => {
      get(`${first.base}/api/runs/${runId}/events`, (incoming) => { incoming.resume(); resolve(incoming); }).on("error", reject);
    });
    const streamEnded = once(stream, "end");
    const exited = once(first.child, "exit");
    first.child.kill("SIGTERM");
    let timer: NodeJS.Timeout | undefined;
    try {
      const [code, signal] = await Promise.race([
        exited,
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("API did not shut down with an open event stream")), 3_000); })
      ]);
      assert.equal(code, 0); assert.equal(signal, null);
    } finally { clearTimeout(timer); }
    await streamEnded;
    assert.equal(existsSync(join(root, ".openrigor", "runtime.lock")), false);
    const second = await start(root); children.push(second.child);
    const restored = await fetch(`${second.base}/api/runs/${runId}`);
    assert.equal(restored.status, 200);
    const detail = await restored.json() as { snapshot: { status: string }; events: { sequence: number }[] };
    assert.equal(detail.snapshot.status, "failed");
    assert.ok(detail.events.length > 0);
    assert.deepEqual(detail.events.map((event) => event.sequence), detail.events.map((_, index) => index + 1));
  } finally {
    stream?.destroy();
    await Promise.all(children.map(kill));
    rmSync(root, { recursive: true, force: true });
  }
});
