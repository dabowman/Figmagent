# Figma MCP Session 52 Analysis

## Session Overview

- **Transcript**: `0f978732-bb80-4197-b164-528e108d7396.json`
- **Date**: 2026-08-27 23:09 – 2026-08-28 01:27 UTC
- **Duration**: 133 minutes wall clock; **84 minutes idle** across three gaps (26.8 min after an `AskUserQuestion`, 34.7 min mid-build, 22.7 min before the lint pass) → **~49 minutes active**
- **Project**: external — `~/Github/site-foundry`, branch `wpds-audit`
- **Transport**: remote (file `07plXV7PsHOrLE3hsIS0jS`, "Site Foundry") — **fifth analysed session on this file**, after 47, 48, 50 and 51
- **Total tool calls**: 233
- **Figmagent tool calls**: 194 (83%)
- **Official Figma MCP calls**: **0**
- **Total errors**: 34 (31 Figmagent + 3 Bash)
- **Reconnections**: 0 (remote transport)
- **Context restarts**: 0
- **Task**: build the Site Foundry **brand editor** in Figma from the shipped `src/admin-ui/global-styles/` React source — a components board (`Brand editor · components`, `141:26`) and a screens board (`Brand editor · screens`, `149:323`), plus `Token preview` and `Scale preview` COMPONENT_SETs and an assembled `Brand specimen` pane, composed from real published WPDS/Gutenberg library instances.

Three results dominate:

- 🟢 **[BUG-018]'s root cause is confirmed and its exact fix is verified — three independent A/B pairs in one session.** `import_library_components` failed **0/17**, then the agent ran one `run_script` containing `figma.setCurrentPageAsync(page)` and **the byte-identical payload succeeded 17/17**. The same fail → set-page → succeed sequence replays at #83→#86 (0/1 → 1/1) and #97→#100 (0/3 → 3/3). This is the cleanest controlled experiment in the tracker's history and it makes a P0 shippable today.
- 🔴 **[BUG-016] recurs for the 14th time, and the smallest failing subject on record retires the size model outright.** 24 of 67 `screenshot` calls failed (35.8%). A COMPONENT with a `nodeCount` of **3** failed at `scale: 0.6`. A 384×224 COMPONENT failed at scale 1 *and* at `format: "SVG"`. The board `141:26` failed **six times** across a 19× reduction in pixel area (scale 1.5 → 0.35) and never once succeeded.
- 🆕 **A controlled single-variable experiment inside [BUG-016]: the drop-shadow blur radius flips the outcome.** The agent cleared `effects` on the `Rename dialog` COMPONENT, and its instance — which had just failed at `scale: 1` — exported at **the identical `scale: 1`**. Re-adding a smaller shadow (radius 32 → 12) kept it working. The trigger is the node's *render bounds*, not its nominal size, and it flips at payloads on the order of tens of kilobytes — roughly two orders of magnitude below the "~4MB" the error text still claims.

## Metrics

| Metric | Session 51 | This Session | Change |
|---|---|---|---|
| Total tool calls | 138 | 233 | +69% (build session, not read-only) |
| Figmagent tool calls | 30 (22%) | 194 (83%) | +61pp share |
| Figmagent error rate (flagged) | 9 / 30 (30.0%) | **31 / 194 (16.0%)** | −14.0pp |
| ToolSearch calls | 4 (2.9%) | 4 (1.7%) | −1.2pp |
| Estimated waste % | ~17% (24 of 138) | **~21% (50 of 233)** | +4pp |
| `-32602 invalid_union` protocol crashes | 0 | **0** | **holds (7th session)** |
| Fell back to the *official* Figma MCP | no | **no** | **holds (7th session, 3rd project)** |
| `screenshot` failure rate | 8 / 11 (72.7%) | **24 / 67 (35.8%)** | −36.9pp (still the worst tool) |
| Calls lost to the [BUG-016] family | 10 | **37** (24 fail + 7 forced retries + 4 diagnostic reads + 2 experiments) | — |
| `import_library_components` failure rate | n/a | **3 / 7 calls, 21 / 21 components on first attempt** | — |
| `run_script` share of Figmagent calls | 0% | **27% (52)** | — |
| `write` / `edit` calls | 0 / 0 | **1 / 2** | build done via `run_script` |
| Silent (unflagged) failures | 2 | **0** | −2 |

## Tool Call Distribution

| Tool | Calls | Errors | Notes |
|---|---|---|---|
| `screenshot` | 67 | 24 | **35.8% failure** — [BUG-016]. 7 further calls are forced retries of a just-failed node |
| `run_script` | 52 | 4 | 27% of Figmagent calls; 3 of the 48 successes are pure [BUG-018] workaround |
| `Bash` | 34 | 3 | reading the React/SCSS source being ported; 2 errors are `cd` scope slips |
| `search_library_components` | 19 | 0 | 14 of them single-icon lookups in two contiguous runs — batch candidate |
| `read` | 15 | 0 | 4 called solely to diagnose a `screenshot` failure |
| `get_enabled_library_variables` | 9 | 0 | the library-token discovery path — works |
| `component_properties` | 8 | 0 | |
| `import_library_components` | 7 | 3 | 21 components failed on first attempt, all recovered — [BUG-018] |
| `ToolSearch` | 4 | 0 | 1.7% overhead |
| `combine_as_variants` | 4 | 0 | |
| `import_library_variable` | 3 | 0 | |
| `edit` | 2 | 0 | |
| `use_file`, `get_local_components`, `grep`, `get_library_components`, `get_component_variants`, `write`, `set_focus`, `lint` | 1 each | 0 | `set_focus` returned `undefined`/`undefined` — [BUG-024] |
| `AskUserQuestion` | 1 | 0 | |
| **Total** | **233** | **34** | |

## Error Analysis

### 1. [BUG-016] `screenshot` "no image data" — 24 failures, 14th recurrence (~37 calls lost)

The error text every one of the 24 failures returned, verbatim:

> Error exporting node as image: the export for node `<id>` returned no image data. This usually means the rendered payload exceeded the ~4MB return cap. Fix: re-request at a lower `scale` (e.g. scale: 0.5), or use `format: "SVG"` — vector output is far smaller than a raster render of a large board. Exporting a smaller child node instead of the whole board also works.

Session 51 retired the "image size" model in favour of response size. This session supplies the evidence that kills the *stated number* as well, and it does so with a real experiment rather than an inference.

**New evidence A — the smallest failing subject on record.** `158:953` is `Scale=Font sizes`, a COMPONENT whose own `read` reports **`nodeCount: 3`** (a `Label` frame and a `Body` frame). It failed at `scale: 0.8` and again at `scale: 0.6`. Three nodes cannot render 4MB at 60%.

**New evidence B — both prescribed remedies exhausted, third session running.** `145:159` (`Rename dialog`, COMPONENT, **384×224**, 9 nodes) failed at `scale: 1.5`, `scale: 1`, `scale: 1.5`, and then at **`format: "SVG"`** — the error message's own second remedy. Sessions 48 and 51 recorded the same exhaustion; this is the third.

**New evidence C — a 19× pixel-area reduction changes nothing.** `141:26` (`Brand editor · components`, the whole board) failed six times, at scales 1.5, 0.9, 0.5, 0.35, 0.55 and 0.4. It never succeeded. Meanwhile `142:2349` and `146:130` exported fine at `scale: 2` in the same minutes. Scale is not the governing variable.

**New evidence D — a controlled single-variable experiment.** This is the important one, because the agent isolated a cause rather than shrinking numbers:

| # | Call | Result |
|---|---|---|
| 168 | `screenshot({nodeId: "150:2241", scale: 1})` | **FAIL** |
| 169 | `run_script` — "Temporarily clear rename dialog shadow to test export": `n.effects = []` on `145:159` | ok |
| 170 | `screenshot({nodeId: "150:2241", scale: 1})` — **byte-identical input** | **SUCCESS** |
| 171 | `run_script` — re-add a shadow at `radius: 12` (was `radius: 32`, `offset.y: 9`, `a: 0.35`) | ok |
| 172 | `screenshot({nodeId: "150:2241", scale: 1})` | **SUCCESS** |

`150:2241` is an INSTANCE of `145:159`, so clearing the component's `effects` propagated to it. The only variable that moved is the drop shadow's blur radius. Figma's export covers `absoluteRenderBounds`, which includes effect bleed — a radius-32 shadow on a 384×224 node expands the raster to roughly 448×297, about **1.55× the pixel area**. A 1.55× swing at a base payload of a few tens of kilobytes flipped the call from fail to pass. Whatever ceiling is actually being hit, it is nowhere near 4MB, and it moves with render bounds rather than with `scale`.

**Why this keeps costing.** The message states a diagnosis and two fixes with full confidence. The agent did exactly what CLAUDE.md's "no user-facing error without a stated fix" contract trains it to do — it believed the fix and worked the scale ladder: 1.5 → 0.9 → 0.5 → 0.35 on one node, 0.8 → 0.6 on another, and 0.24 → 0.15 on a third (`159:1348` — a new record for the smallest failing scale on a *successful* retry). 37 calls went into a diagnosis the tracker retired two sessions ago.

**Root cause is still the line session 47 pinned.** `src/figmagent_mcp/remote/client.ts:109-114` remains unchanged:

```ts
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
```

An oversized or truncated response from `use_figma` fails `JSON.parse`, the raw string is returned, `hasImageData()` sees no `imageData`, and `export.ts:37-49` prints the cap story. The guard is correct — it is the diagnosis attached to it that is wrong.

**Fix needed (unchanged from the v4/v5 proposal, now with the evidence to justify it):**
1. Repair the transport at `remote/client.ts:110-114` — a `JSON.parse` failure is a transport error and must be thrown, not silently downgraded to a string. This closes [BUG-016] and [BUG-027] together.
2. **Delete the "~4MB return cap" sentence and the `scale`/SVG remedies from `export.ts`'s `OVERSIZED_FIX`.** Three sessions of evidence say they are wrong and they cost calls every time. Replace with a true statement: the render did not survive the round trip; retry once, and if it fails again export a child node.

### 2. [BUG-018] `import_library_components` page-mismatch — 21/21 components failed, and the fix is now proven (3 A/B pairs)

Every failed component carried:

> `Error: in set_selection: The selection of a page can only include nodes in that page` … `(atomic: no changes were applied; safe to retry)`

The tracker's standing hypothesis was *"the remote `use_figma` VM's `currentPage` is not the page the node lives on."* This session confirms it and verifies the fix, three times, with the payload held constant:

| Fail | Intervention | Retry | Result |
|---|---|---|---|
| #55 — 17 components, `parentNodeId: 137:14` → **0/17** | #56 `run_script`: `await figma.setCurrentPageAsync(page)` where page = `132:4931` ("Brands") | #57 — **identical 17-component payload** | **17/17** |
| #83 — 1 component → **0/1** | #85 same script, description *"Re-set current page to Brands"* | #86 | **1/1** |
| #97 — 3 components → **0/3** | #99 same script | #100 | **3/3** |

Two facts fall out of this that the tracker did not have:

1. **The fix is one call, and it works with the import payload untouched.** Not a workaround, not a different tool — `setCurrentPageAsync` on the page owning `parentNodeId`, then the existing import path succeeds completely.
2. **`currentPage` does not persist between remote calls.** The agent had to re-set it before *each* import (note #85's own description: "Re-set current page to Brands"). Every `use_figma` invocation starts a fresh VM whose `currentPage` is the file's default page. So the fix cannot be a one-time setup step — it belongs inside the import handler, on every call.

**Fix needed**: in the remote import path, resolve the page owning `parentNodeId` and `await figma.setCurrentPageAsync(page)` before importing (or drop the `set_selection` step, which serves no purpose in a headless VM). The `write({type: "INSTANCE", componentKey})` workaround verified in session 48 remains valid but is no longer the best available answer.

### 3. [BUG-024] `set_focus` reports success with `undefined` name and id — 3rd recurrence

`set_focus({nodeId: "149:323"})` (#179) returned `Focused on node "undefined" (ID: undefined)`. Unchanged since session 45: `remote/transport.ts:30-34` short-circuits with a correct explanatory `note`, and `tools/scan.ts:144-152` discards it in favour of fields the short-circuit never sets. One-line fix, still open. Cost here was one call — the agent did not build on the false success this time.

### 4. `run_script` errors — 4 failures, all correctly reported

| # | Error | Class |
|---|---|---|
| 88 | `in set_isExposedInstance: Can only expose instances that have exposed nested instances or children with component property references` | Figma API constraint, correctly surfaced |
| 133 | `in setProperties: Property value is incompatible with component property type` | agent error |
| 217 | `in set_fontName: Cannot use unloaded font "Playfair Display Regular"` | missing `loadFontAsync` — the message states the exact fix |
| 229 | `in setBoundVariable: fills and strokes variable bindings must be set on paints directly` | **the known `fig.bindVariable` stroke gap** — recurrence |

All four carried `(atomic: no changes were applied; safe to retry)` and all four were recovered in one follow-up call. This is the failure mode working as designed.

## Efficiency Issues

### 1. `search_library_components` has no batch form (saves ~12 calls)

19 calls, of which **14 were single-icon lookups in two contiguous runs** — `sides`, `fullscreen`, `border`, `people`, `more-vertical`, `plus`, `settings`, `upload`, `image`, `check`, `color`, `arrow-left` (#40–#51), then `chevron-left` (#82). Each is one query returning one icon key.

**Root cause**: the tool takes a single `query` string. [TOOL-013]'s sibling entry at tracker line 699 already proposes `queries: string[]` returning grouped results; this session is the clearest cost yet.

**Estimated savings**: 14 calls → 2.

### 2. `lint` cannot verify library-variable bindings (recurrence, no new fix)

The single `lint({nodeId: ["141:26", "149:323"]})` (#222) returned `totalNodesScanned: 0, totalIssues: 0` with `is_error` unset, plus the [TOOL-024] routing message naming all 14 enabled library collections and the correct next tools.

**The routing fix is working** — the agent read it, did not loosen filters and retry (the sessions 40/41 dead end), and went straight to `get_enabled_library_variables`. That is [TOOL-024]'s behavioural half verified for the third session running.

**What is still missing** is unchanged from session 48: after building two whole boards against library tokens, the agent had no way to verify a single binding. `summary.totalIssues: 0` reads as a clean bill of health when the tool in fact scanned nothing — an agent branching on the summary alone would conclude the design is fully tokenized. The `message` field is what saves it, and only for an agent that reads past the summary.

**Proposed fix**: when `lint` short-circuits on a library-only file, the summary should not report a passing scan. Emit `totalNodesScanned: null` (or a `skipped: true` flag) so the structured verdict matches the prose.

### 3. `screenshot` as the only verification channel (structural, ~37 calls)

67 of 194 Figmagent calls (35%) were screenshots. With `lint` unable to check library bindings (#2 above) and the build done via `run_script` — which forfeits `write`/`edit`'s post-write assertions and mini-lint entirely — the screenshot was the *only* feedback the agent had. That put a 35.8%-failure tool on the critical path for every verification step. This is the same compounding recorded in sessions 49 and 50: `run_script`-heavy building plus library-only tokens leaves visual export as the sole channel, and that channel is the least reliable one in the product.

## What Worked Well

1. **The agent ran real experiments instead of retrying.** Twice — the `effects = []` export test (#169) and the `setCurrentPageAsync` probe (#56) — it changed one variable and re-ran an identical call. Both isolated a genuine cause; the second produced a shippable P0 fix. This is exactly the falsify-don't-confirm methodology the project's own root-cause work is built on, and it is worth encoding as guidance.
2. **Zero fallback to the official Figma MCP, 7th consecutive session, 3rd project** — under a 35.8% screenshot failure rate, which is the condition that caused defection in sessions 44 and 45.
3. **Zero silent failures.** Every one of the 34 errors was flagged. Session 51 had 2 unflagged silent `read` empties; this session had none, and every `read` carried a populated `meta.nodeId`/`name`/`type` — no [BUG-027] fingerprint anywhere in 15 calls.
4. **`run_script`'s atomicity guarantee earned its keep.** All 4 script failures carried `(atomic: no changes were applied; safe to retry)`, and all 4 were recovered in a single follow-up with no orphaned nodes and no cleanup pass.
5. **Batch imports are genuinely fast once they work** — #58 placed **18 library components in one call**, 18/18, and #57 placed 17/17.
6. **[TOOL-024]'s routing message did its job** (see Efficiency #2) — one `lint` call, correct diagnosis, immediate pivot, no progressive-loosening loop.

## Priority Improvements

### Tool Changes (ranked by call savings)

1. **[BUG-018] — `setCurrentPageAsync` in the remote import path.** Root cause confirmed, fix verified 3/3 in-session with payloads held constant. Must run per-call: `currentPage` resets between remote invocations. Saves the 21-component first-attempt loss plus 3 workaround scripts (~6 calls/session, and unblocks the primary library-composition workflow).
2. **[BUG-016] — fix `remote/client.ts:110-114` and rewrite the error text.** Throw on `JSON.parse` failure instead of returning the raw string; delete the "~4MB return cap" claim and the `scale`/SVG remedies from `export.ts`'s `OVERSIZED_FIX`. Closes [BUG-027] in the same change. ~37 calls this session; 14th recurrence.
3. **`search_library_components` — accept `queries: string[]`.** 14 calls → 2 here (tracker line 699).
4. **`lint` — don't report a passing summary on a skipped scan.** `totalNodesScanned: null` or `skipped: true` when short-circuiting on a library-only file.
5. **[BUG-024] — return `typedResult.note` in `tools/scan.ts:144-152`.** One line, three recurrences.

### Agent Skill Updates

1. **Encode the "change one variable and re-run the identical call" pattern.** This session's two experiments are the model: when a call fails and the stated fix does not work, stop laddering the parameter the error names and instead hold the call constant while changing one property of the target. Both times it found the real cause in one step.
2. **Stop the scale ladder at two.** Sessions 48, 51 and 52 all show `scale` reduction failing to fix a `screenshot`; three sessions in, the standing advice should be: one retry, then export a child node — never a descending sequence. Six attempts on `141:26` produced nothing.
3. **Note in the guidelines that `run_script` builds forfeit the assertion layer**, so a `run_script`-heavy session on a library-token file has no automated verification channel at all — plan for `read(detail: "full")` spot-checks rather than relying on `screenshot`.
