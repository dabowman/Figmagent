# Figma MCP Session 9 Analysis (Revised)

## Session Overview

- **Transcript**: `63622822-059e-41a1-8455-d6121e8592fe.json`
- **Duration**: ~50 minutes
- **Total tool calls**: 17
- **Total errors**: 4 (all 403 Forbidden on REST API library endpoints)
- **Reconnections**: 0
- **Context restarts**: 0
- **Task**: Figma design exploration — used figma-guidelines skill to browse document structure, inspect Toolbar instance, explore local/library components. Goal was to find WPDS Modal components in an external library, blocked by API token permissions.

> **Revision note**: Original analysis undercounted tool calls (16 vs 17) and reported 0 errors. Re-extraction with `--compact --no-thinking` captured the full transcript including 4 × 403 errors and an additional search_library_components retry.

## Metrics

| Metric | Session 7 | Session 9 | Change |
|---|---|---|---|
| Total tool calls | 24 | 17 | -29% |
| Figma MCP calls | 22 | 10 | -55% |
| ToolSearch calls | 2 (8.3%) | 7 (41.2%) | Regressed significantly |
| Errors | 2 (8.3%) | 4 (23.5%) | Regressed |
| Estimated waste % | ~25% | ~53% | Regressed (ToolSearch + 403 retries) |

## Tool Call Distribution

| Tool | Calls | Notes |
|---|---|---|
| `ToolSearch` | 7 | 41.2% — worst ratio across all sessions. Mix of batch (1×4, 1×2) and singles. |
| `get` | 3 | Node inspection: Toolbar structure, Toolbar layout, IconButton layout. |
| `search_library_components` | 2 | Both returned 403. Second was a retry after user pause. |
| `get_document_info` | 1 | Initial document discovery. |
| `get_selection` | 1 | Check user's current selection (parallel with get_document_info). |
| `get_local_components` | 1 | Local component discovery (returned 0). |
| `get_library_components` | 1 | Alternate library endpoint — also 403. |
| `get_component_variants` | 1 | Direct variant fetch — also 403. |

**Totals**: 7 ToolSearch + 10 Figma MCP = 17. Errors: 4 (all on library REST API calls).

## Efficiency Issues

### 1. ToolSearch dominates session (saves ~5 calls)

7 ToolSearch calls out of 17 total (41.2%). The first ToolSearch was a good batch (4 tools), but subsequent ones were singles, each fetching 1-2 tools as the agent discovered what it needed next.

**Pattern observed:** ToolSearch → use tool → ToolSearch → use tool → ... throughout the entire session. 6 of 7 ToolSearch calls fetched tools that the agent then used immediately. 1 ToolSearch (`get_library_variables`) fetched a tool that was never called.

**Root cause:** The figma-guidelines skill doesn't pre-load tool schemas. Each new exploration step requires discovering the relevant tool first.

**Proposed fix:** Pre-load all common read tools in the first ToolSearch: `get_document_info`, `get_selection`, `get`, `get_local_components`, `get_library_components`, `search_library_components`, `get_component_variants`, `get_design_system`, `find`.

**Estimated savings:** ~5 calls (7 ToolSearch → 1-2 batched calls).

### 2. Redundant re-inspection of Toolbar node (saves ~1 call)

Node `1:370` (Toolbar) was read twice: first with `detail="structure", depth=3` (call #5), then with `detail="layout", depth=0` (call #7). The second call added layout details (dimensions, auto layout, component properties) that were absent at structure level.

**Root cause:** CLAUDE.md recommends starting with `detail="structure"` but the agent legitimately needed layout/component property details. The two-call pattern is correct when the first call confirms the node is interesting.

**Potential improvement:** Start with `detail="layout", depth=2` for the initial inspection to avoid the follow-up. Minor saving.

### 3. ToolSearch for unused tools (saves ~2 calls)

The agent fetched schemas for `get_library_variables`, `import_library_component`, `create`, and `apply` — none were ever called. These were fetched speculatively while exploring options after the 403 errors.

**Root cause:** Agent was searching for alternative approaches after library API failed. Fetching `create`/`apply` suggests it was planning to build the modal from scratch before the user interrupted.

**Estimated savings:** ~2 calls (the 2 ToolSearch calls for unused tools).

## Error Analysis

### 1. 403 Forbidden on library REST API (4 failures, ~2 minutes lost)

All 4 errors were identical: `Figma API returned 403 Forbidden. Your token may lack required scopes.`

**Sequence:**
1. `search_library_components` (fileKey, "Modal") → 403
2. `get_library_components` (fileKey, "Modal") → 403 (different endpoint, same error)
3. `get_component_variants` (fileKey, 2799:26256) → 403 (third attempt, third tool)
4. `search_library_components` (fileKey, "Modal") → 403 (retry after ~10 min user pause)

**Agent recovery:** After calls #1 and #2, the agent correctly diagnosed the token scope issue. However, it still tried a third tool (`get_component_variants`) on the same library file — predictably getting the same 403. Call #4 was after a user pause, suggesting the user may have updated the token, so this retry was reasonable.

**Fail-fast assessment:** The agent partially followed the fail-fast rule. It recognized the root cause after 2 errors but tried one more variant before stopping. Call #3 was borderline — different tool, same underlying auth issue. Call #4 after user interaction was justified.

**Fix needed:** Agent should generalize the fail-fast rule: if 2 different tools on the same file key return 403, ALL REST API calls to that file will fail. Stop trying and ask the user to fix the token.

### 2. Scope generalization gap (new pattern)

The agent correctly identified the missing scope (`file_content:read`, `library_content:read`) but didn't generalize that ALL REST API endpoints accessing that file would be blocked. It tried 3 different endpoints before concluding they all need the same token scopes.

**Proposed fix:** Add to CLAUDE.md: "If a REST API call returns 403 on a specific file key, all REST API calls to that file will fail with the same error. Stop after the first 403 and ask the user to check their FIGMA_API_TOKEN scopes."

## What Worked Well

1. **Good initial batching.** First ToolSearch fetched 4 tools at once. get_document_info and get_selection ran in parallel.

2. **Progressive detail.** Used structure → layout progression on the Toolbar, getting orientation before details.

3. **Zero reconnections/timeouts.** Auto-join and WebSocket connection remained stable throughout the 50-minute session.

4. **Correct root cause identification.** Agent quickly identified the 403 as a token scope issue and communicated it clearly to the user.

5. **User-appropriate communication.** Agent asked the user for the WPDS library URL when needed, and explained the token scope requirements clearly.

## Priority Improvements

### Tool Changes

1. **Improve 403 error messages** — Include the file key and tool name in the error so the agent can more easily generalize across tools hitting the same auth wall. Minor improvement.

### Agent Skill Updates

1. **Pre-load tool schemas in figma-guidelines skill** — [TOOL-005] recurring. Add initial ToolSearch batch for all common read tools. Saves ~5 calls.

2. **Generalize 403 fail-fast** — New pattern: after one REST API 403 on a file key, assume all REST API calls to that file will fail. Stop trying different endpoints and ask the user. Saves ~2 calls per occurrence.
