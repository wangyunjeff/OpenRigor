import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { CodexAppServerClient } from "../src/codex-app-server.js";

const fixture = fileURLToPath(new URL("./fixtures/fake-codex-app-server.mjs", import.meta.url));

async function createFakeCodexLauncher(): Promise<{ command: string; cleanup: () => Promise<void> }> {
  const directory = await mkdtemp(join(tmpdir(), "openrigor-fake-codex-"));
  const quotedNode = process.execPath.replaceAll("'", "'\\''");
  const quotedFixture = fixture.replaceAll("'", "'\\''");
  if (process.platform === "win32") {
    const command = join(directory, "codex.cmd");
    await writeFile(command, `@echo off\r\n"${process.execPath}" "${fixture}" %*\r\n`, "utf8");
    return { command, cleanup: () => rm(directory, { recursive: true, force: true }) };
  }

  const command = join(directory, "codex");
  await writeFile(command, `#!/bin/sh\nexec '${quotedNode}' '${quotedFixture}' "$@"\n`, "utf8");
  await chmod(command, 0o755);
  return { command, cleanup: () => rm(directory, { recursive: true, force: true }) };
}

test("continues a live Codex thread with a second turn and rejects concurrent turns", async () => {
  const launcher = await createFakeCodexLauncher();
  const client = new CodexAppServerClient({ command: launcher.command, requestTimeoutMs: 2_000, turnTimeoutMs: 2_000 });
  try {
    const firstNotifications: string[] = [];
    const first = await client.run(
      { prompt: "first", cwd: dirname(fixture), ephemeral: true },
      { onNotification: (notification) => firstNotifications.push(notification.method) }
    );
    assert.equal(first.status, "completed");
    assert.equal(first.threadId, "thread_fake");
    assert.equal(first.turnId, "turn_1");
    assert.ok(firstNotifications.includes("item/agentMessage/delta"));

    const second = await client.run({ prompt: "second", cwd: dirname(fixture), threadId: first.threadId, ephemeral: true });
    assert.equal(second.status, "completed");
    assert.equal(second.threadId, first.threadId);
    assert.equal(second.turnId, "turn_2");

    let sessionStarted: (() => void) | undefined;
    const session = new Promise<void>((resolve) => {
      sessionStarted = resolve;
    });
    const heldDeltas: string[] = [];
    const held = client.run(
      { prompt: "hold", cwd: dirname(fixture), threadId: first.threadId, ephemeral: true },
      {
        onSession: () => sessionStarted?.(),
        onNotification: (notification) => {
          if (notification.method !== "item/agentMessage/delta") return;
          const params = notification.params && typeof notification.params === "object" ? notification.params as Record<string, unknown> : null;
          if (typeof params?.delta === "string") heldDeltas.push(params.delta);
        }
      }
    );
    await session;
    await assert.rejects(
      client.run({ prompt: "overlap", cwd: dirname(fixture), threadId: first.threadId, ephemeral: true }),
      /already has an active turn/
    );
    const heldResult = await held;
    assert.equal(heldResult.status, "completed");
    assert.equal(heldResult.turnId, "turn_3");
    assert.deepEqual(heldDeltas, ["answer:hold"]);
  } finally {
    await client.close();
    await launcher.cleanup();
  }
});
