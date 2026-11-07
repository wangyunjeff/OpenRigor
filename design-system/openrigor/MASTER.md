# OpenRigor Desktop Design System

**Product:** Single-user local AI-agent workspace

**Milestone:** Desktop-first alpha

**Direction:** Quiet operator console with a premium reading surface

**Updated:** 2026-11-06

## Scope And Clean-Room Rule

OpenRigor targets behavioral equivalence with a capable long-running Agent workspace. Public product behavior may inform requirements, but implementation must remain original:

- Do not copy ClawsGO source, brand assets, screenshots, distinctive copy, class names, or protected visual expression.
- Reproduce useful workflows and information hierarchy, not another product's pixel identity.
- Vercel AI Elements and prompt-kit are reference libraries for component boundaries and interaction research only.
- The repository's own `RunEvent` and SSE projection remain the source of truth. A presentation library must not introduce a second chat runtime.

## Product Principles

1. The task, current state, and next action are visible without interpretation.
2. Agent replies are a reading surface, not a stack of decorative cards.
3. Reasoning, tools, files, and diffs are structured activity, not raw text logs.
4. Color communicates selection or status; hierarchy comes from spacing, type, and material contrast.
5. Streamed content must not resize the navigation, Composer, controls, or activity rows.
6. Potentially costly actions require an explicit user commit. Selecting an example never starts a run.
7. Desktop quality is the current priority. Mobile remains usable but must not dictate the desktop composition.

## Component Stack

| Layer | Current choice | Responsibility |
|---|---|---|
| Interaction primitives | Radix UI | Dropdown Menu, Dialog, Collapsible, Tooltip, focus management, Portal positioning |
| Icons | Lucide React | Navigation, actions, tools, status, and artifacts |
| Markdown | React Markdown + remark-gfm | Agent headings, lists, tables, links, quotes, and code |
| AI presentation | OpenRigor local components | Project `RunEvent` into conversation, reasoning, tool, file, diff, and completion views |
| Visual system | OpenRigor CSS tokens | Color, geometry, typography, motion, and responsive behavior |
| Design references only | Vercel AI Elements, prompt-kit | Study Conversation, Tool, Artifact, Composer, and streaming boundaries |

Do not install AI Elements or prompt-kit wholesale. Do not adopt AI SDK `useChat`, assistant-ui runtime, or another external thread store while `RunEvent` is the authoritative state model.

## Desktop Frame

```text
┌──────── 248px navigation ────────┬──────────────── flexible task area ────────────────┐
│ Brand (goes home)                │ 56px header: task or page title · Files · theme    │
│ New task                         ├────────────────────────────────────────────────────┤
│ Search            ⌘K             │  Home: greeting → composer → Continue → workflows  │
│ Image Studio                     │  Task: 768px reading column (work log + response)  │
│ Skill Market                     │  Page: one header, content below                   │
│ Projects  [+]                    │                                                    │
│ Standalone tasks                 ├────────────────────────────────────────────────────┤
│ Profile → agent, workspace,      │ 768px composer (task view; home places it inline)  │
│   settings, guides, appearance   │                                                    │
└──────────────────────────────────┴────────────────────────────────────────────────────┘
```

- Navigation lists destinations only. Settings dialogs (agent, workspace, settings) and guides live in the profile menu; they are not navigation peers of pages.
- Home is composer-first: the greeting states what OpenRigor does, the composer follows immediately, then recent work ("Continue") and research workflow starting points. Choosing a starting point fills the composer; it never starts a run.
- Inline pages (Image Studio, Skill Market, Projects, Research workflows, Guides) show their title, and Back where it applies, in the app header. They do not render a second page bar.
- The composer toolbar holds every per-task choice: attachments, model and reasoning, and (for new tasks) the project. A follow-up keeps its conversation's project.
- The header "Files" control opens the viewer for this task's files, sources, and pages. "Workspace" names only the workspace settings.
- On the task view the reading column and composer share one width; the scroll area spans the canvas.
- At widths above `900px`, the sidebar is always present. At `900px` and below it becomes an off-canvas sheet.

## Color Tokens

| Role | Token | Current value |
|---|---|---|
| App background | `--bg` | `#1d1d1d` |
| Sidebar | `--sidebar` | `#1a1a1a` |
| Surface | `--surface` | `#252525` |
| Raised surface | `--surface-raised` | `#2d2d2d` |
| Soft surface | `--surface-soft` | `#202020` |
| Border | `--line` | `rgba(255, 255, 255, 0.105)` |
| Strong border | `--line-strong` | `rgba(255, 255, 255, 0.18)` |
| Primary text | `--text` | `#f5f3ef` |
| Secondary text | `--text-soft` | `#e3e0db` |
| Muted text | `--muted` | `#aaa7a1` |
| Faint metadata | `--faint` | `#7b7872` |
| Accent | `--accent` | `#e4a274` |
| Strong accent | `--accent-strong` | `#efb589` |
| Accent ink | `--accent-ink` | `#2b1b12` |
| Informational | `--blue` | `#8eb6d9` |
| Success | `--green` | `#88c9a4` |
| Waiting/running | `--gold` | `#e2c07d` |
| Error/cancel | `--danger` | `#e69595` |

The premium character comes from restrained contrast, consistent density, and a legible reading surface. Do not add gradient fields, neon glows, decorative blobs, glass cards, or a dominant single-hue palette. Warm copper is reserved for selection, focus, and product identity; semantic state colors retain their own meaning.

## Typography

- UI and prose: `Inter`, `Noto Sans SC`, `Microsoft YaHei`, system sans-serif.
- Code, ids, progress, and paths: `JetBrains Mono`, `Consolas`, monospace.
- New-task title: `30px / 1.2`, weight `500`.
- Agent answer: `15px / 1.78`.
- User message: `14px / 1.55`, weight `500`.
- Activity labels: `12px`; activity metadata: `10px` monospace.
- Navigation and compact controls: `9-11px` according to hierarchy.
- Dialog title: `16px`; dialog support text: `11px / 1.55`.
- Letter spacing is always `0`. Do not scale font size with viewport width.

## Geometry And Density

- Header: `60px` high.
- Sidebar: `240px` wide with `12px` horizontal inset.
- Example cards: two columns, `116px` minimum height, `16px` radius, `11px` gap, and a concrete visual preview.
- User message: maximum `86%` of the reading column, `9px` radius.
- Activity row: approximately `39-40px` minimum height with stable `23px` icon state.
- Composer: `20px` desktop radius (`16px` on narrow screens), `58-190px` textarea range, `30px` circular send/stop controls.
- Menus: `230-285px` according to content, `12px` radius, `40px` minimum item height.
- Example preview dialog: `576px` wide, `22px` radius, a `232px` result-preview stage, and a compact editable prompt body.
- Standard dialog: maximum `560px`; Agent settings dialog: `860px` wide with a `190px` internal navigation and a constrained, scrollable skill list.
- Navigation rows and compact work items use approximately `10px` radii. Example cards use `16px`, framed execution groups use `13px`, and pill shapes remain reserved for tabs, selection chips, compact status, and circular actions.

## Core Workflows

### Example Selection

The example workflow is a five-state commit path:

```text
Browse examples -> Preview full draft -> Confirm use -> Edit in Composer -> Send
```

- Clicking a card opens a Radix Dialog containing a concrete result-preview collage, the full prompt, and execution context.
- Cancel returns to the launch surface without changing the Composer.
- “Use this example” closes the dialog, fills the textarea, moves focus to it, and places the caret at the end.
- Confirmation must not call `POST /api/runs` and must not clear the draft.
- Only the send button or Enter without Shift starts a run. Shift+Enter remains available for line breaks.

### Model And Effort

- The Composer trigger displays `model · effort` as one compact control.
- Its menu exposes three nested groups: mode, model, and reasoning effort.
- Current mode is standard single Agent. Agent cluster remains visible only as an explicitly disabled future option.
- Model choices are Auto, GPT-5.6 Terra, and GPT-5.6 Sol.
- Effort choices are fast, balanced, and deep.
- Selection updates the trigger immediately and is sent with the next `POST /api/runs` request.

### Knowledge, Skills, And Preferences

- Knowledge context uses a searchable selection dialog with label, path, and description.
- Skills use a dedicated Agent settings dialog with search, toggles, and a scrollable local catalog of Codex-oriented workflows.
- Selected non-default contexts and skills appear as removable Composer chips.
- Custom instructions persist in browser `localStorage` and apply to subsequent new tasks.
- In the alpha, these selections are converted to request directives. They are not yet a server-side knowledge ingestion system, vector search index, installed Skill registry, or permission boundary.

### Running A Task

- The user turn is right-aligned and compact; its time appears on hover. The model, duration, and token count belong to the response footer, not the prompt.
- The response is answer-first. Everything the agent did before its response (plan, thinking, commentary, tools, files, diffs, subagents, errors) lives in one work-log disclosure above the response.
- The work-log summary is one line: the agent mark, then "Working" / the live stage while running, or "Worked for 12s", "Failed after 12s", "Stopped after 12s" when finished, followed by step and issue counts and a chevron.
- The work log is open while the agent works and after a failure, and collapses when the run completes or is stopped. A status change inside one phase keeps the reader's open/closed choice.
- The message that reads as the response stays outside the log. Generated-file records published right after it do not demote it; any later reasoning, tool call, or error does.
- While a run is active, the send control becomes a stop control. The textarea remains editable for queueing a follow-up.
- Live status is a single quiet line at the end of the turn (glyph, stage, detail, elapsed time). Helper text appears only for waiting, reconnecting, disconnected, queued, or silent states. The header shows a status pill only while a run is active or the connection is degraded; the composer carries no duplicate status bar.
- Automatic scroll follows only while the reader stays near the bottom. Otherwise show a "jump to latest" control.
- The follow-up composer shares the reading column's width and omits the project picker: a conversation keeps its original directory.

## Message And Activity Rules

- User message: one restrained bubble; no avatar card, gradient, or oversized padding.
- Work-log rows share one grammar: a 22px icon on a thin rail, a title, then right-aligned duration, an icon-only status (label in assistive text and tooltip), and a chevron that points right when closed and down when open. Rows without details show no chevron.
- Tool icons follow the tool family (command, search, file, browser, subagent, image, plan, wait, MCP). Command titles use the monospace face.
- Terminal output is monospace, scrollable, and isolated on a darker surface. Failures lead with the most specific failure line, then the runtime diagnostic, with raw output and arguments behind "Details".
- Files: a "Created/Updated name" row that opens the preview, with revision and download only when a valid artifact URL exists.
- Diff: an expandable "Edited path" row with the raw diff until a dedicated viewer exists.
- Final answer: GFM Markdown at 15px/1.75 with real list markers, single-frame code blocks (language and actions in one header), and ruled tables.
- Footer: one line after the response with copy, the outcome (Completed / Failed / Stopped), model, duration, tokens, and time. No celebratory card.
- All interface copy is English, matching the shell. Agent and provider text is shown as written.

## Menus, Dialogs, And Focus

- Use Radix primitives for focus trapping, Escape dismissal, keyboard navigation, and Portal layering.
- Menus open above the bottom Composer and remain inside the viewport.
- Submenus must not obscure the selected value or shift the Composer.
- Dialog overlay uses a restrained dark scrim and light blur; dialogs are surfaces, not nested cards.
- The example dialog uses an oversized preview stage to establish the task outcome before the commit action; the prompt remains readable text rather than a second nested card.
- Icon-only controls require an accessible name and a tooltip when the symbol is not universally obvious.
- All keyboard focus uses the accent outline with visible offset.
- Do not expose nonfunctional controls as normal active actions. Use an explicit disabled state only when future capability is important to understanding the menu.

## Motion

- Menu and dialog entrances: `130-170ms`, low-distance fade/scale only.
- Hover transitions: approximately `150-160ms`.
- Running activity may use a restrained status pulse; avoid ambient looping animation.
- Card hover translation is at most `-1px`.
- Honor `prefers-reduced-motion` by reducing animation and transition duration to effectively zero.

## Responsive Verification

Desktop acceptance comes first at `1440x1000`, followed by `1024x768`. Also smoke-check `768x1024` and `390x844`:

- no horizontal page scroll;
- the 240px desktop sidebar does not compress the 768px reading surface unexpectedly;
- menus stay inside the viewport and do not overlap their trigger on pointer-up;
- dialogs fit within a `32px` viewport inset and remain scrollable;
- Composer never covers inaccessible content;
- long paths, task titles, tool inputs, and ids truncate without resizing controls;
- streamed text does not move the send/stop control;
- no text, icon, status, or chip overlaps adjacent content;
- keyboard focus returns to the Composer after example confirmation.

## Release Checklist

- Verify launch, example preview, example prefill, model/effort menus, knowledge dialog, Agent settings, and Composer focus in a real browser.
- Verify the implicit workspace does not increment the visible context badge, the active task row replaces the new-task highlight, and a recent task can be reopened without a new `POST /api/runs` request.
- Confirm example confirmation causes no `/api/runs` request.
- Run a real Codex task that emits reasoning, a command tool, Markdown, and completion.
- Expand a tool output and inspect overflow and monospace rendering.
- Scroll away from the bottom during streaming and verify follow mode disengages.
- Stop a live run and confirm the UI reaches a terminal cancelled state.
- Capture the launch, running, expanded-tool, and completed desktop states at `1440x1000`.
- Run an automated accessibility scan (for example axe-core) on the main screens in both themes. Text tokens (`--muted`, `--faint`, `--accent`, `--blue`, `--green`) must keep at least 4.5:1 contrast on every surface they appear on.
- Run typecheck, tests, build, Codex smoke test, and `git diff --check` before release.
