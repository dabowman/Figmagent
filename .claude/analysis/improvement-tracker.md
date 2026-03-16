# Figmagent Improvement Tracker

Last updated: 2026-03-16
Sessions analyzed: 9

## Active Issues

### [TOOL-001] bind_variable needs batch version
- **Status**: verified
- **Priority**: P0
- **Category**: missing-batch-tool
- **First seen**: Session 2 (2026-03-06)
- **Sessions affected**: 2, 5
- **Estimated savings**: ~120 calls/session
- **Description**: 132 individual `bind_variable` calls dominated session 2. Longest uninterrupted run was 28 consecutive calls. Agent groups conceptually but has no batch tool to execute.
- **Current status**: Implemented via `apply` tool with `variables` field — accepts map of field→variableId for design token bindings on one or many nodes.
- **Verified in**: Session 4 — agent bound 93 nodes across 12 `apply` calls with zero individual bind_variable usage.
- **Note**: Session 5 still used 3 legacy `bind_variable` calls (predates `apply` consolidation).

### [TOOL-002] set_text_style needs batch version
- **Status**: verified
- **Priority**: P0
- **Category**: missing-batch-tool
- **First seen**: Session 2 (2026-03-06)
- **Sessions affected**: 2, 5
- **Estimated savings**: ~45 calls/session
- **Description**: 55 individual `set_text_style` calls. Agent applies same style to 9+ nodes at a time.
- **Current status**: Implemented via `apply` tool with `textStyleId` field — deduplicates font loading across multiple nodes automatically.
- **Verified in**: Session 4 — text styles applied via `apply` in batch, zero individual set_text_style calls.
- **Note**: Session 5 still used 3 legacy `set_text_style` calls.

### [BUG-001] set_text_style sync/async bug
- **Status**: verified
- **Priority**: P0
- **Category**: plugin-bug
- **First seen**: Session 2 (2026-03-06)
- **Sessions affected**: 2
- **Estimated savings**: 12 calls + ~5 minutes per occurrence
- **Description**: `set_text_style` handler used sync `textStyleId` setter, fails with `documentAccess: dynamic-page`. Needs `setTextStyleIdAsync`. 9 failed calls + 3 code fix attempts in session 2.
- **Fix pattern**: sync-to-async
- **Current status**: Fixed — async API used throughout plugin code.
- **Verified in**: Session 4 — zero sync/async errors across all text style operations.

### [TOOL-003] get_local_components output too large
- **Status**: implemented
- **Priority**: P1
- **Category**: missing-tool
- **First seen**: Session 2 (2026-03-06)
- **Sessions affected**: 2
- **Estimated savings**: avoids context overflow
- **Description**: Response was 107,546 characters, exceeding token limit. Agent tried Bash/Python parsing workarounds.
- **Current status**: Implemented via output budget system — 30K char default, `maxOutputChars` parameter to adjust. `preferredValues` arrays stripped from instance `componentProperties`.

### [TOOL-004] get_node_info default depth too shallow
- **Status**: implemented
- **Priority**: P1
- **Category**: agent-behavior
- **First seen**: Session 1 (2026-03-05)
- **Sessions affected**: 1, 2
- **Estimated savings**: ~15-29 redundant re-inspections per session
- **Description**: Agent inspects at depth=1 then needs depth=2 later. 22 nodes queried more than once in session 2.
- **Current status**: CLAUDE.md now instructs "Always start with detail=structure and depth=2" and the `get` tool enforces this guidance.
- **Verified in**: Session 4 — zero `get` calls needed for re-inspection (creation-focused session).

### [TOOL-005] ToolSearch overhead
- **Status**: identified
- **Priority**: P1
- **Category**: infrastructure
- **First seen**: Session 1 (2026-03-05)
- **Sessions affected**: 1, 2, 4, 5, 6, 7, 9
- **Estimated savings**: ~20-33 calls/session (long sessions), ~2-8 calls/session (short sessions)
- **Description**: Agent rediscovers same tools repeatedly. 33 calls in session 1 (10.7%), 28 in session 2 (7.2%), 35 in session 5 (13.5%), 8 in session 4 (14.3%), 3 in session 6 (4.4%), 2 in session 7 (8.3%), 7 in session 9 (43.8% — worst ratio, dominated a short exploration session). Worst after reconnections or in short sessions where overhead ratio is high.
- **Proposed fix**: Pre-load tool schemas at session start; auto-restore after reconnections; add complete tool reference to skill file.

### [AGENT-001] Fail fast on repeated identical errors
- **Status**: verified
- **Priority**: P1
- **Category**: agent-behavior
- **First seen**: Session 2 (2026-03-06)
- **Sessions affected**: 2
- **Description**: Agent fired 7 more identical `set_text_style` calls after first 2 failures. Should stop after 2 and tell user.
- **Current status**: CLAUDE.md now includes "After 2 consecutive identical errors on the same tool, stop retrying and diagnose the root cause".
- **Verified in**: Session 4 — both errors recovered in exactly 1 retry each.

### [AGENT-002] After 2 timeouts assume disconnection
- **Status**: verified
- **Priority**: P1
- **Category**: agent-behavior
- **First seen**: Session 2 (2026-03-06)
- **Sessions affected**: 2
- **Description**: 5 consecutive timeout calls before escalating. 30s per call = ~2.5 minutes wasted.
- **Current status**: CLAUDE.md now includes "After 2 timeouts in a row, assume the WebSocket connection is lost — call join_channel to re-establish before retrying".
- **Verified in**: Session 4 — zero timeouts observed.

### [TOOL-006] Type coercion for tool parameters
- **Status**: identified
- **Priority**: P1
- **Category**: type-coercion
- **First seen**: Session 1 (2026-03-05)
- **Sessions affected**: 1
- **Estimated savings**: eliminates cascading error batches (8 errors from 2 root causes in session 1)
- **Description**: Agent passes `"4"` instead of `4` for radius, `"0.85"` instead of `0.85` for colors. When one call in parallel batch errors, all parallel calls cancelled.
- **Fix pattern**: type-coercion
- **Auto-fixable**: yes (add `toNumber()` coercion or Zod `.transform(Number)`)

### [INFRA-001] Channel reconnection tax
- **Status**: mixed
- **Priority**: P2
- **Category**: infrastructure
- **First seen**: Session 1 (2026-03-05)
- **Sessions affected**: 1, 2, 5
- **Description**: 8 reconnections in session 1 consuming ~40+ overhead calls. Session 5 had ~8 reconnections (14 `join_channel` calls) over 139 minutes. Short sessions (4, 6, 7) had zero.
- **Current status**: Auto-join improved for short sessions. Long sessions (>1hr) still experience WebSocket drops requiring manual `join_channel`. Each reconnection triggers ToolSearch re-discovery overhead.
- **Verified in**: Sessions 4, 6, 7 — zero reconnections in short sessions.

### [AGENT-003] Verify instance vs component before modifying
- **Status**: implemented
- **Priority**: P2
- **Category**: agent-behavior
- **First seen**: Session 1 (2026-03-05)
- **Sessions affected**: 1
- **Description**: Agent modified INSTANCE instead of COMPONENT_SET. Wasted planning work on wrong node.
- **Current status**: CLAUDE.md key patterns now document instance vs component handling. `get` returns `componentRef` in `defs.components` for instances.

### [TOOL-007] Composite create tool
- **Status**: verified
- **Priority**: P0
- **Category**: missing-tool
- **First seen**: Session 1 (2026-03-05)
- **Sessions affected**: 1
- **Estimated savings**: ~104 calls (create_frame + set_layout_sizing were #1 and #2 most-called tools)
- **Current status**: `create` tool handles single nodes, nested trees, components, and instances. FILL sizing applied in second pass.
- **Verified in**: Session 2, Session 4 (79 nodes in 14 calls), Session 5 (39-node tree in 1 call)

### [TOOL-008] reorder_children tool
- **Status**: implemented
- **Priority**: P1
- **Category**: missing-tool
- **First seen**: Session 1 (2026-03-05)
- **Sessions affected**: 1
- **Description**: Agent had to delete and recreate nodes just to change ordering.
- **Current status**: `reorderChildren` command exists in modify.js.
- **Verified in**: Session 2 (no delete-recreate cycles observed for ordering)

### [TOOL-009] read_my_design response too large
- **Status**: implemented
- **Priority**: P1
- **Category**: missing-tool
- **First seen**: Session 1 (2026-03-05)
- **Sessions affected**: 1
- **Description**: `read_my_design` returned 309,417 characters. Forced complex chunked-reading with bash/python scripts.
- **Current status**: `get` tool with detail levels (structure/layout/full) and depth parameter. Output budget system caps at 30K chars by default.

### [INFRA-002] extract-sessions.ts hardcoded session path
- **Status**: implemented
- **Priority**: P2
- **Category**: infrastructure
- **First seen**: Session 3 (2026-03-14)
- **Sessions affected**: 3
- **Description**: `extract-sessions.ts` had a hardcoded macOS session directory path. Also `--latest` flag required a value argument.
- **Current status**: Fixed — auto-detects session directory from CWD, pre-processes `--latest` to accept bare flag.
- **Verified in**: Session 4 — extraction ran successfully to produce JSON transcript.

### [AGENT-004] Subagent context duplication
- **Status**: identified
- **Priority**: P2
- **Category**: agent-behavior
- **First seen**: Session 3 (2026-03-14)
- **Sessions affected**: 3
- **Estimated savings**: ~15-20 redundant reads/session
- **Description**: Agent subagents re-read files that the parent session already read. Not fully solvable for long idle gaps.
- **Proposed fix**: Provide key file contents or summaries in subagent prompts to reduce redundant reads.

### [BUG-002] lint_design doesn't traverse PAGE nodes — [#3](https://github.com/dabowman/Figmagent/issues/3) closed
- **Status**: implemented
- **Priority**: P1
- **Category**: plugin-bug
- **First seen**: Session 4 (2026-03-14)
- **Sessions affected**: 4, 5
- **Estimated savings**: ~6-12 calls/session
- **Description**: `lint_design(nodeId: "0:1")` returned 0 nodes scanned. Agent had to lint each component individually.
- **Current status**: Fixed in `743d11c` — `collectNodes` now handles PAGE nodes.
- **Note**: Session 5 also did per-component linting (12 calls, predates fix).

### [TOOL-010] Multi-root create for batch variant building — [#4](https://github.com/dabowman/Figmagent/issues/4) / [PR #7](https://github.com/dabowman/Figmagent/pull/7)
- **Status**: implemented (PR #7)
- **Priority**: P2
- **Category**: missing-tool
- **First seen**: Session 4 (2026-03-14)
- **Sessions affected**: 4, 5
- **Estimated savings**: ~8 calls/session when building variant sets
- **Description**: 4 alert variants created sequentially (4 calls), 6 button variants created sequentially (6 calls). Session 5 had similar pattern.
- **Current status**: PR #7 adds `nodes` array parameter to `create` tool.

### [BUG-003] apply variable binding enum missing fontSize and text properties — [#5](https://github.com/dabowman/Figmagent/issues/5) / [PR #6](https://github.com/dabowman/Figmagent/pull/6)
- **Status**: implemented (PR #6)
- **Priority**: P2
- **Category**: plugin-bug
- **First seen**: Session 4 (2026-03-14)
- **Sessions affected**: 4
- **Estimated savings**: ~1 call + 1 error per session
- **Description**: `apply` with `variables: { fontSize: "VariableID:..." }` rejected by Zod validation. Missing 7 text property fields.
- **Current status**: PR #6 adds fontSize, fontFamily, fontStyle, lineHeight, letterSpacing, paragraphSpacing, paragraphIndent to both Zod enum and FIELD_MAP.

### [TOOL-011] Legacy tools not deprecated in descriptions — [#8](https://github.com/dabowman/Figmagent/issues/8) closed
- **Status**: resolved (already done)
- **Priority**: P1
- **Category**: agent-behavior
- **First seen**: Session 5 (2026-03-12)
- **Sessions affected**: 5
- **Estimated savings**: ~16 calls/session
- **Description**: Session 5 used 9 `set_layout_sizing`, 3 `bind_variable`, 3 `set_text_style`, 1 `set_fill_color` — all superseded by `apply`. The legacy tools still exist for backward compat but have no deprecation notices in their descriptions.
- **Proposed fix**: Add "DEPRECATED: Use `apply` instead" to each legacy tool's description. Eventually remove them.

### [AGENT-005] Delete-recreate TEXT nodes instead of apply for font changes — [#9](https://github.com/dabowman/Figmagent/issues/9)
- **Status**: identified
- **Priority**: P1
- **Category**: agent-behavior
- **First seen**: Session 5 (2026-03-12)
- **Sessions affected**: 5
- **Estimated savings**: ~10 calls/session
- **Description**: Agent deleted and recreated TEXT nodes to change font properties instead of using `apply` with `fontFamily`/`fontWeight`. CLAUDE.md says "Never delete and recreate text nodes just to change their font" but the agent didn't follow.
- **Proposed fix**: Reinforce in tool descriptions and prompts. Add warning in `delete_node` tool description when target is a TEXT node.

### [AGENT-006] Use `find` instead of individual `get_annotations` for bulk discovery — [#10](https://github.com/dabowman/Figmagent/issues/10) closed
- **Status**: resolved (cross-reference already in description)
- **Priority**: P0
- **Category**: agent-behavior
- **First seen**: Session 6 (2026-03-13)
- **Sessions affected**: 6
- **Estimated savings**: ~49 calls/session
- **Description**: 51 individual `get_annotations` calls (75% of all calls in session 6) to find annotated nodes. `find(hasAnnotation: true)` would have done this in 1 call.
- **Proposed fix**: Add cross-reference to `find(hasAnnotation: true)` in the `get_annotations` tool description. Emphasize `nodeIds` batch support in description.

### [AGENT-007] Use `find` instead of `scan_nodes_by_types` for node discovery — [#11](https://github.com/dabowman/Figmagent/issues/11)
- **Status**: identified
- **Priority**: P1
- **Category**: agent-behavior
- **First seen**: Session 7 (2026-03-13)
- **Sessions affected**: 7
- **Estimated savings**: ~5 calls/session
- **Description**: `scan_nodes_by_types(INSTANCE)` returned 276K chars, overflowing to disk, then agent spent 4 calls processing the overflow. `find` with criteria would have returned targeted results within budget.
- **Proposed fix**: Add deprecation notice to `scan_nodes_by_types` description pointing to `find`. Already documented in CLAUDE.md but agent didn't follow.

## Resolved Issues

### [TOOL-001] bind_variable needs batch version
- **Resolved in**: Post-session 2 (apply tool with variables field)
- **Verified in**: Session 4

### [TOOL-002] set_text_style needs batch version
- **Resolved in**: Post-session 2 (apply tool with textStyleId field)
- **Verified in**: Session 4

### [BUG-001] set_text_style sync/async bug
- **Resolved in**: Post-session 2
- **Verified in**: Session 4

### [TOOL-007] Composite create tool
- **Resolved in**: Session 2
- **Original savings estimate**: ~104 calls
- **Actual improvement**: 79 nodes in 14 calls in session 4, 39-node tree in 1 call in session 5

### [TOOL-008] reorder_children tool
- **Resolved in**: Session 2
- **Verification**: No delete-recreate cycles observed for ordering in session 2

### [AGENT-001] Fail fast on repeated identical errors
- **Resolved in**: Post-session 2 (CLAUDE.md update)
- **Verified in**: Session 4 — both errors recovered in 1 attempt each

### [AGENT-002] After 2 timeouts assume disconnection
- **Resolved in**: Post-session 2 (CLAUDE.md update)
- **Verified in**: Session 4 — zero timeouts

### [AGENT-003] Verify instance vs component before modifying
- **Resolved in**: Post-session 2 (CLAUDE.md update)

### [INFRA-002] extract-sessions.ts hardcoded session path
- **Resolved in**: Session 3
- **Verified in**: Session 4

### [BUG-002] lint_design doesn't traverse PAGE nodes
- **Resolved in**: Session 4 analysis (commit 743d11c)

### [TOOL-011] Legacy tools not deprecated in descriptions
- **Resolved in**: Session 8 — legacy tools had already been removed from MCP server during earlier consolidation

### [AGENT-006] Use `find` instead of individual `get_annotations` for bulk discovery
- **Resolved in**: Session 8 — cross-reference to `find(hasAnnotation: true)` already existed in `get_annotations` description

## Metrics Over Time

| Session | Date | Tool Calls | Errors | Waste % | ToolSearch | Nodes Created | New Issues | Resolved |
|---------|------|------------|--------|---------|------------|---------------|------------|----------|
| 1 | 2026-03-05 | 308 | 16 | 25-33% | 33 (10.7%) | — | 15 | 0 |
| 2 | 2026-03-06 | 389 | 14 | ~17.7% | 28 (7.2%) | 41 | 4 | 3 |
| 3 | 2026-03-14 | 160 | 10 | ~18% | 0 (0%) | 0 (dev) | 2 | 0 |
| 4 | 2026-03-14 | 56 | 2 | ~12% | 8 (14.3%) | 79 | 3 | 7 |
| 5 | 2026-03-12 | 259 | 3 | ~23.6% | 35 (13.5%) | ~120+ | 2 | 0 |
| 6 | 2026-03-13 | 68 | 0 | ~72% | 3 (4.4%) | 0 | 1 | 0 |
| 7 | 2026-03-13 | 24 | 2 | ~25% | 2 (8.3%) | 0 | 1 | 0 |
| 8 | 2026-03-16 | 153 | 9 | ~10% | 0 (0%) | 0 (dev) | 0 | 2 |
| 9 | 2026-03-16 | 16 | 0 | ~44% | 7 (43.8%) | 0 | 0 | 0 |

## Issue Categories

- `missing-batch-tool` — tool exists but lacks batch variant
- `plugin-bug` — bug in Figma plugin code
- `type-coercion` — MCP server rejects valid-but-wrong-type input
- `missing-tool` — capability gap requiring new tool
- `agent-behavior` — prompt/skill improvement needed
- `infrastructure` — WebSocket, reconnection, schema freshness
