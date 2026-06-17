# Figma MCP Session 32 Analysis

## Session Overview

- **Transcript**: `877cd21b-94a7-4436-978c-335f805bb807.json`
- **Project**: **WordPress-Admin-Environment** (external, `main` branch)
- **Date**: 2026-06-02
- **Duration**: 190 minutes (overwhelmingly code work)
- **Total tool calls**: 189
- **Figma tool calls**: 6 (read-only: 4× `get`, 1× `join_channel`, 1× `export_node_as_image`)
- **Non-Figma tool calls**: 183 (69 Bash + 54 Edit + 45 Read + 6 Write + others)
- **Total errors**: 0 hard; 1 soft (first `get` returned the multi-file picker)
- **Reconnections**: 1 (`join_channel` after the multi-file picker)
- **Context restarts**: 0
- **Task**: **Design-to-code** — port the WPDS `_Page/Header` Figma component into a shared React `<PageHeader>` for the WP Admin Shell, then migrate to `@wordpress/admin-ui` `Page`. Figma was inspected read-only for the spec; the build was verified with Playwright screenshots.

> Note: Second external design-to-code session (with session 31). Reinforces the read-only "inspect a WPDS component → build it in code" usage mode.

## Metrics

| Metric | Session 31 | This Session | Change |
|---|---|---|---|
| Total Figma tool calls | 3 | 6 | +3 (added variants + screenshot) |
| Meta/overhead calls | 1 ToolSearch | 3 ToolSearch | — |
| ToolSearch calls | 1 | 3 | — |
| Estimated Figma-side waste % | ~0% | ~0% | — |

189-call session, 6 of them Figma. Figma-side usage was minimal, correct, and effectively waste-free (the one `join_channel` was necessary multi-file disambiguation).

## Tool Call Distribution (Figma subset)

| Tool | Calls | Notes |
|---|---|---|
| get | 4 | `_Page/Header` COMPONENT_SET: structure depth 3 (after rejoin), then full depth 4 on a variant (`Spacing=Default`), full depth 2 on another (`Spacing=Condensed`). First call hit the multi-file picker. |
| ToolSearch | 3 | Figma tool discovery |
| join_channel | 1 | Joined `wpds-gutenberg-22-3-copy` after the multi-file picker |
| export_node_as_image | 1 | PNG @2x of the header — visual reference for the port |

(Plus 183 code/build calls: Bash 69, Edit 54, Read 45, Write 6, AskUserQuestion 2, WebFetch 2, Agent 1, design-system MCP 1.)

## Efficiency Issues

### 1. First `get` hit the multi-file picker (1 call) — [BUG-008]-family / multi-file

`get(16343:22203)` returned `"Error reading nodes: Multiple Figma files are open. Call join_channel with the file you want: • untitled • vip-workflows • …"` (`is_error: false`). The agent `join_channel`'d to `wpds-gutenberg-22-3-copy` and re-ran the `get`.

**Root cause:** Multiple files open; the picker is delivered as an "Error…" string (same error-shaped-string family as [BUG-008]). Costs one round-trip the first time Figma is touched in a multi-file environment.

**Proposed fix:** Minor — none beyond the standing [BUG-008] flag-as-error and the known multi-file flow. The agent handled it in one step.

Otherwise no Figma-side inefficiency: the `get` calls were correct progressive disclosure (structure → full on specific variants), and the single screenshot grounded the visual port.

## Error Analysis

### 1. Multi-file picker (1 soft failure, ~5 seconds)

See above. **Agent recovery:** Ideal — joined the correct channel and retried immediately.

## What Worked Well

1. **Design-to-code with a visual checkpoint.** `get(structure)` → `get(full)` on the relevant variants → `export_node_as_image` gave both the structured spec and a visual reference before porting `_Page/Header` to React — a step beyond session 31's spec-only inspection.

2. **Round-trip verification.** After building, the agent used Playwright (Bash) to screenshot the *migrated screens* and compare against the design — closing the design-to-code loop with evidence rather than assumption.

3. **Variant-aware inspection.** Read the COMPONENT_SET structure, then pulled `full` detail on specific variants (`Spacing=Default`, `Spacing=Condensed`) rather than dumping the whole set — within budget (~8–10K chars each).

4. **Minimal, healthy Figma footprint.** 6 Figma calls across a 190-minute build, 0 hard errors, the connection stayed alive between infrequent calls, and the one multi-file picker was resolved in a single `join_channel`.

## Priority Improvements

### Tool Changes

None Figma-specific beyond the standing **[BUG-008]** (flag the multi-file picker / error-shaped strings as `is_error: true`).

### Agent Skill Updates

1. **Reinforce the design-to-code inspection recipe** (with session 31): `get_selection`/`get(structure)` → `get(full)` on target variants → `export_node_as_image` for a visual checkpoint → build in code preserving design-system tokens → screenshot the result to verify. Worth a short entry in the figma-guidelines skill, since real-world external usage skews heavily toward this read-only mode rather than canvas building.
