# OpenRigor local API

The local API provides a single-user workspace and translates the signed-in Codex app-server into the versioned OpenRigor run protocol. It binds to `127.0.0.1`, rejects unknown Host and browser Origin headers, and keeps provider credentials on the server.

## Run and workspace endpoints

| Endpoint | Behavior |
| --- | --- |
| `GET /healthz` | Process health and selected executor |
| `GET /api/workspace` | Profile, settings, runtime, projects, skills, knowledge, images, and conversation navigation |
| `GET /api/runtime` | Local executor, sandbox, workspace, persistence, and image configuration status |
| `GET /api/models` | Actual local Codex model catalog, always including `auto` |
| `POST /api/runs` | Start a turn; supports additive `projectId`, `skillIds`, `knowledgeIds`, and `contextPaths` metadata |
| `GET /api/runs/:runId` | Snapshot, persisted events, and complete ordered conversation chain |
| `GET /api/runs/:runId/events` | SSE replay from `Last-Event-ID` and live events |
| `GET /api/runs/:runId/files/:fileId?revision=N` | Hash-verified immutable artifact attachment |
| `GET /api/runs/:runId/files/:fileId/content?revision=N` | UTF-8 source as bounded JSON, including Markdown, CSV and SVG |
| `GET /api/runs/:runId/files/:fileId/preview?revision=N` | Signature-checked raster/PDF preview with sandbox CSP; never HTML or SVG execution |
| `POST /api/runs/:runId/cancel` | Stop/interrupt a live turn |
| `GET /api/runs/:runId/requests` | Pending sanitized command/file approvals and clarification questions |
| `POST /api/runs/:runId/requests/:requestId` | Resolve one approval or answer a clarification exactly once |
| `GET /api/conversations` | Searchable history; accepts `q`, `projectId`, and `archived=true` |
| `PATCH /api/conversations/:rootRunId` | Rename, pin, or archive a conversation |
| `GET /api/search?q=…` | Search conversations, projects, knowledge, and skills |
| `GET /api/usage` | Actual terminal token totals, image count, and per-run entries; no fabricated balance |
| `GET/POST /api/projects` | List or create dedicated local project workspaces |
| `GET/PATCH/DELETE /api/projects/:id` | Inspect, edit, or archive a project while retaining its files |
| `GET/POST /api/skills` | Built-in workflow catalog plus custom instruction skills |
| `POST/DELETE /api/skills/:id/install` | Enable/disable a workflow |
| `GET/POST /api/knowledge` | List or create knowledge notes |
| `PATCH/DELETE /api/knowledge/:id` | Edit/archive knowledge notes |
| `GET/PATCH /api/settings` | Appearance and agent persona/instructions/default preferences |
| `GET/PATCH /api/profile` | Local display profile |
| `POST /api/attachments` | Save a base64 attachment of up to 10 MB for local Codex context |
| `GET /api/files?path=…` | List visible workspace files; optional `projectId` selects that project's directory |
| `GET /api/files/content?path=…` | Bounded plain-text preview, never HTML execution |
| `GET /api/files/download?path=…` | Attachment download; hidden credentials and escaping paths are blocked |
| `GET /api/images` | Generated image gallery and configuration status |
| `POST /api/images/generations` | Generate an image, or edit an existing image with `referenceImageId` |
| `GET /api/images/:id/file` | Serve a generated image |
| `DELETE /api/images/:id` | Archive gallery metadata, preserving original bytes |

## Local execution and storage

`pnpm dev:codex` from the repository root selects the real Codex executor and starts the web and API services. `pnpm dev:api` alone selects the deterministic demo unless `OPENRIGOR_EXECUTOR=codex-app-server` is set. The demo visibly identifies its output and does not execute prompts.

`OPENRIGOR_CODEX_CWD` selects the trusted local workspace; its default is the repository root. Project workspaces are created beneath `.openrigor/projects/<id>/workspace`. A project run uses that directory, and a conversation cannot switch project directories during continuation. Accepted runs, run detail, and public snapshots always include authoritative `projectId: string | null`; `null` identifies a standalone conversation even when the browser currently selects another project. Global instructions, project instructions, selected installed workflows, selected knowledge, and project knowledge are included in the server-side context.

`OPENRIGOR_DATA_DIR` overrides the default `.openrigor` data directory. One API process owns a data directory, guarded by a PID lock that can recover after a crash. Workspace metadata uses atomic document replacements. Run events use append-only, fsynced journals; metadata and idempotency fingerprints are persisted before event delivery. A crash-truncated final journal append is repaired; interior corruption stops recovery rather than silently discarding history.

On restart, saved snapshots, event sequences, conversation chains, navigation metadata, and request idempotency are rebuilt. An unfinished turn is explicitly finalized with `RUNTIME_RESTARTED`, preserving saved output. The operator can then submit a follow-up. Restarting does **not** silently rerun tools or pretend an interrupted process is still executing.

Codex threads are durable by default (`OPENRIGOR_CODEX_EPHEMERAL=false`). A turn in the same process reuses its live thread. A cold follow-up calls `thread/resume` before `turn/start`. Setting the ephemeral flag to `true` explicitly opts out of Codex history recovery; OpenRigor event replay still survives, but a missing provider thread can fail continuation.

Uploaded attachments use the existing protocol `attachments: [{fileId, name, mimeType?, sizeBytes?}]`. The server validates every ID against its upload registry and uses canonical uploaded metadata, ignoring forged display metadata. References and local paths are persisted server-side. For project runs, attached originals are copied into that project’s `attachments/` directory so the configured sandbox can read them. File-change events add a download URL only after the path passes the same workspace/credential boundary as the file browser.

Explicit document context uses optional `contextPaths: string[]`, with up to 10 relative visible text files and 128 KB of combined content. Paths resolve in the selected project first, then the repository workspace when the project file is absent. Hidden credentials, traversal, escaping symlinks, absolute paths, and binary files are rejected. The raw user prompt stays clean in history; selected paths and their server-resolved content are persisted and included in request idempotency.

The existing model and reasoning fields remain protocol-compatible. The UI should use the actual `/api/models` catalog or `auto` rather than assuming a legacy model alias is available to the signed-in account. The legacy TokenResearch route retains its explicit local coordinator guidance; it does not claim a provider scheduler was called.

New Codex threads declare `openrigor_update_plan`, a non-executing dynamic tool that validates and publishes actual plan steps. Native plan notifications are also accepted. Plans are persisted and replayed without marking unfinished steps complete merely because a run ended. This uses the installed CLI's experimental `thread/start.dynamicTools` and `item/tool/call` contract, verified against `codex-cli 0.163.0-alpha.11` and [the official app-server documentation](https://developers.openai.com/codex/app-server). Existing threads created without the tool retain their original tool set.

Structured provider web-search results and page actions produce source events. A source with `kind: "page-request"` records an attempt, including attempts that may fail; `search-result` represents returned search metadata. Neither is a verification claim. Answer links and bare queries do not become source evidence. Web/browser availability remains dependent on the signed-in provider runtime; this API does not claim to grant a browser session or perform independent search.

Artifact discovery takes a pre-run baseline, then checks new or modified files under `artifacts/`, `output/`, `reports/`, `results/`, and `figures/`, plus explicitly linked model files and provider file-change paths. Only validated regular workspace files are captured; all symbolic links and private paths are omitted. The scanner has per-pass, per-run, depth, count and size limits described in `docs/PROTOCOL.md`. Each registered revision is stored as immutable bytes and rechecked against its SHA-256 on retrieval. Use separate project directories for concurrent tasks to attribute generated outputs reliably. The API never executes generated HTML in the application origin.

## Image provider

The image endpoint follows the project instructions: `https://ciyuanzhiyan.com/v1`, default `gpt-image-2.5-sunburst`, size `1k`, quality `high`. The key comes only from `CIYUANZHIYAN_API_KEY` or the repository-local ignored `.env.imagegen.local`. Configuration status exposes a boolean, never the key. Generation uses JSON; editing an existing local gallery image uses the standard multipart `/images/edits` request. Provider errors are sanitized.

The original returned bytes are saved under ignored `output/imagegen/` before adding gallery metadata. Local image references never accept arbitrary server filesystem paths. URL-returning providers must use public HTTPS destinations; redirects and private network addresses are rejected. Only PNG, JPEG, and WebP originals are served.

## Limits

This is a trusted, local single-operator runtime. It does not implement cloud hosts, multi-tenant accounts, payment processing, remote SSH, or a production sandbox worker. Workflow installation enables instruction profiles; it does not install third-party software. Modern command/file approvals and user clarification requests are interactive through the request endpoints; the run emits `waiting_user` while waiting. Responses permit one-action `accept` or `decline`, or a question-answer map. Duplicate responses return `409`, and cancellation/terminal completion declines unresolved requests. Provider RPC identifiers and raw parameters stay server-side. Unknown requests, MCP elicitation, and permission-expansion requests retain the conservative decline behavior. Production exposure still requires the worker, identity, tenant authorization, and sandbox controls in `docs/ARCHITECTURE.md` and `docs/SECURITY.md`.
