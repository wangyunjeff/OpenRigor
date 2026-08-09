# OpenRigor

OpenRigor is a clean-room, open-source implementation of a persistent AI-agent workspace: a chat-first product that can plan work, run tools in an isolated workspace, stream progress, survive disconnects, and return inspectable files.

[![CI](https://github.com/wangyunjeff/OpenRigor/actions/workflows/ci.yml/badge.svg)](https://github.com/wangyunjeff/OpenRigor/actions/workflows/ci.yml) · [Technical report](docs/TECHNICAL_REPORT.md) · [Roadmap](docs/ROADMAP.md)

This repository is the implementation workspace created from the ClawsGO public-product research snapshot. It does not copy ClawsGO code, branding, screenshots, text, or protected visual assets. The goal is behavioral and architectural equivalence where the behavior is publicly observable.

## Current status

- Research baseline: complete. Read [the full technical report](docs/TECHNICAL_REPORT.md).
- Implementation baseline: Phase 0 skeleton.
- Working slice: local API + SSE run events + browser console + deterministic demo executor.
- Production execution: intentionally not enabled yet. The sandbox boundary must be designed and tested before accepting untrusted work.

## Start the local slice

Prerequisite: Node.js 20+ and pnpm 9+.

```powershell
corepack enable
pnpm install
pnpm dev:api
```

In another terminal:

```powershell
pnpm dev:web
```

Open <http://localhost:5173>. The web console submits a run to `http://localhost:8787`, subscribes to its SSE stream, and renders text, tool, status, and completion events.

Useful checks:

```powershell
pnpm typecheck
pnpm test
pnpm build
```

## Repository map

```text
apps/web          Vite + React operator console
apps/api          HTTP API, SSE transport, in-memory demo runner
packages/protocol Shared RunRequest/RunEvent contract
infra             Local service dependencies and deployment notes
docs              Research, architecture, protocol, security, roadmap
```

## The first real milestone

Replace the demo executor with a durable queue and a sandbox provider while preserving the public protocol:

1. PostgreSQL for users, workspaces, runs, events, files, and usage ledger.
2. Redis Streams (or NATS JetStream) for dispatch and fan-out.
3. A worker process with idempotent event writes and retry policy.
4. A sandbox provider (gVisor/Kubernetes or Firecracker) with explicit tool capabilities.
5. Object storage for artifacts and signed download URLs.

The implementation order and acceptance criteria are in [docs/ROADMAP.md](docs/ROADMAP.md). The system boundary is documented in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), and the wire contract is in [docs/PROTOCOL.md](docs/PROTOCOL.md).

## Clean-room and licensing boundary

OpenRigor is an independent implementation. Use public behavior and public documentation as requirements, write original code and original copy, and obtain separate licenses for model APIs, fonts, icons, media, and any third-party UI source. See [docs/SECURITY.md](docs/SECURITY.md) for the security boundary and [CONTRIBUTING.md](CONTRIBUTING.md) for contribution rules.

## License

Apache-2.0. See [LICENSE](LICENSE).
