# OpenRigor

OpenRigor is a local AI-agent workspace with a chat-first interface, real Codex execution, image generation, projects, reusable skills, knowledge, and inspectable files.

[![CI](https://github.com/wangyunjeff/OpenRigor/actions/workflows/ci.yml/badge.svg)](https://github.com/wangyunjeff/OpenRigor/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE) · [Local implementation](docs/LOCAL_WORKSPACE.md) · [API](apps/api/README.md) · [Architecture](docs/ARCHITECTURE.md)

The interface follows the observed ClawsGO product's navigation, dark workspace, research cards, contextual composer, image studio, skill catalog, project dialogs, and settings layout. OpenRigor uses its own code, identity, wording, and generated artwork. The research documents in `docs/` preserve the earlier investigation; the current implementation is described below.

## Run locally

Prerequisites: Node.js **22.22.2+ on the 22.x line, 24.15.0+ on the 24.x line, or 26+**, pnpm 9.15.5, a working `codex` CLI, and an existing local Codex login or configured provider. These Node ranges cover the locked application and test dependencies, including PDF.js and jsdom; Node 20 is no longer supported by this dependency set.

```sh
pnpm install
codex --version
codex login status
pnpm dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173). `pnpm dev` and `pnpm dev:codex` start the web UI and the loopback API together. The API uses the local Codex app-server; credentials stay on the server.

The default execution directory is this repository, with `workspace-write` sandboxing and `on-request` approvals. To use another trusted local directory:

```sh
OPENRIGOR_CODEX_CWD=/absolute/path/to/workspace pnpm dev
```

For inspection-only execution, set `OPENRIGOR_CODEX_SANDBOX=read-only`. Configuration examples are in [.env.example](.env.example). Shell environment variables configure the runtime; the API also reads the ignored `.env.imagegen.local` specifically for the image API key.

For a deterministic demonstration without Codex, run `pnpm dev:api` and `pnpm dev:web` separately. Demo responses identify themselves and do not execute tasks.

## Implemented workflows

- **Chat and execution:** real model discovery, reasoning and mode controls, ordered streamed answers and tool output, stop/interrupt, same-thread follow-ups, interactive command/file approvals, and clarification answers.
- **History:** server-persisted conversations, search, rename, pin, archive, JSON export, deep links, complete event replay, and continuation after an API restart.
- **Queued messages:** up to 32 browser-persisted follow-ups per conversation. Messages dispatch in order after the preceding turn finishes; a failure remains visible for retry.
- **Projects:** dedicated directories, descriptions, instructions, tasks, knowledge notes, and file browsing. A conversation stays in its original directory.
- **Skills:** searchable categories, install/uninstall, custom instruction workflows, and selection from the composer. Installing a skill enables an instruction profile.
- **Files and task overview:** validated attachment uploads, a shared viewer for generated artifacts and project files, Markdown with math/diagrams/tables, CSV/TSV, static HTML, images/SVG, PDF pages, text/source, and original downloads. The viewer also shows the latest turn's recorded plan, files, sources, subagent states, and token usage. Project attachments are made available inside that project's sandbox.
- **Web reading:** answer and source links open a public-page text reader beside the conversation, with a sandboxed website view and an original-site link. Retrieval can fail for login, subscription, verification, or JavaScript-dependent pages; it does not change the agent's recorded source verification.
- **Image studio:** prompt/model/size controls, server-side generation and reference-image editing, original-file downloads, prompt reuse, and gallery archiving. Original bytes are preserved in `output/imagegen/`.
- **Preferences:** local profile, light/dark/system appearance, agent persona/instructions/default model, runtime capabilities, and actual reported token usage.
- **Home:** research starters, guides, and handoff into existing local projects and conversations. Starter cards create editable prompts.

Image generation uses the provider configured in `AGENTS.md`. Set `CIYUANZHIYAN_API_KEY` in the server environment, or store it in the ignored `.env.imagegen.local`. The browser receives configuration status, never the key.

## Persistence and operating boundary

The default `.openrigor/` directory contains atomic workspace metadata, run metadata, fsynced append-only event journals, attachments, and project directories. A PID lock prevents two API processes from owning the same store. Restart recovery restores saved event order, idempotency keys, and conversation chains. An interrupted turn is explicitly finalized with `RUNTIME_RESTARTED`; a follow-up can resume its Codex thread. Tools are not automatically repeated after a crash.

This edition runs for one trusted local operator. Cloud host provisioning is outside its scope. Hosted accounts, team permissions, subscription checkout, remote SSH management, and a production isolated worker are not implemented. The UI reports real local usage without inventing a provider balance. Codex's configured tools and sandbox determine execution capabilities; workflow cards do not install external applications.

Do not expose this API publicly as a multi-user service. The production worker, identity, tenant authorization, and sandbox boundary remain described in [the architecture](docs/ARCHITECTURE.md) and [security notes](docs/SECURITY.md).

## Verification

```sh
pnpm typecheck
pnpm test
pnpm build
```

Real-provider smoke check (two turns, same conversation):

```sh
OPENRIGOR_SMOKE_MODEL=gpt-6-luna pnpm smoke:codex
```

Omit the variable to use the configured Codex default. Availability and response time depend on the configured provider. The deterministic API smoke check is `pnpm smoke:api` with a demo API running.

## Repository map

```text
apps/web          Vite + React workspace and product panels
apps/api          Loopback HTTP/SSE API, durable local store, Codex adapter
packages/protocol Shared backward-compatible RunRequest/RunEvent contract
scripts           Development launcher and real/demo smoke checks
docs              Current local implementation plus research and architecture
infra             Future hosted-service dependencies and notes
```

MIT. See [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Runtime provider APIs and third-party components retain their own terms and licenses.
