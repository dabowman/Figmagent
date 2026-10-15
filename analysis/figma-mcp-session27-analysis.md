# Figma MCP Session 27 Analysis

## Session Overview

- **Transcript**: `72e93572-9d9d-447c-b825-4b0b8dc232c6.json`
- **Project**: cursor-talk-to-figma-mcp (`claude/figma-mcp-assessment-exec-iacfe3` branch)
- **Date**: 2026-06-16 (the most recent session in the backlog — **post tool-rename**, **remote transport**)
- **Duration**: 8 minutes (18:17–18:25)
- **Total tool calls**: 25
- **Figma tool calls**: 17
- **Non-Figma tool calls**: 8 (4 ToolSearch + 1 AskUserQuestion + 1 Write + 1 Read + 1 Edit)
- **Total errors**: 1 hard (`is_error` — first `read` before `use_file`); plus the silent `fig.bindVariable` stroke no-op (no error surfaced)
- **Reconnections**: 0 (remote transport — no relay/channel; `use_file` selects the file)
- **Context restarts**: 0
- **Task**: Lint and tokenize a page ("Architecture — Slide", `156:749`) in a Tempo deck via the **remote transport** — locate the page from a selected node, run `lint`, auto-fix exact matches, and bind `color/neutral/300` to ~124 grid-line strokes, then record results. Ended writing an assessment doc.

> Note: First analyzed session on the **new tool names** (`read`/`grep`/`lint`/`use_file`/`run_script`) and the **remote transport** (headless, no plugin/channel, `run_script` escape hatch available).

## Metrics

| Metric | Session 26 | This Session | Change |
|---|---|---|---|
| Total Figma tool calls | 67 | 17 | -75% (focused lint/bind task) |
| Meta/overhead calls | 11 ToolSearch + Read/Bash | 4 ToolSearch + AskUserQuestion | Lower |
| ToolSearch calls | 11 (12.9%) | 4 (16%) | +3.1pp (short-session ratio) |
| Estimated waste % | ~28% | ~22% | -6pp |

Waste drivers: the `fig.bindVariable` stroke no-op (3 extra `run_script` calls to diagnose + re-bind), the first `read` before `use_file` (1), and ToolSearch (4). The page-finding via ancestry was forced by the remote overview limit, not waste.

## Tool Call Distribution

| Tool | Calls | Notes |
|---|---|---|
| read | 5 | 1 **failed** (no file selected, pre-`use_file`); 1 overview; node inspection + ancestry trace to find the page; 1 verify |
| lint | 5 | Page `156:749` (338 nodes, hit 200-issue cap); autoFix pass; `properties`-filtered pulls; 2 verification re-lints |
| run_script | 4 | Stroke binding (remote escape hatch) — 1 failed (`fig.bindVariable`), 1 diagnose, 1 test (`setBoundVariableForPaint`), 1 full bind |
| ToolSearch | 4 | 16% — short-session ratio |
| grep | 1 | Locate nodes |
| get_selection | 1 | Returned nothing useful (headless remote — no live selection) |
| use_file | 1 | Select the file (required on remote) |
| AskUserQuestion | 1 | Asked how to handle lint findings — good use |
| Write / Read / Edit | 3 | Assessment doc |

Total: 25. ✓

## Efficiency Issues

### 1. `fig.bindVariable` doesn't bind stroke paints (saves ~3 calls) — NEW [BUG-013]

The headline finding (already captured in project memory `fig-bindvariable-stroke-bug.md`). In a `run_script`, `fig.bindVariable` reported binding 124 grid-line strokes ("0 skipped") but **nothing persisted** — it silently returned warnings instead of binding stroke paints.

**Pattern observed:**
- `run_script` "Bind color/neutral/300 to all #dcd7cb grid-line strokes" → reported 124 bound, 0 skipped
- Verify `lint` → strokes still 132 (unchanged)
- Verify one node directly → still raw `#dcd7cb`, no binding; `fig.bindVariable` "returned an empty warning and doesn't bind LINE strokes — it doesn't handle stroke paints"
- `run_script` test with `setBoundVariableForPaint` on one node → works
- `run_script` apply `setBoundVariableForPaint` to all → 124 bound for real

**Root cause:** The `run_script` stdlib's `fig.bindVariable` helper (in `stdlib.js`) handles fill paints but not stroke paints — it returns warnings (which a caller may discard) rather than binding or failing loudly. The correct Plugin API for paint binding is `setBoundVariableForPaint`.

**Proposed fix:** Make `fig.bindVariable` handle stroke paints via `setBoundVariableForPaint` (mirror the fill path for `strokes`), and surface its warnings as thrown errors so a no-op can't masquerade as success. Until fixed, the [[fig-bindvariable-stroke-bug]] memory documents the workaround.

**Estimated savings:** ~3 `run_script` calls + 1 verification lint per stroke-binding task.

### 2. Remote transport under-reports pages + no live selection (saves ~3 calls) — NEW [BUG-014]

On the remote (headless) transport, `read` with no nodeId returned only "Page 1" (`0:1`) as the document overview, even though the user's selected node (`198:1567`) lived on a different page ("Architecture — Slide", `156:749`). And `get_selection` returned nothing usable (no live selection in a headless VM).

**Pattern observed:** `read` overview shows only "Page 1" → `get_selection` empty → agent reads the link's node `198:1567` → traces ancestry across multiple `read` calls to discover the real parent page `156:749`.

**Root cause:** Remote transport limitations — the document overview enumerates only the first/active page, and there's no live selection. The agent had to reconstruct the page from the node ID the user pasted.

**Proposed fix:** On remote, have the document overview enumerate **all** pages (or note that more exist), and resolve a node's parent PAGE directly (a helper that returns the page for a given nodeId) so the agent doesn't trace ancestry by hand. Document the headless `get_selection` limitation.

**Estimated savings:** ~3 reads per remote multi-page session.

### 3. First `read` before `use_file` on remote (saves ~1 call)

`read` (no nodeId) failed with `"No Figma file selected. Pass a file URL to use_file"`. On the plugin transport the server auto-joins, but remote requires explicit `use_file`. The agent recovered immediately.

**Proposed fix:** Minor — the error already states the fix. Could note in the remote section of CLAUDE.md that the first action on remote is `use_file` with a URL/fileKey.

## Error Analysis

### 1. Silent `fig.bindVariable` stroke no-op (1 silent failure, ~2 minutes lost)

The binding reported success but didn't persist. **Agent recovery:** Exemplary — it verified via lint (strokes unchanged), then verified one node directly, correctly diagnosed that `fig.bindVariable` doesn't handle stroke paints, tested `setBoundVariableForPaint` on one node, then applied it to all 124. Textbook validate-on-one-then-batch, and it surfaced a real bug.

**Fix needed:** [BUG-013].

### 2. `read` before `use_file` (1 hard failure, negligible)

Recovered in one step. See efficiency issue 3.

## What Worked Well

1. **Color-match binding in one atomic script.** Rather than hand-enumerating 124 truncated stroke node IDs, the agent bound `color/neutral/300` to every `#dcd7cb` stroke by color match in a single atomic `run_script` — which also naturally excluded the 8 unrelated black `ambiguous` vectors. Elegant use of the remote escape hatch.

2. **Validate-on-one-then-batch.** Tested `setBoundVariableForPaint` on a single node before applying to all 124 — exactly the [AGENT-011] discipline, and it caught the `fig.bindVariable` bug instead of silently shipping 124 no-op "binds".

3. **Adapted to remote headless limits.** When the overview showed only "Page 1" and `get_selection` was empty, the agent used the node ID from the user's link and traced ancestry to find the real page — no thrashing.

4. **AskUserQuestion for the decision.** Asked how to handle the lint findings (auto-fix exact matches vs bind grid lines) rather than guessing — matches the global "use AskUserQuestion for choices" rule.

5. **Good lint-cap handling.** The page hit the 200-issue detail cap (338 nodes); the agent used `properties` filters and `maxIssues` to pull just the stroke issues (132) under the cap.

6. **Measurable result.** Drove the page from 200 (capped) issues → 68, exact-match fills 8 → 0, stroke issues 132 → 8, and recorded it.

## Priority Improvements

### Tool Changes (ranked by call savings)

1. **[BUG-013] `fig.bindVariable` stroke paints** — Handle stroke paints via `setBoundVariableForPaint` in the `run_script` stdlib, and throw on warnings instead of returning a silent no-op. ~3 calls per stroke-binding task. (Workaround documented in the `fig-bindvariable-stroke-bug` memory.)

2. **[BUG-014] Remote overview: enumerate all pages + resolve node→page** — On remote, list all pages in the document overview and add a helper to resolve a node's parent PAGE directly. ~3 reads per remote multi-page session.

### Agent Skill Updates

1. **Remote-first onboarding** — On the remote transport, call `use_file` (URL/fileKey) before the first `read`; `get_selection` is unavailable (headless) — use the node ID from the user's link. Add to the remote section of CLAUDE.md.
