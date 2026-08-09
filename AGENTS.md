# OpenRigor agent instructions

## Mission

Implement an original, clean-room persistent AI-agent workspace. Public behavior may be used as a requirement; do not copy third-party source, brand assets, screenshots, distinctive copy, or protected visual expression.

## Current milestone

M1 in `docs/ROADMAP.md`: durable single-tenant alpha. Keep `packages/protocol` backward-compatible while replacing in-memory execution with PostgreSQL, an outbox/queue, and a worker.

## Engineering rules

- Read `docs/ARCHITECTURE.md`, `docs/PROTOCOL.md`, and `docs/SECURITY.md` before changing runtime boundaries.
- A run must survive browser/API/worker restarts and be recoverable from ordered persisted events.
- Treat delivery as at least once; make state transitions, event writes, tool calls, and usage settlement idempotent.
- Never execute untrusted commands in the API process. Docker alone is not the production security boundary.
- Never send provider keys, session cookies, or sandbox credentials through `RunEvent` payloads.
- Add tests for protocol changes, replay, authorization, cancellation, retries, or credit accounting.
- Preserve unrelated user changes and avoid generated artifacts in Git.

## Verification

```powershell
pnpm typecheck
pnpm test
pnpm build
```
