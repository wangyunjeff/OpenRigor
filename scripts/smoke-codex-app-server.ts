import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { CodexAppServerClient } from "../apps/api/src/codex-app-server.js";

const cwd = resolve(process.argv[2] ?? process.env.OPENRIGOR_CODEX_CWD ?? process.cwd());
const client = new CodexAppServerClient({
  requestTimeoutMs: 30_000,
  turnTimeoutMs: 120_000
});

const token = `OPENRIGOR_CONTEXT_${randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`;
let firstAnswer = "";
let secondAnswer = "";
let firstNotificationCount = 0;
let secondNotificationCount = 0;
try {
  const first = await client.run(
    {
      prompt: `Remember the token ${token} for my next message. Reply with exactly TOKEN_STORED. Do not use tools.`,
      cwd,
      sandbox: "read-only",
      approvalPolicy: "never",
      effort: "low",
      ephemeral: true
    },
    {
      onNotification: (notification) => {
        firstNotificationCount += 1;
        if (notification.method !== "item/agentMessage/delta") return;
        const params = notification.params && typeof notification.params === "object" ? notification.params as Record<string, unknown> : null;
        if (typeof params?.delta === "string") firstAnswer += params.delta;
      }
    }
  );
  if (first.status !== "completed") throw new Error(`unexpected first Codex status: ${first.status}`);
  if (!firstAnswer.includes("TOKEN_STORED")) throw new Error(`unexpected first Codex answer: ${firstAnswer || "<empty>"}`);

  const second = await client.run(
    {
      prompt: "What exact token did I ask you to remember in my previous message? Reply with only that token. Do not use tools.",
      cwd,
      threadId: first.threadId,
      sandbox: "read-only",
      approvalPolicy: "never",
      effort: "low",
      ephemeral: true
    },
    {
      onNotification: (notification) => {
        secondNotificationCount += 1;
        if (notification.method !== "item/agentMessage/delta") return;
        const params = notification.params && typeof notification.params === "object" ? notification.params as Record<string, unknown> : null;
        if (typeof params?.delta === "string") secondAnswer += params.delta;
      }
    }
  );
  if (second.status !== "completed") throw new Error(`unexpected second Codex status: ${second.status}`);
  if (second.threadId !== first.threadId) throw new Error(`continuation changed threads: ${first.threadId} != ${second.threadId}`);
  if (second.turnId === first.turnId) throw new Error(`continuation reused turn id: ${second.turnId}`);
  if (!secondAnswer.includes(token)) throw new Error(`Codex did not retain the first-turn token: ${secondAnswer || "<empty>"}`);
  console.log(JSON.stringify({
    ok: true,
    cwd,
    threadId: first.threadId,
    firstTurnId: first.turnId,
    secondTurnId: second.turnId,
    firstNotificationCount,
    secondNotificationCount,
    token,
    firstAnswer,
    secondAnswer
  }));
} finally {
  await client.close();
}
