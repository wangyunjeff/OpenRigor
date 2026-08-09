# Contributing to OpenRigor

## Development loop

```powershell
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

Keep changes narrow and explain protocol or security decisions in the relevant document. New run events require a type, a compatibility note in `docs/PROTOCOL.md`, and a consumer test.

## Pull requests

- State the user-visible behavior and the failure mode covered.
- Include tests for state transitions, replay, authorization, or accounting when touched.
- Do not add secrets, captured customer data, proprietary screenshots, or copied third-party source.
- Mark unverified product assumptions as assumptions in documentation.

## Commit style

Use a short imperative subject, for example `Add durable event replay contract`.
