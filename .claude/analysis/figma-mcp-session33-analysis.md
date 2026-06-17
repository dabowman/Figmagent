# Figma MCP Session 33 Analysis

## Session Overview

- **Transcript**: `59a8406c-3d98-4016-9b3e-f406da681422.json`
- **Project**: **WordPress-Admin-Environment** (external, `main` branch)
- **Date**: 2026-06-17 (most recent; post-rename, **remote transport**)
- **Duration**: 27 minutes
- **Total tool calls**: 12
- **Figma tool calls**: 8 Figmagent (5× `read`, 3× `use_file`) + 1 official figma MCP (`get_metadata`)
- **Non-Figma tool calls**: 2 ToolSearch
- **Total errors**: 0 hard; 6 soft — 1 "No Figma file selected", 5 "you don't have edit access" — all `is_error: false`
- **Reconnections**: n/a (remote transport)
- **Context restarts**: 0
- **Task**: Read a single Figma node (`4:849`, a "Command palette" frame) for reference. Blocked: Figmagent's **remote transport** refused to read the file without **editor** access; the agent fell back to the official figma MCP to read it.

> Note: External, remote-transport session. Surfaces a significant new limitation about read access on the remote transport.

## Metrics

| Metric | Session 32 | This Session | Change |
|---|---|---|---|
| Total Figma tool calls | 6 | 9 (8 Figmagent + 1 official) | — |
| Meta/overhead calls | 3 ToolSearch | 2 ToolSearch | — |
| ToolSearch calls | 3 | 2 | — |
| Estimated waste % | ~0% | ~60% (blocked task) | — |

High "waste" here is unavoidable — the task was blocked by an access limitation, and most calls were retries/diagnosis around it. The agent ultimately succeeded via the official figma MCP fallback.

## Tool Call Distribution

| Tool | Calls | Notes |
|---|---|---|
| read (Figmagent) | 5 | All **failed** — 1 "No Figma file selected", 4 "you don't have edit access to this file" |
| use_file (Figmagent) | 3 | Selected the file by URL; resolved fine, but read still blocked on edit access |
| ToolSearch | 2 | Figmagent read/use_file; then official figma `get_metadata` |
| plugin_figma_figma__get_metadata | 1 | **Succeeded** — read `4:849` via the official figma MCP (view access is enough there) |

Total: 12. ✓

## Efficiency Issues

### 1. Remote transport requires EDITOR access to READ (saves the whole task) — NEW [BUG-015]

The headline finding. Figmagent's **remote transport** refused all read operations on a file the user could open but only had **view** access to:

**Pattern observed:**
- `read(4:849)` → `"Error reading nodes: No Figma file selected. Pass a file URL to use_file"`
- `use_file("https://www.figma.com/design/CFXUUpxmOYvVg6qElHETAN/…")` → resolved/connected fine
- `read(4:849)` → `"Error reading nodes: Looks like you don't have edit access to this file. The file owner can share it with you and make you an editor."` (×4, across reselects/reloads/reauth)
- Agent fell back to `mcp__plugin_figma_figma__get_metadata(fileKey, nodeId)` → **succeeded** — read `4:849` ("Command palette", 324×72 frame at (1329,197))

**Root cause:** On the remote transport, the `use_figma` VM / official-MCP identity Figmagent rides requires **editor** access to the file — even for read-only operations. View-only access (the common case for a shared/library file you don't own) is rejected. The official figma MCP, by contrast, reads view-only files via the REST/metadata path. The error is `is_error: false` ([BUG-008]).

**Proposed fix:** Remote-transport **read** operations should work with **view** access (use the read/metadata path that doesn't require editor scope), reserving the editor requirement for writes. At minimum, the error should name the limitation precisely ("remote transport needs editor access; for view-only files use the plugin transport or the official figma MCP") and Figmagent should consider a read-only remote path. This blocks the entire read-only/design-to-code workflow for view-only files on remote.

**Estimated savings:** Unblocks read-only remote usage on view-only files (currently impossible — requires the official-MCP fallback).

### 2. First `read` before `use_file` on remote (recurrence) — [BUG-014]

`read` before `use_file` returned `"No Figma file selected"` — the same remote-onboarding friction as session 27. Recovered by calling `use_file` with the URL.

## Error Analysis

### 1. Edit-access block (5 soft failures, ~most of the session) — NEW [BUG-015] / [BUG-008]

Four `read` calls returned `"you don't have edit access to this file"` (`is_error: false`), plus the initial "No Figma file selected." **Agent recovery:** Strong and well-reasoned — it didn't blind-retry; each re-attempt followed a user action (reauth, reload, reselect), and the agent correctly diagnosed that (a) Figmagent's auth is separate from the official figma MCP, (b) it's pinned to the remote transport, and (c) that transport needs editor access. It then fell through to the official figma MCP to actually read the node. Excellent root-cause explanation to the user.

**Fix needed:** [BUG-015] read with view access on remote; [BUG-008] flag as error.

## What Worked Well

1. **Correct cross-server diagnosis.** The agent precisely explained that Figmagent (remote transport) and the official `figma` MCP are *separate servers with separate auth*, that reauthing the official server wouldn't help Figmagent, and that the blocker was edit-access on the remote transport — not the link. This is exactly the kind of two-MCP distinction CLAUDE.md documents.

2. **Effective fallback.** When Figmagent stayed blocked, the agent used the official figma MCP's `get_metadata` to read `4:849` and answer the user — task completed despite the limitation.

3. **No retry storm.** Despite 5 failed reads, each retry was justified by an intervening user action (reauth/reload/reselect); the agent escalated to a fallback rather than hammering the same call.

## Priority Improvements

### Tool Changes (ranked by impact)

1. **[BUG-015] Remote-transport read should accept view access** — Read/metadata ops shouldn't require editor scope. Currently view-only files are entirely unreadable on the remote transport, forcing an official-MCP fallback. P1 — blocks the most common read-only/design-to-code case (consuming a shared library you don't own).

2. **[BUG-008] Flag the edit-access error as `is_error: true`** — Returned `is_error: false`, like all other Figmagent failures.

### Agent Skill Updates

1. **Remote view-only fallback** — Document: if Figmagent's remote transport returns "you don't have edit access" on a read, the file is view-only for that identity; fall back to the official figma MCP (`get_metadata`/`get_design_context`) or switch to the plugin transport. The agent discovered this correctly; capture it so the next agent skips the retries.
