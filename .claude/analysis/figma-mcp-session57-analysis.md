# Figma MCP Session 57 Analysis

## Session Overview

- **Transcript**: `.claude/sessions-json/e713f226-3d69-4283-8ec1-e7ca73e00116.json`
- **Duration**: 10 minutes (2026-09-01 23:28:22 → 23:38:35 UTC), no idle gaps
- **Total tool calls**: 35 (21 Figmagent, 12 Bash, 1 ToolSearch, 1 Skill)
- **Total errors**: 2 hard (`is_error: true`), both Figmagent — 1 `run_script` (font), 1 `screenshot` (export cap); **0 unflagged soft failures**
- **Reconnections**: 0 (1 `use_file`)
- **Context restarts**: 0
- **Transport**: remote — Figma file `C4zLeQJs8qkAhFSLwMKP9J` ("Archer")
- **Project**: external `~/Github/storybook`, branch `main` — **fifth analysed session on this project/file** (S53, S54, S55, S56, S57)
- **Task**: mirror the Storybook `Checkbox` component (Base UI + `Checkbox.scss` + `config/component.tokens.json`) into the Archer file — a 9-variant COMPONENT_SET plus a usage scene, bound to `checkbox/*` variables, annotated and linted

**This session runs concurrently with session 56**, not after it: S56 spans 23:28 → 23:50 and S57 spans 23:28 → 23:38, both on the Archer file, both writing. Two MCP processes, one file, ten overlapping minutes — the same overlap S54/S55 had. No cross-session interference is visible in either transcript.

The session **completed its task**: a `Checkbox` COMPONENT_SET (`41:26`, 9 variants = `Checked` False/True/Indeterminate × `State` Default/Focused/Disabled), a `Checkbox Usage` scene (`42:42`) built from instances, every colour/radius/stroke-weight/spacing bound to a variable, 5 annotations applied 5/5, both light and dark modes visually verified.

Two things make this session worth keeping. It is the **cleanest run on this file by every error metric** — 9.5% Figma error rate against S53's 32%, and the first session in the series with zero unflagged soft failures. And it produces a **new, confirmed root cause at a code site the tracker had not reached**: `fig.loadFont` — the stdlib helper a `run_script` author is supposed to use — reports success for a font it did not load, then lets the script die 30 lines later on Figma's unactionable "call loadFontAsync first". That silent success discarded a 100-line atomic scene build.

## Metrics

| Metric | Session 55 | Session 56 | This Session | Change vs S56 |
|---|---|---|---|---|
| Total tool calls | 92 | 85 | 35 | −59% |
| Figma tool calls | 79 | 68 | 21 | −69% |
| Official-MCP calls | 0 | 0 | **0** | held (**11th consecutive**) |
| Hard errors | 16 | 10 | **2** | −8 |
| Figma error rate | 19.0% | 14.7% | **9.5%** (2 of 21) | **−5.2pp — best on this file** |
| Unflagged soft failures | 0 | 1 | **0** | −1 |
| `run_script` share of Figma calls | 29.1% | 55.9% | **52.4%** (11 of 21) | −3.5pp |
| `run_script` share of write ops | 46.3% | 92.3% | **85.7%** (6 of 7) | −6.6pp |
| `screenshot` failure rate | 44.4% | 16.7% | **20.0%** (1 of 5) | +3.3pp |
| ToolSearch | 3 (3.3%) | 1 (1.2%) | 1 (2.9%) | +1.7pp |
| Estimated waste % | ~35% | ~38% | **~31%** (11 of 35) | **−7pp** |

Waste composition (11 calls): 2 hard errors (#20, #24) · 1 font diagnosis (#21) · 1 `opacity` unbind-and-repair (#22) · 2 lint false-positive chase (#30, #31) · 2 variable-mode set/clear overhead (#32, #34) · 3 read-shaped scripts that first-class tools answer (#13, #15, #19).

The scope is a third of the previous four sessions and the task is simpler — one component, not six — so the headline reductions are scope, not efficiency. The rates are the comparable numbers, and they all improve. The 12 `Bash` calls (reading `Checkbox.tsx`, `Checkbox.scss`, `_mixins.scss`, the generated light/dark token CSS and two project memory files) were all productive and all first-try; the session spent its first 90 seconds establishing the spec before touching Figma, which is why the build itself took two write scripts.

## Tool Call Distribution

| Tool | Calls | Notes |
|---|---|---|
| `Bash` | 12 | source + token + memory reads; 0 errors; #35 wrote the build progress back to memory |
| `run_script` | 11 | 1 failed (#20). 6 write scripts, 5 read-only. 3 of the 5 reads are covered by `read`/`get_design_system` |
| `screenshot` | 5 | 1 failed (#24, scale 2 → recovered at 0.5 in one step) |
| `read` | 2 | #14 page orient (`full`, depth 3), #27 set verification (`structure`) |
| `use_file` | 1 | Figma URL, resolved cleanly on remote |
| `set_multiple_annotations` | 1 | 5 of 5 applied, 0 failed, 1 batch |
| `lint` | 1 | `nodeId: ["41:26", "42:42"]` — 43 nodes, 20 issues; never re-run |
| `ToolSearch` | 1 | 12-tool `select:` slice; **omitted `get_design_system`** |
| `Skill` | 1 | `figmagent:figma-guidelines` |

Zero `write`, `edit`, `create_variables`, `combine_as_variants`, `component_properties`, `get_design_system`.

## Efficiency Issues

### 1. `fig.loadFont` reports success for a font it never loaded (costs a whole atomic script)

Script #20 built the entire `Checkbox Usage` scene — a labelled row, a fieldset group, a legend and four option rows, ~120 lines — and opened with:

```js
await fig.loadFont('PP Neue Montreal', 'Regular');
await fig.loadFont('PP Neue Montreal', 'Semi Bold');
```

Both resolved. Thirty lines later, the first `t.fontName = { family: 'PP Neue Montreal', style: 'Regular' }` threw:

```
Error: in set_fontName: Cannot use unloaded font "PP Neue Montreal Regular".
Please call figma.loadFontAsync({ family: "PP Neue Montreal", style: "Regular" })
and await the returned promise first.
    at set (<input>:58:11)
Figma Debug UUID: … (atomic: no changes were applied; safe to retry)
```

**Root cause, confirmed in source.** `fig.loadFont` is `loadFontWithFallback` (`src/figma_plugin/src/remote_entries/stdlib.js:25`), and that helper (`src/figma_plugin/src/helpers.js`) is written to swallow:

```js
try {
  await figma.loadFontAsync({ family: fam, style: style });
  return { family: fam, style: style };
} catch (_e) {
  await figma.loadFontAsync({ family: "Inter", style: "Regular" });
  return { family: "Inter", style: "Regular" };
}
```

For the internal callers — `setcharacters.js`, `create.js`, `apply.js` — graceful degradation is the right behaviour. For a script author who named a family explicitly, it is a lie: the return value carries the truth (`{family: 'Inter'}`) and nothing surfaces it, so the script proceeds to assign a font that was never loaded and dies on the raw Plugin API message, which prescribes the exact call that just silently failed.

**Cost:** #20's atomic rollback discarded the whole scene, #21 read a project memory file to re-derive the cause, and #23 rebuilt the scene with the swap-write-rebind workaround — 3 calls and ~2 of the session's 10 minutes, and it forced a workaround that temporarily mutates a *shared design-system text style* (below).

**Proposed fix:** keep `loadFontWithFallback` as-is for internal callers; wrap it at the stdlib boundary so `fig.loadFont` `fail()`s when the family it returns is not the family it was asked for — naming the real cause (the headless VM has no access to locally-installed or licensed fonts) and the remedy the project already documents. This is the missing half of [BUG-033]'s proposed fix (a), which addresses the case where `loadFontAsync` *throws* and never reaches the case where the fallback swallows it.

**Estimated savings:** ~3 calls per custom-font script session, and it moves the failure from line 58 of an atomic script to line 1.

### 2. `lint` counts an invisible paint as an unbound fill (2 calls, 6 of 20 issues)

`lint` on the finished set (#29) returned `totalIssues: 20`, of which `fills: 6`. All six were the `Indicator` wrapper frames — `figma.createNodeFromSvg` leaves a `{ type: "SOLID", visible: false, color: {1,1,1} }` paint on the frame it creates. #30 read one back to confirm exactly that; #31 cleared `fills = []` on all six.

**Root cause, confirmed in source.** `checkColorProperty` (`src/figma_plugin/src/commands/lint.js:399-422`) reads `paints[0]` and guards on two things — the paint must be `SOLID`, and it must not already carry `boundVariables.color` — but never on `paint.visible`. A paint that contributes nothing to the render is matched against the token set and reported as unbound. Node-level visibility *is* handled (`lint.js:150` skips invisible nodes); paint-level visibility is not.

**Proposed fix:** one guard beside the existing SOLID check — `if (prop(paint, "visible") === false) return null;`. Same treatment for `checkColorProperty`'s stroke path.

**Estimated savings:** ~2 calls per session that imports SVG, and it removes a class of issue that is unfixable by binding — the agent's only recourse is to delete the paint.

### 3. Checking the second variable mode still costs 2 calls of pure overhead

Verifying dark mode took #32 (`setExplicitVariableModeForCollection` on the page), #33 (the screenshot — the actual work), #34 (`clearExplicitVariableModeForCollection`). Two of three calls exist only because there is no first-class way to say "render this node in that mode."

This is [TOOL-038] recurring, and the cost has come down from session 54's 6 calls to 3 — but only because this agent avoided the invisible-paint trap that consumed 3 of session 54's. The irreducible overhead is unchanged at 2 calls, and it is paid on every themed review.

### 4. Three read-only scripts re-implement tools that were one ToolSearch away

- **#15** — `getLocalVariablesAsync()` filtered by a regex over `checkbox/`, `borderWidth/`, `radius/`, `space/2xs`, `font/`, returning `{id, name, type, scopes, values}` plus a text-style list.
- **#19** — `getLocalVariablesAsync()` filtered to `space/`, returning `{id, name, scopes}`.
- **#13** — `figma.root.children.map(...)` to enumerate pages, immediately before a successful `read` (#14) on the same target.

#15 and #19 are `get_design_system({ namePattern, includeScopes: true })` verbatim. The reason they were hand-written is visible at #10: the opening `ToolSearch` slice named twelve tools and `get_design_system` was not among them (`get_local_components` was). In a deferred-tool project the opening slice *is* the tool surface, and this slice has now omitted the tokens domain in **three of the five sessions on this file** — S53 (`create_styles` searched at #58, after the styles were built), S54 (five scripts re-implementing `get_design_system`, never called once), and S57.

This is [AGENT-026] recurring, but with a sharper diagnosis than "search the domain you are about to work in": the slice appears to be carried forward from session to session unchanged. The fix is to name the domains the *task* needs — a token-bound component mirror needs `tokens` — before the first script is written.

## Error Analysis

### 1. `run_script` #20 — unloaded font, whole script discarded (1 failure, ~2 minutes)

Covered above as efficiency issue 1. Two things about the recovery are worth recording separately.

**The agent recovered well.** No retry storm, no permutation ladder over face spellings — one memory read (#21), one probe of the shared text style (#22), then a single corrected script (#23) that worked first try. [AGENT-029] ("a stated fix that fails once is a wrong diagnosis") executed correctly: the error told it to call `loadFontAsync`, it had already done the equivalent, so it changed strategy rather than parameters.

**The workaround it used is the style-level swap, and it is now 3-for-3.** #23 parked the shared `body/1` text style on `Inter`, built and styled every TEXT node, then restored the style's `fontWeight`, `lineHeight`, `letterSpacing` and — last — its `fontFamily` variable binding. Readback confirmed `fontName: {family: 'PP Neue Montreal', style: 'Regular'}` with `bound: [fontSize, fontFamily, fontWeight]` intact. This is [BUG-037]'s technique, and its cost profile is now clear: it works, and it requires temporarily mutating a **shared design-system style** that every other node in the file references. In a file being written concurrently by session 56 during those same minutes, that is a real hazard, not a theoretical one.

**[BUG-040]'s width-0 trap did not fire**, and the reason is the donor. #23 chose `Inter` — the one family session 56's five-donor experiment (#50) found never measures 0. `SF Pro`, which [BUG-033]/[BUG-035] currently recommend, is among the four that do. This session is a clean corroboration of that finding from an independent run.

### 2. `screenshot` #24 — export cap on a subtree with no effects at all (1 failure)

`screenshot(42:42, scale: 2)` returned the "~4MB return cap" error; `scale: 0.5` succeeded 2 seconds later. Recovery was one step — [AGENT-031] executed correctly for the fourth consecutive session.

The useful part is the control this session provides for free. The same session exported the `Checkbox` COMPONENT_SET (`41:26`, resized to 220 wide) successfully **three times** — at `scale: 3` (#18), and at `scale: 2` twice (#26, #33) — while the `Checkbox Usage` scene failed at `scale: 2`. And **this build contains no `effects` anywhere**: neither write script sets `effects`, the SVG imports carry none, and no library instances are involved. Session 55's DROP_SHADOW discriminator therefore cannot explain this failure, and session 56's softened version ("how many shadowed subtrees are in the export") cannot either — there are zero. Whatever the trigger is, a shadow is not necessary for it.

## What Worked Well

1. **Spec-first, then build.** Twelve `Bash` calls in the first 90 seconds established the component's real contract — the TSX, the SCSS, the resolved `checkbox/*` tokens in both light and dark generated CSS, the `focus-ring` mixin, the `box-sizing: border-box` reset — before a single Figma call. The build then took two write scripts and needed no structural rework. Zero Bash errors.

2. **The annotations carry what Figma cannot hold, and they are specific.** Five annotations, 5/5 applied in one batch, documenting the `::before` 24×24 hit target that is not a layer, the `outline` + `outline-offset` decomposition that produced the 28×28 focus ring and its derived 8px radius (`4 + 2 + 2`), the deliberate *absence* of a hover state, the SVG viewBoxes, and that `Focused + Disabled` is unreachable. This is the pattern the project wants — design intent recorded where a developer will find it, rather than as label text on the canvas.

3. **Prior-session knowledge was actually retrieved and applied.** #9 and #21 read this project's memory files (`figma_design_system.md`, `figma-remote-vm-gotchas.md`) at exactly the two moments they mattered — before starting, and on the first font failure — and #35 wrote the Checkbox build back to the progress table. The opacity quirk from [BUG-038] was recognised and repaired in one call rather than four.

4. **Error recovery was the best in the series.** Two hard errors, two single-step recoveries, no retry storms, no unflagged soft failures, and the dark-mode override was cleanly reverted (#34) rather than left on the page.

## Recurrences Confirmed

| Issue | Count | This session's evidence |
|---|---|---|
| [BUG-033] custom fonts absent on remote | **5th** | New code site — `fig.loadFont`'s silent fallback, filed as [BUG-041] |
| [AGENT-025] `run_script` monoculture | **8th** | 52.4% of calls, 85.7% of write ops; 0 `write`/`edit` |
| [BUG-038] `opacity` variable at 1/100 scale | **2nd** | #17 bound it, screenshot #18 showed nothing, #22 unbound it — **and the literal 0.4 is now permanent `lint` debt** (3 of 20 issues) |
| [TOOL-038] no first-class variable-mode override | **2nd** | 3 calls (#32/#33/#34) for one dark-mode look; 2 are pure overhead |
| [AGENT-026] scripts for what first-class tools cover | **3rd** | `get_design_system` omitted from the opening slice for the 3rd time on this file |
| [AGENT-034] close out against a re-run of `lint` | **2nd** | Never re-ran after clearing 6 fills; closing summary triaged from the first run's buckets |
| [BUG-016] `screenshot` export cap | **19th** | 1 of 5 (20%), one-step recovery; **zero-`effects` control falsifies the shadow discriminator as a necessary condition** |
| [TOOL-027] `edit` can't set `layoutPositioning`/`clipsContent` | — | Both used in #17; the ABSOLUTE focus ring is only expressible in a script |
| [TOOL-032] `write` cannot bind variables at create time | — | The reason #17 is a script at all: 9 variants × ~6 bindings each, all at create time |
| [AGENT-029] change strategy, not parameters | — | Executed correctly on the font failure |
| [AGENT-031] stop the `scale` ladder at two | — | Executed correctly, 4th consecutive session |

## Priority Improvements

### Tool Changes (ranked by call savings)

1. **`fig.loadFont` must fail loudly** (`src/figma_plugin/src/remote_entries/stdlib.js`) — wrap `loadFontWithFallback` at the stdlib boundary and `fail()` when the returned family differs from the requested one. Saves ~3 calls per custom-font script session and converts a line-58 atomic rollback into a line-1 rejection. New: **[BUG-041]**.

2. **`lint` must skip invisible paints** (`src/figma_plugin/src/commands/lint.js:399-422`) — one guard clause. Saves ~2 calls per SVG-importing session and removes 30% of this session's lint findings as noise. New: **[BUG-042]**.

3. **`variableModes` on `edit`** ([TOOL-038], unchanged) — 2 of the 3 calls spent on the dark-mode check are pure ceremony, on every themed review, forever.

4. **An `opacity` post-write assertion** ([BUG-038], escalated) — this session shows the cost is not the 4 calls of discovery but the permanent state it leaves behind: the only working repair is a literal value, which `lint` then flags on every subsequent run with a `near_match` that must never be taken.

### Agent Skill Updates

1. **Pick the ToolSearch slice from the task, not from last session.** A token-bound component mirror needs the `tokens` domain — `get_design_system`, `create_variables`, `create_styles`. The same twelve-tool slice has now been carried into three sessions on this file, and each time the tokens domain's absence was paid for in hand-written scripts. ([AGENT-026], 3rd)

2. **Re-run `lint` before declaring a build clean.** The closing summary characterised the remaining issues as "the set/scene 40px chrome and the documented literal opacity" — a triage of the *first* run's buckets, taken after clearing 6 fills and never re-measured. One call would have confirmed it or surfaced the 3 `exact_match` issues that went unmentioned. ([AGENT-034], 2nd — verbatim repeat, one session later)

3. **Treat a shared text style as shared.** The style-face swap ([BUG-037]) works and should stay the recommended remedy, but it mutates a file-wide style for the duration of the script. When another session may be writing the same file — as one was, for ten of this session's ten minutes — prefer the node-level swap, or at minimum keep the window as short as possible.
