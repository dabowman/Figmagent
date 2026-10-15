# Figma MCP Session 34 Analysis

## Session Overview

- **Transcript**: `064943cf-2e11-4a9a-a092-c18088b0d27f.jsonl` (external project: **WordPress-Admin-Environment**)
- **Transport**: **remote** (`use_file` with a `figma.com/design/...` URL; no relay/channel)
- **Duration**: 53 minutes
- **Total tool calls**: 61 (main) + 114 (4 sub-agents) = **175**
- **Total errors**: 9 hard (`is_error: true`): 4 main + 2 agent-ab + 3 agent-a0
- **Reconnections**: 0 (remote has no channels)
- **Context restarts**: 0
- **Tokens (main)**: 115K in / 177K out
- **Task**: Refactor the "Omnibar.Desktop" top bar (4 variants) in a shared Figma file to consume the official WordPress design-system libraries — rename the 88-var local `WPDS Color` collection to mirror `@wordpress/theme`'s grouped shape, rebind every hardcoded hex / `Scales/*` primitive to `wpds-color/*` tokens, pin Dark mode, and swap hand-rolled glyphs/actions for `@wordpress/icons` + `@wordpress/ui IconButton` instances.

**Headline**: This is the **first successful remote-transport WRITE session** in this external repo. Sessions 31/32 were read-only design-to-code; session 33 was *blocked* by the remote edit-access wall ([BUG-015]). With editor access now present, a large multi-phase mutation (88 renames + 60 binds + component swaps across 4 variants) completed and verified end-to-end on remote.

## Metrics

| Metric | Session 33 (prev, same project) | This Session | Change |
|---|---|---|---|
| Total tool calls (incl. agents) | 12 | 175 | +163 (much larger scope) |
| Main-session calls | 12 | 61 | +49 |
| Hard errors | 0 (6 soft) | 9 | +9 |
| ToolSearch calls (main) | 2 | 6 (9.8%) | +4 |
| Estimated waste % | ~60% (blocked) | ~15% | task unblocked |
| Remote write completed | no (blocked) | **yes** | milestone |

## Tool Call Distribution

### Main session (61)
| Tool | Calls | Notes |
|---|---|---|
| Bash | 9 | curl asset downloads + node/CSS token inspection |
| ToolSearch | 6 | Figmagent + official-figma + design-system tools all deferred in external repo |
| mcp__Figmagent__read | 5 | 1 failed (pre-`use_file`) |
| Agent | 4 | 2 Explore (codebase/token discovery), 2 fork (mutation phases) |
| Read | 4 | viewing downloaded screenshots + memory |
| AskUserQuestion | 4 | confirm direction; caught "this is Figma editing, not code" |
| mcp__plugin_figma_figma__get_screenshot | 3 | **fallback** for buggy Figmagent screenshot ([BUG-016]) |
| mcp__Figmagent__get_enabled_library_variables | 3 | 1 failed (pre-`use_file`) |
| mcp__Figmagent__get_design_system | 3 | filtered discovery of local + library collections |
| mcp__Figmagent__update_variables | 3 | 88-var rename in 3 group batches |
| mcp__Figmagent__get_library_components | 3 | icon/component search |
| mcp__Figmagent__search_library_components | 2 | — |
| mcp__plugin_figma_figma__* (metadata/var_defs/design_context) | 3 | initial design read via official MCP (Dev Mode) |
| mcp__design-system__* (tokens/components) | 2 | WPDS token-shape reference |
| use_file / get_local_components / get_component_variants / run_script / screenshot | 1 each | screenshot failed → [BUG-016] |
| Skill / Write | 1 each | figma-guidelines skill; memory write |

### Sub-agents (114)
| Agent | Calls | Role |
|---|---|---|
| agent-a3 (Explore) | 34 | Read/Bash — map current top-bar implementation (read-only) |
| agent-ac (Explore) | 31 | Read/Bash — map token/theme structure (read-only) |
| agent-ab (fork) | 23 | Figma mutation phase 1: color rebind + icon swap (2 errors) |
| agent-a0 (fork) | 26 | Figma mutation phase 2: icons + ui-wrapping (3 errors) |

## Efficiency Issues

### 1. Screenshot-via-official-MCP three-call dance (saves ~6 calls) — forced by [BUG-016]

Because Figmagent's own `screenshot` intermittently fails on remote ([BUG-016]), the main agent fell back to the official Figma MCP to view results. Each view cost **three** calls: `mcp__plugin_figma_figma__get_screenshot` → `Bash curl` the returned asset URL → `Read` the PNG. This happened 3× in the main session (#4–8, #45–47, #56–58) = 9 calls to view 3 images.

**Root cause:** Figmagent's `screenshot` returns image bytes inline (1 call), but its remote result fails MCP schema validation; the official MCP returns a *URL* that must be downloaded and read separately.

**Proposed fix:** Fix [BUG-016] so the inline `screenshot` path is reliable on remote — restores the 1-call view.

**Estimated savings:** ~6 calls per verification-heavy session.

### 2. Redundant `get_design_system` re-pulls (saves ~1–2 calls)

`get_design_system` was called 3× (#26, #34, #35) and `read` re-pulled the local collection across A60→A67→A86 as the agent discovered the two-layer token model (local `WPDS Color` 88-var vs library `@wordpress/theme` 257-var). Mostly justified discovery, but the truncated tail of the 88-var collection forced a second pull (A86) to recover all IDs.

**Root cause:** Output budget truncated the variable list mid-collection; agent re-read to get the tail.

**Proposed fix:** Minor — when `get_design_system`/`read` truncates a single collection's variable list, the narrowing hint already lists collection names; reinforce filtering by `collection` up front for large systems (already in CLAUDE.md).

## Error Analysis

### 1. [BUG-016 — NEW] `screenshot` on remote returns malformed result → MCP `-32602 invalid_union` (3 hard failures)

```
MCP error -32602: Invalid tools/call result: [{ "code": "invalid_union",
  "errors": [[{ "code": "invalid_value", "values": ["text"], "path": ["type"],
  "message": "Invalid input: expected \"text\"" }, { "expected": "string",
  "code": "invalid_type", "path": ["text"], "message": "Invalid in… [truncated: 2923 chars]
```

`mcp__Figmagent__screenshot` failed on **single-node** calls — main #44 (`4:608`), agent-ab #6 (`4:383`), agent-ab #22 (`4:608`) — with a content block that is neither a valid `text` nor `image` block, so the SDK rejects the whole result. **Intermittent**: a *batched* `screenshot {nodeIds: [...]}` (agent-ab #5) and 8 single-node screenshots in agent-a0 succeeded. The failures correlate with larger/complex nodes and a ~2.9KB truncated payload, suggesting an oversized or error-stringified image block escaping into the content array.

**Agent recovery:** Good — after the first `-32602`, the main agent switched to the official `figma` MCP `get_screenshot` (the 3-call dance above) and continued; agent-ab simply retried and the retry succeeded. No retry storm.

**Fix needed:** In the remote `screenshot`/`export` result path, ensure the returned content block always conforms to the MCP `image` content schema (base64 `data` + `mimeType`), and cap/handle oversized exports rather than emitting a malformed block. Add a guard so an export error returns a proper `is_error` text block, not an invalid union member.

### 2. [#65 / BUG-014] Remote onboarding — `read` / `get_enabled_library_variables` before `use_file` (2 wasted calls)

Main #20 and #21 both failed with `No Figma file selected. Pass a file URL to use_file …` because the agent issued reads before selecting the file — even though it already had the file URL from the user. Recovered immediately by calling `use_file` (#22). This is exactly the remote-first-onboarding gap tracked under [BUG-014]/#65.

**Agent recovery:** Fast (1 retry after `use_file`). But the 2 failures are avoidable.

**Fix needed:** Agent-behavior reinforcement (already drafted in #65): on remote, **always `use_file` first**. Consider having the first remote `read`/`get_*` auto-resolve the file from a previously seen URL in context rather than hard-failing.

### 3. `import_library_component` into a read-only parent — error lacks a stated fix (2 failures, agent-a0)

agent-a0 #4 (`import_library_component`) and #6 (`write`) both failed:

```
Error … in appendChild: Cannot move node. New parent is a internal, read-only node
```

The agent was trying to insert an imported component into component-internal (read-only) structure. It recovered by inspecting editability via `run_script` (#7) and retargeting. **The error states no fix** — violating the project's "no user-facing error without a stated fix" rule.

**Fix needed:** Wrap this Figma exception in `fail(message, fix)` — e.g. "Cannot insert into a read-only node (component internals / an instance's children). Insert into a normal FRAME or edit the main component instead."

### 4. `run_script` `setProperties` "Could not find a component property with name: 'undefined'" (1 failure, agent-a0 #12)

Agent passed an `undefined` property key into `instance.setProperties` while prototyping an IconButton swap. Self-corrected on the next call (#13, set the swap on the nested Icon instance). Low impact — exploratory scripting noise, not a tool gap.

## What Worked Well

1. **Remote write unblocked and reliable.** The whole edit pipeline (88-var rename in 3 batches via `update_variables`, 60 token binds + Dark-mode pinning via `run_script` + `setExplicitVariableModeForCollection`, library component swaps) executed atomically on remote with no rollback. Confirms [BUG-015]'s edit-access wall is the *only* blocker — given editor access, remote writes are production-grade.
2. **Fork sub-agents isolated the heavy mutation.** Two `fork` agents (ab: color/icons, a0: icons + ui-wrapping) absorbed 49 tool calls of screenshot-verify churn, keeping the main context at 61 calls. Two read-only `Explore` agents did 65 calls of codebase/token discovery up front in parallel.
3. **Batched the 88-var rename** into 3 group-keyed `update_variables` calls (bg/* , fg-content/interactive, stroke/focus) instead of 88 singles — binding-safe because renames key on ID. Clean use of the batch-first variable CRUD.
4. **AskUserQuestion caught a task-type misread (A46).** The agent initially treated this as a *code* refactor; the user clarified it was a *Figma-file* edit. Four AskUserQuestion gates kept a large shared-file mutation aligned with intent before writing.
5. **Official `figma` MCP as a screenshot fallback.** When Figmagent screenshot hit [BUG-016], the official MCP's `get_screenshot` provided a reliable (if 3-call) alternative — the documented "two Figma MCPs" coexistence paid off.
6. **Batched `screenshot {nodeIds:[...]}` worked** (agent-ab #5, agent-a0 #24) — [TOOL-017]'s batch-screenshot ask appears **implemented** and was used to verify all 4 variants in one call.

## Priority Improvements

### Tool / Plugin Changes (ranked)

1. **[BUG-016] Fix remote `screenshot` malformed-result (`-32602 invalid_union`)** — P1. Guarantee a schema-valid `image` content block (or a proper `is_error` text block on export failure); cap oversized exports. Restores the 1-call inline view and removes the 3-call official-MCP dance. ~6 calls/session.
2. **[BUG-014/#65] Remote auto-select file from context** — P2. Avoid the 2 "No Figma file selected" failures when a URL is already known.
3. **State a fix on the "read-only node" import error** — P2. Wrap in `fail(message, fix)`.

### Agent Skill Updates

1. **Remote-first onboarding (reinforce #65)** — on the remote transport, call `use_file` with the URL **before** the first `read`/`get_*`. Observed tripped again here.
2. **Prefer batched `screenshot {nodeIds:[...]}`** for multi-variant verification — already done well; promote as the default verify pattern, and fall back to official `figma get_screenshot` only when Figmagent screenshot errors.
