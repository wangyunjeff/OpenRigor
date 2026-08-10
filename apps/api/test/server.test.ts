import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { once } from "node:events";
import test from "node:test";
import type { RunDetail, RunSnapshot } from "@openrigor/protocol";

interface AcceptedRun {
  runId: string;
  conversationId: string;
  rootRunId: string;
  parentRunId?: string;
}

async function waitForTerminal(baseUrl: string, runId: string): Promise<RunDetail> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const response = await fetch(`${baseUrl}/api/runs/${runId}`);
    assert.equal(response.status, 200);
    const detail = await response.json() as RunDetail;
    if (detail.snapshot.status === "completed" || detail.snapshot.status === "failed" || detail.snapshot.status === "cancelled") return detail;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`run did not finish: ${runId}`);
}

test("creates an ordered conversation chain while preserving the legacy run detail", async () => {
  process.env.PORT = "0";
  process.env.OPENRIGOR_EXECUTOR = "demo";
  const { server } = await import("../src/server.js");
  if (!server.listening) await once(server, "listening");
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const rootRequest = {
      prompt: "  root prompt  ",
      model: " auto ",
      workspaceId: " workspace_a ",
      clientRequestId: " root_request "
    };
    const rootResponse = await fetch(`${baseUrl}/api/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(rootRequest)
    });
    assert.equal(rootResponse.status, 202);
    const root = await rootResponse.json() as AcceptedRun;
    assert.equal(root.rootRunId, root.runId);
    assert.ok(root.conversationId.startsWith("conversation_"));

    const normalizedReplayResponse = await fetch(`${baseUrl}/api/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prompt: "root prompt",
        mode: "standard",
        effort: "balanced",
        workspaceId: "workspace_a",
        attachments: [],
        clientRequestId: "root_request"
      })
    });
    assert.equal(normalizedReplayResponse.status, 202);
    assert.equal(normalizedReplayResponse.headers.get("idempotency-replayed"), "true");
    assert.equal((await normalizedReplayResponse.json() as AcceptedRun).runId, root.runId);

    const conflictingRequests = [
      { ...rootRequest, prompt: "different prompt" },
      { ...rootRequest, model: "different-model" },
      { ...rootRequest, mode: "cluster" },
      { ...rootRequest, effort: "deep" },
      { ...rootRequest, workspaceId: "workspace_b" },
      { ...rootRequest, attachments: [{ fileId: "file_1", name: "paper.pdf", mimeType: "application/pdf", sizeBytes: 42 }] },
      { ...rootRequest, continueFromRunId: "run_different_parent" }
    ];
    for (const conflictingRequest of conflictingRequests) {
      const conflictResponse = await fetch(`${baseUrl}/api/runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(conflictingRequest)
      });
      assert.equal(conflictResponse.status, 409);
      assert.deepEqual(await conflictResponse.json(), { error: "clientRequestId was already used with a different request" });
    }

    const noKeyResponses = await Promise.all([
      fetch(`${baseUrl}/api/runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: "same unkeyed prompt" })
      }),
      fetch(`${baseUrl}/api/runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: "same unkeyed prompt" })
      })
    ]);
    assert.deepEqual(noKeyResponses.map((response) => response.status), [202, 202]);
    const noKeyRuns = await Promise.all(noKeyResponses.map(async (response) => await response.json() as AcceptedRun));
    assert.notEqual(noKeyRuns[0]?.runId, noKeyRuns[1]?.runId);

    const earlyFollowUp = await fetch(`${baseUrl}/api/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "too soon", continueFromRunId: root.runId })
    });
    assert.equal(earlyFollowUp.status, 409);

    await waitForTerminal(baseUrl, root.runId);
    const followUpBody = JSON.stringify({ prompt: "follow-up prompt", continueFromRunId: root.runId, clientRequestId: "follow_up_request" });
    const followUpResponse = await fetch(`${baseUrl}/api/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: followUpBody
    });
    assert.equal(followUpResponse.status, 202);
    const followUp = await followUpResponse.json() as AcceptedRun;
    assert.notEqual(followUp.runId, root.runId);
    assert.equal(followUp.conversationId, root.conversationId);
    assert.equal(followUp.rootRunId, root.runId);
    assert.equal(followUp.parentRunId, root.runId);

    const replayResponse = await fetch(`${baseUrl}/api/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: followUpBody
    });
    assert.equal(replayResponse.status, 202);
    assert.equal(replayResponse.headers.get("idempotency-replayed"), "true");
    assert.equal((await replayResponse.json() as AcceptedRun).runId, followUp.runId);

    const parallelResponse = await fetch(`${baseUrl}/api/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "parallel", continueFromRunId: followUp.runId })
    });
    assert.equal(parallelResponse.status, 409);

    await waitForTerminal(baseUrl, followUp.runId);
    const staleResponse = await fetch(`${baseUrl}/api/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "fork old history", continueFromRunId: root.runId })
    });
    assert.equal(staleResponse.status, 409);

    for (const requestedRunId of [root.runId, followUp.runId]) {
      const detailResponse = await fetch(`${baseUrl}/api/runs/${requestedRunId}`);
      assert.equal(detailResponse.status, 200);
      const detail = await detailResponse.json() as RunDetail;
      assert.equal(detail.snapshot.runId, requestedRunId);
      assert.ok(Array.isArray(detail.events));
      assert.equal(detail.conversation?.conversationId, root.conversationId);
      assert.equal(detail.conversation?.rootRunId, root.runId);
      assert.deepEqual(detail.conversation?.runs.map((run) => run.snapshot.runId), [root.runId, followUp.runId]);
      const snapshots = detail.conversation?.runs.map((run) => run.snapshot) as RunSnapshot[];
      assert.equal(snapshots[0]?.rootRunId, root.runId);
      assert.equal(snapshots[1]?.parentRunId, root.runId);
    }
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
