# Figma MCP Session 16 Analysis

## Session Overview

- **Transcript**: `e1df26c0-2e69-4eae-bd7d-753441eca0e7.json`
- **Duration**: ~24 minutes
- **Total tool calls**: 77
- **Total errors**: 5
- **Reconnections**: 0
- **Context restarts**: 0
- **Task**: Build a Block Action Modal design in Figma using WPDS library components (ComboboxControl, InputControl, Button, IconButton), bind WPDS design token variables to all manually-created nodes, and verify full tokenization. Also explored a separate WordPress plugin codebase (block-actions) via sub-agents.

## Metrics

| Metric | Session 10 | Session 16 | Change |
|---|---|---|---|
| Total tool calls | 23 | 77 | +235% (much larger task) |
| Figma MCP calls | 18 | 58 | +222% |
| ToolSearch calls | 5 (21.7%) | 9 (11.7%) | Improved % |
| Agent calls | 0 | 2 (2.6%) | New: sub-agent exploration |
| Errors | 2 (8.7%) | 5 (6.5%) | Improved % |
| Estimated waste % | ~30% | ~25% | Improved |

## Tool Call Distribution

| Tool | Calls | Notes |
|---|---|---|
| `get` | 14 | Node inspection at various detail/depth levels. 4 on same root node (3:2642). |
| `search_library_components` | 9 | Library searches for modal, dialog, overlay, button, toggle, combobox, TextControl, InputControl, close. |
| `ToolSearch` | 9 | 11.7% overhead. Mix of batched (2-4 tools) and single fetches. |
| `import_library_component` | 8 | Modal, ComboboxControl, InputControl (×2 initially + ×4 rebuild + 1 reference modal). |
| `apply` | 8 | Layout sizing, variable bindings, fills, text styles. Batched well (3-5 nodes per call). |
| `get_component_variants` | 3 | Modal, Button, ComboboxControl variant discovery. |
| `create` | 3 | 1 failed (font error), 1 failed (font error retry), 1 succeeded (frame-only tree). Plus 1 text node (3 attempts, 2 failed). |
| `set_multiple_text_contents` | 2 | 4 text overrides + 10 text overrides. Efficient batching. |
| `scan_text_nodes` | 2 | Text node discovery for overrides. [AGENT-007] — could use `find` instead. |
| `Agent` | 2 | Sub-agent exploration of block-actions WordPress plugin. |
| `lint_design` | 2 | Both returned "no local variables" — wasted calls since file uses library variables only. |
| `get_document_info` | 1 | Initial orientation. |
| `get_selection` | 1 | Check current selection. |
| `get_local_components` | 1 | Empty result (library file). |
| `get_design_system` | 1 | Empty result (no local styles/variables). |
| `get_library_variables` | 1 | 403 Forbidden — Enterprise-only endpoint. [AGENT-008] |
| `delete_multiple_nodes` | 1 | Cleaned up temp instances (3 nodes). |
| `delete_node` | 1 | Removed reference modal after inspecting variable bindings. |
| `reorder_children` | 1 | Title before close button in header. |

**Totals**: 9 ToolSearch + 2 Agent + 58 Figma MCP + 8 other = 77. Errors: 5.

## All Calls (numbered)

| # | Tool | Result | Notes |
|---|---|---|---|
| 1 | ToolSearch | OK | 4 tools: get_document_info, get_selection, get_design_system, search_library_components |
| 2 | get_document_info | OK | Page 1, 1 child (Toolbar instance) |
| 3 | get_selection | OK | No selection |
| 4 | ToolSearch | OK | 3 tools: get_library_components, get_library_variables, import_library_component |
| 5 | ToolSearch | OK | 2 tools: get, get_component_variants |
| 6 | get | OK | Toolbar instance at depth 0 |
| 7 | ToolSearch | OK | 1 tool: get_local_components |
| 8 | get_local_components | OK | Empty (library file) |
| 9 | search_library_components | OK | "modal" — 3 results |
| 10 | search_library_components | OK | "dialog" — 1 result |
| 11 | search_library_components | OK | "overlay" — 9 results |
| 12 | search_library_components | OK | "button" — 10 results |
| 13 | get_component_variants | OK | Modal: Small/Medium/Large |
| 14 | get_component_variants | OK | Button: 94 variants |
| 15 | import_library_component | OK | Modal Medium → 3:2247 |
| 16 | get | OK | Modal instance depth 4 — structure inspection |
| 17 | ToolSearch | OK | 2 tools: set_multiple_text_contents, scan_text_nodes |
| 18 | scan_text_nodes | OK | 4 text nodes in modal |
| 19 | set_multiple_text_contents | OK | 4 text overrides (Move to trash modal) |
| 20 | Agent | OK | Read block-actions CLAUDE.md (sub-agent) |
| 21 | Agent | OK | Explore block-actions modal & editor UI (sub-agent) |
| 22 | search_library_components | OK | "select control" — 0 results |
| 23 | search_library_components | OK | "text input" — 0 results |
| 24 | search_library_components | OK | "toggle" — 9 results |
| 25 | search_library_components | OK | "combobox" — 1 result |
| 26 | search_library_components | OK | "TextControl" — 2 results |
| 27 | search_library_components | OK | "InputControl" — 3 results |
| 28 | get_component_variants | OK | ComboboxControl: 4 variants |
| 29 | import_library_component | OK | ComboboxControl → 3:2574 |
| 30 | import_library_component | OK | InputControl → 3:2613 |
| 31 | get | OK | ComboboxControl depth 4 |
| 32 | get | OK | InputControl depth 4 |
| 33 | ToolSearch | OK | 3 tools: create, apply, set_instance_overrides |
| 34 | ToolSearch | OK | 1 tool: delete_multiple_nodes |
| 35 | delete_multiple_nodes | OK | Cleaned 3 temp instances |
| 36 | **create** | **ERROR** | Font error: "Cannot write to node with unloaded font Inter Regular" — nested INSTANCE children use Inter |
| 37 | create | OK | Frame-only tree (no text/instances) — Header, Body, Footer |
| 38 | import_library_component | OK | Close IconButton → 3:2646 |
| 39 | import_library_component | OK | ComboboxControl → 3:2653 |
| 40 | import_library_component | OK | InputControl (Action Field) → 3:2667 |
| 41 | import_library_component | OK | InputControl (Data Attribute) → 3:2681 |
| 42 | import_library_component | OK | Cancel Button → 3:2695 |
| 43 | import_library_component | OK | Save Button → 3:2704 |
| 44 | **create** | **ERROR** | Font error: "Inter Regular" — tried to create TEXT with SF Pro but default font is Inter |
| 45 | **create** | **ERROR** | Font error again: tried "Inter Semi Bold" — style name wrong |
| 46 | create | OK | TEXT with fontFamily: "Inter", fontStyle: "Regular" — succeeded |
| 47 | ToolSearch | OK | 1 tool: reorder_children |
| 48 | reorder_children | OK | Title before Close in Header |
| 49 | scan_text_nodes | OK | 11 text nodes in modal |
| 50 | set_multiple_text_contents | OK | 10 text overrides |
| 51 | apply | OK | 3 nodes: layoutSizingHorizontal FILL |
| 52 | get | OK | Modal structure depth 2 — check layout |
| 53 | apply | OK | 3 nodes: Header/Footer HUG + Title font change |
| 54 | search_library_components | OK | "close" — 4 results |
| 55 | get | OK | Modal structure depth 3 — verify tree |
| 56 | ToolSearch | OK | 1 tool: lint_design |
| 57 | lint_design | OK | "No local variables" — wasted call |
| 58 | get_design_system | OK | Empty result |
| 59 | get_library_variables | **ERROR** | 403 Forbidden — Enterprise-only [AGENT-008] |
| 60 | get | OK | Modal full depth 1 — check fills |
| 61 | import_library_component | OK | Re-import reference Modal for variable inspection |
| 62 | get | OK | Reference Modal full depth 3 — extract variable IDs |
| 63 | **apply** | **ERROR** | Validation: "fontWeight" not a valid variable field |
| 64 | apply | OK | 5 nodes: variable bindings (removed fontWeight) — 4/5 succeeded, fontSize unsupported on plugin |
| 65 | apply | OK | 3 nodes: transparent fills on inner frames |
| 66 | delete_node | OK | Removed reference modal 3:2716 |
| 67 | get | OK | Full audit depth 2 |
| 68 | apply | OK | 3 nodes: layout adjustments |
| 69 | apply | OK | 2 nodes: text style + footer padding variable |
| 70 | get | OK | Title full depth 0 — verify text style |
| 71 | get | OK | Header full depth 0 — verify variables |
| 72 | get | OK | Footer full depth 0 — verify variables |
| 73 | apply | OK | 3 nodes: clear transparent fills |
| 74 | apply | OK | 3 nodes: bind white fill variable to inner frames |
| 75 | get | OK | Final full audit depth 2 |
| 76 | lint_design | OK | "No local variables" — wasted call (same result as #57) |
| 77 | get | OK | Final filtered full audit |

## Efficiency Issues

### 1. Font error retry storm (3 wasted calls)

Calls #36, #44, #45 — three `create` failures due to font loading errors. The first attempted a nested tree with INSTANCE children (which have Inter font). The second and third tried creating a TEXT node with font style names that didn't match ("SF Pro Semibold", then "Inter Semi Bold").

**Pattern**: Create with embedded TEXT/INSTANCE nodes that use fonts not yet loaded in the plugin.

**Root cause**: The `create` tool doesn't pre-load fonts for library instance children. When a TEXT node is created, the default font (Inter Regular) must be explicitly specified or the node needs to match what's available.

**Proposed fix**: The `create` tool should auto-load the target font before calling `set_characters`. Or the agent skill should document that TEXT nodes in `create` must use "Inter Regular" as the base, then `apply` font changes afterward.

**Estimated savings**: 2 calls (1 valid retry to learn the pattern).

### 2. Delete-recreate cycle (5+ wasted calls)

Calls #15-19: Imported Modal, customized it, then deleted it (#35) because instance children couldn't be replaced with custom form fields. Rebuilt from scratch (#37-43). Then re-imported the same Modal (#61) just to inspect its variable bindings, then deleted it again (#66).

**Pattern**: Import library component → discover it doesn't support needed customization → delete → rebuild manually → re-import to copy token bindings → delete.

**Root cause**: Agent didn't know upfront that instance children can't be replaced. The variable binding inspection required a reference instance.

**Proposed fix**:
- Agent skill should document: "Library instances have fixed internal structure. If you need custom body content, build manually with library sub-components."
- Consider a tool that can extract variable bindings from a library component without importing it.

**Estimated savings**: ~5 calls (initial Modal import + customization + first delete could be skipped).

### 3. Duplicate lint_design calls (2 wasted calls)

Calls #57 and #76 both returned "No local variables found in this file." The second call was identical to the first — same node, same result.

**Pattern**: Repeated lint on a file with no local variables, hoping the result would change.

**Root cause**: Agent didn't internalize that `lint_design` only checks against local variables, not library variables. After seeing the result once, it should not have retried.

**Estimated savings**: 2 calls.

### 4. Redundant get calls on same node (3+ wasted calls)

Node `3:2642` (Block Action Modal) was inspected 6 times with `get`:
- #52: layout, depth 2
- #55: structure, depth 3
- #60: full, depth 1
- #67: full, depth 2
- #75: full, depth 2
- #77: full, depth 2 (with filter)

Calls #67, #75, and #77 were all full-detail verification passes. Only one final verification should be needed.

**Root cause**: Agent was iteratively fixing issues and re-checking after each fix instead of batching fixes and doing one final verification.

**Estimated savings**: ~3 calls.

### 5. Sequential library search (2 wasted calls)

Calls #22 ("select control") and #23 ("text input") returned 0 results — wrong search terms. The agent should have searched for the WordPress component names directly ("ComboboxControl", "InputControl") from the start.

**Root cause**: Agent tried generic UX terms before trying the specific component names it already knew from the block-actions plugin exploration.

**Estimated savings**: 2 calls.

### 6. scan_text_nodes instead of find [AGENT-007]

Calls #18 and #49 used `scan_text_nodes` instead of `find` with `type: ["TEXT"]`. The `find` tool is the recommended replacement.

**Impact**: Minor — `scan_text_nodes` still works, just not the preferred path.

### 7. get_library_variables 403 fail-fast [AGENT-008]

Call #59 hit a 403 Forbidden on the variables REST API (Enterprise-only). This is a known issue — the agent should know to skip this call on non-Enterprise plans.

**Estimated savings**: 1 call.

### 8. ToolSearch overhead [TOOL-005]

9 ToolSearch calls = 11.7% of total. Better than session 10's 21.7%. Good batching (calls #1, #4, #5, #17, #33 fetched 2-4 tools each). However, calls #7, #34, #47, #56 each fetched only 1 tool — these could have been anticipated and batched earlier.

**Estimated savings**: ~3-4 calls if tools were pre-loaded more aggressively.

## Error Analysis

### 1. Font loading on create (3 failures, ~30 seconds lost)

Calls #36, #44, #45. The `create` tool fails when nested nodes use fonts that aren't loaded.

**Agent recovery**: Good — adapted strategy to create frame-only tree first, then import library instances separately, then create text with explicit Inter Regular.

### 2. Invalid variable field: fontWeight (1 failure, ~5 seconds lost)

Call #63. `fontWeight` is not in the allowed enum for `variables` field on `apply`. The error message was clear and recovery was immediate.

**Agent recovery**: Removed `fontWeight` and retried successfully.

### 3. 403 on get_library_variables (1 failure, ~3 seconds lost)

Call #59. Enterprise-only API endpoint.

**Agent recovery**: Pivoted to inspecting a reference instance to extract variable IDs.

## What Worked Well

1. **Comprehensive variable binding workflow.** Imported a reference Modal to extract all WPDS variable IDs, then systematically applied them to every manually-created node. Final audit showed 100% tokenization.

2. **Batched apply calls.** Most `apply` calls targeted 3-5 nodes simultaneously. Good use of the batch capability.

3. **Sub-agent delegation.** Used `Agent` tool to explore the block-actions WordPress plugin without polluting the main context. 2 sub-agent calls returned dense summaries efficiently.

4. **Library component discovery.** Systematic search for WPDS components (modal, button, combobox, input) with variant exploration before importing.

5. **Clean teardown.** Deleted temp instances promptly. No orphaned nodes left on the canvas.

6. **Good error recovery.** Font errors led to a better strategy (frame-first, then populate). Variable field errors were fixed in 1 retry.

7. **Efficient text operations.** `set_multiple_text_contents` with 4 and 10 nodes respectively — proper batching.

## Waste Summary

| Category | Wasted Calls | Est. Savings |
|---|---|---|
| Font error retries | 2 | 2 calls |
| Delete-recreate cycle | ~5 | 5 calls |
| Duplicate lint_design | 2 | 2 calls |
| Redundant get inspections | ~3 | 3 calls |
| Failed library searches | 2 | 2 calls |
| Single-tool ToolSearch | ~3 | 3 calls |
| 403 get_library_variables | 1 | 1 call |
| **Total** | **~18** | **~18 calls (23%)** |

Effective calls: ~59 out of 77. **Waste: ~23%.**

## Known Issues Observed

| Issue ID | Description | Calls Affected |
|---|---|---|
| [TOOL-005] | ToolSearch overhead | #1, #4, #5, #7, #17, #33, #34, #47, #56 |
| [AGENT-007] | scan_text_nodes instead of find | #18, #49 |
| [AGENT-008] | 403 fail-fast on Enterprise endpoints | #59 |
| NEW: [AGENT-009] | Repeated lint_design on file with no local variables | #57, #76 |
| NEW: [TOOL-011] | Font loading fails on create with nested instances | #36 |
| NEW: [AGENT-010] | Delete-recreate cycle when instance customization is limited | #15-19, #35, #61, #66 |

## Priority Improvements

### Agent Skill Updates

1. **Document instance customization limits** — Agent skill should state: "Library instances have fixed child structure. If custom body content is needed, build frame skeleton manually and import library sub-components individually."

2. **Cache lint_design result** — If `lint_design` returns "no local variables", don't call it again in the same session.

3. **Skip get_library_variables on non-Enterprise** — Add to agent skill: "The variables REST API requires Enterprise plan. Use reference instance inspection as fallback."

4. **Pre-load more tools** — Include `reorder_children`, `delete_multiple_nodes`, `lint_design` in early ToolSearch batches since they're commonly needed.

### Tool Changes

1. **Font pre-loading in create** [TOOL-011] — The `create` tool should auto-load fonts needed by the TEXT node spec before setting characters, or at minimum auto-load "Inter Regular" as the default font.

2. **Variable binding extraction tool** — A tool to read variable bindings from a library component without importing an instance would eliminate the import-inspect-delete pattern.
