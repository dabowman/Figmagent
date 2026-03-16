# Figma MCP Session 15 Analysis

## Session Overview

- **Transcript**: `a9dc0f98-5cd9-47f9-a7c7-b68ecdfe347f.json`
- **Duration**: ~27 minutes
- **Total tool calls**: 137
- **Total errors**: 1 (font loading on import_library_component with parentNodeId)
- **Reconnections**: 0
- **Context restarts**: 0
- **Task**: Build a WPDS (Washington Post Design System) component reference page — import ~38 library components across 6 categories, organize into categorized sections, then restructure from single wrapper frame into 6 independent frames in a 2-column grid layout

## Metrics

| Metric | Session 10 | Session 15 | Change |
|---|---|---|---|
| Total tool calls | 23 | 137 | +496% (much larger task) |
| Figma MCP calls | 18 | 132 | +633% |
| ToolSearch calls | 5 (21.7%) | 5 (3.6%) | Ratio improved |
| Errors | 2 (8.7%) | 1 (0.7%) | Improved |
| Estimated waste % | ~30% | ~25% | Improved |

## Tool Call Distribution

| Tool | Calls | Notes |
|---|---|---|
| `clone_and_modify` | 42 | 30.7%. Dominated session. Used for both component reparenting (7 imports into sections) and restructuring (6 sections to page root + clone-delete-reclone mistake). |
| `import_library_component` | 33 | 24.1%. Sequential imports of library components across 6 categories. |
| `get_component_variants` | 24 | 17.5%. Discovering variant keys from component sets to find correct default variants. |
| `move_node` | 6 | 4.4%. Positioning 6 independent frames in 2-column grid. |
| `ToolSearch` | 5 | 3.6%. Excellent ratio for a 137-call session. 3 batched (5+5+3 tools), 2 singles. |
| `get` | 3 | 2.2%. Structure check, layout inspection, final page verification. |
| `delete_node` | 3 | 2.2%. Cleanup: 1 bad clone, 1 original wrapper, 1 stray node. |
| `search_library_components` | 2 | 1.5%. Searching for Secondary and Tertiary button variants. |
| `set_focus` | 2 | 1.5%. Viewport focus after restructuring. |
| `get_document_info` | 1 | 0.7%. Initial file exploration. |
| `get_library_components` | 1 | 0.7%. Full library catalog discovery. |
| `create` | 1 | 0.7%. Single call created the 20-node page structure (7 sections). Excellent use of nested tree creation. |
| `delete_multiple_nodes` | 1 | 0.7%. Batch deleted 38 original imported instances after cloning to section frames. |
| `apply` | 1 | 0.7%. Batch styled all 6 independent frames (fillColor, cornerRadius, padding). |

**Totals**: 5 ToolSearch + 132 Figma MCP = 137. Errors: 1.

## Session Phases

### Phase 1: Discovery (calls #1-#28, ~6 min)
- ToolSearch (5 tools) → get_document_info → get_library_components → ToolSearch (5 tools) → search_library_components × 2 → ToolSearch (1 tool) → get_component_variants × 24

The agent discovered 48 component sets in the WPDS library, then systematically fetched variant lists for 24 component sets to find the correct default variant keys for import. This was thorough but expensive — 24 sequential `get_component_variants` calls.

### Phase 2: Structure + Import (calls #29-#66, ~8 min)
- create (20-node tree) → import_library_component × 33 (with 1 error + retry) → clone_and_modify × 4 (reparenting stray imports)

Created the page skeleton in 1 call, then imported 33 library components sequentially. First import with `parentNodeId` failed due to font loading — agent adapted by importing to page root and using `clone_and_modify` to reparent.

### Phase 3: Reparenting (calls #67-#102, ~5 min)
- ToolSearch (3 tools) → clone_and_modify × 35 → delete_multiple_nodes × 1

Cloned all imported instances from page root into their correct section frames, then batch-deleted the 38 originals.

### Phase 4: Restructuring (calls #103-#137, ~8 min)
- get (structure) → ToolSearch (1 tool) → set_focus → get (layout) → clone_and_modify (mistake) → delete_node → clone_and_modify × 6 → delete_node × 2 → apply (batch style) → get (verify) → delete_node → move_node × 6 → set_focus

Inspected the wrapper, cloned each section to page root as independent frames, deleted the wrapper, batch-styled all 6 frames, verified, and positioned them in a 2-column grid.

## Efficiency Issues

### 1. Sequential `get_component_variants` calls (saves ~20 calls)

24 consecutive `get_component_variants` calls (#5-#28), each for a different component set. This is the session's largest efficiency problem. The agent was looking for default variant component keys, but many of these were never imported (only ~15 unique components were eventually imported from these 24 lookups).

**Pattern observed:** Agent enumerated ALL 24 major component sets even though only ~15 were needed for the reference page.

**Root cause:** No batch `get_component_variants` tool. Also, over-discovery — agent explored more component sets than it planned to import.

**Proposed fix:** A batch variant discovery tool, or better: the agent should decide which components to import FIRST, then look up only those variant keys.

**Estimated savings:** ~9 calls (skip unneeded lookups) + potential batch variant API.

### 2. Sequential `import_library_component` calls (saves ~30 calls)

33 sequential `import_library_component` calls (#29-#62), one per component. No batch import capability exists.

**Pattern observed:** `import(Button-Primary)` → `import(Button-Primary-Small)` → `import(Button-Primary-Large)` → ... 33 times.

**Root cause:** `import_library_component` only handles one component per call. No batch variant exists.

**Proposed fix:** Add `import_library_components` (plural) accepting an array of `{componentKey, name?, parentNodeId?}`. Would collapse 33 calls to 1.

**Estimated savings:** 32 calls.

### 3. Clone-reparent-delete pattern instead of direct import (saves ~36 calls)

After importing components to page root (to avoid font error), the agent used `clone_and_modify` to reparent each into the correct section frame, then `delete_multiple_nodes` to clean up originals. That is 35 clone calls + 1 batch delete = 36 calls.

**Pattern observed:** import(to root) → clone_and_modify(to section) × 35 → delete_multiple_nodes(originals)

**Root cause:** `import_library_component` with `parentNodeId` failed on font loading. The agent worked around it by importing to root then cloning to the target parent. If `import_library_component` handled font loading internally, the reparenting phase would be unnecessary.

**Proposed fix:** Fix `import_library_component` to auto-load fonts when `parentNodeId` is specified. This would eliminate the entire reparenting phase.

**Estimated savings:** 36 calls (the entire clone+delete phase).

### 4. Clone-delete-reclone mistake (saves 2 calls)

Call #103: `clone_and_modify(1:4)` without `parentId` → cloned inside the wrapper. Immediate `delete_node` cleanup, then re-cloned with `parentId: "0:1"`.

**Pattern observed:** clone(no parentId) → "oops, wrong parent" → delete → clone(correct parentId)

**Root cause:** Agent forgot the `parentId` parameter on the first attempt.

**Estimated savings:** 2 calls.

### 5. Sequential `move_node` calls (saves ~5 calls)

6 sequential `move_node` calls to position the 6 section frames in a grid. Could be batched.

**Pattern observed:** move(Actions, 0,0) → move(Containers, 1344,0) → move(Input, 0,1340) → move(Feedback, 1344,1340) → ...

**Root cause:** `move_node` is single-node only. No batch move tool.

**Proposed fix:** Add `nodes` array to `move_node` for batch positioning.

**Estimated savings:** 5 calls.

## Error Analysis

### 1. Font loading on parentNodeId import (1 failure, ~5 seconds lost)

`import_library_component(componentKey, parentNodeId: "1:6")` returned: `Error importing library component: in appendChild: unloaded font "SF Pro Regular"`

**Agent recovery:** Excellent — immediately switched strategy to import without `parentNodeId` (to page root), then reparented via `clone_and_modify`. Adapted in 1 retry, no repeated failures.

**Root cause:** The `import_library_component` plugin handler doesn't pre-load fonts when inserting into a specific parent. Font loading is only triggered when text content is set, but `appendChild` on an auto-layout frame triggers a layout pass that requires fonts.

**Fix needed:** Plugin should `loadFontAsync` for all text nodes in the imported component before calling `appendChild` on the target parent.

## New Issues

### [TOOL-012] Batch import_library_component

- **Priority**: P1
- **Category**: missing-batch-tool
- **First seen**: Session 15
- **Estimated savings**: ~32 calls/session (33→1)
- **Description**: 33 sequential single-component imports. A batch `import_library_components` tool accepting an array of component specs would collapse this to 1 call.

### [BUG-004] import_library_component font loading with parentNodeId

- **Priority**: P1
- **Category**: plugin-bug
- **First seen**: Session 15
- **Estimated savings**: ~36 calls/session (eliminates entire clone-reparent phase)
- **Description**: `import_library_component` with `parentNodeId` fails when the imported component contains text with non-loaded fonts and the parent has auto-layout. The `appendChild` triggers a layout pass before fonts are loaded.
- **Fix**: Pre-load all fonts in the imported component tree before calling `appendChild`.

### [TOOL-013] Batch get_component_variants

- **Priority**: P2
- **Category**: missing-batch-tool
- **First seen**: Session 15
- **Estimated savings**: ~20 calls/session
- **Description**: 24 sequential `get_component_variants` calls to discover variant keys. A batch tool accepting multiple component set node IDs would consolidate this.

### [TOOL-014] Batch move_node

- **Priority**: P3
- **Category**: missing-batch-tool
- **First seen**: Session 15
- **Estimated savings**: ~5 calls/session
- **Description**: 6 sequential `move_node` calls to position frames in a grid layout. Lower priority since `move_node` is fast.

## What Worked Well

1. **Single `create` call for 20-node page structure.** The nested tree creation (7 sections, each with title + component container frame) was perfectly efficient. 1 call → 20 nodes.

2. **Batch `delete_multiple_nodes` for cleanup.** After reparenting, all 38 originals deleted in 1 call. No sequential deletes.

3. **Batch `apply` for styling.** All 6 independent frames styled (fillColor, cornerRadius, padding) in 1 call with a `nodes` array. Zero sequential apply calls.

4. **ToolSearch ratio at 3.6%.** Best ratio across all analyzed sessions. Only 5 ToolSearch calls for 137 total — 3 were batched (fetching 5+5+3 tools each), 2 were singles for late-discovered tools (get_component_variants, set_focus).

5. **Zero reconnections/timeouts.** Rock-solid WebSocket connection for the entire 27-minute session.

6. **Clean error recovery.** The 1 error (font loading) was recovered in 1 retry with an immediate strategy change. No retry storms.

7. **Proper `get` usage.** Started with `detail="structure", depth=2` for orientation, escalated to `detail="layout"` only when needed for restructuring. No unnecessary full reads.

8. **Final cleanup discipline.** Agent verified with `get` after restructuring, found a stray node (1:1999), and deleted it. No orphans left behind.

## Waste Estimate

| Category | Wasted Calls | Notes |
|---|---|---|
| Over-discovery (unneeded get_component_variants) | ~9 | Explored 24 component sets, imported from ~15 |
| Clone-reparent phase (workaround for BUG-004) | ~36 | Would be unnecessary if import handled fonts |
| Sequential imports (no batch) | ~32 | 33 imports → 1 batch |
| Clone-delete-reclone mistake | 2 | Forgot parentId |
| Sequential moves (no batch) | ~5 | 6 moves → 1 batch |

**Total estimated wasted calls:** ~34 (excluding import batch and clone-reparent since those require tool/bug fixes)

**Waste %:** ~25% (34 unnecessary calls out of 137)

Note: If BUG-004 and TOOL-012 were both fixed, this session could be reduced from 137 calls to approximately 40-50 calls (5 ToolSearch + 1 get_document_info + 1 get_library_components + ~12 get_component_variants + 1 create + 1 import_batch + 1 apply + 1 delete_wrapper + 6 move_node + 1 get_verify + 2 set_focus + misc = ~35).

## Priority Improvements

### Plugin Bug Fixes

1. **[BUG-004] Font loading in import_library_component** — Pre-load fonts before `appendChild` when `parentNodeId` is specified. Would eliminate the entire clone-reparent workaround (36 calls saved).

### Tool Changes

1. **[TOOL-012] Batch import_library_component** — Accept array of `{componentKey, name?, parentNodeId?}`. 33 sequential imports → 1 call.
2. **[TOOL-013] Batch get_component_variants** — Accept array of component set node IDs. 24 sequential lookups → 1 call.
3. **[TOOL-014] Batch move_node** — Accept array of `{nodeId, x, y}`. Lower priority.

### Agent Behavior

1. **Selective discovery** — Agent should plan which components to import before exhaustively exploring all component sets. ~9 get_component_variants calls were for components never imported.
