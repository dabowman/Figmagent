# Figmagent Improvement Tracker

Last updated: 2026-08-26
Sessions analyzed: 48 (session 42 covers an 11-session placeholder cohort)

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
- **Description**: Agent rediscovers same tools repeatedly. 33 calls in session 1 (10.7%), 28 in session 2 (7.2%), 35 in session 5 (13.5%), 8 in session 4 (14.3%), 3 in session 6 (4.4%), 2 in session 7 (8.3%), 7 in session 9 (43.8% — worst ratio). Session 18: only 6 calls (2.2%) — best ratio. Session 19: 7 calls (15.2%) — short session with high ratio. Session 20: 5 calls (16.7%). Session 21: 2 calls (8.7%). Session 22: 5 calls (4.5% — good ratio for a 112-call session). Session 23: 8 calls (11.8% — one re-search after a multi-file `join_channel`). Session 24: 5 calls (12.8% — re-search after multi-file `join_channel`). Session 25: 11 calls (14.9% — worsened by 3 reconnections). Session 26: 11 calls (12.9%). Session 27: 4 calls (16% — short remote session). Session 28: 5 calls (15.2%). Session 29: 17 calls (10.6% — good ratio for a 161-call session). Session 34: 6 calls (9.8% — **external repo**, where Figmagent + official-figma + design-system tools are ALL deferred and must be ToolSearched; the "No ToolSearch needed" CLAUDE.md note only holds in-repo where the MCP server enumerates tools). Session 37: 9 calls (11.7% — **external repo**, same deferred-tools cause as 34). Worst after reconnections or in short sessions where overhead ratio is high.
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
- **Sessions affected**: 18, 25, 26, 28, 29, 30, 32, 33, 37 (30/32 = the multi-file picker is also an "Error…" string with `is_error: false`; 33 = the remote "you don't have edit access" block also returns `is_error: false` — see [BUG-015]; 32/33/37 are external WordPress-Admin-Environment sessions. **Session 37 is the strongest single-session evidence: three distinct failure shapes — `import_library_component` "Component … not found", `get_library_components` REST 404, and `read` "Node not found" — ALL returned `is_error: false`** on the remote path)
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
- **Status**: implemented
- **Priority**: P1 (raised from P2 — 3rd recurrence, exact fix location known)
- **Category**: plugin-bug
- **First seen**: Session 19 (2026-03-19)
- **Sessions affected**: 19, 35, 40
- **Estimated savings**: ~1 call per component with corner radius tokens
- **Description**: `apply` with `variables: { cornerRadius: "VariableID:..." }` only binds `topLeftRadius`. To bind all four corners, the agent must make a second call with `topLeftRadius`, `topRightRadius`, `bottomLeftRadius`, `bottomRightRadius` individually. The tool should auto-expand `cornerRadius` to all four corners. **Session 35**: recurred — a `run_script` bind reported 129 binds but a verification scan counted only 119; the 10-field gap was all `cornerRadius` binding only `topLeftRadius`. Agent caught it via post-write reconciliation and rebound all four corners explicitly. **Session 40**: recurred again, and the root cause is now pinpointed — `FIELD_MAP` in `src/figma_plugin/src/commands/styles.js:1128` maps `cornerRadius: "topLeftRadius"`, so `bindVariableToNode` (`apply.js:151`) calls `node.setBoundVariable("topLeftRadius", …)` and returns `null` (no warning) — `edit` then reports `{"success":true,"nodesEdited":2}` for a 1-of-4 application. The agent observed *"the corner radius binding only applied to the top-left corner"*, rebound all four explicitly, but verified with `read(detail: "layout")` which omits `variableBindings` ([AGENT-024]), so the fix was only truly settled via `run_script`.
- **Proposed fix**: In `bindVariableToNode` (`src/figma_plugin/src/commands/apply.js`), expand a `cornerRadius` field to all four corner properties (`topLeftRadius`, `topRightRadius`, `bottomLeftRadius`, `bottomRightRadius`) instead of the single `FIELD_MAP` lookup; at minimum return a warning naming the corners that were not bound.
- **Auto-fixable**: yes (fan-out at the `FIELD_MAP` lookup in `apply.js`; one file, no schema change)
- **Note**: outside the Phase 6 auto-fix allowlist (it changes binding *semantics*, not just a type or signature) — no auto-plan generated despite 3 recurrences; needs an explicit go-ahead.
- **Fixed 2026-08-20**: `bindVariableToNode` (`apply.js`) now fans a `cornerRadius` field out to all four corner properties instead of the single `FIELD_MAP` lookup. Nodes exposing only some corners bind what they have and return a `partial_corner_binding` warning naming the rest; a node with no corner properties fails via `fail()` with the node types that do. `FIELD_MAP` is unchanged (still used for the explicit per-corner fields, which continue to bind exactly one corner). 6 tests in `tests/corner-radius-and-use-file.test.ts`, including a regression test pinning that a FRAME gets 4 binds rather than the old 1. Closes #94.

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
- **Sessions affected**: 27, 33, 34, 36, 38, 43, 44, 45
- **Estimated savings**: ~3 reads per remote multi-page session (session 44: caused wholesale abandonment of `read`)
- **Description**: On the headless remote transport, `read` with no nodeId returned only "Page 1" (`0:1`) as the document overview, even though the user's selected node (`198:1567`) lived on a different page ("Architecture — Slide", `156:749`). `get_selection` also returned nothing (no live selection in a headless VM). The agent had to read the link's node and trace ancestry across multiple `read` calls to find the real parent page. **Session 36 (design-to-code, external vip-workflows, remote):** recurrence of the onboarding half — the agent issued `read` (#5) and `screenshot` (#6) *before* `use_file` and both failed with `"No Figma file selected. Pass a file URL to use_file…"`; it then called `use_file` with the node's figma.com URL and both succeeded. It had the URL the whole time (used it as `use_file`'s `channel`) — leading with `use_file` would have saved 2 calls. Reinforces the companion-doc proposal [#65] (use_file before first read on remote). **Session 38 (component-set build, external vip-workflows, remote):** same onboarding half again — `read(2010-73)` (#3) failed with `No Figma file selected`, then `use_file(<url>)` (#4) + `read` succeeded; the URL was available from the start. **Session 43 (2026-07-31, external vip-workflows, remote):** 4th occurrence of the onboarding half — `read({nodeId:"2210:680"})` (#123) failed with `No Figma file selected`, then `use_file(<full figma.com URL>)` (#124) succeeded and the identical `read` (#125) worked. URL in hand the whole time. Four independent sessions now — promote from observation to an explicit line in the remote-onboarding docs.
- **Proposed fix**: On remote, enumerate **all** pages in the document overview (or note that more exist), and add a helper to resolve a node's parent PAGE directly. Document the headless `get_selection` limitation and "call `use_file` before the first `read`" in the remote section of CLAUDE.md.
- **Recurred (6th) — the ORIGINAL page-enumeration half, with a new downstream cost**: Session 44 (2026-08-14, external vip-workflows, remote). Sessions 36/38/43 all hit the *onboarding* half; session 44 hit the half this entry was opened for. `read()` with no nodeId (#7) returned a **single** page — `{"name":"✍️ Editor","childCount":0,"pages":[…1 entry…]}` — for a file with at least four populated pages (Sidebar `2219:624`, Modals `2219:45545`, and the boards built later). The immediately following `read("2219:624", detail:"structure", depth:2)` (#9) then returned `nodeCount: 1` with no children for the Sidebar PAGE. **Consequence: the agent never called `read` again for the remaining 2h45m** and did all discovery through `run_script` — see [AGENT-025]. Two unhelpful reads 90 seconds apart were enough to cost the tool an entire 192-minute session. Promote from P2: the fix is small and the abandonment cost is not.
- **Recurred (7th) — page-enumeration half, cost now measurable in `run_script` calls**: Session 45 (2026-08-19, external vip-workflows, remote, same file as 44). `read({})` (#10) returned `{"name":"✍️ Editor","id":"116:38565","children":[],"currentPage":{"childCount":0},"pages":[…1 entry…]}` — one page, no children — for a file whose full page list script (#14) returned **20,361 characters**. Orientation cost three `run_script` calls (#8 empty page listing, #12 failed, #14 succeeded). Unlike session 44 the agent did **not** abandon `read` (3 more calls later, all useful), so the tool-abandonment cascade is not inevitable — but the page-enumeration defect is now 7 sessions deep and reproducible on demand in this file. **New sub-finding**: #12 failed with `in loadAllPagesAsync: "loadAllPagesAsync" is not a supported API` — the remote `use_figma` VM does not expose `figma.loadAllPagesAsync()`; the working form is a loop of `await page.loadAsync()`. That constraint belongs in the `run_script` tool description beside the existing `?.` / `??` / object-spread notes.
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
- **Session 37 corroboration**: The **direct sequel to Session 33** (same external project, same day). The agent opened by running `reauthenticate` to switch the remote identity to an **editor** account, after which the previously-blocked reads succeeded AND it created 135 variables + updated 83 for Dark mode with 0 failures. Re-auth-to-editor is the practical remedy for this bug; reinforces that view-only is the only thing remote can't do.
- **Description**: On the **remote transport**, all `read` operations failed with `"Error reading nodes: Looks like you don't have edit access to this file. The file owner can share it with you and make you an editor."` (`is_error: false`) — even though `use_file` resolved/connected to the file fine. The user had only **view** access. Figmagent's remote-transport identity (the `use_figma` VM / official-MCP path it rides) requires **editor** scope even for reads. The agent fell back to the official figma MCP (`mcp__plugin_figma_figma__get_metadata`), which read the view-only file successfully. This blocks the most common read-only case: consuming a shared library file you don't own.
- **Proposed fix**: Remote-transport reads should use a path that accepts **view** access (read/metadata), reserving editor scope for writes. At minimum, the error should name the limitation and point to the plugin transport or official figma MCP for view-only files.
- **Note**: Auth/transport behavior, not in the Phase 6 auto-fix allowlist. Related: [BUG-014] (remote read friction), [BUG-008] (flag as error). The official figma MCP reads view-only files; Figmagent remote does not.

### [BUG-016] Remote `screenshot` returns a malformed result → MCP `-32602 invalid_union`
- **Status**: identified
- **Priority**: P0
- **Category**: plugin-bug
- **First seen**: Session 34 (2026-06-19, external WordPress-Admin-Environment, remote transport)
- **Sessions affected**: 34, 38, 39, 41, 43, 44, 45
- **Estimated savings**: ~6–62 calls per verification-heavy session (removes the official-MCP screenshot fallback; session 43 measured 17 calls / ~8 min, session 44 measured **62 calls / ~16 min**, session 45 measured 24 calls / ~7 min)
- **Description**: On the remote transport, `mcp__Figmagent__screenshot` intermittently fails with `MCP error -32602: Invalid tools/call result: [{ "code": "invalid_union", ... "path": ["type"], "message": "Invalid input: expected \"text\"" }, { "expected": "string", "code": "invalid_type", "path": ["text"] ...}]` — the returned content block is neither a valid `text` nor `image` block, so the SDK rejects the whole result. **Intermittent and single-node-only**: failed on main #44 (`4:608`), agent-ab #6 (`4:383`), agent-ab #22 (`4:608`), while a *batched* `screenshot {nodeIds:[...]}` (agent-ab #5) and 8 single-node screenshots in agent-a0 succeeded. Correlates with larger/complex nodes and a ~2.9KB truncated payload — likely an oversized or error-stringified image block escaping into the content array. Agent recovered well (retry, or fall back to official `figma get_screenshot` → curl asset → Read, a 3-call dance).
- **Proposed fix**: In the remote `screenshot`/`export` result path, guarantee the content block conforms to the MCP `image` schema (base64 `data` + `mimeType`); cap/handle oversized exports rather than emitting a malformed union member; on export failure return a proper `is_error` text block instead. Reproduce by screenshotting a large/complex single node on remote.
- **Note**: Result-serialization fix, not in the Phase 6 auto-fix allowlist (sync-to-async / type-coercion / missing-batch-tool) — no auto-plan generated. Related: [TOOL-017] (batch screenshot works; single-node path is the broken one), [BUG-008] (a malformed result should surface as a clean error).
- **Recurred**: Benchmark run 2026-06-19 (`tests/benchmark-runs/2026-06-19-figmagent-vs-figma-mcp.md`). The Figmagent agent could not screenshot a full 390×844 login screen (same `-32602 invalid_union`, `content[0]` missing `data`) while cards / button sets / data tables exported fine — reinforcing the larger/complex-node correlation. A batch `screenshot` call also returned "0 nodes". The official Figma MCP's `get_screenshot` succeeded on the same screen, so this bug is the main self-verification gap vs. the official MCP.
- **Recurred again**: Session 38 (2026-06-19, external vip-workflows, remote). `screenshot(2010:73)` on a full "Node UI — Base components" FRAME failed with the same `-32602 invalid_union`. The agent did **not** retry/fall back this time — it abandoned the visual check and verified the built COMPONENT_SETs structurally via `read` instead. Same larger/complex-node correlation (whole base-components frame). Third independent recurrence → escalate.
- **Confirmed not agent-specific**: Session 39 (2026-06-22, benchmark orchestration). The *orchestrator's own* verification path hit it — `screenshot(2003:10153)` on the full **390×844 login screen** built by the Figmagent contestant returned the same `-32602 invalid_union`, while mid-size siblings on the same page (`2003:24/97/69`, `2007:22`, `2008:2048`) exported fine. This is the same benchmark already cited in the first "Recurred" note, now confirmed firing from the main session (not just from delegated agents) — larger/complex-node correlation holds. Diagnosed in-line, no retry storm.
- **Recurred (4th), and root-caused**: Session 41 (2026-06-29, external vip-workflows, remote) hit **both** halves in two consecutive calls. (a) Batch `screenshot({nodeIds:[3 variants], scale:2})` returned `Exported 0 node(s): none` with **`is_error: false`** — no `Errors:`, no `Truncated:` block; total failure reported as success. (b) Single `screenshot({nodeId:"2055:163", scale:2})` on the **COMPONENT_SET** returned the same `-32602 invalid_union`. Three parallel single-node calls on its child variants then succeeded, as did 6 later screenshots — so the flakiness is per-node, not per-session. **Root cause located**: `tools/export.ts:98–113` builds the single-mode response as `{ type: "image", data: result.imageData }` with **no check that `imageData` exists**; when the remote path returns a result object lacking it, the emitted block is neither a valid `text` nor `image` member and the SDK rejects the whole result — exactly the observed `invalid_union`. Two adjacent holes in the same file: the catch block (`export.ts:116–121`) returns a text error **without `isError: true`**, and the batch path (`export.ts:88–90`) only flags `ids.length === 0` as an error when `result.errors` is *also* populated — hence the silent zero-export.
- **Proposed fix (refined)**: (1) guard `result.imageData` in single mode → return a fix-stating text block with `isError: true`; (2) add `isError: true` to the `export.ts` catch block; (3) in batch mode treat `ids.length === 0` as an error regardless of `errors`. This does not repair the upstream malformed remote payload but converts an opaque protocol crash into a readable, correctly-flagged error. Escalating **P1 → P0**: 4 independent sessions, and the silent-zero variant can corrupt an agent's success/failure branching.
- **Recurred (5th) — "large node" correlation FALSIFIED, real cause is payload size**: Session 43 (2026-07-31, external vip-workflows, remote). `screenshot({nodeId:"2210:680", scale:4})` failed with the same `-32602 invalid_union` on a **261×202 FRAME with 11 descendants** — small and simple. The distinguishing variable was **`scale: 4`** (a 1044×808 render), not node complexity. **This replaces the standing "larger/complex node" hypothesis with "raster payload size"**, and a source asymmetry explains it exactly: `src/figma_plugin/src/commands/document.js:609` defines `EXPORT_MAX_PAYLOAD_CHARS = 4000000` whose own comment says the cap exists *because* "`use_figma` does `JSON.stringify` with no size guard of its own" — but that cap is applied **only in the batch path** (`document.js:673–711`). `exportSingleNode` (`document.js:626–651`) applies **no cap at all**. Uncapped single-node payload → remote returns a result lacking `imageData` → `export.ts:105–112` emits `{type:"image", data: undefined}` → `invalid_union`. Consistent with every prior data point: batch is capped and survives, single is uncapped and fails once the payload is big enough.
- **Recovery cost (worst on record) + competitive impact**: the single failure cost **17 calls and ~8 minutes**. The agent spent a `ToolSearch` to *locate the competing tool*, then made **4 `mcp__plugin_figma_figma__get_screenshot` calls** (official Figma MCP) each needing a `curl` + `Read` round trip, before returning to Figmagent. This is the concrete form of the benchmark risk already noted: [BUG-016] is the one failure mode that makes an agent abandon Figmagent mid-task for the official server.
- **Verified workaround**: `format: "SVG"` works. In session 43, two batch SVG calls (#146, #148) succeeded on the **same file and same nodes** two minutes after the PNG failure. Add this to the `screenshot` tool description as the raster-failure fallback, and note that `scale` multiplies payload size — a zero-code mitigation available today. See [TOOL-028] for making that fallback directly usable.
- **Proposed fix (v3, adds the cap)**: (0) **apply `EXPORT_MAX_PAYLOAD_CHARS` in `exportSingleNode` too**, mirroring the batch path; (1)–(3) as above, with the guard's error text naming both remedies ("re-request at a lower `scale`, or use `format: \"SVG\"`").
- **Recurred (6th) — `scale` hypothesis narrowed; recovery is now PERMANENT DEFECTION**: Session 44 (2026-08-14, external vip-workflows, remote). Three consecutive failures at 16:40 — `2230:2` (948×2208 board, `scale: 1.5`), `2230:6` (States row, **`scale: 1`**), `2230:19` (`scale: 2`) — all the same `-32602 invalid_union` with `"path": ["data"], "message": "Invalid input: expected string, received undefined"`, i.e. exactly the unguarded `tools/export.ts:105–112` block. **`scale: 1` failing refines session 43's conclusion**: payload size is still the best explanation, but it is reached by **node dimensions**, not only by `scale`. The uncapped `exportSingleNode` (`document.js:626–651`) still explains every data point. Failure was **deterministic for that board**, not flaky — 3/3.
- **Worst recovery on record — the agent left Figmagent for the rest of the session**: after 3 strikes the agent spent a `ToolSearch` (#67) locating the competitor and then ran the official Figma MCP for the remaining **2h20m**: `mcp__plugin_figma_figma__get_screenshot` → `Bash curl -sL -o <n>.png <asset-url>` → `Read <n>.png`, **×31 iterations = 92 calls** where 31 working `screenshot` calls would have done. **Net waste 62 calls (17% of the entire 369-call session), ~16 minutes.** Unlike sessions 34/39/41/43 it never retried Figmagent's `screenshot` again. This is the competitive risk in its fully realised form: for visual verification on this file, Figmagent was simply not used. v3 fix unchanged and now urgent.

- **Recurred (7th) — the defection is now ENCODED IN PERSISTENT MEMORY**: Session 45 (2026-08-19, external vip-workflows, remote, same file as 44). Call #2 of the session read `~/.claude/projects/-Users-davidbowman-Github-vip-workflows/memory/figmagent-remote-transport-workflow.md` — written at the *end of session 44* — which states verbatim: *"**Figmagent's `screenshot` tool is broken here** — it fails MCP result validation at any scale/size. Use `mcp__plugin_figma_figma__get_screenshot` (fileKey + nodeId) and `curl` the returned URL instead."* The agent tried Figmagent once anyway (#84, `screenshot({nodeId:"2323:2", scale:1})`, a 2024×2228 board), hit the identical `-32602 invalid_union`, and switched for the remaining 41 minutes. **Cost: 35 calls to accomplish 11 visual checks** — 1 failed `screenshot` + 1 `ToolSearch` (#85, locating the competitor again) + 14 official `get_screenshot` + 9 `Bash curl` + 8 `Read` + 2 diagnosing the fallback's own failure. Net waste **24 calls (13% of a 183-call session), ~7 minutes**. **The fallback is itself unreliable**: three official-MCP calls (#96 `2329:6`, #97 and #100 `2329:2`) returned **1×1-pixel, 149-byte PNGs**, which the agent had to detect with `file` (#98) and work around by screenshotting the parent (#101) — 5 further calls of fallback-path overhead. **Escalation, qualitative**: sessions 34/39/41/43 retried, session 44 defected for the rest of the session, session 45 defected *before the session began*. The recovery has crossed from behavior into state — **landing the code fix is no longer sufficient**; that memory file must be corrected in the same pass or this repo's agents will keep routing to the competitor indefinitely. v3 fix unchanged; this is now the single highest-value item in the tracker.
- **Fix implemented 2026-08-19 (commit `0af2c9a`, branch `feat/auto-improve-pipeline` — NOT yet merged)**: v3 fix landed in full. (0) `EXPORT_MAX_PAYLOAD_CHARS` now applied in `exportSingleNode` (`document.js`), throwing via `fail()` with both remedies named; batch keeps truncating so partial results survive. (1) `export.ts` never emits an image block without real string data — missing/empty `imageData` returns a fix-stating text block with `isError: true`. (2) catch block sets `isError: true`. (3) zero exported ids is an error regardless of `errors`. Tool description now documents the `format: "SVG"` fallback and that `scale` multiplies payload roughly quadratically. 16 new tests in `tests/export.test.ts`. **Also corrected the downstream memory file** `~/.claude/projects/-Users-davidbowman-Github-vip-workflows/memory/figmagent-remote-transport-workflow.md`, which had encoded the defection to the official MCP as standing guidance. Status stays `identified` until verified against a live remote session.
- **Recurred (8th) — fix VERIFIED on its two headline goals; the cap diagnosis is FALSIFIED**: Session 46 (2026-08-24, external vip-workflows, remote, same file as 44/45) is the first live remote session after `0af2c9a`. **Both goals met**: (a) **zero `-32602 invalid_union`** protocol crashes across 11 export failures — every one arrived as a readable text block with `is_error: true`; (b) **zero official-Figma-MCP calls**, under heavier provocation than either prior session (11 failures vs 3 in S44, 1 in S45). The agent diagnosed the gap in-line at 22:49:07 (*"Export of any frame containing the rail has failed from the start of this session, before my edits — so verifying by sub-frame instead"*), verified structurally via `run_script` + sub-frame screenshots, and shipped. Correcting the memory file alongside the code is what made this hold. **But the underlying export failure is untouched and the new message misdiagnoses it.** `screenshot` failed 11 / 25 (44%), all with the `export.ts:44–46` guard text blaming the "~4MB return cap". Four proofs that is wrong: (1) the cap's own error (`document.js:655–660`, *"is too large to return: N chars (max 4000000)"*) **never appears** — the observed text is the MCP-side fallback guard, which fires on absent `imageData` and *guesses* the reason; (2) `2377:38` is **220×132 px** and failed at `scale: 2`, `2372:2` is 248×327 at `scale: 1`, `2285:378` is 256×611 — none approaches 4MB; (3) **all three recommended remedies were tried and failed** — lower `scale` (`2285:370` at 1.0 → 0.5), `format: "SVG"` (`2285:378`), smaller child node (`2285:370` → `2285:378`); (4) **the same node at the same scale succeeded then failed** — `screenshot(2372:24, scale:1)` returned an image at 22:46:30 (#65) and failed at 22:53:00 (#88). **Batch drops healthy nodes with the sick one**: #69 `screenshot({nodeIds:["2285:479","2285:514","2285:627"]})` returned `Exported 0 node(s): none` with **no `Errors:` and no `Returned no image data` block** — the plugin loop produced empty `images` *and* empty `errors`, neither exporting nor catching — while #70 screenshotted `2285:479` alone at the same scale and got a clean image. Revised root cause: **the remote `use_figma` round trip returns results with payload fields silently missing**, no exception, no record. `EXPORT_MAX_PAYLOAD_CHARS` is not involved.
- **Proposed fix (v4 — make the plugin report what it produced)**: (0) add `payloadChars: base64.length` (a small scalar that survives any truncation) to `exportSingleNode`'s return, and have the batch loop record every attempted id in `images`, `errors`, or a new `dropped` list; (1) `buildSingleExportResult` then distinguishes *"the plugin rendered nothing"* from *"the plugin rendered 41,204 chars but the remote transport returned no image data"* — a true statement pointing at the transport; (2) **suppress the `scale`/`SVG`/child-node remedies when `payloadChars` is well under the cap** — this session sent the agent down three dead ends. The v3 guards stay: they converted a protocol crash into a diagnosable failure and that half is verified working. Priority stays **P0** — 44% failure rate on the primary self-verification tool. Related: **[BUG-027]** is the same silent-empty-result condition on `read`, where no guard exists at all.
- **Status note**: the v3 fix (`0af2c9a`) is **verified** for protocol-safety and defection; the export failure itself remains `identified` pending v4.
- **Recurred (9th) — ROOT CAUSE PINNED to one line, and it is not in `export.ts` or the plugin**: Session 47 (2026-08-25, external **site-foundry** — a file and project never seen before, `07plXV7PsHOrLE3hsIS0jS`). `screenshot` failed **8 / 16 (50%)**, all with the `export.ts:44-46` "~4MB cap" guard text. **Two fresh falsifications**: (a) `5:823` is a **440x655** frame and failed at `scale: 0.7` (~308x458 render); (b) `34:4` failed at `format: "SVG"`, the description's own verified fallback. Of the three recommended remedies, lower `scale` worked 2/6 (`29:18` 1->0.5, `30:26` 0.5->0.4) and SVG failed. **Root cause: `remote/client.ts:110-114`** — `callOfficialTool` does `try { return JSON.parse(text) } catch { return text }`, so when the `use_figma` response text is not parseable JSON (truncated mid-payload, or a second text content block fused on by the `.join("\n")` at `:99-102`) the **raw string escapes as if it were the result object**. Every downstream builder then reads fields off a `string` and gets `undefined`: `buildSingleExportResult` (`export.ts:34`) sees no `imageData` -> fires the cap guess; `buildBatchExportResult` (`export.ts:70-72`) sees no `images` -> `allIds`, `ids` **and** `dataless` all empty -> `Exported 0 node(s): none` with **no `Errors:` and no `Returned no image data` block** — session 47 #44's exact signature, session 46 #69's, and session 41 (a)'s. No other mechanism empties all three at once: the plugin loop always records each id in `images` or `errors`. **This also explains what payload size cannot**: SVG failing, and S46's same-node-same-scale succeed-then-fail. Size was a correlation — longer renders make longer response text, which truncates more often, which is why `scale` sometimes helps.
- **[BUG-027] is the same bug**: `buildFsgn` (`document.ts:71-92`) on a string `raw` yields `rootId`/`rootName`/`rootType` `undefined`, `raw.nodeCount ?? 0` -> `0`, `raw.rawTree ?? []` -> `[]` — S46's observed empty document exactly, missing `meta.nodeId` included. One line, two tracked bugs; fix them in one pass.
- **Proposed fix (v5 — fix the transport, not the symptom)**: (0) in `callOfficialTool`, never return unparseable text as a result — log the first ~200 chars + length and **throw** a fix-stating error (`the remote server returned N chars that are not valid JSON …`); a thrown error already routes through `runOne` and reaches the agent as `is_error: true` with a *true* statement. (1) Attempt recovery first: when `content` has >1 text block, try parsing the **last** block alone instead of the `join("\n")`. (2) Keep the `export.ts` guards but reword — they assert a cause they cannot know; say "the remote transport returned no image data" and gate the `scale`/SVG/child-node remedies on the v4 `payloadChars` scalar. Supersedes v4 items (0)/(1) as the primary fix; v4's plugin-side reporting becomes the corroborating diagnostic, not the repair.
- **Behavioural fix VERIFIED unbiased**: session 47 made **zero official-Figma-MCP calls** across 8 consecutive failures, in a project with **no corrected memory file** (the `0af2c9a` memory correction was written into `~/.claude/projects/-Users-davidbowman-Github-vip-workflows/`, which site-foundry never reads). S46's zero-defection could be credited to that memory file; this cannot. The readable `is_error: true` message alone is sufficient. Agent recovery: 2 failures -> switched to structural verification via `read`, no retry storm, no `ToolSearch` for the competitor. Cost 10 calls of 69 (~14%).
- **Recurred (10th) — payload size falsified twice more; SVG fallback fails a 2nd time**: Session 48 (2026-08-25, external **site-foundry**, remote, same file `07plXV7PsHOrLE3hsIS0jS` as session 47 — and *chronologically earlier*, 17:55-18:45 vs 19:16-19:36; this session BUILT the frames session 47 later renumbered). `screenshot` failed **13 / 41 (32%)**. **Two new independent falsifications of the size hypothesis**: (a) `5:4` is **784x453** and failed at `scale: 1` (#77) — the smallest absolute render on record to fail, ~an order of magnitude under the 4,000,000-char cap the guard text names — and the *same node* succeeded at `scale: 0.5` (#187); (b) `5:591` failed at **`scale: 0.35`** (#139) while `8:2`, the **largest board in the file** (1440x~900), succeeded at **`scale: 0.28`** 68 seconds later (#150) — if payload size were the variable the ordering would be reversed; `7:9` at 0.4 and `5:685` at 0.45 bracket the 0.35 failure on both sides. **`format: "SVG"` failed again** (#87, `5:2`) — second independent confirmation after S47 that the session-43 "verified workaround" no longer holds. **All three recommended remedies were exercised and two failed**: lower `scale` worked 2/5 and failed outright 1/5 (`5:3` 1->0.5), SVG 0/1, "smaller child" failed down a chain `5:2` -> `5:3` -> `5:4` each smaller than the last. **Batch signature recurs exactly** (#70): `Exported 0 node(s): none`, no `Errors:` block, no `Returned no image data` block — `allIds`/`ids`/`dataless` all empty at once — while #71 screenshotted one of the same five nodes alone 4 seconds later and got a clean image. Identical to S47 #44, S46 #69, S41 (a). Everything is consistent with the v5 root cause (`remote/client.ts:110-114`) and with nothing else. **v3 guards verified again**: `is_error: true` set on all 13, **zero `-32602 invalid_union`**. **Zero official-Figma-MCP calls** across 13 failures in an untutored project — a heavier provocation than S47's 8, so the behavioural fix now holds at 3 sessions. Cost 13 calls of 192 (~7%).
- **The guard text is now demonstrably harmful, not merely imprecise**: S48 is the first session where an agent tried *every* remedy the message recommends and watched two of them fail, at `scale: 0.35`, on a 784x453 node. v5 item (2) (reword to "the remote transport returned no image data" and gate the scale/SVG/child-node advice on the v4 `payloadChars` scalar) should ship even if item (0) slips.

### [TOOL-020] No way to read a variable's resolved numeric value on remote
- **Status**: identified
- **Priority**: P1
- **Category**: missing-tool
- **First seen**: Session 35 (2026-06-19, external vip-workflows, remote transport)
- **Sessions affected**: 35, 36
- **Estimated savings**: ~20 calls per exact-match token-binding task (eliminates probe-frame harvesting)
- **Description**: Binding numeric props (fontSize, line-height, padding, gap, radius) to **exact-matching** theme tokens requires each token's resolved numeric value, but there is no way to read it on remote: `read` (FSGN) omits `fontSize`/`lineHeight` numerics from node output; `get_design_system` returns **no local variables** when the file binds *library* (imported) variables (and imported library variables never surface as "local" even after `import_library_variable`); the Figma library API returns *keys* not values; and the design-system MCP `get_design_tokens` lists names not numeric values. Session 35 the agent built an empirical "probe frame harvesting" workaround — create 6 scratch frames, bind FLOAT tokens to readable numeric slots (width/height/padding/itemSpacing/cornerRadius), read the resolved numbers back, iterate across scope-enforced fields (~9–15 calls of pure workaround) — before switching to `run_script` to read `fontSize`/`lineHeight`/`boundVariables` directly. **Session 36 (design-to-code, same external repo, remote):** both `get_design_system` calls (one `namePattern` typography filter, one `collection: Typography` + `includeStyles`) returned **completely empty** payloads (`styles`/`variables`/`collections` all empty) because the file binds *library* typography styles/variables — none surface as local. The agent recovered well by grepping the **codebase token pipeline** (`@wordpress/theme` CSS output) for the `wpds-font` size/line-height numerics rather than probe-harvesting — the right move in a design-to-code context.
- **Proposed fix**: (a) include resolved `fontSize`/`lineHeight`/`letterSpacing` numerics in FSGN `read` output, and/or (b) extend `get_design_system`/`get_enabled_library_variables` to resolve imported library-variable values (numeric + color). Interim agent guidance: on remote, reach for `run_script` immediately for value-matching tasks rather than probe-harvesting; **in design-to-code, when `get_design_system` returns empty, go straight to the codebase token pipeline output** (per [AGENT-012]).
- **Note**: Capability gap, not in the Phase 6 auto-fix allowlist — no auto-plan generated.

### [TOOL-021] `search_library_components` has no multi-query batch
- **Status**: identified
- **Priority**: P1
- **Category**: missing-batch-tool
- **First seen**: Session 35 (2026-06-19, external vip-workflows, remote transport)
- **Sessions affected**: 35, 44, 45, 48
- **Estimated savings**: ~10–14 calls per icon-heavy session
- **Description**: 16 `search_library_components` calls, each searching for **one** glyph (chevron-up/down, kebab/more, pencil, bell, list, lock, warning, arrowhead, …) — calls 32–43 are 12 back-to-back single-glyph searches; 4 more later. The tool accepts a single query string with no array form.
- **Proposed fix**: Accept `queries: string[]` (or comma-separated) and return grouped results per query in one round-trip. Sibling to [TOOL-013] (batch `get_component_variants`) and [TOOL-012] (batch `import_library_components`).
- **Recurred (2nd)**: Session 44 (2026-08-14, same repo, same libraries, remote). **31** `search_library_components` calls, all single-query. Worst run is #193–#202: **10 consecutive** icon lookups against one fileKey (`caution`, `close-small`, `published`, `cancel-circle-filled`, `calendar`, `external`, `update`, `replace`, `upload`, `lock`), plus runs of 4 (#96–#99), 3 (#103–#105) and 3 (#189–#191). A `queries: string[]` form collapses ~20 calls into ~6. Second session, same shape, same file family — the pattern is stable enough to spec against.
- **Recurred (3rd)**: Session 45 (2026-08-19, same repo/file/libraries, remote). **13** calls, all single-query; worst run is #23–#31, **9 consecutive** component lookups (`Tabs`, `Toggle`, `Checkbox`, `Radio`, `Select`, `Button`, `Notice`, `TextareaControl`, `Card`), plus #33/#34, #73, #92. Collapses to ~4 with `queries: string[]`. Three consecutive sessions in the same file family — ship it alongside [TOOL-026]'s identical change.
- **Recurred (4th)**: Session 48 (2026-08-25, external site-foundry, remote — a different repo and file family from 35/44/45, so the pattern is not file-specific). **12** calls, all single-`query`; worst run is #27-#32, **6 consecutive** component lookups (`Badge`, `TextControl`, `Button`, `SelectControl`, `RadioControl`, `Notice`), plus #34-#35, #38-#40 and #42. Three of them (#38-#40) are exact-variant lookups by full variant string (`Type=Secondary, Size=Medium, State=Default, Destructive=False`) — the pattern CLAUDE.md already recommends over picking a key off a truncated `get_component_variants` list, correct behaviour and still un-batchable. Collapses to ~3 with `queries: string[]`. Fourth session, second repo — ship it with [TOOL-026]'s identical change.

### [BUG-017] Imported-but-unbound library variables are garbage-collected by Figma
- **Status**: identified
- **Priority**: P2
- **Category**: plugin-bug
- **First seen**: Session 35 (2026-06-19, external vip-workflows, remote transport)
- **Sessions affected**: 35
- **Estimated savings**: ~3 calls per multi-pass binding task (re-import + retry)
- **Description**: A library variable imported via `import_library_variable` but not bound in the same operation is **garbage-collected by Figma** before a later bind references it. Session 35: a nearest-token snapping pass failed for `gap/md`=12 and `radius/lg`=8 with "Variable not found" because those tokens were imported in an earlier exact-match pass but never bound (the exact-match pass found no node needing them), so Figma GC'd them. The partial-fail `edit` (call 130) returned 13/24 nodes edited with a clear "Variable not found … pass the full VariableID" fix; agent re-imported and retried successfully.
- **Proposed fix**: Agent-behavior + tool — import and bind variables in the same operation; or have `edit`/`run_script` re-import a referenced library variable on-the-fly if it's missing. At minimum document the GC behavior in the design-tokens workflow note.

### [BUG-018] import_library_component fails on remote transport (set_selection page-mismatch)
- **Status**: identified
- **Priority**: P0
- **Category**: plugin-bug
- **First seen**: Benchmark run 2026-06-19 (head-to-head vs official Figma MCP, remote transport)
- **Sessions affected**: benchmark-2026-06-19, 48
- **Estimated savings**: unblocks all published-library component import on remote
- **Description**: `import_library_component(s)` fails on the **remote** transport with `set_selection: selection of a page can only include nodes in that page`. Reproduced 3× (batch + single; targeting both a COMPONENT parent and a PAGE) with valid, resolved WPDS Gutenberg variant keys (no "library not found"). It blocked the WPDS compose task (benchmark prompt 13, "import Secondary/Medium + Primary/Medium Buttons → FormActions") — the only task Figmagent lost; the official Figma MCP imported the same components via `importComponentByKeyAsync` first-try. Likely the import handler calls `figma.currentPage.selection`/`setSelection` with a node not on the current page in the remote `use_figma` VM.
- **Proposed fix**: in the remote import path, don't `set_selection` on nodes outside the current page (set `currentPage` first, or drop the selection step entirely). Verify against the keys in `tests/seed/README.md` and the run in `tests/benchmark-runs/2026-06-19-figmagent-vs-figma-mcp.md`.
- **Recurred (1st in a real session) — CONFIRMED outside the benchmark, and a zero-code workaround is verified**: Session 48 (2026-08-25, external site-foundry, remote). `import_library_components` failed **10/10 across two calls** (#59 with 7 components, #61 with 3), every result carrying `Error: in set_selection: The selection of a page can only include nodes in that page` + `(atomic: no changes were applied; safe to retry)`. `parentNodeId: "4:2"` was a frame the agent had created **14 seconds earlier** on the page it was already targeting, so the "not in that page" claim is false on its face — the remote `use_figma` VM's `currentPage` is not the page the node lives on. **Verified workaround, available today with no code change**: `write({parentId, node: {type: "INSTANCE", componentKey}})` placed the same seven components first try in two calls (#62 single, #63 six-node batch). `write`'s INSTANCE path (`create.js:161`, `importComponentByKeyAsync`) appends to the parent without touching `figma.currentPage.selection`, which is exactly why it survives. **Escalating P1 -> P0**: no longer a benchmark-only loss, 100% reproducible on remote, and it blocks the primary library-composition workflow. Ship the description change ("on the remote transport use `write({type:\"INSTANCE\", componentKey})`") ahead of the code fix.

### [AGENT-020] `lint --autoFix` only binds local variables; prefer batch import + run_script for value-matching
- **Status**: identified
- **Priority**: P2
- **Category**: agent-behavior
- **First seen**: Session 35 (2026-06-19, external vip-workflows, remote transport)
- **Sessions affected**: 35, 40
- **Estimated savings**: ~4 calls (avoids a useless lint pass + singular-import overhead)
- **Description**: Two agent-behavior gaps in Session 35: (1) the file bound everything to *library* (imported) variables, so `lint` ran but couldn't auto-bind anything — lint only matches *local* variables; the agent ran one lint, discovered this, and bound manually. (2) The agent used the **singular** `import_library_component` 11 times when the batch `import_library_components` (plural, [TOOL-012], verified Session 29) exists — contiguous groups (e.g. 6 icons in a row) were batchable.
- **Session 40 recurrence**: same file family, same dead end — `lint` scanned **0 nodes** and returned *"No local variables found in this file. Create variables first to enable linting."* Two sessions in, the durable fix is tool-side, not prompt-side: see [TOOL-024], which makes `lint` and `get_design_system` detect enabled library collections and route the agent instead of returning empty.
- **Proposed fix**: Add to figma-guidelines: "`lint --autoFix` only binds *local* variables — when a file binds library/imported variables, bind manually via `edit({variables})`/`run_script`." And: "prefer `import_library_components` (plural) when importing 3+ components; reserve the singular for the prototype-one step."

### [AGENT-021] Don't pass an official-figma `libraryKey` (`lk-…`) to Figmagent REST tools (they want a Figma `fileKey`)
- **Status**: identified
- **Priority**: P2
- **Category**: agent-behavior
- **First seen**: Session 37 (2026-06-17, external WordPress-Admin-Environment, remote transport)
- **Sessions affected**: 37
- **Estimated savings**: ~2 calls per cross-MCP library task
- **Description**: `mcp__plugin_figma_figma__get_libraries` (official figma MCP) returns team libraries keyed by a 130-char `libraryKey: "lk-9c51b469…"`. The agent passed one of those `lk-…` strings to Figmagent's `get_library_components` as its `fileKey` (Session 37 call 63) → `Figma API returned 404 Not Found`. Figmagent's REST tools (`get_library_components`, `get_component_variants`, `search_library_components`) expect a **Figma fileKey** (short form, e.g. `jMgzw8IhsMC4gpMbMko4lv`), not an official-MCP library handle. The agent recovered with the real fileKey at calls 64–69. Two MCPs, two key namespaces, nothing flags the mismatch.
- **Proposed fix**: (a) Agent-behavior — never feed an `lk-`-prefixed official-MCP library key into a Figmagent REST tool; resolve the real Figma fileKey first. (b) Tool-side — `get_library_components` could detect an `lk-`-prefixed `fileKey` and return "that's an official-MCP library key, not a Figma fileKey" instead of a bare 404. Related: [AGENT-008] (REST-key/scope confusion family), [BUG-008] (404 returned `is_error: false`).
- **Note**: agent-behavior + small tool guard, not in the Phase 6 auto-fix allowlist.

### [AGENT-022] Published-library variant node IDs aren't readable in the working file — import, don't `read`
- **Status**: identified
- **Priority**: P2
- **Category**: agent-behavior
- **First seen**: Session 37 (2026-06-17, external WordPress-Admin-Environment, remote transport)
- **Sessions affected**: 37
- **Estimated savings**: ~2 calls per library-inspection flow
- **Description**: `get_component_variants(fileKey=jMgzw8…)` returned WPDS variant node IDs (`16507:33913`, `16507:33977`). The agent then `read` those IDs against the **connected WP-Admin file** (Session 37 calls 71–72) → `Node not found: 16507:33913`. Those IDs live in the **library file**, not the working file; they can't be `read` by ID in the working context — they must be imported (`import_library_component`/`import_library_components`) first. This is a recurrence of the documented CLAUDE.md hazard ("a URL-derived node ID may belong to a different file than the connected one — e.g. a library file vs the working file"), surfacing specifically in the remote + published-library flow where the guidance wasn't applied.
- **Proposed fix**: Reinforce in the libraries / figma-guidelines section: variant node IDs from `get_component_variants` belong to the library file — import them, don't `read` them in the working file. No code change. Related: [BUG-008] ("Node not found" returned `is_error: false`).

### [TOOL-022] Normalize hyphenated node IDs (Figma URL form) to colon form
- **Status**: identified
- **Priority**: P2
- **Category**: type-coercion
- **First seen**: Session 38 (2026-06-19, external vip-workflows, remote transport)
- **Sessions affected**: 38, 44
- **Estimated savings**: ~1 call per session whenever a node ID is lifted from a URL
- **Description**: Figma deep-link URLs encode node IDs with a **hyphen** (`?node-id=2010-73`), but the Plugin/MCP API expects the **colon** form (`2010:73`). Session 38 the agent called `read(nodeId: "2010-73")` (#5) straight from the URL → `Error: Node not found: 2010-73`, then retried with `read(nodeId: "2010:73")` (#6) → success. `use_file` happily accepts the full hyphenated URL, so an agent naturally reuses the same hyphenated ID for `read`/`edit`/`screenshot` and hits a one-round-trip "Node not found" stumble. (Note: here `Node not found` correctly returned `is_error: true`, unlike the `is_error:false` variants in [BUG-008]/[AGENT-022].)
- **Proposed fix**: Normalize `nodeId`/`nodeIds` at the tool boundary — coerce `^(\d+)-(\d+)$` → `$1:$2` before lookup in `read`/`edit`/`screenshot`/`grep` (and anywhere a node ID is accepted). Mirrors how `use_file` already tolerates the URL form. Trivial string fix; eliminates a recurring URL-copy failure.
- **Recurred (2nd)**: Session 44 (2026-08-14, same repo, remote). Identical shape: the user pasted `…?node-id=2219-624`, the agent called `read({nodeId:"2219-624"})` (#5) → `Error reading nodes: Error: Node not found: 2219-624`, then retried `read({nodeId:"2219:624"})` (#9) → success. The same URL was simultaneously accepted verbatim by `use_file` (#3). Two sessions, same repo, same one-line fix still outstanding.
- **Note**: String-normalization at the schema boundary — adjacent to the `type-coercion` auto-fix pattern, but applied to node-ID params rather than numeric ones; left un-planned for now since it touches multiple tool handlers' input parsing.

### [TOOL-023] No first-class page management — page CRUD falls to `run_script`
- **Status**: identified
- **Priority**: P2
- **Category**: missing-tool
- **First seen**: Session 39 (2026-06-22, this repo, benchmark orchestration)
- **Sessions affected**: 39
- **Estimated savings**: ~6 `run_script` calls per multi-round harness session; ~1–2 per ordinary multi-artifact build
- **Description**: Session 39 (benchmark orchestration) used **all 6** of its `run_script` calls for page/file-state operations, not design logic: rename Page 1 → "Fixtures" + create a "Patterns" page (#63), create a contestant run page (#93, #113), and reset the file to a pristine seed between contestants — remove the run page + non-baseline collections/styles, restore widened variable scopes, recreate the next run page (#112, #143, #157). `write`/`edit`/`delete` operate on canvas nodes, not on `PAGE` nodes or document-level collections, so page creation, renaming, deletion, and file-state reset all drop to the remote-only `run_script` escape hatch.
- **Proposed fix**: Bring page CRUD onto the first-class surface — `write({ type: "PAGE", name })` to create, `edit({ nodeId: "<page>", name })` to rename, `delete: true` on a PAGE node to remove — so multi-artifact / harness / benchmark workflows don't reach for `run_script`. (A document-level "reset to baseline" helper is a larger ask; page CRUD is the high-frequency primitive.)
- **Note**: Missing-tool (single capability, not a batch variant) — not in the Phase 6 auto-fix allowlist (sync-to-async / type-coercion / missing-batch-tool); no auto-plan generated. Rare in single-page design sessions; recurs in any multi-page or harness workflow.

### [BUG-020] `use_file` drops an unknown `url` param and reports the failed selection as success
- **Status**: implemented
- **Priority**: P1
- **Category**: plugin-bug
- **First seen**: Session 40 (2026-06-29, external vip-workflows, remote transport)
- **Sessions affected**: 40
- **Estimated savings**: ~4 calls per URL-initiated remote session
- **Description**: The agent had the file URL and correctly reached for `use_file`, but called `use_file({ url: "https://www.figma.com/design/uwhEpCvlz26oQeK0rql95G/…" })`. `use_file` (`src/figmagent_mcp/tools/scan.ts:199`) declares exactly one param — `channel`, with `.default("")` — so the unknown `url` key was silently dropped by the non-strict Zod object, `channel` became `""`, and the handler returned its empty-input message: *"Remote transport selects files by fileKey, not channels. Pass a Figma file URL … or a bare fileKey."* The agent did exactly what that says — retried with a **bare fileKey**, still via `url:` — and got the identical message. It then called `get_selection` → hard failure `No Figma file selected`, ToolSearched the schema, and finally succeeded with `use_file({ channel: "<the same URL>" })`. Six calls to select a file it had the URL for. Three compounding defects: (1) no `url`/`fileKey` alias; (2) the message says *what* to pass but never names the **parameter**, so following it verbatim loops; (3) the message doesn't match `ERROR_TEXT_PREFIX` (`instance.ts:85`), so `looksLikeError` returns false and a **failed file selection ships `is_error: false`** — which is why the agent proceeded to `get_selection` instead of retrying. Sibling of [BUG-008]; the param-name half is distinct from [BUG-014]/#65 (which covers "call `use_file` first on remote" — the agent already knew that here).
- **Proposed fix**: (a) accept `url` and `fileKey` as aliases for `channel`; (b) prefix the remote empty-input message with `Error: ` and name the parameter — e.g. `Error: no file specified. Pass the Figma file URL or fileKey as use_file's "channel" parameter (remote transport has no channels).`
- **Auto-fixable**: yes (parameter alias + error-prefix string change, both in `tools/scan.ts`)
- **Note**: mechanically safe, but the fix pattern (param alias + error-sentinel prefix) is outside the Phase 6 auto-fix allowlist (sync-to-async / type-coercion / missing-batch-tool) — no auto-plan generated; needs an explicit go-ahead.
- **Confirming evidence**: Session 43 (2026-07-31, remote) passed the full `figma.com/design/<key>/…` URL as **`channel:`** and it worked first try (`Now targeting Figma file uwhEpCvlz26oQeK0rql95G on the remote transport`). So the parameter *accepts* a URL on remote — the session 40 failure was purely the parameter **name** (`url:` silently dropped by non-strict Zod), not the value. Strengthens the case for accepting `url` as an alias rather than renaming.
- **Fixed 2026-08-20**: all three defects addressed in `tools/scan.ts`. (a) `url` and `fileKey` are now declared optional params and resolved by the exported `resolveFileTarget(channel, url, fileKey)` helper — explicit `channel` wins, then `url`, then `fileKey` — so the previously silent Zod drop cannot recur. (b) The remote empty-input message now names the **parameter**, not just the value: `Error: no file specified. Pass the Figma file URL or fileKey as use_file's "channel" parameter — e.g. use_file({ channel: "…" })`. (c) It starts with the `Error: ` sentinel AND sets `isError: true` explicitly, so a failed file selection no longer ships as `is_error: false`. 8 tests, including one pinning that the OLD message did not match `looksLikeError` — the actual cause of the agent proceeding to `get_selection`. Closes #109.

### [TOOL-024] `get_design_system` and `lint` are blind to library-only files
- **Status**: identified
- **Priority**: P0
- **Category**: missing-tool
- **First seen**: Session 40 (2026-06-29, external vip-workflows, remote transport)
- **Sessions affected**: 40, 41, 48 (tool-side form of [AGENT-020], first seen Session 35)
- **Estimated savings**: ~6 calls per library-only-file session
- **Description**: The VIP Workflow file binds **every** token to enabled team libraries (WPDS Gutenberg 22.3, Automattic Components) and has **zero local variables**. Both discovery tools no-op without saying why. `get_design_system` returned `{"variables":[],"collections":[]}` **four times** (calls 35–38) as the agent progressively loosened filters — specific regex → broad regex → `collection: "Color"` → unfiltered with `maxOutputChars: 2000` — because an empty result is indistinguishable from a bad filter; only then did it switch to `get_enabled_library_variables`. `lint(2136:630)` (call 55) returned `totalNodesScanned: 0` and `"No local variables found in this file. Create variables first to enable linting."` — advice that is actively wrong for a fully-tokenized file. The agent's verdict: *"That's a tool limitation, not a design problem"*; it hand-audited the tree instead. Root cause: `getLocalVariables` (`styles.js:178`) and `lintDesign` (`lint.js:596`) consult only `figma.variables.getLocalVariables*`, never `figma.teamLibrary.getAvailableLibraryVariableCollectionsAsync()` — which the plugin already calls at `styles.js:1184`.
- **Proposed fix**: when the local-variable set is empty **and** `getAvailableLibraryVariableCollectionsAsync()` returns ≥1 collection, both tools should say so and route: `No local variables — this file's tokens come from N enabled libraries (…). Enumerate with get_enabled_library_variables and bind with import_library_variable + edit({variables}).` This converts [AGENT-020] from agent-behavior guidance into a durable tool-side fix.
- **Note**: missing-tool (new detection branch, not a batch variant) — not in the Phase 6 auto-fix allowlist; no auto-plan generated.
- **Recurred**: Session 41 (2026-06-29, same file, ~13 minutes later). Three consecutive `get_design_system` calls returned `{"variables":[],"collections":[]}` — `namePattern` regex → `collection: ["Typography","Dimension","Border"]` + looser regex → unfiltered with `maxOutputChars: 2000` — the same progressive-loosening dead end as Session 40, because an empty result is still indistinguishable from a bad filter. The agent then switched to `get_enabled_library_variables`, which returned 13 collections immediately. **Second consecutive session in the same file, ~3–4 wasted calls each — escalating P1 → P0.** Interim agent guidance now in the Session 41 analysis: one empty payload is enough; do not loosen and retry.
- **Fix implemented 2026-08-19 (commit `0af2c9a`, branch `feat/auto-improve-pipeline` — NOT yet merged)**: new `describeEnabledLibraryVariables()` helper in `styles.js`, consumed by both `getDesignSystem` and `lintDesign`. When local variables are empty and `getAvailableLibraryVariableCollectionsAsync()` returns >=1 collection, both now name the collections and route to `get_enabled_library_variables` + `import_library_variable` + `edit({variables})`; lint additionally warns that it matches LOCAL variables only, so importing and re-linting will not surface library tokens (prevents an import/re-lint loop). Guarded exactly like `styles.js:1175`; every failure path degrades to previous behavior. `get_design_system` and `lint` tool descriptions updated. 15 new tests in `tests/library-backed-tokens.test.ts`. **Scope note**: this makes both tools explain and route — it does NOT make `lint` match library variables. That remains open as a separate capability. Status stays `identified` until verified against a live library-backed file.
- **Recurred**: Session 48 (2026-08-25, external site-foundry, remote). Both `lint` calls (#152, #188) passed all eight frame roots and both returned `totalNodesScanned: 0, totalIssues: 0` with a `roots` breakdown of eight zeroes; `get_design_system({styleType:"texts"})` (#68) returned `{"styles":{"texts":[]}}`. The routing message works as designed — it named the library collections and the correct next tools. **The new cost is verification**: #188 ran *after* the agent had bound **457 node properties** to imported library variables and still returned zero, so `lint` could not confirm any of its own binding work; the agent fell back to `read(detail: "full")` (#191). Second session in which `lint` cannot verify bindings the agent just made. The stale-collection-list bug rode along too — #152's message said "2 enabled library collections", #188's said 14 (see [BUG-029]).

### [TOOL-025] `edit` has no direct-value fields for `letterSpacing` / `textCase` / `minWidth`
- **Status**: identified
- **Priority**: P1
- **Category**: missing-tool
- **First seen**: Session 40 (2026-06-29, external vip-workflows, remote transport)
- **Sessions affected**: 40, 45
- **Estimated savings**: ~2 `run_script` calls per code-fidelity restyle
- **Description**: To match the code's `.wf-terminal-node`, the agent needed `letter-spacing: 0.4px`, `text-transform: uppercase`, and `min-width: 120px` as **literals** (raw CSS values; no tokens exist for them). It concluded *"letter-spacing, text-case, and min-width aren't available through the edit tool"* and dropped to `run_script` for the entire restyle (call 45), then again to center + min-width all 3 variants (call 52). Verified in current code: `nodeOpSchema` (`tools/apply.ts`) exposes 23 direct-value props; `minWidth`, `maxWidth`, `letterSpacing`, `lineHeight`, `textDecoration` appear **only** in the `VARIABLE_FIELDS` binding enum, and `textCase` exists nowhere in the repo. So these properties are bindable-to-a-variable but not settable as literals — an undocumented asymmetry between the two halves of `edit`. Per CLAUDE.md ("recurring scripts become tool roadmap items"), both `run_script` calls here were pure property-setting a complete `edit` would have absorbed — and script writes forfeit `edit`'s per-op error reporting and post-write assertions.
- **Proposed fix**: add `minWidth`, `maxWidth`, `minHeight`, `maxHeight`, `letterSpacing`, `lineHeight`, `textCase`, `textDecoration` as direct-value fields on `nodeOpSchema` plus the corresponding setters in `apply.js`.
- **Recurred (2nd), and add `visible`**: Session 45 (2026-08-19, external vip-workflows, remote). Script #32 dropped to `run_script` for a single assignment — `crumb.textDecoration = "UNDERLINE"` on the breadcrumb link — confirming `textDecoration`'s bindable-but-not-settable asymmetry in a second session. Scripts #123/#124 additionally needed `node.visible = false` on three instance-override sub-nodes (unused Radio options), and `visible` has the same asymmetry: it appears in `edit`'s `VARIABLE_FIELDS` binding enum (`tools/apply.ts:38`) and as a `component_properties` BOOLEAN bind target, but is **not** a direct-value field. Add `visible` to the proposed field list.
- **Note**: missing-tool (schema + setter surface) — not in the Phase 6 auto-fix allowlist; no auto-plan generated.

### [BUG-021] `grep` rejects scalar `type`/`componentId` with a raw Zod dump, and drops unknown params silently
- **Status**: identified
- **Priority**: P2
- **Category**: type-coercion
- **First seen**: Session 40 (2026-06-29, external vip-workflows, remote transport)
- **Sessions affected**: 40
- **Estimated savings**: ~2 calls per search-driven session
- **Description**: Three consecutive `grep` calls to run one search. Call 9 passed three invented params (`pattern`, `searchIn`, `nodeTypes`) → `Error: at least one search criterion is required (componentId, variableId, styleId, text, name, type, annotation, or hasAnnotation)`. The error lists the *valid* criteria but never says the supplied keys were unrecognized, so the failure reads as "too few params" rather than "wrong names." Call 10 passed `type: "COMPONENT"` (scalar) → raw `MCP error -32602` with an unformatted Zod dump (`"expected": "array", "received": "string"`) and **no stated fix**, violating the project's no-error-without-a-fix rule. Call 11 with `type: ["COMPONENT"]` succeeded. Array variant of [TOOL-006]/[BUG-005], which cover scalar type coercion.
- **Proposed fix**: `.or(z.string().transform(s => s.split(",")))` on `type`/`componentId`/`variableId`/`styleId` in `tools/find.ts`; and name unknown keys in the criterion error (`Error: unknown parameter "searchIn" … valid criteria: …`).
- **Auto-fixable**: yes (type-coercion — Zod `.or(...transform)` on the array criteria)
- **Plan**: [`.claude/plans/2026-08-19-BUG-021.md`](../plans/2026-08-19-BUG-021.md)

### [AGENT-023] `grep` defaults to the current page — pass `scope: "DOCUMENT"` on remote
- **Status**: identified
- **Priority**: P2
- **Category**: agent-behavior
- **First seen**: Session 40 (2026-06-29, external vip-workflows, remote transport)
- **Sessions affected**: 40
- **Estimated savings**: ~2 calls per remote search
- **Description**: `grep`'s `scope` param defaults to the **current page** (`tools/find.ts:30`). In Session 40 the agent's first working `grep` (call 11) returned nothing useful because the target lived on a different page than the remote VM's default; it fell back to `read({})` for a document overview (call 12) and re-narrowed (calls 13–14). The default is especially weak on the **remote** transport, where there is no live selection or meaningful "current page" ([BUG-014]) and the entry point is a URL that may point anywhere in the file.
- **Proposed fix**: (a) agent-behavior — on remote, pass `scope: "DOCUMENT"` unless deliberately scoping to one page; (b) tool-side — either default `scope` to `DOCUMENT` on remote, or add to the no-results message: *"searched the current page only — pass scope: 'DOCUMENT' to search all pages."*

### [AGENT-024] Verify variable bindings with `detail: "full"`, not `detail: "layout"`
- **Status**: identified
- **Priority**: P2
- **Category**: agent-behavior
- **First seen**: Session 40 (2026-06-29, external vip-workflows, remote transport)
- **Sessions affected**: 40
- **Estimated savings**: ~1 call + prevents a false "verified" verdict
- **Description**: After re-binding all four corner radii (call 27), the agent confirmed with `read(2017:199, detail: "layout", depth: 1)` (call 28) — a detail level that **omits `variableBindings` entirely**. The read returned layout geometry and reported success; the binding was never actually confirmed and was only truly settled later via `run_script` (call 45). A verification read at the wrong detail level is worse than no verification, because it produces a confident but vacuous "confirmed."
- **Proposed fix**: add to figma-guidelines — binding verification requires `read(detail: "full")`; `structure`/`layout` cannot show `variableBindings`. Better still, trust the write verdict once [TOOL-015] reports partial binds honestly. Related: [AGENT-016] (re-inspect vs trust the verdict).

### [BUG-022] `write({parentId})` silently drops `layoutSizing*: "FILL"` and warns with the wrong fix
- **Status**: identified
- **Priority**: P1
- **Category**: plugin-bug
- **First seen**: Session 41 (2026-06-29, external vip-workflows, remote transport)
- **Sessions affected**: 41
- **Estimated savings**: ~1 corrective `edit` + 3 misleading warnings per `write({parentId})` attach into an auto-layout parent
- **Description**: Session 41 calls 25–27 created three `accent` FRAMEs into three `StageNode` variants with `layoutSizingVertical: "FILL"`. All three returned `success` **plus** an identical `fill_not_applied` warning whose stated fix — *"ensure parent 2017:152 has layoutMode: 'HORIZONTAL' or 'VERTICAL'"* — was **wrong**: the parent already had horizontal auto-layout (confirmed by call 5's `read`). A corrective `edit` (call 28) re-applied the same FILL and succeeded with no warning. **Root cause verified in source**: the "set FILL after the node is attached" pass at `src/figma_plugin/src/commands/create.js:386` is gated on `parentNode` — the *in-tree* parent object, populated only when the node is a child within the same `write` tree. When the caller passes a top-level `parentId` instead (resolved and appended as `targetParent` at `create.js:215–227`, which never assigns `parentNode`), the block is skipped entirely; the earlier sizing pass at `create.js:332` is gated on the *node's own* `spec.layoutMode`, which a plain divider frame doesn't have. So FILL is applied on neither pass. The same gate is why the assertion's message misdiagnoses: `runPostWriteAssertions` correctly detects `FIXED ≠ FILL`, but nothing on that path ever consulted the real parent. Distinct from [TOOL-016] (`apply` layout-sizing before `layoutMode` exists) — this is the `create`/`write` path with a parent that *already* has auto-layout.
- **Proposed fix**: in the post-append pass (`create.js:386`), resolve the effective parent as `parentNode || node.parent` and use it for both the auto-layout check and the assertion's fix message. Same substitution at `create.js:352` for the TEXT `parentIsAutoLayout` default.
- **Verification**: `bun run lint` · `bun run test` · `bun run build:plugin` · `write({parentId: <auto-layout frame>, node: {type:"FRAME", width:4, layoutSizingVertical:"FILL"}})` returns no `fill_not_applied` warning and the child reports `FILL`.
- **Note**: gating/ordering fix, not in the Phase 6 auto-fix allowlist (sync-to-async / type-coercion / missing-batch-tool) — no auto-plan generated, but the root cause and exact line are pinned above. Related: [TOOL-016], [BUG-009].

### [TOOL-026] `get_enabled_library_variables` has no multi-query batch and echoes empty collections
- **Status**: identified
- **Priority**: P2
- **Category**: missing-batch-tool
- **First seen**: Session 41 (2026-06-29, external vip-workflows, remote transport)
- **Sessions affected**: 41, 44, 45, 46, 48
- **Estimated savings**: ~3–5 calls per token-discovery pass, plus a large payload reduction
- **Description**: Session 41 calls 17–20 ran four independent single-term queries — `"radius"`, `"stroke/surface/neutral"`, `"stroke/interactive/brand"`, `"caution"` — to assemble one import list, then fed all five resulting keys into a **single** `import_library_variable` call (call 21). The discovery half is un-batched while the import half is batched. Each response was also mostly noise: with `query` set, all **13** enabled collections return, and the 11 matching nothing carry `"variables":[]`. Two of the four responses were truncated by the output budget (2.5KB and 4.8KB) — spending budget on empty collections. Root cause: `tools/libraries.ts:611` types `query` as a single `z.string()`, and the plugin handler returns the full collection list regardless of match count.
- **Proposed fix**: accept `query: z.string().or(z.array(z.string()))` (mirroring `import_library_variable`'s existing `variableKeys` batching), and omit zero-match collections from the response when a query is supplied. Same shape as [TOOL-021] for `search_library_components`.
- **Recurred (2nd)**: Session 44 (2026-08-14, same repo, remote). Calls #27–#30 are four single-`query` calls (`surface`, `content`, `track`, `brand`) against **one** collection key, immediately after an unfiltered enumeration (#26) and followed by three whole-collection dumps (#31–#33) — 8 calls to assemble one import list, which then went into a **single** batched `import_library_variable` (#34). Same asymmetry as session 41, one session apart in the same file family. Fix alongside [TOOL-021] — identical `query`→`queries` change.
- **Recurred (3rd)**: Session 45 (2026-08-19, same repo/file, remote). **8** calls, all single-query; #37–#42 are **6 consecutive** — three whole-collection dumps (`Dimension`, `Typography`, `Border`) then three `query` narrowings against the *same* Color collection key (`surface/neutral`, `fg/content`, `content`) — plus #75 and #80. All of it fed **one batched** `import_library_variable` (#46, **36 keys**). Third session with the same batched-import / un-batched-discovery asymmetry.
- **Recurred (4th)**: Session 46 (2026-08-24, same repo/file, remote). **6** calls (#41, #49, #50, #52, #54, #85), all single-`query`; #49 and #50 are consecutive, one second apart. All of it fed **two** batched `import_library_variable` calls. Fourth consecutive session in this file family with the same batched-import / un-batched-discovery asymmetry — the fix (`tools/libraries.ts:611`, `query: z.string().or(z.array(z.string()))`) is unchanged and now four sessions overdue.
- **Note**: batch variant of an existing tool — matches the `missing-batch-tool` pattern but well under the 20-consecutive-call trigger (4 calls), so no auto-plan generated. Related: [TOOL-021], [TOOL-018].
- **Recurred (5th)**: Session 48 (2026-08-25, external site-foundry, remote — new repo/file family). **13** calls, all single-`query`; #157-#161 are **5 consecutive** narrowings against the *same* collection key (`foreground/content`, `stroke/surface`, `background/track`, `background/surface/caution`, `background/interactive/brand-strong`), which then fed **one** batched `import_library_variable` of **21 keys** (#162). Fifth consecutive session with the batched-import / un-batched-discovery asymmetry, now reproduced outside the vip-workflows file family. The empty-collection echo also cost real signal here: #69 (`query: "gray"`) returned both collections with `"variables":[]` and no indication that the **collection list itself was incomplete** — which fed directly into the new [BUG-029]. Fix unchanged (`tools/libraries.ts:611`), now five sessions overdue.

### [TOOL-027] `edit` can't set `layoutPositioning: "ABSOLUTE"` or `clipsContent` — forces `run_script`
- **Status**: identified
- **Priority**: P1
- **Category**: missing-tool
- **First seen**: Session 41 (2026-06-29, external vip-workflows, remote transport)
- **Sessions affected**: 41
- **Estimated savings**: ~1 `run_script` per overlay/badge/handle build
- **Description**: To add the code's top target dot and bottom drag-grip — both straddling the component border — Session 41 dropped to `run_script` (call 33), stating the gap outright: *"These need absolute positioning, which the edit tool doesn't expose, so I'll use `run_script`."* Verified: `layoutPositioning` appears **nowhere** in `src/figmagent_mcp/tools/*.ts` or `src/figma_plugin/src/commands/*.js`. The script also had to set `clipsContent = false` on the parent (also unexposed) and use `createNodeFromSvg` to inline an SVG path into an auto-layout frame. Absolutely-positioned children are the standard Figma idiom for badges, handles, notification dots, and overlays — not an exotic need. Second consecutive session where pure property-setting fell to `run_script` (Session 40: [TOOL-025] `letterSpacing`/`textCase`/`minWidth`); script writes forfeit `edit`'s per-op error reporting, boundary pre-checks, and post-write assertions.
- **Proposed fix**: add `layoutPositioning` (`"AUTO" | "ABSOLUTE"`) and `clipsContent` (boolean) as direct-value fields on `nodeOpSchema` in `tools/apply.ts`, plus the corresponding setters in `apply.js`. Pair with [TOOL-025]'s field additions in one pass.
- **Note**: missing-tool (schema + setter surface) — not in the Phase 6 auto-fix allowlist; no auto-plan generated. Related: [TOOL-025].


### [TOOL-028] `screenshot(format:"SVG")` returns text SVGs as binary blobs — forces a `Bash cat`
- **Status**: identified
- **Priority**: P2
- **Category**: missing-tool
- **First seen**: Session 43 (2026-07-31, external vip-workflows, remote)
- **Sessions affected**: 43
- **Estimated savings**: ~2 calls per SVG batch; makes the [BUG-016] workaround directly usable
- **Description**: `screenshot({nodeIds:[…], format:"SVG"})` succeeded twice (#146, #148) and returned five SVGs of **182, 303, 707, 231 and 299 bytes**. Each was emitted as an `image` content block with `mimeType: "image/svg+xml"`, which the client cannot render, so each was written to disk as `[Image from Figmagent] Binary content (image/svg+xml, 182 bytes) saved to …`. The agent then spent calls #147 and #149 running `cat` over the blob paths to read content that is plain text and would have fit inline many times over.
- **Root cause**: `tools/export.ts:74` (batch) and `tools/export.ts:105–112` (single) always emit `{ type: "image" }` regardless of `format`. SVG is text.
- **Proposed fix**: when `format === "SVG"`, base64-decode `imageData` and emit `{ type: "text", text: <svg source> }` instead of an image block, subject to the normal output budget. This also turns [BUG-016]'s verified `format:"SVG"` workaround from "usable after a `cat`" into "usable directly", and serves the geometry-measurement use case (reading exact path data out of Figma to reproduce in code) that session 43 was built around.
- **Note**: result-serialization change in the same file as [BUG-016] — fix them in one pass. Not in the Phase 6 auto-fix allowlist; no auto-plan generated.

### [INFRA-005] Manifest classifies any session with ≥1 Figmagent call as a "figma" session
- **Status**: identified
- **Priority**: P1
- **Category**: pipeline-bug
- **First seen**: Session 42 cohort (2026-06-29 → 2026-07-13, external archivist)
- **Sessions affected**: 42 (11 session IDs)
- **Estimated savings**: ~11 wasted `/analyze-session` pipeline runs, immediately
- **Description**: `scripts/refresh-manifest.ts` sets `sessionType: "figma"` when a session made **at least one** `mcp__Figmagent__*` tool call. That predicate cannot distinguish design work from a no-op probe. Eleven sessions from the unrelated `~/Github/archivist` project were queued as Figma sessions on the strength of a single placeholder call each — nine of them literally `run_script {code: "return \"not applicable\";"}` / `"placeholder"` / `"not a figma task"`, all correctly rejected with `No Figma file selected`; the other two were `export_session` calls. No node was read, created, or modified in any of the eleven. Because the queue is chronological, they sat **ahead of three substantive sessions** (313, 369 and 183 calls). Under `scripts/auto-improve.sh`, which loops `claude -p "/analyze-session"` until zero figma sessions remain unanalyzed, this cohort would consume 11 full analysis runs to produce 11 near-empty documents.
- **Proposed fix**: raise the classification bar in `scripts/refresh-manifest.ts` — require at least one Figmagent call that (a) did **not** return `is_error: true`, and (b) is not a pure metadata call (`export_session`); optionally require ≥2 Figmagent calls or ≥1 canvas-touching command (`read`/`grep`/`edit`/`write`/`lint`/`screenshot`). Sessions failing the bar become `sessionType: "dev", skip: true`. Since CLAUDE.md already states extract-sessions discovers transcripts that made "a real Figmagent tool call (not just ones that mention the name in context)", this closes the remaining gap: a call that *ran* but did nothing.
- **Note**: pipeline/tooling change, not in the Phase 6 auto-fix allowlist; no auto-plan generated. Related: [INFRA-002] (extract-sessions path handling).

### [TOOL-029] `run_script` stdlib bundle consumes 62% of the char budget with no opt-out
- **Status**: verified
- **Priority**: P0
- **Category**: missing-tool
- **First seen**: Session 44 (2026-08-14, external vip-workflows, remote transport)
- **Sessions affected**: 44, 47 (verification)
- **Estimated savings**: ~8 calls of workaround scaffold per script-heavy build, plus 2.6x usable script budget (18.6K -> 48.6K chars)
- **Description**: `assembleRunScript` (`src/figmagent_mcp/tools/script.ts:71-87`) prepends the `fig.*` stdlib bundle to **every** script unconditionally. Measured against this repo: the stdlib bundle is **30,375 chars** of the 49,000-char `SCRIPT_CHAR_BUDGET` (`remote/executor.ts:16`) — **62%** — leaving only 18,625 chars for user code (the tool description already admits "~19K for your code"). Session 44 ran 119 `run_script` calls; only **21 (17.6%)** referenced `fig.` at all (`prop` x53, `bindVariable` x11, `check` x8, `setCharacters` x3, `createNode` x2, `loadFont` x1). The other **98 scripts (82.4%) used raw `figma.*` and paid 30,375 chars for nothing.** Call #41 (a 19,557-char builder) was rejected at 50,354 chars. Rather than split, the agent invented a **document-plugin-data module cache** — helper JS stored via `figma.root.setSharedPluginData("vipwf", …)` and re-hydrated per script with `new Function("return (()=>{"+p+"})()")()` — costing 8 dedicated calls (#42-#44, #203-#205, #210, #332; three of them 7K+ chars) with the decode preamble riding **45 of 119 scripts (38%)**. That workaround then caused [BUG-023]: runtime-generated source bypasses every static check and produced a 15-call parse-error bisect. Agent's own words: *"The script exceeds the payload limit. Let me check whether I can cache the builder prelude in the document instead of re-sending it."*
- **Proposed fix**: make stdlib inclusion conditional in `assembleRunScript`. Auto-detect (`/(?<![\w$.])fig\./.test(code)`) and/or accept an explicit `stdlib: false` param. Note `mode: "write"` appends a `fig.check` postlude, so gate on `needsStdlib || mode === "write"` — that alone frees all 46 read-mode scripts; `stdlib: false` covers write scripts that skip the check. Better still, split the bundle: ship `prop`/`setCharacters` in a ~2KB core and put `createNode`/`serialize`/`bindVariable`/`check` behind the flag, freeing the write path too.
- **Note**: schema + assembly change (single capability, not a batch variant) — not in the Phase 6 auto-fix allowlist; no auto-plan generated. Related: [BUG-023] (downstream of this), [AGENT-025].
- **Fix implemented 2026-08-19 (commit `0af2c9a`, branch `feat/auto-improve-pipeline` — NOT yet merged)**: `assembleRunScript` now gates the bundle on `stdlib !== false && (referencesStdlib(code) || mode === "write")`. Detection regex is `/(?<![\w$.])fig\.|(?:globalThis|self|window)\.fig\b/` — the bare-form lookbehind rejects `myfig.` / `$fig.` / `config.fig.enabled`, and the second alternation re-admits `globalThis.fig.x`, which the bare form would have wrongly stripped (that is how the bundle attaches and how the write postlude calls `fig.check`). New `stdlib: false` param forces omission; the write postlude is hardened to `if (globalThis.fig && ...)` so a stdlib-less write skips the check instead of throwing into a swallowing catch. **Measured: a `figma.*`-only read script goes 30,680 -> 305 chars assembled, i.e. 18.3K -> 48.7K usable budget.** The 19,557-char session-44 builder rejected at 50,354 would now assemble at ~19.8K in one call, removing the need for the plugin-data module cache that caused [BUG-023]. 13 new tests in `tests/run-script.test.ts`. Bundle split into a small core deliberately NOT attempted (needs new `remote_entries/` files + a `bundles.ts` call-site change). Status stays `identified` until verified against a live remote session.
- **VERIFIED 2026-08-25 (session 47, external site-foundry, remote)**: first live remote session to exercise the flag. All **7** `mode: "write"` scripts passed `stdlib: false`; the read-only probe (#29) kept the default and used `fig.prop`. Zero oversized-script rejections, zero plugin-data module-cache workaround, zero [BUG-023] parse-error bisect — the exact 23-call failure chain session 44 paid for. Largest assembled script 9,967 chars against the 49,000 budget. Moving to `verified`.
- **Residual gap, now split out as [TOOL-031]**: opting out of the stdlib also forfeits `fig.*`, so each script hand-rolls it. All 7 session-47 write scripts re-declared the same ~700-900 char preamble (an 8-entry `VariableID:…` map, an `RGB` fallback table, an async `V()` variable cache) and 3 also carried a hand-written `card()` helper. That is precisely what the **bundle-split half** of this entry's proposed fix (a ~2KB always-on core of `prop`/`setCharacters`, remainder behind the flag) was meant to remove, and it was deliberately deferred in `0af2c9a`. Tracked as [TOOL-031] so it does not disappear inside a `verified` entry.

### [BUG-023] Remote VM `SyntaxError` carries no line, column, or source context
- **Status**: identified
- **Priority**: P1
- **Category**: plugin-bug
- **First seen**: Session 44 (2026-08-14, external vip-workflows, remote transport)
- **Sessions affected**: 44
- **Estimated savings**: ~15 calls / ~6 minutes per occurrence
- **Description**: Calls #45, #49 and #52 each failed with the *complete* error text `Error running script: SyntaxError: expecting '}' Figma Debug UUID: 61e9351e-… (atomic: no changes were applied; safe to retry)` — no line, no column, no offending source. **Runtime** errors from the same VM do carry positions (`at __userScript (PLUGIN_1_SOURCE:34:25)`), so the asymmetry is specific to parse failures. With nothing to bisect against, the agent hand-bisected for **15 calls across 16:34:06-16:39:53** (#46 round-trip check, #47 minimal frame, #48 non-ASCII literals, #50 nested literals, #51 spec-only, #53 snippet matrix, #54 line narrowing, #55 differential, #56 minimal nesting, #57 source dump, #58 six-way matrix) and **never found the cause** — call #59 succeeded only because it rewrote the spec by hand. Two compounding gaps: (a) Figmagent passes the `SyntaxError` through verbatim with no fix hint, though the VM's parser constraints are already known and documented in CLAUDE.md (no `?.`, no `??`, no object spread — the last of which sank PR #38); (b) the failing source was **runtime-generated** by the plugin-data prelude workaround from [TOOL-029], so it never passed through Figmagent's assembly and no static check could see it.
- **Proposed fix**: in the remote error path (`remote/executor.ts:runOne`), when the message matches `/SyntaxError/`, append a stated fix naming the VM's parser constraints (`?.`, `??`, object spread are rejected) and noting the assembled script is `stdlib + user code` so any reported offset is bundle-relative. Per CLAUDE.md's own rule — no user-facing error without a stated fix — a bare `expecting '}'` fails the project bar. Fixing [TOOL-029] removes most of the exposure, since the `new Function` prelude pattern disappears with the budget pressure.
- **Note**: error-message change, not in the Phase 6 auto-fix allowlist (sync-to-async / type-coercion / missing-batch-tool); no auto-plan generated. Related: [TOOL-029] (root cause of the trigger).

### [AGENT-025] Whole-session `run_script` monoculture — first-class tools go untouched
- **Status**: identified
- **Priority**: P1
- **Category**: agent-behavior
- **First seen**: Session 44 (2026-08-14, external vip-workflows, remote transport)
- **Sessions affected**: 44, 46, 47
- **Estimated savings**: tracking metric — the underlying gaps are costed in their own entries
- **Description**: Session 44 built three boards, ~30 modals and a component library across 192 minutes and 173 Figmagent calls using **119 `run_script` calls and zero `write`, `edit`, `lint` or `grep`**. `run_script` is described as a LAST RESORT; here it was 69% of all Figmagent calls and 100% of writes. **64 of 119 scripts (54%) were diagnostic, not build work.** Two transcript-visible causes, not agent laziness: (1) `read` returned nothing useful twice in 90 seconds — `read()` listed one page with `childCount: 0` for a multi-page file ([BUG-014], 6th recurrence) and `read("2219:624", structure, depth:2)` on the Sidebar PAGE returned `nodeCount: 1` — after which `read` was never called again in 2h45m; (2) imported published-library component internals aren't reachable from `read`, so ~12 scripts (#100, #102, #122, #180-#183, #206-#209) exist only to answer "what are this WPDS instance's nested component-property keys / variant axes / INSTANCE_SWAP targets" (e.g. *"Find which nested component property drives the textarea and select value"*). Script writes forfeit `edit`'s per-op error reporting, boundary pre-checks and post-write assertions — visible as five build failures the first-class tools reject pre-mutation (#271 bad variant name, #272 missing component key, #276 missing key param, #308 stale node id, #311 unloaded font, the last being exactly what the already-loaded `fig.setCharacters` prevents).
- **Proposed fix**: no single fix — this is the aggregate symptom of [BUG-014], [TOOL-020], [TOOL-023], [TOOL-025], [TOOL-027] and [TOOL-029]. Track `run_script` share of Figmagent calls per session as a health metric; when it exceeds ~30% in a build session, the first-class surface has a gap worth naming. Interim agent guidance: after an unhelpful `read`, retry with an explicit page/frame nodeId before abandoning the tool, and prefer `write`/`edit` for node creation even mid-script session.
- **Counter-data-point — the metric works, and it moved**: Session 45 (2026-08-19, **same repo, same file, same libraries, same remote transport**, 5 days later) built the Settings surface — 349 nodes created, 272 node-edits — with **23 `write`, 20 `edit`, 8 `component_properties` and 32 `run_script`**. `run_script` share fell **69% → 28%**, and the Figmagent error rate fell **9.8% → 5.3%**. This is the strongest available evidence that session 44's monoculture was driven by the underlying gaps rather than by agent preference: when `read` returned something usable and the build was composable from `write`/`edit`, the first-class tools were used without prompting. The residual 32 scripts map almost one-to-one onto tracked gaps — ~5 for published-component property discovery (see [TOOL-030]), ~5 for variant-key resolution ([TOOL-030]), 3 for page enumeration ([BUG-014]), 2 for `textDecoration`/`visible` ([TOOL-025]) — plus ~4 that `edit` already covers ([AGENT-026]). **Keep the ~30% threshold**: 28% here reads as "healthy with named gaps", 69% read as "the surface has a hole", and both match the transcript.
- **Metric refinement — count write OPERATIONS, not calls** (session 47, 2026-08-25, external site-foundry, remote): `run_script` share of Figmagent calls read **22%**, comfortably under the ~30% threshold — while being **100% of writes** (7 `mode: "write"` scripts, **0 `write`, 0 `edit`, 0 `lint`**). The denominator was inflated by 16 `screenshot` calls. Third consecutive session at 100% of writes via script (44: 100%, 46: 100% of creates, 47: 100%), so the call-share metric is now demonstrably diluted by read- and screenshot-heavy sessions — **track share of write operations alongside it**.
- **The work was genuinely script-shaped, and the gap is nameable**: session 47's scripts cloned existing WPDS library instances, `setProperties` on nested instances, deleted a child by name, repositioned, and renumbered ten sibling frames — atomically. `write` covers frame-tree creation; nothing covers clone-then-set-properties-then-renumber-siblings in one atomic pass. Script #69 is the clean example: 5 first-class calls with no atomicity, or 1 script. This is a real capability boundary, not agent preference — same conclusion the session-45 counter-data-point reached from the other direction.
- **Note**: meta/tracking entry — not in the Phase 6 auto-fix allowlist; no auto-plan generated.

### [TOOL-030] No way to resolve a published variant key by variant properties, or read a component's nested property API
- **Status**: identified
- **Priority**: P1
- **Category**: missing-tool
- **First seen**: Session 45 (2026-08-19, external vip-workflows, remote transport)
- **Sessions affected**: 45 (measured); 44 (same gap, folded into [AGENT-025])
- **Estimated savings**: ~9 `run_script` calls per library-composed build, plus one cleanup call
- **Description**: Two adjacent dead-ends in the published-library toolchain, both of which force `run_script`.
  **(a) Variant-key resolution.** The common need is *one* key for *one* variant combination — `Button` where `Type=Primary, Size=Large, State=Default, Destructive=False`. `get_component_variants` (`tools/libraries.ts`) takes a `componentSetNodeId` and dumps **every** variant with no property filter; CLAUDE.md already warns that list "can truncate under the output budget and you can grab the wrong variant." Session 45 wrote the same script three separate times (#58 at 19:53, #91 at 20:02, #151 at 20:25 — once per new component), each an `importComponentSetByKeyAsync(key)` + `children.find(c => c.variantProperties.X === …)` + `.key`.
  **(b) Nested property API.** There is no way to read a published component's `componentPropertyDefinitions` — least of all the *nested instance* property keys an agent needs to drive it (e.g. which key on a WPDS `CheckboxControl` blanks its label). The only route is to instantiate it and walk the tree: scripts #52, #53, #54, #55, #93 create a `scratch` FRAME at `x: -4000`, `createInstance()` each component set into it, and dump `n.componentProperties`. Two of those five were pure overhead — #52 was correctly rejected by the `mode:"read"` pre-check (it calls `createFrame`), #54 crashed on `cannot read property 'slice' of undefined` reading `v.value` off a non-TEXT property — and the scratch nodes needed a later cleanup `edit` (#166, 3 deletes).
- **Proposed fix**: (a) add an optional `variantProperties` filter object (and/or exact `variantName`) to `get_component_variants`, returning only matching keys; (b) return `componentPropertyDefinitions` — including nested instance property keys — for a published component/set key, without requiring instantiation. Both are extensions to `tools/libraries.ts` against APIs the plugin already calls. Sibling to [TOOL-013] (batch `get_component_variants`) and [TOOL-021].
- **Note**: missing-tool capability gap — not in the Phase 6 auto-fix allowlist; no auto-plan generated. Related: [AGENT-025] (this is one of its two named causes), [TOOL-021].

### [BUG-024] `set_focus`/`set_selections` report success with `undefined` name and id on remote
- **Status**: identified
- **Priority**: P1
- **Category**: plugin-bug
- **First seen**: Session 45 (2026-08-19, external vip-workflows, remote transport)
- **Sessions affected**: 45, 48
- **Estimated savings**: ~1 call + removes a confidently-wrong success message
- **Description**: On the remote transport `set_focus({nodeId:"2329:2"})` (#99) returned `Focused on node "undefined" (ID: undefined)`. **Root cause pinned**: `remote/transport.ts:30–34` short-circuits `set_focus` and `set_selections` before dispatch and returns `{success: true, note: "<cmd> is a no-op on the remote transport (headless — no viewport or live selection)."}`. The MCP handler at `tools/scan.ts:144–152` then formats `` `Focused on node "${typedResult.name}" (ID: ${typedResult.id})` `` — fields the short-circuit never populates. The correct explanation is already written and is then discarded. The agent had called `set_focus` while trying to fix the official MCP's 1×1 PNGs (see [BUG-016]); the message told it nothing and the next screenshot was 1×1 again.
- **Proposed fix**: in `tools/scan.ts`, return `typedResult.note` when present (and prefer it over the name/id format), or have the handler detect the missing fields. One-line class of fix; same family as [BUG-008] (a no-op should not read as a completed action).
- **Note**: result-formatting fix — not in the Phase 6 auto-fix allowlist; no auto-plan generated.
- **Recurred (2nd) — and the false success now has a measured cost**: Session 48 (2026-08-25, external site-foundry, remote). `set_focus({nodeId:"4:2"})` (#60) returned `Focused on node "undefined" (ID: undefined)`. The agent had called it **specifically to clear the `set_selection` page-mismatch from [BUG-018]** at #59 — a sound hypothesis. Because the message read as a completed action, it retried `import_library_components` at #61, which failed identically. Had `remote/transport.ts:30-34`'s own note reached the caller ("`set_focus` is a no-op on the remote transport — headless, no viewport or live selection"), that retry would not have happened. **Escalating P2 -> P1**: the confidently-wrong success is no longer cosmetic — it compounds [BUG-018] and costs a wasted batch retry. Fix unchanged: return `typedResult.note` when present in `tools/scan.ts:144-152`.

### [BUG-025] `write`'s `componentKey` path throws Figma's raw error with no stated fix
- **Status**: identified
- **Priority**: P2
- **Category**: plugin-bug
- **First seen**: Session 45 (2026-08-19, external vip-workflows, remote transport)
- **Sessions affected**: 45
- **Estimated savings**: ~1 call per library-composed build; closes a no-error-without-a-fix hole
- **Description**: Call #102 passed `componentKey: "d09fc85b3553df47f1061ebe97e890e7eeced48d"` inside a `write` tree and got `Error creating node(s): Error: Component with key "d09fc85b…" not found` — **no `Fix:` clause**. The key was **not invented**: the agent harvested it from its own script #58 thirteen minutes earlier as the `Tab` variant `State=Selected, Orientation=Horizontal`, read off `importComponentSetByKeyAsync(setKey).children[].key` in the same file and session; `Button` variant keys harvested by the identical mechanism imported fine (#94, #103). **Root cause**: `src/figma_plugin/src/commands/create.js:161` calls `await figma.importComponentByKeyAsync(spec.componentKey)` bare — no try/catch, no `fail(message, fix)` — while every sibling branch in the same `INSTANCE` block does use `fail()` with a stated fix (`:149` component node not found, `:154` node is not a COMPONENT, `:164` neither id nor key supplied). Figma's raw message propagates unmodified, so the agent gets no guidance on the real distinction: a variant of a published COMPONENT_SET is not necessarily independently importable by key.
- **Proposed fix**: wrap `create.js:161` in try/catch → `fail('Component with key "…" not found', 'verify the key with search_library_components, or — if this is one variant of a COMPONENT_SET — import the set and instantiate the variant, since set members are not always independently importable by key')`.
- **Agent recovery**: clean — one retry (#103) with the Tab instance dropped, 37 nodes created. The `(atomic: no changes were applied; safe to retry)` note worked as designed and saved a cleanup pass.
- **Note**: error-message fix — not in the Phase 6 auto-fix allowlist; no auto-plan generated. Related: [BUG-008].

### [BUG-026] `run_script` mode-mismatch rejection is reported as `is_error: false`
- **Status**: identified
- **Priority**: P2
- **Category**: plugin-bug
- **First seen**: Session 45 (2026-08-19, external vip-workflows, remote transport)
- **Sessions affected**: 45
- **Estimated savings**: prevents mis-branching on a call that never executed
- **Description**: Call #52 returned `This script calls createFrame but mode is 'read'; rerun with mode: 'write'.` with **`is_error: false`**. The pre-check itself is good — it caught a real mistake before dispatch and stated the fix — but `tools/script.ts:147–155` returns the rejection **without** `isError: true`, and its text does not match `ERROR_TEXT_PREFIX` (`instance.ts:84–85`, anchored on `Error[:\s]|Failed to|Could not|Unable to|(Read|Write) operation "|…`). A script that never ran is therefore logged and surfaced as a success. Exactly the class [BUG-008] was opened for; CLAUDE.md already promises validation rejections are flagged.
- **Proposed fix**: add `isError: true` to the returned object at `tools/script.ts:147–155`. One line. Audit the other tool files for the same shape while in there.
- **Note**: one-line result-flagging fix in the same family as [BUG-008] (issue #60), but result-serialization is not one of the Phase 6 auto-fix patterns (sync-to-async / type-coercion / missing-batch-tool) — no auto-plan generated. Cheapest item in the tracker; bundle it with the [BUG-016] `export.ts` `isError` work, which is the same change in an adjacent file.

### [AGENT-026] `run_script` used for property assignment `edit` already supports
- **Status**: identified
- **Priority**: P2
- **Category**: agent-behavior
- **First seen**: Session 45 (2026-08-19, external vip-workflows, remote transport)
- **Sessions affected**: 45
- **Estimated savings**: ~4 calls per build session, plus the pre-checks a script write forfeits
- **Description**: Script #164 sets nine properties on one node — `layoutMode`, `layoutWrap`, `counterAxisAlignItems`, `itemSpacing`, `counterAxisSpacing`, `layoutSizingHorizontal`, `resize(w,h)`, `layoutSizingVertical`, `clipsContent` — and **every one is already a field on `edit`**: `layoutWrap` (`tools/apply.ts:115`), `counterAxisSpacing` (`:125`), `counterAxisAlignItems` (`:121`), `layoutSizingHorizontal` (`:122`), `width` (`:88`), `clipsContent` (`:84`). Scripts #18, #21 and #29 likewise set `clipsContent`/`itemSpacing`/`fills` by hand inside larger builds. Notably `clipsContent` is the **already-shipped half of [TOOL-027]** — the agent did not know it had landed. The cost is not just the call: script writes forfeit `edit`'s boundary pre-checks, and script #153 died on `FILL can only be set on children of auto-layout frames` — precisely the error [TOOL-016]'s pre-check rejects before mutating — costing a 4,721-char retry (#154).
- **Proposed fix**: agent-behavior — when a script body is pure property assignment on existing nodes, use `edit`. Add to `figma-guidelines` beside the "batch over singles" guidance, and note that `edit`'s field list has grown (`clipsContent`, `layoutWrap`, `counterAxisSpacing` are all current). Tool-side complement: when `run_script` succeeds with a body that only assigns fields `edit` exposes, the response could name `edit` as the cheaper path.
- **Note**: agent-behavior — not in the Phase 6 auto-fix allowlist; no auto-plan generated. Related: [AGENT-025], [TOOL-027], [TOOL-016].


### [BUG-027] `read` renders an empty transport result as a successful, empty document
- **Status**: identified
- **Priority**: P0
- **Category**: plugin-bug
- **First seen**: Session 46 (2026-08-24, external vip-workflows, remote transport)
- **Sessions affected**: 46
- **Estimated savings**: ~1 call per occurrence, plus the audit blind spot it creates
- **Description**: Session 46 call #6, `read({nodeId:"2285:365", detail:"layout", depth:5})`, returned `meta: {detail, nodeCount: 0, tokenEstimate: 0, depth: 5}`, `defs` all empty, `nodes: []` — with **`is_error: false`**. The node exists and is visible: call #5, one call earlier, listed `2285:365` ("States", a FRAME with seven state children) in the board tree. **The `meta` block is missing `nodeId`, `name` and `type`**, which `tools/document.ts:87–90` copies unconditionally from `raw.rootId`/`rootName`/`rootType` — so all three were `undefined`, i.e. the handler received an **empty object** and rendered it faithfully (`raw.nodeCount ?? 0` → 0, `raw.rawTree ?? []` → `[]`). `getNodeTree` cannot produce this itself: it throws `Node not found` on a missing root (`document.js:427–429`) and increments `nodeCount` *before* any visibility/type filter runs (`document.js:440`), so `nodeCount: 0` proves the traversal never executed. **This is the same silent-empty-result condition as [BUG-016]**, on a different tool — and strictly worse, because `read` has no guard at all: the screenshot path at least tells the agent something failed, while `read` reports success. The agent accepted `nodes: []`, moved on to sibling nodes, and never inspected the "States" wrapper during the audit.
- **Proposed fix**: in `buildFsgn` (`tools/document.ts:78–92`), treat a `raw` with no `rootId` as a transport failure — return a fix-stating text block with `isError: true` naming the requested nodeId and suggesting a retry — instead of serializing an empty document. Mirror the `hasImageData` guard `export.ts` already has. Audit the remaining remote result-builders for the same hole: [BUG-016]'s fix closed it for `export.ts` and left it open everywhere else.
- **Note**: result-serialization guard, not in the Phase 6 auto-fix allowlist (sync-to-async / type-coercion / missing-batch-tool) — no auto-plan generated. Related: [BUG-016] (same condition, guarded), [BUG-008] (a malformed result should surface as a clean error), [BUG-026] (`is_error: false` on a real failure).
- **Root cause pinned — same single line as [BUG-016]** (session 47, 2026-08-25): `remote/client.ts:110-114` returns the **raw response text** when `JSON.parse` fails, so `buildFsgn` receives a `string`. `raw.rootId`/`rootName`/`rootType` -> `undefined` (hence the missing `meta.nodeId`/`name`/`type`), `raw.nodeCount ?? 0` -> `0`, `raw.rawTree ?? []` -> `[]`, `raw.collectedComponents ?? {}` -> `{}` — the S46 output reproduced field for field. The `buildFsgn` guard proposed above is still worth adding as defence in depth, but **the repair is the transport fix in [BUG-016] v5**; do them together. Priority stays P0: unlike `screenshot`, `read` reports success.

### [BUG-028] `read` reports absolute coordinates, `edit` writes parent-local ones — neither says which
- **Status**: identified
- **Priority**: P1
- **Category**: missing-tool
- **First seen**: Session 46 (2026-08-24, external vip-workflows, remote transport)
- **Sessions affected**: 46
- **Estimated savings**: ~2 calls per geometry-editing session, plus a class of silent breakage
- **Description**: The agent flagged its own bug at 22:55:39: *"Coordinate bug — I offset by absolute page position instead of local. Fixing."* `run_script` #15 (call 94) measured a vector track in absolute space (`c.absoluteTransform[1][2] - track.absoluteTransform[1][2]`) then wrote back as `n.x = trackLeft + x` where `trackLeft` was the track's absolute page X (~2656) — landing all twelve vectors ~2656px to the right of the board. Recovery took two more scripts (#16 re-measure, #17 rewrite in local coords). **Root cause is an unmarked asymmetry across the whole surface**: `read` emits `absoluteBoundingBox.x/y` as bare `x`/`y` (`document.js:222–227`), while `edit`'s schema says only *"New X position (moves the node; does NOT change parent)"* (`tools/apply.ts:56–57`) and the setter is `node.x = …` (`apply.js:533–534`) — parent-local. Neither side states its frame of reference, so an agent that reads coordinates and writes them back is silently wrong whenever the parent is not at the page origin. The failure is invisible to every existing guard (no error, no warning, no assertion) — only a screenshot catches it.
- **Proposed fix**: (a) state the frame of reference in both tool descriptions — `read`'s `x`/`y` are **absolute (page)** coordinates, `edit`'s `x`/`y` are **parent-local**; (b) add a `fig.localPoint(node, ancestor)` helper to the `run_script` stdlib (`src/figma_plugin/src/remote_entries/stdlib.js`) so scripts measuring with `absoluteTransform` have a supported way back to local space. Optionally (c) have `read` emit `x`/`y` as local and `absX`/`absY` as absolute, but that is a wire-format change — descriptions plus the stdlib helper are the cheap fix.
- **Note**: description + stdlib addition, not in the Phase 6 auto-fix allowlist — no auto-plan generated. Related: [TOOL-027] (`layoutPositioning: ABSOLUTE` also unexposed), [TOOL-025].

### [AGENT-027] Frame resize rescales children with SCALE constraints
- **Status**: identified
- **Priority**: P2
- **Category**: agent-behavior
- **First seen**: Session 46 (2026-08-24, external vip-workflows, remote transport)
- **Sessions affected**: 46
- **Estimated savings**: ~1–2 calls per hand-drawn-geometry session
- **Description**: `run_script` #15 called `track.resize(rail.width, rail.height)` on a frame whose twelve child VECTORs carried `constraints: SCALE`. Figma stretched them ~19%, which the agent detected only after a screenshot round trip and then had to undo (22:54:59: *"The track resize had also scaled the vectors 19% (SCALE constraints). Restoring their true geometry…"*). Figma-native behavior, correctly diagnosed, but not documented anywhere in the agent-facing surface.
- **Proposed fix**: add to the `figma-guidelines` skill: resizing a frame rescales children whose `constraints` are `SCALE`; read `constraints` before resizing a container that holds hand-authored geometry, or restore explicit geometry after the resize. Pair with [BUG-028]'s coordinate note — both are `run_script` geometry-editing footguns.


### [TOOL-031] `run_script` is stateless per call — no supported way to reuse a preamble
- **Status**: identified
- **Priority**: P2
- **Category**: missing-tool
- **First seen**: Session 47 (2026-08-25, external site-foundry, remote transport)
- **Sessions affected**: 44 (as the plugin-data workaround), 47
- **Estimated savings**: ~0 calls, ~5-6K output chars per script-heavy build; removes the workaround that caused [BUG-023]
- **Description**: Every `run_script` call is independent, so build-session-specific helpers must be re-sent each time. Session 47 re-declared the same ~700-900 char preamble in **all 7** write scripts — an 8-entry `VariableID:…` map read once from `get_design_system`, an `RGB` fallback table, and an async `V()` variable cache — plus a hand-written `card()` helper in 3 of them. Session 44 hit the same wall under budget pressure and invented a `figma.root.setSharedPluginData("vipwf", …)` module cache re-hydrated per script via `new Function(...)`, costing **8 dedicated calls** and causing [BUG-023] (runtime-generated source bypasses every static check; 15-call parse-error bisect). Session 47's re-send approach is cheaper and far safer, but it is the same gap answered a second way. Two distinct sub-gaps: (a) **generic** helpers — the [TOOL-029] bundle-split (~2KB always-on `prop`/`setCharacters` core, remainder behind `stdlib: false`), deferred in `0af2c9a`; (b) **session-specific** helpers, which no bundle can supply.
- **Proposed fix**: (a) land the [TOOL-029] bundle split so `stdlib: false` does not mean "no `fig.*` at all"; (b) add an optional `preamble` param to `run_script`, cached server-side per fileKey and prepended after the stdlib, so a build defines its token map and helpers once. A `preamble` passes through Figmagent's assembly and deny-list scan, unlike the `new Function` workaround — closing [BUG-023]'s trigger by design rather than by budget relief.
- **Note**: schema + assembly change, not in the Phase 6 auto-fix allowlist — no auto-plan generated. Related: [TOOL-029] (parent; verified, with this as the residual), [BUG-023] (caused by the workaround this replaces), [AGENT-025].

### [BUG-029] `get_enabled_library_variables` returned 2 collections, then 14, for the same file in one session
- **Status**: identified
- **Priority**: P0
- **Category**: plugin-bug
- **First seen**: Session 48 (2026-08-25, external site-foundry, remote transport)
- **Sessions affected**: 48
- **Estimated savings**: ~11 calls of direct rework per token-first build, plus the qualitative cost of an entire build's colours being hand-guessed and then replaced
- **Description**: On the remote transport the enabled-library-collection list is **not stable within a session**, and nothing in the response says so. Session 48, file `07plXV7PsHOrLE3hsIS0jS`, no user action in between:

  | Time | Call | Answer |
  |---|---|---|
  | 18:04:35 | #43 `get_enabled_library_variables({})` | `collectionCount: 2` — Foundations, Themes |
  | 18:05:10 | #44 `{collectionKey: Foundations, query: "color"}` | `variableCount: 0`, `variables: []` |
  | 18:09:09 | #69 `{query: "gray"}` | both collections echoed, both `variables: []` |
  | 18:24:53 | #152 `lint` (same API via `describeEnabledLibraryVariables`) | *"tokens come from **2** enabled library collections"* |
  | **18:25:32** | #153 `get_enabled_library_variables({})` | **`collectionCount: 14`** — adds `@wordpress/theme` Color (**257 variables**), Typography, Border, Dimension, Motion + five WPDS (Gutenberg 22.3) collections |

  **Nothing ran between #152 and #153.** Two candidate mechanisms, neither confirmed: (a) Figma enables a library's collections once the file references them, and the agent instantiated library components at 18:07:54 — but that is **17 minutes before** #152 still answered 2, so the timing does not fit a direct causal link; (b) the remote `use_figma` VM's `figma.teamLibrary` state is eventually consistent and under-reports early in a session. The agent's own in-session read was (a) (*"importing the components enabled the real token libraries"*, 18:26:30). This entry deliberately does not pick between them — the reproducible fact is that **`figma.teamLibrary.getAvailableLibraryVariableCollectionsAsync()` returned 2 and then 14 for the same file inside one session**, and both `get_enabled_library_variables` (`styles.js:1203-1209`, `:1246-1255`) and `lint`'s hint (`lint.js:591`, via `describeEnabledLibraryVariables`) present whatever it returns as authoritative.
- **Cost**: acting on the 2-collection answer, the agent concluded the file had no reachable tokens and **hardcoded every colour in the build as a raw RGB literal** across eight frames and ~250 nodes (#72-#151). When the real answer surfaced it spent **#153-#190 — 38 calls, 17 minutes — re-discovering tokens and retro-binding 457 node properties** across ten `edit` calls, plus 8 re-verification screenshots. The binding work was always necessary; the guessing, the replacing, and the second discovery round were not.
- **Proposed fix**: (1) do not present a small collection list as complete — when the count is low **and** the file contains instances of published library components, add a note to both `get_enabled_library_variables` and `lint`'s library hint saying the list can be incomplete early in a remote session and should be re-checked; (2) investigate whether the plugin can force a refresh (a second `getAvailableLibraryVariableCollectionsAsync()` call, or resolving via a known instance's `boundVariables`) before answering; (3) agent guidance — run token discovery **after** the first library component is instantiated, and re-check before concluding a file has no tokens. Priority **P0**: a wrong-but-plausible answer here silently mis-sets every colour decision in a build. Related: [TOOL-024] (same API, same stale answer), [TOOL-026] (empty-collection echo hid that the list itself was short).
- **Note**: correctness/staleness fix — not in the Phase 6 auto-fix allowlist; no auto-plan generated.

### [TOOL-032] `write` cannot bind variables at create time
- **Status**: identified
- **Priority**: P1
- **Category**: missing-tool
- **First seen**: Session 48 (2026-08-25, external site-foundry, remote transport)
- **Sessions affected**: 48
- **Estimated savings**: ~5-10 calls per token-first build (removes a mandatory second pass over every created node)
- **Description**: `variables` appears **nowhere** in `src/figmagent_mcp/tools/create.ts`, while `edit` accepts it per node (`apply.ts:132`). Every one of session 48's **457 bindings** therefore had to be a separate `edit` pass over nodes `write` had just created — ten `edit` calls (79, 73, 70, 51, 42, 38, 37, 27, 26 and 14 nodes) whose entire payload is `{nodeId, variables: {...}}`. `write` accepts `fillColor`, `strokeColor`, `cornerRadius`, `fontSize`, padding, spacing and sizing — every visual property *except* the bindings that should own them. On a token-first build the natural call carries structure and bindings together.
- **Proposed fix**: add `variables: z.record(...)` to the node spec in `tools/create.ts`, mirroring `nodeOpSchema`'s field enum in `apply.ts:21-47`, and route it through the same `FIELD_MAP` binding path `apply.js` already uses. The plugin-side binder exists — this is a schema + wiring change on the create path.
- **Note**: Distinct from [BUG-029]: correct discovery ordering removes the *guess-and-replace*, but the second pass stays mandatory until `write` accepts `variables`. Not in the Phase 6 auto-fix allowlist; no auto-plan generated. Related: [TOOL-025], [TOOL-027] (same "field exists on one tool, not the other" family).

### [BUG-030] `edit` rejects `variables: {fontWeight}` with a 10,040-char Zod dump and discards the whole batch
- **Status**: identified
- **Priority**: P2
- **Category**: error-message
- **First seen**: Session 48 (2026-08-25, external site-foundry, remote transport)
- **Sessions affected**: 48
- **Estimated savings**: ~1 call + a 70-op re-serialisation per occurrence; closes a name-collision trap
- **Description**: Session 48 #176 sent a **70-node** `edit` in which several ops carried `variables: {fontSize: "VariableID:…", fontWeight: "VariableID:…"}` and got back `MCP error -32602: Input validation error … {"received": "fontWeight", "code": "invalid_enum_value", "options": [31 fields]}` — **10,040 characters**, and **all 70 operations rejected** over one key. `fontWeight` is genuinely not bindable (Figma binds weight through `fontStyle`, a STRING variable) so the enum at `apply.ts:21-47` is correct — three things about the *failure* are not: (1) **the name collides with a field `edit` does accept** — `apply.ts:93` defines `fontWeight: z.number()` as a direct value, so `fontWeight: 600` is valid while `variables: {fontWeight: …}` is not, and nothing in the schema or description warns about the asymmetry; (2) the response dumps the full 31-option enum plus a repeat per offending node; (3) one bad key discards 69 valid operations — the agent resent the entire batch at #177 with `fontWeight` stripped, and it applied cleanly (70/70).
- **Proposed fix**: (a) name the fix in the rejection — "font weight binds through `fontStyle` (a STRING variable); `fontWeight` is a direct-value field only"; (b) collapse the repeated enum dump to one instance; (c) document the direct-value / variable-field name asymmetry in `edit`'s `variables` description at `apply.ts:132`. Same raw-Zod-dump family as [BUG-021] (`grep`); fix both in one pass.
- **Note**: error-message fix — not in the Phase 6 auto-fix allowlist; no auto-plan generated. Related: [BUG-021], [BUG-008].

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

### [TOOL-029] `run_script` stdlib bundle consumes 62% of the char budget with no opt-out
- **Resolved in**: Commit `0af2c9a` (2026-08-19) — `assembleRunScript` gates the bundle on `stdlib !== false && (referencesStdlib(code) || mode === "write")`, plus an explicit `stdlib: false` param
- **Verified in**: Session 47 (2026-08-25) — 7/7 write scripts used `stdlib: false`; zero oversized-script rejections, zero plugin-data module-cache workaround, zero [BUG-023] bisect
- **Residual**: the bundle split (a ~2KB always-on core) was deferred and is tracked as [TOOL-031]

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
| 39 | 2026-06-22 | 168 (35 figma) | 3 (1 figma `-32602`, 2 Edit re-read) | ~8% | 8 (4.8%) | WPDS benchmark **orchestration**: seed build (37+16 vars, 5+4 styles, fixtures) + 2-round Figmagent-vs-official-MCP benchmark via 5 delegated agents (uncaptured); 6 run_script = all page CRUD/reset — **this repo** | 1 (TOOL-023) | 0 |
| 36 | 2026-06-22 | 149 (14 figma) | 8 (2 figma) | ~8% (whole) / ~40% (figma-only) | 2 (1.3%) | 0 (design-to-code: ported Figma typography/breadcrumb/AdminPage → React/CSS; Figmagent read-only ref) — **external: vip-workflows**, remote | 0 (recurrences: BUG-014, TOOL-020) | 0 |
| 37 | 2026-06-17 | 77 (41 figma) | 5 (all figma, all `is_error:false`) | ~16% | 9 (11.7%) | reauth→editor then **135 WPDS vars created + 83 updated for derived Dark mode** (0 failed); Button/IconButton re-link evaluated — **external: WordPress-Admin-Environment**, remote (sequel to S33) | 2 (AGENT-021/022) | 0 |
| 38 | 2026-06-19 | 21 (16 figma) | 3 | ~14% | 2 (9.5%) | 2 COMPONENT_SETs built from 7 frames + variants + component props (Title/Actors) via first-class tools, no `run_script` — **external: vip-workflows**, remote | 1 (TOOL-022); recurrences: BUG-016 (3rd), BUG-014 | 0 |
| 40 | 2026-06-29 | 56 (45 figma) | 4 hard + 3 user-reject + **2 unflagged soft** | ~29% | 6 (10.7%) | 1 COMPONENT restyled twice (Figma variant → real `.wf-terminal-node` CSS) + 3 variants centered/min-width; 3 library vars imported — **external: vip-workflows**, remote | 6 (BUG-020/021, TOOL-024/025, AGENT-023/024); recurrences: TOOL-015 (3rd), AGENT-020 (2nd) | 0 |
| 41 | 2026-06-29 | 41 main + 7 agent (31 figma) | 2 hard + **4 unflagged soft** | ~24% | 3 (7.3%) | `StageNode` COMPONENT_SET reconciled to code across 3 variants: token drift fixed, Selected reworked to brand-border, 4px accent stripe + top/bottom connection handles added, handle surfaces tokenized; 5 library vars imported — **external: vip-workflows**, remote (sequel to S40, same file) | 3 (BUG-022, TOOL-026/027); recurrences: BUG-016 (4th, root-caused), TOOL-024 (2nd) | 0 |
| 42 | 2026-06-29→07-13 | 87 across 11 sessions (13 figma) | 0 real | n/a | 0 (0%) | **none — 11 placeholder-probe sessions** from external `archivist`; 9 of 13 figma calls literally return `"not applicable"`/`"placeholder"` | 1 (INFRA-005) | 0 |
| 43 | 2026-07-31 | 313 (8 figma + 4 official-MCP) | 6 (2 figma) | ~5% overall / **59% of figma-related** | 2 of 8 figma (**25%**) | Figma-as-spec: measured `StageNode` connection-handle geometry read-only to reproduce marker/edge SVG in code — **external: vip-workflows**, remote | 2 (TOOL-028, INFRA-005 ctx); recurrences: **BUG-016 (5th, hypothesis falsified + re-root-caused)**, BUG-014 (4th) | 0 |
| 44 | 2026-08-14 | 369 (173 figma + 31 official-MCP) | 17 (all figma) | **~27%** | 6 (1.6%) | VIP Workflow **block-editor sidebar** (7 states, 381 nodes) + **~30 app modals** componentised against WPDS/`@wordpress/ui`/`@wordpress/icons` + alternate transition-rail board — built **entirely via `run_script`** (119 calls; 0 `write`/`edit`/`lint`/`grep`) — **external: vip-workflows**, remote | 3 (TOOL-029, BUG-023, AGENT-025); recurrences: **BUG-016 (6th, 62 calls lost — worst on record, permanent defection to official MCP)**, BUG-014 (6th, original page-enumeration half), TOOL-021 (2nd), TOOL-022 (2nd), TOOL-026 (2nd) | 0 |
| 45 | 2026-08-19 | 183 (113 figma + 14 official-MCP) | 7 (6 figma + 1 harness JSON parse) + **2 unflagged soft** | ~27% (49 of 183) | 3 (1.6%) | VIP Workflow **Settings** surface: shared-components board (AdminPage.Header, SettingsSection(+Heading), TabStrip, ToolCard, AgentCard, ChannelCard, PromptField, shared states) + screens board (Settings/Tools/Agents/Notifications) — **349 nodes created, 272 node-edits via `write`/`edit`**, `run_script` share down to 28% — **external: vip-workflows**, remote (sequel to S44, same file) | 5 (TOOL-030, BUG-024/025/026, AGENT-026); recurrences: **BUG-016 (7th — memory-encoded defection, 24 calls)**, BUG-014 (7th), TOOL-021 (3rd), TOOL-026 (3rd), TOOL-025 (2nd) | 0 |
| 46 | 2026-08-24 | 100 (70 figma + **0 official-MCP**) | 16 (15 figma) | ~20% (20 of 100) | 3 (3.0%) | Sidebar board **reconciled to shipped React code**: card chrome stripped from all 7 states, assigned state rebuilt as a flat panel stack, Tools + Editorial Metadata cards deleted and their checks moved inside the transition rail, rail vector track redrawn against measured button geometry — 19 frames + 9 texts + 5 clones, all via `run_script` (**0 `write`**, 2 `edit`) — **external: vip-workflows**, remote (sequel to S44/S45, same file) | 3 (BUG-027, BUG-028, AGENT-027); **BUG-016 (8th) — v3 fix VERIFIED on protocol-safety + zero defection, cap diagnosis falsified**; recurrences: TOOL-026 (4th) | 0 |
| 47 | 2026-08-25 | 69 (37 figma + **0 official-MCP**) | 9 (all figma) | ~16% (11 of 69) | 2 (2.9%) | Figma page reconciled to shipped plugin source: blueprint picker, brand picker, chat-load-failure state, 4 wp-admin screens (Blueprints/Brands lists + both editors), "What we built" summary, Start-over links on 5 in-flight frames, all 15 frames renumbered — 7 frames created + 6 updated, **all via `run_script`** (0 `write`, 0 `edit`) — **external: site-foundry**, remote, **first analysed session on this file/project** | 1 (TOOL-031); **BUG-016 (9th) — ROOT CAUSE PINNED to `remote/client.ts:110-114`, shared with BUG-027; behavioural fix verified unbiased (0 official-MCP calls in an untutored project)**; **TOOL-029 VERIFIED**; recurrences: AGENT-025 (3rd) | 1 (TOOL-029) |
| 48 | 2026-08-25 | 192 (155 figma + **0 official-MCP**) | 20 (17 figma + 3 Bash quoting) | ~16% (31 of 192) | 2 (1.0%) | Site Foundry admin page drawn from shipped plugin source as 8 state frames (chat, generating, awaiting confirmation, provisioning, preflight, step error, site ready, Jetpack not connected) using real WPDS/`@wordpress/ui` instances — **~250 nodes created via 30 `write` + 27 `edit`, 457 properties bound to library variables, 0 `run_script`** — **external: site-foundry**, remote (same file as S47, and chronologically *earlier* — this session built the frames S47 renumbered) | 3 (**BUG-029**, TOOL-032, BUG-030); **BUG-016 (10th) — payload size falsified twice more (784x453 @ scale 1; 0.35 fails while 0.28 succeeds), SVG fallback fails 2nd time, behavioural fix holds 3rd session**; **BUG-018 CONFIRMED in a real session (10/10 failures) with a verified zero-code workaround**; recurrences: TOOL-026 (5th), TOOL-021 (4th), BUG-024 (2nd, escalated P2->P1), TOOL-024 | 0 |

## Issue Categories

- `missing-batch-tool` — tool exists but lacks batch variant
- `plugin-bug` — bug in Figma plugin code
- `type-coercion` — MCP server rejects valid-but-wrong-type input
- `missing-tool` — capability gap requiring new tool
- `agent-behavior` — prompt/skill improvement needed
- `infrastructure` — WebSocket, reconnection, schema freshness
