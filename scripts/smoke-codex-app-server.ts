import { resolve } from "node:path";
import { CodexAppServerClient } from "../apps/api/src/codex-app-server.js";

const cwd = resolve(process.argv[2] ?? process.env.OPENRIGOR_CODEX_CWD ?? process.cwd());
const client = new CodexAppServerClient({
  requestTimeoutMs: 30_000,
  turnTimeoutMs: 120_000
});

let answer = "";
let notificationCount = 0;
try {
  const result = await client.run(
    {
      prompt: "Reply with exactly OPENRIGOR_READY. Do not use tools.",
      cwd,
      sandbox: "read-only",
      approvalPolicy: "never",
      effort: "low",
      ephemeral: true
    },
    {
      onNotification: (notification) => {
        notificationCount += 1;
        if (notification.method !== "item/agentMessage/delta") return;
        const params = notification.params && typeof notification.params === "object" ? notification.params as Record<string, unknown> : null;
        if (typeof params?.delta === "string") answer += params.delta;
      }
    }
  );
  if (result.status !== "completed") throw new Error(`unexpected Codex status: ${result.status}`);
  if (!answer.includes("OPENRIGOR_READY")) throw new Error(`unexpected Codex answer: ${answer || "<empty>"}`);
  console.log(JSON.stringify({ ok: true, cwd, threadId: result.threadId, turnId: result.turnId, notificationCount, answer }));
} finally {
  await client.close();
}
