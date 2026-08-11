# Frontend architecture

OpenRigor keeps runtime truth separate from presentation libraries. `packages/protocol` owns the transport contract, `apps/web/src/conversation.ts` owns replay and event projection, and `apps/web/src/features/chat/ai-elements-adapter.ts` is the narrow translation boundary into AI Elements component states.

## Layers

1. `RunEvent` and conversation state remain OpenRigor-owned and do not depend on the Vercel AI SDK `useChat` state model.
2. Vercel AI Elements and shadcn provide accessible primitives for conversations, messages, reasoning, tools, artifacts, terminals, model selection, and prompt input.
3. Feature components under `apps/web/src/features` bind those primitives to OpenRigor state without changing SSE, continuation, cancellation, TokenResearch, or Ultra semantics.
4. AICSS is a visual and interaction reference. Only source with explicit public-redistribution permission may enter this MIT repository.
5. GSAP timelines are scoped to component refs, animate transforms and opacity, clean up on unmount, and honor `prefers-reduced-motion`.

## Extension rules

- Add a pure adapter and focused test before teaching a UI component about a new event or status.
- Keep server and protocol changes additive; UI-library types must not leak into `packages/protocol`.
- Use AI Elements through the configured `@ai-elements` shadcn registry, then adapt its styling through OpenRigor tokens.
- Keep composer command discovery in `features/composer`; the slash/at palette must expose stable option ids and let the focused textarea publish `aria-activedescendant` while keyboard navigation is active.
- Render conversation flow from the ordered `projectRunEvents().timeline`: provider message boundaries split adjacent reasoning/tool/file/subagent/error activities into collapsible execution groups, so commentary and work remain interleaved. Merge repeated tool lifecycle events by `callId`, keep successful rows collapsed by default, and let only `error`/`declined` outcomes auto-expand. `no-result` and `partial` are status treatments, not run-level failures.
- Do not expose an AI Elements control until its data has a real OpenRigor backend contract. Attachments, approvals, sources, and queued prompts remain hidden until their protocol paths exist.

## Theme boundary

OpenRigor product tokens (`--bg`, `--surface`, `--text`, `--accent`) are distinct from shadcn UI tokens (`--ui-background`, `--ui-muted`, `--ui-accent`). `applyTheme()` synchronizes both `data-theme` and the Tailwind `dark` class so Light, Dark, and System stay consistent.
