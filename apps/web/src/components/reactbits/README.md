# React Bits components

These files are copied from [React Bits](https://reactbits.dev) (TypeScript + Tailwind
flavour) with the shadcn CLI, the same way `components/ai-elements` is vendored:

```sh
pnpm exec shadcn add @react-bits/<Name>-TS-TW --path src/components/reactbits
```

The `@react-bits` registry is declared in `apps/web/components.json`.

## Licence

React Bits is **MIT + Commons Clause** (see `LICENSE.md` in this folder), not plain MIT like
the rest of OpenRigor. The components may ship as part of this application. They may not be
sold, sublicensed, or redistributed on their own or as a component library.

## Local changes

Keep these files close to upstream so they can be refreshed with the CLI.

- `SplitText`, `AnimatedContent`, `ShinyText`, `CountUp`: a few lines adjusted so they compile
  under this repo's `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`. Behaviour is
  unchanged.
- `DotGrid`: source untouched; the file opts out of type-checking (`@ts-nocheck`) because its
  WebGL typed-array maths trips `noUncheckedIndexedAccess` on every index.
- `SpotlightCard`: classes are merged with `cn()` so callers can override its default
  radius and padding.

After re-running the CLI, check that `motion` in `package.json` was not downgraded: the
registry pins an older major than this app uses.

## Where they are used

OpenRigor code does not import these files directly. `src/features/motion` wraps them with
the app's theme tokens, scroll container, and reduced-motion policy.
