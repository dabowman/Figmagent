# Archer Cohort Synthesis — sessions 53–62 (2026-09-01 22:16 → 2026-09-02 04:24 UTC)

Ten sessions from `~/Github/storybook` rebuilt the Archer design system in Figma file `C4zLeQJs8qkAhFSLwMKP9J` over the remote transport. Each session has its own analysis (`figma-mcp-session53-analysis.md` … `session62`) and the nightly pipeline filed 24 tracker entries from them (TOOL-042…054, BUG-040…047, AGENT-034…036). This document is the view no single analysis can give: what the cohort cost in aggregate, which causes dominate, and where the leverage is.

## The cohort in numbers

| Session | Task | Calls | Figma calls | `run_script` | Hard errors | Est. waste |
|---|---|---|---|---|---|---|
| 53 | Accordion | 86 | 65 | 29 | 21 | ~36% |
| 54 | Alert Dialog | 73 | 53 | 29 | 9 | ~34% |
| 55 | Autocomplete | 92 | 79 | 23 | 16 | ~35% |
| 59 | Avatar | 32 | 21 | 4 | 2 | ~34% |
| 58 | Button (60 variants) | 69 | 55 | 20 | 4 | ~28% |
| 57 | Checkbox | 35 | 21 | 11 | 2 | ~31% |
| 56 | Combobox | 85 | 68 | 38 | 10 | ~38% |
| 62 | 596-variable re-scope + 8 text styles | 134 | 35 | 28 | 2 | ~31% (of Figma calls) |
| 61 | Context Menu | 35 | 22 | 5 | 5 | ~20% |
| 60 | Accordion prototype reactions | 24 | 15 | 8 | 3 | ~37% |
| **Total** | | **665** | **434** | **195 (45%)** | **74** | **~28% (~190 calls)** |

Other aggregates:

- `write` + `edit` combined: **30 calls**. `run_script`: **195**. The escape hatch outnumbered the first-class writers 6.5 : 1.
- `screenshot`: 93 calls, **28 failed (30%)** — [BUG-016]'s 15th through 21st recurrences in one night.
- Zero official-Figma-MCP fallback calls in all 10 sessions (the [BUG-016] behavioural fix holds).
- Up to three MCP processes wrote the file concurrently for most of the night. The per-file FIFO held; one collision is proven ([BUG-047]).
- Every session ran under deferred tool schemas (external repo), so the opening `ToolSearch` slice defined the tool surface for the whole session.

## Where the waste went

Roughly 190 wasted calls sort into five causes. The first two are ~65% of the total.

**1. Fonts on the remote transport — ~85 calls, 9 of 10 sessions, plus one corrupted shared style and one dropped deliverable.** The Archer file is set in PP Neue Montreal; the headless `use_figma` VM cannot load it. Every write that touches text — create, clone, `appendChild`, `insertChild`, `setProperties`, `setTextStyleIdAsync`, reorder — throws Figma's "call `loadFontAsync` first", which is the one call that cannot succeed there. The cost escalated across the night:

- S53–S58: extra calls (font hunts, retry ladders, whole atomic scripts discarded).
- S59: the recommended style-face swap silently dropped `support/label/1`'s `fontWeight` binding — a file-wide corruption caught only because the script echoed `boundVariables` ([BUG-044]).
- S60: the single-select prototype flow was **abandoned** because parking fonts across 12 cloned rows was out of scope ([BUG-033], 8th recurrence).
- S61: **zero font failures** after one 11 KB read of the storybook repo's `figma-remote-vm-gotchas.md` memory file.

Entries: [BUG-033], [BUG-035], [BUG-037], [BUG-040], [BUG-041], [BUG-044], [TOOL-037], [TOOL-045], [TOOL-050].

**2. `screenshot` returning no data — ~40 calls.** 28 failures plus recovery. The cohort finally produced discriminating evidence: S58 exported the same node at the same scale successfully, then unsuccessfully two minutes later after ~120 paints changed from black to four palettes; S61 failed a 370×225 render while a 448×272 render succeeded. The governing variable is encoded payload size, not `scale`, dimensions, or effects. Root cause is unchanged since session 47: `remote/client.ts:110-114` downgrades a `JSON.parse` failure to a raw string instead of throwing. The "~4MB return cap" guard text is falsified in seven consecutive sessions and still steers agents into the `scale` ladder.

**3. `run_script` re-implementing loaded tools — ~25 calls, plus forfeited validation.** Three separable drivers, now measured independently:

- *Discovery under deferred schemas.* The tokens domain (`get_design_system`, `create_styles`, `update_styles`) was missing from the opening `ToolSearch` slice in S53, S54, S57 and S62 — and each time the agent re-implemented it in JavaScript. S62 loaded schemas at 03:22 and 03:30, then pivoted into text-style work at 03:41 for 43 minutes without another search, hand-rolling what `create_styles` already does correctly ([TOOL-050], [AGENT-036]).
- *Preference once inside the hatch.* S58 re-implemented `grep({variableId: [...]})` in 1,352 characters with `grep` loaded ([AGENT-035]); S62 sent 596 scope updates via script with `update_variables` in context, because the script payload was 2.5 KB vs ~48 KB ([TOOL-052]).
- *Genuine gaps.* Create-time bindings ([TOOL-032]), `fontWeight` ([TOOL-037]), `effects` ([TOOL-039]), reactions ([TOOL-048]), variable modes ([TOOL-038]), `strokeAlign`/`description`, annotation delete ([TOOL-042]), image paints ([TOOL-046]), style/variable *absence* queries ([TOOL-051]).

The control data: the two sessions with the lowest script share (S59 at 19%, S61 at 23%) are the two that called `get_design_system` first-class in their opening slice, and every surviving script in both maps to a named gap. S56 (92% of writes) and S58 (100%) built ordinary component trees by script that S55 proved `write` handles in one call (8 COMPONENT roots, 32 nodes, #30).

**4. `lint` noise at close-out — ~10 calls, and an untrustworthy gate.** COMPONENT_SET wrapper chrome was 67% of findings in S61 ([TOOL-049]); invisible SVG-import paints were 30% in S57 ([BUG-042]); a 5% budget overrun discarded all 39 issues in S55 ([TOOL-043]); the 0–1 vs 0–100 opacity scale left permanent literal debt in S57/S58 ([BUG-038]). Because two-thirds of findings are unactionable, agents triage in prose from the first run's buckets and never re-run — and left `exact_match` issues unfixed in S56 (6) and S57 (3) ([AGENT-034] ×2).

**5. Concurrency — 2 calls, one silent corruption channel.** Three sessions wrote the file at once with no throughput gain (remote serialises per file) and one proven cross-session collision: S60's parentless `write` landed a probe frame on S61's page because `figma.currentPage` is shared file state across processes ([BUG-047]).

## What the cohort teaches

1. **Design-system rebuilds over the remote transport are gated by fonts, not by tool coverage.** Every design system ships a licensed typeface. The plugin transport does not have this problem at all. The user chose remote deliberately (S53 #85: use text styles, that is what we should be doing anyway), and S62 validated that choice at document scale — but only after the park-and-restore recipe was hand-written three times in one session. Either the tooling absorbs the swap ([BUG-037] fix (b): `edit`/`write` park unloadable families, write, restore `fontName` + every binding) or the guidance says "custom-font file → plugin transport" up front.

2. **The knowledge that eliminated the failure class lives in the wrong repo.** S61's zero-font-failure run was paid for by `~/Github/storybook/.claude/…/figma-remote-vm-gotchas.md`, written by S53 and corrected by S57 and S59. Every other external repo starts from zero. The remote-VM gotchas — no custom fonts, `Noto Sans New Tai Lue` as the width-safe Semibold donor, the `fontName` double-assign around a `fontWeight` bind, opacity 0–100, `clone()` parents to a shared `currentPage`, no `loadAllPagesAsync`/`createNodeFromSvgAsync` — belong in the `figma-guidelines` skill and the `run_script`/`edit` descriptions, not in one project's memory.

3. **CLAUDE.md's "No ToolSearch needed" is false where sessions actually run.** All 10 sessions ran in an external repo with deferred schemas. The opening slice shaped each session; four of them omitted the tokens domain and paid in scripts. The skill needs one rule: before writing a `run_script` in a Figma domain you have not fetched (tokens, styles, components, annotations), spend one `ToolSearch` on that domain.

4. **Verification is hand-rolled because `run_script` has no assertion layer** ([TOOL-033], 12 instances now). Every consequential script in S62 carried its own snapshot/verify/checksum; when a script did not (S53 #25, S59 #15), the failure shipped as `is_error: false`. The agents are doing the tool's job.

5. **Memory pays for itself, measurably.** S57 read the gotchas file at the exact moment a font failure hit and recovered in one call. S59 caught its own style corruption, repaired it field-by-field, and corrected the memory note that had called the swap safe. S61 consumed the corrected note and lost nothing. This is the flywheel working end to end — through a file Figmagent does not own.

6. **The pipeline filed 24 findings and dispatched zero fixes.** Every new entry reads "not in the Phase 6 auto-fix allowlist — no auto-plan generated". At least eight of the 24 are ≤10-line changes. The allowlist (sync-to-async, type-coercion, missing-batch-tool) no longer matches what sessions surface; the dispatch stage also reports four tracker entries as `identified` whose fixes are merged and issues closed (DRIFT).

## Opportunities, ranked

**Tier 1 — one PR of one-liners (≤10 lines each, all confirmed by code read in the analyses):**

- [BUG-042] `lint.js` `checkColorProperty`: skip `paint.visible === false`.
- [TOOL-049] `lint.js`: skip a COMPONENT_SET's own `padding*`/`itemSpacing`/`counterAxisSpacing`/`cornerRadius`.
- [BUG-045] `document.js:67-73`: remove the `CHANGE_TO` filter from `getReactions`; move it into `reaction_to_connector_strategy`.
- [BUG-046] `scan.ts:12,27`: make the connector follow-up conditional on `nodesWithReactions > 0` and optional.
- [TOOL-044] `stdlib.js` `fig.prop`: `fail()` on a null node with the deleted-or-other-file remedy.
- [BUG-041] `stdlib.js` `fig.loadFont`: `fail()` when the returned family differs from the requested one.
- [TOOL-037] `styles.js` `FIELD_MAP` + `apply.ts` `variableFieldEnum`: add `fontWeight`; delete the false alias text. Fixes `edit` and `fig.bindVariable` in one change.
- [TOOL-047a] `combine_as_variants`: optional `name`.
- [TOOL-053] `get_design_system`: `collectionsOnly: true`.
- [TOOL-050], [AGENT-035], [BUG-014] onboarding line: description text only.

**Tier 2 — small, high-leverage:**

- [BUG-016] `remote/client.ts:110-114`: throw on `JSON.parse` failure; delete the "~4MB cap" sentence; replace with "export child nodes individually". 21 recurrences, P0, and the cohort supplied the discriminating evidence.
- [BUG-043] `apply.js:266-273`, `styles.js:805-809`: write `resolveForConsumer(node).value` into the paint before `setBoundVariableForPaint`. Today `write` → `edit({variables:{fillColor}})` renders black on remote.
- [BUG-047] `create.js`: when `parentId` is omitted, resolve the page from the session's own context and `setCurrentPageAsync` inside the handler (the [BUG-018] remedy applied to the create path).
- [TOOL-043] `guardOutput`: trim to what fits and report `shown: N of M` instead of discarding everything on a 1–5% overrun (measured on both `lint` and `read`).
- [TOOL-045] `get_design_system({includeFonts: true})`: the list is already fetched at `styles.js:44` and `:709` and thrown away.
- [TOOL-051] `grep`: `hasStyle: false` / `hasVariable: false`. Every coverage audit is currently a script.
- [TOOL-048] `set_reactions` or `reactions` on `edit`: the only Figma work category with zero first-class coverage.

**Tier 3 — structural:**

- Park-and-restore mode on `write`/`edit` ([BUG-033]/[BUG-037]/[BUG-044] umbrella): snapshot `fontName` + `boundVariables` on affected styles and nodes, park on a VM-available donor, write, restore weight → face → family last. Removes the font class from every structural operation and retires the hand-written recipe.
- [TOOL-033] post-write assertions and mini-lint inside `run_script`. The most credible lever on the monoculture — agents stay in the hatch partly because leaving it costs the readback a script gives them for free.
- [TOOL-032] create-time `variables` on `write`. The reason S57 #17 and S58's builds were scripts at all.

**Tier 4 — guidance and pipeline:**

- Promote the remote-VM gotchas from the storybook memory file into `figma-guidelines` and the `run_script`/`edit` descriptions.
- Add the deferred-schema rule (search the domain before scripting it) and correct the "No ToolSearch needed" line for external repos.
- Add "custom-font file: decide the font strategy before the first write script; prefer plugin transport if the desktop client is open" to the skill.
- Widen the auto-fix allowlist to lint-scope filters, null guards, error-text/description fixes — or hand-batch Tier 1 now.
- Reconcile tracker DRIFT (TOOL-006, BUG-021, TOOL-022, TOOL-021 are shipped but marked `identified`/`planned`).
- On remote, run parallel sessions for context isolation only, and not until [BUG-047] lands.
