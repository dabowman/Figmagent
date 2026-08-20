# Figma MCP Session 45 Analysis

## Session Overview

- **Transcript**: `32ede50a-369c-443a-9961-3ed6b437b245.json`
- **Date**: 2026-08-19, 19:38–20:42 UTC
- **Duration**: 63 minutes
- **Project**: external — `~/Github/vip-workflows`, branch `feedback-noinput-2026-08-18`
- **Transport**: remote (file `uwhEpCvlz26oQeK0rql95G`, 🔀 VIP Workflow i2)
- **Total tool calls**: 183
- **Figmagent tool calls**: 113 (62% of the session)
- **Official Figma MCP calls**: 14 (`get_screenshot` — 100% `[BUG-016]` fallout)
- **Total errors**: 7 (6 returned by Figmagent, 1 harness-side JSON parse)
- **Reconnections**: 0 (remote transport — no channels)
- **Context restarts**: 0
- **Task**: recreate the VIP Workflow **Settings** admin surface in Figma from
  `vip-workflow/src/admin` — a shared-components board (`◆ Settings components`:
  AdminPage.Header, SettingsSection, TabStrip, ToolCard, AgentCard, ChannelCard,
  PromptField, shared states) and a screens board (Settings / Tools / Agents /
  Notifications groups with per-tab cells), built against the WPDS Gutenberg,
  `@wordpress/ui` and `@wordpress/theme` published libraries.

This is the **counterweight to session 44**: same repo, same file, same libraries,
same remote transport — but built with the first-class tools (23 `write`, 20 `edit`,
8 `component_properties` = 349 nodes created, 272 node-edits) instead of a
`run_script` monoculture. `run_script` fell from 69% of Figmagent calls to **28%**,
and the error rate roughly halved. What the session proves is that when the
first-class surface covers the work, agents use it — and that the residual 32
`run_script` calls map almost one-to-one onto already-tracked capability gaps.

It also produces the worst qualitative result yet for `[BUG-016]`: the defection to
the official Figma MCP is no longer a within-session recovery, it is **written into
a persistent memory file** and now fires pre-emptively in every future session on
this repo.

## Metrics

| Metric | Session 44 | This Session | Change |
|---|---|---|---|
| Total tool calls | 369 | 183 | −50% (smaller scope) |
| Figmagent tool calls | 173 (47%) | 113 (62%) | +15pp share |
| Figmagent error rate | 17 / 173 (9.8%) | 6 / 113 (5.3%) | **−4.5pp** |
| ToolSearch calls | 6 (1.6%) | 3 (1.6%) | flat |
| Estimated waste % | ~27% (100 of 369) | **~27%** (49 of 183) | flat |
| Calls lost to `[BUG-016]` | 62 | **24** | −61% (scope-adjusted: 13% of session vs 17%) |
| Minutes lost to `[BUG-016]` | ~16 | ~7 | −56% |
| Fell back to the *official* Figma MCP | yes (31 calls, permanent) | **yes (14 calls, pre-emptive)** | now memory-encoded |
| `run_script` share of Figmagent calls | **69%** | **28%** | −41pp |
| `write`/`edit`/`lint`/`grep` calls | **0** | **43** | first-class surface back in use |
| Nodes created / edited | — | 349 / 272 | — |

Waste breakdown (49 calls): `[BUG-016]` fallback 24 · un-batched
`search_library_components` ~9 · un-batched `get_enabled_library_variables` ~5 ·
`run_script` where `edit` would work ~4 · error retries 7.

## Tool Call Distribution

| Tool | Calls | Errors | Notes |
|---|---|---|---|
| `Bash` | 45 | 0 | 10 are `[BUG-016]` fallout (`curl`/inspect the official MCP's asset URL); rest is codebase reading |
| `mcp__Figmagent__run_script` | 32 | 4 | 15 `mode:"write"`, 17 read; 36,036 chars total. **~20 map onto tracked capability gaps** |
| `mcp__Figmagent__write` | 23 | 2 | 349 nodes created; largest payload 10,098 bytes |
| `mcp__Figmagent__edit` | 20 | 0 | 272 node-edits; batches of 10–32 nodes each |
| `mcp__plugin_figma_figma__get_screenshot` | 14 | 0 | **entirely `[BUG-016]` fallout**; 3 returned unusable 1×1 PNGs |
| `mcp__Figmagent__search_library_components` | 13 | 0 | single-query only; one run of **9 consecutive** (`[TOOL-021]`, 3rd session) |
| `mcp__Figmagent__get_enabled_library_variables` | 8 | 0 | single-query only; one run of **6 consecutive** (`[TOOL-026]`, 3rd session) |
| `mcp__Figmagent__component_properties` | 8 | 0 | 7 consecutive BOOLEAN props bound to target nodes — all succeeded |
| `Read` | 8 | 0 | **all 8 are `[BUG-016]` fallout** (reading the curl'd PNG) |
| `mcp__Figmagent__read` | 4 | 0 | 1 document overview returned a single page (`[BUG-014]`) |
| `ToolSearch` | 3 | 0 | one spent locating the *competing* screenshot tool |
| `mcp__Figmagent__import_library_variable` | 2 | 0 | one call imported **36 keys** — batching working as designed |
| `mcp__Figmagent__use_file` | 1 | 0 | accepted a full Figma URL, resolved and echoed the fileKey |
| `mcp__Figmagent__screenshot` | 1 | **1** | 100% failure → immediate fallback |
| `mcp__Figmagent__set_focus` | 1 | 0 | returned `Focused on node "undefined" (ID: undefined)` — new `[BUG-024]` |

Distribution sums to 183. Errors sum to 7 (6 Figmagent + 1 harness `InputValidationError`).

## Efficiency Issues

### 1. `[BUG-016]` — the defection is now encoded in persistent memory (saves ~24 calls, ~7 min)

Seventh recurrence, and the first where the agent **never intended to use Figmagent's
`screenshot` at all**. Call #2 of the session read
`~/.claude/projects/-Users-davidbowman-Github-vip-workflows/memory/figmagent-remote-transport-workflow.md`,
written at the end of session 44, which states verbatim:

> **Figmagent's `screenshot` tool is broken here** — it fails MCP result validation at any
> scale/size. Use `mcp__plugin_figma_figma__get_screenshot` (fileKey + nodeId) and `curl`
> the returned URL instead.

The agent tried Figmagent once anyway (#84, `screenshot({nodeId:"2323:2", scale:1})`),
got the same `MCP error -32602: Invalid tools/call result … "path": ["type"] … expected
"text"`, spent a `ToolSearch` (#85) loading the competitor, and ran the official MCP for
the remaining 41 minutes.

**Pattern observed:** 1 failed `screenshot` + 1 `ToolSearch` + 14
`mcp__plugin_figma_figma__get_screenshot` + 9 `Bash curl` downloads + 8 `Read` of the
downloaded PNG + 2 calls diagnosing the fallback's own failure (#98 `file t.png`, #99
`set_focus`) = **35 calls to accomplish 11 visual checks**. Eleven working `screenshot`
calls would have returned the images inline.

**The fallback is not even reliable**: three official-MCP calls (#96 `2329:6`, #97 and
#100 `2329:2`) returned **1×1-pixel PNGs** — 149-byte files the agent had to detect with
`file`, then work around by re-screenshotting the parent (#101). That is a further 5
calls of pure fallback-path overhead that a working first-party tool would not incur.

**Root cause:** unchanged and already pinned — `exportSingleNode`
(`src/figma_plugin/src/commands/document.js:626–651`) applies no payload cap, unlike the
batch path which applies `EXPORT_MAX_PAYLOAD_CHARS` (`document.js:609`, `673–711`); the
remote result then lacks `imageData` and `tools/export.ts:105–112` emits
`{type:"image", data: undefined}`, which is neither a valid `text` nor `image` union
member.

**What is new:** the recovery has crossed from *behavior* into *state*. Sessions 34/39/41/43
retried; session 44 defected for the rest of the session; session 45 defected **before
the session started**. Fixing the code no longer suffices — the memory note will keep
routing this repo's agents to the competitor until it is corrected. Escalate to the top
of the queue and, on landing the fix, update that memory file.

**Estimated savings:** ~35 calls → ~11.

### 2. `get_component_variants` can't filter by variant properties — 5 `run_script` calls (saves ~4 calls)

The agent needed exactly one published key per component, selected by variant
properties: `Button` where `Type=Primary, Size=Large, State=Default,
Destructive=False`, and five more combinations. `get_component_variants` returns the
*whole* variant list for a set — which CLAUDE.md itself warns "can truncate under the
output budget and you can grab the wrong variant."

**Pattern observed:** scripts #58, #91, #151 (plus #51 and #93 for the property APIs) are
all the same shape:

```js
const btn = await figma.importComponentSetByKeyAsync("f165991d…");
const v = btn.children.find(c => c.variantProperties.Type === t
       && c.variantProperties.Size === s
       && c.variantProperties.State === st
       && c.variantProperties.Destructive === "False");
out[t+"/"+s+"/"+st] = v ? v.key : null;
```

Three separate calls at 19:53, 20:02 and 20:25 — the agent came back for one more key
each time it started a new component, because there is no way to say "give me the key
for this exact variant combination."

**Root cause:** `get_component_variants` (`tools/libraries.ts`) takes a
`componentSetNodeId` and dumps every variant; it accepts no property filter. The chain
`search_library_components` → `[SET] … Node ID: …` → `get_component_variants` is intact,
but its output granularity is wrong for the common case.

**Proposed fix:** add an optional `variantProperties` filter (e.g.
`{Type:"Primary", Size:"Large"}`) and/or a `variantName` exact-match param, returning
just the matching keys. Sibling to `[TOOL-021]`'s `queries: string[]`.

### 3. Published-component internals still require a scratch frame (saves ~5 calls)

Five `run_script` calls (#52, #53, #54, #55, #93) exist solely to answer *"what are this
WPDS component's nested component-property keys?"* The only way to find out is to
instantiate it and walk the tree:

```js
let scratch = page.children.find(c => c.name === "scratch");
if (!scratch) { scratch = figma.createFrame(); scratch.name = "scratch"; scratch.x = -4000; … }
const inst = pick.createInstance(); scratch.appendChild(inst);
// walk children, collect n.componentProperties keys
```

Two of the five were pure overhead: #52 was rejected by the `mode:"read"` pre-check
(correctly — it calls `createFrame`), and #54 crashed on
`cannot read property 'slice' of undefined` reading `v.value` off a non-TEXT property.
The scratch frame then had to be cleaned up later (#166 deleted three orphan nodes).

This is the same gap session 44 flagged inside `[AGENT-025]` ("imported published-library
component internals aren't reachable from `read`"), now measured on its own: ~5 calls
plus a cleanup call per library-heavy build.

**Proposed fix:** extend `get_component_variants` (or add a
`get_component_property_definitions`) to return `componentPropertyDefinitions` — including
nested instance property keys — for a published key, without requiring instantiation.

### 4. `run_script` used for work `edit` fully supports (saves ~4 calls)

Script #164 sets nine properties on one node:

```js
sets.layoutMode = "HORIZONTAL"; sets.layoutWrap = "WRAP";
sets.counterAxisAlignItems = "MIN"; sets.itemSpacing = 64;
sets.counterAxisSpacing = 96; sets.layoutSizingHorizontal = "FIXED";
sets.resize(2024, sets.height); sets.layoutSizingVertical = "HUG";
sets.clipsContent = false;
```

**Every one of those is already a field on `edit`** — `layoutWrap` (`tools/apply.ts:115`),
`counterAxisSpacing` (`:125`), `counterAxisAlignItems` (`:121`), `layoutSizingHorizontal`
(`:122`), `width` (`:88`), `clipsContent` (`:84`). Scripts #18, #21 and #29 similarly set
`clipsContent`/`itemSpacing`/`fills` by hand as part of larger builds.

The cost is not only the call — script writes forfeit `edit`'s boundary pre-checks. Script
#153 died on `FILL can only be set on children of auto-layout frames`, exactly the class
of mistake `[TOOL-016]`'s pre-check rejects before mutating; the retry (#154) cost a full
4,721-char round trip.

**Proposed fix:** agent-behavior. When a script's body is pure property assignment on
existing nodes, use `edit`. Worth stating in `figma-guidelines` alongside the existing
"batch over singles" guidance, since `[TOOL-027]`'s `clipsContent` half has *already
shipped* and the agent didn't know.

### 5. `[TOOL-021]` / `[TOOL-026]` — third consecutive session of un-batched discovery (saves ~14 calls)

- `search_library_components`: **13 calls, all single-query**. Calls #23–#31 are **9
  consecutive** lookups (`Tabs`, `Toggle`, `Checkbox`, `Radio`, `Select`, `Button`,
  `Notice`, `TextareaControl`, `Card`), then #33/#34 (`Badge`, `Breadcrumbs`), #73
  (`Spinner`), #92 (`TextControl`). A `queries: string[]` form collapses these to ~4.
- `get_enabled_library_variables`: **8 calls, all single-query**. Calls #37–#42 are **6
  consecutive** — three whole-collection dumps (`Dimension`, `Typography`, `Border`) then
  three `query` narrowings against the *same* Color collection key
  (`surface/neutral`, `fg/content`, `content`). Two more later (#75, #80). Collapses to ~3.

Both discovery halves then fed a **single batched** `import_library_variable` call
(#46, 36 keys). Third session running with the same asymmetry — batched import, un-batched
discovery.

### 6. `[BUG-014]` — remote document overview still lists one page (saves ~3 calls)

`read({})` (#10) returned:

```json
{"name":"✍️ Editor","id":"116:38565","children":[],
 "currentPage":{"id":"116:38565","childCount":0},
 "pages":[{"id":"116:38565","name":"✍️ Editor","childCount":0}]}
```

One page, no children — for a file that script #14 immediately enumerated at **20,361
characters of pages**. Orientation cost three `run_script` calls (#8, #12, #14), one of
which failed. Seventh recurrence.

Sub-finding worth documenting: #12 failed with
`in loadAllPagesAsync: "loadAllPagesAsync" is not a supported API` — the remote
`use_figma` VM does not expose `figma.loadAllPagesAsync()`; the working form is a loop of
`await page.loadAsync()` (#14). That constraint belongs in the `run_script` tool
description next to the existing `?.` / `??` / object-spread notes.

## Error Analysis

### 1. `screenshot` → `-32602 invalid_union` (1 failure, ~7 minutes lost)

Covered in full above. `[BUG-016]`, 7th recurrence, memory-encoded.

### 2. `write` rejected a variant key it had just harvested (1 failure, ~1 minute)

Call #102 passed `componentKey: "d09fc85b3553df47f1061ebe97e890e7eeced48d"` and got:

```
Error creating node(s): Error: Component with key "d09fc85b…" not found
    at <anonymous> (<input>:1:22)
Figma Debug UUID: 7b35acd5-… (atomic: no changes were applied; safe to retry)
```

**That key was not invented.** It came from the agent's own script #58, 13 minutes
earlier, as `Tab.selected.key` — read off `importComponentSetByKeyAsync(setKey).children[]`
in the same file and session. Button variant keys harvested by the identical mechanism
imported fine (#94, #103).

**Root cause:** `src/figma_plugin/src/commands/create.js:161` calls
`await figma.importComponentByKeyAsync(spec.componentKey)` **bare** — no try/catch, no
`fail(message, fix)`. Every other branch in that same `INSTANCE` block uses `fail()` with
a stated fix (`:149`, `:154`, `:164`). Figma's raw message propagates unmodified, so the
agent gets no guidance on the actual distinction (a variant of a published set is not
necessarily independently importable by key). This violates the project's
no-user-facing-error-without-a-fix rule.

**Agent recovery:** clean. One retry (#103) with the Tab instance dropped, 37 nodes
created, moved on. The `atomic: no changes were applied` note did its job.

**Fix needed:** wrap `create.js:161` in `fail("Component with key \"…\" not found",
"verify the key with search_library_components, or — if this is one variant of a
COMPONENT_SET — import the set and instantiate the variant, since set members aren't
always independently importable")`.

### 3. `run_script` `mode:"read"` rejection is reported as success (1 silent failure)

Call #52 returned `This script calls createFrame but mode is 'read'; rerun with mode:
'write'.` with **`is_error: false`**. The pre-check itself is good — it caught a real
mistake and stated the fix — but `tools/script.ts:147–155` returns the rejection without
`isError: true`, and the text doesn't match `ERROR_TEXT_PREFIX`
(`instance.ts:84–85`, which anchors on `Error[:\s]|Failed to|Could not|Unable to|…`).
A call that never executed is logged as a success. Same class as `[BUG-008]`; one-line fix.

### 4. `set_focus` reports success with undefined fields (1 silent failure)

Call #99 returned `Focused on node "undefined" (ID: undefined)`.

**Root cause, pinned:** `remote/transport.ts:30–34` short-circuits `set_focus` and
`set_selections` on the remote transport and returns `{success: true, note: "<cmd> is a
no-op on the remote transport (headless — no viewport or live selection)."}`. The MCP
handler at `tools/scan.ts:144–152` then formats
`` `Focused on node "${typedResult.name}" (ID: ${typedResult.id})` `` — fields the
short-circuit never sets. The correct, already-written explanation (`note`) is discarded
and replaced with a confident-looking string containing two `undefined`s.

The agent had called `set_focus` trying to fix the official MCP's 1×1 PNGs; the message
told it nothing, and the next screenshot (#100) was 1×1 again.

### 5. Three self-inflicted `run_script` failures (3 failures, ~3 minutes)

- #12 `loadAllPagesAsync is not a supported API` — VM constraint, undocumented (see §6 above).
- #54 `TypeError: cannot read property 'slice' of undefined` — the dump helper called
  `.slice()` on `v.value` for a non-TEXT component property. Fixed in #55 by
  `String(v.value).slice(...)`.
- #123 `in get_children: The node with id "2335:34547" does not exist` — a recursive
  `walk` that mutated `visible` while iterating; rewritten in #124 to collect first, then
  mutate. Both are ordinary script bugs, and both are the kind of thing `edit`'s
  per-op error reporting would have localized instead of aborting the whole script.

### 6. `write` payload failed JSON parsing at 5,948 bytes (1 harness failure)

Call #112 returned `InputValidationError: mcp__Figmagent__write was called with input
that could not be parsed as JSON` on a 5,948-byte `write` tree (the `group / Settings`
frame with long description strings). Retried successfully at #113. Harness-side, not
Figmagent — but a data point for keeping inline `write` trees moderate: the session's
largest successful payload was 10,098 bytes, so this is not a hard size limit, and the
message's "unescaped control characters" hypothesis is the likely cause given the
em-dashes and typographic quotes in the description text.

## What Worked Well

1. **Batch discipline throughout the build.** 23 `write` calls created **349 nodes**
   (8–37 per call, whole captioned cells with nested COMPONENTs and library INSTANCEs in
   one shot); 20 `edit` calls applied **272 node-edits** (10–32 nodes per call, mostly
   variable bindings). There is not a single one-node-at-a-time run in the session. This
   is the pattern `[TOOL-001]`/`[TOOL-002]`/`[TOOL-010]` were built for, working exactly
   as intended.

2. **`component_properties` batching.** Calls #115–#121 are seven consecutive BOOLEAN
   property definitions, each auto-bound to a target child node (`Actions`, `Description`,
   `Tab 3`, `Requirements notice`, `Provides`, `Setup badge`, `Reset`). All seven
   succeeded first try and returned the suffixed property key (`Actions#2335:0`) the agent
   needed for the later `edit({componentProperties})` at #181. Zero rework.

3. **Scope-mismatch warnings named the fix and were acted on.** Call #79's response
   carried two `[scope_mismatch]` warnings — `wpds-color/stroke/surface/neutral` has
   `scopes [STROKE_COLOR]` refused for a `fill` on a TEXT node, "Fix: bind a variable
   scoped for this field, or widen the variable's scopes with `update_variables`". The
   agent deleted the offending divider (#81) and rebuilt with a background-scoped token
   instead of re-reading to diagnose. `[AGENT-019]`'s guidance landing in practice.

4. **Atomic-write messaging prevented a cleanup pass.** The `write` failure at #102
   returned `(atomic: no changes were applied; safe to retry)`; the agent retried once
   without first inspecting for partial nodes.

5. **`use_file` took a raw Figma URL.** Call #5 passed the full
   `https://www.figma.com/design/uwhEpCvlz26oQeK0rql95G/…` URL as `channel` and got back
   `Now targeting Figma file uwhEpCvlz26oQeK0rql95G on the remote transport` — resolved
   and echoed. `[BUG-020]`'s failure mode did not recur.

6. **One batched `import_library_variable` for 36 keys** (#46). The import half of the
   token workflow is doing exactly what `[TOOL-026]` wants the discovery half to do.

7. **Fail-fast on the known-broken tool.** One `screenshot` attempt, not three. Session 44
   spent three strikes reaching the same conclusion; memory carried it forward. The
   mechanism is working — it is the *content* of what got memorized that is the problem.

## Priority Improvements

### Tool Changes (ranked by call savings)

1. **`screenshot` / `export.ts` + `document.js` — `[BUG-016]` v3 fix.** Apply
   `EXPORT_MAX_PAYLOAD_CHARS` in `exportSingleNode`; guard `result.imageData` and return a
   fix-stating `isError: true` text block naming both remedies (lower `scale`,
   `format:"SVG"`); add `isError: true` to the catch block; treat batch `ids.length === 0`
   as an error. Saves ~24 calls/session here, 62 in session 44. **On landing, update
   `~/.claude/projects/…-vip-workflows/memory/figmagent-remote-transport-workflow.md`** —
   the code fix alone will not undo the encoded defection.

2. **`search_library_components` + `get_enabled_library_variables` — accept `queries: []`.**
   `[TOOL-021]` (3rd session) and `[TOOL-026]` (3rd session), identical one-line schema
   change in each. Saves ~14 calls/session.

3. **`get_component_variants` — variant-property filter.** Return just the keys matching
   `{Type:"Primary", Size:"Large", …}` instead of the truncation-prone full list, and
   surface `componentPropertyDefinitions` (including nested instance property keys) so the
   scratch-frame instantiation dance disappears. Saves ~9 calls/session on
   library-composed builds.

4. **`create.js:161` — wrap `importComponentByKeyAsync` in `fail(message, fix)`.** The
   only branch in that block without a stated fix. Saves ~1 call, closes a
   no-error-without-a-fix hole.

5. **`scan.ts:144–152` — surface the remote no-op `note` for `set_focus`/`set_selections`**
   instead of formatting `name`/`id` the short-circuit never sets. Removes a
   confidently-wrong success message.

6. **`script.ts:147–155` — add `isError: true` to the mode-mismatch rejection.** One line;
   same class as `[BUG-008]`.

7. **`edit` — add `textDecoration` and `visible` as direct-value fields.** Script #32 set
   `textDecoration = "UNDERLINE"`; scripts #123/#124 set `visible = false` on instance
   sub-nodes. Fold into `[TOOL-025]`'s pending field additions.

### Agent Skill Updates

1. **Prefer `edit` over `run_script` for pure property assignment.** `layoutWrap`,
   `counterAxisSpacing`, `counterAxisAlignItems`, `clipsContent`, `layoutSizing*` and
   `width` are all already `edit` fields — `[TOOL-027]`'s `clipsContent` half has shipped.
   Script writes forfeit boundary pre-checks (script #153 died on exactly the FILL error
   `edit` rejects pre-mutation).

2. **Document the remote VM's `loadAllPagesAsync` gap** in the `run_script` description,
   beside the existing `?.` / `??` / object-spread constraints: enumerate pages with a
   loop of `await page.loadAsync()`.

3. **When a memory note says a Figmagent tool is broken, re-verify once and record the
   date.** The note that drove this session's pre-emptive defection carried no expiry;
   a stale "broken" note outlives the bug it describes.
