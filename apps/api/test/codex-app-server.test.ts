import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { CodexAppServerClient } from "../src/codex-app-server.js";
import { OPENRIGOR_PLAN_TOOL } from "../src/research-events.js";

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

test("passes native model/effort values and treats Ultra as a guarded Codex orchestration value", async () => {
  const launcher = await createFakeCodexLauncher();
  const client = new CodexAppServerClient({ command: launcher.command, requestTimeoutMs: 2_000, turnTimeoutMs: 2_000 });
  try {
    const ultra = await client.run({
      prompt: "verify-ultra",
      cwd: dirname(fixture),
      model: "gpt-5.6-sol",
      effort: "ultra",
      ephemeral: true
    });
    assert.equal(ultra.status, "completed");

    const luna = await client.run({
      prompt: "verify-luna-max",
      cwd: dirname(fixture),
      threadId: ultra.threadId,
      model: "gpt-5.6-luna",
      effort: "max",
      ephemeral: true
    });
    assert.equal(luna.status, "completed");

    await assert.rejects(
      client.run({
        prompt: "unsupported",
        cwd: dirname(fixture),
        threadId: ultra.threadId,
        model: "gpt-5.6-luna",
        effort: "ultra"
      }),
      /gpt-5\.6-luna does not support Codex Ultra/
    );
  } finally {
    await client.close();
    await launcher.cleanup();
  }
});

test("turns TokenResearch routing into coordinator guidance without provider scheduler claims", async () => {
  const launcher = await createFakeCodexLauncher();
  const client = new CodexAppServerClient({ command: launcher.command, requestTimeoutMs: 2_000, turnTimeoutMs: 2_000 });
  try {
    const deltas: string[] = [];
    const result = await client.run({
      prompt: "route-me",
      cwd: dirname(fixture),
      model: "gpt-5.6-sol",
      effort: "ultra",
      routing: "tokenresearch",
      ephemeral: true
    }, {
      onNotification: (notification) => {
        if (notification.method !== "item/agentMessage/delta") return;
        const params = notification.params && typeof notification.params === "object" ? notification.params as Record<string, unknown> : null;
        if (typeof params?.delta === "string") deltas.push(params.delta);
      }
    });
    assert.equal(result.status, "completed");
    assert.ok(deltas.join("").includes("luna-worker profile (gpt-5.6-luna, max reasoning effort)"));
  } finally {
    await client.close();
    await launcher.cleanup();
  }
});


test("resumes a saved thread in a new app-server process before appending a turn", async () => {
  const launcher = await createFakeCodexLauncher();
  const firstClient = new CodexAppServerClient({ command: launcher.command, requestTimeoutMs: 2_000, turnTimeoutMs: 2_000 });
  const resumedClient = new CodexAppServerClient({ command: launcher.command, env: { OPENRIGOR_FAKE_ALLOW_RESUME: "true" }, requestTimeoutMs: 2_000, turnTimeoutMs: 2_000 });
  try {
    const first = await firstClient.run({ prompt: "First persisted turn", cwd: dirname(fixture), ephemeral: false });
    await firstClient.close();
    const resumed = await resumedClient.run({ prompt: "Continue saved work", cwd: dirname(fixture), threadId: first.threadId, ephemeral: false });
    assert.equal(resumed.status, "completed");
    assert.equal(resumed.threadId, first.threadId);
    assert.deepEqual(await resumedClient.listModels(), [{ id: "test-model", name: "Test model", description: "Fixture model" }]);
  } finally {
    await firstClient.close(); await resumedClient.close(); await launcher.cleanup();
  }
});


test("bridges explicit command approvals and user answers exactly once", async () => {
  const launcher = await createFakeCodexLauncher();
  const client = new CodexAppServerClient({ command: launcher.command, requestTimeoutMs: 2_000, turnTimeoutMs: 2_000 });
  try {
    const approvals: string[] = [];
    const approved = await client.run({ prompt: "approval", cwd: dirname(fixture) }, {
      onServerRequest: (request, respond) => {
        approvals.push(request.method);
        assert.equal(respond({ decision: "accept" }), true);
        assert.equal(respond({ decision: "accept" }), false);
      }
    });
    assert.equal(approved.status, "completed");
    assert.deepEqual(approvals, ["item/commandExecution/requestApproval"]);
    const deltas: string[] = [];
    const answered = await client.run({ prompt: "question", cwd: dirname(fixture), threadId: approved.threadId }, {
      onServerRequest: (request, respond) => { assert.equal(request.method, "item/tool/requestUserInput"); respond({ answers: { choice: { answers: ["Markdown"] } } }); },
      onNotification: (notification) => { const params = notification.params as { delta?: string } | undefined; if (params?.delta) deltas.push(params.delta); }
    });
    assert.equal(answered.status, "completed");
    assert.ok(deltas.join("").includes("Markdown"));
  } finally { await client.close(); await launcher.cleanup(); }
});

test("interrupting a waiting approval declines it and releases the turn", async () => {
  const launcher = await createFakeCodexLauncher();
  const client = new CodexAppServerClient({ command: launcher.command, requestTimeoutMs: 2_000, turnTimeoutMs: 2_000 });
  try {
    let ready: (() => void) | undefined;
    let session: { threadId: string; turnId: string } | undefined;
    const pending = new Promise<void>((done) => { ready = done; });
    let responded: ((result: unknown) => boolean) | undefined;
    const run = client.run({ prompt: "approval", cwd: dirname(fixture) }, {
      onSession: (value) => { session = value; },
      onServerRequest: (_request, respond) => { responded = respond; ready?.(); }
    });
    await pending;
    assert.ok(session);
    await client.interrupt(session.threadId, session.turnId);
    await run;
    assert.equal(responded?.({ decision: "accept" }), false);
  } finally { await client.close(); await launcher.cleanup(); }
});

test("declares the verified dynamic planning tool and resolves its server call exactly once", async () => {
  const launcher = await createFakeCodexLauncher();
  const client = new CodexAppServerClient({ command: launcher.command, requestTimeoutMs: 2_000, turnTimeoutMs: 2_000 });
  try {
    let calls = 0;
    const result = await client.run({ prompt: "dynamic-plan", cwd: dirname(fixture), dynamicTools: [OPENRIGOR_PLAN_TOOL] }, {
      onServerRequest: (request, respond) => {
        calls += 1;
        assert.equal(request.method, "item/tool/call");
        const params = request.params as { tool: string };
        assert.equal(params.tool, "openrigor_update_plan");
        const response = { success: true, contentItems: [{ type: "inputText", text: "Recorded" }] };
        assert.equal(respond(response), true);
        assert.equal(respond(response), false);
      }
    });
    assert.equal(result.status, "completed");
    assert.equal(calls, 1);
  } finally { await client.close(); await launcher.cleanup(); }
});
