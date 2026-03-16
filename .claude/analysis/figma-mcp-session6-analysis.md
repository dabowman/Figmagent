# Figma MCP Session 6 Analysis

## Session Overview

- **Transcript**: `991437c4-6f57-4b79-ba9b-486e1a053d96.json`
- **Duration**: ~4 minutes
- **Total tool calls**: 68
- **Total errors**: 0
- **Reconnections**: 0
- **Context restarts**: 0
- **Task**: Find deprecated annotations across 56 components, identify `.Parts / Avatar` → `Avatar` replacement, swap all 22 instances

## Metrics

| Metric | Session 4 | Session 6 | Change |
|---|---|---|---|
| Total tool calls | 56 | 68 | +21% (different task) |
| Figma MCP calls | 48 | 65 | +35% |
| ToolSearch calls | 8 (14.3%) | 3 (4.4%) | Best ever |
| Errors | 2 (3.6%) | 0 (0%) | Best ever |
| Estimated waste % | ~12% | ~72% | Regressed (see below) |

## Tool Call Distribution

| Tool | Calls | Notes |
|---|---|---|
| `get_annotations` | 51 | 75% of all calls. Individual node-by-node annotation checks. |
| `ToolSearch` | 3 | 4.4% — best ever |
| `apply` | 2 | Batched 22 instance swaps into 2 calls |
| `get` | 2 | Multi-node batching with `nodeIds` |
| `find` | 2 | Targeted component search |
| `get_document_info` | 2 | Initial + verification |
| `get_design_system` | 1 | Design system discovery |
| `scan_text_nodes` | 1 | Text content scan |
| `set_multiple_annotations` | 1 | Batch annotation write |
| `set_selections` | 1 | Highlight results |

## Efficiency Issues

### 1. Individual `get_annotations` calls instead of `find(hasAnnotation: true)` (saves ~49 calls)

51 individual `get_annotations` calls dominated the session (75% of all tool calls). The agent checked annotations on every top-level node one by one to find deprecated components.

**Pattern observed:** `get_annotations(nodeId: "1:2")` → `get_annotations(nodeId: "1:3")` → ... × 51

**Root cause:** The agent didn't use `find(hasAnnotation: true)` which would find all annotated nodes in a single call, or `get_annotations(nodeIds: [...])` batch which would handle all 56 nodes in ~3 calls.

**Proposed fix:** Two approaches:
1. Add cross-reference to `find(hasAnnotation: true)` in the `get_annotations` tool description itself, not just in CLAUDE.md
2. The `get_annotations` tool already supports batch `nodeIds` — the tool description should emphasize this more prominently

**Estimated savings:** ~49 calls (51 → 1 `find` call or 2-3 batch `get_annotations` calls).

## Error Analysis

Zero errors — the best error-free session to date.

## What Worked Well

1. **ToolSearch at 4.4%.** Only 3 ToolSearch calls — best ratio across all sessions. Agent pre-loaded tools effectively.

2. **Zero errors.** First completely error-free session.

3. **`apply` batching for swaps.** 22 instance swaps executed in just 2 `apply` calls using `swapVariantId`.

4. **`get` multi-node batching.** Used `nodeIds` array for parallel inspection.

5. **Fast execution.** 4 minutes total — most efficient session by wall-clock time.

6. **`set_multiple_annotations` batching.** All annotations written in a single batch call.

## Priority Improvements

### Tool Changes

1. **Cross-reference `find(hasAnnotation: true)` in `get_annotations` tool description** — The find tool subsumes the common `get_annotations` use case of "find all annotated nodes." Adding this to the `get_annotations` description ensures agents discover it even without CLAUDE.md. P1, saves ~49 calls/session.

2. **Emphasize `nodeIds` batch in `get_annotations` description** — The tool already supports batch reads but agents default to individual calls. P2.

### Agent Skill Updates

1. **For "find all X" tasks, always try `find` first** — The agent's instinct was to iterate, but `find` with criteria handles bulk discovery in 1 call.
