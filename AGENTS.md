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
- Build AI-facing UI on Apache-2.0 Vercel AI Elements and shadcn primitives, adapt AICSS as a visual and interaction reference unless its source is explicitly licensed for redistribution, and orchestrate product motion with scoped, reduced-motion-safe GSAP timelines.

## Image asset generation

When this project needs generated images or visual assets, call the user's configured image API directly, unless the user specifies another provider for that task.

- Base URL: `https://ciyuanzhiyan.com/v1`.
- Authentication: `Authorization: Bearer <CIYUANZHIYAN_API_KEY>`. Read the key from the environment, or the project-local `.env.imagegen.local` file if it is not set in the environment. The local file is ignored by Git. Never put the real key in tracked files, command output, logs, browser code, or `RunEvent` payloads.
- New images: `POST https://ciyuanzhiyan.com/v1/images/generations`.
- Image edits: `POST https://ciyuanzhiyan.com/v1/images/edits`, including the source image(s) in the provider-supported request format. Inspect reference images before editing them.
- Default model: `gpt-image-2.5-sunburst`. User-provided alternatives: `gpt-image-2` and `gpt-image-2.5-flare`; use them when requested.
- Default size: `1k`; use `2k` or `4k` when requested.
- Default quality: `high`.
- Write a concrete image prompt based on the current task and the needed asset. For new images, send a JSON body with `model`, `prompt`, `size`, and `quality`, using the defaults above.
- Save the original image to `output/imagegen/` immediately after a successful response. Decode returned base64 image data or download the returned image URL as appropriate, preserving the original bytes and format. Keep the original even if resized or optimized derivatives are needed later.
- Return a link to the saved original and show the image when useful. Keep originals, local credentials, and transient API responses out of Git; follow the existing rule against committing generated artifacts.

Example generation body (replace the prompt with the actual asset description):

```json
{
  "model": "gpt-image-2.5-sunburst",
  "prompt": "Describe the image needed for the current task",
  "size": "1k",
  "quality": "high"
}
```

## Verification

```powershell
pnpm typecheck
pnpm test
pnpm build
```
