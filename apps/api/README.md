# OpenRigor API

The API app is a deliberately small reference transport. It implements the protocol without a framework so the state machine and failure behavior remain visible during the first build phase.

## Endpoints

- `GET /healthz`
- `POST /api/runs`
- `GET /api/runs/:runId`
- `GET /api/runs/:runId/events` (SSE, replayable)
- `POST /api/runs/:runId/cancel`

The current executor emits deterministic events and never executes the prompt. Replace `executeDemoRun` with a queue-backed worker only after the sandbox contract in `docs/SECURITY.md` has tests.
