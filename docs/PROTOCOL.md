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
| `plan` | Real plan steps and their reported state | Replace the latest plan; never infer completion from the run status |
| `source` | Link observed in structured search results or a page request | Merge by `sourceId`; a request does not prove successful retrieval or verification |
| `file` | Verified artifact metadata or immutable revision | Merge by `fileId`; fetch the server-returned guarded URL |
| `subagent` | Child run lifecycle | Group by `parentRunId` |
| `run-finished` | Terminal result | Close stream after persisting final state |
| `error` | Recoverable or terminal error | Show safe message and retain diagnostic id |

## Compatibility rules

- Unknown event types must be ignored but logged.
- Event order is guaranteed only within one `runId` and `sequence`.
- Delivery is at least once; consumers must be idempotent.
- `clientRequestId` is optional and persisted in the local alpha; repeating a `POST /api/runs` with the same key and normalized payload replays the original `runId` instead of starting another run, including after restart. Reusing that key with a different prompt, continuation source, or execution/context payload returns `409`. Production must move this index into its tenant-scoped durable control plane.
- `conversationId`, `rootRunId`, `parentRunId`, `continueFromRunId`, and the `conversation` detail object are additive protocol-v0 fields. Older consumers may continue using only `snapshot` and `events`.
- Payloads must never contain provider secrets, session cookies, or raw sandbox credentials.
- Additive fields are compatible; changing a field's meaning requires a protocol version.

## Local Codex adapter

The local alpha keeps the public `RunEvent` contract stable while adapting the Codex app-server JSONL stream:

| Codex notification | OpenRigor event |
|---|---|
| `item/agentMessage/delta` | `part-delta(kind=text)` with a provider-item-scoped `partId` |
| `item/reasoning/summaryTextDelta`, `item/reasoning/textDelta` | `part-delta(kind=reasoning)` |
| `item/started`, `item/completed` for command/file/search items | `tool` and `file` |
| `turn/plan/updated` | `plan` with validated steps and provider provenance |
| `item/tool/call` for the declared `openrigor_update_plan` tool | Strictly validated `plan`, then a real tool acknowledgement |
| Structured `webSearch` results and page actions | `source`, distinguishing result metadata from a page-access attempt |
| `item/commandExecution/outputDelta` | tool-scoped `part-delta` |
| `thread/tokenUsage/updated` | `run-finished.usage` |
| `turn/completed` | `run-finished` |

Unknown provider notifications are ignored by the adapter and never forwarded verbatim. This prevents provider-specific payloads or credentials from becoming part of the browser-facing contract.

Agent messages retain their provider item boundary (`answer:<itemId>`). This lets
clients replay commentary before a tool call, execution activity, and the final
answer in their original order instead of concatenating independent messages.
The completed `part` remains authoritative for its `partId`, as required by the
event table above.

### Tool result semantics

`tool.tool.phase` remains the provider lifecycle (`requested`, `running`, `succeeded`, or `failed`) for protocol-v0 compatibility. Completed tool events may additionally include `outcome`, `exitCode`, `durationMs`, and `diagnostic`:

| Outcome | Meaning | UI treatment |
|---|---|---|
| `success` | Command completed normally | Quiet green completion, output collapsed |
| `no-result` | Search returned no matches (commonly exit code 1) | Neutral status, never a red error |
| `partial` | Non-zero command returned useful output alongside diagnostics | Amber warning with output preserved |
| `error` | Tool/provider execution genuinely failed | Red status and diagnostic expanded |
| `declined` | Approval or input request was declined by the local alpha | Low-emphasis declined state |

Codex's local shell wrapper can exit with code 0 while emitting the underlying status as `__RG_EXIT_CODE__=<n>`. The API consumes that marker for classification and removes it from browser-visible terminal output.

For the local live process, the first run calls `thread/start` once and every accepted follow-up calls `turn/start` with the same `threadId`. Threads default to durable. API state and ordered events are stored locally; restarting the API terminalizes unfinished runs with `RUNTIME_RESTARTED`, preserving their output. An explicit follow-up resumes the saved Codex thread with `thread/resume`. The system does not silently repeat interrupted commands.

### Research output events

`plan` has top-level `steps: [{step, status}]`, optional `explanation`, and optional `provenance: "provider" | "tool"`. Status is exactly `pending`, `in_progress`, or `completed`. The API declares a non-executing dynamic tool named `openrigor_update_plan` on newly created Codex threads, receives its `item/tool/call` server requests, validates arguments, persists the event, and returns `{success, contentItems}`. Native plan notifications remain supported. Identical updates are omitted. A completed run does not automatically mark its plan complete, and prose or generic Markdown checkboxes never become plan events. Tool declarations persist with new Codex threads; older threads created without the tool cannot gain it through a turn request.

`source` contains `source: {sourceId, url, title, origin: "web-search", kind?, snippet?, toolCallId?, query?}`. `kind` distinguishes `search-result` metadata from a `page-request` attempt. Neither means the paper was read, its claims were verified, or the page request succeeded. Only known structured provider result containers and page actions produce these events; a query alone, shell output, or a Markdown link in the answer does not. Unsafe URL schemes, private literal hosts, userinfo and credential query strings are omitted. Consumers should use neutral wording such as “Search links” and identify page requests as attempts.

`file` retains its original required metadata and adds optional `path`, `sha256`, `sizeBytes`, `downloadUrl`, `contentUrl`, and `previewUrl`. A run takes a baseline before executing, then checks for new or changed files under `artifacts/`, `output/`, `reports/`, `results/`, and `figures/`; explicit model file links and provider file-change paths are separately validated. There is no whole-workspace scan. All exposed files must be regular files within the configured workspace and pass its private-path guard; symbolic links are rejected. Discovery is limited to depth 5, 800 entries per pass, 16,000 entries per run, 60 captured revisions, 20 MiB per file and 80 MiB per run. Unchanged output files are not read or republished. Cancelled and terminal runs do not discover new files.

Captured bytes are saved as immutable local copies before the `file` event is persisted. A stable per-path `fileId`, incrementing `revision`, and SHA-256 identify each version. Restart and SSE replay return the same metadata and bytes even when the original workspace file changes. Downloads verify the saved hash. Only files registered by that run can be fetched:

- `GET /api/runs/:runId/files/:fileId?revision=N` downloads the immutable bytes as an attachment.
- `GET /api/runs/:runId/files/:fileId/content?revision=N` returns JSON `{name,path,mimeType,sizeBytes,content,truncated}` for UTF-8 text, capped at 256 KiB.
- `GET /api/runs/:runId/files/:fileId/preview?revision=N` permits only signature-checked PNG, JPEG, WebP, GIF or PDF and sends sandbox CSP plus `nosniff`.

HTML and SVG receive no inline server preview URL. They can be downloaded or read as JSON source; clients must not insert untrusted markup into the application DOM. Existing `/api/files/content` and attachment-only `/api/files/download` remain available for guarded workspace browsing, independent of immutable run artifacts.
