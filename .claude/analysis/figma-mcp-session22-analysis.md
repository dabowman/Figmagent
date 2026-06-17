# Figma MCP Session 22 Analysis

## Session Overview

- **Transcript**: `be539825-3bf1-4d56-b436-ef4c6864732b.json`
- **Project**: cursor-talk-to-figma-mcp (`use_fimga-refactor` branch)
- **Duration**: 72 minutes wall-clock (15:07–16:19) — but ~40 min of that is idle gaps for user review (24-min gap at 15:33→15:57, 10-min gap at 16:00→16:10)
- **Total tool calls**: 112
- **Figma tool calls**: 96
- **Non-Figma tool calls**: 16 (5 ToolSearch + 3 WebFetch + 4 Bash + 4 Read)
- **Total errors**: 4 hard (`is_error`): 3 WebFetch ECONNREFUSED + 1 Read over-token. Plus 2 soft Figmagent failures (update_variables 1/10, update_styles 8/8) — both font-loading, both recovered
- **Reconnections**: 0
- **Context restarts**: 0
- **Task**: Port the Tempo Homepage from a live CSS/HTML page (`127.0.0.1:8080`) into Figma — update section padding 56→144px, restructure 2-column grid layouts, sync design tokens (variables + text styles) to CSS values, componentize all 10 sections with text properties, and build 3 responsive breakpoint frames (1024/640/480px).

> Note: Still pre-rename (wire names `get`/`apply`/`create`). Findings mapped to current tooling (`read`/`edit`/`write`) where relevant.

## Metrics

| Metric | Session 21 | This Session | Change |
|---|---|---|---|
| Total Figma tool calls | 17 | 96 | +465% (large multi-phase port) |
| Meta/overhead calls | 2 ToolSearch + 2 Grep + 2 Read | 5 ToolSearch + 3 WebFetch + 4 Bash + 4 Read | More research overhead |
| ToolSearch calls | 2 (8.7%) | 5 (4.5%) | -4.2pp (good ratio for size) |
| Estimated waste % | ~25% | ~14% | -11pp |

For a 112-call, 5-phase port this is a low waste ratio — most calls were productive, and the agent leaned heavily on parallel batches (clone fans, 10 parallel `component_properties`, 30-instance breakpoint builds).

## Tool Call Distribution

| Tool | Calls | Notes |
|---|---|---|
| get | 21 | Section/structure inspection + post-`apply` layout verification (heavy but justified for a complex port) |
| clone_and_modify | 19 | Reparenting body text into 2-column stacks + cloning 10 section content frames into component shells |
| apply | 11 | Padding, FILL sizing, layout-mode swaps, colors, font-style fixes |
| create | 11 | Component shells, stack frames, 30 breakpoint instances, Deal Brain Practice section |
| component_properties | 11 | 1 (Confession Card) + 10 parallel (section components) — 55 props total |
| delete_multiple_nodes | 6 | Reparent cleanup + old-section removal (30 deleted before breakpoint rebuild) |
| ToolSearch | 5 | 4.5% — orientation, get/apply, design-system, text/create, components |
| reorder_children | 5 | Section ordering to match HTML across 4 frames |
| Bash | 4 | curl probes to confirm the local server (WebFetch couldn't reach it) |
| Read | 4 | HTML/CSS source (1 failed — file over 10K tokens, recovered with offset/limit) |
| get_selection | 3 | Phase boundaries |
| update_styles | 3 | 1 ok (11 styles) + 1 **failed 8/8 (unloaded font)** + 1 retry ok (8 styles) |
| WebFetch | 3 | **All 3 ECONNREFUSED** on `127.0.0.1:8080` |
| update_variables | 2 | 1 (9/10, serif font var failed) + 1 retry (serif ok) |
| set_multiple_text_contents | 2 | Batched section text + card overrides |
| get_design_system | 1 | Token comparison vs CSS (no overflow this time) |
| create_variables | 1 | 9 semantic color variables |

Total: 112. ✓

## Efficiency Issues

### 1. `update_styles` doesn't pre-load the style's existing font (saves ~2 calls) — NEW [BUG-010]

The headline finding. Updating a text style's **non-font** property (lineHeight) failed because the plugin tried to write to the style's text node without loading its current font first.

**Pattern observed:**
- `update_styles` (lineHeight on 8 Sans styles) → `{"success": false, "totalUpdated": 0, "totalFailed": 8}`, each: `"in set_lineHeight: Cannot write to node with unloaded font \"Public Sans Medium\". Please call figma.loadFontAsync({ family: \"Public Sans\", ... })"`
- Agent diagnosis: *"The Sans styles failed because fonts weren't loaded — let me include fontFamily/fontStyle so the tool loads them."*
- Retry `update_styles` with `fontFamily`/`fontStyle` included → `{"success": true, "totalUpdated": 8}`

**Root cause:** The `update_styles` handler loads a font only when the update *sets* a font property. When updating lineHeight/letterSpacing/etc. alone, it skips font loading and the underlying `set_lineHeight` write throws on the style's already-assigned (but unloaded) font. Same font-loading class as [BUG-004] (import) and [BUG-007] (create) — different tool.

**Proposed fix:** In the `update_styles` handler (and `update_variables` for font-family variables), always `loadFontAsync` the style's *current* font before writing any property, not just when a font field is present. Read the existing `fontName` off the style's text node and load it first.

**Estimated savings:** ~1–2 calls per text-style-editing session; eliminates a confusing soft failure.

### 2. WebFetch cannot reach localhost (saves ~5 calls) — NEW [INFRA-004]

The task referenced a live page at `http://127.0.0.1:8080/`. WebFetch returned `ECONNREFUSED` three times even though the server was up (curl returned 200).

**Pattern observed:** `WebFetch(127.0.0.1:8080)` → ECONNREFUSED ×3 → agent asks user to start the server → `Bash lsof -i :8080` + 3 `curl` probes confirm it IS running and returns 200 → agent switches to `Bash curl` to fetch HTML/CSS.

**Root cause:** Claude Code's WebFetch tool resolves/proxies through infrastructure that cannot reach the loopback interface. Not a Figmagent issue — a harness limitation — but it cost 3 failed fetches + 4 diagnostic Bash calls + a round-trip asking the user to "start the server" (it was already running).

**Proposed fix:** Agent-behavior — when a target URL is `localhost`/`127.0.0.1`/`0.0.0.0`, fetch with `Bash curl` from the start rather than WebFetch. Worth a line in CLAUDE.md / the figma-guidelines skill (which covers porting live pages into Figma).

**Estimated savings:** ~5 calls (3 WebFetch + 2 of the 4 Bash probes) + avoids a false "server isn't running" message to the user.

### 3. Re-inspect after apply (recurrence) — [AGENT-016]

~9 `get` calls immediately follow `apply` calls to verify layout/sizing changes (#19, #28, #37/39, #41, #59, #62/63, #65, #67). For a complex multi-section layout port this is largely justified (cross-frame sizing effects are hard to predict), but it remains the recurring write-then-verify cadence. The post-write `warnings:` block (shipped after this session) would absorb some of these.

## Error Analysis

### 1. Font-loading soft failures in `update_styles` / `update_variables` (9 failed sub-results, ~1 minute lost)

`update_styles` failed all 8 lineHeight updates ("unloaded font") and `update_variables` failed the serif font-family variable (font "Test Martina Plantijn" not loaded). Neither surfaced as `is_error: true` — the failures were inside the result JSON (`success: false, totalFailed: N`).

**Agent recovery:** Excellent. Read the per-result errors, correctly attributed both to font loading, and re-issued with font fields included (which triggers loading). No retry storm. Came back to the serif variable later as promised.

**Fix needed:** [BUG-010] — pre-load the style/variable's current font before any property write.

### 2. WebFetch ECONNREFUSED ×3 (3 failures, ~2 minutes lost)

See efficiency issue 2. **Agent recovery:** Good but slightly slow — it asked the user to start the server twice before probing with `lsof`/`curl` and discovering the server was already up and the WebFetch tool was the problem. Fail-faster would be to probe with curl after the first ECONNREFUSED.

### 3. Read over-token (1 failure, negligible)

One `Read` of a CSS/HTML file exceeded 10K tokens. Agent recovered immediately with offset/limit. Generic Claude Code behavior, not Figma-specific.

## What Worked Well

1. **Heavy, correct parallelism.** Multiple fan-out batches issued in single turns: create+clone+delete for 2-column restructuring (#20–26), 1 create + 10 clones for componentization (#79–89), **10 parallel `component_properties`** (#91–100, 55 props), and 30-instance breakpoint builds (#105–112). This is exactly the plugin-concurrency-friendly pattern.

2. **Disciplined CSS→Figma mapping.** The agent extracted the exact grid system (`repeat(7, 1fr)`, `column-gap: 21px`, `padding-inline: max(container, 50% - 36rem)` = 144px) and translated each to Figma equivalents, explaining `clamp()` limitations and offering min/max-width alternatives for the reel cards.

3. **Correct reparent idiom.** Used clone-into-target + delete-original for all 2-column restructures rather than trying to move nodes — the documented "reparenting = clone + delete" pattern.

4. **Componentization at scale.** Built a Confession Card component (3 props, 5 instances) and 10 section components (55 props), then replaced raw section frames with instances across 4 breakpoint frames — a clean atomic-design outcome.

5. **Low overhead for the size.** 5 ToolSearch (4.5%), 0 reconnections, 0 timeouts across a 96-Figma-call, 5-phase port.

6. **Robust soft-failure recovery.** Both font-loading partial failures were diagnosed from the result JSON and fixed in one retry each.

## Priority Improvements

### Tool Changes (ranked by call savings)

1. **[BUG-010] `update_styles`/`update_variables` font pre-loading** — Load the style/variable's *current* font before writing any property (not just when a font field is set). Eliminates the "unloaded font" soft failure and a retry. Part of the broader font-loading family with [BUG-004]/[BUG-007].

### Agent Skill Updates

1. **[INFRA-004] Use `curl` for localhost, not WebFetch** — When porting a live local page, fetch `localhost`/`127.0.0.1` URLs with `Bash curl` directly. WebFetch returns ECONNREFUSED on the loopback interface. Add to CLAUDE.md / figma-guidelines.

2. **Probe before re-asking the user** — After one ECONNREFUSED, confirm with `lsof`/`curl` before telling the user "the server isn't running." Here the server was up the whole time.
