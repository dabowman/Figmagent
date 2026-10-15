# Figma MCP Session 25 Analysis

## Session Overview

- **Transcript**: `0b3cc222-6179-4d1b-a7cc-dbc81769a2b2.json`
- **Project**: cursor-talk-to-figma-mcp (`main` branch)
- **Duration**: 41 minutes (11:41–12:22)
- **Total tool calls**: 74
- **Figma tool calls**: 59
- **Non-Figma tool calls**: 15 (11 ToolSearch + 1 Agent + 1 Write + 1 EnterPlanMode + 1 ExitPlanMode)
- **Total errors**: 0 hard (`is_error`); ~10 soft failures (7 `set_text_content` timeouts + 3 `get_design_system` overflows) — all `is_error: false`
- **Reconnections**: 3 (`join_channel` #27, #36, #39 — triggered by instance-text-write timeouts; reads worked throughout)
- **Context restarts**: 0
- **Task**: Build a mobile-first (390px) database-sync screen with two states — a configuration form (Frame 1, 66 nodes) and a progress/completion view (Frame 2) — using design-system components, token bindings, annotations, and a final lint pass. Used plan mode + a research sub-agent.

> Note: Still pre-rename (`get`/`apply`/`create`/`set_text_content`). `set_text_content` is now part of `edit`.

## Metrics

| Metric | Session 24 | This Session | Change |
|---|---|---|---|
| Total Figma tool calls | 20 | 59 | +195% (full 2-frame build) |
| Meta/overhead calls | 5 ToolSearch + 5 Read + 7 Bash | 11 ToolSearch + 1 Agent + plan-mode | ToolSearch-heavy |
| ToolSearch calls | 5 (12.8%) | 11 (14.9%) | +2.1pp (worsened by 3 reconnects) |
| Estimated waste % | ~30% | ~27% | -3pp |

Waste is dominated by the instance-override text-write timeout dance: 7 timed-out `set_text_content` calls + 3 `join_channel` reconnects + 2 diagnostic test-writes ≈ 12 calls, plus ~2 wasted `get_design_system` overflow attempts and a high ToolSearch count.

## Tool Call Distribution

| Tool | Calls | Notes |
|---|---|---|
| set_text_content | 15 | **7 timed out** on instance-override nodes (`I…;…`); regular text nodes wrote instantly. Same node `I58:128;4:60` retried 5× (4 timeouts + 1 success) |
| apply | 11 | Layout/sizing fixes, token bindings (24 nodes bound), lint follow-ups — well batched |
| ToolSearch | 11 | 14.9% — worsened by re-searches around 3 reconnections |
| get | 8 | Component/instance inspection + truncation diagnosis |
| export_node_as_image | 6 | Visual verification loop (truncation check → fix → re-export), sequential |
| get_design_system | 4 | 1 full (96.5K truncated) + `includeVariables:false` (styles ok) + `includeStyles:false` 60K (88.8K truncated) + 100K (overflow to file) |
| join_channel | 3 | Reconnects triggered by instance-text-write timeouts (connection was healthy) |
| create | 3 | 66-node Frame 1 in one call + Frame 2 + checkmark SVG |
| get_document_info | 2 | Initial + post-reconnect |
| lint_design | 2 | Final QA with autoFix (15 auto-fixed) on both frames |
| set_multiple_text_contents | 2 | Batched text where it worked |
| get_local_components | 1 | Component discovery |
| get_component_variants | 1 | Button variant IDs |
| set_multiple_annotations | 1 | Annotated conditional elements as planned |
| Agent | 1 | general-purpose research sub-agent (~5 min) |
| Write / EnterPlanMode / ExitPlanMode | 3 | Plan-mode build plan |

Total: 74. ✓

## Efficiency Issues

### 1. `set_text_content` on instance-override text nodes times out (saves ~12 calls) — NEW [BUG-011]

The dominant inefficiency. Writing text to nested **instance-override** text nodes (ID format `I<instanceId>;<childId>`, e.g. `I58:128;4:60`) repeatedly timed out, while writes to regular text nodes succeeded instantly.

**Pattern observed:**
- `set_text_content(I58:128;4:60)` → `"Error setting text content: Request to Figma timed out"` ×4, then succeeded on the 5th attempt ("Start Sync")
- `set_text_content(I58:50;13:172)` → timed out ×2, then succeeded ("Production")
- `set_text_content(58:42)` (regular node) → succeeded immediately
- Agent narration: *"Writes work on regular text nodes. The issue is with instance override text nodes… Instance text overrides are consistently timing out."*

**Root cause:** Resolving/writing a nested instance-override text node in the plugin is slow enough to exceed the 30s command timeout (it eventually succeeds, so it's a performance issue, not a hard failure). The slow op masquerades as a connection drop, triggering reconnections.

**Proposed fix:** Profile the instance-override text-write path in `setcharacters.js` / `apply.js` — likely re-resolving the instance tree or reloading fonts per call. Cache the resolved override node and/or emit progress updates to reset the inactivity timer (as other long ops do). Confirm whether `set_multiple_text_contents` over instance overrides has the same cost (the agent fell back to singles).

**Estimated savings:** ~7 timed-out retries + 3 reconnects + 2 diagnostics = ~12 calls per instance-heavy text session.

### 2. Reconnection loop on slow operations (recurrence) — [AGENT-014] / [BUG-008]

The 3 `join_channel` reconnects were all triggered by the instance-text-write timeouts, not real disconnections — reads worked the entire time. The agent's narration ("Connection works for reads… the previous timeouts may have been transient") shows it eventually realized the connection was healthy and the operation was just slow. The timeout responses returned `is_error: false` with `"Request to Figma timed out"` in the content — [BUG-008] recurring beyond `import_library_component` to `set_text_content`.

**Fix needed:** [AGENT-014] — "if `join_channel` succeeds instantly after a timeout, the connection is healthy; the operation is slow." [BUG-008] — set `is_error: true` on all timeout responses, not just imports.

### 3. `get_design_system` filtering exists but is too coarse (saves ~2 calls) — [TOOL-014] (partial implementation)

Filtering params **have been added** since this issue was first logged — `includeStyles` / `includeVariables` now work, and the styles-only call (`includeVariables: false`) succeeded. But the **variables collection alone is 88K chars** and still overflowed at 60K and again at 100K (dumped to file).

**Pattern observed:** `get_design_system()` → 96.5K truncated → `{includeVariables: false}` → styles returned OK → `{includeStyles: false, maxOutputChars: 60000}` → 88.8K truncated → `{includeStyles: false, maxOutputChars: 100000}` → 102.9K overflow to file.

**Root cause:** [TOOL-014] partially implemented. The include/exclude toggles split styles from variables, but the variable set is itself too large — there's no `collection` or `namePattern` filter to query a subset.

**Proposed fix:** Add `collection` (by collection name) and `namePattern` (regex) filters so the agent can fetch e.g. just the color collection or `font/*` variables. Saves ~2 overflow attempts.

### 4. ToolSearch overhead worsened by reconnects (saves ~6 calls) — [TOOL-005]

11 ToolSearch (14.9%), several clustered around the 3 reconnections (re-fetching schemas after each `join_channel`). Highest count since session 18.

## Error Analysis

### 1. Instance-override text-write timeouts (7 soft failures, ~6 minutes lost)

`"Error setting text content: Request to Figma timed out"` on `I58:128;4:60` (×4) and `I58:50;13:172` (×2), plus retries. All `is_error: false`.

**Agent recovery:** Methodical and good, but slow. It correctly isolated the cause — tested a simple regular-node write (worked), then an instance-override write (timed out), then a simpler toggle instance (worked), concluding instance overrides were the slow path. The cost was 3 reconnections and ~5 retries before the writes went through. A faster path: recognize after 2 timeouts on the *same instance-override write* that the op is slow (not disconnected) and let it run / skip.

**Fix needed:** [BUG-011] performance fix + [BUG-008] flag timeouts as errors + [AGENT-014] don't reconnect on slow ops.

### 2. `get_design_system` overflow (3 soft failures, ~1 minute lost)

See efficiency issue 3. **Agent recovery:** Good — used the new `includeStyles`/`includeVariables` filters intelligently, got styles cleanly, and accepted the variables file dump.

## What Worked Well

1. **Plan mode for a complex build.** Used `EnterPlanMode` → wrote a structured 2-frame implementation plan → `ExitPlanMode` (approved) before touching the canvas. Appropriate for a 2-state, 66+-node screen.

2. **66-node create in one call.** Frame 1's entire structure built in a single nested `create` ([TOOL-007] verified again), then styled/bound in follow-up `apply` passes.

3. **Methodical timeout diagnosis.** Rather than blindly retrying, the agent isolated the instance-override write as the slow path by testing a regular node and a simpler instance — good debugging discipline even though the underlying bug cost time.

4. **Visual verification loop.** `export_node_as_image` → spotted text truncation → fixed widths/FILL sizing → re-exported → confirmed. Caught real layout issues.

5. **Used the new design-system filters.** `includeStyles`/`includeVariables` toggles (the [TOOL-014] partial fix) let it get styles cleanly in one call.

6. **Clean finish.** `lint_design` with autoFix (15 fixes) on both frames + `set_multiple_annotations` on conditional elements, as planned.

## Priority Improvements

### Tool Changes (ranked by call savings)

1. **[BUG-011] Instance-override text-write performance** — Profile and speed up `set_text_content` on `I…;…` nodes (cache resolved override / emit progress to reset the timeout). ~12 calls per instance-heavy session.

2. **[BUG-008] Flag all timeouts as `is_error: true`** — Not just imports; `set_text_content` timeouts also return `is_error: false`, forcing content-string parsing.

3. **[TOOL-014] Add `collection`/`namePattern` filters** — The include/exclude toggles exist but the variable collection (88K) still overflows. ~2 calls per large-design-system session.

### Agent Skill Updates

1. **[AGENT-014] Don't reconnect on slow operations** — If `join_channel` succeeds instantly after a timeout, the connection is healthy. After 2 timeouts on the same write, treat it as a slow op (let it run / skip), not a disconnect. This session reconnected 3× unnecessarily.
