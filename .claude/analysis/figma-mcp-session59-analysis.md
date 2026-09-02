# Figma MCP Session 59 Analysis

## Session Overview

- **Transcript**: `.claude/sessions-json/38220a4e-1936-4e6a-9032-c9780fd86f18.json`
- **Duration**: 12 minutes (2026-09-01 23:14:57 → 23:26:40 UTC), no idle gaps
- **Total tool calls**: 32 (21 Figmagent, 9 Bash, 2 ToolSearch)
- **Total errors**: 2 hard (`is_error: true`) — 1 Figmagent `edit`, 1 Bash — plus **1 unflagged soft failure** and 1 unflagged Bash misfire
- **Reconnections**: 0 (1 `use_file`)
- **Context restarts**: 0
- **Transport**: remote — Figma file `C4zLeQJs8qkAhFSLwMKP9J` ("Archer")
- **Project**: external `~/Github/storybook`, branch `main` — **seventh analysed session on this project/file** (S53, S54, S55, S56, S57, S58, S59)
- **Task**: mirror the Storybook `Avatar` component (Base UI + `Avatar.scss` + generated token CSS) into the Archer file — a 6-variant COMPONENT_SET bound to `avatar/*` variables, with a TEXT component property, annotations and a lint pass

**Concurrency**: sessions 54 (ends 23:19:31) and 55 (ends 23:28:17) were still open on this file when session 59 started at 23:14:57 — three MCP processes, one Figma file, the same pattern S53-S58 established. No writes collided: 54's last call is 23:16:17 and 55's are 23:16:29 then 23:24:52, so the whole of session 59's Figma work (23:17:36 → 23:22:35) sits in a window no other process wrote in. That matters for Error 2 below, which is attributable to this session's own script and not to a neighbour.

The session **completed its task**: `Avatar` COMPONENT_SET `35:14` — `Size` SM/MD/LG × `Content` Fallback/Image, MD+Fallback ordered first so a dragged instance matches the code default `size='md'`; a `Fallback` TEXT property (default `"AB"`) bound across all three fallback variants; root fill `avatar/bg`, radius `radius/full`, text fill `avatar/color`, image placeholder `color/neutral/300`, text on the shared `support/label/1` style; 3/3 annotations; lint clean apart from the set wrapper's own chrome.

Two things make this session worth keeping.

It is the **best first-class-surface profile of the seven Archer sessions by a wide margin** — `run_script` at 19.0% of Figma calls and **25% of write operations**, against session 58's 100% ceiling and session 56's 92.3%. Every one of the four scripts is forced by a gap already named in this tracker; none re-implements a tool the agent had loaded. The behaviour [AGENT-025] and [AGENT-026] have been asking for happened here, unprompted, on the same file and the same day.

And the four scripts it *did* need expose a new defect in the very workaround this tracker recommends: **the style-face swap of [BUG-037] silently drops the style's `fontWeight` variable binding and its face**, which on a design-system file is a file-wide corruption of every component sharing that style. The agent caught it, repaired it, verified the repair byte-for-byte and corrected its own memory note — but only because it happened to echo `boundVariables` in the script's return value. Nothing in the tool surface would have told it.

## Metrics

| Metric | Session 57 | Session 58 | This Session | Change vs S58 |
|---|---|---|---|---|
| Total tool calls | 35 | 69 | 32 | −54% |
| Figma tool calls | 21 | 55 | 21 | −62% |
| Official-MCP calls | 0 | 0 | **0** | held (**12th consecutive**) |
| Hard errors | 2 | 4 | **2** (1 figma + 1 Bash) | −2 |
| Figma error rate | 9.5% | 7.3% | **4.8%** (1 of 21) | **−2.5pp — best on this file** |
| Unflagged soft failures | 0 | 0 | **1** | +1 |
| `run_script` share of Figma calls | 52.4% | 36.4% | **19.0%** (4 of 21) | **−17.4pp — lowest on this file** |
| `run_script` share of write ops | 85.7% | 100% | **25.0%** (3 of 12) | **−75pp — lowest on this file** |
| `screenshot` failure rate | 20.0% | (BUG-016 20th) | **0%** (0 of 2) | — |
| ToolSearch | 1 (2.9%) | 3 (4.3%) | 2 (6.3%) | +2.0pp |
| Estimated waste % | ~31% | ~28% | **~34%** (11 of 32) | +6pp |

Waste composition (11 calls): 1 hard `edit` failure (#22) · 1 script to do the reorder that `edit` refused (#23) · 3 for the text-style application and its self-inflicted repair (#15, #16, #17) · 1 sizing re-assertion after `combine_as_variants` (#25) · 1 redundant `get_design_system` (#10) · 2 `ToolSearch` (#4, #12) · 2 failed Bash memory edits (#29, #30).

The waste percentage rises while every rate improves, because the denominator shrank: this is a 6-variant component in 32 calls, and a single forced script is 3% of the session. On absolute calls the font tax is the smallest of the seven Archer sessions — 4 scripts against session 55's 19 write scripts and session 56's 24.

## Tool Call Distribution

| Tool | Calls | Notes |
|---|---|---|
| Bash | 9 | 5 productive (component source, SCSS, generated token CSS, 2 memory reads), 4 spent editing a memory file (2 of them misfired) |
| `edit` | 4 | 3 succeeded (12-node token binding, rename+padding, 6-node sizing), 1 hard-failed on `insertChild: unloaded font` |
| `run_script` | 4 | **all four forced by named gaps** — 3 for the text-style/font dance, 1 for a reorder `edit` cannot do |
| `get_design_system` | 3 | `namePattern` for `avatar/*`, then `color/neutral/*`, then `styleType: "texts"` — #10 foldable into #8 |
| `ToolSearch` | 2 | external repo; 10 tools up front, 3 more once the task revealed them |
| `component_properties` | 2 | add `Fallback` TEXT prop, then bind it to the other two fallback variants — 3/3 clean |
| `screenshot` | 2 | both succeeded at `scale: 2` on a 13-node set — **no [BUG-016]** |
| `use_file` / `read` / `write` / `combine_as_variants` / `set_multiple_annotations` / `lint` | 1 each | `write` created 6 COMPONENT roots + 12 nodes in one call |

**Write operations**: 12 total — 1 `write`, 4 `edit`, 2 `component_properties`, 1 `combine_as_variants`, 1 `set_multiple_annotations`, 3 `run_script` (`mode: "write"`). Script share **25%**.

## Efficiency Issues

### 1. Reordering one variant cost a 30-line script — `edit`'s `index` is the first *first-class tool* to break on [BUG-033] (saves ~2 calls, and closes an architectural hole)

`#22 edit({nodes:[{nodeId:"35:4", index:0}]})` — move the MD variant to the front of the set so a dragged instance matches the code default — failed hard:

```
in insertChild: unloaded font "PP Neue Montreal Semibold". Please call
figma.loadFontAsync({ family: "PP Neue Montreal", style: "Semibold" }) and
await the returned promise first.
```

The stated fix is unactionable: the family does not exist in the remote VM at all ([BUG-033], six prior sessions). The agent's recovery (#23) was a 30-line `run_script` that unbinds the shared style's `fontFamily`, parks it on `Inter`, performs two `insertChild` calls, then restores the Semibold face, the `fontWeight` binding, the line height and — last — the `fontFamily` binding.

**Root cause:** `edit`'s reorder path calls `parent.insertChild(index, node)`, and Figma requires every font in the moved subtree to be loaded. Figmagent's font loading runs when text *properties* are written, not when a node is *moved*. Sessions 53, 55, 56 and 58 all hit `insertChild`/`appendChild`/`createInstance` on this, but always **inside `run_script`**, where the agent could park fonts by hand. This is the first time it lands on a first-class tool, where there is no park-and-restore mechanism at all.

**Proposed fix:** implement the `allowFontFallback` / park-and-restore mode that [BUG-033]'s session-58 note already proposed, and route `edit`'s structural operations (`index`, `parentId`) through it: collect the unloadable families in the moved subtree, unbind + park them on a VM-available donor, perform the move, restore. Failing that, `edit` should at minimum re-state the error in terms the agent can act on — the current text tells it to call an API it cannot reach for a font that does not exist.

**Estimated savings:** ~2 calls here; structurally, it is the difference between "any structural edit on a custom-font file is `run_script`-only" and "it isn't".

### 2. Applying a text style to three nodes took three scripts, and the middle one was repairing self-inflicted damage (saves ~3 calls)

`support/label/1` is bound to `font/family/sans` → `PP Neue Montreal`, absent from the VM. Applying it needs the [BUG-037] style-face swap, so #15 parked the style on `Inter/Regular`, applied it to the three fallback TEXT nodes (`nodeStyleApplied: [true, true, true]`), and re-bound `fontFamily`.

The script's own return value gave it away: `styleBound: ["fontFamily", "fontSize"]` and `styleFont: {family: "PP Neue Montreal", style: "Regular"}`. The style went in with a `fontWeight` binding and a `Semibold` face and came out with neither. #16 confirmed against the live style; #17 repaired it, needing an oddity worth recording — `style.fontName` has to be assigned **twice**, because binding `fontWeight` rewrites the face literal:

```js
style.fontName = face;
style.setBoundVariable("fontWeight", weightVar);
style.fontName = face; // re-set: the weight lookup rewrites the face literal
```

**Root cause:** two layers. Underneath, assigning `fontName` on a style that carries a `fontWeight` variable binding drops that binding (new — see [BUG-044]). Above it, `edit({textStyleId})` still refuses this case and sends the agent to a script, which is exactly [BUG-037]'s proposed fix (b): have `edit` perform the swap-apply-rebind internally. Had `edit` owned the swap, it would also have owned the weight restore, and no consumer of the style would ever have been at risk.

**Estimated savings:** 3 scripts → 1 `edit` call, and the blast radius drops from file-wide to zero.

### 3. `combine_as_variants` returns a set named "Component 1" and no sizing readback (saves ~2 calls)

`#18` combined six components into `35:14`, named **"Component 1"**, forcing `#19` to rename it. The tool takes `componentIds` and `parentId` and nothing else — no `name`.

The same call also applies auto-layout to the new set (its own description: *"horizontal wrap auto-layout (20px spacing, 40px padding, HUG sizing)"*) and reports only `{id, name, type, childCount, children:[{id,name,type}]}`. After it, the agent screenshotted (#24), re-asserted `layoutSizingHorizontal/Vertical: "FIXED"` with explicit 32/40/48 dimensions on all six variants (#25), and screenshotted again (#26) — a verify-repair-verify loop nothing in the `combine_as_variants` or `edit` responses pre-empted. (The transcript carries no thinking blocks, so the trigger for #25 is inferred from the call sequence; the repair itself is explicit.)

**Proposed fix:** (a) add an optional `name` to `combine_as_variants`; (b) have it return each child's post-wrap `layoutSizingHorizontal/Vertical` and `width`/`height`, or run the existing balloon-frame / width-collapse assertions over the children it just re-parented. The post-write assertions currently inspect the node that was written, not the siblings a layout change re-flowed.

### 4. Image-backed variants cannot be built — only mimed (0 calls saved, but the artifact is wrong)

`Content=Image` shipped as a grey `color/neutral/300` disc. `imageHash` appears nowhere in `src/figma_plugin/src/` or `src/figmagent_mcp/tools/`; `createImage` appears only in `run_script`'s guard list. There is no way to set an IMAGE paint through `write` or `edit`, so every avatar, thumbnail, card media and hero in every mirrored component is a flat placeholder. The agent annotated it as such, which is the right call — but the Figma file is now less faithful than the code it mirrors, and nothing in the tool descriptions says why.

## Error Analysis

### 1. `edit` reorder → `insertChild: unloaded font` (1 hard failure, ~45 seconds lost)

Covered in Efficiency Issue 1. **Agent recovery: excellent** — one failure, no retry, no parameter ladder, straight to a script that worked first try. [AGENT-029] ("a stated fix that fails once is a wrong diagnosis — change strategy, not parameters") executed correctly against an error whose stated fix was impossible to satisfy. Sixth consecutive session with clean fail-fast behaviour.

### 2. Unflagged soft failure: `run_script` reported success while destroying a shared text style

`#15` returned `is_error: false` with `nodeStyleApplied: [true, true, true]`. It had also dropped `support/label/1`'s `fontWeight` binding and reverted its face from `Semibold` to `Regular` — a style used by `Accordion` and every other component in the file. `run_script` has no post-write assertions ([TOOL-033]), so the only reason this surfaced is that the agent's own `return` block happened to echo `styleBound` and `styleFont`. A script that returned `{ok: true}` would have left the file damaged and the session reporting success.

**Fix needed:** [TOOL-033] (assertions on `run_script`) is the general answer; [BUG-044] is the specific one — a style write that drops a variable binding should not be silent, wherever it happens.

### 3. Bash: 2 misfired memory-file edits (1 hard, 1 unflagged)

`#29` died on an `AssertionError` in a Python heredoc; `#30` failed on `cat -A` (BSD `cat` has no `-A`) and reported `is_error: false`. Both were repaired inside two calls (#31 grep to find the line, #32 a working rewrite). No Figma impact — noted only because it is 2 of the 11 waste calls.

## What Worked Well

1. **The first-class surface carried the build.** One `write` created 6 COMPONENT roots and 12 nodes; one `edit` bound `clipsContent` + fill + radius variables across all 12; `combine_as_variants` and `component_properties` ran clean (3/3 property bindings, 0 errors, 0 re-reads). Script share of write operations fell from session 58's **100%** to **25%** — the lowest measured on this file, and the four surviving scripts are all attributable to named gaps rather than preference. This is the clearest counter-data yet that [AGENT-025]'s monoculture tracks *task shape and tool gaps*, not agent habit.

2. **The opening ToolSearch slice finally included the tokens domain.** [AGENT-026] has flagged three sessions on this file where `get_design_system` was omitted from the first slice and then re-implemented in scripts. Here it was in slice one and called three times — with `namePattern` filters, not full dumps — and **zero** scripts re-implemented `getLocalVariablesAsync()`. The guidance held.

3. **The damage was caught, repaired, verified, and written back to memory.** The agent verified the restore field by field (`fontName`, three `boundVariables`, `lineHeight` to the original `120.00000476837158`), then corrected the project memory note that had called the swap safe. The final report leads with *"I damaged then repaired a shared text style"* rather than burying it — exactly the reporting behaviour that makes these transcripts worth analysing.

4. **No [BUG-016].** Both `screenshot` calls succeeded at `scale: 2`, and zero official-Figma-MCP calls were made — 12th consecutive session.

5. **`lint` was run and its output correctly triaged.** 7 near-matches, all on the COMPONENT_SET wrapper's own 40px chrome, correctly identified as the expected exception rather than auto-fixed into the design.

## Priority Improvements

### Tool Changes (ranked by call savings)

1. **`write`/`edit` park-and-restore mode** ([BUG-033], 7th recurrence) — an `allowFontFallback: true` that parks unloadable families in the affected subtree, performs the write, and restores the bindings. This session shows the gap reaching `edit`'s reorder path; without it, structural edits on any custom-font file stay `run_script`-only. Saves ~2-5 calls/session on this file class and closes an architectural hole.
2. **`edit({textStyleId})` should perform the swap-apply-rebind itself** ([BUG-037] fix (b), 4th recurrence) — and must restore `fontWeight`/`fontStyle` as part of it ([BUG-044]). Saves ~3 calls/session and removes a file-wide corruption risk from the recommended workaround.
3. **`combine_as_variants`: optional `name`, plus per-child sizing in the response** ([TOOL-047]). Saves ~2 calls/session.
4. **An `imageFill` / `imageHash` path on `write`/`edit`** ([TOOL-046]). No call savings; fidelity of every image-bearing component.
5. **Post-write assertions on `run_script`** ([TOOL-033], recurring) — this session's silent style corruption is the strongest case yet.

### Agent Skill Updates

1. **When the style-face swap is unavoidable, restore *every* property you disturbed, not just `fontFamily`** — read the style's `boundVariables` and `fontName` before parking it, and assert both after. The `fontWeight` binding does not survive a `fontName` assignment, and re-binding weight rewrites the face, so the face must be set again after the weight bind. ([BUG-044])
2. **Prefer the node-level swap when the style has other consumers.** Session 57 already noted the concurrency hazard; this session adds a correctness one. A style-level swap touches every component in the file for the duration of the script.
3. **After `combine_as_variants`, verify the variants' sizing before styling them** — the call applies auto-layout to the new set, and the response says nothing about what that did to the children.
