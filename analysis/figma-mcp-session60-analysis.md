# Figma MCP Session 60 Analysis

## Session Overview

- **Transcript**: `.claude/sessions-json/e95d2d76-6d8e-4295-a5f9-a9f15ed8d1aa.json`
- **Duration**: 12 minutes (2026-09-02 03:29:59 → 03:41:32 UTC); active tool work is 5.5 min (03:31:15 → 03:36:41), the remainder is a 100-second `AskUserQuestion` wait
- **Total tool calls**: 24 (15 Figmagent, 7 Bash, 1 ToolSearch, 1 AskUserQuestion)
- **Total errors**: 3 hard (`is_error: true`) — 2 `run_script`, 1 `write` — plus **1 unflagged wrong answer** (`get_reactions`)
- **Reconnections**: 0 (1 `use_file`)
- **Context restarts**: 0
- **Transport**: remote — Figma file `C4zLeQJs8qkAhFSLwMKP9J` ("Archer")
- **Project**: external `~/Github/storybook`, branch `main` — **eighth analysed session on this project/file** (S53-S59, S60)
- **Task**: give the Figma `Accordion` component the interactive behaviour of the Storybook Base UI `Accordion` — hover/click prototype reactions on the variant set, timed to the CSS transition tokens, plus a single-select prototype flow mirroring the `Default` story

**Concurrency**: three MCP processes were writing this file again. Session `0fd99f95` ran 03:20:22 → 04:24:06 and `4ac78b46` ran 03:27:14 → 03:56:28; this session (03:29:59 → 03:41:32) sits entirely inside both. No collision is attributable — this session touched only page `1:6` (`Accordion`) — but the pattern established across S53-S59 held for an eighth run.

**Outcome: half the task shipped.** The interactive component landed and was verified: 10 reactions across 8 variants of `Accordion Item` (`11:58`), Smart Animate throughout, durations lifted straight from `config/base.tokens.json` (`duration.base` 250ms for open/close, `duration.fast` 150ms for hover) and easing from the same file's `cubic-bezier(0.4, 0, 0.2, 1)`. Disabled variants deliberately carry zero reactions, matching the CSS `pointer-events` dead state. That is a genuinely good code→design fidelity result.

The **single-select prototype flow was abandoned**, blocked by [BUG-033]. The agent stopped, put the choice to the user via `AskUserQuestion`, and the user chose "stop here, multi-open only".

Two things make this session worth keeping. It is the **first session to author prototype interactions**, which exposes that Figmagent has no tool for it at all — the entire deliverable ran through `run_script`. And it caught **`get_reactions` returning a confidently wrong empty answer**, which a code read confirms is an unconditional filter, not a remote-transport artifact.

## Metrics

| Metric | Session 58 | Session 59 | This Session | Change vs S59 |
|---|---|---|---|---|
| Total tool calls | 69 | 32 | 24 | −25% |
| Figma tool calls | 55 | 21 | 15 | −29% |
| Official-MCP calls | 0 | 0 | **0** | held (**13th consecutive**) |
| Hard errors | 4 | 2 | **3** (all Figmagent) | +1 |
| Figma error rate | 7.3% | 4.8% | **20.0%** (3 of 15) | **+15.2pp** |
| Unflagged wrong/soft answers | 0 | 1 | **1** (`get_reactions`) | held |
| `run_script` share of Figma calls | 36.4% | 19.0% | **53.3%** (8 of 15) | +34.3pp |
| `run_script` share of write ops | 100% | 25.0% | **50.0%** (3 of 6) | +25pp |
| ToolSearch | 3 (4.3%) | 2 (6.3%) | 1 (4.2%) | −2.1pp |
| Estimated waste % | ~28% | ~34% | **~37%** (9 of 24) | +3pp |

The error rate and `run_script` share both regressed against session 59, but not because the agent behaved worse — the denominator is small (15 Figma calls) and **every** one of the 8 scripts and 3 errors traces to one of two gaps neither the agent nor any first-class tool could route around: no reaction-authoring tool, and [BUG-033]'s font absence. Session 59's low `run_script` share came from a task that first-class tools could carry; this task had no such path.

## Tool Call Distribution

| Tool | Calls | Notes |
|---|---|---|
| `run_script` | 8 | 2 discovery, 1 the reaction write (**no tool exists**), 2 failed builds, 2 font/clone probes, 1 verify forced by `get_reactions` returning nothing |
| Bash | 7 | Read the Storybook `Accordion.tsx`/`.scss`/`.stories.tsx` and `base.tokens.json` — all appropriate |
| `read` | 2 | `11:26` (`detail: layout`), `11:59` (`detail: full`) — both landed, no re-reads |
| `write` | 2 | 1 probe FRAME (ok), 1 clone `fromNodeId` (**failed**, font) |
| `use_file` | 1 | clean |
| `edit` | 1 | delete of the probe FRAME — clean cleanup |
| `get_reactions` | 1 | **returned `nodesWithReactions: 0` for 6 nodes holding 10 reactions** |
| ToolSearch | 1 | 12 tools selected in a single batched call — the efficient form |
| AskUserQuestion | 1 | correct call: surfaced a blocked scope decision rather than guessing |

## Efficiency Issues

### 1. No tool authors prototype reactions — the whole deliverable ran through `run_script` (saves ~2 calls/session, and retires a whole `run_script` category)

The one thing this session was asked to do — wire interactive-component behaviour — has **no first-class surface**. Figmagent ships `get_reactions` (read), `create_connections` (draws FigJam connector lines), and `set_default_connector`; nothing calls `setReactionsAsync`. `grep -rn "setReactionsAsync" src/` returns nothing.

**Pattern observed:** a 1,575-character script that is almost entirely declarative boilerplate — three factory helpers (`anim`, `toVariant`, `click`/`enter`/`leave`), an 8-entry variant map, an 8-row plan table, then a loop of `await node.setReactionsAsync(reactions)`. The payload is 10 reactions expressible in ~10 lines of JSON.

**Root cause:** the prototyping surface was inherited from the upstream FigJam-connector workflow and never grew a writer. `node.setReactionsAsync(reactions)` is a plain async setter that batches trivially across nodes — the same shape `edit` already uses.

**Proposed fix:** a `set_reactions({ nodes: [{ nodeId, reactions: [...] }] })` tool, or a `reactions` field on `edit` (which already batches by `nodeId` and already owns "modify existing node"). Accept a compact form — `{ on: "click" | "hover" | "mouseEnter" | "mouseLeave", to: nodeId, navigation: "CHANGE_TO" | "NAVIGATE", transition: "SMART_ANIMATE" | "DISSOLVE" | "INSTANT", duration, easing }` — and expand to Figma's verbose shape server-side. `reactions: []` clears, which is what the two Disabled variants needed.

**Estimated savings:** 1 script → 1 `edit` call per interactive component, and the ~40 lines of easing/navigation boilerplate stop being re-derived per session. Ranked by raw calls this is small; ranked by "categories of work that require the escape hatch" it removes one entirely.

### 2. `get_reactions` returning empty forced a hand-rolled verification script (saves ~1 call, and removes a wrong answer)

The agent finished the write, then called `get_reactions(["11:2","11:8","11:26","11:34","11:14","11:42"])` to verify. It got `{"nodesCount":6,"nodesWithReactions":0,"nodes":[]}`. Those six nodes held **10 reactions** — the write script had returned per-node counts of 2/2/2/2/1/1 six minutes earlier, and a `run_script` seven seconds later read them all back with full trigger/destination/duration detail.

**Root cause (confirmed by code read):** `src/figma_plugin/src/commands/document.js:67-73` filters out every reaction whose action navigation is `CHANGE_TO`. Every variant-swap reaction in an interactive component is `CHANGE_TO`, so the tool's answer for an interactive component set is always "no reactions". The filter belongs to the connector-drawing use case — a same-frame variant swap has no meaningful connector line — but it is applied in the **read**, so the data never reaches the caller.

**Proposed fix:** stop filtering in `getReactions`. Return every reaction and let `reaction_to_connector_strategy` drop `CHANGE_TO` at the point it builds connector params. If a filtered form is still wanted, make it an explicit opt-in parameter that defaults to including everything.

**Estimated savings:** ~1 call per verification, but the value is correctness: today the tool answers "there are none" for a class of node where the answer is never none.

### 3. `get_reactions` appends an unconditional "You MUST … required next step" even on an empty result (saves ~0 calls; removes a false instruction)

Both the tool description (`src/figmagent_mcp/tools/scan.ts:12` — *"CRITICAL: The output MUST be processed using the 'reaction_to_connector_strategy' prompt IMMEDIATELY"*) and a hardcoded second content block (`:27`) instruct the agent that drawing connectors is a required next step. This session's call returned zero nodes and the agent's goal was pure verification; the instruction was false on both counts.

**Root cause:** upstream cruft from the connector workflow, where `get_reactions` existed only as step 1 of a two-step pipeline. It is now also the natural verification read for the (missing) write tool in issue 1.

**Proposed fix:** demote both to conditional/optional — describe the tool as "read prototype reactions", and append the connector suggestion only when `nodesWithReactions > 0` and phrase it as an option, not a requirement. Cheap, and it stops the tool from mis-steering agents toward FigJam output on a design file.

### 4. Two failed multi-KB build scripts before the blocker was isolated (~4 calls)

Script 4 (4,159 chars — build four prototype frames from `createInstance`) failed on the first `appendChild`. The agent then probed fonts (script 5), probed clone+swap+append (script 6), rewrote the build with `layoutMode: 'NONE'` and manual positioning (script 7, 2,314 chars) — which failed on `appendChild` again — then cross-checked with the first-class `write({fromNodeId, parentId})` into a scratch FRAME, which failed identically.

**Root cause:** the raw Figma error (`in appendChild: unloaded font "PP Neue Montreal Semibold". Please call figma.loadFontAsync(…) first`) names a remedy that cannot work, because the family does not exist in the VM. This is [BUG-033] remedy (a), still unshipped after eight sessions.

**Worth recording as a fact the tracker did not have:** script 6's probe established that append into an **auto-layout** frame fails, which the agent reasonably read as "auto layout is the trigger". Script 7 tested `layoutMode: 'NONE'` and failed at the same call. **`appendChild` of a node carrying an unavailable font fails regardless of the parent's layout mode** — one script's worth of a dead hypothesis that a correct error message would have prevented.

**Agent recovery was otherwise good:** no retry storm, no face-spelling ladder, three distinct hypotheses each tested once, then a first-class cross-check, then a stop.

## Error Analysis

### 1. [BUG-033] font absence — 3 hard failures, 2 abandoned build scripts, ~2.5 minutes, and one deliverable dropped (8th recurrence)

Identical family (`PP Neue Montreal`), identical file, identical root cause as sessions 53-59. Three surfaces failed here:

| # | Surface | Error |
|---|---|---|
| script 4 | `run_script` → `createInstance` + `appendChild` | `in appendChild: unloaded font "PP Neue Montreal Semibold"` |
| script 7 | `run_script` → `clone()` + `appendChild` (no auto layout) | same, at the `container.appendChild(row)` line |
| `write` | **first-class** `write({fromNodeId: "11:60", parentId: "63:322"})` | `in appendChild: unloaded font "PP Neue Montreal Regular" … "PP Neue Montreal Semi Bold"` |

The `write` failure is the **second time this lands on a first-class tool** (session 59's was `edit({index})`). Session 59's note argued that routing `edit`'s structural operations through a park-and-restore mode would retire the claim *"any structural edit on a custom-font file is `run_script`-only"*. This session adds `write`'s `fromNodeId` clone to the list of operations that need it — cloning a text-bearing subtree into a new parent is exactly the structural operation a park-and-restore mode exists for.

**The new consequence is a dropped deliverable, not just extra calls.** Every prior recurrence cost calls and then completed via the park/swap workaround. Here the agent judged the workaround out of scope for a prototype-flow build — parking fonts across three cloned rows × four frames — and escalated to the user, who cut the scope. Eight sessions of "costs ~7 calls" has become "costs the feature".

**Agent recovery:** best-in-class for this entry alongside session 57's. No retry of a failed call, three distinct hypotheses, a first-class cross-check that confirmed the diagnosis was not script-specific, then an honest scope escalation. It also proposed the correct remedy in the question it asked — switch to the plugin transport, where the desktop client has the font.

**Fix needed (unchanged, now with more evidence):** [BUG-033] remedy (a) — when `loadFontAsync`/`appendChild` throws an unloaded-font error, check `listAvailableFontsAsync` and `fail()` with the true cause; plus the `allowFontFallback` / park-and-restore mode on `write` and `edit`.

### 2. `get_reactions` wrong answer (1 unflagged, `is_error: false`)

Covered in efficiency issue 2. Categorised as an error rather than an inefficiency because the response is affirmatively wrong, carries `is_error: false`, and would have been believed by an agent that had not just written the data itself. An agent auditing an unfamiliar file's prototype wiring would conclude the file has no interactions.

## What Worked Well

1. **Code→design fidelity through the token pipeline.** The agent read `Accordion.scss`, found the transition declarations, then went to `config/base.tokens.json` for the actual values rather than eyeballing the CSS — `duration.fast` 150ms for hover, `duration.base` 250ms for open/close, `easing.ease-in-out` `(0.4, 0, 0.2, 1)` — and encoded exactly those into `CUSTOM_CUBIC_BEZIER` Smart Animate transitions. The prototype's motion matches the component's real motion, not an approximation.
2. **Behavioural fidelity including the negative case.** Disabled variants got `reactions: []` deliberately, matching `pointer-events: none` in the SCSS. Focused variants got click-only, preserving the `State` axis across the `Open` toggle. This is a designed interaction model, not a mechanical wiring.
3. **Failure isolation without a retry storm.** Three hypotheses (font absence → auto-layout append → plain append), each tested exactly once, then a **first-class-tool cross-check** that proved the blocker was not an artifact of the agent's own script. [AGENT-029] executed correctly.
4. **Clean scratch-node hygiene.** The probe FRAME `63:322` was created, used, and deleted in the same three-call window. The user's standing rule about orphaned nodes was honoured without being restated. (Note: script 6's cloned COMPONENT `63:101` was removed inside the script's own `finally`-equivalent path.)
5. **Honest scope escalation.** Rather than half-building the flow or silently dropping it, the agent used `AskUserQuestion` with a concrete recommendation (open the plugin transport) and a concrete alternative. The closing summary states plainly what was not built and why — no hedging, no false completion.
6. **Batched ToolSearch.** One call selecting 12 tools, at 4.2% of calls — the lowest ToolSearch overhead of the recent Archer sessions.

## Priority Improvements

### Tool Changes (ranked by impact)

1. **`get_reactions` — stop dropping `CHANGE_TO`** (`src/figma_plugin/src/commands/document.js:67-73`). One filter removal converts a tool that lies about interactive components into one that reads them. Highest value-per-line change available in this analysis.
2. **Add reaction authoring** — `set_reactions`, or a `reactions` field on `edit`. Removes the only category of Figma work with zero first-class coverage.
3. **`allowFontFallback` / park-and-restore on `write` and `edit`** — now demanded by two first-class surfaces (`edit({index})` in S59, `write({fromNodeId, parentId})` here) and by a dropped deliverable.
4. **[BUG-033] remedy (a)** — replace Figma's unreachable "call `loadFontAsync` first" with the true cause. Eight sessions, unshipped; it would have saved this session's script-7 dead hypothesis outright.
5. **`get_reactions` description and trailing block** (`src/figmagent_mcp/tools/scan.ts:12,27`) — make the connector follow-up conditional and optional.

### Agent Skill Updates

1. **Verify a write with the same surface that made it, when the read tool is unproven.** The agent's write script already returned per-node reaction counts; the `get_reactions` call added nothing but a contradiction. Cheap general rule: when a write returns its own readback, a second verification read is only worth making if it can disconfirm something the write could not see.
2. **On a custom-font file, decide the font strategy before writing the build script.** Both abandoned scripts here were multi-KB and structurally complete; the blocker was knowable from a single `listAvailableFontsAsync` probe against the file's text styles, which the agent eventually ran as script 5. On any file whose type is not Google/system, probe first. This is the agent-side counterpart of [TOOL-045].
