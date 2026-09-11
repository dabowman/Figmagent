# Figma MCP Session 23 Analysis

## Session Overview

- **Transcript**: `ac69c45f-dd1f-4600-9c4b-436a71d3bbd9.json`
- **Project**: cursor-talk-to-figma-mcp (`main` branch)
- **Duration**: 14 minutes (16:13–16:27)
- **Total tool calls**: 68
- **Figma tool calls**: 60
- **Non-Figma tool calls**: 8 (all ToolSearch)
- **Total errors**: 0
- **Reconnections**: 1 (`join_channel` #5 — multi-file disambiguation, not a connection drop)
- **Context restarts**: 0
- **Task**: Convert a flat, manually-positioned imported webpage (Tempo-style landing page, 9 sections + nav + footer, 174 text nodes) into a fully auto-layout-driven responsive structure — outside-in: root → body → sections → containers → cards → text wrappers → text nodes. Then reorder sections, resize root, and verify responsive reflow via screenshots.

> Note: Still pre-rename (wire names `get`/`apply`/`find`/`resize_node`/`export_node_as_image`). Findings mapped to current tooling (`read`/`edit`/`screenshot`) where relevant.

## Metrics

| Metric | Session 22 | This Session | Change |
|---|---|---|---|
| Total Figma tool calls | 96 | 60 | -38% (smaller scope) |
| Meta/overhead calls | 5 ToolSearch + 3 WebFetch + 4 Bash + 4 Read | 8 ToolSearch | ToolSearch-only overhead |
| ToolSearch calls | 5 (4.5%) | 8 (11.8%) | +7.3pp (one re-search after reconnect) |
| Estimated waste % | ~14% | ~20% | +6pp |

Waste drivers: 8 ToolSearch (incl. 1 re-search after the multi-file `join_channel`), ~8 unbatched initial section `get`s, and ~2 re-applied sizing calls from the layoutMode-before-sizing dance. The core conversion work was efficiently batched.

## Tool Call Distribution

| Tool | Calls | Notes |
|---|---|---|
| apply | 26 | Well-batched (9/6/19/19/18/15/12 nodes per call) — auto-layout + sizing. ~2 re-applies from the layoutMode-first dance (#34 sizing → #35 layoutMode → #36 sizing) |
| get | 15 | 12 initial section inspections (mostly individual — batchable) incl. 1 dup of `34:2`; 3 verification reads |
| ToolSearch | 8 | 11.8% — orientation, post-reconnect re-search, then per-capability (apply, find, reorder, resize, export) |
| export_node_as_image | 8 | Visual verification of layout + responsive reflow at multiple widths — good practice |
| resize_node | 3 | Resized root to test reflow at narrower widths (1024px) |
| get_selection | 2 | Initial + post-reconnect |
| get_document_info | 2 | Initial + post-reconnect |
| reorder_children | 2 | Fix section order (Hero first) + nav-above-body |
| join_channel | 1 | Multi-file disambiguation (two files open) |
| find | 1 | Locate nodes by type/scope |

Total: 68. ✓

## Efficiency Issues

### 1. layoutMode-before-sizing 2-pass dance (saves ~2-3 calls) — extends [BUG-009] → [TOOL-016]

Converting flat frames to auto-layout requires `layoutMode` to be set *before* `layoutSizingHorizontal/Vertical` takes effect. The agent sometimes applied sizing first, found it didn't stick, then added layoutMode and re-applied sizing.

**Pattern observed:**
- `#34 apply` — `layoutSizingHorizontal/Vertical` on 19 wrapper frames
- `#35 apply` — `layoutMode + counterAxisAlignItems + itemSpacing` on the same 19 frames ("these wrapper frames need auto layout first")
- `#36 apply` — `layoutSizingHorizontal/Vertical` on the same 19 frames again (now it sticks)

The agent's own narration confirms it: *"Right — these wrapper frames need auto layout first. Let me add it to all of them in one go."* then *"Now set the sizing on all of them."* The first sizing pass (#34) was effectively wasted — sizing silently no-ops on a non-auto-layout node, same class as [BUG-009] (FILL no-op on width-0 text).

**Root cause:** `apply` does not enforce field ordering across calls, and `layoutSizing*` on a node that isn't yet an auto-layout frame (or whose parent isn't) is a silent no-op reported as `success`. When `layoutMode` and `layoutSizing*` are sent in the *same* call (#26–33 did this), it works — so the gap is only when they're split or when a child's FILL needs the parent's auto-layout first.

**Proposed fix:** Within a single `apply`, when both `layoutMode` and `layoutSizing*` are present on a node, apply `layoutMode` first (already works). Additionally, warn (don't bare-`success`) when `layoutSizing*` is requested on a node that is not — and whose parent is not — an auto-layout frame, so the no-op is visible. Document the outside-in ordering (parent auto-layout before child FILL) in the figma-guidelines skill.

**Estimated savings:** ~2-3 re-apply calls per auto-layout-conversion session.

### 2. Unbatched sibling section reads (saves ~8 calls) — NEW [AGENT-017]

The initial structure sweep used 12 individual `get` calls (#9–20), one per section (`34:445`, `34:31`, `34:103`, `34:145`, `34:268`, `34:334`, `34:574`, `34:381`, …), plus a duplicate `get(34:2)` (#9 and #10). `get` accepts a `nodeIds` array (used effectively in session 22) — these siblings could have been read in 1–2 batched calls.

**Pattern observed:** `get(34:445)` → `get(34:31)` → `get(34:103)` → … 12 sequential single-node reads of sibling sections.

**Root cause:** Agent-behavior. The batched multi-nodeId `get` capability exists but wasn't used for the initial sibling sweep (it was used later for verification).

**Proposed fix:** When inspecting a known set of sibling nodes (e.g. all sections under a body), pass them as a `nodeIds` array in one `get` call. Reinforce in CLAUDE.md / figma-guidelines.

**Estimated savings:** ~8-10 calls → ~2.

### 3. ToolSearch overhead, worsened by reconnect (saves ~5 calls) — [TOOL-005]

8 ToolSearch calls (11.8%). The multi-file `join_channel` (#5) was followed by a fresh ToolSearch (#8) re-fetching schemas, then five more scattered per-capability searches (apply, find, reorder, resize, export). Pre-loading would collapse these to 1–2.

## Error Analysis

No errors. The only "soft" inefficiency was the silent sizing no-op in issue 1, which produced no error message — the agent inferred it from the unchanged layout and its own knowledge that auto-layout must come first.

## What Worked Well

1. **Excellent `apply` batching.** Auto-layout and sizing applied to large node groups per call — 19 nodes in #34/#35/#36, 18 in #39, 12–15 in #41/#42. A naive approach would have been dozens of single-node calls; the agent kept it to 26 batched applies for a deeply nested 9-section page.

2. **Outside-in conversion discipline.** Worked root → body → sections → containers → cards → wrappers → text nodes, matching how auto-layout sizing dependencies cascade. Explicitly reasoned about which frames needed `layoutMode` before sizing.

3. **Scoped the 174-text-node problem.** Recognized "174 text nodes — too many to handle one by one" and deliberately focused on the structural section-header text nodes (highest responsiveness impact) rather than exhaustively touching all 174. Good cost-aware triage.

4. **Visual verification loop.** Used `export_node_as_image` (8×) plus `resize_node` (3×) to screenshot the layout, resize the root to 1024px, and confirm responsive reflow — catching the hero-column overlap and correctly diagnosing it as needing breakpoint-level rework beyond auto-layout.

5. **Clean multi-file handling.** Two files were open; the agent asked which, then `join_channel`'d to the right one — one reconnect, no thrashing.

6. **Zero errors, 14 minutes** for a full auto-layout conversion of a flat webpage import.

## Priority Improvements

### Tool Changes (ranked by call savings)

1. **[TOOL-016] `apply` layout-sizing ordering + no-op warning** — Apply `layoutMode` before `layoutSizing*` within a call (works today); warn when `layoutSizing*` is requested on a node/parent that isn't auto-layout instead of bare `success`. Closely related to [BUG-009]. Saves ~2-3 calls per conversion session.

### Agent Skill Updates

1. **[AGENT-017] Batch sibling reads** — Use `get` with a `nodeIds` array to inspect known sibling sets in one call rather than one `get` per node. Saves ~8 calls per structure-sweep.

2. **Document the auto-layout conversion recipe** — In figma-guidelines: convert outside-in, and set `layoutMode` (auto-layout) on a frame *before* setting `layoutSizingHorizontal/Vertical` on it or its children. Combine both in one `apply` per node when possible.
