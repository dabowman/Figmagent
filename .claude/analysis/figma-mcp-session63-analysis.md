# Figma MCP Session 63 Analysis

## Session Overview

- **Transcript**: `.claude/sessions-json/a24e357a-56d2-4aba-807c-5077a098084b.json`
- **Server session log**: `~/.figmagent/sessions/2026-09-03_c9dd53a4.json` (47 calls, per-call durations + response sizes)
- **Duration**: 68 minutes (2026-09-03 21:16:01Z → 22:23:37Z), of which **18 minutes** is a single `AskUserQuestion` wait (21:24 → 21:42) — ~50 minutes of active work
- **Total tool calls**: 62 (47 Figmagent, 12 Bash, 2 ToolSearch, 1 AskUserQuestion)
- **Total errors**: 9 — all Figmagent
- **Reconnections**: 0 (remote transport — no channels)
- **Context restarts**: 0
- **Official-Figma-MCP calls**: 0 (15th consecutive session)
- **Transport**: remote (`use_file` by fileKey `C4zLeQJs8qkAhFSLwMKP9J`)
- **Repo**: external — `~/Github/storybook` ("Archer" design system), branch `main`
- **Task**: refactor focus state across the whole Figma library — replace `State=Focus` **variants** with a `Focus` **BOOLEAN component property** bound to a `Focus ring` layer, on every component set. Result: 39 components/sets carry a bound `Focus` boolean, 58 variant components deleted, 0 stray `State=Focus` variants, rings normalised for name/geometry/token binding.

This is the **11th analysed session on the "Archer" file** and the first *library-wide refactor* rather than a per-component mirror or a token pass. The task shape matters for every finding below: it is 34 near-identical structural edits against 34 different component sets.

## Metrics

| Metric | Session 62 | This Session | Change |
|---|---|---|---|
| Total tool calls | 134 | 62 | −54% (different task shape) |
| Figmagent tool calls | 35 | 47 | +34% |
| `run_script` share of Figma calls | 28 of 35 (80.0%) | **24 of 47 (51.1%)** | −28.9 pts |
| `run_script` share of write ops | 11 of 11 (100%) | **10 of 10 (100%)** | unchanged — 0 `write`, 0 `edit`, 0 `component_properties`, 0 `lint` |
| Diagnostic scripts (`mode: "read"`) | 17 of 28 (61%) | 14 of 24 (58%) | — |
| Errors | 2 | 9 | +7 |
| Error rate (Figma calls) | 5.7% | **19.1%** | +13.4 pts |
| `screenshot` failure rate | — | **2 of 4 (50%)** | both were batch calls |
| Estimated waste | ~31% of Figma calls | **~28% of Figma calls (13 of 47)**; ~21% of all 62 | — |
| ToolSearch calls | 2 (1.5%) | 2 (3.2%) | — |
| Total response chars | — | 176,906 across 47 calls | 3 calls account for 33% |

## Tool Call Distribution

| Tool | Calls | Notes |
|---|---|---|
| `run_script` | 24 | 10 write / 14 read; **6 failed** (25%); 100% of all write operations |
| `read` | 12 | 2 used `nodeIds` arrays (4 and 2 nodes); no redundant re-reads of the same node at the same detail |
| Bash | 12 | Repo side only — `_mixins.scss`, `Combobox.scss`, `component.tokens.json`, `git log/show` |
| `screenshot` | 4 | 2 batch (**both failed**), 2 single (both succeeded) |
| `grep` | 3 | Document-wide: 61 COMPONENT_SETs, 58 `Focus` COMPONENTs, 0 focus INSTANCEs — 2,168 nodes searched per call |
| ToolSearch | 2 | #1 selected 10 schemas at 21:19; #23 fetched `run_script` alone at 21:21 |
| `get_local_components` | 2 | **Both returned `{"count":0,"components":[]}`** — see Error 2 |
| `get_selection` | 1 | Failed — called before `use_file` on remote |
| `use_file` | 1 | By fileKey |
| AskUserQuestion | 1 | 3 questions in one call; changed the plan |

## Efficiency Issues

### 1. `component_properties` has no multi-component batch — a 34-set refactor cannot use it at all (saves ~30 calls)

The core operation of this session is exactly what `component_properties` exists for: `{ action: "add", name: "Focus", type: "BOOLEAN", defaultValue: false, targetNodeId: <ring> }`, whose `add` path auto-binds BOOLEAN → `visible` (`src/figma_plugin/src/commands/components.js:417-435`). It was used **zero** times.

The reason is structural, not preference. The tool's schema is `{ nodeId, operations[] }` — `operations` batches *within one component*, and `componentProperties` rejects anything that is not a single COMPONENT/COMPONENT_SET (`components.js:398-402`). Thirty-four component sets is therefore **34 calls minimum**, before the per-variant `bind` ops. The agent's script path did the same work in **3 calls** (#21 prototype on one set, #23 batch over 22 sets, #25 the two clone-first sets), and it is hard to argue it was wrong to.

**Pattern observed:** #23 loops over a hard-coded array of 23 set IDs doing `addComponentProperty` → delete `State=Focus` children → per-variant `componentPropertyReferences = { visible: prop }`. That is the `component_properties` tool, hand-rolled, with the node loop the tool does not offer.

**Root cause:** missing batch dimension. Every sibling write tool already batches across nodes (`edit` takes `nodes[]`, `write` takes multiple roots, `create_variables`/`create_styles` take arrays); `component_properties` is the outlier that batches only *within* a node.

**Proposed fix:** accept `targets: [{ nodeId, operations[] }]` alongside today's single-node form, returning per-target results with per-target error isolation (the same shape `edit` uses). 34 calls → 1.

**Estimated savings:** ~30 calls on this session; ~8-10 on any multi-component property pass. Filed as **[TOOL-055]**.

### 2. `get_local_components` returns zero components on the remote transport (2 wasted calls)

`get_local_components({nameFilter: "combobox"})` at 21:19:39 and `{nameFilter: "button"}` at 21:21:29 both returned `{"count":0,"components":[]}` with `success: true`. The file contains **61 COMPONENT_SETs**, including `Button` (`42:494`) and `Combobox` (`55:246`) — `grep` found them 8 seconds after the first empty answer, and the agent's own `run_script` found 33 sets via `figma.root.findAllWithCriteria`.

The first call also burned **3,435 ms** — the slowest read of the session — to return nothing.

**Root cause (hypothesis, one call to confirm):** `getLocalComponents` (`styles.js:226-249`) is the only discovery path that enumerates `figma.root.children` and calls `page.findAllWithCriteria(...)` per page. `find.js` uses a manual recursive `traverse` and works; the session's scripts used **root-level** `figma.root.findAllWithCriteria` and worked. The per-page `findAllWithCriteria` in the headless `use_figma` VM is the one variable that differs. Note the code comment at `styles.js:227-230` justifies the per-page pattern by the remote VM's lack of `loadAllPagesAsync` — but this session shows root-level `findAllWithCriteria` needs no such call on remote.

**Why this is worse than an error:** `count: 0` is a *silent wrong answer* on a read tool. The agent read it as "no local components match" and moved on to `grep`; a less careful agent concludes the library is empty.

**Named test (1 call):** `run_script` returning `{ perPage: figma.root.children.map(p => p.findAllWithCriteria({types:['COMPONENT_SET']}).length), root: figma.root.findAllWithCriteria({types:['COMPONENT_SET']}).length }`. Filed as **[BUG-049]**.

### 3. The remote VM's unsupported APIs are still undocumented at the point of use (1 call)

Script #24 died on **line 3**: `await figma.loadAllPagesAsync()` → `"loadAllPagesAsync" is not a supported API`. The rewrite (#25) dropped the line and worked unchanged otherwise.

This is the second recorded instance of this exact line failing (session 53 lost two scripts the same way). What makes it notable here is that **the `figma-guidelines` skill was loaded in this session** — it is the entire first user message — and says nothing about it, while `skills/figma-plugins/references/api-reference.md:15` still *shows* `await figma.loadAllPagesAsync()`. [INFRA-008] is the entry that would fix this and it is `planned`, not shipped.

**Estimated savings:** 1-2 calls per script-heavy remote session. Recurrence logged on **[INFRA-008]**.

### 4. An atomic batch script aborted on its first bad member (1 call)

Script #34 looped over 23 component sets calling `getVariantProperties`; one set threw `Component set for node has existing errors` and, because remote scripts are atomic, **all 23 sets rolled back**. The rewrite (#35) wrapped each set in `try/catch` and recorded per-set notes — it then completed 22 of 23 and reported the failure inline.

The correct shape was reachable from the start: Figmagent's own batch tools (`edit`, `write`, `import_library_components`) all continue past a per-item failure and report it. Hand-rolled loops forfeit that unless the script author re-implements it. Filed as **[AGENT-037]** (P2 — one call, recovered in one step, but it is a mechanical rule worth stating).

### 5. `get_selection` before `use_file` on remote (1 call)

Call #1 of the session. Documented in CLAUDE.md ("the remote transport has no auto-join") and the error states the fix precisely, and the agent recovered immediately. Still a free call every remote session opens with. No new entry — this is the known remote-onboarding step.

## Error Analysis

### 1. Batch `screenshot` fails as a unit on remote while its own members succeed individually (2 failures)

Both batch screenshots returned exactly `Exported 0 node(s): none` — `isError: true`, **no `Errors:` block, no `Truncated:` block, no stated fix of any kind**:

| # | Call | Duration | Response | Result |
|---|---|---|---|---|
| 37 | `screenshot({nodeIds: [8 ids], scale: 2})` | 4,027 ms | 24 chars | `Exported 0 node(s): none` |
| 38 | `screenshot({nodeIds: [6 ids], scale: 2})` | 1,348 ms | 24 chars | `Exported 0 node(s): none` |
| 39 | `screenshot({nodeId: "41:26", scale: 2})` | 380 ms | image | **success** |

**This is the tightest control yet recorded on [BUG-016].** `41:26` is a *member of the #38 batch*. It failed inside the batch and succeeded alone **2 seconds later at the identical scale**. Nothing about the node, the scale, the file, the session or the network changed. The batch failed *as a unit*.

**Why the message is empty**: `buildBatchExportResult` (`export.ts:70-105`) reads `result?.images || {}`. When `remote/client.ts:110-114` catches a `JSON.parse` failure it returns the **raw string**, so `images` is `{}`, `allIds` is `[]`, and every fix-bearing branch (`errors`, `dataless`, `truncated`) is skipped. The plugin path cannot produce this state — `exportNodeAsImage` (`document.js:719-742`) populates `images` or `errors` for every id — which independently corroborates that the payload never survived the transport.

**Agent recovery:** excellent, and the best on this entry's record. Two batch failures → one single-node call → success → **no further batch attempts, no `scale` ladder, no `format: "SVG"` probe, no ToolSearch for the competitor, zero official-Figma-MCP calls.** Recovery cost was 2 calls.

**Fix needed:** unchanged from the tracker's v5 — (1) `remote/client.ts` must **throw** on an unparseable response rather than downgrading it to a string; (2) `buildBatchExportResult` must state a fix when `images` is empty, and surface the first ~200 chars of whatever *did* come back. This session is the **7th distinct input path** to reach the no-fix-text hole. Logged as recurrence #22 on **[BUG-016]**.

### 2. Binding a BOOLEAN property to `visible` silently overrides the default the caller asked for (2 calls to detect + repair)

Every conversion script created the property as `addComponentProperty('Focus', 'BOOLEAN', false)` and then bound each variant's ring with `ring.componentPropertyReferences = { visible: prop }`, followed by `ring.visible = false`.

The verification pass (#40) found `Focus#341:285 → defaultValue: true` on Checkbox. The repair pass (#41) swept all 39 and re-asserted `defaultValue: false`; its output shows both failure modes:

```
{ name: "Accordion Item",      before: true,  after: false, ringsStillVisible: 0 }
{ name: "Alert Dialog Popup",  before: false, after: false, ringsStillVisible: 1 }
```

So it is **not universal** — some components kept `false` but had a ring left visible, others flipped to `true`. Both directions produce the same shipped defect: *a component that renders its focus ring by default*. The agent caught it only because it screenshotted, saw rings, and went looking.

**Why this is a tool defect and not just a script gotcha:** `component_properties`' `add`-with-`targetNodeId` path (`components.js:417-435`) does exactly the failing sequence — `addComponentProperty(name, type, defaultValue)` then assign `componentPropertyReferences` — and never touches the target's visibility. Whatever the layer's `visible` is at bind time can override the caller's `defaultValue`, and while the handler *returns* `componentPropertyDefinitions` (so the flipped value is present in the response), **nothing warns**. An agent that trusts its own request ships the bug.

**Fix needed (assertion-class):** after an `add` with `targetNodeId`, compare `node.componentPropertyDefinitions[fullName].defaultValue` against the requested `defaultValue`; if they differ, re-assert via `editComponentProperty` and report `defaultRestored: true` in the result. Filed as **[BUG-048]** with a fix plan.

### 3. The remote VM cannot instantiate a component whose text is on a custom font (2 failures)

Scripts #33 and #42 both died at `appendChild`:

```
Error: in appendChild: unloaded font "PP Neue Montreal Semibold". Please call figma.loadFontAsync(...)
```

The agent was building a temporary verification board of `Focus=true` instances. It never touched text — `createInstance()` + `appendChild` is enough, because the instance carries text nodes on a family the headless VM does not have.

This is [BUG-033] (the remote VM cannot load a file's own custom fonts) at a **new call site**: previously recorded on text writes and `setProperties`, now on plain instantiation. The agent recovered in two steps — first by unhiding rings in place instead of instancing (#36, #51), then by instancing a **text-free** component (`Slider Thumb`) for the visual check (#43). Recurrence logged on **[BUG-033]**.

### 4. Two self-inflicted script errors (2 failures)

- #34: `TypeError: cannot read property 'find' of undefined` — `.children` read on a node type that has none.
- #35: `node.findOne: no such property 'findOne' on TEXT node` — `findOne` called on a leaf.

Both are the duck-typing hazard the repo already names (`prop()` at serializer boundaries, `fig.prop` in scripts). Both were fixed in the next call. No tracker entry — this is ordinary script iteration, and the atomic rollback meant nothing was left half-applied.

## What Worked Well

1. **Prototype-then-batch, executed exactly as CLAUDE.md prescribes.** #21 converted **one** set (Toolbar Link), returned the property name, the deleted variants and the per-variant bind log; #23 then batched 22 sets. The rule ("validate on 1 node first and confirm the result before batching") saved a 22-set rollback when #34's variant-property read blew up on a malformed set.

2. **`grep` did the discovery `get_local_components` could not.** Three document-wide calls (61 COMPONENT_SETs, 58 `Focus` COMPONENTs, 0 focus INSTANCEs, 2,168 nodes each) established both the work list and the **safety proof** that deleting 58 variant components would break no instance. That third call — searching for instances of the things about to be deleted — is the check that made a destructive batch safe.

3. **`AskUserQuestion` before the irreversible batch.** One call, three questions (property name, how text-field focus should be represented, whether to normalise the existing reference implementation). The answer changed the plan: the user redirected the border-recolour question to a **code-side** refactor, and the agent then re-read the repo (#29-#32) and found commit `a4bcd9e` had already landed it. Without that pause, 34 sets would have been built against a superseded model.

4. **Closing verification found a real residual.** #46 re-checked all 39 components for stray `State=Focus` variants, `defaultValue !== false`, and ring token bindings — and reported `clean: 38` with `Preview Card Trigger` still carrying `color/border/focus` in two variants. A summary-level "done" would have missed it. This is [AGENT-034]'s rule ("close out against a re-run, not the first run's summary") executed unprompted.

5. **Zero defection under a 50% screenshot failure rate.** 15th consecutive session with no official-Figma-MCP fallback. Recovery from the batch failure was 1 call.

6. **Temporary artifacts cleaned up.** The verification board (`345:1179`) was created (#43), screenshotted (#44) and removed (#45) inside 10 seconds, with the removal call also re-verifying Checkbox ring state.

## Priority Improvements

### Tool Changes (ranked by call savings)

1. **`component_properties` — accept `targets: [{nodeId, operations}]`** ([TOOL-055], P1). Saves ~30 calls on a library-wide property pass; the single missing batch dimension that made this session 100% `run_script` for writes.
2. **`component_properties` — assert the BOOLEAN default survives the bind** ([BUG-048], P1). Two calls per occurrence, and one class of shipped-wrong component. Fix plan written.
3. **`get_local_components` — fix (or route around) the per-page `findAllWithCriteria` traversal on remote** ([BUG-049], P1). Two calls, one silent wrong answer, one 3.4-second no-op.
4. **`remote/client.ts` — throw on an unparseable response; `buildBatchExportResult` — always state a fix** ([BUG-016] v5, P0, unshipped for 6 sessions). This session supplies the cleanest same-node batch-vs-single control yet.

### Agent Skill Updates

1. **Promote the remote-VM API gaps into `figma-guidelines`** ([INFRA-008], `planned`) — `loadAllPagesAsync` and `createNodeFromSvgAsync` are unsupported; `figma.root.findAllWithCriteria` works without any page pre-load. The skill was loaded in this session and still cost a call.
2. **Hand-rolled batch loops need per-item `try/catch`** ([AGENT-037], new) — remote scripts are atomic, so one bad member rolls back every good one. Match the first-class tools: continue, collect, report.
3. **Hide the layer before binding it to a BOOLEAN, then verify the default** — the write-order rule behind [BUG-048], useful in scripts even after the tool is fixed.
