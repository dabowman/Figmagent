# Figma MCP Session 31 Analysis

## Session Overview

- **Transcript**: `2737f09f-ccab-487a-b315-99532e684a43.json`
- **Project**: **WordPress-Admin-Environment** (external — `claude/gracious-volta-Xy3pQ` branch) — first cross-project session analyzed
- **Date**: 2026-05-27
- **Duration**: 80 minutes (mostly code work)
- **Total tool calls**: 42
- **Figma tool calls**: 3 (all read-only: `get_selection` + 2× `get`)
- **Non-Figma tool calls**: 39 (Read/Edit/Bash/ToolSearch — code + build)
- **Total errors**: 0
- **Reconnections**: 0
- **Context restarts**: 0
- **Task**: **Design-to-code** — match a WordPress admin sidebar's CSS to a Figma `_Sidebar/SiteHub` component design. Inspect the selected Figma component for exact sizing, then update the repo's CSS/React to match (icon hit area 64→60px, site icon 36→34px, radius tokens, etc.) and verify the build.

> Note: First analyzed session from outside the cursor-talk-to-figma-mcp repo. Figmagent used purely as a **read-only design-spec source** during a code build — a usage mode not seen in sessions 1–30 (which were all canvas building/editing).

## Metrics

| Metric | Session 30 | This Session | Change |
|---|---|---|---|
| Total Figma tool calls | 1 | 3 | n/a (different workload) |
| Meta/overhead calls | 1 ToolSearch | 1 ToolSearch | — |
| ToolSearch calls | 1 (50%) | 1 (2.4%) | n/a |
| Estimated Figma-side waste % | n/a | ~0% | — |

The session is dominated by code work (Read/Edit/Bash); the 3 Figma calls were minimal, correct, and error-free. Figma-side efficiency is effectively perfect — nothing to optimize.

## Tool Call Distribution

| Tool | Calls | Notes |
|---|---|---|
| Edit | 11 | CSS/React edits to match the Figma spec |
| Bash | 16 | Build/verify (webpack), grep for token names |
| Read | 8 | Source files, token definitions |
| get | 2 | Same node `2265:13569`: `structure` depth 3, then `full` depth 3 — correct progressive-detail workflow |
| ToolSearch | 1 | Fetched `get`/`get_selection` |
| get_selection | 1 | Identified the selected component (`_Sidebar/SiteHub`, COMPONENT) |

Total: 42 (3 Figma). ✓

## Efficiency Issues

None on the Figma side. The two `get` calls on the same node were **correct progressive disclosure**, not redundant re-inspection: `detail: structure, depth: 3` first (40 tokens) to orient, then `detail: full, depth: 3` (360 tokens) once the structure was understood — exactly the CLAUDE.md "structure-first, increase detail after reviewing" guidance. The `full` response was within budget (~6.8K chars).

## Error Analysis

No errors. All 3 Figma calls succeeded; `get_selection` cleanly returned the single selected COMPONENT, and both `get` calls returned FSGN within budget.

## What Worked Well

1. **Model read-only design-to-code usage.** `get_selection` → `get(structure, depth 3)` → `get(full, depth 3)` extracted the exact component spec (sizes, radii, spacing) in 3 calls, then the agent translated it to CSS while **keeping WPDS tokens** (e.g. `radius-s` → `--wpds-border-radius-sm`) rather than hardcoding values from the design. Faithful design-to-code without over-fetching.

2. **Progressive detail.** Structure-first then full — avoided pulling the heavy `full` FSGN until the structure was understood. The intended `get` workflow, applied correctly.

3. **Token-preserving translation.** Compared Figma sizes against current CSS in a delta table and bound to existing WPDS radius tokens instead of hardcoding — good design-system hygiene.

4. **Zero Figma errors / reconnections** across an 80-minute mixed code+design session (plugin transport stayed healthy with infrequent Figma calls).

## Priority Improvements

### Tool Changes

None — Figma-side usage was minimal and optimal.

### Agent Skill Updates

1. **Document the design-to-code read-only pattern** — `get_selection` → `get(structure)` → `get(full)` → translate to code, preserving design-system tokens. This is an efficient, low-call usage worth highlighting in the figma-guidelines skill as the canonical "inspect a Figma component to build it in code" flow. (Positive pattern, not a fix.)
