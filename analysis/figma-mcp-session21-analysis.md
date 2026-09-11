# Figma MCP Session 21 Analysis

## Session Overview

- **Transcript**: `b2367db1-fc78-4cff-838e-f0c28e1c49c3.json`
- **Project**: cursor-talk-to-figma-mcp (`main` branch)
- **Duration**: 7 minutes (14:47–14:53)
- **Total tool calls**: 23
- **Figma tool calls**: 17
- **Non-Figma tool calls**: 6 (2 ToolSearch + 2 Grep + 2 Read)
- **Total errors**: 0 hard errors; 1 soft correctness failure (`apply` FILL silently no-op'd on a width-0 node yet returned `success: true`)
- **Reconnections**: 0
- **Context restarts**: 0
- **Task**: Fix collapsed (width-0) text nodes across Base UI component set. 21 TEXT nodes had `textAutoResize: WIDTH_AND_HEIGHT` with width collapsed to 0 (each character wrapping onto its own line). Repair to FILL-horizontal + HEIGHT-auto-resize, then investigate the `create`-tool root cause.

> Note: Still predates the read/grep/edit/write rename — uses wire-era names (`get`, `apply`, `find`). Findings mapped to current tooling (`read`/`edit`/`grep`) where relevant.

## Metrics

| Metric | Session 20 | This Session | Change |
|---|---|---|---|
| Total Figma tool calls | 24 | 17 | -29% (focused fix) |
| Meta/overhead calls | 5 ToolSearch + 1 Bash | 2 ToolSearch + 2 Grep + 2 Read | Lower ToolSearch |
| ToolSearch calls | 5 (16.7%) | 2 (8.7%) | -8pp |
| Estimated waste % | ~30% | ~25% | -5pp |

Waste this session is largely *forced* by the FILL-on-width-0 bug: the single-node fix needed 3 `apply` passes (FILL no-op → explicit width → FILL) plus 3 diagnostic `get`s to discover the no-op. Once understood, the 21-node batch took just 2 `apply` calls. The closing 4 calls (2 Grep + 2 Read) were root-cause investigation of the `create` tool source, not the fix itself.

## Tool Call Distribution

| Tool | Calls | Notes |
|---|---|---|
| get | 10 | 1 component lookup + 3 diagnostic re-inspections of `13:163` (discovering the no-op) + 2 batched multi-node `get` (nodeIds arrays) + 4 verification |
| apply | 5 | All `success: true`. #5 FILL **silently no-op'd** (width stayed 0); #8 explicit width 132 fixed it; #10 FILL then worked; #13/#14 batched the 2-pass fix across 21 nodes |
| get_document_info | 1 | Initial orientation |
| find | 1 | Locate suspect Toast text node |
| ToolSearch | 2 | 8.7% — orientation batch + get/apply/find batch |
| Grep | 2 | Search `create`-tool source for the width-collapse root cause |
| Read | 2 | Read `create.js` / text-handling source |

Total: 23. ✓

## Efficiency Issues

### 1. `apply` FILL silently no-ops on width-0 text nodes (saves ~2 calls/node-group) — NEW [BUG-009]

The headline finding. A TEXT node collapsed to width 0 cannot be fixed with `layoutSizingHorizontal: FILL` directly — the FILL apply returns `success: true, nodesApplied: 1` but the width stays 0. The working sequence is **two passes**: set an explicit width first, then apply FILL.

**Pattern observed:**
- `#5 apply {nodeId: 13:163, textAutoResize: HEIGHT, layoutSizingHorizontal: FILL}` → `success: true` but `get` shows **width still 0**
- `#6/#7 get(13:163)` → confirm width unchanged ("Still 0")
- `#8 apply {nodeId: 13:163, textAutoResize: HEIGHT, width: 132}` → width now 132
- `#10 apply {nodeId: 13:163, layoutSizingHorizontal: FILL}` → FILL now resolves
- Agent then applied this 2-pass recipe to all 21 nodes: `#13 apply (explicit width 200 ×21)` + `#14 apply (FILL ×21)`

**Root cause:** When a text node's width is 0 (from `WIDTH_AND_HEIGHT` autoresize collapsing under a constrained parent), the `apply` handler's FILL coercion path does not kick in — the layout-sizing change is a no-op. Worse, `apply` reports `success` regardless, so the failure is invisible without a follow-up `get`. The agent's words: *"The first FILL apply silently no-op'd because the coercion path didn't kick in from width=0."*

**Proposed fix:** In `apply.js`, when setting `layoutSizingHorizontal: FILL` on a TEXT node whose width is 0 (or whose `textAutoResize` is `WIDTH_AND_HEIGHT`), reset to an explicit width / set `textAutoResize: HEIGHT` *before* applying FILL — internally collapsing the 2-pass recipe into one call. At minimum, emit a `width_collapse`-style warning when a FILL apply leaves width at 0 instead of returning bare `success`.

**Estimated savings:** ~2 calls + 3 diagnostic `get`s per width-collapse session; turns the per-node 2-pass into a 1-pass.

### 2. `apply` reports `success: true` when the sizing change had no effect (correctness) — folds into [BUG-009]

Five `apply` calls all returned `{"success": true, "nodesApplied": N}` — including `#5`, which did nothing. The agent only discovered the no-op by re-reading the node. The response should carry a warning when a requested layout-sizing change leaves the dimension unchanged, consistent with the existing post-write assertion suite (which already warns on width collapse / FILL-not-applied).

### 3. Re-inspect after apply (recurrence, but justified) — [AGENT-016]

Node `13:163` was re-read 3× (`#6/#7/#9`) interleaved with the `apply` calls. Unlike session 20, this re-inspection was **justified diagnostic work** — it is how the agent discovered the silent no-op. Once the recipe was known, the agent batched the 21-node fix without per-node verification. No change recommended; the underlying need would disappear if [BUG-009] surfaced a warning.

## Error Analysis

### 1. Silent FILL no-op (1 soft failure, ~1 minute lost)

No hard errors. The single soft failure was `#5 apply` returning `success: true` while leaving width at 0. There was no error message to read — the only signal was the unchanged `get` output.

**Agent recovery:** Excellent. Recognized the no-op within one verification `get`, hypothesized the width-0 coercion cause, tested the explicit-width-then-FILL recipe on one node, confirmed it, then batched across all 21 nodes. No retry storm, no wasted attempts — textbook validate-on-one-then-batch behavior.

**Fix needed:** [BUG-009] — handle width-0 internally and/or warn on no-op FILL.

## What Worked Well

1. **Validate-on-one-then-batch.** Diagnosed the fix recipe on a single node (`13:163`), confirmed it worked, then applied the 2-pass fix to all 21 nodes in just 2 `apply` calls. Exactly the [AGENT-011] discipline.

2. **Batched multi-node `get`.** Used `get` with `nodeIds` arrays (`#12`, `#15`) to inspect groups of text nodes at once rather than one call per node — found "19 zero-width text nodes across all 5 components" efficiently.

3. **Precise root-cause diagnosis.** Correctly identified the mechanism (`WIDTH_AND_HEIGHT` autoresize + width 0 → per-character vertical wrap) and the silent-no-op coercion path, then read the `create`-tool source to find where the bad nodes originated.

4. **Toast suspicion followed up.** Noticed Toast Title resolving to a suspiciously narrow 76px, inspected the Toast variants, and correctly explained it (all 4 variants `primaryAxisSizingMode: FIXED` at 132px → Content fills to 76).

5. **Low overhead.** 2 ToolSearch calls (8.7%), zero reconnections, zero timeouts, complete fix of 21 nodes in 7 minutes.

## Priority Improvements

### Tool Changes (ranked by call savings)

1. **[BUG-009] `apply` FILL on width-0 text nodes** — Reset width / `textAutoResize: HEIGHT` before applying FILL internally so a single call works; and/or warn (don't bare-`success`) when a FILL apply leaves width at 0. Saves ~2 calls + 3 diagnostic `get`s per width-collapse session. Also worth fixing the upstream `create`-tool path that produces width-0 `WIDTH_AND_HEIGHT` text nodes (related to [BUG-007]).

### Agent Skill Updates

1. **Document the width-collapse fix recipe** — Add to CLAUDE.md / figma-guidelines: "A width-0 text node cannot be FILL'd directly — set an explicit width (or `textAutoResize: HEIGHT`) first, then apply FILL." This lets future agents skip the discovery phase even before [BUG-009] is fixed.
