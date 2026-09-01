# Figma MCP Session 38 Analysis

## Session Overview

- **Transcript**: `dc10dbb1-731f-4402-85e3-c22615a2564c.json` (external project: **vip-workflows**, remote transport)
- **Duration**: 15 minutes
- **Total tool calls**: 21 (16 Figmagent, no sub-agents)
- **Total errors**: 3 (all recovered, all `is_error: true` except the screenshot validation reject)
- **Reconnections**: 0 (remote transport — no channels)
- **Context restarts**: 0
- **Task**: Combine 5 loose `StageNode` frames + 2 `TransitionEdge` frames into two COMPONENT_SETs with variants, then define + bind component properties (Title text, Actors instance-swap) — VIP Workflow "Node UI — Base components".

## Metrics

| Metric | Session 37 | This Session (38) | Change |
|---|---|---|---|
| Total tool calls | 77 (41 figma) | 21 (16 figma) | smaller, focused task |
| Meta/overhead calls (ToolSearch/Skill) | — | 3 (2 ToolSearch + 1 Skill) | ~14% |
| Errors | 5 (all `is_error:false`) | 3 (2 hard errors + 1 MCP reject) | — |
| Estimated waste % | ~16% | ~14% (3/21) | comparable, clean |

## Tool Call Distribution

| Tool | Calls | Notes |
|---|---|---|
| `mcp__Figmagent__read` | 6 | 1 wasted (pre-`use_file`), 1 wasted (hyphen node ID), batched siblings well in #8/#9 |
| `mcp__Figmagent__component_properties` | 3 | add + bind Title (StageNode), add Actors (TransitionEdge) — first-class, no `run_script` |
| `mcp__Figmagent__combine_as_variants` | 2 | one per set, clean |
| `mcp__Figmagent__edit` | 2 | rename variants `Type=…` + reposition; batched 7 then 2 nodes |
| `mcp__Figmagent__screenshot` | 1 | **failed** (BUG-016 `-32602`); agent did not retry, proceeded by reading |
| `mcp__Figmagent__use_file` | 1 | required after pre-`use_file` `read` failed |
| ToolSearch | 2 | tool-schema loading |
| Skill / AskUserQuestion / Read / Edit | 4 | loaded figma-guidelines, asked variant-structure question, wrote memory |

## Efficiency Issues

### 1. Hyphenated node ID from Figma URL rejected (saves ~1 call) — NEW

The agent had a node ID in the Figma-URL form `2010-73` (hyphen) and called `read(nodeId: "2010-73")` (call 5) → `Error: Node not found: 2010-73`. It then retried with the colon form `read(nodeId: "2010:73")` (call 6) → success. Figma **deep-link URLs always encode node IDs with a hyphen** (`?node-id=2010-73`), but the Plugin/MCP API expects the colon form (`2010:73`). Any agent that lifts an ID straight from a URL (the natural thing to do, and exactly what `use_file` accepts as a URL) hits this.

**Pattern observed:** `read 2010-73` → not found → `read 2010:73` → ok. One wasted round-trip.

**Root cause:** No normalization of the `nodeId`/`nodeIds` parameter — the hyphenated URL form is silently treated as a literal (non-existent) ID rather than coerced to the canonical `:` form.

**Proposed fix:** Normalize `nodeId`/`nodeIds` at the tool boundary — replace a single `-` separator between two integer runs with `:` (`^(\d+)-(\d+)$` → `$1:$2`) before lookup, in `read`/`edit`/`screenshot`/`grep`. Cheap, eliminates a recurring "Node not found" stumble for URL-derived IDs.

**Estimated savings:** ~1 call/session whenever an ID is taken from a URL.

### 2. Remote onboarding: `read` before `use_file` (saves ~1 call) — RECURRENCE

Call 3 `read(2010-73)` failed with `No Figma file selected. Pass a file URL to use_file…`; the agent then called `use_file` with the file URL (call 4) and proceeded. The URL was available from the start. This is the same onboarding half documented in **BUG-014** / proposed companion doc **#65** (Sessions 27, 33, 34, 36) — lead with `use_file` on remote.

**Root cause:** Remote transport has no auto-join; first command must be `use_file`.

**Proposed fix:** Already tracked — reinforce "call `use_file` before the first `read` on remote" in the figma-guidelines skill (#65). No new code.

## Error Analysis

### 1. Remote single-node `screenshot` → MCP `-32602 invalid_union` (1 failure) — RECURRENCE of BUG-016

Call 7 `screenshot(nodeId: "2010:73")` (a FRAME) returned `MCP error -32602: Invalid tools/call result: [{ "code": "invalid_union", ... "path": ["type"], "message": "Invalid input: expected \"text\"" }, { ... "path": ["text"] }]` — the same malformed-content-block reject as **BUG-016** (Sessions 34, benchmark 2026-06-19). Consistent with the larger/complex-node correlation (a full base-components FRAME).

**Agent recovery:** Good — did **not** retry-storm. It abandoned the visual check and proceeded structurally via batched `read` (#8/#9). It never got a screenshot this session, so the build was verified by reading the resulting COMPONENT_SET (#19) rather than visually — acceptable here, but it is the self-verification gap BUG-016 keeps causing.

**Fix needed:** Already tracked (BUG-016) — guarantee the remote `screenshot`/`export` result conforms to the MCP `image` schema; on oversized/failed export return a clean `is_error` text block.

### 2. Hyphen node ID "Node not found" (1 failure)

Covered in Efficiency Issue 1. Notably `Node not found` returned `is_error: true` here (good — the agent could branch), unlike the `is_error:false` "Node not found" noted in [BUG-008]/[AGENT-022].

## What Worked Well

1. **`component_properties` is now first-class (3 calls, 0 `run_script`).** Adding + binding a TEXT property (`Title`) and an INSTANCE-swap property (`Actors`) on the new sets was done with the dedicated tool — contrast Session 34, where instance/property work still leaned on `run_script`. No escape-hatch scripting this session.
2. **`combine_as_variants` + `edit` rename flow was clean.** Two sets built in 2 combine calls; variant naming (`Type=Default`, etc.) handled via batched `edit` (7 then 2 nodes) with no malformed-name rejections.
3. **Batched sibling reads.** Calls 8–9 read 5 + 2 sibling components in two multi-`nodeIds` `read`s rather than 7 singles ([AGENT-017] applied).
4. **Asked before structuring.** `AskUserQuestion` (#11) confirmed "keep 5 as variants" before committing — avoided a wrong-structure rebuild.

## Priority Improvements

### Tool Changes (ranked by call savings)

1. **Normalize hyphenated node IDs (URL form → colon form)** — `read`/`edit`/`screenshot`/`grep` should coerce `2010-73` → `2010:73`. New: **TOOL-022**. Saves ~1 call/session; removes a recurring URL-copy stumble.
2. **Fix remote single-node `screenshot`** — BUG-016, now recurred a 3rd time. Highest-impact unresolved item: it is the remote self-verification gap.

### Agent Skill Updates

1. **Remote-first onboarding (`use_file` before first `read`)** — BUG-014 / #65, recurred again. Land the companion doc.
