# Figma MCP Session 46 Analysis

## Session Overview

- **Transcript**: `a2201e93-585a-4c71-b050-8f09dfa87973.json`
- **Date**: 2026-08-24, 20:55–22:59 UTC
- **Duration**: 124 minutes wall clock — **~35 minutes active** (audit 21:00–21:04, then an 82-minute idle gap while the user was away, then rebuild 22:25–22:56)
- **Project**: external — `~/Github/vip-workflows`, branch `wpds-audit`
- **Transport**: remote (file `uwhEpCvlz26oQeK0rql95G`, 🔀 VIP Workflow i2) — same file as sessions 44 and 45
- **Total tool calls**: 100
- **Figmagent tool calls**: 70 (70% of the session)
- **Official Figma MCP calls**: **0**
- **Total errors**: 16 (15 Figmagent + 1 Bash `cd`)
- **Reconnections**: 0 (remote transport)
- **Context restarts**: 0
- **Task**: two-phase. (1) Audit the `Workflow sidebar — Next steps pattern (option B)` board against the shipped `vip-workflow/src/editor/` React source and report the differences. (2) On the user's go-ahead, rewrite all seven sidebar states in Figma to match production code — strip card chrome, rebuild the assigned state as a flat panel stack, move tool checks inside the transition rail, delete the Tools and Editorial Metadata cards, and redraw the rail's vector track against the new geometry.

**This is the first live remote session after the [BUG-016] fix landed** (commit `0af2c9a`, 2026-08-19). The verdict is split, and both halves matter:

- ✅ **The protocol crash is gone.** Zero `-32602 invalid_union` errors. The `export.ts` guards work exactly as designed — every failure came back as a readable, correctly-flagged (`is_error: true`) text block.
- ✅ **The defection is over.** Zero calls to the official Figma MCP, no `ToolSearch` for the competitor, across **11 consecutive screenshot failures**. Sessions 44 and 45 abandoned Figmagent after 3 and 1 failures respectively. Correcting the downstream memory file held.
- ❌ **The underlying export failure is not fixed, and the new error message misdiagnoses it.** The guard tells the agent the payload exceeded a ~4MB cap. This session proves that is false — it fired on a **220×132 px** node — and all three remedies it recommends were tried and all three failed.
- 🆕 **The same silent-empty-result condition also hits `read`, where there is no guard at all.** One `read` call returned a well-formed, empty, `is_error: false` FSGN document for a node that demonstrably exists. The agent read `nodeCount: 0` and moved on.

## Metrics

| Metric | Session 45 | This Session | Change |
|---|---|---|---|
| Total tool calls | 183 | 100 | −45% (smaller scope) |
| Figmagent tool calls | 113 (62%) | 70 (70%) | +8pp share |
| Figmagent error rate | 6 / 113 (5.3%) | **15 / 70 (21.4%)** | **+16.1pp** |
| ToolSearch calls | 3 (1.6%) | 3 (3.0%) | flat in absolute terms |
| Estimated waste % | ~27% (49 of 183) | ~20% (20 of 100) | −7pp |
| `-32602 invalid_union` protocol crashes | 1 | **0** | **fixed** |
| Fell back to the *official* Figma MCP | yes (14 calls, pre-emptive) | **no (0 calls)** | **fixed** |
| Calls lost to `[BUG-016]` family | 24 | **11** | −54% |
| `screenshot` failure rate | — | **11 / 25 (44%)** | new measurement |
| `run_script` share of Figmagent calls | 28% | **24%** | −4pp |
| `write` / `edit` calls | 23 / 20 | **0 / 2** | creation surface unused |
| Nodes created via `run_script` | — | 19 frames + 9 texts + 5 clones | — |

Waste breakdown (20 calls): failed `screenshot` 11 · un-batched
`get_enabled_library_variables` 4 · absolute/local coordinate-bug recovery 2 ·
`run_script` error retry 1 · `edit` partial-failure retry 1 · silent-empty `read` 1.

## Tool Call Distribution

| Tool | Calls | Errors | Notes |
|---|---|---|---|
| `mcp__Figmagent__screenshot` | 25 | **11 (44%)** | see Error 1 — the dominant failure of the session |
| `Bash` | 24 | 1 | reading the React source (`src/editor/`); 1 bad `cd` path |
| `mcp__Figmagent__read` | 17 | 0 hard | 1 silent-empty result (Error 2), 2 output-budget truncations |
| `mcp__Figmagent__run_script` | 17 | 1 | 12 `mode: "write"`, 5 read-only measurement |
| `mcp__Figmagent__get_enabled_library_variables` | 6 | 0 | all single-`query`; [TOOL-026] 4th recurrence |
| `ToolSearch` | 3 | 0 | all `select:` form — cheap, and all for Figmagent tools |
| `mcp__Figmagent__import_library_variable` | 2 | 0 | both batched, fed by the 6 un-batched discovery calls |
| `mcp__Figmagent__edit` | 2 | 1 partial | `componentProperties` variant mismatch, recovered in 1 call |
| `mcp__Figmagent__use_file` | 1 | 0 | URL form, worked first try |
| `AskUserQuestion` / `Skill` / `mcp__design-system__get_design_tokens` | 3 | 0 | phase gate + `figma-guidelines` skill + WPDS token lookup |

## Error Analysis

### 1. `screenshot` fails on small nodes and blames a 4MB cap that never fired (11 failures, ~4 minutes lost) — **[BUG-016] 8th recurrence, new form**

Every one of the 11 failures returned the identical guard text from
`src/figmagent_mcp/tools/export.ts:44–46`:

> Error exporting node as image: the export for node `2372:2` returned no image data.
> **This usually means the rendered payload exceeded the ~4MB return cap.**
> Fix: re-request at a lower `scale` (e.g. scale: 0.5), or use `format: "SVG"` …
> Exporting a smaller child node instead of the whole board also works.

**The cap attribution is false, and four independent lines of evidence prove it:**

1. **The cap has its own distinct error, and it never appeared.** `exportSingleNode`
   (`document.js:655–660`) throws `Exported image for node X is too large to return:
   N chars (max 4000000)` — naming the actual char count. That message appears
   nowhere in the transcript. The observed text is the MCP-side fallback guard,
   which fires whenever `imageData` is simply absent and *guesses* at the reason.
2. **The node dimensions rule it out.** `2377:38` is **220×132 px**; it failed at
   `scale: 2` — a 440×264 render, on the order of tens of KB. `2372:2` (the rail)
   is 248×327 and failed at `scale: 1`. `2285:378` is 256×611. None can approach 4MB.
3. **Every recommended remedy was tried and failed.** Lower `scale` (`2285:370` at
   1.0 → 0.5, both fail). `format: "SVG"` (`2285:378`, fails). A smaller child node
   (`2285:370` → `2285:378`, fails). The agent followed the fix text faithfully and
   the text led nowhere.
4. **The same node at the same scale succeeded, then failed.** `screenshot(2372:24,
   scale: 1)` returned an image at 22:46:30 (call #65) and failed at 22:53:00 (call
   #88). Size cannot explain a result that flips in seven minutes.

**Batch mode drops the healthy nodes with the sick one.** Call #69,
`screenshot({nodeIds: ["2285:479","2285:514","2285:627"]})`, returned
`Exported 0 node(s): none` — **with no `Errors:` block and no `Returned no image
data` block**. Five seconds later, call #70 screenshotted `2285:479` alone at the
same scale and got a clean image. So the plugin's batch loop (`document.js:693–716`)
produced an empty `images` map *and* an empty `errors` map: it neither exported
nor caught anything. The batch result object came back structurally hollow.

**Root cause (revised):** the remote `use_figma` round trip is returning results
with their payload fields silently missing — no exception raised, no error
recorded. `EXPORT_MAX_PAYLOAD_CHARS` is not involved. The `0af2c9a` fix correctly
stopped this from crashing the MCP protocol, but it papered a guess over the
symptom instead of surfacing the discrepancy.

**Agent recovery — the good news.** The agent diagnosed it in-line at 22:49:07
("Export of any frame containing the rail has failed from the start of this
session, before my edits — so verifying by sub-frame instead") and verified
structurally via `run_script` measurement plus screenshots of the sub-frames that
did work. It never once reached for the official Figma MCP. Compare session 44
(defected after 3 failures, 62 calls lost) and session 45 (defected pre-emptively,
24 calls lost). **This is the single clearest behavioral improvement in the tracker.**

**Fix needed:** make the plugin report what it actually produced, so the MCP layer
can tell "rendered nothing" from "rendered N chars that didn't survive the trip".
Concretely: have `exportSingleNode` include a small `payloadChars: base64.length`
scalar in its return, and have the batch loop record every attempted id in either
`images`, `errors`, or a new `dropped` list. Then `buildSingleExportResult` can
say *"the plugin rendered 41,204 chars but the remote transport returned no image
data"* — a true statement that points at the transport — instead of asserting a
cap that did not fire. Stop recommending `scale`/`SVG`/child-node remedies when
`payloadChars` is well under the cap.

### 2. `read` renders an empty result as a successful document (1 failure, silent) — **new**

Call #6, `read({nodeId: "2285:365", detail: "layout", depth: 5})`, returned:

```yaml
meta:
  detail: layout
  nodeCount: 0
  tokenEstimate: 0
  depth: 5
defs: { vars: {}, styles: {}, components: {} }
nodes: []
```

with `is_error: false`. The node exists and is visible — call #5, one call earlier,
listed `2285:365` ("States", a FRAME with seven state children) in the board's tree.

Note what is **missing** from that `meta`: `nodeId`, `name`, and `type`. In
`tools/document.ts:87–90` those are `raw.rootId`, `raw.rootName`, `raw.rootType`,
copied unconditionally. Their absence means all three were `undefined` — i.e. the
handler received an **empty object** from the transport and rendered it faithfully
as a valid, empty, successful FSGN document (`raw.nodeCount ?? 0` → 0,
`raw.rawTree ?? []` → `[]`). `getNodeTree` itself cannot produce this: it throws
`Node not found` on a missing root (`document.js:427–429`) and increments
`nodeCount` before any filter runs (`document.js:440`), so `nodeCount: 0` proves
the traversal never executed.

**This is the same silent-empty-result condition as Error 1, on a different tool** —
and here it is strictly worse, because `read` has no guard at all. The screenshot
path at least tells the agent something failed. `read` reports success. The agent
accepted `nodes: []`, moved to the sibling nodes, and never inspected the "States"
wrapper during the audit.

**Fix needed:** in `buildFsgn` (`tools/document.ts:78–92`), treat a `raw` with no
`rootId` as a transport failure — return a fix-stating text block with
`isError: true` naming the requested nodeId and suggesting a retry — rather than
serializing an empty document. Mirror the `hasImageData` guard `export.ts` already
has. This is the exact hole [BUG-016]'s fix closed for `export.ts` and left open
everywhere else.

### 3. `edit` `componentProperties` variant mismatch (1 partial failure, ~10s)

Call #56 batched two instance edits; the `Label#16507:16` text property succeeded
and `{"Size": "Small"}` on `2285:417` failed with *"Unable to find a variant with
those property values. Fix: verify each value matches its property type … read the
instance to list valid keys and options."* Working as designed — batch continued,
per-op error, fix stated. The agent dropped the `Size` change and re-issued the
`Label` half (call #68). One wasted call; no diagnosis loop. **No action needed.**

### 4. `run_script` null-clone crash (1 failure, ~45s)

Call #66 (`Rebuild the No-workflow, AI-running, AI-failed and Complete states`)
threw `TypeError: cannot read property 'clone' of null` at `PLUGIN_1_SOURCE:163`.
The script cloned outcome-dot source nodes from a frame that an *earlier* script in
the same session had already dissolved. Atomicity held — `(atomic: no changes were
applied; safe to retry)` — and the agent re-sourced the dots from a surviving clone
and re-ran successfully (call #67). One wasted call. This is ordinary script-authoring
risk, and the atomic guarantee made it cheap. **No action needed.**

## Efficiency Issues

### 1. `read` reports absolute coordinates; `edit` and `node.x` write local ones (saves ~2 calls + a visible misplacement)

At 22:55:39 the agent flagged its own bug: *"Coordinate bug — I offset by absolute
page position instead of local. Fixing."*

**Pattern observed:** `run_script` #15 (call 94) measured the rail's vector track in
absolute space — `c.absoluteTransform[1][2] - track.absoluteTransform[1][2]` — then
wrote positions back as `n.x = trackLeft + x`, where `trackLeft` was the track's
absolute page X (~2656). `node.x` is **parent-local**, so all twelve vectors landed
~2656px to the right of the board. Recovery took two more scripts: #16 (call 96) to
re-measure, #17 (call 97) to rewrite with pure local coordinates.

**Root cause:** an unmarked asymmetry across the whole surface. `read` emits
`absoluteBoundingBox.x/y` as bare `x`/`y` (`document.js:222–227`). `edit`'s schema
describes them as *"New X position (moves the node; does NOT change parent)"*
(`tools/apply.ts:56–57`) and the setter is `node.x = …` (`apply.js:533–534`) —
parent-local. Neither side says which frame of reference it is in. An agent that
reads coordinates and writes them back gets a silently wrong result whenever the
parent is not at the page origin.

**Proposed fix:** (a) state the frame of reference in both descriptions — `read`'s
`x`/`y` are absolute (page) coordinates; `edit`'s `x`/`y` are parent-local; (b) add
a `fig.localPoint(node, ancestor)` helper to the `run_script` stdlib so scripts that
measure with `absoluteTransform` have a supported way back to local space.

**Estimated savings:** ~2 calls per geometry-editing session, and it removes a class
of silent, visually-obvious-only breakage.

### 2. `get_enabled_library_variables` still un-batched (saves ~4 calls) — **[TOOL-026] 4th recurrence**

Six single-`query` calls (#41, #49, #50, #52, #54, #85) fed **two** batched
`import_library_variable` calls. The exact batched-import / un-batched-discovery
asymmetry logged in sessions 41, 44 and 45, now in a fourth. Calls #49 and #50 are
consecutive single-term queries one second apart. Fix unchanged: accept
`query: z.string().or(z.array(z.string()))` at `tools/libraries.ts:611`.

### 3. Frame resize silently rescales SCALE-constrained children (agent knowledge gap)

`run_script` #15 called `track.resize(rail.width, rail.height)`; the twelve child
vectors had SCALE constraints and were stretched ~19%, which the agent then had to
detect and undo. Figma-native behavior, correctly diagnosed at 22:54:59, but only
after a screenshot round trip. Worth a line in the `figma-guidelines` skill:
resizing a frame rescales children whose `constraints` are `SCALE` — read
`constraints` first, or set explicit geometry after the resize.

### 4. First-class creation surface went entirely unused (0 `write` calls)

Session 45's headline was `run_script` falling to 28% with 23 `write` + 20 `edit`
calls. This session holds the `run_script` share at 24% — but **all node creation
went through scripts**: 19 `createFrame`, 9 `createText`, 5 `clone`, 32
`appendChild`, against **zero `write` calls and two `edit` calls**.

This is not the [AGENT-025] monoculture — `read` was used heavily and well (17
calls, 0 errors), and the task genuinely called for computed geometry (measure laid-out
button positions → redraw a vector track against them), which no first-class tool
covers. But scripts 4, 5, 6 and 11 built ordinary bound-variable row stacks that
`write` handles natively, forfeiting its boundary pre-checks, per-op errors and
post-write assertions. Worth watching: if session 47 on this file also shows 0
`write`, the driver is habit rather than task shape.

## What Worked Well

1. **The `0af2c9a` fix did its primary job.** Eleven export failures, zero protocol
   crashes, every one flagged `is_error: true` with readable text. The agent branched
   correctly on all of them. Compare session 44's `-32602` dumps.
2. **No defection to the official Figma MCP — under heavier provocation than either
   prior session.** 11 failures (vs 3 in session 44, 1 in session 45) and the agent
   stayed on Figmagent, worked around the gap with sub-frame screenshots and
   structural `run_script` verification, and shipped. Correcting the memory file
   alongside the code fix is what made this hold.
3. **Multi-nodeId `read` batching is now habitual** — calls #9, #10, #14, #31, #32,
   #36 read 2–6 sibling nodes each. [AGENT-017] fully absorbed.
4. **`run_script` atomicity paid for itself.** The null-clone crash (call #66) applied
   nothing; the retry was clean. The `(atomic: no changes were applied; safe to retry)`
   suffix let the agent retry immediately instead of auditing for partial damage.
5. **`fig.check()` used unprompted.** Script 13 ran the structural assertion stdlib
   over the newly created check rows rather than re-reading them — exactly the
   [AGENT-016] behavior the tracker has been pushing.
6. **Clean phase gate.** `AskUserQuestion` at the audit/rebuild boundary, then the
   `figma-guidelines` skill loaded before the write phase.

## Priority Improvements

### Tool Changes (ranked by call savings)

1. **`screenshot` — report the rendered payload size, stop guessing at the cause.**
   Add `payloadChars` to `exportSingleNode`'s return and a `dropped` list to the
   batch loop; have `export.ts` distinguish "rendered nothing" from "rendered N chars,
   transport returned none". Saves ~11 calls/session on this file and stops sending
   agents down three remedies that cannot work. **[BUG-016]**
2. **`read` — guard the empty-result path.** Treat `raw.rootId === undefined` as a
   transport failure with `isError: true`, not as an empty document. Prevents silent
   blind spots in audits. **[BUG-027, new]**
3. **`get_enabled_library_variables` — accept `query` as an array.** ~4 calls/session,
   fourth recurrence. **[TOOL-026]**
4. **Document the absolute/local coordinate split** in `read`'s and `edit`'s
   descriptions, and add `fig.localPoint()` to the stdlib. ~2 calls/session.
   **[BUG-028, new]**

### Agent Skill Updates

1. **Frame resize + SCALE constraints** — add to `figma-guidelines`: resizing a frame
   rescales children with `constraints: SCALE`; check constraints before resizing a
   container whose children carry hand-authored geometry.
2. **Absolute vs local coordinates in `run_script`** — when measuring with
   `absoluteTransform` and writing with `node.x`/`node.y`, convert back to
   parent-local first.
