# Figma MCP Session 36 Analysis

## Session Overview

- **Transcript**: `dca6c80c-0cac-4235-8026-78399e789d46.json`
- **Duration**: 134 minutes
- **Total tool calls**: 149 (14 Figmagent, 1 official-figma, ~134 dev/Bash/Edit/Read)
- **Total errors**: 8 (only 2 are Figmagent-side; the rest are dev-side / harness)
- **Reconnections**: 0
- **Context restarts**: 0
- **Task**: **Design-to-code** on external repo `vip-workflows` (branch `remove-app-shell`) — port a Figma design's typography, breadcrumb, and `AdminPage` component into the WordPress plugin's React/CSS source. Figmagent was used **read-only** as a design reference; the bulk of the session was code editing. **Remote transport.**

## Metrics

| Metric | Previous Session (35) | This Session (36) | Change |
|---|---|---|---|
| Total tool calls | 134 | 149 | +15 |
| Figmagent calls | ~50 | 14 | mostly dev session |
| Meta/overhead (use_file) | — | 1 | — |
| ToolSearch calls | 7 (5.2%) | 2 (1.3%) | down |
| Estimated waste % (whole session) | ~25% | ~8% | down |
| Estimated waste % (Figma-only) | ~25% | ~40% (6/14 Figma calls) | — |

Figmagent call breakdown: 8 `read`, 3 `screenshot`, 2 `get_design_system`, 1 `use_file`.

## Tool Call Distribution

| Tool | Calls | Notes |
|---|---|---|
| Bash | ~45 | codebase greps, lint, build, git — design-to-code work |
| Edit | ~40 | React/CSS edits implementing the design |
| Read | ~20 | source files |
| mcp__Figmagent__read | 8 | 2 re-inspections of `2064:24184` (full→structure→layout) |
| mcp__Figmagent__screenshot | 3 | visual reference of design nodes |
| mcp__Figmagent__get_design_system | 2 | **both returned empty** (library-bound file on remote) |
| mcp__Figmagent__use_file | 1 | called *after* 2 failed reads |
| ToolSearch | 2 | external repo → Figmagent + official-figma tools deferred |
| Agent | 2 | Explore subagents (breadcrumb, AdminPage usages) |
| AskUserQuestion | 2 | scope clarification |
| mcp__plugin_figma_figma__get_design_context | 1 | tried first, **user-rejected** (steered to Figmagent) |

## Efficiency Issues

### 1. `read`/`screenshot` issued before `use_file` on remote (wastes ~2 calls)

On the remote transport there is no auto-join, so the first command must be `use_file`. The agent instead called `read(2065:758)` (#5) and `screenshot(2065:758)` (#6) first — both failed with `"No Figma file selected. Pass a file URL to use_file…"` — then called `use_file` with the node's figma.com URL (#7) and the same `read`/`screenshot` succeeded (#8, #9).

**Pattern observed:** `read [ERR no-file]` → `screenshot [ERR no-file]` → `use_file(url)` → `read ✓` → `screenshot ✓`.

**Root cause:** Recurrence of the remote-first onboarding friction already tracked in **[BUG-014]** (companion skill doc [#65]). The agent had the figma.com URL the whole time (it used it as `use_file`'s `channel`) — it could have led with `use_file`.

**Proposed fix:** No new fix; reinforces [BUG-014]'s proposed CLAUDE.md/skill guidance ("call `use_file` before the first `read` on remote"). Add session 36 to affected.

**Estimated savings:** ~2 calls.

### 2. `get_design_system` returns empty on a library-bound file (recurrence of [TOOL-020])

Both `get_design_system` calls returned completely empty payloads (`{"styles":{...all empty},"variables":[],"collections":[]}`):
- #10 `namePattern: "^(Body|wpds-typography|wpds-font)", includeVariables: true` → empty
- #15 `collection: "Typography", includeStyles: true, styleType: "texts"` → empty

The file binds **library (imported)** typography styles/variables, none of which surface as *local* via `get_design_system` on remote — the same root gap as **[TOOL-020]** (no way to read a variable's resolved numeric value on remote) and **[AGENT-020]** (lint only sees local variables).

**Agent recovery (good):** Rather than the probe-frame harvesting seen in session 35, the agent — because this was a **design-to-code** task — pivoted to `Bash grep` over the plugin's own CSS/theme-package token files (#16–21, #30) to recover the `wpds-font` size/line-height numerics. In a design-to-code context the codebase token pipeline is the correct, cheaper source.

**Root cause:** `get_design_system` (and FSGN `read`, which omits `fontSize`/`lineHeight` numerics) cannot resolve imported library-token values on remote — [TOOL-020].

**Proposed fix:** Covered by [TOOL-020]'s proposed fix (resolve imported library-variable values; include typography numerics in FSGN). Add a sub-finding: in design-to-code sessions the agent should reach for the **codebase token pipeline output** immediately when `get_design_system` returns empty (it did, efficiently). Add session 36 to [TOOL-020] affected.

**Estimated savings:** ~2 wasted `get_design_system` calls avoidable if the empty result steered the agent to the codebase up front.

### 3. Re-inspection of one node at three detail levels (minor, ~2 calls)

Node `2064:24184` was read at `detail: full, depth: 4` (#26), then `structure, depth: 2` (#28), then `layout, depth: 1` (#32). This is the reverse of the "structure first, then increase detail" guidance ([TOOL-004]) — the agent fetched the most expensive view first, then dropped down to isolate specific values. For read-only reference this is mild; the full read likely already contained the needed data.

**Root cause:** Agent behavior — over-fetched then re-queried for specific fields.

**Proposed fix:** None new; reinforces [TOOL-004]/[AGENT-017]. Not worth a new tracker entry.

## Error Analysis

### 1. Two `No Figma file selected` errors (onboarding, ~0 min lost)

`read` (#5) and `screenshot` (#6) before `use_file`. Recovery was immediate and correct (1 `use_file` call). Both returned a clean, fix-stating message. See Efficiency Issue 1 / [BUG-014].

**Agent recovery:** Excellent — read the fix in the error and called `use_file` with the URL on the next call.

### 2. One harness/model error on `read` (#31)

`read(2064:24184, layout, depth 1)` failed with `"claude-opus-4-8[1m] is temporarily unavailable, so auto mode cannot determine the safety of this tool call"` — a **harness permission-mode** error, not a Figmagent bug. Retried once (#32) and succeeded.

**Agent recovery:** 1 retry, fine.

### Non-Figma errors (dev-side, not tracked)

`#3` official-figma `get_design_context` user-rejected (the user steered to Figmagent); `#33`/`#139` Edit string/file-not-read; `#103`/`#129` stylelint/grep non-zero exits. All recovered in 1 step. Out of scope for the Figmagent tracker.

## What Worked Well

1. **Design-to-code fallback to codebase tokens.** When `get_design_system` returned empty (library-bound file), the agent immediately grepped the plugin's own CSS/`@wordpress/theme` token output for the `wpds-font` numerics instead of fighting the Figma API — exactly the right move per the "read pipeline output" guidance ([AGENT-012]). This is the cheap path TOOL-020 should steer toward in design-to-code contexts.
2. **Fast onboarding recovery.** Two `No Figma file selected` errors were resolved in a single `use_file` call — the fix-stating error message did its job.
3. **`screenshot` as design reference.** 3 single-node screenshots on remote all succeeded (no [BUG-016] `-32602` recurrence here — these were small nodes), giving the agent visual ground truth for the port.
4. **Low overhead.** Only 2 ToolSearch calls despite being an external repo where Figmagent tools are deferred; minimal re-discovery.

## Priority Improvements

### Tool Changes (ranked by call savings)

1. **[TOOL-020]** — resolve imported library-variable/style values on remote (and include typography numerics in FSGN `read`). Would have made both `get_design_system` calls productive. ~2 calls/session here; ~20 in token-binding sessions.
2. **[BUG-014]** — remote onboarding: lead with `use_file`; surface "call use_file first" guidance so the first `read`/`screenshot` doesn't fail. ~2 calls/session.

### Agent Skill Updates

1. **When `get_design_system` returns empty on remote, assume library-bound tokens** — go straight to the codebase token pipeline output (design-to-code) or `run_script`/`get_enabled_library_variables` (in-Figma). Fold into the [TOOL-020] / [AGENT-020] guidance.
2. **Remote: `use_file` before the first `read`/`screenshot`.** Already in [BUG-014]'s proposed CLAUDE.md note — recurrence #4.

## Notes

This is a **dev-dominant design-to-code session** with a small (14-call) read-only Figmagent footprint. No new issues warranted — both Figma-side findings are recurrences of existing tracker entries ([BUG-014], [TOOL-020]). Agent behavior was strong throughout: fast error recovery, correct fallback to codebase tokens, no reconnection thrash, no retry storms.
