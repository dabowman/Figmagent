# Figma MCP Session 64 Analysis

## Session Overview

- **Transcript**: `.claude/sessions-json/a3121b35-4b7f-49bc-88ec-9be969e56571.json`
- **Duration**: 20 minutes by metadata (19:44:20Z → 20:04:37Z); **15.1 minutes of message-to-message span with no gap over 2 minutes** — the densest session in the series at ~5.5 calls/minute
- **Total tool calls**: 83 (58 Figmagent, 23 Bash, 2 ToolSearch)
- **Total errors**: 4 — 3 Figmagent (5.2% of Figma calls), 1 Bash (the agent's own `KeyError`)
- **Reconnections**: 0 (remote transport — no channels)
- **Context restarts**: 0
- **Official-Figma-MCP calls**: 0 (16th consecutive session)
- **Transport**: remote (`use_file` by fileKey `C4zLeQJs8qkAhFSLwMKP9J`)
- **Repo**: external — `~/Github/storybook` ("Archer" design system), branch `main`
- **Task**: sync three shipped commits into the Figma library — mint the `size/control`, `size/icon`, `font/lineHeight/none` and two `toggle/*-pressed-hover` tokens, put Button/Toggle/Toolbar Link on one control height, fix Button label leading, write the variable IDs back into the repo's token JSON, and re-annotate the affected components.

This is the **12th analysed session on the "Archer" file**. Chronologically it runs **72 minutes before session 63** (19:44Z vs 21:16Z the same day), so where the two disagree, this session is the earlier state of the file.

The task shape matters for every finding: it is a *reconciliation* pass — change five token values, then chase the consequences through 60 Button variants, 8 Toggle variants, 3 Toolbar Link variants, a Toolbar set and 47 instances document-wide. Session 50's split (`write`/`edit` cover creation well, reconciliation badly) predicts exactly what happened.

## Metrics

| Metric | Session 63 | This Session | Change |
|---|---|---|---|
| Total tool calls | 62 | 83 | +34% |
| Figmagent tool calls | 47 | 58 | +23% |
| `run_script` share of Figma calls | 24 of 47 (51.1%) | **29 of 58 (50.0%)** | −1.1 pts |
| `run_script` share of write ops | 10 of 10 (100%) | **13 of 26 (50%)**; excluding annotations **13 of 17 (76%)** | first sub-100% in 6 sessions |
| Diagnostic scripts | 14 of 24 (58%) | **15 of 29 (52%)** | −6 pts |
| `read` calls | 12 | **0** | −12 — and `read` *was* in the opening slice |
| Errors | 9 | 3 Figmagent + 1 Bash | −5 |
| Error rate (Figma calls) | 19.1% | **5.2%** | −13.9 pts |
| Estimated waste | ~28% of Figma calls | **~36% of Figma calls (21 of 58)**; ~25% of all 83 | +8 pts |
| ToolSearch calls | 2 (3.2%) | 2 (2.4%) | — |
| Idle time | 18 min (one `AskUserQuestion`) | **0** | — |

The error rate is the best on this file in six sessions and the waste is the worst. Those are the same fact seen twice: nothing *failed loudly*, and three of the four largest cost centres are tools that **returned `success: true` while doing nothing**.

## Tool Call Distribution

| Tool | Calls | Notes |
|---|---|---|
| `run_script` | 29 | 15 read / 14 write; **3 failed** (10%). 15 diagnostic scripts (52%) — see Issue 1 |
| Bash | 23 | Repo side — `git log/show`, `config/*.tokens.json` patching, `tokens:generate`/`build`/`validate`, lint/typecheck/test, project-memory reads |
| `set_annotation` | 9 | **All single-node**, after ToolSearching `set_multiple_annotations` — see Issue 3 |
| `screenshot` | 7 | 1 batch (`nodeIds`, 3 nodes), 6 single — two adjacent pairs were batchable |
| `grep` | 5 | Clean: `hasAnnotation`+`scope` ×3, `annotation` regex over DOCUMENT ×2 (2,191 nodes/call) |
| `get_design_system` | 3 | `namePattern` + `includeScopes` — exactly the documented shape, zero scripts re-implementing it |
| `create_variables` | 3 | 5 variables minted with inline `scopes`, 0 failures |
| ToolSearch | 2 | #11 selected 9 schemas incl. `read`/`edit`/`write`; #56 fetched both annotation tools |
| `use_file` | 1 | By fileKey |
| `edit` | 1 | The session's only first-class node write — **and it silently did nothing** (Error 1) |
| `read` | **0** | Loaded at #11, never called |

## Efficiency Issues

### 1. `read` was loaded and never called; 15 scripts dumped node metrics instead (saves ~10 calls, and closes a read-gap)

`read` was the **second tool named** in the opening `ToolSearch` (#11) and was never invoked in 58 Figma calls. This is not the discovery failure [AGENT-036] describes — the tool was in hand. The agent looked at it and chose a script 15 times.

**Pattern observed:** script #23 dumps, for each of 60 Button variants, `{w, h, sizingH, sizingV, pt, pb, pl, pr, minH, text:{fs, lh, h, bound}}` as a keyed table (20,500 chars). Scripts #25, #41, #44, #52, #53 do the same shape for Toggle, Toolbar Link, Toolbar and Slider.

**Root cause — two distinct gaps, both real:**

1. **The fields aren't in FSGN.** `layoutSizingHorizontal` / `layoutSizingVertical` appear **nowhere** in `src/figma_plugin/src/commands/document.js` — the serializer emits `primaryAxisSizingMode`/`counterAxisSizingMode` (the frame's mode for *its* children) but never the node's own HUG/FILL/FIXED within its parent. `minWidth`/`minHeight` are likewise absent. So the sizing vocabulary the whole `write`/`edit` API and CLAUDE.md are written in — `layoutSizingHorizontal: "FILL"` — **can be written but not read back**. Five of the fifteen scripts exist for that one asymmetry.
2. **`read` has no field projection.** `read` exposes `detail`, `depth`, `filter` and `maxOutputChars` — no way to say "these six fields, across these 60 siblings". Comparing a component set means 60 full FSGN blocks against a 30K budget. The script returns the same information as a compact table. For a 60-variant set the script is not laziness; it is the only thing that fits.

**Genuinely avoidable:** 3 of the 15 — #59, #67 and #76 each just list a COMPONENT_SET's children as `[id, name]`, which is `read(setId, detail="structure", depth=1)` verbatim.

**Proposed fix:** add `layoutSizingHorizontal`/`layoutSizingVertical`/`minWidth`/`minHeight`/`maxWidth`/`maxHeight` to the FSGN layout block ([TOOL-056]), and give `read` a `fields` projection that returns one row per node instead of one block ([TOOL-057]).

**Estimated savings:** ~10 of 15 diagnostic scripts.

### 2. Three mutation scripts do what `edit` already exposes (saves ~3 calls)

- #43 — `fig.bindVariable(v, 'fill', …)` + `'stroke'` → `edit({variables: {fill, stroke}})`
- #45 — `inst.setProperties({ Size: 'MD' })` across 5 instances → `edit({componentProperties: {Size: "MD"}})` ([TOOL-019], shipped)
- #81 — `sep.resize(sep.width, 34)` → `edit({height: 34})`

Seventh recurrence of [AGENT-026]. Notably **narrower** than prior sessions: `get_design_system` was in the opening slice and was called three times, and zero scripts re-implemented `getLocalVariablesAsync()`. The discovery lever held; these three are preference, and all three came *after* the session had already spent 14 calls inside `run_script` on the font problem — script momentum, not ignorance.

### 3. Nine `set_annotation` calls after ToolSearching the batch tool (saves ~7 calls)

Call #56 explicitly fetched **both** `set_multiple_annotations` and `set_annotation`. The agent then wrote 9 annotations one at a time (#57, #58, #60, #61, #71, #72, #73, #74, #78), including two runs of four consecutive calls.

**Root cause — a false constraint in the schema.** `set_multiple_annotations` (`src/figmagent_mcp/tools/comments.ts:264-292`) requires a top-level `nodeId` described as *"The ID of the node containing the elements to annotate"*. The nine targets span five components on four pages, so no such containing node is obvious. **The plugin handler ignores the parameter entirely** — `setMultipleAnnotations` (`src/figma_plugin/src/commands/scan.js:650-654`) destructures only `{ annotations }` and iterates. The containment requirement is imaginary, and it is the only reason not to batch.

**Proposed fix:** make `nodeId` optional and correct its description ([TOOL-058]). Auto-fixable as `description-only`.

### 4. Screenshot pairs not batched (saves ~2 calls)

`screenshot` accepts `nodeIds` and #68 used it correctly for three nodes. But #63/#64 and #65/#66 were issued as adjacent single calls. Minor, and the agent got the pattern right once — worth a note, not an entry.

## Error Analysis

### 1. `edit` and `fig.bindVariable` silently no-op on a TEXT node that carries a `textStyleId` (0 errors raised, ~8 calls lost)

The most expensive event in the session raised no error at all.

The Button label (`42:112`) sits on the `ui/label` text style (`S:8c432bbff5c9b9c23a6ffdd2fd31ff3c46e67a14,`), whose own `boundVariables` carry `fontSize` → `VariableID:2:506`. The session needed the label on the per-size token `2:559` instead.

- **#28** — `fig.bindVariable(label, 'fontSize', 'VariableID:2:559')` returned `{ ok: true }`.
- **#29** — reads back `boundVariables.fontSize` as a **two-element array**: `[{2:506}, {2:559}]`. `fontSize` still resolves to **12.44** (the style's SM value), not MD.
- **#31** — the first-class path, `edit({nodes:[{nodeId:"42:112", variables:{fontSize:"VariableID:2:559", lineHeight:"VariableID:321:4"}}]})`, returned `{"success":true,"nodesEdited":1,"totalNodes":1}` — no warnings block.
- **#32** — verifies: still `[{2:506},{2:559}]`, `fs` still 12.44, `lineHeight` still `{PERCENT, 150}`. **`edit` reported a successful edit and changed nothing.**
- **#35** — `setBoundVariable('fontSize', null)` clears exactly one entry, leaving `[{2:506}]`. The array is a stack and the style's entry wins.

`apply.js` has no pre-check for this: `textStyleId` appears at `:1118` (applying a style) and `:493` (rejecting a style on a non-TEXT node), but nothing checks whether an **existing** `textStyleId` will shadow an incoming per-node `fontSize`/`lineHeight`/`letterSpacing`/`textCase` binding. `bindVariableToNode` binds and returns no warning, so the stdlib's deliberate throw-on-warning path (`stdlib.js:58-65`) has nothing to throw.

**Agent recovery:** good, and expensive. It did not retry blindly — it read back after every attempt, escalated from stdlib → first-class `edit` → raw `setBoundVariable`, found the `textStyleId` at #34, and correctly concluded that Figma text styles cannot be partially overridden. Eight calls (#28–#37) to learn one fact that a warning on #28 would have stated.

**Fix needed:** before binding a text-style-owned field on a TEXT node with a non-empty `textStyleId`, warn (or fail) naming the style and the field — fix: *detach the style, or move the binding onto the style with `update_styles`*. This is the mechanical counterpart of [AGENT-032]: that entry says put text on styles; this one says once you have, `edit`'s per-node font bindings are dead and nothing says so. Logged as **[BUG-050]**, P1, auto-fixable as `boundary-guard`.

### 2. Component label metrics don't propagate to instances on the remote VM (4 scripts, 1 error)

After the Button variants were corrected (main heights SM 24 / MD 28 / LG 38), script #46 reads seven Toolbar instances and finds them all still at **33-34px**. The instances kept the pre-change label measurement.

The cause is [BUG-033] one layer down: the labels are on `PP Neue Montreal`, which the headless VM cannot load. It renders an Inter fallback but stores the real face, so when the font-size binding changes it has no metrics to re-measure with and the cached height stands.

The workaround the session found — and it works — is to force a re-measure by round-tripping the face through a family the VM *does* have:

```js
l.setBoundVariable('fontFamily', null);
l.fontName = { family: 'Inter', style: 'Regular' };
l.fontName = { family: 'Inter', style: face === 'Regular' ? 'Regular' : 'Semi Bold' };
l.setBoundVariable('fontFamily', fam);
```

Script #49 runs that over every page, filtering `findAllWithCriteria({types:['INSTANCE']})` down to the three target sets — **47 instances touched** across Alert Dialog, Menu, Popover, Form, Tooltip, Toolbar and Toggle Group.

Cost: 4 scripts (#46, #47, #48, #49) plus error #47. Note the double `fontName` assignment is [BUG-044]'s prescribed pattern applied correctly — that finding is paying for itself a third time.

**Unverified risk:** #49 logs `['HAD STYLE', styleId]` for any label carrying a `textStyleId`, because assigning `fontName` to a styled node detaches it. The response was truncated at 3,829 chars in extraction, so **whether any instance label was detached from its style cannot be determined from the transcript**. A tool-side re-measure would not have this problem.

**Fix needed:** expose the re-measure as a first-class operation — `edit({ nodeIds, remeasureText: true })` — or perform it automatically inside `edit` when a font-size/line-height write lands on a node whose family is unavailable. Logged as **[BUG-051]**, P1.

### 3. `getNodeByIdAsync` returns `null` for an instance-descendant ID (1 error)

Script #47 died on `TypeError: cannot read property 'width' of null` at line 11 — `figma.getNodeByIdAsync('I240:30;42:392')` returned `null` for an instance-child path ID the agent had composed from a sibling instance's dump. #48 recovered immediately with `inst.findOne(n => n.type === 'TEXT')`.

Third recurrence of [BUG-031], with a variant worth noting: the VM returned **`null`** rather than throwing "Node not found", so the failure surfaced one line later as an anonymous `TypeError` naming neither the ID nor the fix — the same shape [TOOL-044] describes for `fig.prop`.

### 4. `style.setBoundVariable(field, variableId)` rejects a string ID (1 error)

Script #36 failed with `in setBoundVariable: Cannot call setBoundVariable with a non-variable node`. The agent had passed a variable **ID string**, which is what `fig.bindVariable` accepts — but `fig.bindVariable` only takes nodes, so text-style work must drop to the raw API, which requires a resolved `Variable` object. #37 fixed it by adding `const V = async id => await figma.variables.getVariableByIdAsync(id)` — a helper that then reappears in six later scripts.

Two things this names: the stdlib has no style-targeted bind, and the raw error blames "a non-variable node" when the actual problem is the *second* argument's type. Folded into [TOOL-057]'s note and recorded against [TOOL-031] (the preamble reuse problem).

## What Worked Well

1. **`create_variables` with inline `scopes` — 3 calls, 5 variables, 0 failures.** Exactly the CLAUDE.md guidance ("pass `scopes` inline rather than following up with `update_variables`"), and no re-scope round trip was needed. The agent then wrote the returned IDs back into `config/base.tokens.json` and `config/component.tokens.json` as `$extensions["com.figma.variableId"]`, regenerated with Style Dictionary, and confirmed 0 errors and no CSS churn — the repo and the Figma file left consistent.
2. **`grep` did the discovery `run_script` would otherwise have done.** Five calls: `hasAnnotation: true` scoped to a set (3×) and an `annotation` regex over the whole DOCUMENT (2×, 2,191 nodes each). Zero hand-rolled `findAll` traversals for annotation discovery. [AGENT-006] and [AGENT-035] both holding.
3. **`get_design_system` in the opening slice, called three times, zero re-implementations.** [AGENT-026]'s sharpened guidance holds for the 7th time — and this session is the cleanest test yet, because the token phase was the *first* phase and still didn't slip into scripts.
4. **Fail-fast on the silent no-op.** Faced with a tool reporting success and changing nothing, the agent read back after every attempt and escalated through three different APIs rather than retrying the same call. [AGENT-001] holding.
5. **The font-load error stated its fix.** Error #27's message — *"the headless VM has no locally-installed or licensed fonts, and face names must match Figma's…"* — is [BUG-033]'s remedy landing, and the agent acted on it in one step.
6. **Two pre-existing defects found and fixed en route**: every Button label was bound to `font/size/sm` regardless of its `Size` axis, and the labels had silently detached from `ui/label`. Neither was in scope; both were reported.

## Priority Improvements

### Tool Changes (ranked by call savings)

1. **`edit` — pre-check `textStyleId` before a per-node font binding** ([BUG-050]). Warn naming the style and the shadowed field instead of returning `success: true` on a no-op. Saves ~8 calls per occurrence and removes a class of silently-wrong output. **The single highest-value change in this session.**
2. **`read` — emit `layoutSizingHorizontal`/`layoutSizingVertical` and `minWidth`/`maxWidth`/`minHeight`/`maxHeight` in FSGN** ([TOOL-056]). The sizing model is writable but not readable; five diagnostic scripts exist only for that. Small additive change to `document.js`.
3. **`read` — add a `fields` projection returning one row per node** ([TOOL-057]). Turns a 60-variant comparison from an over-budget FSGN dump into one call. ~5 calls/session on any variant-heavy file.
4. **`edit` — a `remeasureText` operation** ([BUG-051]), or automatic re-measure when a text write lands on an unavailable family. Saves 4 scripts and removes the style-detachment risk from the hand-rolled version.
5. **`set_multiple_annotations` — make `nodeId` optional and correct its description** ([TOOL-058]). The plugin already ignores it. ~7 calls/session on annotation passes. Auto-fixable.

### Agent Skill Updates

1. **When a write tool reports success, check that the value moved before building on it.** This session's `edit` and `fig.bindVariable` both returned success on a no-op. The agent caught it — the guidance is to make that the default reflex on font/text-style writes specifically, where [BUG-034], [BUG-044] and [BUG-050] now all share the shape.
2. **A COMPONENT_SET's child list is `read(detail="structure", depth=1)`, not a script.** Three scripts (#59, #67, #76) did nothing else.
3. **Reconciliation tasks need a re-measure pass on instances.** After changing a main component's text metrics on a custom-font file, instances hold stale heights until forced. Belongs in the `figma-guidelines` skill next to the remote-font notes — this session's repo-local memory had the font gotchas but not this one.
