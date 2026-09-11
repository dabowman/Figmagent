# Figma MCP Session 5 Analysis

## Session Overview

- **Transcript**: `69ba78e1-906b-4f0d-a843-fa0238fe5d40.json`
- **Duration**: ~139 minutes
- **Total tool calls**: 259
- **Total errors**: 3
- **Reconnections**: ~8 (14 `join_channel` calls minus initial joins)
- **Context restarts**: 0
- **Task**: Build multi-screen mobile app (Login, Map, Listing Detail) + 3 component sets (Button, Input Field, Status Badge) + full design system with variable binding

## Metrics

| Metric | Session 4 | Session 5 | Change |
|---|---|---|---|
| Total tool calls | 56 | 259 | +362% (much larger task) |
| Figma MCP calls | 48 | 224 | +367% |
| ToolSearch calls | 8 (14.3%) | 35 (13.5%) | Similar % |
| Errors | 2 (3.6%) | 3 (1.2%) | Improved rate |
| Estimated waste % | ~12% | ~23.6% | Regressed |
| Nodes created | 79 | ~120+ | +52% |

## Tool Call Distribution

| Tool | Calls | Notes |
|---|---|---|
| `get_node_tree` | 37 | Heaviest tool. Legacy name for `get`. Multiple re-inspections. |
| `ToolSearch` | 35 | 13.5% overhead. ~20 wasted (re-discovering same tools). |
| `apply` | 25 | Good batching — text styles + variable bindings combined. |
| `create` | 21 | ~120+ nodes. 39-node Listing Detail in 1 call. |
| `join_channel` | 14 | ~8 reconnections (6 wasted calls). |
| `lint_design` | 12 | Per-component linting (no PAGE node support yet). |
| `set_layout_sizing` | 9 | Legacy tool — should use `apply`. |
| `get_document_info` | 8 | Repeated discovery. |
| `get_design_system` | 7 | Multiple re-reads of design system. |
| `delete_node` | 6 | Cleanup of failed/stray nodes. |
| `combine_as_variants` | 5 | 3 component sets + 2 retries. |
| `rename_node` | 5 | Renaming COMPONENT_SETs after combine. |
| `create_variables` | 4 | Colors + Scales collections. |
| `bind_variable` | 3 | Legacy — should use `apply` with `variables`. |
| `set_text_style` | 3 | Legacy — should use `apply` with `textStyleId`. |
| Other (misc) | 65 | Various other tools. |

## Efficiency Issues

### 1. ToolSearch overhead (saves ~20 calls)

35 ToolSearch calls (13.5%) with significant re-discovery. The agent fetched the same tools multiple times across the session, especially after reconnections.

**Pattern observed:** ToolSearch for `create` appeared 5+ times. Same for `apply`, `get_node_tree`, `combine_as_variants`.

**Root cause:** Each reconnection loses tool schema cache. Agent re-discovers incrementally instead of pre-loading a comprehensive set.

**Estimated savings:** ~20 calls if tools were pre-loaded at session start and after reconnections.

### 2. Legacy individual tools instead of `apply` (saves ~16 calls)

9 `set_layout_sizing` calls, 3 `bind_variable` calls, 3 `set_text_style` calls, and 1 `set_fill_color` call — all of which can be done through `apply`.

**Pattern observed:** `set_layout_sizing(nodeId, "FILL")` called 9× sequentially. These could be a single `apply` call with `layoutSizingHorizontal`/`layoutSizingVertical` on multiple nodes.

**Root cause:** The agent used older tool names that were still available but superseded by `apply`. The MCP server kept them for backward compatibility.

**Proposed fix:** Add deprecation notices to legacy tool descriptions pointing to `apply`. Eventually remove them.

**Estimated savings:** ~16 calls → ~2-3 `apply` calls.

### 3. Reconnection overhead (saves ~6 calls)

14 `join_channel` calls indicate ~8 reconnections during the 139-minute session. Each reconnection triggers ToolSearch re-discovery.

**Root cause:** Long session with WebSocket drops. Plugin connection breaks silently, requiring manual `join_channel`.

**Estimated savings:** ~6 calls (reconnections themselves are necessary, but ToolSearch re-discovery after each is avoidable).

### 4. Delete-recreate cycles for font changes (saves ~10 calls)

Agent deleted and recreated TEXT nodes to change font properties instead of using `apply` with font properties.

**Pattern observed:** `delete_node(textId)` → `create(TEXT, new font)` instead of `apply(textId, { fontFamily: "...", fontWeight: ... })`.

**Root cause:** Agent behavior — not aware that `apply` handles font changes without recreation. CLAUDE.md documents this but the agent didn't follow.

**Estimated savings:** ~10 calls (5 delete-recreate pairs → 5 `apply` calls).

### 5. Redundant get_design_system calls (saves ~4 calls)

7 `get_design_system` calls — the design system was re-read multiple times, likely after reconnections or context loss.

**Estimated savings:** ~4 calls (cache the result, only re-read after variable/style creation).

## Error Analysis

### 1. FILL sizing on root component (1 failure, ~5 seconds)

Same pattern as session 4 — attempted FILL on a root node without auto-layout parent.

**Agent recovery:** Immediate — switched to FIXED.

### 2. Font loading failure (1 failure, ~10 seconds)

Text node creation failed due to font not loaded. Agent retried with explicit font loading.

### 3. Variable binding on wrong node type (1 failure, ~5 seconds)

Attempted to bind a color variable to a node without fills. Agent skipped and moved on.

## What Worked Well

1. **39-node Listing Detail in 1 `create` call.** Complex nested tree with header, image, details section, amenities grid, and action bar — all in a single create.

2. **`apply` batching for variable bindings.** 25 `apply` calls handled text styles + variable bindings combined — massive improvement over Session 2's 132 individual `bind_variable` calls.

3. **lint_design audit workflow.** Systematic lint → create missing variables → rebind → re-lint cycle across all components.

4. **3 component sets with proper variant architecture.** Button (6 variants), Input Field (4 variants), Status Badge (3 variants) — all with correct `Variant=Value` naming and `combine_as_variants`.

5. **Low error rate (1.2%).** Only 3 errors across 259 calls — best error rate of any session.

## Priority Improvements

### Tool Changes (ranked by call savings)

1. **Deprecate legacy tools** — Add deprecation notices to `set_layout_sizing`, `bind_variable`, `set_text_style`, `set_fill_color` pointing to `apply`. Saves ~16 calls/session. P1.

2. **ToolSearch pre-loading** — After reconnection, auto-fetch all previously-used tool schemas. Saves ~20 calls across long sessions. P1.

### Agent Skill Updates

1. **Never delete-recreate TEXT nodes for font changes** — Use `apply` with font properties. Already in CLAUDE.md but not followed.

2. **Cache `get_design_system` results** — Only re-read after `create_variables`, `create_styles`, `update_variables`, or `update_styles`.
