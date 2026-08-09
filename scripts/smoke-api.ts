const baseUrl = process.argv[2] ?? "http://127.0.0.1:8787";

const startResponse = await fetch(`${baseUrl}/api/runs`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ prompt: "protocol smoke test" })
});
if (!startResponse.ok) throw new Error(`start failed: ${startResponse.status}`);
const accepted = (await startResponse.json()) as { runId: string };

const streamResponse = await fetch(`${baseUrl}/api/runs/${accepted.runId}/events`);
if (!streamResponse.ok || !streamResponse.body) throw new Error(`stream failed: ${streamResponse.status}`);

const reader = streamResponse.body.getReader();
const decoder = new TextDecoder();
let buffer = "";
let expectedSequence = 1;
let eventCount = 0;
let terminalStatus: string | undefined;

while (!terminalStatus) {
  const chunk = await reader.read();
  if (chunk.done) break;
  buffer += decoder.decode(chunk.value, { stream: true });
  const frames = buffer.split("\n\n");
  buffer = frames.pop() ?? "";
  for (const frame of frames) {
    const dataLine = frame.split("\n").find((line) => line.startsWith("data: "));
    if (!dataLine) continue;
    const event = JSON.parse(dataLine.slice(6)) as { sequence: number; type: string; status?: string };
    if (event.sequence !== expectedSequence) throw new Error(`event sequence gap: expected ${expectedSequence}, received ${event.sequence}`);
    expectedSequence += 1;
    eventCount += 1;
    if (event.type === "run-finished") terminalStatus = event.status;
  }
}
await reader.cancel();

if (terminalStatus !== "completed") throw new Error(`unexpected terminal status: ${terminalStatus ?? "none"}`);
console.log(JSON.stringify({ ok: true, runId: accepted.runId, eventCount, terminalStatus }));
