# Figma MCP Session 8 Analysis

## Session Overview

- **Transcript**: `a5844e2b-4853-4864-b50f-fe05e4e29312.json`
- **Duration**: ~4 hours active across multiple phases (2887 min wall clock with overnight idle)
- **Total tool calls**: 153
- **Total errors**: 9 (4 cascaded cancellations, 5 root causes)
- **Reconnections**: 0
- **Context restarts**: 0
- **Task**: Meta/tooling session — analyze 4 Figma sessions (sessions 4-7), create GitHub issues for all findings, implement fixes for 3 issues (#3, #9, #11), and create PRs for 4 more (#4, #5, #6, #7)

## Session Type

**This is a development/meta session, not a Figma design session.** Zero Figma MCP tools were used. All 153 tool calls are Claude Code built-in tools (Bash, Read, Edit, Grep, Write, Agent). The session performed session analysis, GitHub issue management, and code fixes to MCP tool descriptions and plugin source.

## Metrics

| Metric | Session 7 | Session 8 | Change |
|---|---|---|---|
| Total tool calls | 24 | 153 | +538% (different task type) |
| Figma MCP calls | 22 | 0 | N/A (dev session) |
| ToolSearch calls | 2 (8.3%) | 0 (0%) | N/A (no MCP) |
| Errors | 2 (8.3%) | 9 (5.9%) | Improved rate, but more absolute |
| Estimated waste % | ~25% | ~10% | Improved |

## Tool Call Distribution

| Tool | Calls | Notes |
|---|---|---|
| Bash | 72 | 47.1%. Git ops, gh CLI, bun commands, python3 extraction scripts. |
| Read | 28 | 18.3%. Transcript chunks, tool source files, tracker. 10 consecutive in analysis phase. |
| Edit | 19 | 12.4%. Tool descriptions, CLAUDE.md, tracker updates. 7 consecutive for tracker issue refs. |
| Grep | 18 | 11.8%. Finding tool registrations, FIELD_MAP, descriptions. |
| Agent | 9 | 5.9%. 3 analysis agents + 4 fix agents (worktree). Analysis agents succeeded; worktree agents couldn't use Bash. |
| Write | 7 | 4.6%. Analysis files, tracker rewrites. |

## Efficiency Issues

### 1. Worktree agents blocked by Bash permissions (saves ~4 agent launches)

4 agents launched in worktrees to fix issues #8-11 in parallel. All 4 failed because worktree agents couldn't use Bash (needed for git branch/commit/push/gh pr create). The parent had to redo all 4 fixes sequentially.

**Pattern observed:** `Agent(isolation: worktree)` × 4 → all returned "Bash tool denied" → parent redid manually.

**Root cause:** Worktree agents inherit sandbox restrictions that block Bash. The agent description doesn't mention this limitation.

**Proposed fix:** Agent behavior — don't use worktree isolation for tasks that require git operations. Use regular agents or do the work directly.

**Estimated savings:** ~4 agent launches + ~3 minutes wait time.

### 2. Analysis agents blocked by Write permissions (saves ~3 agent resumes)

3 analysis agents completed their work but couldn't write output files. Each had to be resumed (unsuccessfully — still blocked), then the parent wrote the files manually.

**Pattern observed:** `Agent(run_in_background)` × 3 → completed analysis → Write denied → resume → still denied → parent writes.

**Root cause:** Background agents can't write files in this sandbox configuration. The agent correctly resumed them but they still couldn't write.

**Estimated savings:** ~3 resume attempts saved if parent writes directly after getting agent results.

### 3. Issues already resolved discovered during implementation (saves ~2 branches)

Issues #8 and #10 were created from session analysis but turned out to already be resolved when the agent went to implement them. #8's legacy tools had already been removed; #10's cross-reference already existed.

**Pattern observed:** Created issue → created branch → searched for code to change → found it was already done → closed issue.

**Root cause:** Analysis was based on session 5/6 transcripts which predated the fixes. The analysis skill doesn't check current code state before creating issues.

**Proposed fix:** Before creating issues from analysis findings, verify the issue still exists in the current codebase.

**Estimated savings:** ~2 branches and issue creation/closure cycles.

## Error Analysis

### 1. Cascaded parallel cancellations (4 failures, ~5 seconds lost)

When one `gh issue create` failed (issues disabled, wrong label), the parallel sibling calls were cancelled. This happened twice — once for issues-disabled, once for missing label.

**Agent recovery:** Good — retried with corrected parameters immediately.

**Fix needed:** None — cascading is inherent to parallel tool calls. The agent adapted correctly.

### 2. GitHub issues disabled on repo (1 failure, ~10 seconds lost)

First `gh issue create` attempt failed because issues weren't enabled on `dabowman/Figmagent`. Agent asked the user, enabled issues, then proceeded.

**Agent recovery:** Excellent — asked user for direction, got confirmation, enabled issues.

### 3. Missing GitHub label (1 failure, ~5 seconds lost)

Used `--label "agent-behavior"` which doesn't exist. Retried without the custom label.

**Agent recovery:** Fast — immediately dropped the label.

### 4. Gitignored file in git add (1 failure, ~5 seconds lost)

Tried to `git add src/figma_plugin/code.js` which is gitignored. Removed it from the add command.

**Agent recovery:** Immediate.

### 5. Edit before Read (1 failure, ~5 seconds lost)

Attempted to edit `apply.ts` without reading it first. Read it, then succeeded.

**Agent recovery:** Immediate.

## What Worked Well

1. **Python extraction scripts for transcript analysis.** Used `python3 -c` one-liners to extract compact summaries from 200KB+ JSON transcripts — reduced to tool distribution, errors, sequential runs in one pass. Much more efficient than reading JSON line by line.

2. **Parallel analysis agents.** 3 agents analyzed sessions 5, 6, 7 simultaneously. Despite write permission issues, all 3 completed their analysis, and the parent wrote the files from their summaries.

3. **Systematic issue-to-PR pipeline.** Went from analysis → tracker update → GitHub issues → branches → code fixes → PRs in a clean pipeline. 7 PRs total across the session.

4. **Quick error recovery.** All 5 root-cause errors recovered in exactly 1 attempt. No retry storms.

5. **Efficient code changes.** Issues #9, #11, and the lint_design fix (#3) were all 1-2 line description changes — correctly scoped with no over-engineering.

6. **Cross-session tracker consolidation.** Updated the improvement tracker with findings from 3 new sessions, added GitHub issue cross-references, and moved verified issues to resolved — all in one coherent update.

## Priority Improvements

### Tool Changes

None needed — this was a dev session. All improvements are agent-behavioral.

### Agent Skill Updates

1. **Don't use worktree isolation for git-dependent tasks** — Worktree agents can't use Bash. Do git operations directly or use regular agents.

2. **Write analysis files directly instead of resuming blocked agents** — When background agents can't write, use their returned summary and write from the parent immediately.

3. **Verify issues still exist before creating GitHub issues from analysis** — Check current code state before reporting issues found in older session transcripts.
