# Figma MCP Session 48 Analysis

## Session Overview

- **Transcript**: `d0dbcc2f-aff0-4593-833b-3b68a8785144.json`
- **Date**: 2026-08-25, 17:55–18:45 UTC
- **Duration**: 51 minutes
- **Project**: external — `~/Github/site-foundry`, branch `wpds-audit`
- **Transport**: remote (file `07plXV7PsHOrLE3hsIS0jS`, "Site Foundry")
- **Total tool calls**: 192
- **Figmagent tool calls**: 155 (81%)
- **Official Figma MCP calls**: **0**
- **Total errors**: 20 (17 Figmagent, 3 Bash shell-quoting)
- **Reconnections**: 0 (remote transport)
- **Context restarts**: 0
- **Task**: read the Site Foundry plugin source (React build-flow components, SCSS, PHP renderers, reducer) and draw the eight admin-page states as Figma frames using real WPDS/`@wordpress/ui` component instances, then bind everything to design tokens.

**Chronology note**: this session *precedes* the already-analysed session 47 (19:16–19:36 the same day, same file). Session 48 built the eight frames (`5:2`, `5:383`, `5:483`, `5:583`, `5:683`, `5:783`, `8:2`, `8:65`); session 47 later reconciled and renumbered them. Analysis order is not chronological order.

Three results dominate:

- 🔎 **[BUG-016]'s payload-size hypothesis is falsified twice more, independently.** A **784×453** frame failed at `scale: 1`, and a sub-frame failed at `scale: 0.35` while the **largest board in the file** exported cleanly at `scale: 0.28`. `format: "SVG"` also failed — a second confirmation after session 47. Everything here is consistent with the v5 root cause (`remote/client.ts:110–114` returning unparseable text as the result object) and with nothing else.
- ✅ **[BUG-018] is confirmed in a real session for the first time — and it has a zero-code workaround that works today.** `import_library_components` failed 10/10 across two calls with the `set_selection` page-mismatch error, but `write({ type: "INSTANCE", componentKey })` created the same seven components first try. That substitution belongs in the tool description now, ahead of the fix.
- 🆕 **`get_enabled_library_variables` reported 2 collections at 18:04 and 14 at 18:25, same file, same session.** The agent read the 2-collection answer as "this file has no tokens", hardcoded every colour as a raw RGB literal through the entire build, then spent 38 calls and 17 minutes retro-binding ~450 node properties once the real answer appeared. This is the single largest cost in the session and it is not yet tracked.

## Metrics

| Metric | Session 47 | This Session | Change |
|---|---|---|---|
| Total tool calls | 69 | 192 | +178% (much larger scope — full 8-frame build) |
| Figmagent tool calls | 37 (54%) | 155 (81%) | +27pp share |
| Figmagent error rate | 9 / 37 (24.3%) | 17 / 155 (11.0%) | **−13.3pp** |
| ToolSearch calls | 2 (2.9%) | 2 (1.0%) | −1.9pp |
| Estimated waste % | ~16% (11 of 69) | **~16% (30 of 192)** | flat |
| `-32602 invalid_union` protocol crashes | 0 | **0** | **holds (3rd session)** |
| Fell back to the *official* Figma MCP | no | **no** | **holds (3rd session)** |
| Calls lost to `[BUG-016]` family | 10 | **13** | +3 |
| `screenshot` failure rate | 8 / 16 (50%) | **13 / 41 (32%)** | −18pp |
| `run_script` share of Figmagent calls | 22% | **0%** | −22pp — first-class tools only |
| `write` / `edit` calls | 0 / 0 | **30 / 27** | creation surface fully exercised |
| Nodes created | 7 frames | ~250 nodes, 8 frames | — |
| Node properties bound to variables | — | **457** across 10 `edit` calls | — |

Waste breakdown (30 calls): failed `screenshot` 13 (including the batch that returned 0 nodes) ·
dead-end token discovery + re-verification after the library-collection flip 11 ·
failed `import_library_components` ×2 + `set_focus` 1 · rejected 70-node `edit` resent over one
bad enum key 1 · two `lint` calls that scanned 0 nodes 2.

## Tool Call Distribution

| Tool | Calls | Errors | Notes |
|---|---|---|---|
| `mcp__Figmagent__screenshot` | 41 | **13 (32%)** | see Error 1; 28 succeeded — the visual-verification loop still functioned |
| `Bash` | 37 | 3 | reading `src/`, `includes/`, and `node_modules/@wordpress/theme` token CSS; 3 zsh glob/quoting failures, self-corrected |
| `mcp__Figmagent__write` | 30 | 0 | 8 tree builds (up to 54 nodes in one call), 10 `fromNodeId` clones, 12 single inserts |
| `mcp__Figmagent__edit` | 27 | 1 | batches up to **79 nodes**; the one failure was a rejected enum key (Error 4) |
| `mcp__Figmagent__read` | 13 | 0 | 1 multi-`nodeIds` batch; `filter: {types:["FRAME"]}` used twice to trim output |
| `mcp__Figmagent__get_enabled_library_variables` | 13 | 0 | all single-`query` — see Efficiency 2 and Error 3 |
| `mcp__Figmagent__search_library_components` | 12 | 0 | all single-`query`; worst run 6 consecutive — [TOOL-021], 4th recurrence |
| `mcp__Figmagent__import_library_variable` | 4 | 0 | correctly batched (21, 2, 9, 3 keys) — the discovery half is the un-batched half |
| `mcp__Figmagent__get_component_variants` | 3 | 0 | multi-`componentSetNodeIds` used correctly |
| `ToolSearch` | 2 | 0 | both `select:` form |
| `mcp__Figmagent__import_library_components` | 2 | **2 (100%)** | see Error 2 — [BUG-018] |
| `mcp__Figmagent__lint` | 2 | 0 | both scanned **0 nodes** — zero signal all session ([TOOL-024]) |
| `Skill` | 1 | 0 | `figmagent:figma-guidelines` |
| `mcp__Figmagent__use_file` | 1 | 0 | full figma.com URL, worked first try |
| `mcp__Figmagent__get_library_components` | 1 | 0 | REST enumeration of the Automattic Components library |
| `mcp__Figmagent__set_focus` | 1 | **1 (silent)** | see Error 5 — [BUG-024], reported success with `undefined` |
| `mcp__Figmagent__get_design_system` | 1 | 0 | returned `{"styles":{"texts":[]}}` — empty, as expected for a library-only file |
| `mcp__Figmagent__get_library_variables` | 1 | **1** | 403 Forbidden — Enterprise-only REST endpoint, message correctly named the alternative |

## Error Analysis

### 1. [BUG-016] `screenshot` returns no image data — 10th recurrence; payload size falsified twice more (13 failures, ~6 minutes)

Thirteen of forty-one `screenshot` calls failed. Twelve carried the `export.ts:44–46`
guard text blaming the "~4MB return cap"; one was the batch signature.

| # | Call | Node | Result |
|---|---|---|---|
| 66 | `4:2`, `scale: 2` | 800×600 `_scratch` | no image data |
| 70 | `nodeIds: [5 instances]`, `scale: 2` | 5 small instances | `Exported 0 node(s): none` — **no `Errors:`, no `Returned no image data`** |
| 71 | `4:10945`, `scale: 1` | one of those same 5 | ✅ image |
| 74 | `5:3`, `scale: 1` | card inside a 1440×541 board | no image data |
| 75 | `5:3`, `scale: 0.5` | same | no image data — **the recommended remedy failed** |
| 77 | `5:4`, `scale: 1` | **784×453** | no image data |
| 80 | `5:2`, `scale: 0.7` | 1440×541 | no image data |
| 81 | `5:11`, `scale: 1` | step column | no image data |
| 86 | `5:2`, `scale: 1` | 1440×541 | no image data |
| 87 | `5:2`, **`format: "SVG"`** | 1440×541 | no image data — **the verified fallback failed** |
| 88 | `5:11`, `scale: 0.5` | same as #81 | ✅ image |
| 116 | `7:3`, `scale: 0.6` | preflight card stack | no image data |
| 137 | `5:585`, `scale: 0.4` | sub-frame of a 1440×541 board | no image data |
| 139 | `5:591`, **`scale: 0.35`** | sub-frame of the same board | no image data |
| 145 | `5:611`, `scale: 0.45` | sibling of `5:591` | no image data |
| 150 | `8:2`, `scale: 0.28` | **1440×~900 — the largest board in the file** | ✅ image |
| 187 | `5:4`, `scale: 0.5` | same node as #77 | ✅ image |

**Two independent falsifications of payload size, both new:**

1. **`5:4` is 784×453 and failed at `scale: 1`** (#77) — a ~784×453 raster, the smallest
   absolute render yet recorded to fail, and roughly an order of magnitude under the
   4,000,000-char cap the message names. Session 47's smallest was 440×655 at 0.7.
2. **`5:591` failed at `scale: 0.35` while `8:2` succeeded at `scale: 0.28`** (#139 vs #150,
   68 seconds apart) — and `8:2` is the *largest* frame in the file while `5:591` is a
   sub-frame of a smaller one. If payload size were the variable, the ordering would be
   reversed. `7:9` at 0.4 and `5:685` at 0.45 also succeeded, bracketing the 0.35 failure
   on both sides.

**`format: "SVG"` failed again** (#87) — the second independent confirmation after session 47
that the "verified workaround" recorded from session 43 no longer holds. Of the three remedies
the guard text recommends, lower `scale` worked 2/5 (`5:11` 1→0.5, `5:4` 1→0.5 twenty-nine
minutes later) and failed 1/5 outright (`5:3` 1→0.5); SVG failed 1/1; "export a smaller child"
failed on `5:2` → `5:3` → `5:4`, each smaller than the last.

**The batch signature recurs exactly** (#70): `Exported 0 node(s): none` with no `Errors:`
block and no `Returned no image data` block — `allIds`, `ids` and `dataless` all empty at once.
Session 47 #44, session 46 #69 and session 41 (a) are the same. Four seconds later #71
screenshotted one of the same five nodes alone and got a clean image. As the tracker's v5
analysis states, the only mechanism that empties all three lists simultaneously is
`buildBatchExportResult` reading fields off a **string** — the plugin loop always records
every id in `images` or `errors`.

**Verified holding**: the `is_error: true` flag was set on all 13 (session 41's variant of #70
was `is_error: false`), and there were **zero `-32602 invalid_union` protocol crashes** — the
v3 guards continue to work.

**Agent recovery: clean, and unbiased again.** Zero official-Figma-MCP calls across 13 failures
in a project with no corrected memory file — a stronger provocation than session 47's 8. The
agent never retried the same node/scale pair more than once, switched to `read` with
`filter: {types:["FRAME"]}` for structural verification (#78), and screenshotted successively
smaller children until one rendered. Cost 13 calls of 192 (~7%).

**Fix needed**: v5, unchanged and now 10 sessions deep. `remote/client.ts:110–114` must not
return unparseable text as a result object. Additionally — this session is the clearest case
yet that **the guard text actively misleads**: the agent tried all three recommended remedies
and two of them failed, at 0.35 scale, on a 784×453 node. Reword to state what is known ("the
remote transport returned no image data") and gate the `scale`/SVG/child-node advice on the
v4 `payloadChars` scalar.

### 2. [BUG-018] `import_library_components` fails on remote with `set_selection` page-mismatch — first real-session confirmation (10 sub-failures, 2 calls, ~1 minute)

Previously seen only in the 2026-06-19 benchmark. Reproduced here twice:

```
#59  import_library_components({components: [7 items], parentNodeId: "4:2"})
     → {"total":7,"succeeded":0,"failed":7}
       each: "Error: in set_selection: The selection of a page can only include nodes in that page
              at set (<input>:58:11) at R (PLUGIN_3_SOURCE:1:4860)
              Figma Debug UUID: … (atomic: no changes were applied; safe to retry)"
#61  import_library_components({components: [3 items], parentNodeId: "4:2"})
     → {"total":3,"succeeded":0,"failed":3}   — same error, all three
```

`parentNodeId: "4:2"` was a frame the agent had created 14 seconds earlier on the page it was
already targeting, so the "not in that page" claim is false on its face — the remote `use_figma`
VM's `currentPage` is not the page the node lives on.

**The workaround works and costs nothing.** Immediately after, the agent used the `write` tool's
`componentKey` path instead:

```
#62  write({parentId: "4:2", node: {type: "INSTANCE", componentKey: "795658b0…"}})   → ✅ 1 node
#63  write({parentId: "4:2", nodes: [6 × {type: "INSTANCE", componentKey: …}]})      → ✅ 6 nodes
```

Seven of the same components that `import_library_components` could not place, created first
try, in two calls. `write`'s INSTANCE path calls `importComponentByKeyAsync` and appends to the
parent without touching `figma.currentPage.selection` — which is exactly why it survives.

**Fix needed**: (a) **now, zero code**: document `write({type:"INSTANCE", componentKey})` in
`import_library_components`' tool description as the remote-transport route, and in CLAUDE.md's
Libraries note. (b) the tracked fix — drop the `set_selection` step from the remote import path,
or set `currentPage` first. Escalating **P1 → P0**: the benchmark loss is now a real-session
blocker, and it is 100% reproducible on remote.

### 3. `get_enabled_library_variables` reported 2 collections, then 14, 21 minutes apart (~11 calls, ~5 minutes, plus a whole build's colours)

The most expensive error in the session, and it never surfaced as an error.

| Time | Call | Answer |
|---|---|---|
| 18:04:35 | #43 `get_enabled_library_variables({})` | `collectionCount: 2` — Foundations, Themes (Automattic Components) |
| 18:05:10 | #44 `{collectionKey: Foundations, query: "color"}` | `variableCount: 0`, `variables: []` |
| 18:09:09 | #69 `{query: "gray"}` | both collections echoed, both `variables: []` |
| 18:24:53 | #152 `lint` (same API, via `describeEnabledLibraryVariables`) | *"tokens come from **2** enabled library collections (Foundations, Themes)"* |
| **18:25:32** | #153 `get_enabled_library_variables({})` | **`collectionCount: 14`** — adds `@wordpress/theme` Color (257 vars), Typography, Border, Dimension, Motion, and five WPDS (Gutenberg 22.3) collections |

Nothing ran between #152 and #153. The agent's own read of it (18:26:30) was *"importing the
components enabled the real token libraries"* — plausible in mechanism (Figma enables a
library's collections once a file references them) but **inconsistent with the timing**: the
first library instance was created at 18:07:54, seventeen minutes before #152 still answered 2.
The alternative is that the remote `use_figma` VM's `figma.teamLibrary` state is eventually
consistent and under-reports early. This analysis does not pick between them — the observable
fact is that **the same call returned 2 and then 14 for the same file inside one session**, and
`lint` inherited the stale answer because it calls the same API.

**Cost.** Acting on the 2-collection answer, the agent concluded the file had no reachable
tokens and hardcoded every colour in the build as a raw RGB literal — `{r: 0.941, g: 0.941,
b: 0.945}` for surfaces, `{r: 0, g: 0.639, b: 0.165}` for success, and so on across eight
frames and ~250 nodes (calls #72–#151). When the real answer appeared it then spent
**#153–#190 — 38 calls, 17 minutes — re-discovering tokens and retro-binding 457 node
properties** across ten `edit` calls, plus 8 re-verification screenshots. The binding work was
always necessary; the *guessing and replacing* was not, and neither was the second discovery
round.

**Fix needed**: (a) `get_enabled_library_variables` and the `lint` library hint should not
present a collection list as authoritative — when the count is small and the file contains
instances of published library components, say so and suggest re-checking. (b) Agent guidance:
**run token discovery after the first library component is instantiated, not before**, and
re-check `get_enabled_library_variables` before concluding a file has no tokens. (c) Long term,
`write` cannot bind variables at create time at all (see Efficiency 3) — with that, correct
discovery ordering would have made this a one-pass build.

### 4. `edit` rejects `variables: {fontWeight}` with a 10,040-character Zod dump, discarding a 70-node batch (1 call)

```
#176 edit({nodes: [70 ops, several with variables: {fontSize: …, fontWeight: …}]})
  → MCP error -32602: Input validation error: Invalid arguments for tool edit: [
      { "received": "fontWeight", "code": "invalid_enum_value",
        "options": ["fill","stroke","opacity","cornerRadius", … 27 more … ] }, … ]
    (10,040 chars)
```

`fontWeight` is genuinely not bindable — Figma binds weight through `fontStyle` (a STRING
variable), and `apply.ts:21–47` is correct to omit it. Three problems with the failure anyway:

1. **The name collides with a field `edit` does accept.** `apply.ts:93` defines
   `fontWeight: z.number()` as a *direct value*. `fontWeight: 600` is valid;
   `variables: {fontWeight: "VariableID:…"}` is not. Nothing in the schema or the description
   warns about the asymmetry.
2. **10,040 characters for one bad key**, dumping the full 31-option enum plus a repeat per
   offending node. Same shape as [BUG-021]'s raw Zod dump on `grep`.
3. **All 70 operations were rejected** over one key. The agent resent the entire batch at #177
   with `fontWeight` stripped — 70 ops re-serialised to fix one field.

**Fix needed**: name `fontStyle` as the fix in the rejection ("font weight binds through
`fontStyle`, a STRING variable — `fontWeight` is a direct-value field only"), collapse the
repeated enum dump, and note the direct-value/variable-field asymmetry in `edit`'s `variables`
description at `apply.ts:132`.

### 5. [BUG-024] `set_focus` reported success with `undefined` — and the false success cost a retry (1 call)

```
#60  set_focus({nodeId: "4:2"})  →  Focused on node "undefined" (ID: undefined)
```

Second session, and the first with a measurable consequence. The agent called `set_focus`
*specifically* to clear the `set_selection` page-mismatch from #59 — a reasonable hypothesis.
The message read as a completed action, so the agent retried the import at #61, which failed
identically. Had `remote/transport.ts:30–34`'s own note reached the caller ("`set_focus` is a
no-op on the remote transport — headless, no viewport or live selection"), the retry would not
have happened. The correct explanation is written and then discarded by `tools/scan.ts:144–152`.

**Fix needed**: unchanged — return `typedResult.note` when present. Escalating **P2 → P1**: the
confidently-wrong success now has a demonstrated cost, and it compounds [BUG-018].

### 6. `lint` scanned 0 nodes twice — the tool contributed nothing all session ([TOOL-024])

Both `lint` calls passed all eight frame roots and both returned
`totalNodesScanned: 0, totalIssues: 0`, with a `roots` breakdown of eight zeroes. The
routing message is good — it names the library collections and the correct next tools — but
the second call (#188, *after* 457 bindings had been applied) returned the identical zero,
so the agent had no way to verify its own binding work with `lint`. It fell back to
`read(detail: "full")` at #191 instead ([AGENT-024] holding).

The stale-collection-list bug (Error 3) rode along here: #152's message said "2 enabled library
collections", #188's said 14.

**Fix needed**: [TOOL-024] as specified — `lint` should match against *enabled library*
variables, not only local ones. This is the fifth session in which `lint` returns zero on a
library-tokenised file, and the second in which it cannot verify bindings the agent just made.

## Efficiency Issues

### 1. [TOOL-021] `search_library_components` single-query — 4th recurrence (saves ~8 calls)

Twelve calls, all single-`query`. Worst run is **#27–#32, six consecutive** — `Badge`,
`TextControl`, `Button`, `SelectControl`, `RadioControl`, `Notice` — followed by #34–#35,
#38–#40 and #42. Three of those (#38, #39, #40) are exact-variant lookups by full variant
string (`Type=Secondary, Size=Medium, State=Default, Destructive=False`), the pattern CLAUDE.md
already recommends over picking a key off a truncated `get_component_variants` list — correct
behaviour, still un-batchable.

A `queries: string[]` form collapses 12 calls into ~3. Fourth consecutive session; the change
(`tools/libraries.ts`, `query: z.string().or(z.array(z.string()))`) is identical to
[TOOL-026]'s and should ship in one pass.

### 2. [TOOL-026] `get_enabled_library_variables` single-query and empty-collection echo — 5th recurrence (saves ~4 calls)

Thirteen calls, all single-`query`. #157–#161 are **five consecutive** narrowings against the
same collection key (`foreground/content`, `stroke/surface`, `background/track`,
`background/surface/caution`, `background/interactive/brand-strong`), which then fed **one**
batched `import_library_variable` of 21 keys (#162) — the same batched-import /
un-batched-discovery asymmetry as sessions 41, 44, 45, 46.

The empty-collection echo also cost real signal here: #69 (`query: "gray"`) returned both
collections with `"variables":[]` and no indication that the *collection list itself* was
incomplete, which fed directly into Error 3.

### 3. `write` cannot bind variables at create time (saves ~5 calls on a token-first build)

`variables` appears nowhere in `src/figmagent_mcp/tools/create.ts`. Every one of the 457
bindings in this session had to be a separate `edit` pass over nodes `write` had just created —
ten `edit` calls whose entire payload is `{nodeId, variables: {...}}`. `edit` accepts `variables`
per node; `write` accepts every other visual property but not that one.

On a token-first build the natural call is one `write` carrying both structure and bindings.
This is separate from Error 3 — correct discovery ordering removes the *guess-and-replace*, but
the second pass remains mandatory until `write` accepts `variables`.

### 4. Screenshot-driven verification is 27% of all calls

41 `screenshot` calls (21% of the session, 26% of Figmagent calls) against 57 `write`/`edit`
calls — roughly one visual check per 1.4 mutations. This is not waste; it is how the agent
caught the 100px balloon frames (#84 resized four step dots) and the oversized chat frame
(#149). But it is why [BUG-016]'s 32% failure rate hurts disproportionately: the tool the agent
leans on hardest is the one that fails most.

`[TOOL-017]` batch screenshot exists and was used once (#70) — and returned zero nodes.

## What Worked Well

1. **`write` tree-building at scale.** Eight tree creations, the largest producing **54 nodes in
   one call** (#72, the full "Awaiting confirmation" board). Then five `fromNodeId` clones of
   that board (#89–#93) produced the remaining state frames at ~1 second each. Building one
   canonical frame and cloning it is the right shape for a state-variant set, and the tool
   supported it without a single failure across 30 calls.
2. **`edit` batching held all the way up.** 27 calls covering 79, 73, 70, 51, 42, 38, 37, 27 and
   26 nodes. The entire 457-binding retro-fix took ten calls. [AGENT-017] and "batch over
   singles" are fully internalised.
3. **Zero `run_script`.** After sessions 45–47 leaned on it for 22–24% of Figmagent calls
   ([AGENT-025], "run_script monoculture"), this session used first-class tools exclusively —
   including for SVG insertion (#97, #100) and INSTANCE creation from library keys, both of
   which have historically fallen to scripts.
4. **Warnings acted on, not re-read.** #164's `scope_mismatch` warning (binding a
   `[SHAPE_FILL, TEXT_FILL]`-scoped variable to a FRAME fill) was answered at #165–#167 by
   fetching a correctly-scoped `background/surface/success` token — no verification `read` in
   between. #182's warning drove #185 the same way.
5. **The codebase as the token source of truth.** Nine `Bash` calls grepped
   `node_modules/@wordpress/theme/src/prebuilt/css/design-tokens.css` for the literal
   `--wpds-*` numerics ([AGENT-012] / [TOOL-020]'s recommended design-to-code path) rather than
   probe-harvesting through Figma. That is what made the retro-bind pass converge quickly.
6. **Clean failure discipline throughout.** No error was retried more than once with the same
   parameters. `5:3` at scale 1 → 0.5, then abandoned for a sibling. `import_library_components`
   twice, then a different tool entirely. Zero timeout cascades, zero retry storms.

## Priority Improvements

### Tool Changes (ranked by call savings)

1. **[BUG-016] v5 — `remote/client.ts:110–114`** must throw on unparseable response text instead
   of returning the raw string. 10th recurrence, 13 calls here, and the same one line fixes
   [BUG-027]. **Also reword the `export.ts` guard**: this session tried all three of its
   recommended remedies and two failed, on a 784×453 node at scale 0.35.
2. **[BUG-018] — document `write({type:"INSTANCE", componentKey})` in
   `import_library_components`' description today**, then drop `set_selection` from the remote
   import path. Zero-code mitigation available now; escalate to P0.
3. **New — stale library-collection list.** `get_enabled_library_variables` (and `lint`'s hint,
   which shares `describeEnabledLibraryVariables`) must not present a short collection list as
   authoritative on remote. Cost here: 11 calls and an entire build's colours hardcoded.
4. **[TOOL-021] + [TOOL-026] — `queries: string[]`** on both `search_library_components` and
   `get_enabled_library_variables`. 4th and 5th recurrence; identical one-line schema change;
   ~12 calls saved per library-heavy session.
5. **[TOOL-024] — `lint` against enabled library variables.** Two calls, zero nodes, no way to
   verify 457 bindings.
6. **New — `write` should accept `variables`** per node, matching `edit`. Removes the mandatory
   second pass on every token-first build.
7. **[BUG-024] — return the transport's own no-op note from `set_focus`/`set_selections`.**
   Escalate to P1: the false success caused a wasted `import_library_components` retry here.
8. **New — `edit`'s `variables` rejection** should name `fontStyle` as the fix for `fontWeight`,
   collapse the 10K-char enum dump, and document the direct-value/variable-field name asymmetry.

### Agent Skill Updates

1. **Discover library variables *after* instantiating the first library component, and re-check
   before concluding a file has no tokens.** A 2-collection answer early in a remote session can
   become 14 later. Add to CLAUDE.md's design-tokens workflow note.
2. **On remote, reach for `write({type:"INSTANCE", componentKey})` rather than
   `import_library_components`.** Add to the Libraries note and the Remote-first onboarding note.
3. **`fontWeight` is a direct-value field only** — bind font weight through `fontStyle`. Add to
   figma-guidelines alongside the existing variable-binding guidance.
4. **`format: "SVG"` is no longer a reliable `screenshot` fallback.** Sessions 47 and 48 both
   saw it fail. Remove it from CLAUDE.md and the tool description as a *recommended* remedy
   until the v5 fix lands; keep "try a smaller child node", which worked most often here.
