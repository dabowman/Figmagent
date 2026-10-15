# Figma MCP Session 4 Analysis

## Session Overview

- **Transcript**: `a7bfeab5-b68f-470a-9525-facd4b09619e.json`
- **Duration**: ~20 minutes active (23:44–00:04 UTC), 987 min wall clock with long idle tail
- **Total tool calls**: 56
- **Total errors**: 2 (1 validation error + 1 Figma API error on FILL sizing)
- **Reconnections**: 0
- **Context restarts**: 0
- **Task**: Build 5 UI components (Card, Data Table, Alert 4-variant COMPONENT_SET, Navbar, Button 6-variant COMPONENT_SET) from scratch on a blank page, fully tokenized with design variables

## Metrics

| Metric | Session 2 | Session 3 | Session 4 | Change (2→4) |
|---|---|---|---|---|
| Total tool calls | 389 | 160 (dev) | 56 | -86% |
| Figma MCP calls | 325 | 0 | 48 | N/A (different tasks) |
| Meta/overhead calls | 64 | 160 | 8 | -88% |
| ToolSearch calls | 28 (7.2%) | 0 | 8 (14.3%) | Higher % but lower absolute |
| Errors | 14 (3.6%) | 10 | 2 (3.6%) | Same rate |
| Nodes created | 41 | 0 | 79 | +93% |
| Estimated waste % | ~17.7% | ~18% | ~12% | Improved |

## Tool Call Distribution

| Tool | Calls | Notes |
|---|---|---|
| `create` | 14 | Built 79 nodes across 14 calls (~5.6 nodes/call avg). 4 alert variants sequential (could batch). |
| `apply` | 12 | Applied styles/variables to 93 nodes total. Good batching — 21 nodes in one call. |
| `lint_design` | 9 | 4+4 sequential lint runs (per-component). 1 wasted PAGE-level lint. |
| `ToolSearch` | 8 | 14.3% of calls. Fetched tools incrementally as needed. |
| `get_document_info` | 2 | 1 initial + 1 to verify after stray node detected. |
| `combine_as_variants` | 2 | Alert (4 variants) + Button (6 variants). |
| `rename_node` | 2 | Renamed COMPONENT_SETs after combine_as_variants. |
| `create_variables` | 2 | Created Scales collection (14 vars) + text/on-accent color. |
| `component_properties` | 2 | Button: added Show Icon (BOOLEAN) + Label (TEXT) properties. |
| `get_design_system` | 1 | Initial design system discovery — clean. |
| `delete_node` | 1 | Cleaned up stray Navbar from failed create. |
| `update_styles` | 1 | Bound fontSize/sm variable to both text styles. |

## Efficiency Issues

### 1. Sequential alert variant creation (saves ~3 calls)

4 alert variant components were created sequentially (`create` × 4), each with identical structure but different colors. These could potentially be created in parallel or as a single batched operation.

**Pattern observed:** `create(Variant=Info)` → `create(Variant=Success)` → `create(Variant=Warning)` → `create(Variant=Error)`, each identical 6-node tree structure.

**Root cause:** The `create` tool accepts one node tree per call. There's no batch-create for multiple top-level nodes. Same pattern for Button (6 sequential creates).

**Proposed fix:** Add multi-root support to `create` — accept an array of node specs, create all in parallel. Saves ~3 calls for 4 variants, ~5 calls for 6 variants.

**Estimated savings:** ~8 calls for this session (4 alert + 6 button → 2 calls).

### 2. Per-component lint instead of full-page lint (saves ~6 calls)

`lint_design` on the PAGE node (`0:1`) returned 0 nodes scanned — the tool doesn't traverse PAGE children. The agent then had to lint each component individually (4 lint calls for initial audit + 3 for re-verification after fixes).

**Pattern observed:** `lint_design(0:1)` → 0 nodes → `get_document_info` → `lint_design(1:64)` → `lint_design(1:68)` → `lint_design(1:116)` → `lint_design(1:126)`.

**Root cause:** Plugin bug — `lint_design` doesn't handle PAGE nodes. It should traverse the page's children automatically.

**Proposed fix:** In the plugin's lint handler, detect PAGE node type and iterate over its direct children, aggregating results. One `lint_design(0:1)` call should cover the entire page.

**Estimated savings:** ~6 calls (7 individual lints → 1 page-level lint + 1 re-verify).

### 3. ToolSearch overhead (saves ~4 calls)

8 ToolSearch calls (14.3%) to fetch tools incrementally. Tools were fetched in 6 separate rounds: initial batch of 4, then individual fetches for `combine_as_variants`, `rename_node`, `lint_design`, `create_variables`+`delete_node`, `update_styles`, `component_properties`.

**Pattern observed:** Each new task phase required fetching 1-2 more tool schemas. The initial ToolSearch fetched 4 tools but missed several that were needed later.

**Root cause:** The agent discovered tools as needed rather than pre-loading all likely tools upfront.

**Proposed fix:** Fetch a comprehensive initial batch of ~10 tools covering the common workflow: `create`, `apply`, `get`, `get_document_info`, `get_design_system`, `combine_as_variants`, `rename_node`, `lint_design`, `create_variables`, `component_properties`. This would eliminate 4-5 subsequent ToolSearch calls.

**Estimated savings:** ~4-5 calls.

### 4. `fontSize` variable binding not supported in `apply` (saves ~1 call + avoids error)

The agent tried `variables: { fontSize: "VariableID:1:149" }` on text nodes, which failed because `fontSize` is not in the allowed variable binding enum. The agent recovered well — found `update_styles` to bind fontSize at the style level instead.

**Pattern observed:** `apply` with `fontSize` binding → validation error → `update_styles` with `fontSize` binding on text styles → success.

**Root cause:** The `variables` field in `apply` only supports a subset of bindable fields. `fontSize` is missing from the Zod enum despite being a valid Figma variable binding target.

**Proposed fix:** Add `fontSize`, `fontFamily`, `fontStyle`, `lineHeight`, `letterSpacing`, `paragraphSpacing`, `paragraphIndent` to the variable binding enum in `apply`. These are valid `setBoundVariable` targets in the Figma API.

**Estimated savings:** ~1 wasted call + 1 error per session. Enables direct binding without `update_styles` workaround.

## Error Analysis

### 1. FILL sizing on root component (1 failure, ~5 seconds lost)

Navbar create specified `layoutSizingHorizontal: "FILL"` on the root component, which has no auto-layout parent at creation time. Error: "FILL can only be set on children of auto-layout frames."

**Agent recovery:** Excellent — immediately identified the issue, switched to `FIXED` width, and retried. This is a well-documented pattern in CLAUDE.md but the agent still attempted FILL first.

**Fix needed:** None — the `create` tool already handles FILL sizing in a second pass for children. The agent should use FIXED for root-level components (already documented).

### 2. fontSize variable binding rejected (1 failure, ~5 seconds lost)

`apply` with `variables: { fontSize: "VariableID:1:149" }` rejected by Zod validation. Error: "Invalid enum value. Expected 'fill' | 'stroke' | ... | 'characters', received 'fontSize'."

**Agent recovery:** Good — immediately pivoted to `update_styles` to bind fontSize at the text style level instead. This is actually a better approach (binds at style level, propagates to all users of the style).

**Fix needed:** Add `fontSize` and other text property fields to the variable binding enum (see Efficiency Issue #4).

## What Worked Well

1. **Massive batching with `apply`.** 21 nodes styled in a single `apply` call for the Data Table — text styles + variable bindings for all header cells, body cells, dividers, and backgrounds. Zero follow-up calls needed. Session 2 would have needed ~70+ individual `bind_variable` + `set_text_style` calls for the same work.

2. **Nested tree creation with `create`.** 24-node Data Table built in 1 call (header row + 3 data rows + 3 dividers, each with 4 text cells). The alert variants each packed 6 nodes per create. Total: 79 nodes in 14 calls (~5.6 nodes/call).

3. **lint→create_variables→apply→re-lint workflow.** The agent used `lint_design` to audit all components, identified missing variable categories (spacing, radius, fontSize), created them with `create_variables`, bound them with `apply`, then re-linted to verify. Clean, systematic approach.

4. **Cleanup discipline.** Detected and deleted the stray Navbar (`1:117`) left from the failed FILL-sizing creation. Checked `get_document_info` to verify page state.

5. **Smart error recovery.** Both errors were handled in 1 attempt each — no retry storms, no cascading failures. The `fontSize` binding rejection led to the better approach of binding at the style level.

6. **Zero reconnections.** The entire 20-minute active session ran without a single WebSocket drop or `join_channel` call. Auto-join worked perfectly.

## Priority Improvements

### Tool Changes (ranked by call savings)

1. **`lint_design` PAGE node support** — Traverse page children when nodeId is a PAGE node. Saves ~6 calls per session with full-page audits. P1.

2. **Multi-root `create`** — Accept array of node specs for batch creation. Saves ~8 calls when building variant component sets. P2.

3. **`fontSize` in `apply` variable binding enum** — Add text property fields (fontSize, fontFamily, fontStyle, lineHeight, letterSpacing, paragraphSpacing, paragraphIndent) to the variable binding Zod enum. Saves ~1 call + 1 error. P2.

### Agent Skill Updates

1. **Pre-load comprehensive tool set** — Initial ToolSearch should fetch 10+ tools covering the full design workflow, not just the first 4. Saves ~4 ToolSearch calls.

2. **Use FIXED for root components** — Despite CLAUDE.md documentation, the agent still attempted FILL on a root component. Reinforce in skill/prompt.
