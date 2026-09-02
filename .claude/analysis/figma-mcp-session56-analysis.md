# Figma MCP Session 56 Analysis

## Session Overview

- **Transcript**: `.claude/sessions-json/7516416f-fb2f-45a9-beea-7e43ac45277d.json`
- **Duration**: 22 minutes (2026-09-01 23:28 → 23:50 UTC), no idle gaps
- **Total tool calls**: 85 (68 Figmagent, 16 Bash, 1 ToolSearch)
- **Total errors**: 10 hard (`is_error: true`) — all 10 Figmagent (7 `run_script`, 3 `screenshot`); **1 unflagged soft failure** (`set_focus`)
- **Reconnections**: 0 (1 `use_file`)
- **Context restarts**: 0
- **Transport**: remote — Figma file `C4zLeQJs8qkAhFSLwMKP9J` ("Archer")
- **Project**: external `~/Github/storybook`, branch `main` — **fourth analysed session on this project/file** (S53, S54, S55, S56), running 22 minutes after S55 ended
- **Task**: mirror the Storybook `Combobox` component (Base UI + `Combobox.scss` + `config/component.tokens.json`) into the Archer file — six top-level components on a new `Combobox` page, bound to `combobox/*` variables, annotated and linted

The session **completed its task**: `Combobox Field` (8 variants), `Combobox Item` (6), `Combobox Chip`, `Combobox Chips Field` (4), `Combobox Popup` (3), and a composite `Combobox` set (2) — 6 sets/components, 24 variants, ~120 nodes, 18 annotations applied 18/18, all built with **zero** `write`, `create`, `combine_as_variants` or `component_properties` calls.

The headline finding is a **new root cause for width-0 text**, and it invalidates the remedy currently written into CLAUDE.md. A TEXT node whose font family is unavailable in the remote VM measures at **width 0**, and every sizing operation downstream — `HUG`, `FILL`, `layoutGrow`, `primaryAxisSizingMode` — is a silent no-op from there. [BUG-009]'s documented two-pass repair (`textAutoResize: HEIGHT` then FILL) does **not** work; only an explicit `resize()` does. Diagnosing this consumed 19 calls and 5.5 of the session's 22 minutes. A second control (#50) shows the failure depends on **which donor family** the node was authored on before the `fontFamily` variable rebound it — and `SF Pro`, the donor [BUG-033]/[BUG-035] currently recommend, is one of the four that measure 0.

## Metrics

| Metric | Session 54 | Session 55 | This Session | Change vs S55 |
|---|---|---|---|---|
| Total tool calls | 73 | 92 | 85 | −8% |
| Figma tool calls | 53 | 79 | 68 | −14% |
| Official-MCP calls | 0 | 0 | **0** | held (**10th consecutive**) |
| Hard errors | 9 | 16 | 10 | −6 |
| Figma error rate | 17.0% | 19.0% | **14.7%** (10 of 68) | **−4.3pp** |
| Unflagged soft failures | 2 | 0 | 1 (`set_focus`) | +1 |
| `run_script` share of Figma calls | 54.7% | 29.1% | **55.9%** (38 of 68) | **+26.8pp — new record** |
| `run_script` share of write ops | 74% | 46.3% | **92.3%** (24 of 26) | **+46.0pp — new record** |
| `screenshot` failure rate | 37.5% | 44.4% | **16.7%** (3 of 18) | **−27.7pp — best on record** |
| ToolSearch | 2 (2.7%) | 3 (3.3%) | **1 (1.2%)** | −2.1pp |
| Estimated waste % | ~34% | ~35% | **~38%** (32 of 85) | +3pp |

Waste composition (32 calls): 10 hard errors · **19 font/width-0 diagnosis and repair calls** (#30, #31, #33–#40, #42, #44, #45, #49–#52, #58, #59) · 1 `read` budget re-request (#15) · 2 `screenshot` child/scale retries (#63, #72).

Two numbers move in opposite directions and both are worth keeping. `screenshot` and `ToolSearch` are the cleanest of any session on this file — the behavioural fixes are holding. `run_script` reversed S55's entire improvement in one session on the *same file, same day, same agent*: 92.3% of write operations went through the escape hatch, against 46.3% 22 minutes earlier. Neither the file nor the tooling changed between them, which makes S55's reversal look like task shape rather than a durable behaviour change.

## Tool Call Distribution

| Tool | Calls | Errors | Notes |
|---|---|---|---|
| `run_script` | 38 | 7 | 55.9% of Figma calls; 24 in `mode: "write"`. Built all 6 components, all 6 component properties, every variable binding |
| `screenshot` | 18 | 3 | [BUG-016] 18th recurrence — **lowest failure rate on record**; recovery was textbook |
| Bash | 16 | 0 | source reading (`Combobox.tsx/.scss/.stories.tsx`, `component.tokens.json`, `tokens.css`, `_mixins.scss`) + memory writes |
| `read` | 6 | 0 | orientation on the existing Autocomplete page; 1 call lost to a 1.2% budget overrun |
| `use_file` / `grep` / `edit` / `lint` / `set_multiple_annotations` / `set_focus` | 1 each | 0 | `edit` moved 6 nodes in one call; annotations applied 18/18 |
| ToolSearch | 1 | 0 | a single 13-tool opening slice, never topped up |

**Zero calls** to `write`, `create`, `combine_as_variants`, `component_properties`, `get_design_system`, or `get_local_components`. Variable discovery went through a `run_script` regex over `getLocalVariablesAsync()` (#16) rather than `get_design_system`.

## Efficiency Issues

### 1. A TEXT node on an unavailable font measures at width 0, and the documented repair does not work (saves ~19 calls)

Calls #30–#52 — 23 calls in 5.5 minutes, 19 of them pure waste — chased three `Combobox Item` labels stuck at `width: 0`. The build script (#27) created each label on an available donor face (`SF Pro / Semibold`), appended it, applied `layoutSizingHorizontal: FILL`, then bound the `font/family/sans` variable. The binding rewrote the family to `PP Neue Montreal`, which does not exist in the remote VM ([BUG-033]), and the node's measured width went to 0.

**Pattern observed** — #35 is the smoking gun, two sibling labels in the same component set:

```
mine_regular   42:63  font PP Neue Montreal/Regular   missing: true   w: 298   ✓
mine_semibold  42:67  font PP Neue Montreal/Semibold  missing: true   w: 0     ✗
```

Same missing family, same characters, same parent — one measures correctly, one measures 0. Every repair the agent tried from that state was a no-op:

| Call | Attempt | Result |
|---|---|---|
| #30 | re-apply `layoutSizingHorizontal: FILL` | `w: 0, 0, 0` |
| #32 | `textAutoResize: HEIGHT` (CLAUDE.md's documented fix) | **threw** — "Cannot write to node with unloaded font" |
| #36 | toggle `primaryAxisSizingMode` AUTO → FIXED, then `resize(320)` on the parent | `before: 0, mid: 0, after: 0` |
| #38 | hide the sibling `Indicator` frame | `0` → `0` → `0` |
| #39 | unbind `fontFamily`, set available face, then **explicit `resize()`** | `a: 0, b: 0, hug: 0, fixed: 275` ✓ |

Only the explicit `resize()` unstuck it. #45 is the control on `Inter` (a font that exists): the same construction measured 55, not 0 — so the width-0 state is caused by the missing font, not by the FILL-before-resize ordering.

**#50 is the finding that matters most.** The agent built the same missing-`PP Neue Montreal/Semibold` node five times, varying only the donor family:

```
SF Pro                  → renders: false, w: 0
SF Pro Rounded          → renders: false, w: 0
SF Compact              → renders: false, w: 0
SF Compact Rounded      → renders: false, w: 0
Noto Sans New Tai Lue   → renders: false, w: 228
```

After the `fontFamily` rebind the node reports `PP Neue Montreal/Semibold` in all five cases, but keeps measuring on the **donor's** metrics — and four of the five donors measure the absent face at 0. `SF Pro` is exactly the donor [BUG-033] and [BUG-035] currently recommend (chosen in S55 because its style name spells "Semibold" the way the target face does). The remedy the tracker prescribes is the one that produces the width-0 state.

**Root cause**: [BUG-033] (the VM cannot load the file's own custom fonts) compounding [BUG-009] (FILL is a silent no-op from width 0). The new fact is the mechanism connecting them, and the fact that [BUG-009]'s two-pass recipe fails here — `textAutoResize: HEIGHT` *throws* on a missing-font node rather than resizing it.

**Proposed fix**: (a) after any `setBoundVariable("fontFamily", …)` or `fontName` write that leaves `hasMissingFont: true`, check `width === 0` and emit a `width_collapse` warning naming the real cause and the `resize()` remedy — the post-write assertion suite already has the category; (b) amend the swap-write-rebind recipe in [BUG-033]/[BUG-035] and CLAUDE.md to require an explicit `resize()` **after** the rebind, and to stop naming `SF Pro` as the preferred donor without that step; (c) correct CLAUDE.md's "Repairing a width-0 TEXT node" paragraph — `textAutoResize: HEIGHT` is not a valid first step when the node's font is missing.

**Estimated savings**: ~19 calls → ~2 on any custom-font file. Tracked as **[BUG-040]**.

### 2. `run_script` monoculture returns at a new record — 92.3% of write operations (saves ~10 calls)

[AGENT-025]'s 7th recurrence, and the worst instance measured. Every structural operation in the session went through `run_script`:

| Operation | Calls | First-class tool that exists |
|---|---|---|
| Create 6 component sets / ~120 nodes | 24 `run_script` | `write` (0 calls) |
| Combine variants (6 sets) | inline `figma.combineAsVariants` | `combine_as_variants` (0 calls) |
| Define 6 component properties | inline `addComponentProperty` | `component_properties` (0 calls) |
| Discover variables | 1 `run_script` regex over `getLocalVariablesAsync()` | `get_design_system` (0 calls) |
| Position 6 top-level nodes | 1 `edit` ✓ | — |

Of the 24 write scripts, a defensible ~8 were forced by named gaps already in the tracker ([TOOL-032] `write` cannot bind at create time, [TOOL-039] `edit` cannot set `effects`, [TOOL-037] `fontWeight`, [TOOL-027] `layoutPositioning`). The remaining ~16 built ordinary component trees that S55's #30 proved `write` handles — that call created 8 COMPONENT roots and 32 nodes in one shot on this same file.

**Root cause**: the agent adopted a script-first shape at #10 (page listing) and never left it. Once the font debugging started at #30, `run_script` was also the only surface that could *read back* what it had written, which reinforced the pattern for the remaining 40 calls.

**Proposed fix**: this is the 7th recurrence against no tooling change. The measurable version — worth shipping over more guidance — is [TOOL-033]: give `run_script` the post-write assertions and mini-lint that `write`/`edit` already return. The agent stays in `run_script` partly because leaving it costs the verification it gets for free inside a script.

**Estimated savings**: ~10 calls per build session.

### 3. `fig.bindVariable` has no `fontWeight` field — one rejection discarded a 60-node atomic script (saves ~2 calls)

Call #26 assembled the entire `Combobox Item` set — 6 variants, ~40 nodes, 12 variable bindings — and was rejected wholesale:

```
Unsupported variable field: fontWeight. Fix: use one of: fills, fill, strokes, stroke,
opacity, cornerRadius, …, fontSize, fontFamily, fontStyle, lineHeight, letterSpacing,
paragraphSpacing, paragraphIndent
(atomic: no changes were applied; safe to retry)
```

This is [TOOL-037] (`edit` cannot bind `fontWeight`, and the stated reason is false) surfacing on the **`run_script` stdlib** rather than the `edit` tool. Same `FIELD_MAP` in `src/figma_plugin/src/commands/styles.js`, same false premise. The agent worked around it in #27 with a raw `node.setBoundVariable('fontWeight', v)` — which Figma accepted, exactly as [TOOL-037] documents.

**Root cause**: `fig.bindVariable` shares `FIELD_MAP` with `apply.js`, so [TOOL-037]'s fix covers both surfaces. Worth recording because the tracker entry names only `edit`, and a fix scoped to `apply.ts`'s Zod enum would leave the script path broken.

**Proposed fix**: [TOOL-037]'s remedy, with the note that `FIELD_MAP` is the shared choke point — adding `fontWeight` there fixes `edit` and `fig.bindVariable` in one change.

**Estimated savings**: ~2 calls per weight-tokened session, on top of [TOOL-037]'s ~6.

### 4. `fig.prop` throws a raw `TypeError` on a deleted node, naming neither the node nor a fix (saves ~1 call)

Call #43 tried to diff a working TEXT node against a broken one:

```js
async function d(id){ const n = await figma.getNodeByIdAsync(id); const o={};
  for (const k of keys) o[k] = fig.prop(n, k); … }
return { good: await d('27:29'), bad: await d('42:67') };
```

```
TypeError: invalid 'in' operand
    at z (PLUGIN_133_SOURCE:1:532)
    at d (PLUGIN_133_SOURCE:7:120)
```

Node `42:67` had been replaced at #37, so `getNodeByIdAsync` returned `null` and `fig.prop`'s `k in node` guard threw on a non-object. The message names no node ID, no property, and no fix — in a session where the whole point of the call was to find out which node was broken. The agent recovered in one call (#44, adding a null check), but this is precisely the class CLAUDE.md forbids: *"No user-facing error without a stated fix."*

**Proposed fix**: in `src/figma_plugin/src/remote_entries/stdlib.js`, guard `fig.prop` — when the node argument is null/undefined or not an object, `fail()` with the node argument echoed and the fix ("`getNodeByIdAsync` returned null — the node was deleted or belongs to another file; check the return value before reading properties"). Same one-line shape as [BUG-024]'s fix.

**Estimated savings**: ~1 call, and it removes an unattributable stack trace from the diagnostic path. Tracked as **[TOOL-044]**.

### 5. `read` discards its whole payload on a 1.2% budget overrun (saves ~1 call)

Call #14 ran `read("27:68", detail: "full", depth: 4, maxOutputChars: 28000)`. The serialiser produced **28,327 chars — 327 over** — and returned the `meta` block plus four narrowing hints instead of the tree. #15 re-ran the identical call at `maxOutputChars: 32000` and got it.

This is [TOOL-043]'s exact shape on a second tool: `lint` was measured throwing away 39 issues on a 5.4% overrun; `read` throws away a whole subtree on a 1.2% one. `grep` already solved this — it paginates into budget-sized pages of whole groups. Mitigating credit: the overrun message states the precise number to pass (`maxOutputChars: 29327`), which is why recovery cost exactly one call and not a bisection.

**Proposed fix**: generalise [TOOL-043] from `lint` to `guardOutput` itself — when the overrun is under some margin (or in general), trim to whole nodes/groups that fit and report `shown: N of M`, rather than returning nothing.

**Estimated savings**: ~1 call per over-budget read.

## Error Analysis

### 1. Unavailable custom font (3 hard failures, plus the 19-call spiral in issue 1)

[BUG-033]'s **4th** recurrence, on a 4th component in the same file. Three distinct operations broke, each with Figma's own text and no Figmagent remedy:

- #32 `set_textAutoResize` — `Cannot write to node with unloaded font "PP Neue Montreal Semibold"`
- #66 `appendChild` — `unloaded font "PP Neue Montreal Regular"`
- #67 `set_fontName` — `Cannot use unloaded font "PP Neue Montreal Regular"`

#52 asked the VM directly for all four faces and got, for each: `The font family "PP Neue Montreal" does not exist.` — followed by Figma's own `Fonts from text styles: - PP Neue Montreal (Regular, Medium, Semibold, Extrabold)`. That corroborates S55's observation (b): **the VM knows exactly which family the file needs and that it cannot load it**, and that is the information Figmagent's errors should carry instead of "call `loadFontAsync` first", which is unactionable for a font that does not exist.

**Agent recovery**: good but expensive. It converged on parking every label on `Inter`/`SF Pro`, building, then rebinding `fontFamily` last — the swap-write-rebind order [BUG-033] documents — and applied it pre-emptively from #68 onward, at which point no further font error occurred in 18 calls. The cost is standing: **3 of the 24 write scripts (#58, #59, #68) existed only to perform the dance**, matching S55's measurement exactly.

**Fix needed**: unchanged from [BUG-033] remedy (a) — branch in the shared font loader on `listAvailableFontsAsync` and state the real cause. This session adds that the remedy text must now include the explicit `resize()` step and must not name `SF Pro` as the donor without it (see [BUG-040]).

### 2. `setProperties` states a fix for the wrong problem (2 failures, ~3 minutes lost)

[BUG-039]'s **2nd** recurrence, and the first outside session 55. Calls #57 and #60 both assembled the `Combobox Popup` set by instantiating `Combobox Item` and calling `setProperties` to set each label:

```
Error running script: Error: in setProperties: Unable to update this text property
because the component uses a font that isn't available.
    at item (PLUGIN_11_SOURCE:41:25)
```

Both were atomic, so the whole Popup set was discarded twice. Between them the agent spent #58 and #59 proving that parking the *main component's* labels on a loadable face is what unblocks instance text writes — 2 calls to derive a remedy the tracker already contains.

**Agent recovery**: correct but slow. It read past the message, identified the font cause, and pivoted — but took two full script attempts and two probes to get there, where S55 took one. The difference is that here the failure was inside a 90-line assembly script, so each retry cost a full rebuild.

**Fix needed**: unchanged — `src/figma_plugin/src/commands/apply.js:675-683` should branch on `/font.*(isn't|is not|not) available|unloaded font/` and state the parking remedy. Escalating relevance: this is now the second file and second session, and the remedy it should print is one the project has already written down twice.

### 3. `screenshot` export failures (3 of 18 — [BUG-016]'s 18th recurrence, and the best recovery on record)

| # | Node | Scale | Result |
|---|---|---|---|
| 62 | `55:67` Popup **set** (3 variants) | 0.75 | FAIL |
| 63 | `55:47` Popup variant (`Content=Groups`) | 1.0 | **OK** |
| 65 | `55:34` Popup variant (`Content=Items`) | 1.0 | **OK** |
| 69 | `55:246` Combobox **set** (2 variants) | 0.75 | FAIL |
| 70 | `55:196` `Type=Single` | 1.0 | **OK** |
| 71 | `55:219` `Type=Multiple` | 1.0 | FAIL |
| 72 | `55:219` `Type=Multiple` | 0.5 | **OK** |

**This partially contradicts S55's discriminator.** #61 put a live `DROP_SHADOW` (radius 15, spread −3, variable-bound colour) on all three Popup variants, so a shadow is present in every subtree in the table — yet `55:34` and `55:47` exported cleanly at scale 1.0, and `55:196` (a Popup instance inside a composite) did too. Shadow presence alone does not predict the failure here. What sorts the rows is **how many shadowed subtrees are in the export**: 3 → fail, 2 → fail, 1 → passes three times out of four. The one exception (`55:219` at 1.0, one shadowed subtree, fail → pass at 0.5) sits right at the threshold. Read together with S55, the model is *render bounds / response size, with a live effect as a large multiplier* — S51's model, with S55's amplifier — rather than a binary effects switch.

**Agent recovery — the best of any session on this file.** All three failures were handled by exporting a **child node**, which is [AGENT-031]'s prescription, and only one scale step was ever taken (`55:219` at 1.0 → 0.5, then stop). No descending ladder, no permutation. [AGENT-031] executed correctly for the 3rd consecutive session, and the resulting 16.7% failure rate is the lowest across 18 sessions of this bug.

### 4. `fig.bindVariable` `fontWeight` rejection (1 failure) — see efficiency issue 3.

### 5. `fig.prop` `TypeError` on a null node (1 failure) — see efficiency issue 4.

### 6. `set_focus` reports success with `undefined` (1 unflagged soft failure — not a regression)

Call #85 returned `Focused on node "undefined" (ID: undefined)` with `is_error: false` — [BUG-024]'s 4th occurrence. **This predates the fix and does not reopen it**: `3358711 review(BUG-024/025/026)` landed 2026-09-02 02:39 UTC, and this call ran 2026-09-01 23:47 UTC, roughly three hours earlier. `buildFocusResult` in `tools/scan.ts:143-146` now returns the remote short-circuit's `note` plus `NO_OP_FIX`. The next session on this file is the one that verifies it; [BUG-024] stays `implemented`.

## What Worked Well

1. **ToolSearch discipline — 1 call, 1.2% overhead, the lowest measured.** A single `select:` slice loaded 13 tools at #7 and was never topped up. Against S53's 4 calls (4.7%) on the same project, this is a clean win.

2. **`screenshot` recovery followed [AGENT-031] exactly.** Three failures, three child-node exports, one single scale step, zero laddering — and the lowest [BUG-016] failure rate in 18 sessions. The behavioural fix is holding for a 10th session across 4 projects.

3. **Source-first grounding before touching Figma.** Six Bash calls (#1–#6, #8) read `Combobox.tsx`, `Combobox.scss`, `Combobox.stories.tsx`, the component token JSON, the generated `tokens.css`, and `_mixins.scss` before the first Figma call — and #5 read the project's own `figma_design_system.md` memory, and #24 its `figma-remote-vm-gotchas.md`. The resulting layer names track code parts (`Input`, `Trigger`, `Clear`, `Indicator`, `Group Label`, `Empty`, `Remove`) rather than CSS classes, and the 18 annotations carry the things Figma cannot hold (`--anchor-width` popup sizing, the two-layer focus ring, `[data-highlighted]` as virtual focus, `&:empty` collapse).

4. **#50 is real science, and it is the reusable artefact of this session.** Five donor families, one variable held constant, one call, an unambiguous split (four at 0, one at 228). That single call produced a fact no amount of retrying would have — and it directly contradicts a remedy the tracker has been prescribing since S55. This is the [AGENT-031] positive counterpart ("hold the call constant, change one property of the target") applied to a font bug rather than a screenshot bug.

5. **Atomicity paid for itself.** Every one of the 7 `run_script` failures returned `(atomic: no changes were applied; safe to retry)`, including two 90-line assembly scripts that failed midway. #78's structural `read` at the end found exactly 6 top-level nodes on the page — no orphans, no half-built sets, despite two discarded Popup builds and one discarded Item build.

6. **One `edit` call repositioned all 6 top-level components** into a planned zone layout (`y: 0 / 344 / 596 / 889 / 1223`), and `set_multiple_annotations` applied 18/18 in a single batch. Both are the batch-first shape CLAUDE.md asks for — they are also the only two first-class write calls in the session.

## Priority Improvements

### Tool Changes (ranked by call savings)

1. **[BUG-040] — width-0 detection on missing-font nodes.** Emit a `width_collapse` warning when a font write or `fontFamily` bind leaves `hasMissingFont: true` and `width === 0`, naming the `resize()` remedy. Saves ~19 calls on any custom-font file; nothing at any layer currently warns.
2. **[BUG-033] remedy (a) — branch the font loader on `listAvailableFontsAsync`.** Fourth session, four components, three more hard failures. Figma's own error already enumerates the missing family; Figmagent discards it and prints "call `loadFontAsync` first". Also update the documented remedy per [BUG-040].
3. **[TOOL-037] — add `fontWeight` to `FIELD_MAP`.** The shared choke point fixes `edit` *and* `fig.bindVariable`; a fix scoped to `apply.ts`'s Zod enum would leave the script path broken.
4. **[TOOL-033] — post-write assertions inside `run_script`.** The most credible lever on [AGENT-025]: the agent stays in the escape hatch partly because leaving it costs the verification a script gives it for free.
5. **[BUG-039] — branch the `setProperties` catch on the font-unavailable shape.** Second session, second file; the remedy it should print is already written down twice.
6. **[TOOL-044] — guard `fig.prop` against a null node.** One line, removes an unattributable `TypeError` from the diagnostic path.
7. **[TOOL-043] generalised — trim over-budget output instead of discarding it.** Measured on `lint` (5.4% overrun) and now `read` (1.2% overrun). `grep` already paginates; the other two should at least trim and report `shown: N of M`.

### Agent Skill Updates

1. **Correct CLAUDE.md's width-0 paragraph.** `textAutoResize: HEIGHT` *throws* on a missing-font node — it is not a valid first step. The missing-font case needs an explicit `resize()` and is a different failure from the `WIDTH_AND_HEIGHT`-under-a-constrained-parent case already documented.
2. **Amend the swap-write-rebind recipe.** Add the `resize()` step after the rebind, and stop naming `SF Pro` as the donor without it — #50 shows it is one of four donors that measure the rebound face at 0.
3. **Reach for `write` before `run_script` for ordinary component trees.** S55 #30 built 8 COMPONENT roots and 32 nodes in a single `write` on this exact file; this session built comparable trees with 16 hand-written scripts. [AGENT-025], 7th recurrence.
4. **Close out a build against a re-run of `lint`, not against the first run's summary.** #76 found **93** issues under a `maxIssues: 60` cap — 33 were never returned — reporting `fills: 50` and `near_match: 47`. #77 then cleared 20 stray icon fills, and the session closed claiming all six components were "bound to `combobox/*` variables" without a second `lint`. The claim may well be right; nothing in the session measures it. Tracked as **[AGENT-034]**.
