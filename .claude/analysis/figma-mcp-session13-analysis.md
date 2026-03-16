# Figma MCP Session 13 Analysis

## Session Overview

- **Transcript**: `bc287e1b-d51a-4154-9b00-5bd93571264c.json`
- **Duration**: ~20 minutes
- **Total tool calls**: 37
- **Total errors**: 9 (24.3%)
- **Reconnections**: 3 (channel switches/rejoins)
- **Context restarts**: 0
- **Model**: Started on claude-sonnet-4-6 (calls #1-6), switched to claude-opus-4-6 (calls #7-37)
- **Task**: Explore DataViews component set (16 variants, 4 layouts x 4 states) and plan a slot refactoring (exposing nested instances as component properties). Planning-only session — no design modifications were executed.

## Metrics

| Metric | Session 10 | Session 13 | Change |
|---|---|---|---|
| Total tool calls | 23 | 37 | +61% (exploration-heavy) |
| Figma MCP calls | 18 | 22 | +22% |
| ToolSearch calls | 5 (21.7%) | 5 (13.5%) | Improved ratio |
| Errors | 2 (8.7%) | 9 (24.3%) | Regressed significantly |
| Estimated waste % | ~30% | ~46% | Regressed |

## Tool Call Distribution

| Tool | Calls | Notes |
|---|---|---|
| `get_node_tree` | 14 | 37.8%. Bulk of session — inspecting DataViews variants at varying depths. |
| `join_channel` | 5 | 13.5%. 3 reconnections due to channel loss + 1 multi-channel disambiguation + 1 wrong channel. |
| `ToolSearch` | 5 | 13.5%. Fetched: MCP tools (1), get_node_info (1), EnterPlanMode (1), AskUserQuestion (1), ExitPlanMode (1). |
| `get_node_info` | 3 | 8.1%. All 3 failed with validation error (depth passed as string instead of number). |
| `get_selection` | 2 | 5.4%. First timed out (wrong channel), second succeeded. |
| `Read` | 2 | 5.4%. Reading components-and-variants.md reference. |
| `get_component_properties` | 1 | 2.7%. Variant property inspection. |
| `EnterPlanMode` | 1 | 2.7%. |
| `ExitPlanMode` | 1 | 2.7%. Rejected by user (session ended). |
| `Write` | 1 | 2.7%. Plan file creation. |
| `Edit` | 1 | 2.7%. Plan file refinement. |
| `AskUserQuestion` | 1 | 2.7%. Scope clarification (Phase 1 vs Phase 2). |

**Totals**: 5 ToolSearch + 22 Figma MCP + 10 other = 37. Errors: 9.

## Error Analysis

### 1. Channel loss after model switch (3 wasted calls)

**Calls #4, #7, #8**: `get_selection` timed out on channel `b2tmuppi` (call #4). Agent switched to channel `5idnrh8f` which worked. After user interrupted and model switched from Sonnet to Opus, `get_node_tree` failed with "Must join a channel" (call #7). Agent recovered with `join_channel` (call #8).

**Root cause**: Model switch (Sonnet to Opus) resets the MCP server's channel state. The new model context doesn't inherit the previous channel join.

**Impact**: 3 wasted calls (1 timeout + 1 "must join" error + 1 rejoin).

### 2. `getMainComponent` sync API error (2 wasted calls)

**Calls #11-12**: `get_node_tree` with `detail="layout"` and `depth=4` on variant nodes failed with: `"in get_mainComponent: Cannot call with documentAccess: dynamic-page. Use node.getMainComponentAsync instead."`

**Root cause**: Bug in the plugin's `get_node_tree` implementation — it called `getMainComponent` (synchronous) instead of `getMainComponentAsync` when traversing instance nodes at layout detail level. The agent correctly diagnosed this as a plugin bug.

**Impact**: 2 wasted calls. Agent switched to `get_node_info` as a fallback (which also failed, see below).

### 3. `get_node_info` type validation error — retry storm (3 wasted calls)

**Calls #13-15**: Three consecutive `get_node_info` calls all failed with the same error: `"Expected number, received string"` for the `depth` parameter. The agent passed `depth: "3"` (string) instead of `depth: 3` (number).

**Root cause**: Agent passed depth as a string literal. After the first failure, the agent did NOT fix the type — it just tried a different nodeId with the same wrong type, three times in a row.

**Pattern**: **Error retry storm** [AGENT-009]. Agent retried with different node IDs instead of reading the error message and fixing the parameter type. Classic "change the wrong variable" anti-pattern.

**Impact**: 3 completely wasted calls. After the third failure, the agent finally used ToolSearch to re-read the schema — but the user interrupted before it could retry correctly.

### 4. Output overflow on depth=4 queries (3 wasted calls)

**Calls #18-20**: After reconnecting, the agent retried `get_node_tree` at `detail="layout"`, `depth=4` on three variant nodes. All succeeded from the plugin but returned 291K-335K characters each — far exceeding Claude Code's context window, causing the results to be saved to disk instead of returned inline.

**Root cause**: Agent went straight to depth=4 with layout detail without first checking output size. Each DataViews variant has deep nested component instances (tables with rows, grids with cards), resulting in massive FSGN output.

**Pattern**: **Overfetch** — agent should have started with `depth=2` (as CLAUDE.md recommends) and only increased depth on specific subtrees. The agent did correct this on the next attempt (calls #21-26 all used depth=2 successfully).

**Impact**: 3 wasted calls (~930K characters of output saved to files that were never read).

### 5. Wrong initial channel (1 wasted call)

**Call #4**: `get_selection` timed out on channel `b2tmuppi`. The other channel `5idnrh8f` was the correct one.

**Root cause**: Two Figma files were open. Agent guessed the first channel listed. Recovery was quick (1 extra join_channel call).

## Sequential Same-Tool Runs (5+)

### `get_node_tree` x6 (calls #21-26)

Six sequential `get_node_tree` calls inspecting individual variants at `detail="layout"`, `depth=2`. Each returned 3-7K chars successfully. These were all distinct node IDs (Table/Default, Activity/Default, Table/Empty, Table/Selection, Table/Loading, Grid/Default) — legitimate exploratory reads, not redundant.

**Verdict**: Acceptable but could be optimized. The `nodeIds` array parameter (multi-node fetch) was not available at this session's date, so sequential calls were necessary.

### `get_node_info` x3 (calls #13-15) — ERROR STORM

Three identical-error calls. See Error Analysis #3 above.

## Redundant Re-inspections

| nodeId | Calls | Detail |
|---|---|---|
| `15620:43467` | #9 (structure, depth 2) | Single read, no redundancy. |
| `13635:32859` | #11 (layout, depth 4 — error), #18 (layout, depth 4 — overflow), #21 (layout, depth 2 — success) | 3 calls, 2 wasted. |
| `31306:16723` | #12 (layout, depth 4 — error), #19 (layout, depth 4 — overflow), #22 (layout, depth 2 — success) | 3 calls, 2 wasted. |
| `31307:17612` | #15 (get_node_info, string error), #20 (layout, depth 4 — overflow), #23 (layout, depth 2 — success) | 3 calls, 2 wasted. |

Three node IDs were each fetched 3 times before getting usable results. Combined waste: 6 calls.

## Waste Breakdown

| Category | Wasted Calls | % of Total |
|---|---|---|
| Channel loss/reconnection | 3 | 8.1% |
| Plugin bug (getMainComponent sync) | 2 | 5.4% |
| Type validation retry storm | 3 | 8.1% |
| Output overflow (depth=4 overfetch) | 3 | 8.1% |
| Wrong channel guess | 1 | 2.7% |
| ToolSearch for plan mode tools | 2 | 5.4% |
| **Total waste** | **14** | **37.8%** |

Productive calls: 23/37 (62.2%). Estimated waste: ~38%.

## What Worked Well

1. **Correct initial approach.** Started with `get_node_tree(detail="structure", depth=2)` on the component set — exactly as recommended by CLAUDE.md. Got a compact 245-token overview of all 16 variants.

2. **Good bug diagnosis.** Agent correctly identified the `getMainComponent` vs `getMainComponentAsync` bug in the plugin and switched to alternative tools instead of retrying the same broken path.

3. **Self-correction on depth.** After three depth=4 overflows, immediately reduced to depth=2 and completed the exploration efficiently (6 successful calls in quick succession).

4. **Thorough planning.** Used EnterPlanMode, gathered instance IDs from exploration, wrote a structured plan with an instance ID table, asked the user about scope via AskUserQuestion. Good agent workflow.

5. **ToolSearch efficiency.** 5 ToolSearch calls at 13.5% is the best ratio since session 10 (21.7%). All were single-tool fetches for specific tools (no broad searches).

## Issues Identified

### New Issues

**[AGENT-009] Type validation retry storm**: Agent passed `depth: "3"` (string) to `get_node_info` three consecutive times without reading the error message. The error clearly stated "Expected number, received string" but the agent changed the nodeId instead of the type. **Fix**: Agent instructions should emphasize reading error messages before retrying. After validation errors, fix the parameter — don't change unrelated parameters.

**[AGENT-010] Channel loss on model switch**: When Claude Code switches models mid-conversation (Sonnet to Opus), the MCP channel state is not preserved. The new model instance must re-join. **Fix**: Already partially addressed by auto-join. Could add a "channel health check" before the first tool call after a model switch.

**[TOOL-011] `getMainComponent` sync API bug**: The plugin's FSGN traversal called `getMainComponent` (synchronous) instead of `getMainComponentAsync` when encountering instance nodes during layout/full detail traversal. **Fix**: Replace `getMainComponent()` with `await getMainComponentAsync()` in the plugin's node tree traversal code.

### Recurring Issues

**[TOOL-005] ToolSearch overhead**: 5 calls (13.5%). Two were for plan mode tools (EnterPlanMode, ExitPlanMode) which are standard Claude Code tools — these shouldn't need ToolSearch at all if they were in the base tool set. Remaining 3 were legitimate (MCP tool discovery, get_node_info schema check, AskUserQuestion).

**[AGENT-008] Multi-channel disambiguation**: First `join_channel` returned two channels. Agent guessed wrong, lost 1 call to a timeout. The descriptive channel names feature (added later) would have helped here — channels were opaque IDs (`b2tmuppi`, `5idnrh8f`) instead of file names.

## Priority Improvements

### Tool Changes

1. **Fix `getMainComponent` sync bug** — [TOOL-011]. Replace sync call with async in FSGN traversal. Would have saved 2 calls in this session.

2. **Output budget system** — Already implemented after this session. The 335K char overflows (calls #18-20) motivated the 30K default budget with `guardOutput()`. Would have saved 3 calls.

### Agent Behavior

1. **Read error messages before retrying** — [AGENT-009]. The type validation storm (3 identical errors) is the clearest anti-pattern in this session. Agent should parse error messages and fix the indicated parameter.

2. **Start with depth=2, always** — Agent mostly followed this but broke the pattern after encountering the sync API bug, jumping to depth=4 on retry. Should have stayed at depth=2 with layout detail.

3. **Pre-load plan mode tools** — EnterPlanMode, ExitPlanMode, AskUserQuestion could be pre-loaded in the initial ToolSearch batch when the session involves planning.
