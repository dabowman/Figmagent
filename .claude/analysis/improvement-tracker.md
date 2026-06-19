# Figmagent Improvement Tracker

Last updated: 2026-06-19
Sessions analyzed: 35

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
- **Sessions affected**: 1, 2, 4, 5, 6, 7, 9, 10, 11, 13, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 34
- **Estimated savings**: ~20-33 calls/session (long sessions), ~2-8 calls/session (short sessions)
- **Description**: Agent rediscovers same tools repeatedly. 33 calls in session 1 (10.7%), 28 in session 2 (7.2%), 35 in session 5 (13.5%), 8 in session 4 (14.3%), 3 in session 6 (4.4%), 2 in session 7 (8.3%), 7 in session 9 (43.8% — worst ratio). Session 18: only 6 calls (2.2%) — best ratio. Session 19: 7 calls (15.2%) — short session with high ratio. Session 20: 5 calls (16.7%). Session 21: 2 calls (8.7%). Session 22: 5 calls (4.5% — good ratio for a 112-call session). Session 23: 8 calls (11.8% — one re-search after a multi-file `join_channel`). Session 24: 5 calls (12.8% — re-search after multi-file `join_channel`). Session 25: 11 calls (14.9% — worsened by 3 reconnections). Session 26: 11 calls (12.9%). Session 27: 4 calls (16% — short remote session). Session 28: 5 calls (15.2%). Session 29: 17 calls (10.6% — good ratio for a 161-call session). Session 34: 6 calls (9.8% — **external repo**, where Figmagent + official-figma + design-system tools are ALL deferred and must be ToolSearched; the "No ToolSearch needed" CLAUDE.md note only holds in-repo where the MCP server enumerates tools). Worst after reconnections or in short sessions where overhead ratio is high.
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
- **Sessions affected**: 1, 2, 5, 13, 17, 18, 25
- **Description**: 8 reconnections in session 1 consuming ~40+ overhead calls. Session 5 had ~8 reconnections (14 `join_channel` calls) over 139 minutes. Session 13 had 3 reconnections (model switch + wrong channel guess + multi-channel). Session 17 had 2 reconnections after ~90 minutes, preceded by 3 consecutive timeouts. Session 18 had 14 reconnections in a 10-minute burst — all triggered by `import_library_component` timeouts on complex Block Editor components (slow operation, not actual connection loss). Session 25 had 3 reconnections triggered by `set_text_content` timeouts on instance-override nodes (slow op, not a drop — see [BUG-011]). Short sessions (4, 6, 7) had zero.
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
- **Follow-up (Session 24)**: [#57](https://github.com/dabowman/Figmagent/issues/57) — the full-deck `scan_text_nodes`/`grep` path still dumps a single 46K-token overflow file that exceeds `Read`'s 10K-token cap. Needs scan-path pagination and/or splitting overflow dumps into ≤10K-token chunks. Agent-side mitigation tracked as [AGENT-018] / [#58](https://github.com/dabowman/Figmagent/issues/58).

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
- **Sessions affected**: 4, 5, 10
- **Estimated savings**: ~8 calls/session when building variant sets
- **Description**: 4 alert variants created sequentially (4 calls), 6 button variants created sequentially (6 calls). Session 5 had similar pattern. Session 10: 4 alert variants sequentially.
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
- **Status**: verified
- **Verified in**: production audit 2026-06-19 — #9 confirmed fixed in code: tools/apply.ts:211 description: 'never delete and recreate text just to change font'
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
- **Description**: 51 individual `get_annotations` calls (68.9% of 74 calls in session 6) to find annotated nodes. Only 8% hit rate (3/50 had annotations). Agent tried `find` first with name regex but missed `hasAnnotation: true` criteria.
- **Proposed fix**: Add cross-reference to `find(hasAnnotation: true)` in the `get_annotations` tool description. Emphasize `nodeIds` batch support in description.

### [AGENT-007] Use `find` instead of `scan_nodes_by_types` for node discovery — [#11](https://github.com/dabowman/Figmagent/issues/11)
- **Status**: verified
- **Verified in**: production audit 2026-06-19 — #11 confirmed fixed in code: tools/find.ts:25 description: replaces old scan_text_nodes/scan_nodes_by_types flows
- **Priority**: P1
- **Category**: agent-behavior
- **First seen**: Session 7 (2026-03-13)
- **Sessions affected**: 7
- **Estimated savings**: ~5 calls/session
- **Description**: `scan_nodes_by_types(INSTANCE)` returned 276K chars, overflowing to disk, then agent spent 4 calls processing the overflow. `find` with criteria would have returned targeted results within budget.
- **Proposed fix**: Add deprecation notice to `scan_nodes_by_types` description pointing to `find`. Already documented in CLAUDE.md but agent didn't follow.

### [AGENT-008] Generalize 403 fail-fast across REST API endpoints
- **Status**: identified
- **Priority**: P2
- **Category**: agent-behavior
- **First seen**: Session 9 (2026-03-16)
- **Sessions affected**: 9, 16, 28, 29
- **Estimated savings**: ~2 calls per occurrence
- **Description**: Agent got 403 on `search_library_components`, tried `get_library_components` (same 403), then `get_component_variants` (same 403). All REST API calls to the same file key fail with the same auth error. Session 16 also hit 403 on Enterprise-only endpoint. Session 28 hit 403 on `get_library_variables` (WPDS Enterprise-only) and **fail-fasted correctly** — had the constraint in its notes, did not retry other REST endpoints; pivoted to exploring the Plugin-API alternative (see [TOOL-018]). Good behavior, confirming the proposed guidance works.
- **Proposed fix**: Add to CLAUDE.md: "If a REST API call returns 403 on a file key, all REST API calls to that file will fail. Stop after the first 403 and ask about token scopes."

### [AGENT-009] Parallel cancellation cascade — don't mix Agent + speculative Reads — [#16](https://github.com/dabowman/Figmagent/issues/16)
- **Status**: verified
- **Verified in**: production audit 2026-06-19 — #16 confirmed fixed in code: CLAUDE.md: never mix Agent calls with speculative Reads; Glob first
- **Priority**: P2
- **Category**: agent-behavior
- **First seen**: Session 14 (2026-03-16)
- **Sessions affected**: 14
- **Estimated savings**: ~2 calls + ~3 minutes per occurrence
- **Description**: A Read error on a non-existent file cancelled a parallel figma-discovery Agent call that was already running. The Agent had to be relaunched from scratch.
- **Proposed fix**: Never mix long-running Agent calls with speculative Reads in the same parallel batch. Verify file existence (Glob) before parallel launch if uncertain.

### [AGENT-010] Confused exposed instances with INSTANCE_SWAP properties — [#17](https://github.com/dabowman/Figmagent/issues/17)
- **Status**: verified
- **Verified in**: production audit 2026-06-19 — #17 confirmed fixed in code: CLAUDE.md Key Patterns: exposed instances vs INSTANCE_SWAP vs Slots
- **Priority**: P1
- **Category**: agent-behavior
- **First seen**: Session 12 (2026-03-16)
- **Sessions affected**: 12
- **Estimated savings**: ~85 calls (42 wrong + 43 undo)
- **Description**: Agent used `set_exposed_instance` 85 times (42 applying + 43 undoing) when the user wanted INSTANCE_SWAP component properties. `isExposedInstance` surfaces nested instance properties at the parent level — it does NOT create a slot/dropdown. The user had to correct via screenshot.
- **Proposed fix**: Clarify the distinction between exposed instances and INSTANCE_SWAP properties in CLAUDE.md, tool descriptions, and design_workflow prompt.

### [AGENT-011] Validate approach on 1 node before mass rollout — [#18](https://github.com/dabowman/Figmagent/issues/18)
- **Status**: verified
- **Verified in**: production audit 2026-06-19 — #18 confirmed fixed in code: CLAUDE.md: validate on 1 node first, confirm, then batch
- **Priority**: P1
- **Category**: agent-behavior
- **First seen**: Session 12 (2026-03-16)
- **Sessions affected**: 12, 17
- **Estimated savings**: ~40 calls per wrong-approach session
- **Description**: Agent applied `set_exposed_instance` to 42 nodes before user corrected the approach. Should have applied to 1 node, confirmed with user, then batch.
- **Proposed fix**: Add to agent workflow: "For operations on 5+ nodes, apply to 1 first, show user, confirm, then batch."

### [TOOL-012] Batch `import_library_component` — [#19](https://github.com/dabowman/Figmagent/issues/19)
- **Status**: verified
- **Priority**: P0
- **Category**: missing-batch-tool
- **First seen**: Session 15 (2026-03-16)
- **Sessions affected**: 15, 18
- **Estimated savings**: ~68 calls/session
- **Description**: 33 sequential calls in session 15, 76 calls in session 18 (27% of all calls). No batch variant existed. Session 18 had runs of 34 consecutive imports.
- **Current status**: Implemented — `import_library_components` (plural) accepting an array of component keys.
- **Verified in**: Session 29 — `import_library_components` (plural) succeeded 3× importing WPDS Buttons + error Notices, 0 failures, no clone-reparent workaround.

### [BUG-004] Font loading bug in `import_library_component` with `parentNodeId` — [#20](https://github.com/dabowman/Figmagent/issues/20)
- **Status**: verified
- **Verified in**: production audit 2026-06-19 — #20 confirmed fixed in code: components.js:178-209 — parentNodeId import collects + loadFontAsync's all TEXT fonts before appendChild
- **Priority**: P0
- **Category**: plugin-bug
- **First seen**: Session 15 (2026-03-16)
- **Sessions affected**: 15, 18
- **Estimated savings**: ~88 calls (clone-reparent workaround)
- **Description**: `import_library_component` with `parentNodeId` fails on components containing TEXT nodes — fonts are not loaded before the import. Session 15: 36 extra calls. Session 18: 82 `clone_and_modify` + 6 `delete_multiple_nodes` = 88 calls solely for reparenting because direct insertion fails.
- **Fix pattern**: sync-to-async (load fonts before inserting)
- **Possibly fixed**: Session 29 imported WPDS Buttons + Notices (TEXT-containing components) via `import_library_components` and positioned them with **no clone-reparent workaround** — suggests the font-loading path may be fixed. Needs explicit confirmation with `parentNodeId` direct insertion.

### [TOOL-013] Batch `get_component_variants` — [#21](https://github.com/dabowman/Figmagent/issues/21)
- **Status**: verified
- **Verified in**: production audit 2026-06-19 — #21 confirmed fixed in code: libraries.ts:379 get_component_variants accepts componentSetNodeIds array (batch)
- **Priority**: P1
- **Category**: missing-batch-tool
- **First seen**: Session 15 (2026-03-16)
- **Sessions affected**: 15, 18
- **Estimated savings**: ~43 calls/session
- **Description**: 24 sequential calls in session 15. 48 sequential calls in session 18 (two bursts of 24 and 22 consecutive). All using the same fileKey.

### [BUG-005] `get_node_info` type coercion — depth as string — [#22](https://github.com/dabowman/Figmagent/issues/22)
- **Status**: verified
- **Verified in**: production audit 2026-06-19 — #22 confirmed fixed in code: tools/document.ts:169 z.coerce.number() + plugin document.js:404 toNumber() coerce depth string→number
- **Priority**: P2
- **Category**: type-coercion
- **First seen**: Session 13 (2026-03-16)
- **Sessions affected**: 13
- **Estimated savings**: ~3 calls per occurrence
- **Description**: Agent passed `depth: "3"` (string) to `get_node_info` three consecutive times, never reading the error message. Related to [TOOL-006] but specific to depth parameter.
- **Fix pattern**: type-coercion
- **Auto-fixable**: yes

### [BUG-006] `getMainComponent` sync in FSGN traversal — [#23](https://github.com/dabowman/Figmagent/issues/23)
- **Status**: verified
- **Verified in**: production audit 2026-06-19 — #23 confirmed fixed in code: document.js:264 FSGN traversal uses getMainComponentAsync; no sync getMainComponent in traversal
- **Priority**: P2
- **Category**: plugin-bug
- **First seen**: Session 13 (2026-03-16)
- **Sessions affected**: 13
- **Description**: `getMainComponent` called synchronously instead of `getMainComponentAsync` in FSGN traversal, causing 2 failures on instance nodes.
- **Fix pattern**: sync-to-async

### [BUG-007] `create` tool: TEXT nodes fail with non-default fonts — [#30](https://github.com/dabowman/Figmagent/issues/30)
- **Status**: implemented (`bda7a09`)
- **Priority**: P1
- **Category**: plugin-bug
- **First seen**: Session 17 (2026-03-16)
- **Sessions affected**: 17
- **Estimated savings**: ~2 calls per TEXT node with custom font (20-40 calls in component-heavy sessions)
- **Description**: `create` with TEXT nodes and non-default fonts (e.g. "Public Sans") fails or silently falls back to Inter Regular. Agent forced into 3-step workaround: create empty text → apply font → set content. Root cause: `loadFontAsync` catch block silently falls back (line 60), weight style name mismatches (e.g. "Semi Bold" vs "SemiBold") are swallowed (line 85), and success is reported even when font wasn't loaded.
- **Fix pattern**: Align `create`'s font handling with `apply`'s (which works correctly). Try style name variations, report warnings/errors instead of silent fallback.
- **Related**: [BUG-004] (same class, different tool), [AGENT-005] (workaround pattern)

### [TOOL-014] `get_design_system` needs filtering params — [#28](https://github.com/dabowman/Figmagent/issues/28) (REOPENED — partial)
- **Status**: verified
- **Verified in**: production audit 2026-06-19 — #28 confirmed fixed in code: tokens.ts:33/39 get_design_system has collection + namePattern regex filters
- **Priority**: P1
- **Category**: missing-tool
- **First seen**: Session 17 (2026-03-16)
- **Sessions affected**: 17, 19, 20, 25
- **Estimated savings**: ~4 calls per large-design-system session
- **Description**: With 540+ variables and 18 styles, `get_design_system` output was 95-110K chars — exceeding both the 30K default budget and MCP infrastructure limits. Agent needed 9 calls (3 timeouts, 1 rejection, 2 truncated, 3 succeeded) to get useful data, then fell back to Bash parsing of the dumped file. Session 20 hit the identical overflow (96.5K truncated, then 111.6K dumped to file) — 3 failed `get_design_system` calls + 1 Bash workaround. In session 20 the agent also wasted a call *lowering* `maxOutputChars` to 5000 on an already-over-budget response (cannot help). **Session 25 confirms the `includeStyles`/`includeVariables` toggles have shipped** — the styles-only call (`includeVariables: false`) succeeded — but they're too coarse: the variables collection alone is 88K chars and still overflowed at 60K and 100K. Finer filters still needed.
- **Proposed fix**: The include/exclude toggles are done; still need `collection` (filter by collection name) and `namePattern` (regex filter on variable/style names) so the agent can query a subset of the variable set (e.g. just the color collection or `font/*`). Also: when over budget, the truncation message should note that lowering `maxOutputChars` cannot help.
- **Truncation-message sub-finding**: Session 20's "lowering `maxOutputChars` won't help — filter instead" hint added as a comment on the existing open issue [#44](https://github.com/dabowman/Figmagent/issues/44) (which already covers listing collection names in the truncation message).

### [AGENT-013] Cross-tool timeout tracking for reconnection — [#29](https://github.com/dabowman/Figmagent/issues/29)
- **Status**: verified
- **Verified in**: production audit 2026-06-19 — #29 confirmed fixed in code: CLAUDE.md: after 2 timeouts in a row on any tool, assume connection lost
- **Priority**: P2
- **Category**: agent-behavior
- **First seen**: Session 17 (2026-03-16)
- **Sessions affected**: 17
- **Estimated savings**: ~4 calls per timeout cascade
- **Description**: Three consecutive timeouts across `get_design_system` and `find` (calls #70-73). The interleaved `find` call reset the agent's "2 consecutive identical errors" counter, delaying reconnection. CLAUDE.md says "2 timeouts in a row" but agent interpreted "in a row on the same tool."
- **Proposed fix**: Clarify in CLAUDE.md: "After 2 timeouts in a row on ANY tool (not just the same tool), assume the WebSocket connection is lost."

### [AGENT-012] Read pipeline output, not source tokens — [#25](https://github.com/dabowman/Figmagent/issues/25)
- **Status**: verified
- **Verified in**: production audit 2026-06-19 — #25 confirmed fixed in code: CLAUDE.md: read pipeline output (tokens/figma/, build/) not source/base tokens
- **Priority**: P1
- **Category**: agent-behavior
- **First seen**: Session 17 (2026-03-16)
- **Sessions affected**: 17
- **Estimated savings**: ~23 calls per occurrence (delete-recreate cycle)
- **Description**: Agent created ~200 variables with wrong naming (inferred from base tokens `tokens/base/` instead of pipeline output `tokens/figma/`). User had to intervene to redirect. All 200 variables deleted and recreated correctly. 14 Figma calls + 9 Bash scripts wasted.
- **Proposed fix**: Add to agent workflow: "When a token pipeline exists, always read the pipeline's Figma-specific output files before creating variables. Don't infer naming or structure from base/source tokens."

### [INFRA-003] Token-to-Figma conversion utility — [#26](https://github.com/dabowman/Figmagent/issues/26)
- **Status**: verified
- **Verified in**: production audit 2026-06-19 — #26 confirmed fixed in code: tokens.ts:500 prepare_figma_variables converts DTCG→create_variables server-side (hexToRgba, scopes, batching)
- **Priority**: P1
- **Category**: infrastructure
- **First seen**: Session 17 (2026-03-16)
- **Sessions affected**: 17
- **Estimated savings**: ~18 Bash calls per token-import session
- **Description**: Agent wrote 22 Bash/Node scripts for hex→RGBA conversion, DTCG JSON parsing, alias resolution, and batch chunking. Many were incremental iterations on the same logic. No reusable utility exists.
- **Proposed fix**: Create a `prepare-figma-variables` script or MCP tool that reads DTCG-format JSON files and outputs `create_variables` payloads with automatic hex→RGBA conversion, alias resolution via ID map, and batching (25 vars per batch).

### [BUG-008] Timeout responses not flagged as errors (all tools, not just import) — [#60](https://github.com/dabowman/Figmagent/issues/60)
- **Status**: verified
- **Verified in**: production audit 2026-06-19 — #60 confirmed fixed in code: instance.ts:84-137 looksLikeError matcher sets is_error:true for Error/Failed/timeout/Not-connected text
- **Priority**: P2
- **Category**: plugin-bug
- **First seen**: Session 18 (2026-03-23)
- **Sessions affected**: 18, 25, 26, 28, 29, 30, 32, 33 (30/32 = the multi-file picker is also an "Error…" string with `is_error: false`; 33 = the remote "you don't have edit access" block also returns `is_error: false` — see [BUG-015]; 32/33 are external WordPress-Admin-Environment sessions)
- **Estimated savings**: faster agent error detection
- **Description**: `import_library_component` timeout responses return `is_error: false` with content `"Error importing library component: Request to Figma timed out"`. Agent must parse the content string to detect the timeout. Session 25 shows the same for `set_text_content` — `"Error setting text content: Request to Figma timed out"` also returns `is_error: false`. Session 26 shows it for a `lint_design` **crash** — `"Error running lint_design: cannot read property 'type' of undefined"` also returns `is_error: false` (see [BUG-012]). **Session 28 is the strongest evidence: three distinct failure types — lint timeout, `get` "Node not found", and `get_library_variables` 403 — ALL returned `is_error: false`.** The MCP server appears to never set `is_error: true` for Figmagent failures. Agent must string-parse every response.
- **Fix pattern**: Set `is_error: true` in the MCP server's error/timeout handling path (generalize across all commands — timeouts, thrown errors, not-found, and REST errors, not just import).

### [AGENT-014] Reconnection loop on slow operations vs actual disconnections — [#61](https://github.com/dabowman/Figmagent/issues/61)
- **Status**: verified
- **Verified in**: production audit 2026-06-19 — #61 confirmed fixed in code: CLAUDE.md Plugin Transport Appendix: join after timeout = healthy; don't keep reconnecting
- **Priority**: P1
- **Category**: agent-behavior
- **First seen**: Session 18 (2026-03-23)
- **Sessions affected**: 18, 25
- **Estimated savings**: ~14 calls per occurrence
- **Description**: Agent reconnected 14 times in 10 minutes during `import_library_component` timeouts on complex Block Editor components. Each reconnection succeeded immediately, proving the connection was fine — the operation was just slow. Agent should distinguish: if `join_channel` succeeds instantly after a timeout, the connection is not lost; the previous operation was slow. After 3 timeout+successful-reconnect cycles on the same operation type, skip that component and try others, or increase the per-call timeout expectation. Session 25: 3 reconnections during `set_text_content` timeouts on instance-override nodes — reads worked the whole time; the agent eventually realized the connection was healthy ("Connection works for reads"). See [BUG-011] for the slow-op root cause.
- **Proposed fix**: Add to CLAUDE.md/agent prompts: "If join_channel succeeds immediately after a timeout, the connection is healthy — the operation is slow. After 3 such cycles, skip and retry later instead of reconnecting again."

### [TOOL-015] `apply` cornerRadius variable binding should expand to all corners
- **Status**: identified
- **Priority**: P2
- **Category**: missing-tool
- **First seen**: Session 19 (2026-03-19)
- **Sessions affected**: 19, 35
- **Estimated savings**: ~1 call per component with corner radius tokens
- **Description**: `apply` with `variables: { cornerRadius: "VariableID:..." }` only binds `topLeftRadius`. To bind all four corners, the agent must make a second call with `topLeftRadius`, `topRightRadius`, `bottomLeftRadius`, `bottomRightRadius` individually. The tool should auto-expand `cornerRadius` to all four corners. **Session 35**: recurred — a `run_script` bind reported 129 binds but a verification scan counted only 119; the 10-field gap was all `cornerRadius` binding only `topLeftRadius`. Agent caught it via post-write reconciliation and rebound all four corners explicitly.
- **Proposed fix**: In plugin `apply.js`, when `variables.cornerRadius` is set, bind it to all four individual corner radius properties (`topLeftRadius`, `topRightRadius`, `bottomLeftRadius`, `bottomRightRadius`).

### [AGENT-015] Prefer Figma API variable IDs over local config files
- **Status**: identified
- **Priority**: P2
- **Category**: agent-behavior
- **First seen**: Session 19 (2026-03-19)
- **Sessions affected**: 19
- **Estimated savings**: ~2 calls per occurrence
- **Description**: Agent read variable IDs from the project's `config/figma-variables.json` (VariableID:30:xxx) which didn't match the live Figma file (VariableID:1:xxx). The `get` tool's FSGN `defs.vars` already contained the correct IDs. Agent should prefer IDs from Figma API responses over local config files.
- **Proposed fix**: Add to agent workflow: "Always use variable IDs from Figma API responses (get defs.vars, get_design_system) rather than local mapping files, which may use different ID schemes."

### [AGENT-016] Re-inspect after every write instead of trusting the response verdict
- **Status**: implemented
- **Priority**: P2
- **Category**: agent-behavior
- **First seen**: Session 20 (2026-03-23)
- **Sessions affected**: 20, 21, 22 (21/22 were largely justified — diagnostic in 21, complex-layout verification in 22)
- **Estimated savings**: ~3 calls/session
- **Description**: Agent re-read the form root node `30:3` with `get` after every `apply`/`set_multiple_text_contents` (a write-then-verify cadence, 4 redundant `get`s). The mutation responses already carried the result. In session 21 the re-inspection was *justified* — it is how the agent discovered the [BUG-009] silent FILL no-op, since `apply` returned bare `success`. That re-inspection need would disappear if [BUG-009] surfaced a warning.
- **Current status**: Addressed by guidance shipped after this session — CLAUDE.md now states "Write responses carry the verdict" and `write`/`edit` responses append a `warnings:` block; "Act on warnings instead of re-reading to verify." Session 20 predates this and demonstrates the problem it solves.
- **Proposed fix**: None needed; reinforce in design-build prompt and watch for recurrence in post-rename sessions.

### [BUG-009] `apply` FILL silently no-ops on width-0 text nodes (and reports success) — [#50](https://github.com/dabowman/Figmagent/issues/50)
- **Status**: verified
- **Verified in**: production audit 2026-06-19 — #50 confirmed fixed in code: assertions.js:130 width_collapse warning + apply.js width-recovery before FILL
- **Priority**: P1
- **Category**: plugin-bug
- **First seen**: Session 21 (2026-04-20)
- **Sessions affected**: 21, 23 (23 is the layout-sizing generalization — see [TOOL-016])
- **Estimated savings**: ~2 calls + 3 diagnostic `get`s per width-collapse session
- **Description**: A TEXT node collapsed to width 0 (from `WIDTH_AND_HEIGHT` autoresize under a constrained parent) cannot be repaired with `layoutSizingHorizontal: FILL` directly — the `apply` call returns `success: true, nodesApplied: 1` but width stays 0 (silent no-op; the FILL coercion path doesn't kick in from width 0). The working recipe is two passes: set an explicit width (or `textAutoResize: HEIGHT`) first, then apply FILL. The bare-`success` response hid the failure until a follow-up `get` revealed the unchanged width. Session 21: 21 text nodes across 5 Base UI components fixed via the 2-pass workaround.
- **Proposed fix**: In `apply.js`, when applying `layoutSizingHorizontal: FILL` to a TEXT node with width 0 (or `textAutoResize: WIDTH_AND_HEIGHT`), reset width / set `textAutoResize: HEIGHT` before FILL — collapsing the 2-pass recipe into one call. At minimum, emit a `width_collapse` / `fill_not_applied` warning instead of bare `success` when a FILL apply leaves width at 0 (the post-write assertion suite already has these warning categories). Also fix the upstream `create`-tool path that produces width-0 `WIDTH_AND_HEIGHT` text nodes (related to [BUG-007]).
- **Note**: Not in the Phase 6 auto-fix allowlist (it's an apply-logic fix, not sync-to-async / type-coercion / missing-batch-tool) — no auto-plan generated. Distinct from #39 (coerce on first FILL, closed) and #47 (create-time default) — this is the repair path for already-collapsed nodes plus the silent-success problem.
- **Companion skill doc**: [#51](https://github.com/dabowman/Figmagent/issues/51) — document the width-collapse fix recipe (set width before FILL) as interim agent guidance.

### [BUG-010] `update_styles`/`update_variables` don't pre-load the style's current font — [#52](https://github.com/dabowman/Figmagent/issues/52)
- **Status**: verified
- **Verified in**: production audit 2026-06-19 — #52 confirmed fixed in code: styles.js:1037 loadCurrentStyleFont preloads style font before any property write
- **Priority**: P1
- **Category**: plugin-bug
- **First seen**: Session 22 (2026-03-30)
- **Sessions affected**: 22
- **Estimated savings**: ~1-2 calls per text-style-editing session
- **Description**: Updating a text style's **non-font** property (e.g. lineHeight) fails because the handler only loads a font when a font field is being *set*. `update_styles` returned `{"success": false, "totalUpdated": 0, "totalFailed": 8}` with each result: `"in set_lineHeight: Cannot write to node with unloaded font \"Public Sans Medium\". Please call figma.loadFontAsync(...)"`. `update_variables` similarly failed the serif font-family variable (font "Test Martina Plantijn" not loaded). Both surfaced inside the result JSON, not as `is_error: true`. Agent workaround: re-issue with `fontFamily`/`fontStyle` included to trigger loading.
- **Proposed fix**: In `update_styles` (and `update_variables` for font-family vars), read the style's existing `fontName` and `loadFontAsync` it before writing *any* property, not just when a font field is present. Same font-loading family as [BUG-004] (import) and [BUG-007] (create).
- **Note**: Error string is "Cannot write to node with unloaded font" (font-loading), not the sync-to-async "documentAccess: dynamic-page" trigger — not in the Phase 6 auto-fix allowlist, so no auto-plan generated.

### [INFRA-004] WebFetch cannot reach localhost — use `curl` for loopback URLs — [#54](https://github.com/dabowman/Figmagent/issues/54)
- **Status**: verified
- **Verified in**: production audit 2026-06-19 — #54 confirmed fixed in code: CLAUDE.md: fetch localhost/127.0.0.1/0.0.0.0 with Bash curl, not WebFetch
- **Priority**: P2
- **Category**: agent-behavior
- **First seen**: Session 22 (2026-03-30)
- **Sessions affected**: 22
- **Estimated savings**: ~5 calls per live-local-page port
- **Description**: WebFetch returned `ECONNREFUSED` three times on `http://127.0.0.1:8080/` even though the server was up (curl returned 200). Claude Code's WebFetch cannot reach the loopback interface. Cost 3 failed fetches + 4 diagnostic Bash probes + a false "server isn't running" message to the user (it was running the whole time).
- **Proposed fix**: Agent-behavior — when porting a live local page, fetch `localhost`/`127.0.0.1`/`0.0.0.0` URLs with `Bash curl` from the start, not WebFetch. After one ECONNREFUSED, probe with `lsof`/`curl` before asking the user to start the server. Add a line to CLAUDE.md / the figma-guidelines skill (which covers porting live pages into Figma).

### [TOOL-016] `apply` layout-sizing no-ops before `layoutMode` exists (and reports success) — [#53](https://github.com/dabowman/Figmagent/issues/53)
- **Status**: verified
- **Verified in**: production audit 2026-06-19 — #53 confirmed fixed in code: apply.js:643 sizingContextMissing → fill_not_applied warning + skip when parent lacks auto-layout
- **Priority**: P2
- **Category**: plugin-bug
- **First seen**: Session 23 (2026-03-24)
- **Sessions affected**: 23
- **Estimated savings**: ~2-3 re-apply calls per auto-layout-conversion session
- **Description**: Generalization of [BUG-009] from text-FILL to all layout sizing. When converting flat (manually-positioned) frames to auto-layout, `layoutSizingHorizontal/Vertical` silently no-ops if the node isn't yet an auto-layout frame (or its parent isn't), yet `apply` returns `success`. Session 23 hit the 2-pass dance: `#34 apply` (sizing on 19 wrapper frames) → `#35 apply` (add `layoutMode` to the same 19) → `#36 apply` (re-apply sizing, now sticks). When `layoutMode` + `layoutSizing*` are combined in one call (#26–33 did), it works.
- **Proposed fix**: Within a single `apply`, apply `layoutMode` before `layoutSizing*` on the same node (works today — encourage combining). Warn (don't bare-`success`) when `layoutSizing*` is requested on a node/parent that is not an auto-layout frame. Document the outside-in conversion recipe (parent auto-layout before child FILL) in the figma-guidelines skill.
- **Note**: Same silent-no-op-reports-success family as [BUG-009]. Not in the Phase 6 auto-fix allowlist.

### [AGENT-017] Batch sibling reads with multi-nodeId `get` — [#55](https://github.com/dabowman/Figmagent/issues/55)
- **Status**: verified
- **Verified in**: production audit 2026-06-19 — #55 confirmed fixed in code: CLAUDE.md: batch sibling reads via nodeIds array in one read
- **Priority**: P2
- **Category**: agent-behavior
- **First seen**: Session 23 (2026-03-24)
- **Sessions affected**: 23, 26
- **Estimated savings**: ~8 calls per structure-sweep
- **Description**: The initial structure sweep used 12 individual `get` calls (one per sibling section: `34:445`, `34:31`, `34:103`, …) plus a duplicate `get(34:2)`. `get` accepts a `nodeIds` array (used effectively in session 22) — the sibling sections could have been read in 1–2 batched calls. Recurred identically in session 26 (same imported-webpage workflow, different file): 12 individual section `get`s (`9:590`, `9:4`, `9:31`, … + a `9:2` dup).
- **Proposed fix**: When inspecting a known set of sibling nodes (e.g. all sections under a body), pass them as a `nodeIds` array in one `get`. Reinforce in CLAUDE.md / figma-guidelines.

### [TOOL-017] Batch `export_node_as_image` / `screenshot` — [#56](https://github.com/dabowman/Figmagent/issues/56)
- **Status**: implemented
- **Priority**: P2
- **Category**: missing-batch-tool
- **First seen**: Session 24 (2026-03-25)
- **Sessions affected**: 24
- **Estimated savings**: ~10 round-trips per multi-slide/multi-node review
- **Description**: Session 24 exported 15 slides one at a time (#22–36), all sequential (not even parallelized). No batch variant exists.
- **Proposed fix**: Add a multi-node export accepting a `nodeIds` array, returning images keyed by nodeId with a payload cap. Below the strict 20-consecutive batch-tool threshold but a clear pattern. Interim agent-side: issue exports in parallel batches.
- **Current status**: Implemented — `screenshot` accepts a `nodeIds` array. Verified in Session 34: agent-ab #5 and agent-a0 #24 each verified all 4 Omnibar variants in one batched `screenshot {nodeIds:[...]}` call. (Note: the *single-node* remote screenshot path is intermittently broken — see [BUG-016].)

### [AGENT-018] Fail-fast on Read "exceeds maximum allowed tokens" — [#58](https://github.com/dabowman/Figmagent/issues/58)
- **Status**: verified
- **Verified in**: production audit 2026-06-19 — #58 confirmed fixed in code: CLAUDE.md: on Read 'exceeds maximum allowed tokens', use offset/limit or Bash; never re-Read
- **Priority**: P2
- **Category**: agent-behavior
- **First seen**: Session 24 (2026-03-25)
- **Sessions affected**: 24
- **Estimated savings**: ~3 calls per large-overflow-file session
- **Description**: A recurrence of the [AGENT-001] fail-fast principle on the Read tool. `scan_text_nodes` overflowed to `tool-results/…txt` (46,811 tokens); the agent then `Read` that file **4 times**, getting the identical `"File content (46811 tokens) exceeds maximum allowed tokens (10000). Use offset and limit…"` error each time before switching to Bash. MCP overflow dumps routinely exceed Read's 10K-token cap.
- **Proposed fix**: Add to CLAUDE.md: "On a Read 'exceeds maximum allowed tokens' error, immediately switch to offset/limit or Bash — never re-Read the whole file." Tie to [TOOL-009]-family pagination so the overflow dump is openable in the first place (split into ≤10K-token chunks).

### [BUG-011] `set_text_content` on instance-override text nodes times out — [#59](https://github.com/dabowman/Figmagent/issues/59)
- **Status**: identified
- **Priority**: P1
- **Category**: plugin-bug
- **First seen**: Session 25 (2026-03-24)
- **Sessions affected**: 25
- **Estimated savings**: ~12 calls per instance-heavy text session
- **Description**: Writing text to nested **instance-override** text nodes (ID format `I<instanceId>;<childId>`, e.g. `I58:128;4:60`) repeatedly exceeds the 30s command timeout, while writes to regular text nodes succeed instantly. Session 25: `I58:128;4:60` timed out 4× before succeeding ("Start Sync"); `I58:50;13:172` timed out 2× before succeeding ("Production"); regular node `58:42` wrote immediately. The op eventually succeeds, so it's a performance issue, not a hard failure — but the slow op masquerades as a disconnect and triggered 3 unnecessary reconnections ([AGENT-014]). Timeout responses returned `is_error: false` ([BUG-008]).
- **Proposed fix**: Profile the instance-override text-write path in `setcharacters.js` / `apply.js` — likely re-resolving the instance tree or reloading fonts on every call. Cache the resolved override node and/or emit progress updates to reset the inactivity timeout (as other long ops do). Verify whether `set_multiple_text_contents` over instance overrides shares the cost.
- **Note**: Error string is "Request to Figma timed out" (performance), not the sync-to-async trigger — not in the Phase 6 auto-fix allowlist. Related: [AGENT-014] (don't reconnect on slow ops), [BUG-008] (flag timeouts as errors).

### [BUG-012] `lint_design` crashes with "cannot read property 'type' of undefined" on certain nodes — [#62](https://github.com/dabowman/Figmagent/issues/62)
- **Status**: verified
- **Verified in**: production audit 2026-06-19 — #62 confirmed fixed in code: lint.js:149/404/411 prop()/Array.isArray guards; non-SOLID paints skipped before .type deref
- **Priority**: P1
- **Category**: plugin-bug
- **First seen**: Session 26 (2026-03-24)
- **Sessions affected**: 26
- **Estimated savings**: ~15 calls per occurrence (manual find+apply workaround)
- **Description**: `lint_design` threw `"Error running lint_design: cannot read property 'type' of undefined"` on the root frame (`9:2`), the page (`0:1`), and 3 sections (nav, footer, pricing). The crash forced the agent to lint per-section and then manually bind tokens on the crashing sections via `find` + `apply` (30 bindings on pricing alone). Agent's evidence points to gradient fills (`9:227`) as the trigger. The crash returns `is_error: false` ([BUG-008]).
- **Proposed fix**: Add defensive `prop(node, "type")` guards in `lint.js`'s `collectNodes`/traversal and handle GRADIENT paint types explicitly (skip or match gradients rather than dereferencing undefined `.type`). A missing strict-guard read at a traversal/serializer boundary — the documented remote-VM hazard. Reproduce with a frame containing a gradient fill.
- **Note**: "cannot read property 'type' of undefined" is a null-guard fix, not in the Phase 6 auto-fix allowlist (sync-to-async / type-coercion / missing-batch-tool) — no auto-plan generated. Related: [BUG-008] (flag the crash as an error).

### [BUG-013] `fig.bindVariable` (run_script stdlib) doesn't bind stroke paints — [#63](https://github.com/dabowman/Figmagent/issues/63)
- **Status**: verified
- **Verified in**: production audit 2026-06-19 — #63 confirmed fixed in code: apply.js:135-149 binds strokes via setBoundVariableForPaint; stdlib.js:45-52 fig.bindVariable throws on warning
- **Priority**: P1
- **Category**: plugin-bug
- **First seen**: Session 27 (2026-06-16, remote transport)
- **Sessions affected**: 27
- **Estimated savings**: ~3 `run_script` calls + 1 verification lint per stroke-binding task
- **Description**: In a `run_script`, `fig.bindVariable` reported binding 124 grid-line strokes ("0 skipped") but nothing persisted — it silently returns warnings instead of binding stroke paints. The agent verified via lint (strokes unchanged) and on a single node (still raw `#dcd7cb`), diagnosed that `fig.bindVariable` doesn't handle stroke paints, and switched to the proper Plugin API `setBoundVariableForPaint`, which worked (124 bound). Documented in project memory `fig-bindvariable-stroke-bug.md`.
- **Proposed fix**: In the `run_script` stdlib (`stdlib.js`), make `fig.bindVariable` handle stroke paints via `setBoundVariableForPaint` (mirror the fill path for `strokes`), and throw on warnings instead of returning a silent no-op so a failed bind can't masquerade as success.
- **Note**: Plugin-stdlib logic fix, not in the Phase 6 auto-fix allowlist — no auto-plan generated.

### [BUG-014] Remote transport: document overview lists only one page; no live selection — [#64](https://github.com/dabowman/Figmagent/issues/64)
- **Status**: identified
- **Priority**: P2
- **Category**: plugin-bug
- **First seen**: Session 27 (2026-06-16, remote transport)
- **Sessions affected**: 27, 33, 34
- **Estimated savings**: ~3 reads per remote multi-page session
- **Description**: On the headless remote transport, `read` with no nodeId returned only "Page 1" (`0:1`) as the document overview, even though the user's selected node (`198:1567`) lived on a different page ("Architecture — Slide", `156:749`). `get_selection` also returned nothing (no live selection in a headless VM). The agent had to read the link's node and trace ancestry across multiple `read` calls to find the real parent page.
- **Proposed fix**: On remote, enumerate **all** pages in the document overview (or note that more exist), and add a helper to resolve a node's parent PAGE directly. Document the headless `get_selection` limitation and "call `use_file` before the first `read`" in the remote section of CLAUDE.md.
- **Companion skill doc**: [#65](https://github.com/dabowman/Figmagent/issues/65) — remote-first onboarding (use_file before first read; get_selection unavailable).

### [TOOL-018] No tool to import/enumerate library VARIABLES (only components) — [#66](https://github.com/dabowman/Figmagent/issues/66)
- **Status**: verified
- **Verified in**: production audit 2026-06-19 — #66 confirmed fixed in code: libraries.ts:599 get_enabled_library_variables + :640 import_library_variable (Plugin API)
- **Priority**: P2
- **Category**: missing-tool
- **First seen**: Session 28 (2026-06-09)
- **Sessions affected**: 28
- **Estimated savings**: unblocks library-variable binding (currently impossible)
- **Description**: Session 28 needed WPDS gap/font-size variables, but: (a) `get_library_variables` 403s (Enterprise-only REST — [AGENT-008]), (b) `get_design_system` showed none imported locally, and (c) there is **no MCP tool wrapping the Plugin's library-variable API** — `import_library_component` handles **components only**, not variables. The agent correctly concluded WPDS variable binding was "genuinely not mechanically possible" and pivoted to a report-only px inventory.
- **Proposed fix**: Add a tool wrapping `getAvailableLibraryVariableCollectionsAsync` + `importVariableByKeyAsync` so agents can enumerate and import library variables enabled for the current file — no REST, no Enterprise token, no source file open. The variables analog of `import_library_component`.
- **Note**: missing-tool capability gap, not in the Phase 6 auto-fix allowlist.

### [AGENT-019] Create variables WITH scopes (lint disambiguation needs them) — [#67](https://github.com/dabowman/Figmagent/issues/67)
- **Status**: verified
- **Verified in**: production audit 2026-06-19 — #67 confirmed fixed in code: CLAUDE.md: pass scopes inline to create_variables for lint disambiguation
- **Priority**: P2
- **Category**: agent-behavior
- **First seen**: Session 28 (2026-06-09)
- **Sessions affected**: 28, 29
- **Estimated savings**: ~2 calls per token-creation session (re-scope + re-lint)
- **Description**: When variables are created without `scopes`, the first `lint_design` pass can't disambiguate same-value tokens (e.g. a frame-fill token vs a text-fill token), returning many "ambiguous" issues that can't auto-bind. Session 29: 28 vars created with default scopes → 33 ambiguous fills → `update_variables` to set scopes → re-lint → 172/204 auto-bound. Session 28 hit the same.
- **Proposed fix**: Agent-behavior — set `scopes` at creation time on `create_variables` (frame fills vs text vs strokes) when the variables are intended for lint auto-binding. Reinforce in the design-tokens workflow note in CLAUDE.md.

### [TOOL-019] No tool to set component-property values on an instance — [#68](https://github.com/dabowman/Figmagent/issues/68)
- **Status**: verified
- **Verified in**: production audit 2026-06-19 — #68 confirmed fixed in code: tools/apply.ts:148 componentProperties → apply.js:307-345 setProperties on instance
- **Priority**: P2
- **Category**: missing-tool
- **First seen**: Session 29 (2026-06-01)
- **Sessions affected**: 29
- **Estimated savings**: unblocks toggling instance props (currently manual)
- **Description**: Session 29 imported a WPDS error Notice that came with its default 3 action buttons + dismiss, but the app's Notice has none. The agent found `set_instance_overrides` "only copies overrides between instances — it can't toggle the Notice's `Actions?` boolean" and had to note it for a manual one-click toggle in Figma. No tool sets a component-property **value** (BOOLEAN/VARIANT/INSTANCE_SWAP) on an existing instance — `component_properties` defines props on local components; `set_instance_overrides` copies between instances.
- **Proposed fix**: Allow setting component-property values on an instance via `apply` (e.g. `{ nodeId, componentProperties: { "Actions?": false } }`) or a dedicated tool. Distinct from [AGENT-010] (exposed instances vs INSTANCE_SWAP).

### [BUG-015] Remote transport requires EDITOR access to READ (view-only files unreadable) — [#70](https://github.com/dabowman/Figmagent/issues/70)
- **Status**: identified
- **Priority**: P1
- **Category**: plugin-bug
- **First seen**: Session 33 (2026-06-17, external WordPress-Admin-Environment, remote transport)
- **Sessions affected**: 33
- **Estimated savings**: unblocks read-only/design-to-code on view-only files (currently impossible on remote)
- **Session 34 corroboration**: Same external project, but with **editor** access the agent completed a large remote *write* (88-var rename + 60 binds + component swaps across 4 variants) with no access errors. Confirms the edit-access wall is the sole blocker — given editor scope, remote reads AND writes are production-grade. The gap is purely that *view-only* access can't read.
- **Description**: On the **remote transport**, all `read` operations failed with `"Error reading nodes: Looks like you don't have edit access to this file. The file owner can share it with you and make you an editor."` (`is_error: false`) — even though `use_file` resolved/connected to the file fine. The user had only **view** access. Figmagent's remote-transport identity (the `use_figma` VM / official-MCP path it rides) requires **editor** scope even for reads. The agent fell back to the official figma MCP (`mcp__plugin_figma_figma__get_metadata`), which read the view-only file successfully. This blocks the most common read-only case: consuming a shared library file you don't own.
- **Proposed fix**: Remote-transport reads should use a path that accepts **view** access (read/metadata), reserving editor scope for writes. At minimum, the error should name the limitation and point to the plugin transport or official figma MCP for view-only files.
- **Note**: Auth/transport behavior, not in the Phase 6 auto-fix allowlist. Related: [BUG-014] (remote read friction), [BUG-008] (flag as error). The official figma MCP reads view-only files; Figmagent remote does not.

### [BUG-016] Remote `screenshot` returns a malformed result → MCP `-32602 invalid_union`
- **Status**: identified
- **Priority**: P1
- **Category**: plugin-bug
- **First seen**: Session 34 (2026-06-19, external WordPress-Admin-Environment, remote transport)
- **Sessions affected**: 34
- **Estimated savings**: ~6 calls per verification-heavy session (removes the 3-call official-MCP screenshot fallback)
- **Description**: On the remote transport, `mcp__Figmagent__screenshot` intermittently fails with `MCP error -32602: Invalid tools/call result: [{ "code": "invalid_union", ... "path": ["type"], "message": "Invalid input: expected \"text\"" }, { "expected": "string", "code": "invalid_type", "path": ["text"] ...}]` — the returned content block is neither a valid `text` nor `image` block, so the SDK rejects the whole result. **Intermittent and single-node-only**: failed on main #44 (`4:608`), agent-ab #6 (`4:383`), agent-ab #22 (`4:608`), while a *batched* `screenshot {nodeIds:[...]}` (agent-ab #5) and 8 single-node screenshots in agent-a0 succeeded. Correlates with larger/complex nodes and a ~2.9KB truncated payload — likely an oversized or error-stringified image block escaping into the content array. Agent recovered well (retry, or fall back to official `figma get_screenshot` → curl asset → Read, a 3-call dance).
- **Proposed fix**: In the remote `screenshot`/`export` result path, guarantee the content block conforms to the MCP `image` schema (base64 `data` + `mimeType`); cap/handle oversized exports rather than emitting a malformed union member; on export failure return a proper `is_error` text block instead. Reproduce by screenshotting a large/complex single node on remote.
- **Note**: Result-serialization fix, not in the Phase 6 auto-fix allowlist (sync-to-async / type-coercion / missing-batch-tool) — no auto-plan generated. Related: [TOOL-017] (batch screenshot works; single-node path is the broken one), [BUG-008] (a malformed result should surface as a clean error).

### [TOOL-020] No way to read a variable's resolved numeric value on remote
- **Status**: identified
- **Priority**: P1
- **Category**: missing-tool
- **First seen**: Session 35 (2026-06-19, external vip-workflows, remote transport)
- **Sessions affected**: 35
- **Estimated savings**: ~20 calls per exact-match token-binding task (eliminates probe-frame harvesting)
- **Description**: Binding numeric props (fontSize, line-height, padding, gap, radius) to **exact-matching** theme tokens requires each token's resolved numeric value, but there is no way to read it on remote: `read` (FSGN) omits `fontSize`/`lineHeight` numerics from node output; `get_design_system` returns **no local variables** when the file binds *library* (imported) variables (and imported library variables never surface as "local" even after `import_library_variable`); the Figma library API returns *keys* not values; and the design-system MCP `get_design_tokens` lists names not numeric values. Session 35 the agent built an empirical "probe frame harvesting" workaround — create 6 scratch frames, bind FLOAT tokens to readable numeric slots (width/height/padding/itemSpacing/cornerRadius), read the resolved numbers back, iterate across scope-enforced fields (~9–15 calls of pure workaround) — before switching to `run_script` to read `fontSize`/`lineHeight`/`boundVariables` directly.
- **Proposed fix**: (a) include resolved `fontSize`/`lineHeight`/`letterSpacing` numerics in FSGN `read` output, and/or (b) extend `get_design_system`/`get_enabled_library_variables` to resolve imported library-variable values (numeric + color). Interim agent guidance: on remote, reach for `run_script` immediately for value-matching tasks rather than probe-harvesting.
- **Note**: Capability gap, not in the Phase 6 auto-fix allowlist — no auto-plan generated.

### [TOOL-021] `search_library_components` has no multi-query batch
- **Status**: identified
- **Priority**: P1
- **Category**: missing-batch-tool
- **First seen**: Session 35 (2026-06-19, external vip-workflows, remote transport)
- **Sessions affected**: 35
- **Estimated savings**: ~10 calls per icon-heavy session
- **Description**: 16 `search_library_components` calls, each searching for **one** glyph (chevron-up/down, kebab/more, pencil, bell, list, lock, warning, arrowhead, …) — calls 32–43 are 12 back-to-back single-glyph searches; 4 more later. The tool accepts a single query string with no array form.
- **Proposed fix**: Accept `queries: string[]` (or comma-separated) and return grouped results per query in one round-trip. Sibling to [TOOL-013] (batch `get_component_variants`) and [TOOL-012] (batch `import_library_components`).

### [BUG-017] Imported-but-unbound library variables are garbage-collected by Figma
- **Status**: identified
- **Priority**: P2
- **Category**: plugin-bug
- **First seen**: Session 35 (2026-06-19, external vip-workflows, remote transport)
- **Sessions affected**: 35
- **Estimated savings**: ~3 calls per multi-pass binding task (re-import + retry)
- **Description**: A library variable imported via `import_library_variable` but not bound in the same operation is **garbage-collected by Figma** before a later bind references it. Session 35: a nearest-token snapping pass failed for `gap/md`=12 and `radius/lg`=8 with "Variable not found" because those tokens were imported in an earlier exact-match pass but never bound (the exact-match pass found no node needing them), so Figma GC'd them. The partial-fail `edit` (call 130) returned 13/24 nodes edited with a clear "Variable not found … pass the full VariableID" fix; agent re-imported and retried successfully.
- **Proposed fix**: Agent-behavior + tool — import and bind variables in the same operation; or have `edit`/`run_script` re-import a referenced library variable on-the-fly if it's missing. At minimum document the GC behavior in the design-tokens workflow note.

### [AGENT-019] `lint --autoFix` only binds local variables; prefer batch import + run_script for value-matching
- **Status**: identified
- **Priority**: P2
- **Category**: agent-behavior
- **First seen**: Session 35 (2026-06-19, external vip-workflows, remote transport)
- **Sessions affected**: 35
- **Estimated savings**: ~4 calls (avoids a useless lint pass + singular-import overhead)
- **Description**: Two agent-behavior gaps in Session 35: (1) the file bound everything to *library* (imported) variables, so `lint` ran but couldn't auto-bind anything — lint only matches *local* variables; the agent ran one lint, discovered this, and bound manually. (2) The agent used the **singular** `import_library_component` 11 times when the batch `import_library_components` (plural, [TOOL-012], verified Session 29) exists — contiguous groups (e.g. 6 icons in a row) were batchable.
- **Proposed fix**: Add to figma-guidelines: "`lint --autoFix` only binds *local* variables — when a file binds library/imported variables, bind manually via `edit({variables})`/`run_script`." And: "prefer `import_library_components` (plural) when importing 3+ components; reserve the singular for the prototype-one step."

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
| 6 | 2026-03-13 | 74 | 5 | ~68% | 3 (4.1%) | 0 | 1 | 0 |
| 7 | 2026-03-13 | 30 | 4 | ~40% | 3 (10%) | 0 | 1 | 0 |
| 8 | 2026-03-16 | 153 | 9 | ~10% | 0 (0%) | 0 (dev) | 0 | 2 |
| 9 | 2026-03-16 | 17 | 4 | ~53% | 7 (41.2%) | 0 | 1 | 0 |
| 10 | 2026-03-13 | 23 | 2 | ~30% | 5 (21.7%) | ~30 | 0 | 0 |
| 11 | 2026-03-16 | 52 | 4 | ~48% | 9 (17.3%) | ~10 | 1 | 0 |
| 12 | 2026-03-16 | 105 | 1 | ~81% | 2 (1.9%) | 0 | 3 | 0 |
| 13 | 2026-03-16 | 37 | 9 | ~38% | 5 (13.5%) | 0 | 2 | 0 |
| 14 | 2026-03-16 | 17 | 2 | ~18% | 0 (0%) | 0 | 1 | 0 |
| 15 | 2026-03-16 | 137 | 1 | ~25% | 5 (3.6%) | ~38 | 3 | 0 |
| 16 | 2026-03-16 | 77 | 5 | ~23% | 9 (11.7%) | ~15 | 0 | 0 |
| 17 | 2026-03-16 | 216* | 10 | ~35% | 14 (14.1%) | ~540 vars + 18 styles + 1 component | 4 | 0 |
| 18 | 2026-03-23 | 279 | 16 (soft) | ~18% | 6 (2.2%) | 48 library instances + 8 section frames | 2 | 0 |
| 19 | 2026-03-19 | 46 | 3 | ~22% | 7 (15.2%) | 1 component (5 nodes) | 2 | 0 |
| 20 | 2026-03-23 | 30 | 0 (3 soft) | ~30% | 5 (16.7%) | 1 contact form (instances + frames) | 1 | 0 |
| 21 | 2026-04-20 | 23 | 0 (1 soft) | ~25% | 2 (8.7%) | 0 (repaired 21 text nodes) | 1 | 0 |
| 22 | 2026-03-30 | 112 | 4 (2 soft) | ~14% | 5 (4.5%) | 11 components + 30 instances + 9 vars + 11 styles | 2 | 0 |
| 23 | 2026-03-24 | 68 | 0 | ~20% | 8 (11.8%) | 0 (auto-layout conversion of 9-section page) | 2 | 0 |
| 24 | 2026-03-25 | 39 | 6 | ~30% | 5 (12.8%) | 0 (read-only: 42-slide deck → brand guidelines doc) | 2 | 0 |
| 25 | 2026-03-24 | 74 | 0 (10 soft) | ~27% | 11 (14.9%) | 2 frames (66+ nodes) + tokens + annotations | 1 | 0 |
| 26 | 2026-03-24 | 85 | 1 (6 soft) | ~28% | 11 (12.9%) | 20 vars + 9 radii + 15 styles, applied to landing page | 1 | 0 |
| 27 | 2026-06-16 | 25 | 1 (1 silent) | ~22% | 4 (16%) | 0 (remote lint + bound 124 strokes; first post-rename/remote session) | 2 | 0 |
| 28 | 2026-06-09 | 33 | 0 (3 soft) | ~20% | 5 (15.2%) | 1 var + 77 nodes bound/corrected across 4 screens | 1 | 0 |
| 29 | 2026-06-01 | 161 | 0 (4 soft) | ~18% | 17 (10.6%) | App Shell + My Dashboard vertical (28 vars, atoms, WPDS imports, full states) | 2 | 1 |
| 30 | 2026-06-09 | 2 | 0 (1 soft) | n/a | 1 (50%) | 0 (connectivity check — multi-file picker) | 0 | 0 |
| 31 | 2026-05-27 | 42 (3 figma) | 0 | ~0% | 1 | 0 (design-to-code: read WPDS SiteHub → CSS) — **external: WordPress-Admin-Environment** | 0 | 0 |
| 32 | 2026-06-02 | 189 (6 figma) | 0 (1 soft) | ~0% | 3 | 0 (design-to-code: WPDS _Page/Header → React) — **external: WordPress-Admin-Environment** | 0 | 0 |
| 33 | 2026-06-17 | 12 (9 figma) | 0 (6 soft) | ~60% (blocked) | 2 | 0 (remote read blocked by edit-access → official-MCP fallback) — **external: WordPress-Admin-Environment** | 1 | 0 |
| 34 | 2026-06-19 | 61 main / 175 w/agents | 9 | ~15% | 6 (9.8%) | **first successful remote WRITE**: 88 vars renamed + 60 token binds + Dark pinned + icon/IconButton swaps across 4 Omnibar variants — **external: WordPress-Admin-Environment** | 1 (BUG-016) | 0 |
| 35 | 2026-06-19 | 134 | 4 | ~25% | 7 (5.2%) | board cleanup + 10 components reparented + 11 hand-drawn icons → @wordpress/icons instances + 214 numeric fields bound to @wordpress/theme — **external: vip-workflows** | 4 (TOOL-020/021, BUG-017, AGENT-019) | 0 |

## Issue Categories

- `missing-batch-tool` — tool exists but lacks batch variant
- `plugin-bug` — bug in Figma plugin code
- `type-coercion` — MCP server rejects valid-but-wrong-type input
- `missing-tool` — capability gap requiring new tool
- `agent-behavior` — prompt/skill improvement needed
- `infrastructure` — WebSocket, reconnection, schema freshness
