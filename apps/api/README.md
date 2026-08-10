# OpenRigor API

The API app is a deliberately small reference transport. It implements the protocol without a framework so the state machine and failure behavior remain visible during the first build phase.

## Endpoints

- `GET /healthz`
- `POST /api/runs`
- `GET /api/runs/:runId`
- `GET /api/runs/:runId/events` (SSE, replayable)
- `POST /api/runs/:runId/cancel`

## Executors

The default `demo` executor emits deterministic events and never executes the prompt.

For the single-user local alpha, the API can launch the signed-in local Codex CLI as an app-server and translate its JSONL event stream to OpenRigor `RunEvent` objects:

```powershell
$env:OPENRIGOR_EXECUTOR = "codex-app-server"
$env:OPENRIGOR_CODEX_CWD = (Get-Location).Path
$env:OPENRIGOR_CODEX_SANDBOX = "workspace-write"
$env:OPENRIGOR_CODEX_APPROVAL_POLICY = "never"
pnpm dev:api
```

Prerequisites:

- `codex --version` and `codex app-server --help` must work in the same shell.
- Codex must already be authenticated locally. Browser code never receives the auth cache or provider key.
- `OPENRIGOR_CODEX_CWD` is the only workspace used by the current alpha. A request cannot choose an arbitrary host path.
- The default sandbox is `workspace-write`. Use `read-only` when the task should only inspect files.
- Interactive approval responses are not implemented yet. The default `never` policy lets sandbox-allowed work proceed, while unexpected app-server approval/input requests are declined instead of hanging.

Optional settings are documented in the repository `.env.example`. The app-server process is shared. A root HTTP run starts one Codex thread; a follow-up `POST /api/runs` with `continueFromRunId` creates a separate OpenRigor run but sends another `turn/start` to that same live Codex thread. Cancellation is forwarded through `turn/interrupt` for the active run.

Follow-ups are accepted only from the latest terminal run in a conversation, and only one run per conversation may be active. `GET /api/runs/:runId` keeps the original `{ snapshot, events }` fields and adds an ordered `conversation.runs` chain for full UI restoration. The accepted response and snapshots expose `conversationId`, `rootRunId`, and (for follow-ups) `parentRunId`.

The default `OPENRIGOR_CODEX_EPHEMERAL=true` is intentionally live-process only. Both the OpenRigor run index and ephemeral Codex history disappear on API/app-server restart. Set the flag to `false` only when local Codex rollout files are desired; cold `thread/resume` recovery and durable OpenRigor metadata are still not implemented.

The adapter keeps the public protocol stable: agent message deltas become `part-delta` events under `answer`, reasoning deltas become `reasoning` parts, command/MCP/search/file items become `tool` events, file changes emit `file` metadata, token notifications are attached to `run-finished.usage`, and `turn/completed` becomes the terminal `run-finished` event.

This local integration is not the production worker boundary described in `docs/ARCHITECTURE.md`. A hosted release still requires an isolated worker, durable event persistence, authorization, quotas, and the controls in `docs/SECURITY.md`.
