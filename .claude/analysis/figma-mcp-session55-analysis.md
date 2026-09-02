# Figma MCP Session 55 Analysis

## Session Overview

- **Transcript**: `.claude/sessions-json/fa71c504-323e-4872-8072-d7e827b074b5.json`
- **Duration**: 29 minutes wall clock (2026-09-01 22:59 → 23:28 UTC); one 8.4-minute idle gap before call #91 → **~20 minutes active**
- **Total tool calls**: 92 (79 Figmagent, 10 Bash, 3 ToolSearch)
- **Total errors**: 16 hard (`is_error: true`) — 15 Figmagent, 1 Bash; **0 unflagged soft failures**
- **Reconnections**: 0 (1 `use_file`)
- **Context restarts**: 0
- **Transport**: remote — Figma file `C4zLeQJs8qkAhFSLwMKP9J` ("Archer")
- **Project**: external `~/Github/storybook`, branch `main` — **third analysed session on this project/file**, and it **overlaps session 54 by 20 minutes** (S54 ran 22:54 → 23:19, S55 started 22:59). Two Claude Code sessions, two MCP server processes, one Figma file, both writing.
- **Task**: mirror the Storybook `Autocomplete` component (Base UI + `Autocomplete.scss` + `config/component.tokens.json`) into the Archer file — an 8-variant `Autocomplete Input` COMPONENT_SET (`State` × `Filled`), a 3-variant `Autocomplete Item` set, a 3-variant `Autocomplete Popup` set built from Item instances, and a composite `Autocomplete` COMPONENT, all bound to `autocomplete/*` and semantic variables, then annotated and linted.

The session **completed its task**: 4 component sets, 14 variants, ~70 nodes, 6 component properties defined and bound, all colour/radius/spacing/type bound to variables, 18 annotations written across two passes. Two design decisions were made deliberately and documented on the canvas (literal disabled opacity; split Placeholder/Value layers).

The headline finding is not in the build. It is a **clean single-variable control that discriminates [BUG-016]** — 17 sessions in, and this is the first time the failing variable has been isolated by changing one property on one node.

## Metrics

| Metric | Session 53 | Session 54 | This Session | Change vs S54 |
|---|---|---|---|---|
| Total tool calls | 86 | 73 | 92 | +26% (larger task) |
| Figma tool calls | 65 | 53 | 79 | +49% |
| Official-MCP calls | 0 | 0 | **0** | held (**9th consecutive**) |
| Hard errors | 21 | 9 | 16 | +7 |
| Figma error rate | 32.3% | 17.0% | **19.0%** (15 of 79) | +2.0pp |
| Unflagged soft failures | 4 | 2 | **0** | **−2** |
| `run_script` share of Figma calls | 44.6% | 54.7% | **29.1%** (23 of 79) | **−25.6pp** |
| `run_script` share of write ops | 100% | 74% | **46.3%** (19 of 41) | **−27.7pp** |
| `screenshot` failure rate | 46.7% | 37.5% | 44.4% (8 of 18) | +6.9pp |
| ToolSearch | 4 (4.7%) | 2 (2.7%) | 3 (3.3%) | +0.6pp |
| Estimated waste % | ~36% | ~34% | **~35%** (32 of 92) | +1pp |

Waste composition (32 calls): 16 hard errors · 12 recovery/diagnosis calls they caused (#19, #23, #25, #39, #40, #45, #56, #63, #66, #67, #68, #77) · 2 lint/re-stack retries (#82, plus #59) · 2 rework passes (#60, #85).

The `run_script` share nearly halved against the two sessions that ran hours earlier on the same file. This is the strongest reversal of [AGENT-025] in three sessions, and it happened without any tooling change — the same agent, same file, same day. See "What Worked Well".

## Tool Call Distribution

| Tool | Calls | Errors | Notes |
|---|---|---|---|
| `run_script` | 23 | 3 | 29.1% of Figma calls; 19 in `mode: "write"`. 11 of 19 were forced by a named tool gap |
| `screenshot` | 18 | 8 | [BUG-016] 17th recurrence — **and the first isolated discriminator** |
| `edit` | 10 | 3 | failures are [BUG-032], [BUG-030]/[TOOL-037], and [BUG-033] via `setProperties` |
| Bash | 10 | 1 | source reading (`Autocomplete.tsx/.scss/.stories.tsx`, token JSON) + memory writes |
| `read` | 8 | 0 | orientation + one ID-discovery read forced by [TOOL-040] |
| `component_properties` | 4 | 0 | 6 properties defined and bound across 2 sets — clean |
| `write` | 3 | 1 | **32 nodes / 8 COMPONENT roots in a single call** (#30); the failure is [BUG-033] |
| `combine_as_variants` | 3 | 0 | 3, 8 and 3 variants — all first try |
| ToolSearch | 3 | 0 | one 11-tool opening slice, two top-ups |
| `get_design_system` | 3 | 0 | one broad regex, two narrowing follow-ups |
| `lint` | 2 | 0 | first call lost to the output budget (see issue 5) |
| `set_multiple_annotations` | 2 | 0 | 10/10 then 8/8 applied |
| `use_file` / `get_local_components` / `grep` | 1 each | 0 | |

## Efficiency Issues

### 1. `fig.createNode` returns the create *response*, not the node — 3 calls and a silent skip of `fig.check` (saves ~3 calls)

The single most expensive contract gap in the session, and it fired three separate ways.

`src/figma_plugin/src/remote_entries/stdlib.js:59` defines `createNode: (spec, parentId) => create({ tree: spec, parentId })`. `create()` returns `{ success, totalNodesCreated, tree: { id, name, type, children } }` (`src/figma_plugin/src/commands/create.js:459-464`) — so the returned value has **no `id` and no `children`**. The `run_script` description (`src/figmagent_mcp/tools/script.ts:154`) documents it as "the full write tree builder" and states no return shape, while documenting the return of `fig.loadFont`, `fig.bindVariable` and `fig.check` on the adjacent lines.

**Failure 1 — silent null IDs, call #40.** The script built three popup variants and walked the results:

```js
const n = await fig.createNode(s, '3:679');
roots.push(walk(n));                       // walk reads n.id / n.children
...
return { nodeIds: roots.map(r => r.id), roots };
```

Response: `{"nodeIds": [null, null, null], "roots": [{"children": []}, {"children": []}, {"children": []}]}` — `is_error: false`. The nodes *were* created. But the write-mode postlude (`script.ts:129`) then ran `fig.check([null, null, null])` inside a `try {} catch (_e) {}`, so **no post-write assertion ran and nothing said so**. The agent then had to spend call #41 (`read(3:679, structure, depth: 3)`, 57 nodes) purely to discover the IDs of what it had just created, and call #42 to delete an orphan (`27:11`) the read surfaced.

**Failure 2 — hard crash, call #55.** The same assumption inside a larger atomic script:

```js
const composite = await fig.createNode({...}, '3:679');
const root = await figma.getNodeByIdAsync(typeof composite === 'string' ? composite : composite.id);
const inputInst = root.children[0];   // TypeError: cannot read property 'children' of null
```

`composite.id` is `undefined` → `getNodeByIdAsync(undefined)` → `null`. The whole atomic write rolled back; call #56 was a full re-send.

**Failure 3 — the agent reverse-engineered the shape.** Call #56 defensively added `createdShape: Object.keys(created)` to its return, which came back `["success", "totalNodesCreated", "tree"]`. The agent had to discover the contract by dumping it at runtime.

**Root cause:** an undocumented return shape on the one stdlib helper whose result an agent always needs to chain from.

**Proposed fix:** return the created node's `tree` object (`{ id, name, type, children }`) from `fig.createNode` — that is what the call site naturally expects and it makes `walk()`-shaped code work. Separately, have the write-mode postlude say something when `__result.nodeIds` contains `null`/`undefined` entries instead of swallowing it: a returned id list that is all nulls is never intentional.

**Estimated savings:** ~3 calls per script-heavy session, plus it restores post-write assertions that are currently skipped in silence.

### 2. Eleven of nineteen write scripts were forced by a named tool gap (saves ~11 calls)

`run_script` share dropped sharply this session, but what remains is almost entirely involuntary. Classifying the 19 `mode: "write"` scripts by whether a first-class tool could have done the job:

| Forced by | Calls | Gap |
|---|---|---|
| `fontWeight` variable binding | #25, #32 | [TOOL-037] — `edit`'s `variables` enum omits `fontWeight` |
| `effects` (variable-bound drop shadow) | #46, #63, #68, #73 | [TOOL-039] — `edit` can apply `effectStyleId` but cannot set `effects` |
| Font swap around a write | #40, #45, #85 | [BUG-033] — the VM has no `PP Neue Montreal` |
| Component `description` | #80 | **new** — no tool sets a node/component description |
| Annotation removal | #91 | **new** — `labelMarkdown` is required, so annotations can only be written, never cleared |
| `strokeAlign` | (inside #25, #32) | **new** — `edit` has no `strokeAlign` field |
| Genuinely script-shaped | #55/#56, #57, #59, #60, #77 | sequential layout computed from measured heights; multi-step property surgery |

Only 5 of 19 are genuinely script-shaped work (loops that read a value and compute the next write). Everything else is a missing field or a missing verb.

**Proposed fix:** close the three small ones together — `strokeAlign` and `description` as direct-value fields on `edit`, and an explicit delete path for annotations. All three are additive and low-risk; each currently costs a full `run_script` round trip and forfeits the pre-checks, warnings and mini-lint that first-class writes carry.

### 3. `screenshot`'s batch total-failure message carries no fix (saves ~2 calls)

Calls #49 (`nodeIds: ["24:86","24:45","27:68"]`) and #52 (`nodeIds: ["27:17","27:26","27:41"]`) both returned exactly:

```
Exported 0 node(s): none
```

`is_error: true`, and nothing else — no `Errors:` block, no `Returned no image data (…)` line, no `Truncated:` line, **no stated fix**. In `buildBatchExportResult` (`src/figmagent_mcp/tools/export.ts:74-110`) that is the path where `result.images` is `{}`: `allIds`, `ids` and `dataless` are all empty at once, so every fix-bearing branch is skipped and only the header line survives. This is the sixth distinct input path to reach it (S41, S46, S47, S48, S49, and now S55).

Two of the three nodes in #49 (`24:86`, `24:45`) screenshotted cleanly on their own four seconds later (#50) and two minutes later (#66) — so the batch did not fail because its members were unexportable. It failed as a unit.

**Effect on the agent:** it abandoned batch screenshots permanently after #52 and issued **14 consecutive single-node calls** for the rest of the session. A batch tool that fails without saying why trains the agent out of using it.

**Proposed fix:** in the `ids.length === 0 && dataless.length === 0` case, say so and state a fix (re-request the nodes singly — that path routinely succeeds on the same IDs). The project rule is "no user-facing error without a stated fix"; this is an error with no text at all.

### 4. An `opacity` variable binding renders the node at 1/100 of its value (saves ~4 calls, prevents silent visual corruption)

`edit`'s `variables` map accepts `opacity`, so this fires through the first-class tool, not only through `run_script`.

**Pattern observed.** Call #21 bound `opacity` on the `State=Disabled` item variant to `VariableID:2:492`. Sixteen calls later the variant was visually gone. Call #71 measured it in the VM:

```json
{ "opacity": 0.004000000189989805,
  "bound": "{… \"opacity\": {\"type\":\"VARIABLE_ALIAS\",\"id\":\"VariableID:2:492\"} …}" }
```

Call #72 read the variable's own value: `{"2:2": 0.4000000059604645}`. **The variable holds 0.4; the resolved node opacity is 0.004.** Figma resolves a FLOAT variable bound to `opacity` on a 0–100 percentage scale, so a token authored on the CSS 0–1 scale — which is what every design-token pipeline emits — renders the node at 0.4% and effectively invisible.

Nothing warned. `edit` accepted the binding, the write response carried no warning, and `lint` (#81/#82) does not check it. The agent found it only because it screenshotted the variant (#70) and saw nothing.

**Root cause:** a unit-scale mismatch between the DTCG/CSS convention and Figma's opacity binding, with no guard at any layer. The agent's own note in call #73 states it exactly: *"Figma reads opacity variables as 0-100; the pipeline emits 0-1, so 0.4 binds as 0.4%."*

**Proposed fix:** add a post-write assertion — after an `opacity` variable bind, if the node's resolved `opacity` is < 0.05 while the bound variable's value is > 0.05, warn with the fix (bind a 0–100-scaled variable, or set `opacity` directly). This is the same shape as the existing balloon-frame and FILL-not-applied assertions and belongs beside them in `src/figma_plugin/src/assertions.js`. Document the scale in `edit`'s `variables` description in the same change.

**Estimated savings:** ~4 calls here (#70, #71, #72, plus the repair in #73), and it converts a silent visual defect into a stated warning.

### 5. `lint` discards a whole response for a 5% overrun instead of trimming it (saves ~1 call)

Call #81: `lint(nodeId: "3:679", maxIssues: 60)` → 39 issues, 31,620 chars, **1,620 over** the 30,000 budget. The entire issues array was replaced by a summary and three narrowing hints. Call #82 retried at `maxIssues: 12` and got 12 of 39 issues — the agent under-shot, and the remaining 27 were never seen.

`grep` already solves this: an over-budget search paginates into budget-sized pages of whole groups and reports `meta.pagination`. `lint` computes every issue and then throws them away over a 5% overrun.

**Proposed fix:** trim the `issues` array to what fits the budget and report `shown: N of M` plus the narrowing hints, rather than dropping all of them. `guardOutput`'s `metaExtractor` already knows the summary shape; this is a change at the `lint` call site in `src/figmagent_mcp/tools/lint.ts:95-105`.

## Error Analysis

### 1. `screenshot` — 8 failures, and the first isolated discriminator in 17 recurrences ([BUG-016])

Eight of eighteen `screenshot` calls failed (44.4%), all with the standing `export.ts:44-46` guard text blaming a "~4MB return cap". That text has now been falsified in seven consecutive sessions. What is new here is that the session accidentally ran a **controlled single-variable experiment**, and the variable is not size.

Call #46 added a `DROP_SHADOW` to the three Popup variants (`27:17`, `27:26`, `27:41`), with the shadow **colour bound to a variable** via `figma.variables.setBoundVariableForEffect(e, 'color', shadowVar)`. Every screenshot in the session sorts perfectly on whether a live shadow was inside the exported subtree:

| # | Target | Live DROP_SHADOW in subtree | Result |
|---|---|---|---|
| 49 | batch `[24:86, 24:45, 27:68]` | yes (`27:68`) | FAIL |
| 50 | `24:86` | no | OK |
| 51 | `27:68` (Popup set) | yes | FAIL |
| 52 | batch `[27:17, 27:26, 27:41]` | yes | FAIL |
| 53 | `27:26` | yes | FAIL |
| 61 | `27:82` scale 2 | yes (via instance of `27:17`) | FAIL |
| 62 | `27:82` **format: SVG** | yes | FAIL |
| 64 | `27:82` scale 2 (after #63 rewrote the effect) | yes | FAIL |
| 65 | `27:41` | yes | FAIL |
| 66 | `24:45` | no | OK |
| 67 | `27:27` (child of `27:26`) | no | OK |
| **68** | — | **`run_script`: `n.effects = []` on `27:17`** | — |
| **69** | **`27:82` scale 2 — identical call to #64** | **no** | **OK** |
| 70, 74, 75, 78, 79, 83 | `24:43`, `24:45`, `24:86`, `24:86`, `27:83`, `27:42` | no | OK |

**18 of 18 calls sort correctly. Zero exceptions.** The decisive pair is #64 → #68 → #69: the same node ID, the same `scale: 2`, the same format, 22 seconds apart, with exactly one intervening change — clearing the effect on a descendant — flipping the result from failure to a clean image.

This is consistent with the standing v5 root cause (`src/figmagent_mcp/remote/client.ts:110-114`, where a `JSON.parse` failure silently downgrades to a raw string, leaving `result.imageData` and `result.images` undefined) and inconsistent with the guard text. It also explains the batch signature exactly: if `result` is a string, `result.images` is `undefined` → `{}` → `Exported 0 node(s): none` with every fix branch skipped, which is what #49 and #52 returned.

**Caveats, stated plainly:** the control is one-directional. The shadow was restored on `27:17` at #73 and `27:82` was never re-screenshotted afterward, so there is no A→B→A confirmation. And the effect here always had a **variable-bound colour**, so "any effect" and "a variable-bound effect" are not yet separated.

**Named test:** on any file, export a plain FRAME; add `effects: [{type:'DROP_SHADOW', …}]` with a literal colour and export again; then bind the effect colour to a variable and export a third time. If only the third fails, the trigger is the bound-variable effect; if the second and third fail, it is any effect. Either answer is more actionable than anything the last seven sessions produced.

**Agent recovery:** good, and better than the guard text deserves. The agent tried `scale` once, `SVG` once (both failed — the second confirms [AGENT-031] should stop the ladder at two), then stopped permuting parameters and started changing the *scene*, which is what found the answer. **Zero official-Figma-MCP fallback calls across 8 failures** — the behavioural fix holds for a 9th session and a 4th project.

### 2. `edit` reports "Text style not found or not cached" for a style that exists ([BUG-032], 2nd session)

Call #21 sent `textStyleId: "S:1ae6a2e7ba3e6949ffed2681446e6c6c2b397a0a,"` — copied verbatim from `get_design_system` **97 seconds earlier** (#14, which returned it as `{"id":"S:1ae6…a0a,","name":"body/1","fontFamily":"PP Neue Montreal",…}`). All three text children failed:

```json
{"success":false,"nodesEdited":3,"totalNodes":6,
 "failures":[{"nodeId":"24:40","error":"Text style not found or not cached: S:1ae6…a0a,"}, …]}
```

Same style ID, same message, same file as session 53 — an independent second occurrence. The style exists; its font does not, and the pre-load loop swallowed the `loadFontAsync` throw before caching the style.

**The fix has since shipped** — `failStyleLookup` in `src/figma_plugin/src/commands/apply.js:329-350` now distinguishes a rejected id from an unloadable font and states opposite remedies for each (commit `d50708b`, 2026-09-01 23:18 UTC, *fifteen minutes after this call*, and in any case after this session's server process started). This session is therefore a pre-fix reproduction, not a regression, and it should be the verification target once a session runs against the fixed build.

**Agent recovery — notably better than S53.** Session 53 burned five calls permuting the ID format. Here the agent abandoned `textStyleId` on the very next call and set the type properties directly (#22 → #23 → #25). [AGENT-029] executed correctly.

### 3. `edit` rejects `variables: {fontWeight}` with a raw Zod enum dump ([BUG-030] / [TOOL-037], 2nd session)

Call #22 sent `variables: { fill, fontSize, fontFamily, fontWeight }` on three nodes and got back an MCP `-32602` with `{"received":"fontWeight","code":"invalid_enum_value","options":[…40 fields…]}`. The **entire batch was discarded** — the three valid bindings in the same call did not apply. Call #23 re-sent it minus `fontWeight`; call #25 was a `run_script` written solely to bind the weight.

Two layers are implicated and both have since moved:
- The schema now uses `z.record(z.string(), z.string())` with a `superRefine` that names the offending key and redirects it (`src/figmagent_mcp/tools/apply.ts:249-272`, commit `040ef9e`) — so the raw dump is fixed, but the redirect text still repeats [BUG-030]'s premise ("`fontWeight` is a direct-value field only").
- [TOOL-037] established that `fontWeight` **is** bindable as a FLOAT, proven four ways in session 53. The alias message at `apply.ts:44-47` therefore states a fix that is wrong on the merits, and `VARIABLE_FIELDS` still omits the field.

**Fix needed:** add `fontWeight` to `variableFieldEnum` (`apply.ts:20-37`) and to `FIELD_MAP` in `src/figma_plugin/src/commands/styles.js:1166-1168`, and delete the `fontWeight` entry from `VARIABLE_FIELD_ALIASES`. Until that lands, every custom-font file costs one `run_script` per weight-binding pass — it cost two here (#25, #32).

### 4. `setProperties` failures state a fix for the wrong problem (new — [BUG-039])

Call #44 batched 17 node operations; 8 failed, all with the same shape:

```
setProperties failed on instance 27:18: in setProperties: Unable to update this text property
because the component uses a font that isn't available..
Fix: verify each value matches its property type — VARIANT options must be exact,
INSTANCE_SWAP needs a valid COMPONENT id; read the instance to list valid keys and options
```

Figma's own message names the cause exactly — an unavailable font. The appended fix sends the agent to audit property types and re-read the instance's keys, which is unrelated and would have cost 2–3 calls to disprove. `src/figma_plugin/src/commands/apply.js:675-683` attaches that one string to **every** `setProperties` throw with no branching on the underlying message.

This is [BUG-032]'s failure mode in a different function: stating a cause you did not measure is the same defect as stating no fix at all.

**Fix needed:** branch on the caught message. When it matches the font-unavailable shape, state the remedy the project already documents — swap the component's TEXT nodes to an available face, set the properties, then re-bind the `fontFamily` variable last. The generic property-type text stays for everything else.

**Agent recovery:** excellent — it recognised the real cause immediately and pivoted to `run_script` with an inline font swap on the very next call (#45). One call, no permutation storm.

### 5. The VM has no custom fonts, and this session measured how deep it goes ([BUG-033], 3rd session)

Call #37 (`write`) and #38 (`run_script`) both failed with `in appendChild: unloaded font "PP Neue Montreal Regular"`. Call #39 probed the VM directly:

```json
{ "ppStyles": [],
  "loadResult": "ERROR: The font \"PP Neue Montreal Regular\" could not be loaded.
     The font family \"PP Neue Montreal\" does not exist.
     Fonts from text styles:\n- PP Neue Montreal (Regular, Medium, Semibold, Extrabold)…",
  "fontName": {"family":"PP Neue Montreal","style":"Regular"},
  "totalFonts": 8927 }
```

Two things worth recording. **8,927 fonts available**, against session 53's measurement of 1,938 on the same file — the VM's font inventory is not stable across runs, so a workaround validated by count in one session cannot be assumed in the next. And Figma's own error text enumerates the family under *"Fonts from text styles"*: the VM knows precisely which family the file needs and that it cannot load it.

**The swap-write-rebind order was confirmed working, with a refinement.** Call #85 re-authored the two group labels on `SF Pro / Semibold` — chosen because its *style name* spells "Semibold" the way the target face does — then re-bound the `fontFamily` variable last. Readback:

```json
[{"id":"27:29","font":"{\"family\":\"PP Neue Montreal\",\"style\":\"Semibold\"}"},
 {"id":"27:36","font":"{\"family\":\"PP Neue Montreal\",\"style\":\"Semibold\"}"}]
```

The family binding restores the real face name and **carries the style axis with it**, so picking a donor face whose style *spelling* matches the target preserves the weight. This corroborates [BUG-037] (the style-face swap keeps the link) and sharpens [BUG-035] (the weight → face table must match on style spelling, not on numeric weight). Call #86 audited all 35 TEXT nodes on the page and every one resolved to `PP Neue Montreal` Regular or Semibold.

**Cost:** 3 of the session's 19 write scripts existed only to perform this dance (#40, #45, #85).

### 6. Bash path errors (1 hard, 2 wasted calls)

Calls #16 and #18 ran `cat src/components/_CloseIcon.tsx` and a `grep` against `src/components/` from the wrong working directory; #19 re-ran it with an absolute `cd`. Minor, self-corrected in one step, listed for completeness.

## What Worked Well

1. **`write` did the heavy lifting — 8 COMPONENT roots and 32 nodes in one call (#30).** The `Autocomplete Input` set was created as eight complete variants (`State` × `Filled`), each with a TEXT child and a nested Clear FRAME with an Icon, in a single 10.5KB payload. #20 did the same for the 3-variant Item set. This is the pattern sessions 53 and 54 never reached — both built node-by-node through `run_script`.

2. **`run_script` share fell 25.6 points with no tooling change.** 29.1% of Figma calls here against 54.7% two hours earlier on the same file, and 46.3% of write operations against 74%. The remaining scripts are mostly involuntary (issue 2). Whatever produced the S53/S54 monoculture was not a hard constraint.

3. **`combine_as_variants` and `component_properties` were flawless.** Three sets combined (3, 8, 3 variants) and six properties defined then bound across two sets — 7 calls, 0 errors, no re-reads. The `add` → `bind` two-call idiom worked first try both times.

4. **Zero unflagged soft failures.** Every failure in this session was flagged `is_error: true`. S53 had four silent ones, S54 had two. The `success/failed`-count verdicts on `edit` (#21, #44) correctly reported partial batches as failures while still applying the operations that worked.

5. **The agent changed the scene instead of the parameters.** After `scale` and `SVG` both failed on the same node, it stopped permuting arguments and started removing properties — which is the only reason [BUG-016]'s discriminator exists. This is exactly what [AGENT-031] and [AGENT-029] ask for, executed without prompting.

6. **Annotation quality was revised deliberately.** After writing 10 annotations (#89), the agent read its own project memory (#87, #90), dropped 2 that only restated what the canvas shows, and rewrote the remaining 8 to carry what Figma cannot hold — `--anchor-width`, `outline-offset`, `:empty` collapse, `sideOffset`. That is the right instinct for dev-mode documentation.

7. **Orphan cleanup happened without being asked.** Call #42 deleted the stray `27:11` left by the [TOOL-040] null-ID confusion, before continuing.

## Priority Improvements

### Tool Changes (ranked by call savings)

1. **`screenshot` — run the effects experiment and fix `remote/client.ts:110-114`.** The named test in error analysis 1 is three calls and would settle 17 sessions of speculation. Independent of the outcome, a `JSON.parse` failure in the remote client must throw rather than downgrade to a raw string, and the "~4MB return cap" sentence in `export.ts`'s `OVERSIZED_FIX` should be deleted — it has been falsified in seven consecutive sessions and has led agents into dead ends in six. Saves ~8 calls/session on verification-heavy work.
2. **`fig.createNode` — return the created node's `tree` object.** Plus a postlude warning when `__result.nodeIds` contains nulls. Saves ~3 calls/session and restores post-write assertions that are currently skipped silently.
3. **`edit` — add `fontWeight` to the bindable field set** (`apply.ts:20-37` + `styles.js:1166-1168`) and delete the now-false `VARIABLE_FIELD_ALIASES.fontWeight` redirect. Saves ~2 calls/session on any tokenised type system.
4. **Opacity-binding assertion.** Warn when a bound `opacity` resolves below 0.05 while its variable exceeds 0.05. Saves ~4 calls and prevents a silent invisible-node defect.
5. **`edit` — add `strokeAlign` and `description` direct-value fields; add an annotation delete path.** Three small additive changes that between them removed four `run_script` escapes from this session alone.
6. **`screenshot` batch — state a fix on total failure.** One branch in `buildBatchExportResult`. Saves ~2 calls and stops training agents off the batch path.
7. **`lint` — trim the issues array to budget instead of discarding it.** Saves ~1 call and returns complete data.

### Agent Skill Updates

1. **Never assume a stdlib helper's return shape — probe it or read the description.** `Object.keys()` on an unfamiliar return is one line and cheaper than an atomic rollback.
2. **When a variable binding produces a value you did not expect, measure the resolved property, not the binding.** `n.opacity` said `0.004` while `boundVariables.opacity` looked perfectly correct. The binding succeeding says nothing about the scale it resolves on.
3. **When a screenshot fails twice, change the scene, not the arguments.** Confirmed again: `scale` and `SVG` both failed; removing an effect worked. Add "remove effects from the subtree" to the diagnostic ladder ahead of any further `scale` attempts.
4. **On a custom-font file, pick the donor face by style-name spelling.** `SF Pro / Semibold` restored `PP Neue Montreal / Semibold` through the family binding; a face whose style spells differently would not have.
