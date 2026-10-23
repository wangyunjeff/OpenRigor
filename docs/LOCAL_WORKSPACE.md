# Local workspace implementation

Updated 2026-10-22. This document describes the implemented local edition; the architecture research documents describe a broader hosted target.

## Product surfaces

The local UI was compared in the in-app browser with `https://app.clawsgo.ai/chat`. The implementation follows the observed information layout: personal-workspace sidebar, project/task navigation, a large research card beside two smaller guide/handoff cards, a bottom composer with project and model controls, an image studio, a searchable skill market, project creation, and centered settings panels. It uses OpenRigor identity and original generated instrument artwork.

| Surface | Local behavior |
| --- | --- |
| New task / chat | Submit real Codex turns, display reasoning/tools/files, cancel, continue, replay |
| Composer | Project, model, reasoning, mode, uploaded/pasted attachments, skills, knowledge, queued follow-ups; separate persisted drafts per conversation/project |
| Research / guides | Editable task starters with explicit workflow instructions |
| Handoff | Open saved projects/tasks or prepare a workspace inspection prompt |
| Projects | Create actual directories, save instructions, add knowledge, browse files/tasks |
| Skill Market | Search/filter installed and available instruction profiles, install/uninstall, create custom skills |
| Image Generation | Generate/edit through configured provider, preview/download originals, reuse prompt/reference, archive gallery entries |
| Search / task menus | Search names/prompts/saved answers, filter by project/status, sort, rename, pin, archive/restore; export through sidebar menus |
| Settings / Agent | Persist profile, theme, persona/instructions/defaults; inspect runtime and usage |
| Workspace | Local owner, directory, persistence status, project/task counts and files |
| Workspace viewer | Resizable file/web tabs, task overview, project files, source view, original downloads, and an expanded or narrow-screen modal |

A local workspace replaces cloud host selection. Provider model names come from the real Codex catalog; ClawsGO's proprietary model aliases are not represented as working models. The research examples are editable starters, not claims that another user's completed research was reproduced.

## Data and execution

- The API binds to loopback and validates Host and browser Origin headers.
- Secrets, hidden runtime state, traversal paths, and escaping symlinks are excluded from the file browser.
- `.openrigor/workspace.json` stores local product metadata atomically.
- Each run has persisted metadata and an ordered, fsynced JSONL event journal.
- The same data directory has one live API owner, protected by a process lock.
- API restart recovers history, event sequences, idempotency, project provenance, and Codex conversation links.
- A turn interrupted by restart is marked failed with `RUNTIME_RESTARTED`; the next explicit follow-up resumes the provider thread.
- Project runs use that project's directory. Existing conversations cannot switch directory by changing a client-supplied project ID.
- Uploaded attachment IDs are resolved against server-owned metadata. Project attachments are copied into the project's accessible `attachments/` directory.
- Agent instructions, project instructions, selected installed workflows, and knowledge are assembled server-side.
- Approvals and clarification requests use sanitized local IDs. A response resolves once; duplicate responses fail. Cancel/terminal completion clears pending requests.
- Queued follow-ups are browser-persisted, scoped to an exact conversation/predecessor, and use stable request IDs. Automatic dispatch requires that browser session to be open.
- Usage is aggregated from actual terminal runtime events. There is no simulated credit balance or checkout.

## Unified workspace viewer

Generated-file cards, project files, answer links, and structured search sources share a viewer beside the conversation. React Resizable Panels owns pointer, touch, and keyboard resizing; Radix Dialog owns the modal layer used for expanded and narrow-screen reading. The viewer holds up to 12 tabs in the current conversation or project-draft scope and clears them when that scope changes. Tabs are session UI state and are not restored after a page reload. Artifact identity includes its run and saved revision; project files refer to their current workspace contents.

The implementation composes the existing Vercel AI Elements/Streamdown rendering stack with DOMPurify, PDF.js, React Resizable Panels, and Radix primitives. The local web reader uses Mozilla Readability with linkedom. Their licenses are listed in [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).

| Content | Implemented reading behavior | Boundary |
| --- | --- | --- |
| Markdown | Streamdown renders text, math, Mermaid diagrams, and tables; tables and diagrams can expand in a Radix dialog | Raw HTML is skipped. File links and images resolve within the originating run or project; missing references show an unavailable state |
| CSV / TSV | Read-only table preview | At most 100 data rows and 24 columns are shown; download preserves the complete file |
| HTML | DOMPurify sanitizes a static document inside an empty-sandbox iframe with a restrictive CSP | Scripts, forms, active embeds, inline SVG/MathML, and external resource attributes are removed; CSP blocks remote CSS resources. Local fragment links and embedded raster images are allowed. Truncated HTML is shown as source |
| Raster images / SVG | Raster images use validated preview endpoints; SVG is displayed as an image resource | SVG markup is not inserted into the application DOM |
| PDF | Lazy-loaded PDF.js renders one canvas page at a time with page navigation, zoom, fit-to-width, and original download | No text-selection/search layer, form editing, or password entry. PDF scripts and document actions are not executed. Rendering uses bundled fonts/CMaps/codecs; damaged or protected files can require an external PDF application |
| Text / code / unsupported files | Streamdown CodeBlock and Shiki provide source highlighting, line numbers, literal-source copy, and keyboard scrolling, with original download | Above 64 KiB or 1500 line breaks, or if the highlighter fails, source remains a lightweight literal text preview. Text previews can be truncated. Office documents, archives, and other unsupported binary formats use the download fallback |
| Public webpages | Readability extracts plain text with a title, retrieval time, final URL, and truncation indicator; Website mode offers a sandboxed iframe after successful retrieval | The reader does not execute page JavaScript or forward browser cookies/authorization. Login, subscription, verification, or inaccessible pages can fail. Website mode can be blocked by a site's embedding policy and retains an original-site link |

Public-page retrieval accepts HTTP/HTTPS on standard ports, validates every redirect, rejects private/reserved network addresses and credential-bearing URLs, and connects to a validated DNS address. It has a 12-second request deadline, at most four redirects, a 2 MiB response/decompression limit, a 20,000-element HTML limit, and a 160,000-character extracted-text limit. Reader output is rendered as text. Website mode loads the original site in the browser and can make that site's normal resource requests; it uses an empty iframe sandbox and no-referrer policy.

Local workspace file reads and saved run artifacts remain subject to the API's 20 MiB per-file limit. Text truncation and unsupported-format notices remain visible, with original downloads available where authorized. The PDF component additionally bounds fetched bytes to 32 MiB, applies a 30-second load timeout, and caps canvas resolution; the API's smaller file limit applies first to current local files. Switching documents cancels obsolete requests and cleans up PDF workers, renders, and image object URLs.

Task Overview projects the latest turn's persisted events: actual run state, the plan exactly as last reported, latest saved file revisions, observed source/subagent records, and token usage when the runtime reports terminal usage. A completed run does not automatically mark its plan steps complete. Search results and access attempts retain those labels; successfully reading a page in the viewer does not rewrite the agent's source or verification record.

For this locked dependency set, local development and verification require Node.js 22.22.2+ within 22.x, 24.15.0+ within 24.x, or 26+. The minimum is set by jsdom and its test dependencies; PDF.js independently requires Node 22.13.0 or newer. The repository pins pnpm 9.15.5.

## Image assets

The default image provider is configured by `AGENTS.md`. Originals are saved immediately under ignored `output/imagegen/`. The UI uses an optimized derivative at `apps/web/public/generated/workspace-instruments.png`. Gallery archiving retains original files. Reference edits use a stored gallery image rather than an arbitrary filesystem path.

## Validation

Automated coverage includes durable replay and restart interruption, truncated final journal recovery, interior-corruption rejection, request idempotency conflicts, cancellation, Host/Origin guards, hidden-file/path/symlink restrictions, project directory provenance, attachment references, generated-file downloads, image credentials/original bytes/reference edits, interactive question/approval resolution, queued-message chains, model preferences, API errors, and conversation timeline ordering.

Live acceptance also checks the configured image API and a two-turn Codex conversation. A provider timeout is surfaced as a failure; an HTTP connection alone is not counted as successful model execution.

### Continuation acceptance (2026-10-22)

The interrupted task-management and workspace refinements were integrated and rechecked. `pnpm typecheck`, `pnpm test`, and `pnpm build` passed: 150 tests total (9 protocol, 101 web, 40 API). Vite still reports large syntax-highlighting/rendering chunks; bundle-size optimization remains separate work.

The visible in-app browser verified full-text matching on a phrase present in a saved answer, restoring the matching conversation, separate drafts across two existing projects, restoring the original draft on return, and successful clipboard-image upload into the actual composer attachment list. Temporary draft text, the composer attachment chip, clipboard content, and appearance were restored after checking; no new model turn or image-generation call was submitted. The uploaded test image remains in the local upload store. A 390-pixel viewport measured document and scroll widths of 390 pixels and a 370-pixel search dialog; desktop viewport was restored afterward. Screenshots are local ignored outputs under `output/playwright/continuation-*`.

Unsaved persona/profile fields now survive overview refreshes, including an appearance change. Focused API regressions verify knowledge edits retain identity/project ownership across restart and archived knowledge is excluded from both automatic and explicit run context.

The browser also exercised pin, the Pinned filter, archive, the Archived filter, restore, and unpin on the existing `hi` acceptance conversation. Its original pin/archive state was restored and the task library returned to seven unarchived tasks, zero pinned and zero archived. Search keeps a single rounded keyboard-focus boundary around the field.

An open SSE connection previously prevented graceful API shutdown and could leave a process holding the data-directory lock during watcher restart. Shutdown now ends SSE streams, rejects new requests while closing, and has a bounded exit. The regression opens a stream, sends SIGTERM, immediately restarts against the same store, and verifies ordered replay. The dev launcher builds the protocol once before starting both watchers. A real local watcher restart was also observed to return a healthy API without a lock conflict.

### Execution presence acceptance (2026-10-22)

An active run now has an activity strip at the latest output and a compact strip above the composer. Both display the persisted run state, elapsed time, and the age of the last actual event. Stage labels use observed reasoning, pending tools, or answer deltas. After ten seconds without an event, the copy explicitly says it is waiting for the next output; the animation is a state indicator, not a provider heartbeat or a fabricated progress estimate. The header and current task also expose the active state, and the stop control has a visible text label.

Finished tool rows are described as execution records; only pending tools are described as executing. Waiting for confirmation, stopping, reconnecting, and disconnected states have distinct copy. A disconnected stream stops the plan, reasoning, answer, and tool activity visuals. Native EventSource connection errors are distinguished from named protocol `error` messages so a network interruption does not also produce a spurious invalid-event alert. Terminal transitions remove the activity strips and stop control. GSAP motion is scoped, cleaned up, and disabled for reduced-motion preferences; changing elapsed times stays outside live announcements.

Visible in-app browser acceptance used an isolated mock API and Vite instance, without starting a model turn or changing real task data. It exercised a running task with five completed tools and no recent output, an active tool, waiting for user confirmation, disconnection, and completion. A 390-pixel viewport had matching document and scroll widths, and emulated reduced-motion preference cleared the spinner transforms while retaining the status text. Temporary viewport/media overrides were restored. Screenshots and the isolated fixture are ignored local outputs under `output/playwright/activity-*`.

`pnpm typecheck`, `pnpm test`, and `pnpm build` passed, with 159 tests total (9 protocol, 110 web, 40 API). Full-suite verification also exposed a pre-existing fixture race: a report revision was overwritten after a fixed 100 ms before discovery had necessarily captured it. The HTTP test now releases that overwrite only after downloading and verifying the first saved revision; all seven-artifact, deduplication, immutable-revision, restart, and replay assertions remain intact. This changes only the test fixture and its HTTP test.

### File and web viewer acceptance (2026-10-22)

The unified viewer is connected to existing conversation artifacts, Markdown links, source links, and project/workspace files. The integration uses React Resizable Panels for the split view, Radix Dialog/Tabs for overlays and keyboard navigation, Streamdown and its math/Mermaid plugins for documents, PDF.js for local PDF rendering, DOMPurify for inert HTML, and Mozilla Readability for public page text. Product code supplies scoped file identities, registered revisions, guarded URLs, and task navigation.

`pnpm typecheck`, `pnpm test`, and `pnpm build` passed with **222 tests** (9 protocol, 150 web, 63 API). After the final focus-restoration adjustment, web typecheck and production build passed again. Regression coverage includes preview identity and project isolation, HTML sanitization, PDF size/cancellation/error handling, reader SSRF/DNS/redirect/compression limits, Markdown relative references, and keeping an expanded table mounted when a running task registers another artifact. Vite still reports chunks larger than 500 kB; PDF.js is loaded through a separate lazy chunk.

Visible in-app browser acceptance checked the report answer link and immutable artifact revision, rendered Markdown math/table/Mermaid and relative CSV/SVG/PNG references, PDF canvas painting and zoom, static HTML and source mode, public-reader text and a sign-in-required fallback, delayed-file switching, same-name reports in two projects and two conversations, keyboard tab navigation/resizing, expanded-view focus restoration, and preserving the composer draft. The 390-pixel viewport had a 390-pixel document and a full-width viewer with no document overflow. Reduced-motion emulation reported `transform: none` and zero animation duration; viewport and media overrides were restored. Temporary fixture draft text was cleared. The negative HTML fixture produced zero requests to its forbidden-resource endpoint in the retained request capture.

An existing real task also opened its saved `paired-plot.svg` from the answer into the same viewer; the real local web reader returned the public Example Domain text. No new model turn or image-generation request was submitted for this acceptance. Screenshots, request evidence, fixture code and verification logs are ignored local outputs under `output/playwright/preview-*`; `preview-real-workspace.png` records the actual local task rather than fixture data.

### Viewer reading detail acceptance (2026-10-22)

Reading positions are independent for each task, tab, overview/file library, and Preview/Source mode. Stable callback refs bind restoration when a Radix portal mounts after the parent's layout effect; ResizeObserver waits for asynchronous content height without replacing the saved offset with a temporary browser clamp. Explicit wheel, touch, scrollbar, or keyboard input stops a pending restoration. Closing a focused background tab selects a remaining focus target, and closing the last tab focuses Task Overview.

The library and launcher count latest artifact revisions per run/file identity, retaining exact historical versions in the link registry. Current workspace metadata takes precedence over older open-tab descriptors. Project-file labels include their project and path; web tabs receive the actual extracted page title. Header actions use existing Radix/shadcn tooltips, narrow layouts omit the redundant expansion control, and the expanded footer describes Escape as returning to the conversation. Binary files do not offer a text-source toggle.

`pnpm typecheck`, `pnpm test`, and `pnpm build` passed with **247 tests** (9 protocol, 175 web, 63 API). Added DOM regressions cover source safety/literal copying/failure fallback, separate reading positions including delayed portal mounting, latest-library projection, and guarded async title/metadata updates across task scopes. The final source CSS refinements were followed by another successful web production build. The existing large-chunk warning remains.

Visible in-app browser checks confirmed the real Python artifact's syntax colors and retained **751px** reading position through overview, expansion, and a single Escape return. Isolated acceptance confirmed actual webpage titles, latest-only library count, focus after closing background/final tabs, light-theme readability, and an **84-character** source copy into the browser clipboard. Clipboard contents, fixture appearance, and temporary draft were restored. A **390px** viewport had matching document/scroll/viewer widths; the mobile viewer closed to the retained draft and the viewport was reset. No new model turn or image-generation request was made. The second Vite instance uses an isolated dependency cache; a stale highlighter chunk is also contained by a file-level plain-source fallback. Evidence is under ignored `output/playwright/preview-detail-*`.

## Remaining hosted boundary

This is a single-operator local implementation. It does not provide hosted identity, team authorization, real membership invitations, payment checkout, remote SSH configuration, managed MCP credentials, cloud host allocation, or a durable distributed worker. Those require separate infrastructure and integration work. It also cannot recover the exact in-flight provider process after an API crash; it preserves output and supports explicit continuation.
