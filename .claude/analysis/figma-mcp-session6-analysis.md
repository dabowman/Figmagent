# Figma MCP Session 6 Analysis (Revised)

## Session Overview

- **Transcript**: `991437c4-6f57-4b79-ba9b-486e1a053d96.json`
- **Duration**: ~6 minutes
- **Total tool calls**: 74
- **Total errors**: 5 (1 PAGE annotation error + 4 variant component crash)
- **Reconnections**: 0
- **Context restarts**: 0
- **Task**: Find deprecated annotations across ~50 top-level components, discover Avatar variant replacement, swap ~22 instances across multiple component groups

> **Revision note**: Original analysis reported 68 calls/0 errors and listed tools not present in the transcript (scan_text_nodes, set_multiple_annotations, set_selections, get_design_system). Re-extraction corrected tool counts and revealed 5 errors previously missed (error strings in success responses, not `is_error: true`).

## Metrics

| Metric | Session 4 | Session 6 | Change |
|---|---|---|---|
| Total tool calls | 56 | 74 | +32% |
| Figma MCP calls | 48 | 71 | +48% |
| ToolSearch calls | 8 (14.3%) | 3 (4.1%) | Best ever |
| Errors | 2 (3.6%) | 5 (6.8%) | Regressed |
| Estimated waste % | ~12% | ~68% | Regressed (get_annotations dominated) |

## Tool Call Distribution

| Tool | Calls | Notes |
|---|---|---|
| `get_annotations` | 51 | 68.9% — individual node-by-node checks. 8% hit rate (3/50 had annotations). |
| `get` | 11 | Mix of single-node and batched `nodeIds` reads. 4 failed on variant component bug. |
| `apply` | 5 | Batched swapVariantId across 22+ instances in 5 calls. |
| `ToolSearch` | 3 | 4.1% — best ever. Good batching (3+2 tools). |
| `find` | 2 | Parallel: name regex + type filter. Used correctly but missed `hasAnnotation`. |
| `join_channel` | 1 | Initial join. |
| `get_document_info` | 1 | Initial discovery. |

**Totals**: 3 ToolSearch + 71 Figma MCP = 74. Errors: 5.

## Efficiency Issues

### 1. Individual `get_annotations` instead of `find(hasAnnotation: true)` (saves ~49 calls)

51 individual `get_annotations` calls (68.9% of session) checking annotations on each top-level component. Only 3 nodes out of 50 had annotations — a 8% hit rate. The agent correctly used `find` first (name regex for "annotation|deprecated|replace") but got 0 matches because annotations aren't in node names. It then fell back to brute-force `get_annotations` on every node.

**Pattern observed:** `get_annotations("1:26545")` → `get_annotations("1:26548")` → ... × 51, mostly returning empty `annotations: []` arrays.

**Root cause:** The `find(hasAnnotation: true)` criteria existed but the agent didn't know about it. It tried `find` with name regex instead, which searches node names, not Figma native annotations.

**Proposed fix:**
1. Cross-reference `find(hasAnnotation: true)` in `get_annotations` tool description
2. Emphasize `nodeIds` batch support in `get_annotations` description (even batching would reduce 51 → ~6 calls)

**Estimated savings:** ~49 calls (51 → 1 `find` call or 2-3 batch `get_annotations` calls).

### 2. Redundant `get` calls on variant components (saves ~2 calls)

Node `111:12183` was read twice (depth=2 then depth=1), both failing with the variant component crash. The agent retried with lower depth hoping to avoid the error.

**Root cause:** The `componentPropertyDefinitions` crash on variant components — a known bug ([AGENT-UX fix] noted in MEMORY.md, fixed later).

**Estimated savings:** ~2 calls (don't retry the same node with different depth after a componentPropertyDefinitions crash).

## Error Analysis

### 1. Variant component `componentPropertyDefinitions` crash (4 failures, ~30 seconds lost)

4 `get` calls failed with: `Error reading nodes: in get_componentPropertyDefinitions: Can only get component property definitions of a component set or non-variant component`

Affected nodes: `111:12183` (twice), `2212:643434`, `2212:643433`. All are variant components (children of a COMPONENT_SET).

**Agent recovery:** Good — after 2 failures on the same node, the agent pivoted to inspecting different nodes and using `nodeIds` batch reads. It successfully completed the swaps despite the errors.

**Fix needed:** Already fixed post-session — FSGN output guards `componentPropertyDefinitions` access for variant components (only reads on COMPONENT_SET and non-variant COMPONENTs).

### 2. `get_annotations` on PAGE node (1 failure, trivial)

`get_annotations("1:3")` → `Error getting annotations: Node type PAGE does not support annotations`

**Agent recovery:** Correct — immediately switched to checking individual child nodes.

**Fix needed:** Minor — `get_annotations` could silently skip unsupported node types and return empty, or the tool description could note PAGE/DOCUMENT nodes don't support annotations.

## What Worked Well

1. **ToolSearch at 4.1%.** Only 3 calls, fetching 3+2 tools in batches. Best ratio across all sessions.

2. **`apply` batching for swaps.** 22+ instance swaps executed across 5 `apply` calls using `swapVariantId`. Agent correctly batched by component group.

3. **`get` multi-node batching.** Used `nodeIds` arrays for parallel inspection after the individual calls hit errors. Verified results with batch reads.

4. **Fast execution.** 6 minutes for 74 calls — efficient wall-clock time.

5. **Good error recovery.** After the variant crash, pivoted to different approaches rather than retrying.

6. **`find` used for initial discovery.** Agent tried `find` before falling back to brute-force — right instinct, wrong criteria.

## Priority Improvements

### Tool Changes

1. **Cross-reference `find(hasAnnotation: true)` in `get_annotations` description** — P0, saves ~49 calls/session. Agents default to iterating with `get_annotations` because they don't know `find` can discover annotated nodes.

2. **`get_annotations` batch `nodeIds` emphasis** — P2. Even without `find`, batching 50 node IDs into 3-5 calls would cut 46 wasted calls.

### Agent Skill Updates

1. **For "find all annotated nodes" tasks, use `find(hasAnnotation: true)` first** — This is a single call that replaces N×`get_annotations` loops.

2. **On `componentPropertyDefinitions` crash, don't retry same node** — The error is type-based (variant components), not transient. Already fixed in plugin code.
