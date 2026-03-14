# Figma MCP Session 3 Analysis

## Session Overview

- **Transcript**: `7af896e5-3a35-47ed-9fcb-829af79e3fff`
- **Duration**: ~28 minutes active across 3 phases (914 min wall clock with long idle gaps)
- **Total tool calls**: 160
- **Total errors**: 10
- **Reconnections**: 0
- **Context restarts**: 0
- **Task**: Build session analysis automation — create `analyze-session` skill, `improvement-tracker.md`, and fix `extract-sessions.ts` for portability

## Session Type

**This is a development/meta session, not a Figma design session.** Zero Figma MCP tools were used. All 160 tool calls are Claude Code built-in tools (Read, Bash, Edit, etc.). The session built the infrastructure for analyzing future Figma sessions — creating skills, writing tracker docs, and fixing the transcript extraction script.

## Metrics

| Metric | Session 2 | Session 3 | Change |
|---|---|---|---|
| Total tool calls | 389 | 160 | -59% (different task type) |
| Figma MCP calls | 325 | 0 | N/A (dev session) |
| Meta/overhead calls | 64 | 160 | N/A (all meta) |
| ToolSearch calls | 28 (7.2%) | 0 (0%) | N/A (no MCP) |
| Errors | 14 (3.6%) | 10 (6.25%) | Higher error rate |

## Tool Call Distribution

| Tool | Calls | Notes |
|---|---|---|
| Read | 60 | 37.5%. Multiple files read 2-3x across phases. 5 sequential runs of 5+ calls. |
| Bash | 53 | 33.1%. File system exploration (ls, find, du) + git ops + bun commands. |
| Glob | 16 | 10%. File discovery. |
| Edit | 10 | 6.25%. Skill files + extract-sessions.ts fixes. |
| Grep | 5 | 3.1%. Searching for transcript references. |
| TodoWrite | 5 | 3.1%. Task tracking. |
| Agent | 4 | 2 explore subagents + 1 plan subagent + 1 resume. |
| Write | 4 | 2.5%. Creating new files (skill, tracker). |
| AskUserQuestion | 1 | Transcript format question. |
| ExitPlanMode | 1 | — |
| Skill | 1 | Invoking analyze-session to test it. |

## Efficiency Issues

### 1. Redundant file reads across phases (saves ~20 calls)

The same files were read multiple times because of long idle gaps (4h, 11h) between phases, and because Agent subagents re-read files the parent session had already read.

**Files read redundantly:**
- `figma-mcp-session-analysis.md` — read 3x (msg 27, 103, 131, 182, 261)
- `figma-mcp-session2-analysis.md` — read 3x (msg 45, 104, 133, 184, 263)
- `add-mcp-tool/SKILL.md` — read 3x (msg 49, 68, 153, 193, 241)
- `figma-sub-agents/SKILL.md` — read 3x (msg 47, 74, 155, 198, 285, 291)
- `figma-guidelines/SKILL.md` — read 3x (msg 50, 67, 196, 287, 293)
- `task-completion-checks.sh` — read 3x (msg 33, 76, 105, 134, 202)

**Root cause:** Long idle gaps between phases cause context loss. Agent subagents don't share context with parent. No caching mechanism for recently-read files.

**Proposed fix:** This is inherent to the multi-phase session structure with long gaps. Not actionable as a tool change — the reads are necessary after context loss. However, the Agent subagent duplication could be reduced by providing more context in the agent prompt.

**Estimated savings:** ~15-20 calls if subagent duplication is reduced.

### 2. Sequential Read runs without parallelization (saves ~5 calls of latency)

5 runs of 5-10 consecutive Read calls where several could have been parallelized (e.g., reading multiple SKILL.md files simultaneously). The agent did parallelize some reads but not consistently.

**Pattern observed:** msgs 38-42: Read tests/connection.test.ts, tests/protocol.test.ts, tests/utils.test.ts sequentially. msgs 67-71: Read 4 skill files sequentially.

**Root cause:** Agent behavior — not maximizing parallel tool calls.

**Proposed fix:** Agent-level improvement. Not critical for a dev session.

**Estimated savings:** ~5 calls worth of latency (not call count).

### 3. Case-sensitive file path guessing (3 errors)

Agent tried `skill.md` (lowercase) instead of `SKILL.md` (uppercase) for 3 different skill files at msgs 138-143. This is a Plan subagent that hadn't seen the actual filenames.

**Pattern observed:** Plan subagent guessed `figma-guidelines/skill.md` → got "File does not exist" → then tried `SKILL.md` → succeeded.

**Root cause:** Subagent launched without sufficient context about file naming conventions.

**Proposed fix:** Include "Skill files use `SKILL.md` (uppercase)" in agent prompts, or use Glob first.

**Estimated savings:** ~3 calls.

### 4. Iterative extract-sessions.ts bug fixing (3 cycles)

Fixing the hardcoded session directory path required 3 edit-run-fail cycles:
1. Edit: replace hardcoded path with auto-detection → Run → ENOENT (double dash in path)
2. Edit: fix double dash → Run → Still ENOENT (wrong encoding)
3. Edit: simplify encoding → Run → Success

**Root cause:** The path encoding convention (`/home/user/Figmagent` → `-home-user-Figmagent`) wasn't verified before the first edit. A simple `ls ~/.claude/projects/` would have revealed the expected format.

**Proposed fix:** Agent behavior — always verify the target format before writing transformation code. Read-before-write principle applies to understanding conventions too.

**Estimated savings:** ~4 calls (2 failed edits + 2 failed runs).

## Error Analysis

### 1. Wrong-case file paths (3 failures, <1 minute lost)

Agent subagent guessed lowercase `skill.md` for files named `SKILL.md`. Recovered quickly by trying uppercase.

**Agent recovery:** Fast — immediately tried the correct case after each failure.

**Fix needed:** Better context in agent prompts about naming conventions.

### 2. extract-sessions.ts path encoding (2 failures, ~2 minutes lost)

Two failed attempts to fix the hardcoded macOS session path for the current environment. First attempt produced double-dash, second was also wrong.

**Agent recovery:** Good — each failure was followed by checking the actual directory listing to understand the expected format.

**Fix needed:** Already fixed in this session. The script now auto-detects the path.

### 3. Miscellaneous filesystem errors (5 failures, <1 minute lost)

- Reading `.claude` as a file (it's a directory)
- `ls` on non-existent `sessions-json/` directory
- `cat` on non-existent `settings.json`
- Cancelled parallel call (cascaded from adjacent error)
- `ExitPlanMode` called outside plan mode

**Agent recovery:** All recovered immediately.

**Fix needed:** None — these are normal exploration probes.

## What Worked Well

1. **Agent subagents for parallel exploration.** Two explore agents launched simultaneously at session start covered project structure and test infrastructure in parallel. Good use of the Agent tool.

2. **Plan mode for complex design work.** The session used Plan mode with ExitPlanMode to design the analysis automation system before building it. The plan was approved and then executed cleanly in Phase 2.

3. **Clean Phase 2 execution.** After the 4-hour gap, Phase 2 (building the actual skill and tracker) was efficient — 24 tool calls to create the improvement-tracker.md, analyze-session/SKILL.md, and cross-reference other skills. No errors.

4. **Iterative debugging in Phase 3.** The extract-sessions.ts fixes, while requiring 3 cycles, were methodical: edit → test → check actual state → fix. The agent checked `ls ~/.claude/projects/` after the first failure to understand the expected format.

5. **Write tool for new files.** Used Write (not Bash echo) to create new files — clean and reviewable.

## Priority Improvements

### Tool Changes (ranked by impact)

1. **extract-sessions.ts portability** — Fixed in this session. Auto-detects session directory from CWD. Saves future sessions from hitting the same hardcoded path issue.

2. **analyze-session skill** — Created in this session. Provides structured analysis workflow for future Figma sessions.

3. **improvement-tracker.md** — Created in this session. Cross-session tracking of issues and resolutions.

### Agent Skill Updates

1. **Include file naming conventions in agent prompts** — Skill files use `SKILL.md` (uppercase), not `skill.md`. Would have prevented 3 errors.

2. **Verify target format before writing transformations** — Check the actual directory listing before writing path encoding logic. Would have saved 2 edit-test cycles.

3. **Provide more context to subagents** — Share key findings (like file paths and conventions) in agent prompts to reduce redundant reads.
