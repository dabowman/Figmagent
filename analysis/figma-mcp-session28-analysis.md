# Figma MCP Session 28 Analysis

## Session Overview

- **Transcript**: `d2b391c1-4aa1-468b-b617-134b6bd667e6.json`
- **Project**: cursor-talk-to-figma-mcp (`main` branch)
- **Date**: 2026-06-09 (post-rename era, plugin transport)
- **Duration**: 17 minutes (14:01–14:18)
- **Total tool calls**: 33
- **Figma tool calls**: 26
- **Non-Figma tool calls**: 7 (5 ToolSearch + 1 Read + 1 Edit)
- **Total errors**: 0 hard (`is_error`); 3 soft (lint timeout, `get` "Node not found", `get_library_variables` 403) — **all `is_error: false`**
- **Reconnections**: 0
- **Context restarts**: 0
- **Task**: Lint and tokenize 4 screens in the VIP Workflow "🖥️ Screens" file — bind exact-match color fills/strokes to existing VIP Workflow Tokens, correct semantically-wrong color bindings (39 white surfaces on a white *text* token → new `surface/default` token), and produce a report-only px inventory of unbound gap/font-size values (WPDS variables unavailable). Used AskUserQuestion to scope the work; recorded findings to memory.

> Note: Mixed tool names (`get`/`apply`/`find`/`lint_design` + `get_library_variables`). Plugin transport.

## Metrics

| Metric | Session 27 | This Session | Change |
|---|---|---|---|
| Total Figma tool calls | 17 | 26 | +53% |
| Meta/overhead calls | 4 ToolSearch | 5 ToolSearch + 1 Read + 1 Edit | Similar |
| ToolSearch calls | 4 (16%) | 5 (15.2%) | -0.8pp |
| Estimated waste % | ~22% | ~20% | -2pp |

Low waste for a multi-screen lint/correction task — the 3 soft failures were each handled in one step (no retry storms), and most calls were productive token work.

## Tool Call Distribution

| Tool | Calls | Notes |
|---|---|---|
| lint_design | 12 | 1 timed out (`2:3`); per-frame across 4 screens with autoFix; 94-issue truncation forced `maxIssues`; `properties`-filtered re-lints |
| ToolSearch | 5 | 15.2% |
| get | 2 | 1 **failed** ("Node not found" — URL node in a different file); 1 frame inspection |
| AskUserQuestion | 2 | Scope the work (cross-file confirm; report-only vs fix) — good use |
| find | 2 | Locate nodes by variableId (white-token audit) |
| create_variables | 2 | New `surface/default` token (created with default scopes) |
| get_document_info / get_selection / get_design_system | 3 | Orientation; local DS = VIP Workflow Tokens only |
| get_library_variables | 1 | **403** (WPDS Enterprise-only) |
| update_variables | 1 | Set `surface/default` scopes (separate from creation) |
| apply | 1 | Batched rebind of 39 white surfaces |
| Read / Edit | 2 | Memory/report doc |

Total: 33. ✓

## Efficiency Issues

### 1. All Figmagent failures return `is_error: false` (saves agent-detection time) — [BUG-008] strongly generalized

This session is the strongest evidence yet that the MCP server **never sets `is_error: true` for Figmagent command failures**. Three distinct failure types all came back `is_error: false`, with the error only in the content string:
- `lint_design(2:3)` → `"Error running lint_design: Request to Figma timed out"` (timeout)
- `get(13637:33753)` → `"Error reading nodes: Node not found: 13637:33753"` (bad node ID)
- `get_library_variables(...)` → `"Error accessing variables API: Figma API returned 403 Forbidden"` (REST auth)

**Root cause:** [BUG-008] — the MCP server returns errors as normal content. Originally logged for import timeouts (session 18), extended to `set_text_content` timeouts (25) and a `lint_design` crash (26); session 28 adds REST 403 and "Node not found". The agent must string-parse every response to detect failure.

**Proposed fix:** Set `is_error: true` for all error/timeout/exception responses across the MCP server, not per-tool. ~one generalized fix covers timeouts, crashes, not-found, and REST errors.

### 2. No tool to import/enumerate library VARIABLES (saves the WPDS dead-end) — NEW [TOOL-018]

The task needed WPDS gap/font-size variables, but: (a) `get_library_variables` 403s (Enterprise-only REST), (b) `get_design_system` showed none imported locally, and (c) the agent found **no MCP tool wraps the Plugin's library-variable API** (`getAvailableLibraryVariableCollectionsAsync` / variable import) — `import_library_component` handles **components only**. The agent correctly concluded WPDS variable binding was "genuinely not mechanically possible" and pivoted to a report-only inventory.

**Root cause:** Capability gap — variables can't be imported/enumerated from an enabled library the way components can.

**Proposed fix:** Add a tool wrapping `getAvailableLibraryVariableCollectionsAsync` + `importVariableByKeyAsync` so agents can enumerate and import library variables enabled for the current file (no REST, no Enterprise token, no source file open). This is the variables analog of `import_library_component`.

**Estimated savings:** Unblocks library-variable binding entirely (currently impossible without it).

### 3. `get_library_variables` 403 (recurrence) — [AGENT-008]

WPDS library variables 403'd (Enterprise-only). The agent fail-fasted perfectly — it already had the constraint in its notes ("WPDS variables return 403 over the REST API") and did not retry other REST endpoints. Good [AGENT-008] behavior.

### 4. Cross-file URL node ID (saves ~2 calls)

The user's URL pointed to node `13637:33753` in the **WPDS Gutenberg library** file, but the plugin was connected to the **"🖥️ Screens"** file — so `get` returned "Node not found." The agent diagnosed the cross-file mismatch and confirmed scope via AskUserQuestion.

**Proposed fix:** Minor agent-behavior — when a `get` on a URL-derived node ID returns "Node not found," check whether the node belongs to a different file than the connected one before assuming a bad ID. The agent did exactly this; worth a one-line note in CLAUDE.md.

## Error Analysis

### 1. Three soft failures, all `is_error: false` (~1 minute lost)

lint timeout, "Node not found", and 403 — see efficiency issue 1. **Agent recovery:** Excellent across all three — moved past the lint timeout without retrying, diagnosed the cross-file node, and fail-fasted on the 403 with a documented alternative explored and ruled out. No retry storms.

**Fix needed:** [BUG-008] flag all as errors; [TOOL-018] for the variable-import gap.

## What Worked Well

1. **Semantic token correction.** Found 39 white *surface* frames wrongly auto-bound to a white *text* token, created a `surface/default` token, set its scopes, and rebound the 39 surfaces in one batched `apply` — excluding the one legitimate white node (the "BREAKING" label, `25:115`). This is sophisticated, correctness-driven token work, not just mechanical autoFix.

2. **Knew the library constraint cold.** Recognized the WPDS 403 from prior notes, explored the Plugin-API alternative, identified the [TOOL-018] gap, and pivoted to report-only — no wasted thrashing on an impossible binding.

3. **AskUserQuestion to scope.** Asked the user to confirm the cross-file situation and whether to report-only vs fix gap/font-size — twice, at the right decision points.

4. **Good lint-cap handling.** The 94-issue frame truncated; the agent capped issue detail (`maxIssues`) and used the always-complete summary, then `properties`-filtered re-lints to verify.

5. **Recorded findings to memory.** Per the memory workflow — the gap/font-size inventory and WPDS constraint were captured (feeds the VIP Workflow / WPDS reference memories).

6. **893 issues scanned over 394 nodes, 77 nodes bound, 0 reconnections, 17 minutes.**

## Priority Improvements

### Tool Changes (ranked by call savings)

1. **[BUG-008] Set `is_error: true` for all Figmagent failures** — Now confirmed across timeouts, crashes, "Node not found", and REST 403. A single MCP-server-level fix (flag any error/exception response) covers all of them.

2. **[TOOL-018] Library-variable import tool** — Wrap `getAvailableLibraryVariableCollectionsAsync` + `importVariableByKeyAsync`. Unblocks binding to library variables (currently impossible; only components can be imported).

### Agent Skill Updates

1. **Cross-file node IDs** — When a URL-derived node ID returns "Node not found," consider it may belong to a different file than the connected one (the agent did this well; document it).

2. **Pass scopes at variable creation** — `create_variables` then a separate `update_variables` for scopes; pass scopes inline at creation when known (minor).
