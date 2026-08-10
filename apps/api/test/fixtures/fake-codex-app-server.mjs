import readline from "node:readline";

const input = readline.createInterface({ input: process.stdin });
let threadStarts = 0;
let turnStarts = 0;
let threadModel;

function write(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function fail(id, message) {
  write({ id, error: { code: -32000, message } });
}

input.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    write({ id: message.id, result: { userAgent: "fake-codex" } });
    return;
  }
  if (message.method === "initialized") return;

  if (message.method === "thread/start") {
    threadStarts += 1;
    if (threadStarts !== 1) {
      fail(message.id, "thread/start must only be called once");
      return;
    }
    threadModel = message.params?.model;
    write({ id: message.id, result: { thread: { id: "thread_fake" } } });
    return;
  }

  if (message.method === "thread/resume") {
    fail(message.id, "the live continuation path must not call thread/resume");
    return;
  }

  if (message.method === "turn/start") {
    if (message.params?.threadId !== "thread_fake") {
      fail(message.id, `unexpected thread id: ${String(message.params?.threadId)}`);
      return;
    }
    turnStarts += 1;
    const turnId = `turn_${turnStarts}`;
    const prompt = message.params?.input?.[0]?.text ?? "";
    if (prompt === "verify-ultra" && (threadModel !== "gpt-5.6-sol" || message.params?.model !== "gpt-5.6-sol" || message.params?.effort !== "ultra")) {
      fail(message.id, `unexpected Ultra params: ${JSON.stringify({ threadModel, model: message.params?.model, effort: message.params?.effort })}`);
      return;
    }
    if (prompt === "verify-luna-max" && (message.params?.model !== "gpt-5.6-luna" || message.params?.effort !== "max")) {
      fail(message.id, `unexpected Luna params: ${JSON.stringify({ model: message.params?.model, effort: message.params?.effort })}`);
      return;
    }
    write({ id: message.id, result: { turn: { id: turnId, status: "inProgress", items: [] } } });
    write({ method: "turn/started", params: { threadId: "thread_fake", turn: { id: turnId, status: "inProgress", items: [] } } });
    write({ method: "item/agentMessage/delta", params: { threadId: "thread_fake", turnId, itemId: `item_${turnStarts}`, delta: `answer:${prompt}` } });
    const complete = () => write({ method: "turn/completed", params: { threadId: "thread_fake", turn: { id: turnId, status: "completed", items: [] } } });
    if (prompt === "hold") {
      write({ method: "turn/started", params: { threadId: "thread_fake", turn: { id: "turn_2", status: "inProgress", items: [] } } });
      write({ method: "item/agentMessage/delta", params: { threadId: "thread_fake", turnId: "turn_2", itemId: "stale_item", delta: "STALE" } });
      write({ method: "turn/completed", params: { threadId: "thread_fake", turn: { id: "turn_2", status: "completed", items: [] } } });
      setTimeout(complete, 150);
    } else complete();
    return;
  }

  if (message.method === "turn/interrupt") {
    write({ id: message.id, result: {} });
    return;
  }

  fail(message.id, `unexpected method: ${String(message.method)}`);
});
