# OpenRigor Roadmap

The roadmap is intentionally ordered around the highest-risk invariant: a long-running run must be recoverable and auditable without trusting the browser.

## Delivered local edition (2026-10-21)

The single-operator local edition now has fsynced disk event journals, restart-safe history and idempotency, Codex thread resume, interactive approvals/questions, project directories and instructions, knowledge, skills, attachments, guarded file downloads, image generation/editing, searchable task management, and actual token usage. Browser-persisted follow-ups dispatch while the browser remains open. Interrupted provider turns are explicitly finalized and can be continued; tools are never blindly replayed after a restart.

See [the current implementation](LOCAL_WORKSPACE.md). These local capabilities do not claim that the distributed infrastructure below is complete. Cloud hosts are outside the current product scope.

## M0 — research and protocol (complete)

- [x] Public product and frontend/runtime investigation snapshot.
- [x] AICSS relationship assessment.
- [x] Clean-room boundary and legal/security notes.
- [x] Shared `RunRequest` and `RunEvent` types.
- [x] Local API/SSE demo and browser console.

Acceptance: a new contributor can install dependencies, submit a local run, observe typed events, cancel it, and reconnect to the event stream.

## M1 — distributed single-tenant runtime (future hosted work)

- [ ] PostgreSQL schema and migrations for runs/events/artifacts.
- [ ] Transactional outbox plus queue worker.
- [ ] Event replay from `Last-Event-ID` with bounded retention.
- [ ] Basic session authentication and workspace ownership.
- [ ] Provider adapter interface with one configurable model provider.
- [ ] Usage ledger with idempotent settlement.

Exit criteria: restart API and worker independently without losing a run; a reconnecting client receives the same ordered event log; usage can be reconciled from provider request IDs.

## M2 — isolated execution and artifacts

- [ ] Sandbox provider interface and local fake implementation.
- [ ] gVisor/Kubernetes proof of isolation with resource and egress limits.
- [ ] Shell, file, browser, and search tools behind policy checks.
- [ ] Object storage, content hashing, MIME validation, and signed downloads.
- [ ] Markdown/code/PDF preview in a separate origin.

Exit criteria: adversarial tool tests cannot read control-plane secrets or escape the workspace; a completed run returns a downloadable artifact with an audit trail.

## M3 — product workflows

- [ ] Durable goals, todos, approvals, queued follow-up messages, stop/continue.
- [ ] Durable multi-model routing and organization-level effort policy (the local alpha already exposes Sol/Terra/Luna and native effort selection).
- [ ] Hosted Ultra/subagent execution with durable parent-child trace IDs (the local alpha can request Codex Ultra but does not yet own its cloud worker lifecycle).
- [ ] Searchable conversation history and read-only share links.
- [ ] Notifications and offline/resume UX.

Exit criteria: a 30-minute run survives browser closure and network loss, and the replay view reconstructs the same user-visible timeline.

## M4 — collaboration and commercial controls

- [ ] Organizations, projects, roles, shared workspaces, and quotas.
- [ ] Knowledge base, references, memory and skill packages.
- [ ] Stripe billing adapter, credits packs, refunds and invoices.
- [ ] Region-specific login/payment adapters (only after compliance review).
- [ ] OpenTelemetry dashboards, SLOs, incident runbooks, backup/restore.

Exit criteria: tenant isolation and credit accounting pass an independent review; operators can diagnose TTFT, queue delay, sandbox failures and cost anomalies.

## Deliberately deferred

Proprietary brand assets/copy, unrestricted arbitrary code execution, public multi-tenant deployment, and multi-region active-active remain outside the local edition. Product layout and observed workflows are implemented with original code and artwork. The available model catalog is discovered from the signed-in Codex runtime.
