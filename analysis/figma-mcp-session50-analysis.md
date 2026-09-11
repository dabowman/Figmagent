# Figma MCP Session 50 Analysis

## Session Overview

- **Transcript**: `8a79f270-5e91-4743-bbb9-8f4bc16864d5.json`
- **Date**: 2026-08-26, 17:00–20:21 UTC
- **Duration**: 201 minutes wall clock — **~70 minutes agent-active**. Four gaps account for the rest: 8 min (#124→#125), 6 min (#147→#148), 19 min (#177→#178, the user hand-editing frame 04 in Figma), 99 min (#229→#230).
- **Project**: external — `~/Github/site-foundry`, branch `wpds-audit`
- **Transport**: remote (file `07plXV7PsHOrLE3hsIS0jS`, "Site Foundry") — **third analysed session on this file**, after sessions 47 and 48
- **Total tool calls**: 261
- **Figmagent tool calls**: 222 (85%)
- **Official Figma MCP calls**: **0**
- **`run_script` calls**: **0**
- **Total errors**: 6 (5 Figmagent `screenshot`, 1 Bash `cd`)
- **Reconnections**: 0 (remote transport)
- **Context restarts**: 0
- **Task**: recreate the full 11-state Build-a-Site flow on an empty Figma page from the React/SCSS shipped on the `wpds-audit` branch, using real WPDS published-library instances and library variables. Delivered 11 state frames plus two local COMPONENT_SETs (`Picker/Blueprint card`, `Form/Site details` with 7 variants) — **502 nodes created across 76 `write` calls, 576 node-ops across 52 `edit` calls, 271 properties bound to library variables**.

Three results dominate:

- 🆕 **`write` cannot clone more than one node per call — `fromNodeId` is *mutually exclusive* with `nodes`.** 30 of the session's 76 `write` calls were clones, and **27 of them sit inside 7 consecutive same-purpose runs** (longest: 6). There is no `count` param and no per-node `fromNodeId` inside `nodes[]`; the schema rejects the combination outright (`create.ts:183`, `:204`). ~20 calls lost.
- 🆕 **`edit` cannot set per-side stroke weight, and the agent named the gap as its reason for deleting work.** At 18:32:58: *"I deleted and re-cloned Attention / Validating / Error from your edited `State=Default` rather than patching them. Your Card.Header has a bottom-only stroke, and the edit API can only set stroke weight on all four sides at once; cloning was the only way."* Three finished variants destroyed and rebuilt to inherit one property.
- 🔎 **[BUG-016] hits 100% — 5 of 5 `screenshot` calls failed, the worst rate on record — and the recovery is new: the human became the render loop.** The agent stopped probing after minute 16 and ran the remaining **191 calls / 3h04m with no visual channel at all**, substituting 28 read-after-write geometry checks, one `set_focus(43:14)` to point the user at the canvas, and a read-back of the user's own hand-edits (*"Read your changes"*, 18:24:32).

## Metrics

| Metric | Session 49 | This Session | Change |
|---|---|---|---|
| Total tool calls | 126 | 261 | +107% (larger scope) |
| Figmagent tool calls | 114 (90%) | 222 (85%) | −5pp share |
| Figmagent error rate | 14 / 114 (12.3%) | **5 / 222 (2.3%)** | **−10pp** |
| ToolSearch calls | 3 (2.4%) | 5 (1.9%) | −0.5pp |
| Estimated waste % | ~29% (36 of 126) | **~18% (47 of 261)** | **−11pp** |
| `-32602 invalid_union` protocol crashes | 0 | **0** | **holds (5th session)** |
| Fell back to the *official* Figma MCP | no | **no** | **holds (5th session, 3rd project)** |
| Calls lost to `[BUG-016]` family | 16 | **5 direct** (+ an unmeasurable verification tax) | — |
| `screenshot` failure rate | 9 / 40 (22.5%) | **5 / 5 (100%)** | **+77.5pp — worst on record** |
| `run_script` share of Figmagent calls | 24.6% (28 calls) | **0%** | −24.6pp |
| `run_script` share of write **operations** | 100% | **0%** (76 `write`, 52 `edit`) | reversed |
| Nodes created | 1260 (via script) | **502** (via `write`) | — |
| Variable bindings | via script | **271** across 16 `edit` calls | — |
| `edit` batching density | n/a | **11.1 node-ops/call** (max 39) | — |

## Tool Call Distribution

| Tool | Calls | Notes |
|---|---|---|
| `write` | 76 | **30 are clones** — 27 of those in 7 consecutive runs ([TOOL-034], new). 502 nodes created; 8 calls used the `nodes[]` array form, 38 the single `node` form |
| `read` | 58 | Largest response consumer (47,622 chars). **28 immediately follow a `write`/`edit`** — geometry standing in for the unavailable screenshot |
| `edit` | 52 | 576 node-ops, avg 11.1, max 39. Well batched. 271 variable bindings, 104 `layoutSizing*` fix-ups, 63 deletes |
| `Bash` | 28 | 1 failed (`cd src` after already being in `src`) — same shape as S49's Bash failure |
| `grep` | 11 | 5 truncated by the extractor; 1 over-budget re-issue |
| `get_enabled_library_variables` | 10 | **8 single-`query` narrowings** — [TOOL-026] 6th recurrence |
| `ToolSearch` | 5 | 1.9% — deferred-tool environment, loading Figmagent tools on demand |
| `screenshot` | 5 | **5 failed (100%)** — [BUG-016] 12th recurrence |
| `AskUserQuestion` | 2 | Both at genuine decision points, both answered |
| `get_local_components` | 2 | Both returned empty (27 chars) — no local Button/Badge existed |
| `import_library_variable` | 2 | Both correctly batched (large `variableKeys` arrays) |
| `component_properties` | 2 | |
| `combine_as_variants` | 2 | Both succeeded |
| `mcp__design-system__*` | 3 | WPDS component lookup (`Text`, `InputControl`, `Field`, `Card`) |
| `Skill` / `use_file` / `set_focus` | 1 each | |
| **Total** | **261** | |

## Efficiency Issues

### 1. `write` cannot clone more than one node per call (saves ~20 calls)

`write`'s schema makes `fromNodeId` **mutually exclusive** with `nodes` — verified in source:

```ts
// src/figmagent_mcp/tools/create.ts:183
"Clone this existing node instead of creating from a spec. … Mutually exclusive with 'nodes'."
// :204
content: [{ type: "text", text: "Error: 'fromNodeId' cannot be combined with 'nodes'." }]
```

There is also no `count`/`repeat` param. So cloning N nodes costs N calls, always.

**Pattern observed** — 7 consecutive clone runs, 27 calls total:

| Calls | Source(s) | Destination(s) | Length |
|---|---|---|---|
| #83–87 | `52:14` (×5) | `39:443` | 5 |
| #155–157 | `71:14` (×3) | `39:443` | 3 |
| #185–187 | `71:14` (×3) | `71:1403` | 3 |
| #195–199 | 5 distinct sources | 5 distinct parents | 5 |
| #208–209 | `78:1385` (×2) | 2 parents | 2 |
| #212–217 | 6 distinct sources | `43:26`, `47:35` | 6 |
| #230–232 | `71:14` (×3) | `71:1403` | 3 |

Both shapes appear: **same source × N** (needs `count`) and **N distinct source→parent pairs** (needs `fromNodeId` inside `nodes[]`). The 5-second cadence between calls in each run (17:28:08 → 17:28:31 for five clones) is pure round-trip cost on the remote FIFO queue.

**Root cause:** `create.ts:197–255` branches on `fromNodeId` *before* the `nodes` array path and returns early; the clone path calls `sendCommandToFigma("clone_node", …)` for exactly one node.

**Proposed fix:** allow `nodes: [{ fromNodeId, parentId?, name?, x?, y? }, …]` (the existing per-clone spec fields), and/or a `count: z.number()` on the single-clone path. The batch loop already exists for the create path (`Promise.all(nodes.map(createOne))` at `:255`) — the clone path needs the same.

**Estimated savings:** 27 calls → 7. ~20 calls (9% of this session's Figmagent calls).

### 2. `edit` has no per-side stroke weight — destroyed and rebuilt 3 finished variants (saves ~5 calls, loses work)

Figma exposes `strokeTopWeight` / `strokeBottomWeight` / `strokeLeftWeight` / `strokeRightWeight` on rect-like nodes. Neither string appears anywhere in `src/` — `edit` exposes only `strokeWeight: z.number()` (`tools/apply.ts:81`), which writes all four sides.

**Pattern observed:** the user hand-edited the `State=Default` variant of `Form/Site details` in Figma during the 18:02→18:21 gap, giving its `Card.Header` a bottom-only stroke. The agent read the change back and stated the gap outright at 18:24:32:

> *"Rebuilding the other three form variants from your edited master so they inherit it exactly (including the header's bottom-only stroke, which I can't set per-side)."*

and again at 18:32:58:

> *"I deleted and re-cloned Attention / Validating / Error from your edited `State=Default` rather than patching them. … cloning was the only way."*

Cost: #184 (`edit` delete ×4) → #185–187 (3 clones) → #188 (`read`) → #189 (`write`) → #190–191 (2 `edit`s re-applying overrides) = **8 calls**, versus ~2 `edit`s if the property were settable. Worse than the call count: three variants that already carried correct overrides were deleted, and every override had to be re-authored.

**Root cause:** same shape as [TOOL-025] (`letterSpacing`/`textCase`/`minWidth`) and [TOOL-027] (`layoutPositioning`/`clipsContent`) — `nodeOpSchema` is missing a direct-value field plus its setter.

**Proposed fix:** add `strokeTopWeight`, `strokeBottomWeight`, `strokeLeftWeight`, `strokeRightWeight` to `nodeOpSchema` in `tools/apply.ts`, plus setters in `apply.js`. Ship in the same pass as [TOOL-025] and [TOOL-027] — one schema, three entries.

**Estimated savings:** ~5 calls, plus the re-authoring of three variants' overrides.

### 3. Height collapse on the first-class `write` path, with the evidence in the response and no warning (saves ~5 calls)

[TOOL-033] recorded the missing `height_collapse` assertion as a `run_script` problem. **This session shows it firing on `write`, where the assertion layer *is* active** — and where the write response itself already contained the proof:

```
#216 18:30:03  write({fromNodeId:"66:786", parentId:"47:35", node:{name:"Brand card/Atlas Studio"}})
  → {"id":"86:1080","name":"Brand card/Atlas Studio","type":"INSTANCE","width":332,"height":32,...}
#217 18:30:09  write({fromNodeId:"66:804", parentId:"47:35", …})
  → {"id":"86:1099","name":"Brand card/Beacon Health","width":332,"height":32,...}
```

`height: 32` against sibling Blueprint cards at 254–286 in the same minute (#212–215), and **no `warnings:` block on either call**. Four `write` responses this session reported `height ≤ 40` (#208, #209, #216, #217); none warned.

**What it cost:** the agent diagnosed it blind — #219 `read(39:443)`, #220 `read(47:22)` (which itself blew its 5,000-char budget and returned nothing usable), #221 `read(47:35)` — before naming it at 18:31:15: *"The picker cards collapsed to 32px — with every card set to stretch, the hug-height row had nothing to size against."* Then #222 `edit`, #223/#224 two more verification `read`s, #225 a second `edit`. **~5 calls of pure diagnosis** for a defect the tool had already measured.

The failure mode is worth naming precisely, because it is not `resize()`-related like [AGENT-028]: **a HUG-height auto-layout row whose children are all set to FILL vertically has nothing to derive its height from and collapses to padding.** `assertions.js` covers the inverse (`balloon frame`, 100px counter-axis default) and `width_collapse`, but not this.

**Proposed fix:** [TOOL-033](a) as written — add `height_collapse` mirroring `width_collapse` in `src/figma_plugin/src/assertions.js`. This session upgrades it from "run_script has no assertions" to "the assertion is missing on the path that *does* run assertions", which makes (a) independently shippable ahead of (b).

**Estimated savings:** ~5 calls per collapse occurrence.

### 4. `get_enabled_library_variables` — 6th consecutive session of un-batched discovery (saves ~7 calls)

10 calls; **8 carry a single `query`**, and #47–#55 are the by-now familiar run of narrowings against the same collection keys (`surface`, `foreground/content`, `interactive/brand`, `track`, `interactive/error`) — all feeding **two** batched `import_library_variable` calls of many keys each. The same batched-import / un-batched-discovery asymmetry recorded in sessions 41, 44, 45, 46, 48.

The empty-collection echo cost real signal again: the first unfiltered call reported **14 collections**, and filtered responses continued to enumerate collections matching nothing.

**Proposed fix:** unchanged — `tools/libraries.ts:611`, `query: z.string().or(z.array(z.string()))`, and omit zero-match collections when a query is supplied.

**Estimated savings:** 10 calls → ~3.

### 5. `write` still cannot bind variables at create time — [TOOL-032] 2nd recurrence

**271 variable bindings landed across 16 `edit` calls, and 11 of those 16 immediately follow a `write`.** The build rhythm is invariably `write` the frame tree → `edit` the same node IDs with `variables`. Examples: #66→#68, #74→#75, #76→#77, #79→#80/#81, #153→#154, #236/#237→#239 (28 nodes bound in one go).

The `edit` half is excellently batched (up to 39 node-ops per call), so the cost is not one call per binding — it is **one extra round trip per `write`**, ~11 calls here. But it also means every newly created node exists briefly in an unbound state, which is exactly when the mini-lint and assertion passes run.

**Proposed fix:** unchanged — accept a `variables` map on `nodeSpecSchema` and apply it in `create.js` after the node is attached.

### 6. Four calls lost to over-tight output budgets — but the discipline is net positive

`read`/`grep` set an explicit `maxOutputChars` **51 times**, across 16 distinct values from 2,000 to 28,000. Only 4 came back over budget (#144, #181, #220, #240), each costing exactly one re-issue at a narrower scope. That is a 92% hit rate on a manually-tuned budget — this belongs under *What Worked Well* as much as here, and no fix is proposed.

## Error Analysis

### 1. [BUG-016] — 12th recurrence, 100% failure rate, and a qualitatively new recovery (5 calls direct, unmeasurable indirect)

All five `screenshot` calls failed, inside the first 16 minutes:

| # | Time | Call | Result |
|---|---|---|---|
| 15 | 17:02:41 | `{nodeIds:["29:18","8:2","5:2","5:483"], scale:0.5}` | `Exported 0 node(s): none` — **no `Errors:`, no `Returned no image data`, no fix text at all** |
| 16 | 17:02:48 | `{nodeId:"5:2"}` | `export.ts:44` "~4MB cap" guard |
| 17 | 17:02:53 | `{nodeId:"5:2", format:"JPG", scale:0.5}` | same |
| 69 | 17:17:09 | `{nodeId:"43:14", scale:0.7}` | same — on a **freshly created 49-node frame** |
| 70 | 17:17:15 | `{nodeId:"43:22", scale:1}` | same |

**Consistent with the v5 root cause and nothing else.** #15 reproduces the batch signature for the **5th time** (after S41, S46 #69, S47 #44, S48 #70, S49 #76/#94): `images`, `errors` *and* `dataless` all empty at once, which only `remote/client.ts:110–114` returning an unparseable string as the result object can produce. `43:14` and `43:22` were built by this session minutes earlier and are ordinary admin-screen frames — no size story explains them at `scale: 0.7` and `scale: 1`.

**A concrete, independently fixable hole this session exposes.** `buildBatchExportResult` (`export.ts:70–105`) emits `OVERSIZED_FIX` only in the `dataless.length > 0` branch. When `images` is empty, `allIds`/`ids`/`dataless` are all empty, so the agent receives **`Exported 0 node(s): none` with `isError: true` and no stated fix** — a direct violation of the project's "no user-facing error without a stated fix" rule, and the reason #16 was a blind single-node retry. This is a 3-line change independent of the v5 transport fix.

**The guard text misled again, in a new direction.** Having been told "re-request at a lower `scale`" by a call it had *already* made at `scale: 0.5`, the agent tried `format: "JPG"` — a remedy the message does not offer — and never tried `format: "SVG"`, the one it does. Sessions 47 and 48 already showed SVG failing, so nothing was lost; but the message steered a fresh agent away from its own recommended fallback.

**Agent recovery — new failure mode: the human became the render loop.** Max 2 attempts per node, no retry storm, **zero official-Figma-MCP calls** — the behavioural fix holds for a 5th consecutive session and a 3rd project. But the agent then abandoned visual verification entirely for **191 calls / 3h04m** and replaced it with:

1. **28 `read`-after-`write` geometry checks** — `read` was the session's largest response consumer at 47,622 chars.
2. **`set_focus(43:14)` at 17:39:38**, followed by an 8-minute gap — pointing the user at the canvas because the agent could not look itself.
3. **Reading the user's hand-edits back off the canvas.** During the 19-minute gap at 18:02→18:21 the user redesigned frame 04 directly in Figma; the agent opened its next turn with *"Read your changes. The pattern is clear: no page header, unconstrained width, and two cards side by side…"* and propagated the pattern to the other ten states.

Sessions 44/45 measured the cost of [BUG-016] as calls defecting to a competitor. This session shows the cost when the agent *doesn't* defect: it is paid in read round-trips and in the user's attention. Neither shows up in the error count — the Figmagent error rate for this session is an excellent 2.3%.

**Fix:** v5 (`remote/client.ts:110–114`) unchanged and still the primary. Add: **(2b) `buildBatchExportResult` must state a fix when `images` is empty**, and **(2c) drop `scale` from the recommended remedies when the caller already supplied `scale <= 0.5`.**

### 2. Bash `cd` into a relative path already entered (1 call)

`#21 cd src && wc -l components/*.tsx …` → `cd:1: no such file or directory: src`, because #19 had already `cd`-ed there. Identical in shape to session 49's Bash failure and session 47's. Harness-level, not Figmagent — noted only because it is now a three-session pattern: **use absolute paths in Bash; the working directory persists between calls.**

## What Worked Well

1. **Zero defection under the heaviest provocation yet.** 100% `screenshot` failure and **0 official-Figma-MCP calls**. Sessions 46–49 established the behavioural fix at 4 sessions / 3 projects; a total-failure session extends it to 5. The readable `is_error: true` text block is doing its job even when its *content* is wrong.
2. **`edit` batching is now excellent.** 576 node-ops across 52 calls — 11.1 per call, peaking at 39. 271 variable bindings landed in 16 calls. The [TOOL-001]/[TOOL-002] batch consolidation continues to pay.
3. **`write` tree creation carried real weight.** 502 nodes across 76 calls including 43 INSTANCE specs against published WPDS components, with `componentProperties` set on 53 node-ops — the [TOOL-019] instance-property work being used exactly as intended.
4. **Output-budget discipline.** 51 explicit `maxOutputChars` values, 92% first-time hit rate.
5. **Two well-placed `AskUserQuestion` calls.** Scope (which of 11 states to build) and a genuine design fork (draw the 04–09 progress card wide, squeezed, or redesigned — the user chose "faithfully squeezed" as a bug artifact for the WPDS audit). Both changed the work materially; neither was a stall.
6. **`run_script` monoculture absent — and the pattern behind it is now visible.** 0 script calls; all writes through first-class tools. Across the three site-foundry sessions the split is task-shaped, not project-shaped: S47 (*reconcile and renumber existing frames*, needing atomic multi-step edits) went 100% script; S48 and S50 (*build new frames from code*) went 0%. [AGENT-025]'s "monoculture" is better read as **`write`/`edit` cover creation well and cover atomic multi-step reconciliation badly.**

## Priority Improvements

### Tool Changes (ranked by call savings)

1. **`write` clone batching** — accept `nodes: [{fromNodeId, parentId, …}]` and/or `count: N`. **~20 calls/session** on any component-set or state-matrix build. New: [TOOL-034].
2. **`get_enabled_library_variables` multi-query** — `query: z.string().or(z.array(z.string()))`, omit zero-match collections. **~7 calls/session**, 6th session overdue. [TOOL-026].
3. **`height_collapse` assertion** in `assertions.js` — **~5 calls per occurrence**, and it fires on the path that already runs assertions. [TOOL-033](a), now independently shippable.
4. **Per-side stroke weight on `edit`** — `strokeTopWeight`/`Bottom`/`Left`/`Right`. **~5 calls**, plus it stops the delete-and-re-clone of finished work. New: [TOOL-034 sibling] → filed as part of the `nodeOpSchema` field-gap family with [TOOL-025]/[TOOL-027].
5. **`write` variable binding at create time** — removes ~11 round trips/session and closes the unbound-at-assertion-time window. [TOOL-032].
6. **`buildBatchExportResult` must state a fix when it exports nothing** — 3 lines, independent of the v5 transport fix, and it is the difference between a blind retry and a diagnosis. [BUG-016] (2b).

### Agent Skill Updates

1. **After a second `screenshot` failure, say so and switch deliberately.** This agent did switch, but silently — the user got `set_focus` with no explanation that visual verification was unavailable. State it once, then verify structurally.
2. **Read the `height`/`width` in a `write` response before moving on.** #216/#217 reported `height: 32` and the agent read past it, then spent 5 calls rediscovering it. Until the assertion lands, the response body is the fastest signal available.
3. **A HUG-height auto-layout row whose children all FILL vertically will collapse.** Belongs in the Figma Design Patterns section of CLAUDE.md alongside the balloon-frame and width-0 rules — same family, opposite direction.
4. **Use absolute paths in Bash.** Third consecutive session losing a call to a repeated relative `cd`.
