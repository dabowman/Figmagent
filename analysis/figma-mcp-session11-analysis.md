# Figma MCP Session 11 Analysis

## Session Overview
- **Transcript**: `4f9d2c2b-20ca-4eb7-a6ac-e9e445210a07.json`
- **Duration**: 8 minutes (16:51:43 - 16:59:35)
- **Total tool calls**: 52
- **Total errors**: 4 (3 "Node not found" guesses + 1 wrong ToolSearch for `set_multiple_properties`)
- **Reconnections**: 0
- **Context restarts**: 0
- **Task**: Replace hard-coded kebab menu icons (TEXT node with `⋮`) in the `_Dataviews/Activity/Item` component set (3 variants) with proper `IconButton` component instances using the `more-vertical` icon

## Metrics
| Metric | Session 10 | Session 11 | Change |
|---|---|---|---|
| Total tool calls | 23 | 52 | +126% (more complex task) |
| Figma MCP calls | 18 | 43 | +139% |
| ToolSearch calls | 5 (21.7%) | 9 (17.3%) | Improved ratio |
| Errors | 2 (8.7%) | 4 (7.7%) | Similar |
| `get_local_components` calls | 0 | 16 | New: component discovery |
| Estimated waste % | ~30% | ~48% | Regressed |

## Tool Call Distribution
| Tool | Calls | Notes |
|---|---|---|
| `get_local_components` | 16 | Dominated session. 10 returned 0 results (62.5% miss rate). Exploratory name guessing. |
| `ToolSearch` | 9 | 17.3% of total. 7 batched (good), 2 keyword searches (wasted — returned wrong tools). |
| `get_node_tree` | 7 | 1 initial full-depth, 4 structural exploration, 1 instance inspection, 1 verification. |
| `rename_node` | 3 | Sequential rename of 3 instances. Could be batched. |
| `swap_component_variant` | 3 | Sequential icon swap on 3 instances. Could be batched. |
| `create_component_instance` | 3 | Sequential creation of 3 instances. Could use multi-root `create`. |
| `get_node_info` | 3 | 2 were failed node ID guesses. 1 successful. |
| `get_document_info` | 1 | Used to find "Actions" section. |
| `get_selection` | 1 | Initial selection check. |
| `join_channel` | 1 | Initial connection. |
| `delete_multiple_nodes` | 1 | Batch delete of 3 old frames (good). |

**Totals**: 9 ToolSearch + 43 Figma MCP = 52. Errors: 4.

## Efficiency Issues

### 1. Excessive `get_local_components` name-guessing (saves ~12 calls)
**Pattern observed:** 16 calls to `get_local_components` with various name guesses: `IconButton`, `icon`, `button`, `kebab`, `_Button`, `Type=Icon`, `_Dataviews/Button`, `actions`, `Type=`, `ellipsis`, `more-vertical`, `moreVertical`, `_ToolbarButton`, `_ToggleButton`, `_IconButton`. Only 4 of 16 returned useful results (25% hit rate).

**Root cause:** No efficient way to find a component's parent COMPONENT_SET from a variant ID. The agent knew variant `16547:26096` but couldn't navigate upward to the component set. Also, no fuzzy/semantic search — agent had to guess exact name prefixes.

**Proposed fix:** Two improvements needed:
1. **`get` should return `parentId` and `parentName`** — if the agent could call `get(16547:26096)` and see `parent: { id: "16507:33977", name: "IconButton", type: "COMPONENT_SET" }`, it would have found the component set in 1 call instead of 12.
2. **`get_local_components` should support `componentSetId` filter** — to find all component sets (not just variants) matching a pattern.

**Estimated savings:** ~12 calls (16 calls reduced to ~4).

### 2. Node ID guessing for parent discovery (saves ~3 calls)
**Pattern observed:** Calls #19-20 tried `16547:26095` and `16547:26094` hoping to find the parent component set by decrementing the ID. Both returned "Node not found." A third attempt at `15877:5978` also failed.

**Root cause:** Same as above — no parent traversal. Agent resorted to ID arithmetic, which is unreliable in Figma's ID scheme.

**Proposed fix:** Same as Issue 1 — expose parent info in `get` output.

**Estimated savings:** ~3 calls.

### 3. Sequential instance operations (saves ~6 calls)
**Pattern observed:** Three groups of sequential calls on the same 3 instances:
- `create_component_instance` x3 (calls #33-35)
- `rename_node` x3 (calls #38-40)
- `swap_component_variant` x3 (calls #45-47)

**Root cause:** `create_component_instance` is a legacy tool that doesn't support batch operations. `rename_node` has no batch variant. `swap_component_variant` has no batch variant. The consolidated `create` tool with `nodes` array wasn't used (agent used old `create_component_instance`).

**Proposed fix:**
- Agent should use `create` with `nodes` array for 3 instances [TOOL-010].
- `apply` tool should support `name` field to batch rename.
- `set_instance_overrides` or `apply` should support batch icon swaps.

**Estimated savings:** 9 calls reduced to ~3 = ~6 calls saved.

### 4. ToolSearch for non-existent tools (saves ~2 calls)
**Pattern observed:** Call #42 searched for `set_multiple_properties` (doesn't exist), then call #43 did a keyword search for "instance component property override swap icon", then call #44 searched for "swap component instance replace". The agent was looking for a way to set the INSTANCE_SWAP component property but couldn't find the right tool.

**Root cause:** The `set_instance_overrides` tool was in the ToolSearch results from call #32 but the agent didn't realize it could handle icon swaps. Eventually used `swap_component_variant` which worked despite swapping across different component sets (icons aren't variants of IconButton).

**Proposed fix:** Improve `set_instance_overrides` description to explicitly mention icon swaps via INSTANCE_SWAP properties. Or add this capability to `apply`.

**Estimated savings:** ~2 calls.

### 5. Redundant re-inspection (saves ~1 call)
**Pattern observed:** Call #18 re-inspected `16547:26096` at `structure` detail after already having inspected it at `layout` detail (call #12). The `layout` response was a superset of `structure`, so no new information was gained.

**Root cause:** Agent wanted to find the parent but re-inspected the node hoping for parent info in a different view.

**Estimated savings:** ~1 call.

## Error Analysis

### 1. Node ID guessing — "Node not found" (3 failures, ~15 seconds lost)
Three calls tried fabricated node IDs (`16547:26095`, `16547:26094`, `15877:5978`) hoping to find a parent component set by ID proximity.

**Agent recovery:** Good — abandoned ID guessing after 3 failures and switched to `get_document_info` to navigate the page structure. Found the "Actions" frame which contained the IconButton component set.

**Fix needed:** Expose `parentId`/`parentName` in `get` tool output [NEW: TOOL-011].

### 2. ToolSearch miss — `set_multiple_properties` (1 failure, ~10 seconds lost)
Agent searched for a non-existent batch property tool. Got back `set_multiple_properties` which doesn't handle component properties.

**Agent recovery:** Good — recognized the returned tool was wrong and searched again with different keywords. Eventually found `swap_component_variant` worked.

**Fix needed:** Minor. Better tool descriptions for instance override workflows.

## What Worked Well

1. **Clean task execution.** Once the component was identified, the replace workflow was clean: create 3 instances, delete 3 old frames, rename, swap icons, verify.

2. **Parallel `get_local_components` calls.** Calls #7-9, #16-17, #22-24, #25-27 were batched in parallel groups of 2-3, reducing wall-clock time.

3. **Batch `delete_multiple_nodes`.** Deleted all 3 old "Actions" frames in a single call.

4. **Final verification.** Agent checked the component set structure at the end to confirm all 3 variants had the new IconButton instances.

5. **`swap_component_variant` cross-component swap.** Agent discovered that `swap_component_variant` works for swapping any instance to any component (not just same-set variants), which is a useful undocumented capability.

6. **Zero reconnections/timeouts.** Stable connection throughout.

## Priority Improvements

### Tool Changes

1. **[NEW: TOOL-011] Expose parent info in `get` output** — P1. Would have saved ~15 calls in this session. When `get` returns a node, include `parentId`, `parentName`, and `parentType` in the output. This is the single biggest efficiency win: the agent spent 12+ calls trying to navigate from a variant to its parent COMPONENT_SET.

2. **[TOOL-010] Multi-root `create` for instances** — Recurring. Agent used legacy `create_component_instance` x3 instead of `create` with `nodes` array. Would save ~2 calls.

3. **Batch `rename_node`** — Add `name` field to `apply` tool so multiple nodes can be renamed in one call. Would save ~2 calls.

### Agent Skill Updates

1. **Use `get_document_info` earlier for component discovery** — When `get_local_components` misses 2+ times, switch to navigating the page structure. The agent took 12 guesses before trying this.

2. **Pre-load `rename_node` and `swap_component_variant` in common tool batches** — Same pattern as session 10. Agent needed a separate ToolSearch for `rename_node` after the action phase.

3. **Document `swap_component_variant` cross-component capability** — Works for any instance-to-component swap, not just within-set variant swaps. Useful for icon swaps.
