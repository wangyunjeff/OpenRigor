# OpenRigor Design System

**Product:** Local AI-agent workspace  
**Direction:** Precise operator console with a calm reading surface  
**Updated:** 2026-08-10

## Product Principles

1. The task, current state, and next action must be visible without interpretation.
2. Agent replies are a reading surface, not chat bubbles.
3. Reasoning, tools, files, and diffs are structured activity, not plain text logs.
4. Color communicates selection or status; decoration stays neutral.
5. The layout must remain stable while streamed content grows.

## Component Stack

| Layer | Choice |
|---|---|
| Interaction primitives | Radix UI |
| AI presentation model | AI Elements-style Conversation, Reasoning, Tool, Terminal, Artifact |
| Icons | Lucide React |
| Markdown | React Markdown + remark-gfm |
| Styling | OpenRigor CSS tokens |

Keep OpenRigor `RunEvent` and SSE as the state source. Do not introduce a second chat runtime merely to adopt presentation components.

## Color Tokens

| Role | Token | Value |
|---|---|---|
| App background | `--bg` | `#0d0e12` |
| Sidebar | `--sidebar` | `#111219` |
| Surface | `--surface` | `#171922` |
| Raised surface | `--surface-raised` | `#1d202b` |
| Border | `--line` | `rgba(236, 232, 255, 0.105)` |
| Primary text | `--text` | `#f5f3f0` |
| Muted text | `--muted` | `#9b9da8` |
| Primary accent | `--accent` | `#b9a7ff` |
| Informational | `--blue` | `#8ab5ff` |
| Success | `--green` | `#86d5b0` |
| Waiting | `--gold` | `#ebc778` |
| Error | `--danger` | `#ec9298` |

No dominant gradients, decorative glow fields, or ornamental blobs. Lilac is reserved for selection and primary action. Blue, green, gold, and red are semantic.

## Type

- UI and prose: Inter, Noto Sans SC, Microsoft YaHei, system sans-serif.
- Code and identifiers: JetBrains Mono, Consolas, monospace.
- Conversation prose: 15px desktop, 14px mobile, line-height 1.75-1.85.
- Tool activity: 10-12px.
- Compact panel headings: 11-13px.
- True page title only: 35px mobile, 48px desktop.
- Letter spacing is always `0`.

## Geometry

- Sidebar: 236px desktop; off-canvas mobile.
- Header: 70px desktop, 62px mobile.
- Primary content: 860px maximum reading column.
- Inspector: 292px; hidden below 1120px.
- Repeated item radius: 8-11px.
- Composer radius: 13px desktop, 12px mobile.
- Icon buttons: stable 30-38px square targets.

## Interaction Rules

- Use Radix primitives for menus, collapsibles, tooltips, dialogs, and sheets.
- Icon-only active controls require an accessible label and tooltip.
- Current reasoning may open automatically; completed reasoning may collapse.
- Current tools remain visible; output expands on demand.
- The composer remains in normal layout and never uses viewport-coordinate calculations.
- Keyboard focus must be visible. Respect `prefers-reduced-motion`.

## Message Rules

- User message: visually separated, concise, no oversized bubble.
- Agent message: unframed prose with an identity/status header.
- Reasoning: one collapsible block with current-step context.
- Tools: compact vertical activity timeline with phase status.
- Terminal output: monospace, scrollable, dark isolated surface.
- Files and diffs: separate artifact rows with explicit state and revision.
- Final answer: GFM Markdown supporting headings, lists, tables, links, quotes, and code.

## Responsive Checks

Verify at 390x844, 768x1024, 1024x768, and 1440x1000:

- no horizontal page scrolling;
- menus stay inside the viewport and do not overlap their trigger on pointer-up;
- composer never covers inaccessible content;
- long paths and tool inputs truncate without resizing the layout;
- sidebar opens as a sheet with a scrim on mobile;
- no text or status badge overlaps neighboring content.
