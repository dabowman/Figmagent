# Figma MCP Session 49 Analysis

## Session Overview

- **Transcript**: `d7149612-6431-44b5-87c3-c2338f5dfc8e.json`
- **Date**: 2026-08-26, 21:39–22:49 UTC
- **Duration**: 70 minutes wall clock (~37 minutes agent-active — a 33-minute user gap sits between 21:41:20 and 22:14:16)
- **Project**: external — `~/Github/loupe`, branch `main` — **first analysed session on this project**
- **Transport**: remote (file `bAlzpqjVY4IpoEj0xSH8tD`, "Loupe Patterns")
- **Total tool calls**: 126
- **Figmagent tool calls**: 114 (90%)
- **Official Figma MCP calls**: **0**
- **Total errors**: 16 (14 Figmagent, 1 Bash `cd`, 1 rejected `AskUserQuestion`)
- **Reconnections**: 0 (remote transport)
- **Context restarts**: 0
- **Task**: read the 27 WPDS pattern definitions from `profiles/wpds/patterns/index.json` and build a Figma board visualising each one as a live preview card, using real Gutenberg/WPDS published-library component instances. Delivered 26 `pattern/*` cards across 5 sections on a 1792×14718 board (`7:2`, 1260 nodes).

Three results dominate:

- 🔎 **[BUG-016]'s payload-size hypothesis is falsified twice more — and this session sets the record on both ends.** A **552×273** frame failed at `scale: 0.8`, and the 1792×14718 board failed at **`scale: 0.06`** (a ~108×883 render). More decisively: **two batch calls returned `Exported 0 node(s): none`, and every constituent node then exported cleanly one-by-one at a *higher* scale seconds later.** Nothing about render size explains that; the v5 root cause (`remote/client.ts:110–114`) explains all of it.
- 🆕 **`resize()` on an auto-layout frame's primary axis silently flips that axis to `FIXED`.** A `FR()` helper that did `primaryAxisSizingMode='AUTO'` then `resize(w, 1)` left **17 frames stuck at height 1**. The agent spent 10 calls and ~8 minutes investigating "rasterization" and "render bounds" before finding it, then hand-carried a repair walker into 5 later scripts. No assertion caught it — and `run_script` gets no assertions at all.
- 🆕 **The remote VM throws `Node not found` for instance-descendant IDs it just handed out.** Walking `.children` / `findAll()` into a nested instance and then reading `.children` or `.componentProperties` off the result fails with `Node with id "I14:1842;7:1982;7:1870" not found`. Three build scripts died this way, discarding **35,304 characters** of authored script.

## Metrics

| Metric | Session 48 | This Session | Change |
|---|---|---|---|
| Total tool calls | 192 | 126 | −34% (smaller scope) |
| Figmagent tool calls | 155 (81%) | 114 (90%) | +9pp share |
| Figmagent error rate | 17 / 155 (11.0%) | 14 / 114 (12.3%) | +1.3pp |
| ToolSearch calls | 2 (1.0%) | 3 (2.4%) | +1.4pp |
| Estimated waste % | ~16% (31 of 192) | **~29% (36 of 126)** | **+13pp** |
| `-32602 invalid_union` protocol crashes | 0 | **0** | **holds (4th session)** |
| Fell back to the *official* Figma MCP | no | **no** | **holds (4th session, 3rd project)** |
| Calls lost to `[BUG-016]` family | 13 | **16** | +3 |
| `screenshot` failure rate | 13 / 41 (32%) | **9 / 40 (22.5%)** | −9.5pp |
| `run_script` share of Figmagent calls | 0% | **24.6%** (28 calls) | +24.6pp |
| `run_script` share of write **operations** | 0% | **100%** (0 `write`, 0 `edit`, 0 `lint`) | 4th session at 100% |
| Script code authored | 0 | **126,546 chars** across 28 calls (avg 4.5K, peak 16.6K) | — |

## Tool Call Distribution

| Tool | Calls | Notes |
|---|---|---|
| `screenshot` | 40 | **9 failed (22.5%)** — [BUG-016]; 2 of the 9 are batch calls returning `Exported 0 node(s): none` |
| `run_script` | 28 | **5 failed**; 100% of write operations; 15 of 28 re-send the same font-load + `sp()` + `I()` + `fix()` preamble |
| `search_library_components` | 18 | All single-`query` — [TOOL-021] 5th recurrence. Worst runs: #21–24, #29–32, #34–38, #56–59 |
| `get_library_components` | 9 | Discovery sweep across 3 library fileKeys |
| `Bash` | 8 | 1 failed (`cd` into a path already `cd`-ed into) |
| `read` | 7 | Used only for diagnosis, never to drive a build |
| `grep` | 5 | Locating nodes inside scripts' output for screenshot targets |
| `ToolSearch` | 3 | 2.4% — low |
| `get_enabled_library_variables` | 3 | |
| `get_component_variants` | 2 | Both correctly batched (3 set IDs each) |
| `use_file` / `set_focus` / `AskUserQuestion` | 1 each | `AskUserQuestion` rejected by user |
| **Total** | **126** | |

## Efficiency Issues

### 1. `resize()` on an auto-layout primary axis silently flips it to `FIXED` (~14 calls, ~8 min)

The build helper looked like this (script #69, and the same shape in #47 and #70):

```js
function FR(name,o={}){
  const f=figma.createFrame();
  f.layoutMode=o.dir||'VERTICAL';
  f.primaryAxisSizingMode='AUTO';                    // hug height
  f.counterAxisSizingMode=o.w?'FIXED':'AUTO';
  if(o.w)f.resize(o.w,1);                            // <-- flips primary axis back to FIXED at height 1
  return f;
}
```

`resize()` on an auto-layout frame's **primary** axis sets that axis's sizing mode to `FIXED` — so `resize(600, 1)` overwrote the `AUTO` set two lines earlier and pinned the frame at height 1. Children were appended afterwards and clipped to nothing.

**Pattern observed:** the symptom presented as a *rendering* problem, not a layout one, and the agent chased it accordingly:

| # | Call | What it found |
|---|---|---|
| 61 | `run_script` render-bounds probe | `boundingBox.height: 1089` but `renderBounds.height: 100` |
| 62 | force reflow (`itemSpacing` nudge + 1.2s wait) | unchanged |
| 63 | inspect children for `visible`/`opacity`/`isMask` | `absoluteRenderBounds: null` on several |
| 64 | "touch nodes to force rasterization" | `rbAfterExport: null`, `bytes: 149` |
| 65 | `viewport.scrollAndZoomIntoView` then export | `rb: null`, `bytes: 149` |
| 66 | minimal sanity test on fresh nodes | works fine — proves the VM is healthy |
| 67 | rebuild card | crashed (`appendChild of null`) |
| 69 | rebuild card, export in same run | **`h: 1`** — the collapse reproduced in isolation |
| 72 | walk tree, re-set sizing mode where `height<=2` | **`fixed: 17`**, `rootH: 3978` |

**Root cause:** documented Figma auto-layout behaviour the agent did not know, invisible until export. Two things let it run for 8 minutes:

1. **No assertion covers height collapse.** `assertions.js` has `balloon frame` (100px counter-axis) and `width_collapse`, but nothing for an auto-layout frame at height ≤ 2 — arguably the more common failure since it's what `resize(w, 1)` produces.
2. **`run_script` bypasses the assertion layer entirely.** A `write` producing these frames would have warned. The script did not, so the only feedback channel was a blank screenshot — the slowest possible one.

The 149-byte export at #64/#65 is Figma's empty/1×1 PNG. Worth cross-referencing: **session 45 saw 149-byte 1×1 PNGs from the *official* MCP** and attributed them to a fallback-path bug. Same byte count, same signature — collapsed source nodes are a likelier explanation there too.

**Proposed fix:** (a) add a `height_collapse` post-write assertion mirroring `width_collapse`; (b) surface post-write assertions from `run_script`'s `mode: "write"` results — this session is the clean argument for it, and it consolidates a note already repeated in [TOOL-025], [TOOL-027], [AGENT-025] and [BUG-028]; (c) document the resize/sizing-mode interaction in `figma-guidelines` — *set sizing modes after `resize()`, or resize the counter axis only*.

**Estimated savings:** ~14 calls → ~1 (a warning on the first script that created the frames).

### 2. Batch `screenshot` fails whole while every member succeeds individually (~7 calls)

Two batch calls returned `Exported 0 node(s): none`:

| # | Call | Result | Immediately after |
|---|---|---|---|
| 76 | `screenshot({nodeIds:["12:2978","12:3187","12:3818","12:3033"], scale:0.6})` | `Exported 0 node(s): none` | #77 `12:2978` @ **0.8** ✅, #78 `12:3187` @ 0.7 ✅, #79 `12:3818` @ 0.7 ✅ |
| 94 | `screenshot({nodeIds:["17:829","17:1206","17:1253","17:1505"], scale:0.7})` | `Exported 0 node(s): none` | #95–#100, all six @ **0.8** ✅ |

Every node in both failed batches exported cleanly seconds later **at a larger scale**. A 2-node batch at `scale: 1` (#91) succeeded. This is the exact signature already recorded in sessions 41, 46, 47 and 48 — `allIds`, `ids` and `dataless` all empty at once, no `Errors:` block, no `Returned no image data` block — and it is now paired with the strongest possible control: the same nodes, bigger renders, working.

**Root cause:** consistent with [BUG-016] v5 (`remote/client.ts:110–114` returning unparseable response text as if it were the result object). A 4-image response is longer text than a 1-image response, so it truncates more often — which is why batch fails where its members don't, and why `scale` *sometimes* appears to help.

**Estimated savings:** ~7 calls (2 failures + 5 fan-out calls that a working batch would have absorbed).

### 3. Walking into instance descendants kills the whole script (~4 calls, 35K chars re-authored)

Three build scripts died on synthetic instance-child IDs:

- **#82** — `Error: in get_children: Node with id "I14:1842;7:1982;7:1870" not found`, thrown from the collapse-repair walker doing `(n.children||[]).forEach(fix)`.
- **#101** — `Error: in get_componentProperties: Node with id "I12:3759;2223:498" not found`, thrown from `sp()` reading `.componentProperties`.
- **#80** — `TypeError: cannot set property 'visible' of undefined` after `menu.findAll(...)` returned entries that didn't resolve.

In each case the ID came *from the VM itself* — `.children` and `findAll()` returned it, and the very next property read on it failed. The stack frames (`at get (<input>:35:11)`) place the throw in the `use_figma` wrapper's node proxy, not in user code.

Because scripts are atomic, each failure discarded the entire authored payload: **#80 (12,498 chars), #82 (12,248), #101 (10,558) = 35,304 characters** re-authored as #83 (12,259) and #102 (10,115). The agent learned the workaround twice — `if(n.type==='INSTANCE')return;` appears in #101's walker but was still missing from `sp()` in the same script.

**Proposed fix:** document the constraint in `run_script`'s description (*do not read properties off nodes below an INSTANCE — the remote VM cannot resolve `I…;…` IDs; stop traversal at `type === "INSTANCE"`*), and have the `fig.*` stdlib's traversal helpers stop at instance boundaries by default. Cheap, and it converts a 12K-char atomic loss into a no-op.

### 4. `search_library_components` still has no batch form (~12 calls) — [TOOL-021], 5th recurrence

18 single-`query` calls, in four clean runs: #21–24 (`ToolsPanel`, `ItemGroup`, `Notice`, `RangeControl`), #29–32 (`DropdownMenu`, `ColorIndicator`, `Navigator`, `Tooltip`), #34–38 (`Card`, `Field`, `EmptyState`, `Menu`, `Tooltip`), #56–59 (four icon lookups: `chevron-right`, `more-vertical`, `plus`, `arrow-left`). A `queries: string[]` form collapses these to ~4. Fifth session, third distinct repo — the pattern is not file-specific and the spec has been stable since session 44.

### 5. Preamble re-sent in 15 of 28 scripts — [TOOL-031], 3rd recurrence

Every build script re-declares the same block: a 4-style `Promise.all(loadFontAsync)`, an `sp(instance, props)` component-property setter that resolves bare names against `#`-suffixed keys, an async `I(key, props, w, h)` library-instance importer, a `hex`/`solid` colour pair, `T()` and `FR()` factories, and (after #72) the collapse-repair walker. That is ~1.5–2KB re-sent 15 times. The `fix()` walker in particular is a workaround for issue 1 above being carried by hand from script to script — the clearest illustration yet of why a server-side `preamble` cached per fileKey is worth having.

## Error Analysis

### 1. `screenshot` export failures (9 of 40, 22.5%) — [BUG-016], 11th recurrence

All nine arrived as readable text with `is_error: true` and the `export.ts:44–46` guard text blaming the "~4MB return cap". Two new falsifications, both stronger than anything on record:

- **`20:1029` is 552×273** (confirmed by `read` #107) and failed at **`scale: 0.8`** — a ~442×218 render. It succeeded at 0.6. This is the smallest render to fail yet, beating session 48's 784×453.
- **`7:2` failed at `scale: 0.06`.** The board is 1792×14718, so that is a ~108×883 render — roughly 0.1 MP. The guard's recommended remedy is "re-request at a lower scale"; the agent was already at 0.06.

Remedy scorecard for this session: lower `scale` worked 3/6 (`12:884` 0.5→0.35, `16:1658` 0.4→0.3, `20:1029` 0.8→0.6) and failed outright 3/6 (`7:3` 0.45→0.4 abandoned, `7:2` at 0.06). `format: "SVG"` was not attempted — the agent had no reason to trust it, and sessions 47 and 48 confirm it would likely have failed.

**Agent recovery:** clean. No retry storms (max 2 attempts on any node), no `ToolSearch` for the competitor, **zero official-Figma-MCP calls** — in a project (`loupe`) that has never seen a corrected memory file. The behavioural half of the v3 fix now holds across **4 consecutive sessions and 3 distinct projects**. When `7:3` failed twice the agent screenshotted a sibling instead and moved on; when `7:2` failed at 0.06 it screenshotted the other board root (`12:2`) at 0.12 and got what it needed.

**Fix needed:** v5 item (0) — make `callOfficialTool` throw on unparseable response text instead of returning the raw string. v5 item (2) — reword the guard to "the remote transport returned no image data" and gate the scale/SVG/child-node advice on the v4 `payloadChars` scalar. This session is the fourth consecutive one where the message's stated fix was partly wrong.

### 2. `run_script` failures (5 of 28, 17.9%)

| # | Error | Cause |
|---|---|---|
| 46 | `unloaded font "SF Pro Regular" … "SF Pro Medium"` | Appending a published-library instance pulls in fonts the script never loaded. Fixed by the agent walking the imported subtree for `fontName` and loading each — a 6-line block then re-sent in every subsequent script. |
| 67 | `TypeError: cannot read property 'appendChild' of null` | `getNodeByIdAsync('7:6')` returned null for a grid frame removed by an earlier script. Stale ID from the agent's own prior output. |
| 80, 82, 101 | instance-descendant traversal | Issue 3 above. |

All five were correctly flagged `is_error: true` and all carried the atomicity note (`no changes were applied; safe to retry`), which is doing its job — the agent re-sent immediately with a fix rather than probing for partial state.

The font failure at #46 is notable as a **`write`-path regression avoided by accident**: `fig.setCharacters` in the stdlib handles font loading, but a raw `appendChild` of an imported instance does not, and nothing warns. Since [AGENT-025] already records "#311 unloaded font" as a session-44 script failure of the same kind, this is the second occurrence.

## What Worked Well

1. **Atomic script semantics paid for themselves five times.** Every `run_script` failure reported `atomic: no changes were applied; safe to retry`, and in all five cases the agent re-sent a corrected script rather than inspecting for half-applied state. On a 26-card build with 1260 nodes, that guarantee is what made 17.9% script failure survivable.
2. **The `is_error: true` guard from `0af2c9a` continues to hold — now unbiased across three projects.** Nine export failures, zero protocol crashes, zero defection to the official MCP, in a repo with no corrected memory file. Sessions 46 (tutored) and 47/48/49 (untutored) make this the best-verified fix in the tracker.
3. **`grep` used well as a bridge between script output and screenshots.** Five calls, each scoped to a section (`scope: "12:16"`, `"12:21"`, `"7:2"`) with an anchored regex (`^pattern/`, `^size-control$|^Modal$`), to recover node IDs for visual checks without re-reading trees. #103 found all 26 cards grouped by section in one call across 1260 nodes.
4. **`get_component_variants` was batched correctly both times** — 3 component-set IDs per call (#43, #44), no single-ID runs. The batch form of this tool is being used as designed.
5. **The agent diagnosed its own layout bug from first principles.** Once #66 proved the VM could export a fresh frame and text fine, it correctly concluded the problem was in the built tree, not the renderer, and the very next rebuild (#69) reproduced `h: 1` in isolation. That is the right shape of investigation — it was just 8 minutes that a warning would have saved.

## Priority Improvements

### Tool Changes (ranked by call savings)

1. **`remote/client.ts:110–114`** — never return unparseable response text as a result; throw a fix-stating error. [BUG-016] v5 item (0). Saves ~16 calls/session and is now at 11 recurrences with the root cause pinned. **P0.**
2. **Reword the `export.ts` guard text** — "the remote transport returned no image data"; gate the scale/SVG/child-node remedies behind a real `payloadChars` measurement. Four consecutive sessions have followed advice that was wrong for their failure. Ships independently of item 1. **P0.**
3. **Surface post-write assertions from `run_script`** + add a `height_collapse` assertion. Saves ~14 calls/session in script-built layouts and retires a caveat repeated in four other tracker entries. **P1.**
4. **Stop `fig.*` traversal at INSTANCE boundaries; document the `I…;…` ID limitation** in `run_script`'s description. Saves ~4 calls and ~35K chars of re-authored script per script-heavy session. **P1.**
5. **`search_library_components({ queries: [...] })`** — [TOOL-021], 5th recurrence, ~12 calls here. Ship with [TOOL-026]'s identical change. **P1.**
6. **`run_script({ preamble })` cached per fileKey** — [TOOL-031], 3rd recurrence, ~25K chars of duplicated helpers this session. **P2.**

### Agent Skill Updates

1. **Set auto-layout sizing modes *after* `resize()`, never before** — `resize()` on the primary axis forces that axis to `FIXED`. For a fixed-width hugging frame: `resize(w, h)` first, then `primaryAxisSizingMode = 'AUTO'`. Add to `figma-guidelines` next to the existing balloon-frame and width-collapse recipes.
2. **Never read properties off nodes below an INSTANCE in a script.** `.children` and `findAll()` will hand you `I…;…;…` IDs the VM cannot resolve; guard traversals with `if (n.type === 'INSTANCE') return;` *and* guard property reads, not just recursion — this session's #101 fixed the walker and left `sp()` exposed.
3. **After appending an imported library instance, load every font in its subtree** before touching text. Walk for `fontName`, `Promise.all(loadFontAsync)`. Second occurrence of this exact failure ([AGENT-025] #311 was the first).
4. **When a screenshot returns no image data, do not walk the scale down more than once.** Three of six scale reductions failed this session, including one at 0.06. Switch to a smaller *sibling* node or verify structurally via `read` — which is what the agent did on the third strike, correctly.
