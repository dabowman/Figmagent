# Figma MCP Session 44 Analysis

## Session Overview

- **Transcript**: `ec9d6e90-b68c-41f3-b033-84ed24115476.json`
- **Date**: 2026-08-14, 15:47–18:59 UTC
- **Duration**: 192 minutes
- **Project**: external — `~/Github/vip-workflows`, branch `block-editor-workflow-sidebar-cleanup`
- **Transport**: remote
- **Total tool calls**: 369
- **Figmagent tool calls**: 173 (47% of the session)
- **Official Figma MCP calls**: 31 (`get_screenshot`)
- **Total errors**: 17 (all 17 Figmagent)
- **Reconnections**: 0 (remote transport — no channels)
- **Context restarts**: 1 (17:16 UTC)
- **Task**: recreate the VIP Workflow block-editor sidebar in Figma from `src/editor`,
  then recreate **every modal in the application** on a Modals page, then build an
  alternate "transition rail" sidebar option from an HTML prototype — all against the
  WPDS Gutenberg, `@wordpress/ui` and `@wordpress/icons` published libraries.

This is the largest remote **build** session on record and the first where `run_script`
was the *only* write path used: **119 `run_script` calls, zero `write`, zero `edit`, zero
`lint`, zero `grep`**. That makes it an unusually clean stress test of the escape hatch,
and the escape hatch's own limits — not the first-class tools — became the bottleneck.

## Metrics

| Metric | Session 43 | This Session | Change |
|---|---|---|---|
| Total tool calls | 313 | 369 | +18% |
| Figmagent tool calls | 8 | 173 | +2063% (build vs. read-only) |
| Figmagent error rate | 2 / 8 (25%) | 17 / 173 (9.8%) | −15.2pp |
| ToolSearch calls | — | 6 (1.6%) | low |
| Estimated waste % | ~5% overall | **~27%** (100 of 369) | +22pp |
| Calls lost to `[BUG-016]` | 17 | **62** | +265% (worst on record) |
| Minutes lost to `[BUG-016]` | ~8 | **~16** | +100% |
| Fell back to the *official* Figma MCP | yes (4 calls) | **yes (31 calls, permanent)** | +675% |
| `run_script` share of Figmagent calls | 0% | **69%** | new high |

## Tool Call Distribution

| Tool | Calls | Errors | Notes |
|---|---|---|---|
| `mcp__Figmagent__run_script` | 119 | 13 | 73 `mode:"write"`, 46 read; 237K chars of script total; **64 of them purely diagnostic** |
| `Bash` | 104 | 0 | 30 are `[BUG-016]` fallout (`curl` the official MCP's asset URL) |
| `Read` | 49 | 0 | 31 are `[BUG-016]` fallout (reading the curl'd PNG) |
| `mcp__plugin_figma_figma__get_screenshot` | 31 | 0 | **entirely `[BUG-016]` fallout** — the official Figma MCP |
| `mcp__Figmagent__search_library_components` | 31 | 0 | single-query only; one run of **10 consecutive** icon lookups (`[TOOL-021]`) |
| `mcp__Figmagent__get_enabled_library_variables` | 8 | 0 | 4 single-`query` calls on one collection (`[TOOL-026]`) |
| `ToolSearch` | 6 | 0 | one spent locating the *competing* screenshot tool |
| `mcp__Figmagent__read` | 4 | 1 | abandoned at 16:13; unused for the remaining 2h45m |
| `Edit` | 4 | 0 | memory-file updates |
| `mcp__Figmagent__screenshot` | 3 | **3** | 100% failure → permanent fallback |
| `mcp__Figmagent__get_library_components` | 2 | 0 | |
| `use_file`, `reauthenticate`, `get_design_system`, `import_library_variable`, `set_focus`, `get_component_variants` | 1 each | 0 | |
| `Write`, `AskUserQuestion` | 1 each | 0 | |

Distribution sums to 369. Errors sum to 17.

## Efficiency Issues

### 1. `run_script`'s stdlib bundle eats 62% of the char budget, with no opt-out (saves ~8 calls + unblocks the rest)

`assembleRunScript` (`src/figmagent_mcp/tools/script.ts:71–87`) unconditionally prepends
the `fig.*` stdlib bundle to every script. Measured directly against this repo:

```
stdlib bundle           30,375 chars
SCRIPT_CHAR_BUDGET      49,000 chars
→ usable for user code  18,625 chars (38%)
```

**Pattern observed:** call #41 (16:30:33) — a 19,557-char builder script — was rejected:

> `run_script payload is 50354 chars — over the 49000 char use_figma limit (stdlib bundle + your code combined). Split the script into smaller sequential run_script calls.`

The agent did not split. It said so in its own words —

> *"The script exceeds the payload limit. Let me check whether I can cache the builder
> prelude in the document instead of re-sending it."* … *"`new Function` works — I'll cache
> the builder prelude in the document and reuse it across calls."*

— and built a **document-plugin-data module cache**: helper JS stored via
`figma.root.setSharedPluginData("vipwf", …)`, re-hydrated in every later script with
`new Function("return (()=>{"+p+"})()")()`. Building and maintaining that cache cost 8
dedicated calls (#42 probe, #43 7,445 ch, #44 7,742 ch, #203–#205 re-reads, #210 7,072 ch,
#332 6,148 ch), and **45 of the 119 scripts (38%)** carry the decode preamble.

**Root cause:** the stdlib is paid for whether or not it is used. Measured over all 119
scripts in this session:

| | scripts | share |
|---|---|---|
| reference `fig.*` at all | 21 | 17.6% |
| use only raw `figma.*` | 98 | **82.4%** |

Stdlib functions actually called across the whole session: `fig.prop` ×53, `fig.bindVariable`
×11, `fig.check` ×8, `fig.setCharacters` ×3, `fig.createNode` ×2, `fig.loadFont` ×1. Those
82.4% of scripts each surrendered 30,375 chars — 62% of their budget — for nothing.

**Proposed fix:** make stdlib inclusion conditional. Either an explicit `stdlib: false`
parameter, or auto-detect in `assembleRunScript`:

```ts
const needsStdlib = /(?<![\w$.])fig\./.test(code) || mode === "write"; // mode "write" uses fig.check
const lines = needsStdlib ? [stdlib, ...] : [...];
```

(`mode: "write"`'s `fig.check` postlude needs the bundle, so gate on both — that still
frees the 46 read-mode scripts outright, and a `stdlib: false` opt-out covers write scripts
that skip the check.) Splitting the bundle so `prop`/`setCharacters` ship in a ~2KB core
with `createNode`/`serialize`/`bindVariable` behind the flag would free the write path too.

**Estimated savings:** ~18.6K → ~48.6K usable chars (2.6×). Eliminates the 8-call prelude
scaffold, the 38%-of-scripts decode preamble, and the parse failures in issue 2 below,
which only exist because of the `new Function` workaround.

### 2. Opaque `SyntaxError` from the remote VM triggered a 15-call bisect storm (saves ~15 calls, ~6 min)

**Pattern observed:** calls #45, #49, #52 each failed with the complete error text:

> `Error running script: SyntaxError: expecting '}' Figma Debug UUID: 61e9351e-… (atomic: no changes were applied; safe to retry)`

No line, no column, no source excerpt — unlike *runtime* errors from the same VM, which do
carry positions (`at __userScript (PLUGIN_1_SOURCE:34:25)`). With nothing to go on, the
agent bisected by hand for 15 calls across 16:34:06–16:39:53:

| # | 46 | 47 | 48 | 50 | 51 | 52 | 53 | 54 | 55 | 56 | 57 | 58 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| what | round-trip check | minimal frame | non-ASCII literals | nested literals | spec-only | +rail loop | snippet matrix | line narrowing | differential | minimal nesting | dump source | 6-way matrix |

It never found the cause. Call #59 succeeded only because the agent rewrote the spec by
hand. Cost: 3 failed writes + 12 diagnostics ≈ **15 calls, ~6 minutes, zero knowledge gained**.

**Root cause:** two compounding gaps. (a) Figmagent passes Figma's `SyntaxError` through
verbatim with no fix hint, even though the VM's parser constraints are already known and
documented in this repo's CLAUDE.md (no `?.`, no `??`, no object spread — the last of which
sank PR #38). (b) The failing source was **runtime-generated** inside the plugin-data
prelude workaround from issue 1, so it never passed through Figmagent's own assembly and no
static check could have caught it. Fix issue 1 and this class of failure largely disappears.

**Proposed fix:** when the remote error matches `/SyntaxError/`, append a stated fix naming
the VM's parser constraints and the fact that the assembled script is `stdlib + user code`
(so any reported offset is bundle-relative). Per CLAUDE.md's rule — *no user-facing error
without a stated fix* — a bare `expecting '}'` currently violates the project's own bar.

### 3. Everything ran through `run_script`; `read`/`grep`/`write`/`edit`/`lint` went unused (structural)

Across 192 minutes and 173 Figmagent calls, the first-class surface was touched **8 times**
(4 `read`, 1 each `use_file`/`get_design_system`/`set_focus`/`import_library_variable`).
Every node in the session — three boards, ~30 modals, a component library — was created by
raw `figma.*` script. `read` was abandoned at 16:13:17 and never called again.

Two concrete reasons visible in the transcript, not agent laziness:

- **`read` returned nothing useful twice in a row.** `read()` with no nodeId returned a
  *single* page (`✍️ Editor`, `childCount: 0`) for a file with many pages — a 6th
  recurrence of `[BUG-014]`. `read("2219:624", detail:"structure", depth:2)` on the Sidebar
  PAGE returned `nodeCount: 1` and no children.
- **Library-component internals aren't reachable from `read`.** ~12 diagnostic scripts
  (#100, #102, #122, #180–#183, #206–#209) exist purely to answer "what are this imported
  WPDS instance's nested component-property keys / variant axes / INSTANCE_SWAP targets" —
  e.g. *"Find which nested component property drives the textarea and select value"*.

**Cost:** 64 of 119 scripts were diagnostic rather than build work (54%). Script writes also
forfeit `edit`'s per-op error reporting, boundary pre-checks and post-write assertions —
visible in #271/#272/#276/#308/#311, five build failures (bad variant name, missing
component key, stale node id, unloaded font) that `write`/`edit` pre-checks catch by design.

**Proposed fix:** this is the aggregate symptom of `[BUG-014]`, `[TOOL-020]`, `[TOOL-023]`,
`[TOOL-025]`, `[TOOL-027]` and issue 4 below rather than a single defect — tracked as
`[AGENT-025]` so the ratio is measured session over session, not as a new tool ask.

### 4. `search_library_components` single-query runs, again (saves ~14 calls)

31 calls, all single-query. The worst run is #193–#202: **10 consecutive** icon lookups
against one fileKey (`caution`, `close-small`, `published`, `cancel-circle-filled`,
`calendar`, `external`, `update`, `replace`, `upload`, `lock`). Three more runs of 4, 3 and
3. A `queries: string[]` form would collapse ~20 calls into ~6. Straight recurrence of
`[TOOL-021]`, first seen session 35 — same repo, same library, same shape.

`get_enabled_library_variables` shows the identical pattern at smaller scale: #27–#30 are
four single-`query` calls (`surface`, `content`, `track`, `brand`) against one collection —
`[TOOL-026]`, first seen session 41.

## Error Analysis

### 1. `[BUG-016]` — remote `screenshot` fails, agent permanently defects to the official MCP (3 failures → 62 wasted calls, ~16 min)

**6th recurrence, and by a wide margin the most expensive.** Three consecutive failures:

| # | call | node | scale | result |
|---|---|---|---|---|
| 60 | `screenshot` | `2230:2` (948×2208 board) | 1.5 | `-32602 invalid_union` |
| 61 | `screenshot` | `2230:6` (States row) | 1 | `-32602 invalid_union` |
| 63 | `screenshot` | `2230:19` | 2 | `-32602 invalid_union` |

Full error confirms the root cause recorded in session 41 and refined in 43 — `content[0]`
matches no member of the MCP content union because `data` is `undefined`:

```
"path": ["data"], "message": "Invalid input: expected string, received undefined"
```

which is exactly `tools/export.ts:105–112` emitting `{ type: "image", data: result.imageData }`
with no guard on `imageData`.

**New evidence this session — two hypotheses updated:**

1. **Not flaky, and not `scale`-driven.** Session 43 concluded the trigger was raster
   payload size, with `scale: 4` as the distinguishing variable. Here **`scale: 1` failed**
   (#61). All three failures were large *boards* (948×2208 and its full-width children).
   Payload size remains the best explanation, but it is reached by **node dimensions**, not
   only by `scale` — and the uncapped `exportSingleNode` path (`document.js:626–651`, no
   `EXPORT_MAX_PAYLOAD_CHARS`) still explains every data point.
2. **Failure is deterministic per node, and recovery is now *permanent defection*.** Prior
   sessions retried or diagnosed. Here the agent gave up on Figmagent's `screenshot` after
   3 attempts and spent the remaining **2h20m** on the official Figma MCP:

   ```
   mcp__plugin_figma_figma__get_screenshot   → returns an asset URL
   Bash curl -sL -o <name>.png <url>          → download it
   Read <name>.png                            → actually see it
   ```

   ×31 iterations = **92 calls** where 31 working `screenshot` calls would have done, plus
   a `ToolSearch` (#67) spent locating the competitor. **Net waste: 62 calls (17% of the
   entire session), ~16 minutes.**

**Agent recovery:** correct and fast (3 strikes, then switch) — but it switched *away from
Figmagent*. This is the competitive risk named in the tracker, now realised at full scale:
for visual verification on this file, Figmagent was simply not used.

**Fix needed:** the v3 fix already specified in `[BUG-016]` is unchanged and now clearly P0 —
(0) apply `EXPORT_MAX_PAYLOAD_CHARS` in `exportSingleNode`, (1) guard `result.imageData` and
return a fix-stating text block with `isError: true`, (2) add `isError: true` to the
`export.ts` catch block, (3) treat `ids.length === 0` as a batch error regardless of
`errors`. The guard text must name both remedies (lower `scale`, or `format: "SVG"`).

### 2. `run_script` build failures the first-class tools pre-check (5 failures)

Five `mode: "write"` scripts failed on conditions `write`/`edit` validate before mutating:

| # | error | `write`/`edit` equivalent |
|---|---|---|
| 271 | `no variant {"Type":"Link","Size":"Large",…} in Button` | variant-name validation |
| 272 | `Component set with key "3444…" not found` | import pre-check |
| 276 | `importComponentByKeyAsync: Property "key" failed validation` | schema rejection |
| 308 | `appendChild: The node with id "2273:1788" does not exist` | stale-id boundary check |
| 311 | `set_characters: Cannot write to node with unloaded font "SF Pro Regular"` | automatic font loading |

All five rolled back atomically (correct behaviour, clearly reported), and all five were
fixed on the immediately following call — no retry storms. But #311 is notable: the plugin's
own `setcharacters.js` handles font loading, and `fig.setCharacters` is in the stdlib the
script was already paying 30K chars for. The agent hand-rolled `setText` instead.

### 3. Two clean recurrences of known ID/discovery bugs (2 failures)

- **`[TOOL-022]`** — call #5: `read({ nodeId: "2219-624" })`, the hyphenated form copied
  straight from the Figma URL the user pasted, failed with `Node not found: 2219-624`. The
  agent retried with `2219:624` at #9 and it worked. Exactly the normalisation this entry
  asks for; 4th session showing it.
- **`[BUG-014]`** — call #7: `read()` returned one page with `childCount: 0` for a
  multi-page file. 6th session. This directly caused the `read` abandonment in issue 3.

## What Worked Well

1. **Atomic rollback is doing its job.** All 13 `run_script` failures reported
   `(atomic: no changes were applied; safe to retry)` and none left partial state. Across 73
   write scripts building ~400 nodes, there was no cleanup pass and no orphan hunt — the
   agent's own final QA scripts (#113, #114, #326, #368) found only its deliberate probe
   nodes.
2. **The oversize-payload error stated a real fix and named the cause.** *"50354 chars — over
   the 49000 char use_figma limit (stdlib bundle + your code combined)"* let the agent
   diagnose in one step. The stated remedy ("split into smaller sequential calls") was worse
   than the one it invented, but the diagnosis was immediate.
3. **`fig.check` warnings caught real geometry bugs at write time.** #59 returned two
   skipped-bind warnings naming node, type and variable inline, and later scripts surfaced
   caption clipping and balloon frames without a screenshot round-trip.
4. **Fail-fast discipline held.** 3 strikes on `screenshot` → switch. 2 attempts on each
   build failure → fix. No error repeated more than 3 times, and no timeout cascades.
5. **`search_library_components` found the right variants.** Despite the call volume, every
   WPDS/`@wordpress/ui`/`@wordpress/icons` component resolved correctly — the exact-variant
   discipline from `[AGENT-022]` held across ~25 distinct component lookups.

## Priority Improvements

### Tool Changes (ranked by call savings)

1. **`screenshot` — `[BUG-016]` v3 fix.** Cap `exportSingleNode`, guard `imageData`, flag
   errors correctly. Saves **~62 calls / ~16 min** in a session like this one and stops
   agents defecting to the official MCP. **P0, 6 sessions affected.**
2. **`run_script` — make the stdlib optional.** Auto-detect `fig.` usage or accept
   `stdlib: false`. Frees 30,375 chars (62% of budget) for the 82% of scripts that never
   touch it; removes the plugin-data prelude workaround entirely. **P0, new.**
3. **`search_library_components` / `get_enabled_library_variables` — accept `queries: []`.**
   Saves ~14 calls here, ~10 in session 35. **P1, `[TOOL-021]` 2nd + `[TOOL-026]` 2nd.**
4. **`read` — fix the remote page listing (`[BUG-014]`).** 6th recurrence, and this session
   shows the downstream cost: the agent stopped using `read` entirely 90 seconds in. **P1.**
5. **`read` — normalize hyphenated node IDs (`[TOOL-022]`).** One-line fix, 4th recurrence,
   users paste URL-form IDs constantly. **P2.**

### Agent Skill Updates

1. **When a `run_script` payload is oversized, split it — don't cache a prelude.** The
   plugin-data + `new Function` pattern cost 8 setup calls and caused a 15-call parse-error
   bisect. Add to the `run_script` description: the budget error means *split sequentially*,
   and runtime-generated source forfeits every static check Figmagent performs.
2. **Use `fig.setCharacters` / `fig.createNode` when the stdlib is loaded.** Failure #311
   (unloaded font) is precisely what `fig.setCharacters` exists to prevent, in a script that
   was already carrying it.
3. **Prefer `write`/`edit` for node creation even mid-`run_script` session.** Four of the
   five build failures were conditions the first-class tools reject before mutating.
