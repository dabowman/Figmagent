# Figma MCP Session 58 Analysis

## Session Overview

- **Transcript**: `.claude/sessions-json/05ec0bc5-ee21-4573-a362-d9b5ef92284c.json`
- **Project**: external — `~/Github/storybook` (6th analysed session on the "Archer" Figma file)
- **Transport**: remote (`use_figma` VM)
- **Duration**: 19 minutes (2026-09-01 23:27:22 → 23:46:37 UTC)
- **Total tool calls**: 69 (55 Figmagent, 11 Bash, 3 ToolSearch)
- **Total errors**: 4 (3 `screenshot`, 1 `read`) — 5.8% of calls
- **Reconnections**: 0
- **Context restarts**: 0
- **Task**: Mirror the Storybook `Button` component (Base UI + `Button.scss` + `config/component.tokens.json`) into the Archer Figma file as a 60-variant COMPONENT_SET, then reconcile Alert Dialog's hand-rolled action frames into real Button instances.

### Concurrency note — three sessions, one file

This session started at 23:27:22, **55 seconds before session 55 ended** and ~1 minute before sessions 57 (23:28:22) and 56 (23:28:40) started. It overlapped session 56 by **18 minutes** and session 57 by **10 minutes**. For roughly ten minutes, three independent MCP processes were writing the same Figma file through the remote transport. No cross-session interference is visible in the transcript — no lost writes, no ID collisions, no queue timeouts — which is a useful (if incidental) validation of the per-fileKey FIFO in `remote/executor.ts`. The Archer cohort now reads, by clock: 53 (Accordion) → 54 (AlertDialog) → 55 (Autocomplete) → **58 (Button)** → 57 (Checkbox) → 56 (Combobox).

## Metrics

| Metric | Session 57 | This Session | Change |
|---|---|---|---|
| Total tool calls | 35 | 69 | +97% (larger task: 60 variants vs 9) |
| Figmagent tool calls | 21 | 55 | +162% |
| Errors | 2 (all figma) | 4 (3 figma + 1 figma) | 5.8% vs 5.7% — flat |
| `run_script` share of figma calls | 52.4% (11/21) | **36.4% (20/55)** | −16pp |
| `run_script` share of write ops | 85.7% (6/7) | **100% (13/13)** | +14pp — new ceiling |
| `write` / `edit` calls | 0 / 0 | **0 / 0** | unchanged |
| ToolSearch calls | 0 | 3 (4.3%) | +3 (different project — tools are deferred there) |
| Estimated waste % | ~31% | **~28%** (19 of 69) | −3pp |
| Screenshot failure rate | — | **17.6%** (3 of 17) | — |

**Waste breakdown (19 calls):** font-donor hunt 5 · bound-paint-renders-black diagnosis 6 · width-0 text repair 3 · screenshot failures 3 · `grep` reimplemented in `run_script` 1 · "No Figma file selected" 1.

## Tool Call Distribution

| Tool | Calls | Notes |
|---|---|---|
| `run_script` | 20 | 36.4% of figma calls, **100% of write operations**. Two scripts of 3.6KB each built the entire component set. 8 of 20 were diagnostic, not build work. |
| `screenshot` | 17 | 3 failed ([BUG-016], 20th session). Recovery was textbook: one scale step, then child nodes. |
| `Bash` | 11 | Reading Storybook source + tokens; 2 calls writing project memory. |
| `read` | 10 | 1 failed ("No Figma file selected" — remote has no auto-join). |
| `ToolSearch` | 3 | Session ran outside this repo, so Figmagent tools are deferred there. Loaded `write`, `edit`, `combine_as_variants`, `component_properties` — **and then used none of them**. |
| `get_design_system` | 2 | Both filtered by `namePattern`. Efficient. |
| `set_multiple_annotations` | 1 | Batched — good. |
| `get_annotations` | 1 | Batched over 5 nodeIds — good. |
| `set_annotation` | 1 | Single rewrite of the `Actions` annotation. |
| `lint` | 1 | 31 findings on the finished set, all triaged as deliberate. |
| `grep` | 1 | Used once — see efficiency issue 3, where it should have been used twice. |
| `use_file` | 1 | Only after a failed `read`. |

## Efficiency Issues

### 1. A variable-bound paint keeps its literal colour, and the VM renders the literal (saves ~6 calls, and it is a live defect in `edit`)

Every fill and stroke in the 60-variant build was created with the idiomatic call:

```js
figma.variables.setBoundVariableForPaint(
  { type: 'SOLID', color: { r: 0, g: 0, b: 0 }, opacity: 1 }, 'color', v)
```

The binding attached correctly — script #12 read back `boundVariables.color = {type: 'VARIABLE_ALIAS', id: 'VariableID:2:167'}` — but the paint still carried `color: {r:0, g:0, b:0}`, and **that is what the remote VM rendered**. Every button came out black.

**Pattern observed:** four screenshots (23:34:59 → 23:35:58) showed black buttons; script #12 re-applied the binding with an explicit `visible: true` (no change); script #13 checked `explicitVariableModes` on the set, the component, both pages and the working Avatar comparison — **all `{}`**, ruling out a mode-resolution problem — and confirmed `v.resolveForConsumer(c)` returned the correct orange `{r: 0.878, g: 0.325, b: 0}` while the paint held black. Script #14 then wrote `resolveForConsumer(node).value` into the r/g/b of every one of the ~120 bound paints alongside the binding, and the render came good.

**Root cause:** `setBoundVariableForPaint` does not update the paint's literal colour; on the remote render path the literal wins. **Figmagent ships the identical pattern in two places:**

- `src/figma_plugin/src/commands/apply.js:266-273` — when a node has no fills, `edit` **seeds `{r:0, g:0, b:0}`** and binds onto it. So `edit({ nodes: [{ nodeId, variables: { fillColor: "…" } }] })` on a freshly-created fill-less FRAME (which `write` produces by default — CLAUDE.md documents this) renders black on remote. When paints *do* exist, the prior literal survives, which is stale by construction whenever the bound variable holds a different value.
- `src/figma_plugin/src/commands/styles.js:805-809` — `bindVariablesToStyle` seeds the same black for a PAINT style with no paints.

`src/figma_plugin/src/commands/lint.js:522-526` is **safe** by accident: it returns early when `paintCopy.length === 0`, and the literal it binds onto is the value lint matched, so it already equals the resolved variable.

**Proposed fix:** in `apply.js` and `styles.js`, resolve the variable for the consumer node and write the resolved `r`/`g`/`b`/`a` into the paint before calling `setBoundVariableForPaint`. Writing the resolved literal is strictly safe — in the Figma client the binding takes precedence and the literal is only a fallback, so this cannot break mode switching.

**Estimated savings:** ~6 calls in this session; on the `edit` path it converts a silent wrong-colour render into a correct one with no agent-visible cost. → **[BUG-043]**

### 2. Finding a font the VM can actually *measure* costs 5 calls, every session (saves ~5 calls/session)

Script #2 authored the label on `SF Pro / Semibold`. `figma.loadFontAsync` **resolved without throwing** and `n.fontName` read back as SF Pro/Semibold — so the face is genuinely present and loadable in the VM — yet the node measured **`w: 0`**. Recovering from that took three scripts and two screenshots:

- #3 — dump `listAvailableFontsAsync()` (1,938 families) and filter to families offering a one-word `Semibold`
- #7 — swap to `Inter / Semi Bold`, measure `w: 46`
- #8 — swap to `Noto Sans New Tai Lue / Semibold`, measure `w: 51` — the face the session shipped on

**Root cause:** there is no first-class way to ask what the remote VM can render. `get_design_system` already calls `listAvailableFontsAsync()` internally (`styles.js:44`, `:709`) and throws the list away. Because [BUG-033] forces a donor-font swap on every write to this file, this hunt has now recurred across six sessions on the Archer file alone.

**Proposed fix:** expose the VM's font inventory — either a `includeFonts: true` section on `get_design_system` (family → styles, plus a `missing` list for families the file references but the VM lacks) or a small `list_fonts({ familyPattern, style })` tool. → **[TOOL-045]**

### 3. `grep({ variableId: [...] })` already does the cross-page token scan the agent hand-rolled (saves 1 call, but it is the run_script-drift mechanism in miniature)

Script #18 is 1,352 characters that walk every page, read `node.boundVariables`, then separately walk `fills[].boundVariables.color` and `strokes[].boundVariables.color`, matching against a 37-element set of `button/*` variable IDs.

`grep` does exactly this. `src/figmagent_mcp/tools/find.ts:47` declares `variableId` as a **string list**, and `src/figma_plugin/src/commands/find.js:28-75` documents and implements all three lookups — scalar `boundVariables`, `fills[].boundVariables.color`, `strokes[].boundVariables.color` — the same three the script wrote by hand. One `grep({ variableId: [...37 ids] })` replaces the script and returns ancestry paths the script did not compute.

**Root cause:** not a tool gap — a discoverability gap. The agent had `grep` loaded and used it once (call #53) for something else. This is [AGENT-025]'s mechanism visible at single-call resolution: once a session is inside `run_script`, the next capability question gets answered in JavaScript rather than by re-reading the tool surface.

**Proposed fix:** name the multi-ID paint-level case in the `grep` tool description — *"`variableId` accepts an array and matches paint-level bindings on `fills`/`strokes`, so one call answers 'which nodes anywhere use any of these tokens'."* → **[AGENT-035]**

### 4. Width-0 text repair cost 3 scripts, one of them a pure re-read

Scripts #4, #5 and #6 all attacked the same width-0 label. #4 applied the documented recipe (`textAutoResize: 'NONE'` → `resize(60, 16)` → back to `'WIDTH_AND_HEIGHT'`) and returned `labelW: 60`. #5 then tried a `characters` round-trip to force a re-measure — same `60`. #6 re-read the node and component to confirm what #5 had already returned in its own response.

Note that #4's "success" is illusory: 60px was a hardcoded guess, not a measurement. The label only measured honestly once the font changed (46 on Inter, 51 on Noto Sans New Tai Lue). Recurrence of [BUG-040], and a corroboration of [AGENT-034] in the negative — the agent verified against a number it had supplied itself.

## Error Analysis

### 1. `screenshot` "returned no image data" — 3 failures of 17 (17.6%), [BUG-016] 20th session

| # | Time | Node | Scale | Result |
|---|---|---|---|---|
| 3 | 23:34:44 | `42:494` | 0.4 | **success** |
| 8 | 23:36:39 | `42:494` | 0.55 | fail |
| 9 | 23:36:43 | `42:494` | 0.4 | fail |
| 16 | 23:42:44 | `23:3` | 1.0 | fail |
| 17 | 23:42:47 | `23:6` (child) | 1.0 | success |

**This is the cleanest content-vs-dimensions discriminator in the record so far.** Node `42:494` at `scale: 0.4` **succeeded at 23:34:44 and failed at 23:36:43** — same node, same scale, identical pixel dimensions, 2 minutes apart. The only thing that happened in between is script #14, which wrote resolved colours into ~120 paints across all 60 variants. The board went from rendering 60 black rectangles to 60 fully-coloured buttons in four palettes. Nothing about the render *bounds* changed; only the entropy of the pixels inside them.

That result cuts against several standing hypotheses at once: it is not render bounds (constant), not `scale` (constant), and not a live `DROP_SHADOW` (session 55's discriminator, already falsified by session 57 — and there are no effects anywhere in this build). It is consistent with **compressed response payload size**, which is what session 51 concluded when it retired the "~4MB image cap" model.

**Agent recovery — the best on record, and [AGENT-031] executed correctly for a 5th consecutive session.** Exactly one scale step (0.55 → 0.4), then an immediate switch to child-node exports: five individual variants at `scale: 2`, all successful, at 23:36:47–23:36:52. The Alert Dialog failure at #16 was recovered in a single step by exporting the child. No `scale` ladder, no verbatim retry.

**Fix needed:** unchanged from [BUG-016] — the export path must not return a dataless success. The new evidence should be added to that entry: it argues the governing variable is post-render payload size, not geometry, which means an in-VM byte check before return (and an automatic re-encode at reduced quality) is a viable server-side fix that does not require the agent to guess a `scale`.

### 2. `read` on the first Figma call — "No Figma file selected" (1 failure)

Call #7 was `read({})` with no prior `use_file`. Remote has no auto-join, so it failed with the correct, fix-stating message; the agent called `use_file` 42 seconds later and never hit it again. Documented in CLAUDE.md's "Remote-first onboarding" note and in the error text itself. Cost: 1 call. Not worth a tracker entry on its own — but it is now the *third* Archer-cohort session to open with this exact error, which suggests the guidance is not reaching agents in external projects.

### 3. Zero timeouts, zero reconnections, zero unflagged soft failures

Notable given the three-way concurrent write load. Every `run_script` returned a structured result; none of the 13 write scripts silently under-applied. The `is_error` flag was accurate on all 4 failures.

## What Worked Well

1. **`get_design_system` used correctly — filter, don't raise the budget.** Both calls carried a `namePattern` (`^button/`, then a 5-alternative regex for the primitives), returning 525 and 1,155 chars. No truncation, no `maxOutputChars` inflation, no follow-up. This is exactly the behaviour CLAUDE.md prescribes and it has now held for several sessions.

2. **Batch annotations.** `set_multiple_annotations` wrote the whole documentation pass in one call; `get_annotations` read 5 nodes in one call. Zero per-node annotation churn.

3. **`lint` used as a closing gate, and its output triaged rather than obeyed.** One call, 31 findings, and the agent classified all of them as deliberate (set-wrapper chrome 7, focus-ring radius 12, literal `opacity: 0.4` 12 — the last being permanent debt from [BUG-038]) rather than auto-fixing. Zero findings on the buttons themselves.

4. **Screenshot recovery.** See error analysis 1 — one scale step then child nodes, no laddering.

5. **The variant matrix itself.** Two scripts produced 60 correctly-named `Variant=…, Size=…, State=…` components, a combined set, and 6 component properties (`Label` TEXT, `Icon Leading`/`Icon Trailing` BOOLEAN, plus the three variant axes) with the colour map mirroring the SCSS slot remaps exactly — including the non-obvious ones, like Secondary's `Active` border reusing the hover token to match `--button-border-color-active`.

6. **The reconciliation half was scoped by evidence, not assumption.** Rather than guessing which pages had hand-rolled buttons, the agent scanned every page for `button/*` bindings and found exactly one (Alert Dialog). The method was right even though the implementation should have been a `grep` call.

## Priority Improvements

### Tool Changes (ranked by impact)

1. **`edit` / `create_styles`: write the resolved colour into a bound paint** (`apply.js:266-273`, `styles.js:805-809`). Today `edit` binds a fill variable onto a black literal on any node without existing fills — which is every FRAME `write` creates. Converts a silently-wrong render into a correct one. **[BUG-043], P1, auto-fixable.**

2. **Expose the VM font inventory** — `includeFonts` on `get_design_system`, or a `list_fonts` tool. Retires a 5-call hunt that has recurred in six consecutive sessions on custom-font files, and gives [BUG-033]/[BUG-040]/[BUG-041] a place to point. **[TOOL-045], P1.**

3. **`screenshot`: check the encoded payload size in-VM and re-encode before returning.** The `42:494` success→failure pair at constant scale is direct evidence that the agent cannot fix this by choosing a better `scale`, because `scale` is not the variable. **[BUG-016], P0, existing.**

4. **Name the array + paint-level behaviour in `grep`'s `variableId` description.** One sentence retires a class of hand-rolled traversal scripts. **[AGENT-035], P2.**

### Agent Skill Updates

1. **Change the recommended `Semibold` donor from `SF Pro` to `Noto Sans New Tai Lue`.** This session independently reproduces session 56's five-donor experiment from the opposite direction — a *directly authored* node, never rebound — and gets the same answer. See the donor finding below.

2. **After an unhelpful diagnostic script, re-check the tool surface before writing another script.** Script #18 is the concrete case: the agent had `grep` loaded and reimplemented it.

3. **Do not verify a repair against a number you supplied.** Script #4 hardcoded `resize(60, 16)` and script #6 re-read `60` back as confirmation. The label was still broken; only the font swap fixed it.

## Cross-Session Corroborations

### [BUG-040] confirmed from a new direction, and the donor list is now exhaustively explained

Script #3's `semiboldFamilies` filter returned **exactly five** families in the VM offering a one-word `Semibold` style:

> `Noto Sans New Tai Lue`, `SF Compact`, `SF Compact Rounded`, `SF Pro`, `SF Pro Rounded`

These are precisely the five donors session 56's #50 experiment tested, where four measured `w: 0` and only `Noto Sans New Tai Lue` survived. This session reproduces that result on a different component, a different page, and — critically — a **different mechanism**: session 56's node was rebound off a missing `PP Neue Montreal`, whereas this node was authored on `SF Pro / Semibold` directly, with `loadFontAsync` resolving cleanly and `fontName` reading back correctly. **So [BUG-040]'s framing — "a TEXT node on an *unavailable* font" — is too narrow.** SF Pro/Semibold is available, listed and loadable in the VM, and still has no usable metrics.

The five-family list also explains *why* this keeps happening: a design system that spells its weight `Semibold` (as PP Neue Montreal does) can only ever land on one of those five, and `Inter` is not among them — it spells the face `Semi Bold`. Four of the five are broken, and `SF Pro` is the obvious pick.

### [BUG-033] 6th session; VM font count varies

`PP Neue Montreal` unavailable again. Script #20 shows the operational cost in its mature form: to insert Button instances into Alert Dialog, the script had to **park 68 non-instance TEXT nodes** across two pages onto style-matched VM faces (`Semibold` → Noto Sans New Tai Lue, `Regular` → Inter, `Extrabold` → Noto Looped Thai), unbinding `fontFamily` on each, perform the structural surgery, then re-bind. `createInstance`, `insertChild` and `setProperties` all throw `unloaded font` otherwise. The VM reported **1,938 families** here — matching session 53 exactly, against session 55's 8,927. The inventory is not stable between sessions.

### [AGENT-025] 9th session — share down, ceiling up

`run_script` fell to 36.4% of figma calls (from session 56's record 55.9%), but hit **100% of write operations** — a new ceiling. `write`, `edit`, `combine_as_variants` and `component_properties` were all explicitly ToolSearch-loaded in call #2 and then never invoked. Two of the four gaps that drove this are named here ([BUG-043] would have made `edit`'s binding path usable; [TOOL-045] would have removed the font hunt); the 60-variant clone-and-rename matrix itself is genuinely script-shaped work.

### Other recurrences

- **[AGENT-031]** executed correctly, 5th consecutive session — one scale step, then child nodes.
- **[TOOL-033]** — all 13 write scripts ran with no assertion layer. The width-0 label (#4-#6) is exactly what `width_collapse` would have caught at write time.
- **[BUG-038]** — the literal `opacity: 0.4` on 12 Disabled variants is carried deliberately as permanent lint debt, same as session 57.
- **[BUG-035]** — the session never used a numeric weight to pick a face; it named `Semibold` explicitly throughout. The `Semi Bold` (Inter) vs `Semibold` (everything else) split visible in script #3's dump is the exact spelling hazard that entry describes.
