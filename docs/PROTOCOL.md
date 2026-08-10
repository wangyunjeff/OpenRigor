# Run Protocol v0

The current transport is HTTP JSON plus Server-Sent Events (SSE). The same event envelope is suitable for WebSocket and durable queue adapters later.

## Start a run

```http
POST /api/runs
Content-Type: application/json

{
  "prompt": "Summarize the attached papers",
  "model": "gpt-5.6-sol",
  "mode": "standard",
  "effort": "medium",
  "routing": "tokenresearch",
  "clientRequestId": "web_01J..."
}
```

### Model, effort, and Ultra

- `model` accepts `auto`, `gpt-5.6-sol`, `gpt-5.6-terra`, and `gpt-5.6-luna`. `auto` keeps the model chosen by the local Codex runtime; custom provider model IDs remain wire-compatible.
- `effort` is the single-model reasoning budget: `low`, `medium`, `high`, `xhigh`, or `max`.
- `mode` is `standard` or `ultra`. Ultra is a multi-agent orchestration mode, not a sixth reasoning-effort level. An Ultra snapshot is normalized to `effort: "max"` while the local Codex adapter sends its dedicated `ultra` execution value.
- `routing` is optional and additive. The `tokenresearch` strategy forces the server-side coordinator to `model: "gpt-5.6-sol"`, `mode: "ultra"`, and `effort: "max"`, regardless of conflicting model or effort fields. The local Codex adapter adds coordinator guidance to use the configured `luna-worker` profile (`gpt-5.6-luna`/`max`) through local collaboration tools; it does not claim to invoke a provider scheduler API.
- Ultra requires an explicit Sol or Terra selection. Luna supports up to `max`; `auto`, Luna, and custom model IDs with `mode: "ultra"` return `400` so the runtime cannot silently resolve Auto to an incompatible model.
- Protocol-v0 aliases remain accepted for old clients: `fast` -> `low`, `balanced` -> `medium`, `deep` -> `max`, and `cluster` -> `ultra`.

Response:

```json
{
  "runId": "run_01...",
  "status": "queued",
  "eventsUrl": "/api/runs/run_01.../events",
  "conversationId": "conversation_01...",
  "rootRunId": "run_01..."
}
```

## Continue a conversation

Every user turn remains an independent run with its own status, event sequence, SSE URL, cancellation, and terminal event. To append a turn to the same Codex conversation, submit a new run using the latest terminal run id:

```http
POST /api/runs
Content-Type: application/json

{
  "prompt": "Now turn that into an implementation plan",
  "continueFromRunId": "run_01...",
  "clientRequestId": "web_01J..."
}
```

The accepted follow-up has a new `runId`, preserves the original `conversationId` and `rootRunId`, and reports the direct `parentRunId`. The local API returns `409` when the source run is not terminal, is not the latest run in its conversation, or another run in that conversation is active. This prevents concurrent turns from overwriting the single live Codex-thread notification route.

`GET /api/runs/:runId` remains backward-compatible at the top level:

```json
{
  "snapshot": { "runId": "run_02...", "rootRunId": "run_01...", "parentRunId": "run_01..." },
  "events": [],
  "conversation": {
    "conversationId": "conversation_01...",
    "rootRunId": "run_01...",
    "runs": [
      { "snapshot": { "runId": "run_01..." }, "events": [] },
      { "snapshot": { "runId": "run_02..." }, "events": [] }
    ]
  }
}
```

The `conversation.runs` chain is ordered from root to latest, so restoring either a root or child run can rebuild the whole visible conversation and recover the root item used by recent-task navigation.

## SSE envelope

Each event has a stable per-run sequence and deterministic event id. Clients should persist the last sequence and send `Last-Event-ID` after reconnecting.

```text
id: run_01:4
event: part-delta
data: {"eventId":"run_01:4","runId":"run_01","sequence":4,"ts":"2026-08-09T12:00:00.000Z","type":"part-delta","partId":"answer","delta":"hello"}
```

## Event types

| Type | Purpose | Consumer behavior |
|---|---|---|
| `snapshot` | Current run projection after connect | Replace local projection before applying later events |
| `status` | Non-terminal state transition | Update status and progress |
| `part` | A complete text/reasoning block | Render or replace by `partId` |
| `part-delta` | Incremental text for a block | Append by `partId`; ignore duplicate sequence |
| `tool` | Tool request/result summary | Render safely; never execute in browser |
| `file` | Artifact metadata or revision | Fetch through signed URL only |
| `subagent` | Child run lifecycle | Group by `parentRunId` |
| `run-finished` | Terminal result | Close stream after persisting final state |
| `error` | Recoverable or terminal error | Show safe message and retain diagnostic id |

## Compatibility rules

- Unknown event types must be ignored but logged.
- Event order is guaranteed only within one `runId` and `sequence`.
- Delivery is at least once; consumers must be idempotent.
- `clientRequestId` is optional and scoped to the current API process in the local alpha; repeating a `POST /api/runs` with the same key and normalized payload replays the original `runId` instead of starting another run. Reusing that key with a different prompt, continuation source, or execution payload returns `409`. Production must move this index into the durable control plane.
- `conversationId`, `rootRunId`, `parentRunId`, `continueFromRunId`, and the `conversation` detail object are additive protocol-v0 fields. Older consumers may continue using only `snapshot` and `events`.
- Payloads must never contain provider secrets, session cookies, or raw sandbox credentials.
- Additive fields are compatible; changing a field's meaning requires a protocol version.

## Local Codex adapter

The local alpha keeps the public `RunEvent` contract stable while adapting the Codex app-server JSONL stream:

| Codex notification | OpenRigor event |
|---|---|
| `item/agentMessage/delta` | `part-delta(kind=text)` |
| `item/reasoning/summaryTextDelta`, `item/reasoning/textDelta` | `part-delta(kind=reasoning)` |
| `item/started`, `item/completed` for command/file/search items | `tool` and `file` |
| `item/commandExecution/outputDelta` | tool-scoped `part-delta` |
| `thread/tokenUsage/updated` | `run-finished.usage` |
| `turn/completed` | `run-finished` |

Unknown provider notifications are ignored by the adapter and never forwarded verbatim. This prevents provider-specific payloads or credentials from becoming part of the browser-facing contract.

For the local live process, the first run calls `thread/start` once and every accepted follow-up calls `turn/start` with the same `threadId`. The default ephemeral thread exists only in that app-server process. OpenRigor's run/conversation indexes are also in API memory, so API or app-server restart recovery is deliberately outside this alpha contract; cold persisted-thread recovery would additionally require `thread/resume` and durable server metadata.
