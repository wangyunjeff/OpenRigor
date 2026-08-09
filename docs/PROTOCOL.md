# Run Protocol v0

The current transport is HTTP JSON plus Server-Sent Events (SSE). The same event envelope is suitable for WebSocket and durable queue adapters later.

## Start a run

```http
POST /api/runs
Content-Type: application/json

{
  "prompt": "Summarize the attached papers",
  "model": "auto",
  "mode": "standard",
  "effort": "balanced",
  "clientRequestId": "web_01J..."
}
```

Response:

```json
{
  "runId": "run_01...",
  "status": "queued",
  "eventsUrl": "/api/runs/run_01.../events"
}
```

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
- `clientRequestId` is optional and scoped to the current API process in the local alpha; repeating a `POST /api/runs` with the same key replays the original `runId` instead of starting another run. Production must move this index into the durable control plane.
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
