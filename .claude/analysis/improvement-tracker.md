# Figmagent Improvement Tracker

Last updated: 2026-03-14
Sessions analyzed: 4

## Active Issues

### [TOOL-001] bind_variable needs batch version
- **Status**: verified
- **Priority**: P0
- **Category**: missing-batch-tool
- **First seen**: Session 2 (2026-03-06)
- **Sessions affected**: 2
- **Estimated savings**: ~120 calls/session
- **Description**: 132 individual `bind_variable` calls dominated session 2. Longest uninterrupted run was 28 consecutive calls. Agent groups conceptually but has no batch tool to execute.
- **Current status**: Implemented via `apply` tool with `variables` field — accepts map of field→variableId for design token bindings on one or many nodes.
- **Verified in**: Session 4 — agent bound 93 nodes across 12 `apply` calls with zero individual bind_variable usage.

### [TOOL-002] set_text_style needs batch version
- **Status**: verified
- **Priority**: P0
- **Category**: missing-batch-tool
- **First seen**: Session 2 (2026-03-06)
- **Sessions affected**: 2
- **Estimated savings**: ~45 calls/session
- **Description**: 55 individual `set_text_style` calls. Agent applies same style to 9+ nodes at a time.
- **Current status**: Implemented via `apply` tool with `textStyleId` field — deduplicates font loading across multiple nodes automatically.
- **Verified in**: Session 4 — text styles applied via `apply` in batch, zero individual set_text_style calls.

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
- **Sessions affected**: 1, 2, 4
- **Estimated savings**: ~28-33 calls/session (sessions 1-2), ~4-5 calls/session (session 4)
- **Description**: Agent rediscovers same tools repeatedly. 33 calls in session 1 (10.7%), 28 in session 2 (7.2%), 8 in session 4 (14.3%). Tools fetched incrementally as needed instead of pre-loaded.
- **Proposed fix**: Pre-load tool schemas at session start; add complete tool reference to skill file; make ToolSearch return explicit "not found in server" vs "0 results".

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
- **Status**: verified
- **Priority**: P2
- **Category**: infrastructure
- **First seen**: Session 1 (2026-03-05)
- **Sessions affected**: 1, 2
- **Description**: 8 reconnections in session 1 consuming ~40+ overhead calls. Each MCP restart forces new channel + ToolSearch + context re-establishment.
- **Current status**: Auto-reconnect improved; plugin now uses channel named after file and auto-rejoins.
- **Verified in**: Session 4 — zero reconnections, zero `join_channel` calls, auto-join worked perfectly.

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
- **Current status**: `create` tool handles single nodes, nested trees, components, and instances. FILL sizing applied in second pass. Built 41 nodes in 1 call in session 2.
- **Verified in**: Session 2, Session 4 (79 nodes in 14 calls, ~5.6 nodes/call avg)

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
- **Description**: `extract-sessions.ts` had a hardcoded macOS session directory path (`-Users-davidbowman-Github-...`). Also `--latest` flag required a value argument due to `parseArgs` string type. Both issues blocked the analyze-session skill from running.
- **Current status**: Fixed — auto-detects session directory from CWD, pre-processes `--latest` to accept bare flag.
- **Verified in**: Session 4 — extraction ran successfully to produce JSON transcript.

### [AGENT-004] Subagent context duplication
- **Status**: identified
- **Priority**: P2
- **Category**: agent-behavior
- **First seen**: Session 3 (2026-03-14)
- **Sessions affected**: 3
- **Estimated savings**: ~15-20 redundant reads/session
- **Description**: Agent subagents re-read files that the parent session already read (session analyses, SKILL.md files, hooks). Same files read 3x across parent + 2 subagents. Long idle gaps (4h, 11h) between phases also force re-reads.
- **Proposed fix**: Provide key file contents or summaries in subagent prompts to reduce redundant reads. Not fully solvable for long idle gaps (context loss is inherent).

### [BUG-002] lint_design doesn't traverse PAGE nodes
- **Status**: identified
- **Priority**: P1
- **Category**: plugin-bug
- **First seen**: Session 4 (2026-03-14)
- **Sessions affected**: 4
- **Estimated savings**: ~6 calls/session
- **Description**: `lint_design(nodeId: "0:1")` returned 0 nodes scanned. The plugin doesn't handle PAGE node types — it only traverses the given node's subtree but PAGE nodes aren't SceneNodes. Agent had to lint each component individually (4 calls for audit + 3 for re-verify = 7 calls instead of 1-2).
- **Proposed fix**: In the plugin's lint handler, detect PAGE type and iterate over `node.children`, aggregating results. One page-level lint should cover all top-level components.
- **Auto-fixable**: no (plugin-level change)

### [TOOL-010] Multi-root create for batch variant building
- **Status**: identified
- **Priority**: P2
- **Category**: missing-tool
- **First seen**: Session 4 (2026-03-14)
- **Sessions affected**: 4
- **Estimated savings**: ~8 calls/session when building variant sets
- **Description**: 4 alert variants created sequentially (4 calls), 6 button variants created sequentially (6 calls). Each had identical structure with different colors/sizes. Could be batched.
- **Proposed fix**: Accept array of node specs in `create` tool, create all roots in parallel. Returns array of root IDs.

### [BUG-003] apply variable binding enum missing fontSize and text properties
- **Status**: identified
- **Priority**: P2
- **Category**: plugin-bug
- **First seen**: Session 4 (2026-03-14)
- **Sessions affected**: 4
- **Estimated savings**: ~1 call + 1 error per session
- **Description**: `apply` with `variables: { fontSize: "VariableID:..." }` rejected by Zod validation. The binding enum only includes fill, stroke, opacity, cornerRadius, padding, spacing, width/height, visible, characters — missing fontSize, fontFamily, fontStyle, lineHeight, letterSpacing, paragraphSpacing, paragraphIndent which are valid `setBoundVariable` targets.
- **Proposed fix**: Add text property fields to the variable binding Zod enum in the MCP tool definition.
- **Fix pattern**: type-coercion (enum expansion)
- **Auto-fixable**: yes

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
- **Actual improvement**: 79 nodes in 14 calls in session 4 (~5.6 nodes/call)

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

### [INFRA-001] Channel reconnection tax
- **Resolved in**: Post-session 2 (auto-join)
- **Verified in**: Session 4 — zero reconnections

### [INFRA-002] extract-sessions.ts hardcoded session path
- **Resolved in**: Session 3
- **Verified in**: Session 4

## Metrics Over Time

| Session | Date | Tool Calls | Errors | Waste % | ToolSearch | Nodes Created | New Issues | Resolved |
|---------|------|------------|--------|---------|------------|---------------|------------|----------|
| 1 | 2026-03-05 | 308 | 16 | 25-33% | 33 (10.7%) | — | 15 | 0 |
| 2 | 2026-03-06 | 389 | 14 | ~17.7% | 28 (7.2%) | 41 | 4 | 3 |
| 3 | 2026-03-14 | 160 | 10 | ~18% | 0 (0%) | 0 (dev) | 2 | 0 |
| 4 | 2026-03-14 | 56 | 2 | ~12% | 8 (14.3%) | 79 | 3 | 7 |

## Issue Categories

- `missing-batch-tool` — tool exists but lacks batch variant
- `plugin-bug` — bug in Figma plugin code
- `type-coercion` — MCP server rejects valid-but-wrong-type input
- `missing-tool` — capability gap requiring new tool
- `agent-behavior` — prompt/skill improvement needed
- `infrastructure` — WebSocket, reconnection, schema freshness
