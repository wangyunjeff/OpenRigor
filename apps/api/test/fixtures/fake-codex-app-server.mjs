import readline from "node:readline";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const input = readline.createInterface({ input: process.stdin });
let threadStarts = 0;
let turnStarts = 0;
let threadModel;
let threadCwd;
let threadDynamicTools;
const awaitingRequests = new Map();

function write(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function fail(id, message) {
  write({ id, error: { code: -32000, message } });
}

input.on("line", (line) => {
  const message = JSON.parse(line);
  if (awaitingRequests.has(String(message.id)) && message.result !== undefined) {
    const pending = awaitingRequests.get(String(message.id)); awaitingRequests.delete(String(message.id));
    const result = JSON.stringify(message.result);
    write({ method: "item/agentMessage/delta", params: { threadId: "thread_fake", turnId: pending.turnId, itemId: "answered", delta: `response:${result}` } });
    write({ method: "turn/completed", params: { threadId: "thread_fake", turn: { id: pending.turnId, status: "completed", items: [] } } });
    return;
  }
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
    threadCwd = message.params?.cwd;
    threadDynamicTools = message.params?.dynamicTools;
    write({ id: message.id, result: { thread: { id: "thread_fake" } } });
    return;
  }

  if (message.method === "model/list") {
    write({ id: message.id, result: { data: [{ id: "test-model", displayName: "Test model", description: "Fixture model" }] } });
    return;
  }

  if (message.method === "thread/resume") {
    if (process.env.OPENRIGOR_FAKE_ALLOW_RESUME === "true" && message.params?.threadId === "thread_fake") {
      threadStarts = 1;
      threadCwd = message.params?.cwd;
      write({ id: message.id, result: { thread: { id: "thread_fake" } } });
      return;
    }
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
    const rawPrompt = message.params?.input?.[0]?.text ?? "";
    const prompt = rawPrompt.split("\n\n[OpenRigor delivery guidance]")[0];
    if (prompt === "verify-ultra" && (threadModel !== "gpt-5.6-sol" || message.params?.model !== "gpt-5.6-sol" || message.params?.effort !== "ultra")) {
      fail(message.id, `unexpected Ultra params: ${JSON.stringify({ threadModel, model: message.params?.model, effort: message.params?.effort })}`);
      return;
    }
    if (prompt === "verify-luna-max" && (message.params?.model !== "gpt-5.6-luna" || message.params?.effort !== "max")) {
      fail(message.id, `unexpected Luna params: ${JSON.stringify({ model: message.params?.model, effort: message.params?.effort })}`);
      return;
    }
    if (prompt.includes("[OpenRigor routing: tokenresearch]") && (threadModel !== "gpt-5.6-sol" || message.params?.model !== "gpt-5.6-sol" || message.params?.effort !== "ultra")) {
      fail(message.id, `unexpected TokenResearch coordinator params: ${JSON.stringify({ threadModel, model: message.params?.model, effort: message.params?.effort })}`);
      return;
    }
    write({ id: message.id, result: { turn: { id: turnId, status: "inProgress", items: [] } } });
    write({ method: "turn/started", params: { threadId: "thread_fake", turn: { id: turnId, status: "inProgress", items: [] } } });
    write({ method: "item/agentMessage/delta", params: { threadId: "thread_fake", turnId, itemId: `item_${turnStarts}`, delta: `answer:${prompt}` } });
    if (prompt === "dynamic-plan" || prompt === "dynamic-invalid") {
      const spec = threadDynamicTools?.find((tool) => tool.name === "openrigor_update_plan");
      if (!spec || spec.type !== "function" || spec.inputSchema?.properties?.steps?.type !== "array") {
        write({ method: "turn/completed", params: { threadId: "thread_fake", turn: { id: turnId, status: "failed", error: { message: "Missing declared planning tool" }, items: [] } } });
        return;
      }
      const id = `dynamic_request_${turnStarts}`;
      awaitingRequests.set(id, { turnId });
      write({ id, method: "item/tool/call", params: { threadId: "thread_fake", turnId, callId: `plan_call_${turnStarts}`, namespace: null, tool: "openrigor_update_plan", arguments: { steps: [{ step: "Check evidence", status: prompt === "dynamic-invalid" ? "imagined" : "in_progress" }, { step: "Deliver", status: "pending" }], explanation: "Real tool-driven plan" } } });
      return;
    }
    if (prompt === "approval" || prompt === "question") {
      const id = `server_request_${turnStarts}`;
      awaitingRequests.set(id, { turnId });
      write({ id, method: prompt === "approval" ? "item/commandExecution/requestApproval" : "item/tool/requestUserInput", params: { threadId: "thread_fake", turnId, reason: "Review the requested action", command: "node --version", cwd: "/local/workspace", ...(prompt === "question" ? { questions: [{ id: "choice", header: "Format", question: "Which format should be used?", options: [{ label: "Markdown", description: "Editable plain text" }, { label: "PDF", description: "Portable document" }] }] } : {}) } });
      return;
    }
    if (prompt === "artifact") {
      writeFileSync(join(threadCwd, "result.md"), "Verified generated artifact");
      write({ method: "item/completed", params: { threadId: "thread_fake", turnId, item: { id: "file_item", type: "fileChange", status: "completed", changes: [{ path: "result.md", kind: { type: "add" } }] } } });
    }
    if (prompt === "research-fixture") {
      const notify = (method, item) => write({ method, params: { threadId: "thread_fake", turnId, item } });
      const plan = { threadId: "thread_fake", turnId, plan: [{ step: "Check primary evidence", status: "completed" }, { step: "Prepare deliverables", status: "in_progress" }], explanation: "Actual fixture plan" };
      write({ method: "turn/plan/updated", params: plan });
      write({ method: "turn/plan/updated", params: plan });
      const search = { type: "webSearch", id: "search_research", action: { type: "search", query: "original paper", sources: [{ title: "Primary paper", url: "https://example.org/research", snippet: "Provider returned evidence" }] } };
      notify("item/started", search); notify("item/completed", search);
      notify("item/completed", { type: "webSearch", id: "search_no_sources", query: "query alone is not evidence", text: "https://example.org/not-retrieved" });
      mkdirSync(join(threadCwd, "artifacts"), { recursive: true });
      writeFileSync(join(threadCwd, "artifacts", "report.md"), "# First revision\n");
      writeFileSync(join(threadCwd, "artifacts", "data.csv"), "x,y\n1,2\n");
      writeFileSync(join(threadCwd, "artifacts", "chart.png"), Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"));
      writeFileSync(join(threadCwd, "artifacts", "chart.svg"), '<svg xmlns="http://www.w3.org/2000/svg"><text>Research chart</text></svg>');
      writeFileSync(join(threadCwd, "artifacts", "page.html"), "<html><script>alert('must not execute')</script></html>");
      writeFileSync(join(threadCwd, "artifacts", "auth.json"), "private credential");
      notify("item/completed", { type: "commandExecution", id: "command_research", command: "python analysis.py", status: "completed", exitCode: 0 });
      notify("item/completed", { type: "fileChange", id: "change_duplicate", changes: [{ path: "artifacts/data.csv" }, { path: "artifacts/missing.csv" }, { path: ".env" }] });
      const publishSecondRevision = () => {
        // HTTP tests can acknowledge durable capture instead of racing disk writes against a timer.
        const barrier = process.env.OPENRIGOR_FAKE_RESEARCH_REVISION_BARRIER;
        if (barrier && !existsSync(barrier)) {
          setTimeout(publishSecondRevision, 10).unref();
          return;
        }
        writeFileSync(join(threadCwd, "artifacts", "report.md"), "# Second immutable revision\n");
        notify("item/completed", { type: "commandExecution", id: "command_research_2", command: "python finalize.py", status: "completed", exitCode: 0 });
        writeFileSync(join(threadCwd, "explicit.txt"), "Explicitly linked outside controlled output folders");
        notify("item/completed", { type: "agentMessage", id: "research_final", text: "Created [report](artifacts/report.md), [data](artifacts/data.csv), [extra](explicit.txt). Reference only: [not retrieved](https://example.org/not-retrieved)." });
        write({ method: "turn/plan/updated", params: { ...plan, plan: plan.plan.map((step) => ({ ...step, status: "completed" })) } });
        write({ method: "turn/completed", params: { threadId: "thread_fake", turn: { id: turnId, status: "completed", items: [] } } });
      };
      setTimeout(publishSecondRevision, 100);
      return;
    }
    if (prompt === "research-cancel") {
      setTimeout(() => {
        mkdirSync(join(threadCwd, "artifacts"), { recursive: true });
        writeFileSync(join(threadCwd, "artifacts", "late.md"), "Late provider output after cancellation");
        write({ method: "item/completed", params: { threadId: "thread_fake", turnId, item: { type: "commandExecution", id: "late_command", command: "python late.py", status: "completed", exitCode: 0 } } });
        write({ method: "turn/completed", params: { threadId: "thread_fake", turn: { id: turnId, status: "completed", items: [] } } });
      }, 180);
      return;
    }
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
