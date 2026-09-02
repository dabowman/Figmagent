---
name: analyze-session
description: "Analyze a Figma MCP test session transcript. Reads raw session data (JSON or HTML) and produces a structured analysis document with metrics, efficiency issues, error patterns, and prioritized improvements. Updates the cross-session improvement tracker. Use after completing a Figma session or when reviewing past sessions. Accepts an optional file path argument; if omitted, analyzes the most recent transcript."
---

# Analyze Session Transcript

Analyze a Figma MCP test session transcript and produce a structured efficiency/error audit. After large Figma sessions (50+ tool calls), run this skill to capture learnings and track improvement over time.

---

## Phase 1: Locate and Ingest Transcript

### Session manifest

A manifest at `.claude/analysis/sessions.json` tracks all sessions and their analysis status:

```json
{
  "sessions": {
    "<session-id>": {
      "sessionType": "figma" | "dev" | "empty",
      "skip": true,              // present on dev/empty sessions
      "toolCalls": 56,
      "figmaToolCalls": 48,
      "durationMinutes": 20,
      "sourceModified": 1710000000.00,  // mtime of source JSON
      "analysis": "figma-mcp-session4-analysis.md",  // only if analyzed
      "analyzedAt": 1710000000.00       // mtime of analysis file
    }
  }
}
```

Sessions with `sessionType: "figma"` are candidates for analysis. Sessions with `sessionType: "dev"` or `"empty"` are skipped.

A session is `figma` when it made at least one `mcp__Figmagent__*` call that **did something**: the
call did not come back `is_error`, and it was not a pure metadata call (`export_session`, which reads
the session's own log rather than the canvas). The mere presence of a Figmagent tool name is not
enough — a session whose only call threw never exercised the tools, and analyzing it seeds the tracker
with findings drawn from a session that never touched a canvas ([INFRA-005]).

Sub-agent transcripts (`--include-agents`, stored under `subAgents`) count for that test too, so a
session that delegated its canvas work to Builder/Styler agents is not demoted because the parent's
own few calls failed.

Sessions whose extracted JSON carries no usable message content (extracted before messages were
stored, or a `--raw` dump) are undecidable by that test and fall back to the old name-presence rule,
so an old real session is never demoted to `dev` and dropped from the queue. `--compact` is *not*
undecidable — it shortens tool-result text but keeps every block and its `is_error` flag.

### Picking the session to analyze

1. **First, ensure all sessions are extracted**: Run `bun extract-sessions --compact --no-thinking` to extract any new/updated sessions (mtime-based skipping is built in). For sessions from other projects, use `--file <path>` to point at an external JSONL file directly (e.g. `bun extract-sessions --file ~/.claude/projects/-Users-foo-Github-other-project/<session-id>.jsonl --compact --no-thinking --include-agents`).

2. **Then, refresh the manifest**: Run the manifest update script (see below) to discover new sessions and check for stale analyses.

3. **Pick the target session**:
   - If a file path argument was provided, use that specific session.
   - Otherwise, read `.claude/analysis/sessions.json` and find Figma sessions that need analysis:
     - `sessionType: "figma"` AND no `analysis` field → **new, needs analysis**
     - `sessionType: "figma"` AND `sourceModified > analyzedAt` → **updated, needs re-analysis**
   - Pick the oldest unanalyzed session first (analyze in chronological order).
   - If all Figma sessions are analyzed and up-to-date, report "All sessions analyzed" and stop.

4. **Analyze one session at a time** to keep context manageable. After completing one analysis, the user can run the skill again to analyze the next.

### Manifest update script

Refresh the manifest before analysis with:

```bash
bun run refresh-manifest          # rewrites .claude/analysis/sessions.json, prints the needs-analysis list
bun run refresh-manifest --count  # prints only the integer count (used by the nightly auto-improve loop)
```

This is [`scripts/refresh-manifest.ts`](../../../scripts/refresh-manifest.ts): it scans
`.claude/sessions-json/*.json`, classifies each session as `figma` / `dev` / `empty`,
preserves any existing `analysis`/`analyzedAt` mapping, and reports which figma sessions
still need analysis (no analysis, or source newer than the analysis file). The same script
backs Stage A of the [auto-improve pipeline](../../../scripts/launchd/README.md).

### After completing analysis

Update the manifest entry for the analyzed session:
- Set `analysis` to the filename (e.g. `figma-mcp-session10-analysis.md`)
- Set `analyzedAt` to the current time

This can be done by reading the manifest, updating the entry, and writing it back.

5. **If no extracted JSON exists yet**, run `bun extract-sessions --compact --no-thinking` to extract all sessions from the Claude Code session store. This produces structured JSON files in `.claude/sessions-json/`. Use `--file <path>` for sessions from other projects.

3. **Reading the JSON transcript** (produced by `scripts/extract-sessions.ts`):
   - Read the file. If >500 lines, read in 500-line chunks.
   - The format is an `ExtractedSession` object with this structure:

   ```json
   {
     "sessionId": "uuid",
     "extractedAt": "ISO-8601",
     "metadata": {
       "cwd": "/path/to/project",
       "branch": "branch-name",
       "version": "claude-code-version",
       "messageCount": 120,
       "toolCallCount": 89,
       "uniqueTools": ["create", "apply", "get", ...],
       "duration": { "start": "ISO-8601", "end": "ISO-8601", "minutes": 80 }
     },
     "messages": [
       {
         "role": "user" | "assistant" | "system",
         "timestamp": "ISO-8601",
         "content": [
           { "type": "text", "text": "..." },
           { "type": "tool_use", "id": "toolu_xxx", "name": "create", "input": { ... } },
           { "type": "tool_result", "tool_use_id": "toolu_xxx", "content": "...", "is_error": true }
         ],
         "model": "claude-opus-4-6",
         "usage": { "input_tokens": 1234, "output_tokens": 567 },
         "uuid": "msg-uuid",
         "parentUuid": "parent-msg-uuid"
       }
     ],
     "subAgents": {
       "agent-uuid": { /* same ExtractedSession structure */ }
     }
   }
   ```

   Key fields for analysis:
   - `metadata.toolCallCount` and `metadata.uniqueTools` — pre-computed totals
   - `metadata.duration.minutes` — session length
   - Content blocks with `type: "tool_use"` — tool calls (`.name` = tool name, `.input` = params)
   - Content blocks with `type: "tool_result"` — results (`.is_error` = true for failures, `.content` = error message or result)
   - `subAgents` — nested sub-agent sessions (same structure, analyze separately then merge)
   - `usage` on assistant messages — token consumption per turn

4. **Three-pass approach** (critical for large transcripts — 800+ events):
   - **Pass 1 (Extract)**: Read in chunks. For each message, scan content blocks. For each `tool_use` block, record: timestamp, tool name, input params (extract nodeId if present). For each `tool_result` block, record: tool_use_id, is_error, error message snippet. Output a compact one-line-per-tool-call summary. This reduces 300KB → ~15KB.
   - **Pass 2 (Analyze)**: Over the compact summary, compute all metrics and identify patterns.
   - **Pass 3 (Detail)**: For each flagged issue/error pattern, go back to the original transcript to extract specific context (full error messages, parameter values, cascading effects).

5. **For HTML transcripts** (fallback if no JSON available and `extract-sessions` cannot run):
   - Read page by page (each HTML file is one page).
   - Extract tool call blocks using pattern matching: look for tool names, parameters, results, and error messages.

---

## Phase 2: Compute Metrics

Calculate these standard metrics from the extracted events:

### Session Overview
- **Duration**: end time - start time
- **Total events**: count of all events
- **Total tool calls**: use `metadata.toolCallCount` or count `tool_use` content blocks
- **Total errors**: count `tool_result` blocks where `is_error: true`
- **Reconnections**: count `tool_use` blocks where `name` is `use_file` (`join_channel` in pre-rename sessions; subtract 1 for initial join)
- **Context overflows**: detect by looking for continuation summaries or session restart markers
- **Phases completed**: identify distinct work phases from the transcript

### Tool Call Distribution Table
For each unique tool name:
- Count total invocations
- Note patterns:
  - "no batch version" if >20 sequential calls to same tool
  - "N redundant re-inspections" if same node ID appears in multiple `read` (legacy `get`) calls
  - "N failed" if error count > 0

### Error Extraction
- Group errors by error message pattern (normalize variable parts like node IDs)
- Count cascading errors: when one error in a parallel batch causes all parallel calls to fail, count the root error separately from cascaded ones
- Identify root cause vs symptom errors

### Efficiency Signals — Detect These Patterns

1. **Sequential same-tool runs**: 5+ consecutive calls to the same tool → batch candidate. Record: tool name, run length, what a batch version would look like.

2. **Inspect-after-create**: `write` (legacy `create`/`clone_node`) immediately followed by `read` on the created node → indicates the create response should be richer. Count occurrences.

3. **Delete-recreate cycles**: `edit` delete ops (legacy `delete_node`/`delete_multiple_nodes`) followed by `write` for the same purpose → indicates missing modify capability or wrong initial approach.

4. **ToolSearch overhead**: total ToolSearch calls, percentage of all calls, failed searches (found wrong tools or 0 results).

5. **Redundant re-inspections**: same node ID appearing in multiple `get` calls → count unique nodes vs total `get` calls.

6. **Timeout cascades**: 3+ consecutive timeouts → connection loss not detected fast enough.

7. **Error retry storms**: same error repeated 3+ times → fail-fast rule violated.

---

## Phase 3: Cross-Session Comparison

1. Read the improvement tracker at `.claude/analysis/improvement-tracker.md`
2. Read the most recent previous analysis from `.claude/analysis/` (by filename number)
3. Compute deltas:
   - Waste percentage change
   - Error rate change
   - ToolSearch overhead change
   - New tools used that didn't exist in previous session
   - Recurring issues vs new issues
4. Check which previously-identified issues were addressed:
   - Tool exists now that was flagged as missing? → Mark as `implemented`
   - Error pattern from previous session not observed? → Mark as `verified`
   - Same issue still present? → Increment sessions affected count

---

## Phase 4: Generate Analysis Document

Write the analysis to `.claude/analysis/figma-mcp-session<N>-analysis.md` where N is auto-incremented based on existing files in the directory.

Use this exact template structure (matching the format of existing session 1 and session 2 analyses):

```markdown
# Figma MCP Session <N> Analysis

## Session Overview

- **Transcript**: `<filename>`
- **Duration**: <duration>
- **Total tool calls**: <count>
- **Total errors**: <count>
- **Reconnections**: <count>
- **Context restarts**: <count>
- **Task**: <brief description>

## Metrics

| Metric | Previous Session | This Session | Change |
|---|---|---|---|
| Total Figma tool calls | ... | ... | ... |
| Meta/overhead calls | ... | ... | ... |
| ToolSearch calls | ... | ... | ... |
| Estimated waste % | ... | ... | ... |

## Tool Call Distribution

| Tool | Calls | Notes |
|---|---|---|
| ... | ... | ... |

## Efficiency Issues

### 1. <Issue title> (saves ~N calls)

<Description of the pattern observed. Include specific numbers — how many consecutive calls, which nodes, what the agent was trying to do.>

**Pattern observed:** <concrete example from the transcript>

**Root cause:** <why this happened — missing tool, wrong default, agent behavior>

**Proposed fix:** <specific actionable recommendation>

**Estimated savings:** ~N calls → ~M calls.

### 2. ...

## Error Analysis

### 1. <Error category> (<N> failures, ~<M> minutes lost)

<Description. Include the exact error message. Trace cascading effects.>

**Agent recovery:** <how the agent responded — did it fail fast? retry too many times?>

**Fix needed:** <specific code or behavior change>

### 2. ...

## What Worked Well

1. **<Tool/pattern>.** <Why it was effective, with specific numbers.>
2. ...

## Priority Improvements

### Tool Changes (ranked by call savings)

1. **<tool name>** — <what it should do>. Saves ~N calls per session.
2. ...

### Agent Skill Updates

1. **<behavior change>** — <description>.
2. ...
```

---

## Phase 5: Update Improvement Tracker

Update `.claude/analysis/improvement-tracker.md`:

1. **Add new issues**: For each efficiency issue or error pattern identified in this analysis that doesn't already exist in the tracker:
   - **Insert the entry at the END of the `## Active Issues` section — immediately before `## Resolved Issues`.** Never append after `## Metrics Over Time` or `## Issue Categories`.
   - Assign an ID: `[CATEGORY-NNN]` where CATEGORY is TOOL, BUG, AGENT, or INFRA
   - **Auto-increment NNN past the highest existing number in that category across BOTH the Active and Resolved sections.** Grep `^### \[CATEGORY-` for the current max first — reusing a number collides two distinct findings onto one GitHub issue (the sync warns on this, but don't create it).
   - Set status to `identified`
   - Set priority based on estimated call savings: P0 (>50 calls), P1 (10-50 calls), P2 (<10 calls)
   - When an entry is *not* auto-fixable, name the current allowlist in the reason — never copy an older entry's three-pattern boilerplate; the allowlist is the seven patterns in Phase 6 below.
   - **Always add an explicit `- **Auto-fixable**: yes (<pattern>)` or `- **Auto-fixable**: no (<reason>)` line** — `yes` only when it matches a Phase 6 safe pattern, and name the pattern in the parentheses so Stage D can gate on it mechanically. Stage D (`/dispatch-fixes`) keys on this field — an entry missing it is never auto-fixed.
   - **Every `[ID]` you name in the analysis document must get a tracker entry.** The tracker — not the analysis doc — is what Stage C syncs to GitHub, so an ID that appears only in prose never becomes an issue. `sync-issues` warns on any such orphan (`⚠️ N finding ID(s) appear in analysis docs but have no `### [ID]` entry`); if you cite an ID, either add the entry or use the existing ID it duplicates.

2. **Update existing issues**: For each tracker entry:
   - If the issue was not observed in this session and the fix is confirmed working → advance to `verified`, move to Resolved Issues
   - If the issue recurred → add this session number to "Sessions affected"
   - If a tool was implemented that addresses the issue → advance to `implemented`

3. **Deduplication**: Match new findings against existing entries by:
   - Category match
   - Tool name match (if issue references a specific tool)
   - Key phrase match (substring: "batch", "async", "timeout", "coercion", etc.)
   - If match found → increment occurrence count, don't create duplicate

4. **Update Metrics Over Time table**: Add a row for this session.

5. **Update "Last updated" date and "Sessions analyzed" count**.

6. **Update the session manifest** (`.claude/analysis/sessions.json`): Set the `analysis` field to the analysis filename and `analyzedAt` to the current time for the session just analyzed. This marks it as complete so the next `/analyze-session` invocation skips it.

---

## Phase 6: Generate Fix Plans (if applicable)

For issues with `- **Auto-fixable**: yes (<pattern>)` in the tracker, generate implementation plans. Plans go to `.claude/plans/<date>-<issue-id>.md`. **After writing a plan file, set that entry's `Status` to `planned`.** Stage D (`/dispatch-fixes`) gates on the plan file's existence plus a non-resolved status, so a written-but-not-marked plan would never be dispatched — keep these in lockstep.

### Safe Fix Patterns (allowlist)

Only generate plans for these well-understood patterns. Each names its dispatch gate — the priority floor and the verification `/dispatch-fixes` requires — because the low-risk patterns dispatch at P2 while code-touching ones stay P0/P1 (INFRA-006).

#### `sync-to-async`
- **Trigger**: Error message contains "Cannot call with documentAccess: dynamic-page" or "Use node.setXxxAsync instead"
- **Fix**: Find the sync call in plugin source, replace with async equivalent
- **Plan content**: Exact file path, line number, old code → new code
- **Example**: `node.textStyleId = id` → `await node.setTextStyleIdAsync(id)`
- **Gate**: lint + test + build. P0/P1.

#### `type-coercion`
- **Trigger**: Error message contains "expected number, received string" or similar type mismatch
- **Fix**: Add `toNumber()` coercion in the plugin handler (helper already exists in `src/figma_plugin/src/helpers.js`) or add `.or(z.string().transform(Number))` to the Zod schema in the MCP tool handler
- **Plan content**: File path, parameter name, Zod schema change or `toNumber()` wrapping
- **Gate**: lint + test + build. P0/P1.

#### `missing-batch-tool`
- **Trigger**: Single-item tool called 20+ times consecutively
- **Fix**: Create batch variant following existing patterns (multi-node `edit` ops, `set_multiple_annotations`)
- **Plan content**: Tool specification (name, parameters, behavior) for use with `/add-mcp-tool` skill. Include the proposed JSON input format based on observed usage patterns.
- **Gate**: never auto-dispatched — new tools need human design. The plan is for a person.

#### `description-only`
- **Trigger**: The finding is a wrong, missing, or misleading tool description, `fail()` fix string, server-instruction line, or skill/CLAUDE.md paragraph — the code path itself is correct (e.g. a description that omits a field the implementation already accepts, a fix string naming the wrong cause).
- **Fix**: Edit the text in place. No control-flow change anywhere.
- **Plan content**: File, the exact current sentence(s), the exact replacement. If the text is in a skill or CLAUDE.md, the section header it lives under.
- **Gate**: lint + test (+ `build:plugin` when it touched `src/figma_plugin/`) — the suite asserts on descriptions and `fail()` strings. No *named* test required. P0–P2.

#### `lint-scope-filter`
- **Trigger**: `lint` reports something that cannot be resolved by binding a variable — an invisible paint, a COMPONENT_SET wrapper's own layout, a Figma default the agent did not set.
- **Fix**: One skip predicate in `src/figma_plugin/src/commands/lint.js` (`checkColorProperty`, `checkScalarProperty`, or the property loop) plus one line in the `lint` tool description saying what is not reported.
- **Plan content**: The predicate and where it goes; a test in `tests/minilint.test.ts` with a positive control (the same node visible/bound/not-a-set is still reported).
- **Gate**: lint + test + build; the named test passes. P0–P2 (the predicate is a pure skip, and the positive control pins that nothing else stopped being reported).

#### `boundary-guard`
- **Tie-break vs `description-only`**: if a `fail()` call already exists and only its *strings* change, it is `description-only`. `boundary-guard` is for **adding** a guard where a raw throw escaped.
- **Trigger**: A handler or stdlib helper throws a raw `TypeError` / verbatim Figma error with no stated fix on invalid input — a null node, wrong node type, absent field, page mismatch.
- **Fix**: `fail(message, fix)` at the entry point (`src/figma_plugin/src/helpers.js` `fail`). Valid input takes exactly the same path as before; the guard only replaces the raw throw.
- **Plan content**: The guard, its position, the exact fix string; a test asserting the message contains `Fix:` and that the valid-input path is unchanged.
- **Gate**: lint + test + build; the named test passes. P0/P1 only.

#### `assertion`
- **Trigger**: A write reported success but left a state the agent only discovers by re-reading — width 0 on a missing font, a variable bound onto an invisible paint, an opacity resolving at 1/100.
- **Fix**: A new warning category in `src/figma_plugin/src/assertions.js`, hooked into `checkNodes` or `runPostWriteAssertions`. Advisory only — it never blocks or alters the write.
- **Plan content**: The check name, the predicate, the message + fix string, the hook point; a test on the pure checker function.
- **Gate**: lint + test + build; the named test passes. P0/P1 only.

**Mixed findings are not auto-fixable.** If the remedy for an entry is partly an allowlisted pattern and partly design work (a new field, a behaviour change), mark it `no (mixed: <what>)` — `dispatch-fix.ts publish` always writes `Closes #N`, so a partial plan would close an issue whose real fix is still open. If the plan is a genuinely useful *half* of an issue that a person should land, keep the entry `yes (<pattern>)` but add a `**Partial**: yes — <what is not covered>` line to the plan header; `/dispatch-fixes` skips those for the same `Closes #N` reason.

### Plan Format

```markdown
# Fix: [ISSUE-ID] <title>

**Pattern**: <sync-to-async | type-coercion | missing-batch-tool | description-only | lint-scope-filter | boundary-guard | assertion>
**Priority**: <P0 | P1 | P2>
**Estimated savings**: <N calls/session>

## Changes

### File: `<path>`
- Line N: `<old code>` → `<new code>`

## Verification
- [ ] Run `bun run lint`
- [ ] Run `bun run test` — names the test file/case that fails without this change (required for every pattern except `description-only`)
- [ ] Run `bun run build:plugin`
- [ ] Test in a Figma session
```

The `**Pattern**` field must **start** with one allowlist token; a trailing qualifier in
parentheses is fine (`` `type-coercion` (at the Zod boundary)``), a second pattern is not —
Stage D reads only the first token, so `` `assertion` (plus `description-only`)`` gates as
`assertion` and its docs half inherits the `assertion` gate. Same rule for the tracker's
`Auto-fixable: yes (…)`. A plan that genuinely needs two gates is two plans, or `no (mixed: …)`.

**Important**: The skill NEVER applies code changes directly. It only generates plan files and marks issues as `planned` in the tracker. The user reviews and triggers implementation.

---

## Notes

- If the transcript is too large to fit in context even with the 3-pass approach, focus on the tool call distribution and error extraction (Phases 2a-2b) and skip detailed efficiency pattern analysis for the middle sections.
- Always validate numbers: total tool calls should equal sum of distribution table. Error count should match error analysis section.
- When comparing sessions, normalize for scope differences (session 2 had 26% more tool calls because the task was larger, not because it was less efficient).
- The analysis document is committed to git — it serves as a permanent record of the session and its learnings.
