# Figma MCP Session 26 Analysis

## Session Overview

- **Transcript**: `d90142be-34ab-4811-a535-5817b3372131.json`
- **Project**: cursor-talk-to-figma-mcp (`main` branch)
- **Duration**: 12 minutes (14:38–14:51)
- **Total tool calls**: 85
- **Figma tool calls**: 67
- **Non-Figma tool calls**: 18 (11 ToolSearch + 1 Read + 3 Bash + 1 EnterPlanMode + 1 Write + 1 ExitPlanMode)
- **Total errors**: 1 hard (`is_error` — 1 Read over-token); ~6 soft failures (1 scan overflow, 3+ `lint_design` crashes, 1 lint truncation) all `is_error: false`
- **Reconnections**: 1 (`join_channel` #4 — multi-file disambiguation, not a drop)
- **Context restarts**: 0
- **Task**: Build and apply a design system to an existing imported landing page (EnvioWoo, 9 sections + nav + footer, node `9:2`) — audit colors/typography, create 20 color + 9 radius variables and 12 text/paint styles, then lint + autoFix + manually bind tokens across all sections. Used plan mode.

> Note: Still pre-rename (`get`/`apply`/`find`/`lint_design`/`scan_text_nodes`). Same imported-webpage workflow as session 23 (different file).

## Metrics

| Metric | Session 25 | This Session | Change |
|---|---|---|---|
| Total Figma tool calls | 59 | 67 | +14% |
| Meta/overhead calls | 11 ToolSearch + 1 Agent + plan-mode | 11 ToolSearch + 1 Read + 3 Bash + plan-mode | Similar |
| ToolSearch calls | 11 (14.9%) | 11 (12.9%) | -2pp |
| Estimated waste % | ~27% | ~28% | +1pp |

Waste is dominated by the `lint_design` crash forcing manual `find`+`apply` binding on 3 sections (work that autoFix should have done), plus the recurring 12 unbatched sibling `get`s and the scan-overflow Bash detour.

## Tool Call Distribution

| Tool | Calls | Notes |
|---|---|---|
| lint_design | 17 | Per-section (page-level `0:1` **crashed**); 3 sections crashed; rest as lint→autoFix→re-lint. 52 bindings auto-fixed |
| apply | 16 | Token binding + manual binding of the 3 crashed sections + text-style application |
| get | 14 | 12 unbatched sibling-section reads (#6–17, incl. `9:2` dup) + 2 verification |
| ToolSearch | 11 | 12.9% — incl. post-reconnect re-search |
| find | 7 | Locate nodes in crashed sections + text nodes by semantic role for style application |
| create_variables | 4 | 18 colors + 9 radii (batched, parallel) + 2 follow-up additions |
| Bash | 3 | Parse the 94K scan_text_nodes overflow dump |
| get_document_info | 2 | Initial + post-reconnect |
| create_styles | 2 | 12 text + 3 paint styles (batched) |
| get_design_system | 2 | Verify creation + final coverage check |
| scan_text_nodes | 1 | Typography audit — overflowed (94,314 chars to file) |
| Read | 1 | **Failed** on the scan dump (37,390 tokens > 10K) — then switched to Bash (1 retry, improved) |
| update_variables | 1 | Fix blue-tint channel |
| join_channel | 1 | Multi-file disambiguation |
| EnterPlanMode / Write / ExitPlanMode | 3 | Plan-mode token-system plan |

Total: 85. ✓

## Efficiency Issues

### 1. `lint_design` crashes on certain nodes (saves ~15 calls) — NEW [BUG-012]

The headline finding. `lint_design` threw `"Error running lint_design: cannot read property 'type' of undefined"` on the root frame (`9:2`), the page (`0:1`), and 3 sections (nav, footer, pricing). The crash forced the agent to lint per-section and then **manually** bind tokens on the crashing sections via `find` + `apply`.

**Pattern observed:**
- `lint_design(9:2)` → `"Error running lint_design: cannot read property 'type' of undefined"`
- `lint_design(0:1)` (page) → same crash
- `lint_design(9:590)` → same crash
- Working sections returned normal results; agent narration: *"footer/nav are hitting a bug… handle the 3 erroring sections manually"* and *"gradient fills (9:227) likely caused the lint error."*
- Recovery: `find` nodes in the crashed sections → `apply` variables manually (30 bindings on pricing alone).

**Root cause:** The lint traversal reads a `.type` property off a node (or sub-object like a fill/gradient stop) without a guard, crashing on a node shape it doesn't expect — the agent's evidence points to gradient fills. A missing `prop()` strict-guard read at a serializer/traversal boundary (the documented remote-VM hazard). The crash returns `is_error: false` ([BUG-008] again).

**Proposed fix:** Add defensive `prop(node, "type")` guards in `lint.js`'s `collectNodes`/traversal and handle GRADIENT paint types explicitly (skip or match gradients rather than dereferencing undefined). Reproduce with a frame containing a gradient fill.

**Estimated savings:** ~15 calls (the manual find+apply binding of 3 sections that lint+autoFix should have handled).

### 2. Unbatched sibling section reads (recurrence) — [AGENT-017]

Identical to session 23: 12 individual `get` calls (#6–17) over sibling sections (`9:590`, `9:4`, `9:31`, `9:103`, `9:145`, `9:268`, `9:334`, `9:381`, `9:445`, `9:574`) plus a `9:2` duplicate. `get` accepts a `nodeIds` array — these could collapse to ~2 calls.

**Estimated savings:** ~8 calls.

### 3. `scan_text_nodes` overflow → Bash parse (recurrence, but faster recovery) — [TOOL-009] / [AGENT-018]

`scan_text_nodes(9:2)` overflowed (94,314 chars → file). `Read` failed once (37,390 tokens > 10K), then the agent **immediately switched to Bash** — only 1 Read retry, a clear improvement over session 24's 4 identical Read retries. Still 3 Bash calls to parse. Same underlying [TOOL-009] (overflow dump exceeds Read limit) friction.

**Estimated savings:** would be ~4 calls if `scan_text_nodes`/`grep` paginated within budget.

### 4. ToolSearch overhead (recurrence) — [TOOL-005]

11 ToolSearch (12.9%), including a post-reconnect re-search.

## Error Analysis

### 1. `lint_design` crash (3+ soft failures, ~2 minutes lost)

`"Error running lint_design: cannot read property 'type' of undefined"` on `9:2`, `0:1`, `9:590`, and (per narration) nav/footer. `is_error: false`.

**Agent recovery:** Good — recognized the crash, isolated it to specific sections, hypothesized the cause (gradient fills), fixed the bindable parts via lint+autoFix on the working sections, and manually bound the crashed sections with find+apply. No retry storm.

**Fix needed:** [BUG-012] guard the lint traversal; [BUG-008] flag the crash as `is_error: true`.

### 2. Read over-token on scan dump (1 failure, negligible)

Same class as session 24 but the agent recovered after a single Read attempt — [AGENT-018] guidance behavior, applied well here.

## What Worked Well

1. **Improved fail-fast on overflow.** Only 1 Read attempt on the 37K-token scan dump before switching to Bash — a direct improvement over session 24 (4 identical Read retries). This is the [AGENT-018] behavior working.

2. **Plan mode + parallel token creation.** Planned the token system, then created 18 colors + 9 radii + 15 styles via batched `create_variables`/`create_styles` calls run in parallel — all succeeded.

3. **lint → autoFix → re-lint loop.** Auto-fixed 52 bindings across the working sections; re-linted to confirm (e.g. `9:31` went 49 issues → 1, `9:4` → 0).

4. **Methodical crash workaround.** When lint crashed on nav/footer/pricing, the agent didn't thrash — it used `find` to locate unbound nodes and `apply` to bind them directly, and fixed a wrong color channel (`accent/blue-tint` 0.976 → 0.996) that was causing near-matches.

5. **`find` by semantic role for style application.** Located heading/body/caption text nodes by role and batch-applied text styles (21 headings, 24 body, etc.) — efficient style rollout.

6. **Clean multi-file disambiguation** (1 reconnect, picked the right file).

## Priority Improvements

### Tool Changes (ranked by call savings)

1. **[BUG-012] Guard `lint_design` traversal against undefined `.type`** — Add `prop()` guards and handle GRADIENT paints in `lint.js`. The crash forced ~15 manual binding calls. Reproduce with a gradient-filled frame.

2. **[BUG-008] Flag lint/all timeouts and crashes as `is_error: true`** — The lint crash returned `is_error: false`, requiring content parsing.

3. **[TOOL-009]-family pagination for `scan_text_nodes`/lint output** — Large-page scans (94K) and lint (76-item truncation) overflow; paginate within budget so Read can open the dump.

### Agent Skill Updates

1. **[AGENT-017] Batch sibling reads** — Recurred again (session 23 + 26): use `get` with a `nodeIds` array for sibling-section sweeps. ~8 calls.
