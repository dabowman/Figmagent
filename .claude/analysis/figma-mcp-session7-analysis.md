# Figma MCP Session 7 Analysis

## Session Overview

- **Transcript**: `7c4eb14b-11ae-4a6c-8044-55ebf13e864a.json`
- **Duration**: ~11 minutes
- **Total tool calls**: 24
- **Total errors**: 2
- **Reconnections**: 0
- **Context restarts**: 0
- **Task**: Audit deprecated `.Parts / Avatar` instances across a Figma file and annotate 22 of them

## Metrics

| Metric | Session 4 | Session 7 | Change |
|---|---|---|---|
| Total tool calls | 56 | 24 | -57% (smaller task) |
| Figma MCP calls | 48 | 22 | -54% |
| ToolSearch calls | 8 (14.3%) | 2 (8.3%) | Improved |
| Errors | 2 (3.6%) | 2 (8.3%) | Higher rate |
| Estimated waste % | ~12% | ~25% | Regressed |

## Tool Call Distribution

| Tool | Calls | Notes |
|---|---|---|
| `get` | 8 | 4 used multi-node `nodeIds` batching |
| `set_multiple_annotations` | 3 | 22 annotations across 3 calls (could be 1) |
| `scan_nodes_by_types` | 3 | 1 overflowed (276K chars), triggered 2 recovery calls |
| `ToolSearch` | 2 | 8.3% — improved from 14.3% |
| `get_document_info` | 2 | Initial + verification |
| `find` | 2 | Used for targeted search after overflow |
| `get_annotations` | 2 | Batch annotation reads |
| `set_selections` | 1 | Highlight results for user |
| `Bash` | 1 | Python processing of overflow file |

## Efficiency Issues

### 1. scan_nodes_by_types overflow cascade (saves ~5 calls)

Agent used `scan_nodes_by_types(INSTANCE)` which returned 276K chars, overflowing to disk. Then spent 4 calls processing the overflow file (jq fail, Read fail, Read peek, python3 parse).

**Pattern observed:** `scan_nodes_by_types(INSTANCE)` → overflow → `Bash jq` → fail → `Read` → fail → `Read` peek → `python3` parse.

**Root cause:** `scan_nodes_by_types` is a legacy tool that returns all matching nodes without budget control. CLAUDE.md already documents that `find` should be used instead.

**Proposed fix:** Agent behavior — use `find` with `name` regex or `componentId` criteria instead of `scan_nodes_by_types`. The tool description should cross-reference `find` more prominently.

**Estimated savings:** ~5 calls (1 `find` call replaces the entire cascade).

### 2. Annotation splitting (saves ~2 calls)

22 annotations were split across 3 `set_multiple_annotations` calls instead of 1. The batch tool accepts up to 200 annotations per call.

**Root cause:** Agent likely split due to context window management or conservative batching.

**Estimated savings:** ~2 calls.

### 3. Redundant re-inspection (saves ~1 call)

`get` with `filter.namePattern` returned empty nodes, forcing a second call without the filter on the same 2 nodes.

**Estimated savings:** ~1 call.

## Error Analysis

### 1. scan_nodes_by_types overflow (1 failure, ~2 minutes lost)

276K char response exceeded output budget. Agent recovered by falling back to `find` tool.

**Agent recovery:** Good — pivoted to `find` after understanding the overflow.

### 2. get filter mismatch (1 failure, ~30 seconds lost)

`get` with `namePattern` filter returned no matching children. Agent retried without filter.

**Agent recovery:** Fast — immediately retried without filter.

## What Worked Well

1. **Multi-node `get` batching.** 4 of 8 `get` calls used `nodeIds` array for parallel multi-node inspection.

2. **`set_multiple_annotations` batching.** All 22 annotations succeeded — no individual annotation calls needed.

3. **ToolSearch efficiency.** Only 2 ToolSearch calls (8.3%) — trend improving across sessions.

4. **Zero reconnections.** Auto-join continues to work reliably.

5. **Systematic investigation workflow.** Document info → scan → identify targets → annotate → verify.

## Priority Improvements

### Tool Changes

1. **Deprecate `scan_nodes_by_types` in tool description** — Add explicit warning to use `find` instead. The tool still exists for backward compat but agents should prefer `find`.

### Agent Skill Updates

1. **Use `find` instead of `scan_nodes_by_types`** — Already documented in CLAUDE.md but agent didn't follow. Reinforce in prompts and tool description.
