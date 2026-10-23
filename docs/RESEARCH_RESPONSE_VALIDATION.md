# Research response validation

Validated locally on 2026-10-22 with the actual `codex-app-server` executor and explicit model `gpt-6.1-sol`, medium effort. Model calls are opt-in; the automated unit and HTTP integration tests use a fake provider.

## Reference observations

The signed-in reference application at `https://app.clawsgo.ai/chat` exposed a completed literature-review task with a collapsed execution trace, intermediate commentary, a comparison table, linked references, an actual step checklist, and PDF/Markdown/image deliverable cards. Opening a card showed a file preview and download action. The observable behaviors informed an original implementation using AI Elements and shadcn.

Selecting GPT 6.1 Sol in the reference application opened a subscription upgrade dialog for the current Free account. No upgrade or purchase was made. The reference observations therefore are not a same-model answer-quality benchmark. OpenRigor's model calls below used the requested GPT-6.1-Sol directly.

## Real model runs

| Task | Run | Verified output |
| --- | --- | --- |
| LoRA / QLoRA literature comparison | `run_c77dec085b124e80a0a9` | Markdown review, six-dimension comparison CSV, two BibTeX entries; source-access limitations explicitly recorded |
| Synthetic paired-data analysis | `run_58b537309fec4bf2b43e` | Markdown report, 12-row CSV, SVG figure, runnable Python standard-library script, JSON statistics |
| Controlled RAG study design | `run_fb4793520de64122bfbd` | Markdown protocol with formula and Mermaid workflow, four-condition matrix CSV, synthetic annotation template |
| Figure correction and live planning tool | `run_865163f2ac824a3e85b2` | Four persisted real planning-tool updates, 3/3 completed steps, corrected SVG and script; other statistics unchanged |

All four reached exactly one successful terminal event. The initial suite verified eleven requested artifacts by downloading their recorded URLs and checking SHA-256 against persisted metadata. Historical revisions remain immutable when a later run changes the workspace file.

The first three runs revealed that this provider session did not expose a built-in planning tool. They recorded plans in files rather than emitting provider plan events. The implementation now supplies `openrigor_update_plan` as an app-server dynamic tool on new threads. The fourth run actually invoked it through all three stages; the UI consumes the resulting persisted plan events. Older threads cannot acquire new dynamic-tool declarations retroactively.

The literature run could not retrieve papers through its available web/browser tools and accurately disclosed this. The final content and bibliography are unverified references, not an independently verified review. The UI distinguishes search-result links, page-access attempts, and ordinary links included in an answer. Access attempts never establish that a page was read or that a claim was verified.

## Numerical oracle

Inputs are explicitly synthetic, with paired difference `after - before`. Independently calculated values were checked to absolute tolerance `0.0001`:

| Statistic | Expected |
| --- | ---: |
| n | 12 |
| Before mean | 70.91666666666667 |
| After mean | 74 |
| Mean paired difference | 3.0833333333333335 |
| Sample SD of differences | 0.9962049198956219 |
| 95% t interval, lower | 2.450374970901095 |
| 95% t interval, upper | 3.716291695765572 |
| Cohen dz | 3.095079407614642 |
| Paired t | 10.721669574897486 |

The interval uses the supplied rounded critical value `2.200985` with 11 degrees of freedom. This validates computation and reproducibility, not real-world effect or causality.

## Response surfaces

- Persisted planning-tool and provider-plan events drive the progress card; terminal status does not invent completed steps.
- Search links carry their evidence kind. Answer references remain a separate neutral list.
- Generated files are discovered in bounded output directories or through explicit model file references, validated within the workspace, hashed, and saved as immutable per-run revisions.
- Deliverable cards open Markdown, CSV/TSV, text/code, raster image, SVG image, or supported PDF previews. Generated HTML is displayed as text. SVG is rendered in an image context, never inserted as executable markup.
- LaTeX delimiters, math, tables, code, and Mermaid are supported in answers and Markdown previews. Diagram dimensions are scoped so global icon styles cannot shrink graphs.
- Motion respects reduced-motion preferences. Plan/source/file events survive refresh and API restart through the same ordered replay path as messages and tool events.

## Local verification

The latest automated pass completed 117 tests (9 protocol, 71 web, 37 API), TypeScript checks, and the production build. Browser QA used the visible in-app browser against actual saved model runs. It checked real plan updates, readable formulas without duplicate MathML, the four-node Mermaid workflow, CSV rows, SVG previews, and file downloads. The report's adjacent SVG resolves to a registered artifact displayed through an image Blob; all five adjacent file links resolve to the recorded immutable revisions. Downloading its CSV through the rendered report produced `paired-data.csv`.

Table and Mermaid fullscreen views inside a document use nested Radix dialogs, preserving the parent preview. Browser checks confirmed the real four-condition table expands and closes, and the real four-node diagram expands, zooms, resets, and returns to the original report with Escape and focus restored to its trigger.

At a 390 × 844 viewport, the page had no horizontal document overflow (390 px client and scroll widths); the SVG preview had 372 px client and scroll widths, a usable close action, and an accessible download label. Temporary viewport overrides were reset after testing.

## Presentation refinement

A subsequent design review and browser pass reused the four persisted Sol results without making additional live model calls. It improved report typography and chapter spacing, added 128 px image/SVG thumbnails through the same safe image-resource path, made mobile deliverables a single column, and reduced completed plans to a compact header while preserving their full expanded details. Mermaid fullscreen is disabled until its diagram has actually rendered; fullscreen table/diagram views and diagram zoom/reset were rechecked in the visible in-app browser.

The real literature run's historical failed browser tool now stays collapsed within a completed run, with a visible exception count. Expanding it shows the title `使用内置浏览器查阅 LoRA 原论文` and concise reason `Browser is not available: iab`. Original output and parameters remain in default-closed diagnostic details; the expanded diagnostic body measured 280 px high with independent scrolling. This changes presentation, not the tool result or the review's unverified-source status.

Assistant messages retain consistent text metrics as the stream advances. Only the final completed message is labelled as the answer; intermediate messages retain their progress identity. Conversation names, project selection, recent-task filtering, and new-task project context now agree when opening saved tasks or navigating back. Local cache parsing preserves renamed titles, project IDs and pins, and still migrates legacy shortcuts. A missing project object cannot silently turn a project task into a standalone task.

At 390 × 844, the deliverable grid measured one 316 px column and the document stayed 390 px wide. Report body text measured 14 px with 25.2 px line height and 19 px section headings. A long equation exposed a mobile overflow issue during QA; it now scrolls within its own formula container, and the Markdown preview body measured equal client/scroll widths of 363 px. The viewport was reset afterward. The corrected SVG was downloaded through the card and matched SHA-256 `4a74f98d925e1f71fe0656dd6a38579413863736f379684615610e154ed876ac`.

Screenshots are saved under ignored `output/playwright/refinement-*`. Test, typecheck, and build logs use the same prefix. The production build passes with the existing large-chunk warning from the rich Markdown/diagram/code-rendering dependencies.

## Repeating the live suite

Start the local app with `pnpm dev`, then explicitly opt in:

```sh
pnpm exec tsx scripts/research-response-smoke.ts --live
```

This makes three actual model calls in separate project directories and preserves those projects and their outputs. It does not automatically accept approval or input requests. Results are written under ignored `.openrigor/validation/research-response/`. Do not restart the API or rebuild its watched dependencies while the suite is active.
