# Figma MCP Session 65 Analysis

## Session Overview

- **Transcript**: `.claude/sessions-json/0f54fea9-aae0-4c5d-90ff-58b603df70ff.json`
- **Duration**: 37 minutes (17:02:01Z → 17:38:56Z, 2026-09-04); three user turns plus one `AskUserQuestion`, ~5 minutes of waiting on the user in total
- **Total tool calls**: 149 (84 Figmagent, 45 Bash, 11 Edit, 3 Read, 5 ToolSearch, 1 AskUserQuestion)
- **Total errors**: 9, all Figmagent (10.7% of Figma calls) + **1 unflagged silent no-op** (`edit` #119) + 1 script-level silent binding loss (`run_script` #128, the agent's own code — see [TOOL-060])
- **Reconnections**: 0 (remote transport — no channels)
- **Context restarts**: 0
- **Official-Figma-MCP calls**: 0
- **Transport**: remote (`use_file` by fileKey `C4zLeQJs8qkAhFSLwMKP9J`)
- **Repo**: external — `~/Github/storybook` ("Archer" design system), branch `main`; model `claude-sonnet-5`
- **Task**: (1) sync three token-bearing commits into the Figma library — mint `color/white`, `color/black`, `color/brand-surface/*`, `color/primary-surface*`, `color/text/on-primary`, the `*/border-color-hover` / `switch/bg-hover` / `tabs/disabled-opacity` / `size/control-lg` tokens, rebind 15 button/toggle/toast variables, delete 6 orphans, write the new IDs back to `config/*.tokens.json`; (2) audit which of 20 code-changed components need Figma changes; (3) build the gaps — Hover variants on Checkbox/Radio/Switch, re-point the Autocomplete demo instance off an orphaned legacy component, remove a duplicate Combobox Chip focus ring

This is the **13th analysed session on the "Archer" file**, the day after sessions 63 (the library-wide focus refactor that gave 39 components a hidden-by-default `Focus` ring) and 64. That refactor is the precondition for this session's main finding: the file now carries dozens of layers that exist but are hidden, and `read` does not show them by default.

**Analysis provenance.** The nightly pipeline first attempted this session on 2026-09-05 (run `20260905T030420`). That analyzer read the full transcript but could not write any output — Claude Code treats `.claude/` as a protected path and denied every `Write` under `--permission-mode dontAsk` — and it also tripped the pipeline guard with an inline `bun -e` indexing script. This analysis was produced interactively on 2026-09-11 after `analysis/` and `plans/` moved out of `.claude/`. Its findings were re-derived from the transcript; one of the first attempt's findings (a claimed `setBoundVariable` string-id no-op) did not survive re-derivation and is recorded as [TOOL-060] with the actual cause.

## Metrics

| Metric | Session 64 | This Session | Change |
|---|---|---|---|
| Total tool calls | 83 | 149 | +80% (task was three turns, two of them repo-side) |
| Figmagent tool calls | 58 | 84 | +45% |
| `run_script` share of Figma calls | 29 of 58 (50.0%) | **6 of 84 (7.1%)** | −42.9 pts — lowest on this file |
| `run_script` share of write ops | 13 of 26 (50%) | **5 of 29 (17%)** | −33 pts |
| `read` calls | 0 | 30 | +30 |
| Errors (Figma) | 3 (5.2%) | 9 (10.7%) | +5.5 pts |
| Unflagged soft failures | 3 | 1 (+1 script-level) | −2 |
| Estimated waste | ~36% of Figma calls (21 of 58) | **~23% of Figma calls (19 of 84)** | −13 pts |
| ToolSearch calls | 2 (2.4%) | 5 (3.4%) | +3 (deferred-tool loading) |

The first-class tools carried almost everything. Of the 19 wasted calls, **10 are the custom-font wall** ([BUG-033] and two new faces of it) on a single component — the Radio Hover clone — and 3 are re-reads forced by `read` hiding the layers the agent was looking for ([TOOL-059]).

## Tool Call Distribution

| Tool | Calls | Notes |
|---|---|---|
| Bash | 45 | repo-side token archaeology (`git show`, `grep`, `python3` JSON reads), `npm run tokens:*` |
| `read` | 30 | 9 with `filter: { visibleOnly: false }` (#91 onward); 3 re-reads of the same node after the hidden-layer misread; #81–#83 three single depth-0 reads later repeated as one batch (#113) |
| `edit` | 12 | 2 failed (#137 [BUG-039], #142 componentProperties on a COMPONENT — correct pre-mutation rejection); 1 silent no-op (#119, [BUG-052]) |
| Edit | 11 | repo token JSON |
| `grep` | 11 | 0 failed; #28 found the one live consumer of 6 orphan variables before deleting them |
| `screenshot` | 8 | 1 failed (#73, [BUG-016]) |
| `run_script` | 6 | 3 failed (#122, #126, #127 — the font wall), 1 diagnostic (#134), 1 repair (#135) |
| `write` | 5 | 3 failed — byte-identical `appendChild: unloaded font` on the Radio clone (#117, #118, #120) |
| ToolSearch | 5 | loading deferred Figmagent tools |
| `get_design_system` | 4 | filtered by `collection` + `namePattern` every time |
| `create_variables` | 4 | 1 partial (#40: 7 created, 1 duplicate name — reported with its fix, `is_error` correctly false) |
| Read | 3 | |
| `update_variables` | 3 | #44: 15 rebinds, 0 failed; #47: 6 deletes, 0 failed |
| AskUserQuestion | 1 | delete-the-orphans confirmation |
| `use_file` | 1 | |
| **Total** | **149** | 84 Figmagent + 65 other |

## Efficiency Issues

### 1. `read` hides the layers an audit is looking for (saves ~4 calls, and one wrong answer)

The second user turn asked which code-changed components need Figma changes. The agent read the candidates and at 17:25:05Z presented a gap table claiming **Tabs Panel** has *"no ring layer wired to it. Dead property."*, **Popover Popup** has *"No Focus property or ring at all"*, and that Input, OTP Field, Number Field and Combobox need the same focus fix — then asked the user to approve building focus rings on all of them.

**Pattern observed:** #85 (`toolu_011VdGR3KKBvy2MbFhPaqpgn`, Popover Popup, `detail: "structure"`, `depth: 2`) returned `meta.nodeCount: 12` and listed **10** nodes; #86 (`toolu_01YY2dE5nNJWp3hi87JhkbKS`, Tabs Panel, `depth: 1`) returned `nodeCount: 3`, listed **2**, and showed a `Focus#345:27` BOOLEAN property with no layer for it. The missing nodes were the hidden Focus rings session 63 built (`Focus` defaults to false, so the ring is `visible: false`). The agent only found them once it re-read with `filter: { visibleOnly: false }` (#91 Tabs Panel, #92 Popover Popup, #93 Autocomplete — the same three nodes again). Its final summary: *"my last-turn triage had mistakenly flagged some of these because default reads filter out hidden layers (the ring is hidden until `Focus=true`)."*

**Root cause:** `document.js:459-462` counts a node (`nodeCount++`) **before** `if (visibleOnly && !isVisible) return []`, so a hidden node and its subtree vanish from the output while still inflating `meta.nodeCount`. The `read` description never says hidden nodes are skipped; the only mention is the `visibleOnly` parameter's *"Skip invisible nodes. Default: true"*. This repo's CLAUDE.md documents it, but an agent working in another repo sees only the tool description.

**Proposed fix:** say it in the `read` description and the `visibleOnly` parameter — hidden nodes are skipped with their subtrees, property-toggled layers such as Focus rings are hidden by default, and the right move before concluding a layer is missing is `filter: { visibleOnly: false }`. Filed as [TOOL-059] (description-only).

**Estimated savings:** ~4 calls → 0 here; the averted cost is larger — had the user approved the table, the agent would have built duplicate rings on up to seven components that already had one.

### 2. The custom-font wall on one clone (saves ~10 calls)

Cloning Radio's `Checked=False, State=Default` variant into a Hover variant took 12 calls; the identical clone on Checkbox (#116) and Switch (#125) took one each, because those variants carry no text.

**Pattern observed:** `write({fromNodeId: "215:4"})` failed three times with the byte-identical `in appendChild: unloaded font "PP Neue Montreal Regular"` (#117 `toolu_01Ar6chhhPjjTax3WYk1eq2g`, #118, #120 `toolu_017NZDHz9kw5ZgHC7xf6E5VX`). Between #118 and #120 the agent tried to "load" the font through `edit({fontFamily: "PP Neue Montreal", fontWeight: 400})` (#119), which returned `success: true` and did nothing ([BUG-052]). It then moved to `run_script`: #122 `fig.loadFont` failed with the true cause (the [BUG-041] fix working), #126 failed on `loadFontAsync` of the original face, #127 threw `in setBoundVariable: invalid variable id`, #128 succeeded but silently dropped the label's `fontFamily` binding ([TOOL-060]), and #133–#135 found and repaired it.

**Root cause:** [BUG-033] — the remote VM has no custom fonts and `appendChild` of a text-bearing subtree needs them loaded. Two new faces of it are filed separately because each is a distinct defect: an `edit` that reports success for a font swap that cannot happen ([BUG-052]), and a `run_script` description that never says TEXT-node `boundVariables` are arrays ([TOOL-060]).

**Proposed fix:** [BUG-033]'s park-and-restore contract (#145), which must also restore `textStyleId` (see Error Analysis 1); [BUG-052] and [TOOL-060] below.

**Estimated savings:** ~10 calls → ~1 call.

## Error Analysis

### 1. Remote custom-font failures (6 of the 9 errors, ~6 minutes lost)

`write` ×3 (#117, #118, #120) and `run_script` ×3 (#122, #126, #127) — all the Radio clone. The `write` error is Figma's raw text (*"Please call figma.loadFontAsync(...) and await the returned promise first"*) with the executor's *"(atomic: no changes were applied; safe to retry)"* suffix; there is no Figmagent `Fix:` naming the remote-font cause.

**Agent recovery:** mixed. #118 was an identical retry 8 seconds after #117 with nothing changed, and #120 a third identical call after the no-op `edit` — two wasted retries ([AGENT-029]). The `run_script` half then changed strategy on every attempt, and the agent verified its own result with a re-read (#133), which is how the dropped `fontFamily` binding was caught one call after it happened.

**Lasting damage:** the park recipe (#128) assigns `fontName` on the **source** component's label (`215:8`), which detaches its `ui/body` text style — #128 returned `labelTextStyleId: ""` and #133 read back `styles: {}`. On remote the style cannot be re-applied (its font is unavailable), so the agent left the library's Radio main component without its text-style link and said so in its final message. The park-and-restore contract has to cover `textStyleId`, or park at style level ([BUG-037]).

**Fix needed:** [BUG-033] (#145).

### 2. `setProperties` fix string names the wrong cause (1 failure)

#137 (`toolu_01QdMr425CsCdxu4NzRdhwvF`) re-asserted four property values on instance `27:83` after a successful variant swap and failed: *"Unable to update this text property because the component uses a font that isn't available.. Fix: verify each value matches its property type — VARIANT options must be exact…"* — the same wrong remedy as sessions 55 and 56, now at `apply.js:688`.

**Agent recovery:** good — one read (#138) showed the swap had already carried the properties over, and it moved on.

**Fix needed:** [BUG-039], already planned; it is P2 `boundary-guard`, and Stage D dispatches that pattern at P0/P1 only, so the plan will not ship unattended.

### 3. Oversized screenshot (1 failure)

#73 (`toolu_018kvkQCJYi2P5XhZWYVuRw2`) — the `Button` COMPONENT_SET (`42:494`, 49 nodes) returned *"no image data … exceeded the ~4MB return cap. Fix: re-request at a lower scale …, or use format: SVG … Exporting a smaller child node instead of the whole board also works."*

**Agent recovery:** good — went straight to the children (#74 structure read, #75 three variants in one screenshot call). [BUG-016]'s decided fix (in-VM auto-degrade) has not landed; the interim message worked.

### 4. `componentProperties` on a main component (1 failure)

#142 (`toolu_01UYVaQF7bompFHmc4GwPXqA`) — rejected before mutation with *"componentProperties requires an INSTANCE node: 54:2 (type: COMPONENT). Fix: target an instance …"*. Correct boundary behaviour; the agent toggled the ring layer's visibility directly instead (#143).

### 5. Silent no-op: `edit` font swap to an unloadable family (unflagged)

#119 (`toolu_011Nu9u1shsaGSf3tXtxz9KW`) `edit({nodes:[{nodeId:"215:8", fontFamily:"PP Neue Montreal", fontWeight:400}]})` → `{"success":true,"nodesEdited":1}`, no warnings. Nothing changed: #120 failed exactly as before, and #126's script read the label still on `PP Neue Montreal Regular`. `apply.js:861-872` (`processNode`, phase 2.5) swallows the failed load (*"Keep current font if family not available at all"*), and the post-write `font_fallback` assertion (`assertions.js:157`) compares the resolved family with the requested one — equal here, because the request named the node's own family. Filed as [BUG-052].

## What Worked Well

1. **Variable CRUD in batches.** 4 `create_variables` calls minted 15 variables with scopes and aliases inline; `update_variables` rebound 15 variables in one call (#44) and deleted 6 in another (#47), 0 failures. The one duplicate name (#40) came back as a per-item failure with *"Use update_variables to modify it"* and the agent corrected its own scan on the next turn.
2. **Checking before deleting.** `grep({variableId: [6 ids], scope: "DOCUMENT"})` (#28) searched 1,911 nodes and found the single live consumer (`24:71`) before the orphans were deleted; the agent rebound it first (#45).
3. **`write({fromNodeId})` on text-free variants.** Checkbox (#116) and Switch (#125) Hover variants in one call each; the `Property=Value` name registered on the set's axis without any follow-up (#129 confirmed `Checked=False, State=Hover`).
4. **Batch reads and screenshots.** `read` with `nodeIds` (#99, #113, #114) and multi-node `screenshot` (#75, #132, #149) for sibling sets.
5. **`run_script` as the last resort only.** 6 of 84 Figma calls (7.1%), all on the font wall — the lowest share on this file ([AGENT-025]).
6. **[BUG-041]'s fix verified.** `fig.loadFont` (#122) failed on line 1 with the true remote-font cause instead of resolving to Inter and dying 30 lines later.

## Priority Improvements

### Tool Changes (ranked by call savings)

1. **[BUG-033] park-and-restore** — `write({fromNodeId})` of a text-bearing subtree on a custom-font file; must restore `textStyleId`. ~10 calls here.
2. **[TOOL-059] `read` description** — say that hidden nodes are skipped and how to see them. ~4 calls and a wrong audit.
3. **[TOOL-060] `run_script` description** — TEXT `boundVariables` are arrays; rebind with `fig.bindVariable`. ~4 calls and a silent binding loss.
4. **[BUG-052] `edit` font swap** — fail, not succeed, when the requested family cannot be loaded. ~2 calls.
5. **[BUG-039]** — needs a priority call so its plan can dispatch. ~2 calls.

### Agent Skill Updates

1. **Before reporting a layer missing, read with `visibleOnly: false`** — the tool-description fix ([TOOL-059]) covers this; no separate skill change.

## Additional observations (not filed)

- **Three single depth-0 reads, then the same three as one batch.** #81–#83 read Checkbox, Radio and Switch one at a time at `depth: 0` (variant axes only); #113 read all three at `depth: 1` in one call. One call would have served both. CLAUDE.md already says to batch known sibling sets.
- **Previewing a hidden layer costs a show / screenshot / hide round-trip.** Verifying the Combobox Chip ring took #143 (show both rings) → #144 (screenshot) → #145 (delete the duplicate, hide) → #146 (show) → #147 (screenshot) → #148 (hide). A `screenshot` that could render a component with a BOOLEAN property overridden would make that one call; one session is too thin to file.
- **"safe to retry" under a deterministic failure.** The remote executor appends *"(atomic: no changes were applied; safe to retry)"* to every atomic write error (`remote/executor.ts:150`). True, and useful after a failure whose input the caller changes (session 45 #103, [BUG-025]), but here it sat directly under a font failure that no retry could change, and #118 retried identically 8 seconds later. One data point.
- **ToolSearch overhead** — 5 calls (3.4%), all loading deferred Figmagent tools in batches.

## Outcome

- **Result**: analyzed
- **Reason**: every phase completed — 3 new tracker entries ([TOOL-059], [TOOL-060], [BUG-052]), 6 existing entries updated ([BUG-016], [BUG-033], [BUG-039], [AGENT-025], [AGENT-029] recurrences; [BUG-041] verified and moved to Resolved), 2 fix plans (`plans/2026-09-11-TOOL-059.md`, `plans/2026-09-11-TOOL-060.md`)
