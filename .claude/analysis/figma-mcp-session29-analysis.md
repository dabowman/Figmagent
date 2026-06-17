# Figma MCP Session 29 Analysis

## Session Overview

- **Transcript**: `ca6484b5-97b1-48c0-a693-e585b7b0ee88.json`
- **Project**: cursor-talk-to-figma-mcp (`main` branch)
- **Date**: 2026-06-01 (post-rename era, plugin transport)
- **Duration**: 68 minutes (22:27–23:35)
- **Total tool calls**: 161 (largest session in the backlog)
- **Figma tool calls**: ~112
- **Non-Figma tool calls**: ~49 (17 ToolSearch + 7 Bash + 6 Read + 6 TaskUpdate + 5 TaskCreate + 4 AskUserQuestion + 2 Write + 1 Edit + 1 design-system MCP)
- **Total errors**: 0 hard (`is_error`); ~4 soft (create_variables timeout, get_library_variables 403, get_design_system multi-file, lint truncation) — all `is_error: false`
- **Reconnections**: 1 (`join_channel` — multi-file disambiguation)
- **Context restarts**: 0
- **Task**: Re-create VIP Workflow components in Figma (Phase 0 foundations + App Shell, Phase 1 My Dashboard vertical with full state coverage) — import WPDS library primitives, build the app shell/sidebar/tables, componentize atoms (badges, tabs, nav items), bind tokens, then a review/lint/reorganize pass. Used plan mode, TaskCreate/Update tracking, and the WPDS library + design-system MCP.

> Note: Post-rename mixed names (`create`/`apply`/`get` + library tools). Produced the `vip-workflow-figma-build` / `wpds-figma-library-keys` memories.

## Metrics

| Metric | Session 28 | This Session | Change |
|---|---|---|---|
| Total Figma tool calls | 26 | ~112 | +331% (full vertical build) |
| Meta/overhead calls | 5 ToolSearch | 17 ToolSearch + 7 Bash + 11 Task* | More (long session, task tracking) |
| ToolSearch calls | 5 (15.2%) | 17 (10.6%) | -4.6pp (better ratio at scale) |
| Estimated waste % | ~20% | ~18% | -2pp |

Low waste for a 161-call faithful build. Drivers: the wrong-IconButton-then-correct-Button detour (~4), reactive 100px-balloon fixes (~4), create_variables timeout + rejoin (~2), and a re-lint after setting scopes (~2).

## Tool Call Distribution

| Tool | Calls | Notes |
|---|---|---|
| create | 23 | Incremental tree building (shell, sidebar, content, cards, states) — avoided timeouts by appending in chunks |
| move_node | 18 | Geometry reorganization into 3 zones after a pile-up (issued in parallel) |
| ToolSearch | 17 | 10.6% — good ratio for the length |
| set_text_content | 11 | Button/card labels (some instance-override paths) |
| apply | 11 | Layout/sizing fixes (HUG), token binding, badge styling |
| get | 10 | Structure/dimension diagnosis |
| export_node_as_image | 8 | Screenshot-driven verification loop (caught balloons, clipping, pile-up) |
| import_library_components | 3 | **All succeeded** — WPDS Buttons + error Notices ([TOOL-012] verified) |
| combine_as_variants | 3 | Atom component sets (UrgencyBadge, Tab, NavItem) |
| lint_design | 3 | Page lint with autoFix (172/204 bound after scopes set); 1 truncated |
| create_variables | 2 | 28 local color vars (1 timed out then succeeded) |
| reorder_children / rename_node | 6 | Variant-set cleanup |
| get_component_variants / search_library_components | 4 | Find correct Button/Notice variant keys |
| delete_multiple_nodes | 2 | Remove wrong IconButtons / old inline badges |
| get_library_variables | 1 | **403** (WPDS Enterprise-only) |
| TaskCreate / TaskUpdate | 11 | Phase tracking |
| AskUserQuestion | 4 | Decision points |
| others | ~9 | get_document_info, get_design_system, join_channel, update_variables, set_multiple_annotations, design-system MCP, Read/Write/Edit/Bash |

Total: 161. ✓ (≈112 Figma)

## Efficiency Issues

### 1. Variables created without scopes → ambiguous lint (saves ~2 calls) — NEW [AGENT-019] (recurring: 28, 29)

Same pattern as session 28. The agent created 28 local color variables, then `lint_design` returned 33 "ambiguous" fills because the variables had **no scopes** — the linter couldn't tell e.g. a frame-fill token from a text-fill token. The agent set scopes via `update_variables`, then re-linted → 172/204 auto-bound.

**Pattern observed:** `create_variables` (28, default scopes) → `lint_design` → 33 ambiguous → `update_variables` (set scopes on all 28) → re-lint → 172/204 bound.

**Root cause:** Scopes weren't set at creation, so the first lint pass couldn't disambiguate. `create_variables` supports scopes but they weren't passed.

**Proposed fix:** Agent-behavior — when creating variables intended for lint auto-binding, set `scopes` at creation time (frame fills vs text vs strokes). Saves a re-scope `update_variables` + a re-lint pass. Reinforce in the design-tokens workflow note.

**Estimated savings:** ~2 calls per token-creation session.

### 2. Horizontal auto-layout frames default to FIXED 100px counter-axis (saves ~4 calls) — recurring design gotcha

The agent hit the documented "balloon frame" default **twice** mid-build: nav items rendered ~100px tall, and the BREAKING badge rendered "as a tall red block." Both because horizontal auto-layout frames default to a FIXED 100px counter-axis (only vertical frames auto-hug). The agent caught both via screenshot and fixed with `layoutSizingVertical: HUG`.

**Root cause:** Known Figma behavior (CLAUDE.md "auto-layout sizing defaults"; post-write balloon-frame warning exists). The agent fixed reactively rather than setting HUG proactively at create time.

**Proposed fix:** When creating horizontal auto-layout frames (badges, pills, rows), set `layoutSizingVertical: HUG` in the same `create`/`apply`. The post-write warning catches it, but proactively setting HUG avoids the screenshot→diagnose→fix loop. ~4 calls.

### 3. Wrong library variant key (IconButton vs Button) (saves ~4 calls)

The first WPDS button import used an **IconButton** (cog icon) key instead of the text **Button** — so two action cells were wrong. The agent searched for the correct `Secondary/Small/Default, Destructive=False` Button variant, deleted the two IconButtons, and re-imported. The variant list had truncated before the right entry, masking the correct key.

**Root cause:** `get_library_components`/`get_component_variants` output truncated before the needed variant; the agent grabbed the first plausible key. Tied to output-budget truncation ([TOOL-009]-family) on library variant lists.

**Proposed fix:** When importing a specific variant, `search_library_components` for the exact variant suffix (the agent did this on recovery) rather than taking a key from a truncated list. ~4 calls.

### 4. Geometry pile-up from auto-placement → 18-node reorg (saves ~some)

Created top-level artifacts overlapped (Sidebar at (1540,0) on top of state artifacts at (1550,0)) because top-level nodes auto-place near existing content. The agent audited geometry and repositioned 18 nodes into 3 clean zones (issued in parallel).

**Root cause:** Incremental top-level creation without planned coordinates (CLAUDE.md notes auto-placement). Partly inherent to incremental building.

**Proposed fix:** Plan zone coordinates upfront for multi-artifact builds (screen / components / states columns) and pass `x`/`y` at create time. The parallel move batch was efficient recovery.

### 5. `set_instance_overrides` can't toggle a component-property boolean — capability note [TOOL-019]

The imported WPDS error Notice came with its default 3 action buttons + dismiss, but the app's Notice has none. The agent found `set_instance_overrides` "only copies overrides between instances — it can't toggle the Notice's `Actions?` boolean" and had to note it for a manual one-click toggle in Figma.

**Root cause:** No tool sets a component-property **value** (BOOLEAN/VARIANT/INSTANCE_SWAP) on an existing instance — `component_properties` defines props on local components; `set_instance_overrides` copies between instances.

**Proposed fix:** Add the ability (via `apply` or a dedicated tool) to set component-property values on an instance — e.g. `{ nodeId, componentProperties: { "Actions?": false } }`. Distinct from [AGENT-010] (exposed instances).

## Error Analysis

### 1. Soft failures, all `is_error: false` (~2 minutes lost) — [BUG-008]

create_variables timeout, get_library_variables 403, get_design_system "Multiple Figma files are open", lint truncation — all `is_error: false`. **Agent recovery:** Excellent — checked if the timed-out create landed, rejoined the right channel (multi-file), retried (28 vars created); fail-fasted the 403; capped lint detail. No retry storms.

**Fix needed:** [BUG-008] flag failures; [AGENT-008] 403 fast-fail (followed correctly).

## What Worked Well

1. **[TOOL-012] batch import verified.** `import_library_components` (plural) succeeded 3× importing WPDS Buttons + error Notices into the build — the P0 batch-import gap is implemented and working, with no clone-reparent workaround ([BUG-004] not observed).

2. **Plan mode + task tracking + AskUserQuestion.** Presented the plan for approval, tracked phases with TaskCreate/Update, and asked the user at 4 real decision points (placeholders+annotate, componentize atoms, finish vertical). Disciplined for a 68-minute build.

3. **Screenshot-driven verification loop.** 8 `export_node_as_image` calls caught real issues early — the 100px balloons, the 1053px-frame clipping the 1140px content, and the geometry pile-up — each diagnosed and fixed.

4. **Componentization retrofit.** Built atoms (UrgencyBadge/StatusBadge/Spinner/Tab/NavItem) with `combine_as_variants`, then retrofitted the inline table badges into real instances.

5. **Lint + scopes → 172/204 auto-bound.** After setting scopes, the auto-fix lint pass bound 172 of 204 fills/strokes to tokens (instance children correctly skipped), without altering appearance.

6. **Incremental create to avoid timeouts.** Built the shell "incrementally to avoid timeouts" — appending nav sections in chunks rather than one huge tree. Good adaptation to the timeout risk.

7. **Saved conventions + library keys to memory** for the next phase (per the memory workflow).

## Priority Improvements

### Tool Changes (ranked by call savings)

1. **[TOOL-019] Set component-property values on an instance** — Allow toggling BOOLEAN/VARIANT/INSTANCE_SWAP props on an imported instance (e.g. WPDS Notice `Actions?: false`). Currently impossible via tools.

2. **[BUG-008] Flag failures as `is_error: true`** — Recurred again (timeout, 403, multi-file). Server-level fix.

### Agent Skill Updates

1. **[AGENT-019] Create variables with scopes** — Set `scopes` at creation so the first lint pass can auto-bind without a re-scope + re-lint (recurring: sessions 28, 29).

2. **Set `layoutSizingVertical: HUG` on horizontal auto-layout frames at create time** — Avoid the 100px-balloon screenshot→fix loop (hit twice this session).

3. **Plan zone coordinates for multi-artifact builds** — Pass `x`/`y` at create time to avoid an auto-placement pile-up and reorg pass.

4. **Import specific variants via `search_library_components`** — Don't take a key from a truncated variant list (IconButton-vs-Button mix-up).
