# Figma MCP Session 7 Analysis (Revised)

## Session Overview

- **Transcript**: `7c4eb14b-11ae-4a6c-8044-55ebf13e864a.json`
- **Duration**: ~33 minutes
- **Total tool calls**: 30
- **Total errors**: 4 (scan overflow, jq parse fail, Read too large, PAGE annotation error)
- **Reconnections**: 0
- **Context restarts**: 0
- **Task**: Audit deprecated `.Parts / Avatar` instances across a component file, set deprecation annotations on 22+ nodes, verify with get_annotations

> **Revision note**: Original analysis reported 24 calls/2 errors with fabricated tool entries (find ×2, set_selections ×1 not in transcript). Re-extraction shows 30 calls, 4 errors, and 6 Bash + 2 Read calls for overflow recovery that were previously undercounted.

## Metrics

| Metric | Session 10 | Session 7 | Change |
|---|---|---|---|
| Total tool calls | 23 | 30 | +30% |
| Figma MCP calls | 18 | 19 | +6% |
| Non-Figma overhead | 0 | 8 (Bash+Read) | New: overflow recovery |
| ToolSearch calls | 5 (21.7%) | 3 (10%) | Improved |
| Errors | 2 (8.7%) | 4 (13.3%) | Regressed |
| Estimated waste % | ~30% | ~40% | Regressed (overflow cascade) |

## Tool Call Distribution

| Tool | Calls | Notes |
|---|---|---|
| `get` | 8 | 4 used multi-node `nodeIds` batching. Good progressive detail. |
| `Bash` | 6 | 5 Python scripts to parse overflow file, 1 jq failure. |
| `set_multiple_annotations` | 4 | 22+ annotations across 4 calls. |
| `get_annotations` | 4 | 1 PAGE error, 3 verification reads. |
| `ToolSearch` | 3 | 10% — good. Batched 3+2+1 tools. |
| `Read` | 2 | 1 failed (file too large), 1 partial read. |
| `scan_nodes_by_types` | 1 | Overflowed at 276K chars → triggered entire cascade. |
| `join_channel` | 1 | Initial join. |
| `get_document_info` | 1 | Initial discovery. |

**Totals**: 3 ToolSearch + 19 Figma MCP + 8 Bash/Read = 30. Errors: 4.

## Efficiency Issues

### 1. scan_nodes_by_types overflow cascade (saves ~8 calls)

`scan_nodes_by_types(INSTANCE)` returned 276K chars, exceeding the output limit and overflowing to disk. The agent then spent 7 calls trying to process the overflow:
1. `Bash cat` → piped to Python (worked but output still huge)
2. `Bash jq` → parse error (jq couldn't handle the format)
3. `Read` → 133K tokens, too large
4. `Read` partial → got a portion
5. `Bash python3` → extracted Avatar instances (worked)
6. `Bash python3` → refined extraction
7. `Bash python3` → final extraction with IDs

**Pattern observed:** 1 `scan_nodes_by_types` + 1 `Bash jq` fail + 1 `Read` fail + 1 `Read` partial + 3 `Bash python3` processing = 8 total calls for what `find(name: "Avatar", type: ["INSTANCE"])` would have done in 1.

**Root cause:** `scan_nodes_by_types` is a legacy tool without output budgeting. The agent didn't know about `find` or its criteria-based filtering. CLAUDE.md documents `find` as the replacement but the agent didn't follow.

**Proposed fix:** Add deprecation notice to `scan_nodes_by_types` description pointing to `find`. [AGENT-007] already tracks this.

**Estimated savings:** 8 calls → 1 `find` call = ~7 calls saved.

### 2. Annotation splitting across 4 calls (saves ~3 calls)

22+ annotations were split across 4 `set_multiple_annotations` calls instead of 1. The batch tool accepts up to 200 annotations per call.

**Root cause:** Agent likely batched conservatively or discovered new targets between calls.

**Estimated savings:** 4 calls → 1 call = ~3 calls saved.

### 3. get with filter mismatch (saves ~1 call)

Call #16: `get(nodeIds: ["130:27868","11:31780"], filter: {namePattern: "..."})` returned nodes but the filter didn't match children. Call #17 repeated the same nodeIds without filter.

**Root cause:** Agent guessed a name pattern that didn't match. Had to retry without filter.

**Estimated savings:** ~1 call.

## Error Analysis

### 1. scan_nodes_by_types overflow (1 failure, ~5 minutes lost)

`scan_nodes_by_types(nodeId: "1:3", types: ["INSTANCE"])` → `Error: result (276,452 characters) exceeds maximum allowed tokens.`

The 276K result was saved to disk. Agent spent 5+ minutes and 7 calls recovering the data via Bash/Read/Python.

**Agent recovery:** Persistent but expensive. Eventually extracted the needed data via Python scripts. Should have pivoted to `find` immediately.

**Fix needed:** [AGENT-007] — deprecation notice on `scan_nodes_by_types`.

### 2. jq parse error (1 failure, ~30 seconds lost)

`Bash: cat overflow.txt | jq ...` → `jq: parse error: Invalid numeric literal`

**Agent recovery:** Immediately switched to Python.

### 3. Read file too large (1 failure, ~30 seconds lost)

`Read: overflow.txt` → `File content (133245 tokens) exceeds maximum allowed tokens (25000)`

**Agent recovery:** Re-read with offset/limit.

### 4. get_annotations on PAGE node (1 failure, trivial)

`get_annotations(nodeId: "1:3")` → `Error getting annotations: Node type PAGE does not support annotations`

**Agent recovery:** Switched to individual component nodes.

## What Worked Well

1. **Multi-node `get` batching.** 4 of 8 `get` calls used `nodeIds` array — inspecting 2-4 nodes per call.

2. **`set_multiple_annotations` batching.** All 22+ annotations succeeded with no individual calls. Even split across 4 calls, this is far better than 22 individual calls.

3. **ToolSearch efficiency.** 3 calls (10%) — good batching. First call loaded 3 tools at once.

4. **Persistent overflow recovery.** Agent didn't give up after the scan overflow — extracted the data through Python scripts and completed the task.

5. **Systematic workflow.** Connect → scan → identify targets → inspect → annotate → verify.

6. **Zero reconnections.** Stable connection throughout 33 minutes.

## Priority Improvements

### Tool Changes

1. **Deprecate `scan_nodes_by_types` in description** — [AGENT-007]. Would have saved 7 calls in this session. `find` with criteria is the replacement.

### Agent Skill Updates

1. **On overflow errors, pivot to `find` immediately** — Don't spend calls parsing overflow files. The `find` tool has built-in output budgeting.

2. **Consolidate `set_multiple_annotations` batches** — 22 annotations fit in a single call. No need to split across 4.
