# Figma MCP Session 20 Analysis

## Session Overview

- **Transcript**: `7b8ad817-50d8-42f2-80d2-3e5cd6cf68d2.json`
- **Project**: cursor-talk-to-figma-mcp (`main` branch)
- **Duration**: 7 minutes (14:27–14:34)
- **Total tool calls**: 30
- **Figma tool calls**: 24
- **Non-Figma tool calls**: 6 (5 ToolSearch + 1 Bash)
- **Total errors**: 0 hard errors (`is_error: true`); 3 soft failures (`get_design_system` truncation/overflow)
- **Reconnections**: 0
- **Context restarts**: 0
- **Task**: Build a contact form on an empty page using existing library component instances (Input, Button, Checkbox, Select, Separator), set text overrides, fix layout/sizing, then lint and bind design tokens.

> Note: This session predates the tool rename — it uses the wire-era names (`get`, `apply`, `create`, `lint_design`, `scan_text_nodes`, `set_multiple_text_contents`). The current MCP layer exposes these as `read`/`edit`/`write`/`lint`/`grep`. Findings are mapped to current tooling where relevant.

## Metrics

| Metric | Session 19 | This Session | Change |
|---|---|---|---|
| Total Figma tool calls | 16 | 24 | +50% (larger build) |
| Meta/overhead calls | 7 ToolSearch + 1 Bash | 5 ToolSearch + 1 Bash | Fewer |
| ToolSearch calls | 7 (15.2%) | 5 (16.7%) | +1.5pp ratio |
| Estimated waste % | ~22% | ~30% | +8pp |

Waste drivers this session: 5 ToolSearch (16.7%) + 3 failed `get_design_system` + 1 Bash workaround + ~3 redundant re-inspection `get` calls ≈ 12/30. Offsetting: zero hard errors, zero reconnections, zero timeouts, and a complete production-quality form delivered in 7 minutes.

## Tool Call Distribution

| Tool | Calls | Notes |
|---|---|---|
| get | 8 | 4 component inspection + 4 post-`apply` re-verification of node `30:3` |
| apply | 5 | All succeeded — sizing, text-style/variable bindings, padding tokens |
| get_design_system | 3 | **All 3 failed** — 96.5K truncated at 30K default, again at 5K, then 111.6K overflow to file |
| lint_design | 3 | Iterative quality loop: 25 → 13 → 9 issues |
| ToolSearch | 5 | 16.7% overhead — separate fetches for orientation, create, scan/text, lint, design-system |
| get_document_info | 1 | Initial orientation |
| get_local_components | 1 | Component discovery (parallel with above) |
| create | 1 | Full form tree from existing component instances in one call |
| scan_text_nodes | 1 | Locate text node IDs inside instances for overrides |
| set_multiple_text_contents | 1 | Batched all text overrides at once |
| Bash | 1 | Workaround to parse the dumped `get_design_system` file |

Total: 30. ✓

## Efficiency Issues

### 1. `get_design_system` overflow recurred (saves ~3 calls) — [TOOL-014]

The agent needed design-system data twice (once early for orientation, once late to find text styles and variable IDs for the residual lint issues). All three `get_design_system` calls failed the same way as session 19:

**Pattern observed:**
- `get_design_system()` → truncated, 96,515 chars exceeds 30K budget
- `get_design_system(maxOutputChars: 5000)` → still truncated (lowering the budget cannot help)
- `get_design_system(maxOutputChars: 97515)` → 111,611 chars exceeds MCP max-token limit, dumped to file
- `Bash` → parse the dumped file for the text styles / variable IDs

**Root cause:** Known issue [TOOL-014]. Same large design system (~96–111K chars) that broke session 19. No filtering parameters (`collection`, `type`, `namePattern`) exist, so the agent cannot request a subset (e.g. just text styles, or just `font/*` variables).

**Proposed fix:** Implement the [TOOL-014] filtering parameters. With `type: "styles"` or `namePattern: "Heading|Helper"` the agent would have gotten the text-style data in 1 call instead of 3 fails + 1 Bash.

**Estimated savings:** ~3 calls per large-design-system session.

### 2. Re-inspect after every `apply` (saves ~3 calls)

Node `30:3` (the form root) was re-read with `get` immediately after each `apply`/`set_multiple_text_contents` — calls #15, #17, #26, #30 all re-fetch the same node to verify the prior mutation.

**Pattern observed:** `set_multiple_text_contents(30:3)` → `apply` → `get(30:3)` → `apply` → `get(30:3)` … a write-then-verify cadence repeated 4×.

**Root cause:** The agent used `get` to confirm each mutation rather than trusting the `apply`/`write` response. This session predates the current guidance — CLAUDE.md now states "Write responses carry the verdict" and "Act on warnings instead of re-reading to verify," and `write`/`edit` responses now append a `warnings:` block. This session **demonstrates the problem that guidance was added to solve.**

**Proposed fix:** No new change needed — confirms the value of the already-implemented write-response warnings. Worth reinforcing in the design-build prompt: "after a successful `edit`, read the returned warnings block instead of re-reading the node."

**Estimated savings:** ~3 calls (the verification `get`s after #14, #16, #29 were largely redundant; the screenshot/lint already validated structure).

### 3. ToolSearch overhead (saves ~3 calls) — [TOOL-005]

5 ToolSearch calls (16.7%) scattered across the session — one before orientation, one before `get`, one before `scan_text_nodes`, one before `lint_design`, one before the late `get`. Each fetches schemas for tools used repeatedly.

**Root cause:** Known issue [TOOL-005]. Tools are deferred and require explicit fetching; short/medium sessions pay a high overhead ratio.

**Estimated savings:** Batched into 1 upfront call, saves ~3–4 calls.

## Error Analysis

### 1. `get_design_system` overflow (3 soft failures, ~1 minute lost)

No hard errors in the session. The three `get_design_system` failures returned non-error payloads (truncation notices / file-dump notice), so the agent had to read the content to detect failure — similar in spirit to [BUG-008] (timeout responses not flagged as errors). The agent recovered cleanly each time: lowered the budget once (ineffective), raised it past the MCP cap (dumped to file), then parsed the file with Bash.

**Agent recovery:** Good — no retry storm, adapted to a Bash extraction. Minor inefficiency: the second attempt *lowered* `maxOutputChars` to 5000, which can never help an over-budget response; it should have gone straight to filtering or file extraction.

**Fix needed:** [TOOL-014] filtering parameters. Optionally surface a clearer hint ("lowering maxOutputChars will not help; use a filter") in the truncation message.

## What Worked Well

1. **Built from existing component instances, not from scratch.** The agent inspected Input/Button/Checkbox/Select/Separator components, then assembled the whole form tree (instances + frames) in a **single `create` call** — no per-node creation, no delete-recreate cycles.

2. **Batched text overrides.** One `set_multiple_text_contents(30:3, …)` set all field placeholders/labels at once instead of per-node text edits.

3. **Iterative lint→fix→lint loop.** Three `lint_design` passes drove issues 25 → 13 → 9, with `apply` batches binding tokens between passes (radius, spacing, padding).

4. **Correct judgment on residual lint issues.** The agent correctly recognized the final 9 issues as acceptable residuals — 4 transparent container fills (`#ffffff00`, alpha 0, no visual impact) and 5 component-instance fills that must be fixed on the main component, not the instance. It did not waste calls trying to "fix" them on instances (avoiding the instance-children-not-auto-fixed trap).

5. **Completed text-style + variable binding.** Recognized that its hand-created TEXT nodes (Title, Description, Consent Label) lacked the `font/family/sans` binding the component text nodes had, and bound text styles (`Heading/4`, `Helper/1`) plus individual variables to match the design system.

6. **Clean run.** Zero hard errors, zero reconnections, zero timeouts, 7 minutes for a complete tokenized contact form.

## Priority Improvements

### Tool Changes (ranked by call savings)

1. **`get_design_system` filtering** — [TOOL-014], now seen in sessions 17, 19, **20**. Highest-recurrence open tool gap. Add `collection` / `type` / `namePattern` params. Saves ~3 calls per large-design-system session.

2. **Truncation message hint** — When a response is over budget, note that lowering `maxOutputChars` cannot help and point to filtering / file extraction. The agent burned one call lowering the budget to 5000.

### Agent Skill Updates

1. **Trust the write-response verdict** — Reinforce "after a successful `edit`/`write`, read the returned `warnings:` block instead of re-reading the node with `read`." This session re-inspected `30:3` four times. (Guidance already in CLAUDE.md; this confirms its value.)

2. **Don't lower `maxOutputChars` on an over-budget response** — It can only shrink the budget further. Filter or extract from the dumped file instead.
