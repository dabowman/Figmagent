# Figma MCP Session 14 Analysis

## Session Overview

- **Transcript**: `35e6a1f3-5480-4788-a436-5ec860d21a9c.json`
- **Duration**: ~14 minutes
- **Total tool calls**: 17
- **Total errors**: 2 (1 missing file + 1 cascade cancellation)
- **Reconnections**: 0
- **Context restarts**: 0
- **Task**: Planning session — discover DataViews component structure, evaluate slot property opportunities, design 4 new MCP tools for component properties, and write implementation plan

## Metrics

| Metric | Session 10 | Session 14 | Change |
|---|---|---|---|
| Total tool calls | 23 | 17 | -26% (planning session, fewer Figma calls) |
| Figma MCP calls | 18 | 2 | -89% (planning, not building) |
| ToolSearch calls | 5 (21.7%) | 0 (0%) | Eliminated (no ToolSearch needed) |
| Agent subagent calls | 0 | 4 (23.5%) | New pattern — heavy subagent delegation |
| Read calls | 0 | 6 (35.3%) | Codebase research for plan |
| Errors | 2 (8.7%) | 2 (11.8%) | Similar |
| Estimated waste % | ~30% | ~18% | Improved |

## Tool Call Distribution

| Tool | Calls | Notes |
|---|---|---|
| `Read` | 6 | 35.3%. 5 codebase files + 1 missing file (error). Sequential reads — could batch. |
| `Agent` | 4 | 23.5%. 1 Explore, 2 figma-discovery (1 cancelled + 1 retry), 1 Plan. |
| `mcp__Figmagent__join_channel` | 1 | Channel join succeeded first try. |
| `mcp__Figmagent__get_selection` | 1 | Confirmed DataViews component set selected. |
| `Glob` | 1 | Searched for archived dataviews plans (none found). |
| `Write` | 1 | Wrote plan file. |
| `AskUserQuestion` | 1 | Scope selection — user chose "Full plan (all phases)". |
| `ExitPlanMode` | 1 | Finalized plan with allowed bash prompts. |

**Totals**: 2 Figma MCP + 4 Agent + 6 Read + 5 other = 17. Errors: 2.

## Efficiency Issues

### 1. Parallel tool cancellation cascade (cost: ~3 minutes, 2 calls)

Calls #4 (figma-discovery Agent) and #5-6 (Read) were launched in parallel. Read #6 targeted a non-existent file (`dataviews-figma-plan.md`), which errored and **cancelled the parallel Agent call** (#4). The discovery agent had to be relaunched as call #7, costing ~3 minutes of wall-clock time.

**Pattern observed:** `Agent(figma-discovery)` + `Read(components-and-variants.md)` + `Read(dataviews-figma-plan.md)` fired in parallel. The missing file caused Claude Code to cancel the entire parallel batch including the already-running discovery agent.

**Root cause:** The agent assumed the archived plan file existed at a specific path without checking first. The parallel execution model cancels sibling calls when one errors.

**Proposed fix:** [NEW: AGENT-009] **Guard file existence before parallel launch.** When mixing long-running Agent calls with Read calls in parallel, ensure Read targets are verified (via Glob) before launching. Alternatively, never mix Agent calls with speculative Reads — the Agent is too expensive to cancel.

**Estimated savings:** 2 calls + ~3 minutes. The retry (#7) was identical to #4.

### 2. Sequential Read calls for codebase research (saves ~2 calls)

Calls #10-14 read 5 files sequentially: `components.js`, `main.js`, `components.ts`, `types.ts`, `SKILL.md`. These are independent reads that could have been batched into 2-3 parallel groups.

**Root cause:** Each Read result informed which file to read next (reasonable sequential reasoning), but at least `types.ts` + `SKILL.md` could have been read in parallel with the earlier files.

**Estimated savings:** ~1-2 calls of wall-clock time via batching, but no call count reduction (reads are cheap).

### 3. Explore subagent before Discovery subagent (saves ~1 call)

Call #2 (Explore Agent) searched the codebase for slot property support — information the orchestrator could have gathered from CLAUDE.md/MEMORY.md context (which explicitly documents "no component property tools exist"). The discovery agent (#7) then separately mapped the Figma component structure.

**Root cause:** The orchestrator wanted to verify the tool gap before planning. Reasonable caution, but the answer was already in the loaded context.

**Estimated savings:** ~1 Agent call (~75 seconds). The Explore agent's findings were entirely confirmatory.

## Error Analysis

### 1. Missing file read (1 failure + 1 cascade cancellation)

Read #6 targeted `.claude/projects/.../memory/dataviews-figma-plan.md` which had been previously archived or deleted. This cascaded to cancel the parallel figma-discovery Agent (#4).

**Agent recovery:** Good — immediately retried the discovery agent (#7) and used Glob (#8) to search for the archived plan. Continued cleanly after both returned.

**Fix needed:** [AGENT-009] as described above. Also: the memory file `MEMORY.md` references `[dataviews-figma-plan.md](./dataviews-figma-plan.md)` as a link — if the file was moved/deleted, the memory reference should be updated to avoid this.

## What Worked Well

1. **Zero ToolSearch overhead.** No `ToolSearch` calls at all — the session used only `join_channel` and `get_selection` from the MCP, both of which were already known. This is the first session with 0% ToolSearch.

2. **Effective subagent delegation.** The figma-discovery agent returned a 17K-character structural map that would have taken 5-6 direct tool calls. The Plan agent explored the codebase and drafted an implementation plan autonomously. Together, 2 successful Agent calls replaced ~10+ manual tool calls.

3. **Clean channel join.** Single file open, auto-join worked on first try. No disambiguation needed (unlike session 10's 4-call overhead).

4. **Good plan output.** The final plan covered 4 tools, 4 DataViews phases, risk matrix, and verification checklist — written in 1 Write call. The AskUserQuestion tool provided good scope options before committing.

5. **Minimal Figma MCP usage.** Only 2 MCP calls (join_channel + get_selection) for a planning session. All heavy lifting done via Agent subagents and codebase reads.

## New Tracked Issues

### [AGENT-009] Parallel cancellation cascade

**Description:** When Agent calls (long-running, expensive) run in parallel with Read/Glob calls (fast, may fail), a Read error cancels the Agent via Claude Code's parallel batch semantics. This wastes the Agent's work-in-progress.

**Impact:** ~3 minutes + 2 wasted calls per occurrence.

**Fix:** Never mix long-running Agent calls with speculative file Reads in the same parallel batch. Run the Reads first, then launch the Agent. Alternatively, use Glob to verify file existence before reading.

## Priority Improvements

### Agent Behavior

1. **[AGENT-009] Isolate Agent calls from speculative Reads** — Agent calls should never share a parallel batch with Reads that might fail. Run file existence checks first. Saves ~3 min per occurrence.

2. **Skip confirmatory Explore agents** — When context (CLAUDE.md, MEMORY.md) already documents a capability gap, don't spawn an Explore agent to re-verify. Saves ~75 seconds.

3. **Update stale memory references** — `dataviews-figma-plan.md` link in MEMORY.md should be removed or updated if the file was archived/deleted. Prevents future Read errors.
