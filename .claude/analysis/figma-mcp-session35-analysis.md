# Figma MCP Session 35 Analysis

## Session Overview

- **Transcript**: `44d8e724-6e14-41c5-b160-5e089a20697d.json`
- **Project**: **vip-workflows** (external, `main` branch)
- **Date**: 2026-06-19 (post-rename, **remote transport**)
- **Duration**: 56 minutes
- **Total tool calls**: 134
- **Figma tool calls**: ~106 Figmagent + 1 official design-system MCP (`get_design_tokens`)
- **Non-Figma calls**: 7 ToolSearch, 8 TaskUpdate, 4 TaskCreate, 2 Write, Read/Edit/Skill/EnterPlanMode/ExitPlanMode/AskUserQuestion
- **Total errors**: 4 hard (`is_error: true`) — 1 no-file-selected, 1 screenshot Zod-union, 1 grep timeout, 1 partial-fail variable-not-found
- **Reconnections**: n/a (remote transport)
- **Context restarts**: 0
- **Task**: Clean up a "Node UI — Base components" board: strip presentation cruft, reparent 10 components, replace 11 hand-drawn VECTOR icons with `@wordpress/icons` library instances, and bind every unbound numeric property (typography size/line-height, padding, gap, radius) to `@wordpress/theme` tokens — **exact matches only**, then (after user follow-up) snap remaining values to nearest token.

> External, remote-transport session against a real WPDS-based design file. The task was completed successfully and verified (214 bindable numeric fields bound, 0 holdouts, 11/11 icons swapped). The inefficiency was almost entirely structural — the toolset has **no way to read a variable's resolved numeric value on the remote transport**, forcing an elaborate empirical-harvesting workaround before `run_script` rescued it.

## Metrics

| Metric | Session 33 | This Session | Change |
|---|---|---|---|
| Total Figma tool calls | 9 | ~106 | +97 (larger task) |
| Meta/overhead calls | 2 ToolSearch | 7 ToolSearch + 12 Task* | up |
| ToolSearch calls | 2 | 7 (5.2%) | comparable ratio |
| Estimated waste % | ~60% (blocked) | ~25% | task completed |

Waste is dominated by two structural gaps (token-value reading, single-item library search) plus one binding-quirk re-do cycle — not by agent error. The agent's reasoning and recovery were strong throughout.

## Tool Call Distribution

| Tool | Calls | Notes |
|---|---|---|
| `read` | 30 (1 err) | Orientation + post-write verification; mostly justified. 1 err = no file selected (remote onboarding) |
| `search_library_components` | 16 | **One icon glyph per call** — no multi-query batch. ~10 avoidable |
| `edit` | 15 (1 err) | Binding + resize + rebind. 1 err = partial fail (13/24) on un-imported variable ID |
| `write` | 11 | 10 component clones + probe scratch frames |
| `import_library_component` | 11 | **Singular tool used repeatedly** — `import_library_components` (plural, TOOL-012) exists and was not used |
| `run_script` | 7 | Escape hatch: read fontSize/lineHeight values + scope-validated batch binding + verification scans |
| `get_enabled_library_variables` | 6 | Repeated library-variable enumeration |
| `import_library_variable` | 2 | `variableKeys` array — correctly batched (60 then 2) |
| `grep` | 2 (1 err) | 1 err = `find` timed out after 120s on DOCUMENT scope |
| `get_design_system` | 2 | Returned **no local variables** (file binds library variables) — see new issue |
| `screenshot` | 1 (1 err) | Cryptic Zod `invalid_union` (-32602), not a clean "unsupported on remote" |
| `lint` | 1 | Ran but useless — lint only matches local variables |
| `get_local_components`, `use_file` | 1 each | |

## Efficiency Issues

### 1. No way to read a variable's resolved numeric value on remote (saves ~20 calls) — NEW

The single largest source of waste. The task required binding numeric props (fontSize 11/12/13/15, line-height, padding, gap, radius) to **exact-matching** `@wordpress/theme` tokens. To find exact matches the agent needed each token's **numeric value** — but:

- `read` (FSGN) does **not** expose `fontSize`/`lineHeight` numeric values on a node.
- `get_design_system` returned **no local variables** — the file binds *library* (imported) variables, and imported library variables never surface as "local" even after `import_library_variable`.
- The Figma library API returns library *keys*, not values.
- The design-system MCP (`get_design_tokens`) lists token *names* but not numeric values.

**Pattern observed:** The agent built an empirical "probe frame harvesting" workaround (narration [219]–[246]): create 6 scratch frames, bind FLOAT tokens to readable numeric slots (width/height/padding/itemSpacing/cornerRadius), `read` the resolved numbers back, iterate across scope-enforced fields — roughly **9–15 calls of pure workaround** (write 92, edits 93/95/97/99, reads 94/96/98/100, plus get_design_system/get_design_tokens attempts). It only resolved once the agent realized `run_script` could read `fontSize`/`lineHeight` and `boundVariables` directly ([249]).

**Root cause:** `read` omits resolved typography numerics; `get_design_system` can't resolve *library* variable values.

**Proposed fix:** Either (a) include resolved `fontSize`/`lineHeight`/`letterSpacing` numerics in FSGN `read` output, and/or (b) add a `resolve_variable_values` capability (or extend `get_design_system` / `get_enabled_library_variables`) that returns the resolved numeric/color value for imported library variables. Until then, the figma-guidelines skill should tell the agent to reach for `run_script` immediately for value-matching tasks on remote rather than probe-harvesting.

**Estimated savings:** ~20 calls.

### 2. `search_library_components` has no multi-query batch (saves ~10 calls) — NEW

16 calls, each searching for **one** icon glyph (chevron-up, chevron-down, kebab/more, pencil, bell, list, lock, warning, arrowhead, …). Calls 32–43 are 12 back-to-back single-glyph searches; 103/104/107/108 add four more.

**Root cause:** The tool accepts a single query string. There is no array form.

**Proposed fix:** Accept `queries: string[]` (or a comma-separated list) and return grouped results per query in one round-trip. (Sibling to TOOL-013 batch `get_component_variants`.)

**Estimated savings:** ~10 calls → ~2.

### 3. Singular `import_library_component` used 11× instead of the batch tool (saves ~6 calls) — recurrence of TOOL-012

The batch `import_library_components` (plural) exists and is verified (Session 29), but the agent used the **singular** tool 11 times. Several runs were genuinely sequential (import → read nested shape ID → rebind → delete original), but contiguous groups (calls 64–67, 73–78) could have been one batch import each.

**Root cause:** Agent behavior — reached for the singular tool; the prototype-one-then-rest flow masked the batchable groups.

**Proposed fix:** figma-guidelines reminder to prefer `import_library_components` when importing 3+ components; reserve the singular for the prototype-one step.

**Estimated savings:** ~6 calls.

### 4. Repeated `get_enabled_library_variables` enumeration (saves ~3 calls)

6 calls (18, 20, 21, 83, 85, 86) re-enumerating enabled library variables across the discovery and binding phases. The result set is stable within a session and could be cached after the first call.

## Error Analysis

### 1. `screenshot` on remote returns a cryptic Zod `invalid_union` error (1 failure) — NEW BUG

Call 10: `screenshot({nodeId:"2010:73"})` → `MCP error -32602: Invalid tools/call result: [{"code":"invalid_union", … "expected":"text" …}]` (2923 chars of Zod validation noise). The agent correctly inferred "screenshots aren't supported on this remote transport" ([28]) and pivoted to structural work — but the error itself is a schema-validation dump, not a clear "screenshot unsupported on remote transport; use `read` for structure" message.

**Agent recovery:** Excellent — one attempt, correct diagnosis, no retry storm.

**Fix needed:** On the remote transport, `screenshot` should fail fast with a clear, `fail(message, fix)`-style message instead of returning an invalid result that trips MCP schema validation.

### 2. `grep` (`find`) timed out after 120s on DOCUMENT scope (1 failure)

Call 28: `grep({name:"[Ii]con", type:["COMPONENT","COMPONENT_SET"], scope:"DOCUMENT"})` → `Read operation "find" timed out after 120s`. This **was** correctly flagged `is_error: true` (unlike many timeout cases in BUG-008). The agent recovered by narrowing scope / using `read` on known nodes.

**Fix needed:** DOCUMENT-scope `find` is expensive on remote; consider a default page-scope or chunked traversal. (Related to AGENT-007 / find-scope guidance.)

### 3. `edit` partial fail: "Variable not found" on un-imported library variable ID (1 failure)

Call 130: bound `itemSpacing` to `VariableID:…/107:136` across 24 nodes → `success:false, nodesEdited:13, totalNodes:24`, 11 failures: "Variable not found … pass the full VariableID:xxx id". The variable had been **garbage-collected** by Figma because it was imported but never bound earlier (see new BUG below). The agent diagnosed it, re-imported (call 131), and retried (132/133). Correct `is_error:true` + clear fix text — good error UX.

### 4. `read` with no file selected (1 failure)

Call 3: expected remote onboarding error — no file selected before first command. Resolved immediately by `use_file`. Minor.

## New Bug Discovered (not error-flagged): library-variable garbage collection

Imported-but-unbound library variables are **garbage-collected by Figma**, silently dropping later bindings. Narration [323]: the nearest-token snapping pass failed for `gap/md`=12 and `radius/lg`=8 because those tokens were imported but never bound in the earlier exact-match pass, so Figma GC'd them before the snap pass referenced them. The agent re-imported the two dropped tokens ([326]) and retried. **Implication for agents:** import + bind in the same operation, or don't rely on a variable persisting between an import call and a later bind call.

## What Worked Well

1. **`run_script` as the value-reading + scope-validated-binding escape hatch.** Once adopted ([249]), it read `fontSize`/`lineHeight`/`boundVariables` directly, applied 129 exact bindings in one atomic script, and ran every verification scan (raw-vector count, per-field bound/unbound audit, four-corner radius check). Replaced what would have been dozens of individual `edit`/`read` calls.
2. **Disciplined verification.** After each phase the agent re-scanned structurally (zero leftover hand-drawn vectors; 119 vs 129 bound-field reconciliation that caught the cornerRadius single-corner quirk; final 214/214 bound, 0 holdouts).
3. **Validate-on-one-then-batch.** Prototyped the icon swap on one glyph (chevron-up → inspect structure/color → rebind to `neutral-weak` → resize 20×20) before doing the rest — exactly AGENT-011.
4. **Exact-only discipline.** Correctly reported 46 values with no exact theme token rather than pixel-shifting, then snapped only on explicit user follow-up.
5. **Pre-mutation safety check.** Confirmed zero in-file instances of the 10 components before reparenting them out of their wrappers.

## Priority Improvements

### Tool Changes (ranked by call savings)

1. **Expose resolved variable values on remote** (NEW, P1) — include typography numerics in FSGN `read` and/or resolve imported library-variable values via `get_design_system`/`get_enabled_library_variables`. Saves ~20 calls per value-matching task; eliminates probe-frame harvesting.
2. **`search_library_components` multi-query** (NEW, P1) — accept `queries: string[]`, return grouped results. Saves ~10 calls.
3. **`apply`/`edit` cornerRadius → all four corners** (TOOL-015 recurrence, P2) — uniform-radius variable binding lands only on `topLeftRadius`; agent must rebind all four. Confirmed again this session.
4. **`screenshot` clean remote-unsupported error** (NEW, P2) — replace the Zod `invalid_union` dump with a `fail(message, fix)` message.

### Agent Skill Updates

1. **Value-matching on remote → use `run_script` first.** When a task needs resolved numeric token values (exact-match binding), skip `get_design_system`/probe-frame harvesting and read values via `run_script` (`fontSize`/`lineHeight`/`boundVariables`) immediately.
2. **`lint --autoFix` only binds local variables.** When a file binds *library* (imported) variables, lint can't auto-bind — bind manually via `edit({variables})` / `run_script`. Add to figma-guidelines.
3. **Prefer `import_library_components` (plural)** when importing 3+ components.
4. **Import + bind variables together.** Don't rely on an imported-but-unbound library variable persisting to a later bind call — Figma GC's it.
