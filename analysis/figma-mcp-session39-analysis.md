# Figma MCP Session 39 Analysis

## Session Overview

- **Transcript**: `de1c4083-6d93-463d-a970-2b062048be35.json` (this repo, `feat/auto-improve-pipeline`, local Figma file)
- **Duration**: 99 minutes
- **Total tool calls**: 168 (35 Figmagent)
- **Total errors**: 3 (2 Edit "file not read yet" — orchestrator workflow slips; 1 Figmagent `screenshot` MCP `-32602` reject — BUG-016)
- **Reconnections**: 0
- **Context restarts**: 0
- **Task**: **Benchmark orchestration.** Build the WPDS benchmark seed (37 primitive + 16 semantic variables, 5 text + 4 elevation styles, a handful of fixture components on a Fixtures/Patterns page), then run a two-round head-to-head benchmark (14-prompt set + 8-prompt "differentiating-tools" expansion) of **Figmagent vs. the official Figma MCP**, resetting the file to a pristine seed between every contestant, scoring the results into `tests/benchmark-runs/2026-06-19-figmagent-vs-figma-mcp.md`, and filing findings (BUG-016/017/018) as GitHub issues.

> **Note on scope.** This is a *meta/orchestration* transcript, not a design transcript. The actual canvas builds happened inside **5 delegated agents** (`Agent` calls #71, #94, #114, #144, #158 — one fork + four general-purpose) whose sub-transcripts were **not captured** (`subAgents: {}`). The orchestrator's own 35 Figma calls are seed-build + verification (read/screenshot) + file-reset (run_script). Per-contestant design efficiency lives in those uncaptured agents and in the committed benchmark run doc, not here.

## Metrics

| Metric | Session 38 | This Session (39) | Change |
|---|---|---|---|
| Total tool calls | 21 (16 figma) | 168 (35 figma) | much larger — multi-round orchestration |
| Meta/overhead calls | 3 (~14%) | 8 ToolSearch + 39 Task* (orchestration scaffolding) | orchestration-heavy by design |
| ToolSearch | 2 | 8 (4.8%) | env artifact (Figmagent tools deferred this run) |
| Errors | 3 | 3 (1 Figma `-32602`, 2 Edit re-read) | comparable |
| Estimated waste % | ~14% | ~8% (≈13 calls: 8 ToolSearch + 3 error/re-read + ~2 redundant select) | low given scope |

## Tool Call Distribution

| Tool | Calls | Notes |
|---|---|---|
| `Bash` | 38 | seed-payload generation, git, sync-issues, test/lint/build, tracker edits |
| `TaskUpdate` | 25 | orchestration progress tracking across 2 rounds |
| `Edit` | 24 | benchmark spec + tracker + run-doc authoring; 2 failed (file not read first) |
| `TaskCreate` | 14 | phase planning per round |
| `mcp__Figmagent__screenshot` | 13 | verification of agent outputs; **1 failed** (`2003:10153`, BUG-016) |
| `ToolSearch` | 8 | loading deferred Figmagent/design-system schemas; #34/#35 and #44/#45 overlap |
| `mcp__Figmagent__read` | 8 | orient on seed + read each agent's run page (`2002:8`, `2006:8`, `2012:8`, `2015:8`) |
| `Write` | 7 | benchmark spec, seed token files, payload generators, run doc |
| `Read` | 6 | spec/tracker/config reads |
| `mcp__Figmagent__run_script` | 6 | **all page CRUD / file-state reset** — see Efficiency Issue 1 |
| `AskUserQuestion` | 5 | scope/approach gates |
| `Agent` | 5 | delegated seed build + 4 benchmark contestant runs |
| `mcp__Figmagent__use_file` | 2 | auto-join (seed file, then run file) |
| `mcp__Figmagent__create_variables` | 2 | 37 primitives, then 16 semantics (server-generated payloads) |
| `mcp__design-system__get_design_tokens` | 1 | seed token sourcing from WPDS |
| `mcp__Figmagent__create_styles` | 1 | 5 text + 4 elevation styles in one call |
| `mcp__Figmagent__write` | 1 | seed fixture components |
| `mcp__Figmagent__edit` | 1 | seed adjustments |
| `mcp__Figmagent__get_design_system` | 1 | confirm seed state before a run |

## Efficiency Issues

### 1. No first-class page management — every page op falls to `run_script` (new: TOOL-023)

All **6** `run_script` calls were page/file-state operations, not design logic:

**Pattern observed:**
- #63 "Rename Page 1 to Fixtures and create a Patterns page"
- #93 "Create the Figmagent run page"
- #112 "Reset file to pristine seed: remove run page + non-baseline collections/styles"
- #113 "Create the Figma MCP run page"
- #143 "Reset to pristine seed (remove round-1 Figma MCP page + Spacing) and create the expansion run page"
- #157 "Reset to pristine (remove Run2 page, restore widened variable scopes) and create Figma MCP expansion page"

**Root cause:** Figmagent has no `create_page` / `rename_page` / `delete_page` tool, and no "reset/cleanup non-baseline collections+styles+pages" operation. `write`/`edit`/`delete` operate on canvas nodes, not on `PAGE` nodes or document-level collections, so page creation, renaming, deletion, and file-state reset all drop to the remote-only `run_script` escape hatch.

**Proposed fix:** Add page CRUD to a first-class tool surface — e.g. `write({ type: "PAGE", name })`, `edit({ nodeId: "<page>", name })` for rename, and `delete: true` on a PAGE node — so multi-artifact / harness / benchmark workflows don't reach for `run_script`. (Filed as **TOOL-023**, P2; recurs in any multi-page or harness workflow, rare in single-page design sessions.)

**Estimated savings:** ~6 `run_script` calls per multi-round harness session; ~1–2 per ordinary multi-artifact build.

### 2. Redundant / repeated `ToolSearch` selects (~2 calls)

8 `ToolSearch` calls (4.8%). Two pairs overlap: #34 (`select:read,use_file,…`) then #35 (keyword `Figmagent figma read write create variables`) re-discover the same surface; #44 and #45 both `select:` overlapping Figmagent tools.

**Root cause:** Environment artifact — this run started with Figmagent tools **deferred** (schemas not preloaded), contradicting the usual CLAUDE.md "No ToolSearch needed" assumption. Once deferred, the agent searched, then re-searched after intervening turns evicted the loaded schemas.

**Proposed fix:** No tracker action — this is a harness/deferral artifact, not a Figmagent flaw. Agent guidance already covers it ("call tools directly by name"); the deferral was outside the agent's control here. Noted for completeness only.

**Estimated savings:** ~2 calls in deferred-tool runs.

## Error Analysis

### 1. `screenshot` MCP `-32602 invalid_union` on a large node (1 failure — BUG-016, recurrence)

#109 `screenshot({ nodeId: "2003:10153", scale: 1 })` — the full **390×844 login screen** the Figmagent contestant built — returned `MCP error -32602: Invalid tools/call result: [{ "code": "invalid_union", … "path": ["type"], "message": "expected \"text\"" }, { "expected": "string", "code": "invalid_type", "path": ["text"] … }]`. The returned content block was neither a valid `text` nor `image` block, so the SDK rejected the whole result. Mid-size siblings on the same page screenshotted fine (`2003:24`, `2003:97`, `2003:69`, `2007:22`, `2008:2048`, etc.).

**Agent recovery:** Excellent — the orchestrator immediately diagnosed it in-line ("a real Figmagent remote screenshot bug on large nodes — the DataTable worked, the big login frame didn't"), recorded it as a benchmark finding, and proceeded to verify other artifacts. No retry storm.

**Fix needed:** Already tracked — **BUG-016** (result-serialization fix in the remote `screenshot`/`export` path; guarantee a conformant `image` block or a clean `is_error` text block; cap/handle oversized exports). This session confirms the bug is **not agent-specific**: it fires from the *orchestrator's* verification path too, on the same larger/complex-node correlation. Adding session 39 to BUG-016's affected list (its "Recurred: Benchmark run 2026-06-19" note already describes this exact frame).

### 2. Edit "File has not been read yet" (2 failures — generic, not Figma)

#29 and #128 — `Edit` on tracker/analysis files before a `Read` in the same context. Recovered immediately (Read → Edit). Generic Claude Code workflow slips, unrelated to Figmagent; not tracked.

## What Worked Well

1. **Server-side payload generation for variables.** The orchestrator wrote a local `_build_payloads.ts`, generated `create_variables` payloads (hex→RGB, resolved semantic aliases) from the WPDS token source, and seeded **37 primitives + 16 semantics in 2 calls** plus **5 text + 4 elevation styles in 1 call** — no per-variable round-trips. Then deleted the scratch scripts (#78). Clean batch-first seeding.
2. **Atomic file-state reset between contestants via `run_script`.** Despite the missing page-CRUD tool (Issue 1), using one atomic `run_script` to restore the pristine seed (remove run page, restore widened scopes, recreate the next run page) kept every benchmark round starting from an identical fixture — sound benchmark hygiene and a legitimate use of the escape hatch.
3. **Sub-agent delegation kept orchestrator context lean.** The five `Agent` calls (1 fork seed-builder + 4 contestant runs) ran the high-volume canvas work out-of-context, so the orchestrator stayed at 168 calls across a 99-minute, two-round benchmark.
4. **Batched screenshot verification.** #74 verified 8 fixture nodes in a single `screenshot({ nodeIds: [...] })` — TOOL-017 working as intended (contrast with the broken single-node path, BUG-016).
5. **In-line diagnosis instead of retry storms.** The screenshot failure was diagnosed and turned into a tracked finding on first occurrence — exactly the fail-fast behavior the tracker rewards.

## Priority Improvements

### Tool Changes (ranked by call savings)

1. **Page CRUD on the first-class surface (TOOL-023)** — `write({type:"PAGE"})` / rename + `delete` on PAGE nodes / a file-reset helper. Removes ~6 `run_script` calls per harness session; eliminates the remote-only escape hatch for the most common document-level operations. P2.
2. **BUG-016 (remote `screenshot` `-32602`)** — already P1, now with a third+ independent recurrence (incl. the orchestrator's own verification path). The dominant self-verification gap vs. the official Figma MCP. Escalate.

### Agent Skill Updates

1. **No new agent guidance needed.** Recovery behavior was exemplary (in-line diagnosis, no retry storm, clean fallback to structural/other-node verification). The ToolSearch overhead was a tool-deferral artifact, not a behavior to correct.
