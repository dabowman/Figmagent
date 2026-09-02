# Figma MCP Session 61 Analysis

## Session Overview

- **Transcript**: `.claude/sessions-json/4ac78b46-0597-4c26-940e-d8d3db41a251.json`
- **Duration**: 29 minutes (2026-09-02 03:27:14 → 03:56:28 UTC); active tool work is 8.6 min (03:28:07 → 03:36:42)
- **Total tool calls**: 35 (22 Figmagent, 12 Bash, 1 ToolSearch)
- **Total errors**: 5 hard (`is_error: true`) — 3 `screenshot`, 1 partial `edit`, 1 Bash `cd`
- **Reconnections**: 0 (1 `use_file`)
- **Context restarts**: 0
- **Transport**: remote — Figma file `C4zLeQJs8qkAhFSLwMKP9J` ("Archer")
- **Project**: external `~/Github/storybook`, branch `main` — **ninth analysed session on this project/file** (S53–S60)
- **Task**: mirror the Storybook `ContextMenu` component (Base UI `@base-ui/react/context-menu`, styled entirely by `Menu.scss`'s `.menu-*` classes, tokens from `config/component.tokens.json`) into the Archer file's `Context Menu` page (`5:685`)

**Concurrency**: three MCP processes wrote this file simultaneously again. Session `0fd99f95` ran 03:20:22 → 04:24:06 and session `e95d2d76` (analysed as S60) ran 03:29:59 → 03:41:32; this session sits inside both. **Unlike every prior run in this series, a collision is now attributable and provable** — see [BUG-047] below. That makes this the first session in 61 where cross-session interference is demonstrated rather than ruled out.

**Outcome: shipped complete.** On page `5:685`: `Context Menu Item` (`62:73`, 15 variants — `Type` Item/Checkbox/Radio/Submenu/Link × `State` Default/Highlighted/Disabled, plus `Label` TEXT and `Checked` BOOLEAN properties), `Context Menu Popup` (`63:75`, 6 `Content` variants composed from Item instances, variable-bound `DROP_SHADOW`), `Context Menu Separator` (`63:2`), `Context Menu Group Label` (`63:4`, TEXT prop), `Context Menu Trigger` (`63:272`, TEXT prop), and two usage scenes (`63:274` Default, `63:288` Submenu open). 12/12 dev-mode annotations applied in one batch. 94 nodes under lint, 0 `no_match`.

Two things make this session worth keeping. It is the **cleanest run on this file by every efficiency measure** — lowest waste (20%), lowest error count relative to size, and **zero font failures on a custom-font file**, which is the failure class that dominated S53–S59. And it produces the first proven cross-session write collision in the tracker's history.

## Metrics

| Metric | Session 59 | Session 60 | This Session | Change vs S60 |
|---|---|---|---|---|
| Total tool calls | 32 | 24 | 35 | +46% |
| Figma tool calls | 21 | 15 | 22 | +47% |
| Official-MCP calls | 0 | 0 | **0** | held (**14th consecutive**) |
| Hard errors | 2 | 3 | **5** (4 Figmagent, 1 Bash) | +2 |
| Figma error rate | 4.8% | 20% | **18.2%** (4 of 22) | −1.8 pts |
| Meta/overhead calls | — | — | 3 (`ToolSearch`, `use_file`, page-list script) | — |
| ToolSearch calls | 2 (6.3%) | 1 (4.2%) | **1 (2.9%)** | −1.3 pts |
| Estimated waste % | ~34% | ~37% | **~20%** (7 of 35) | **−17 pts — best on this file** |
| `run_script` share of Figma calls | 19.0% | 53.3% | **22.7%** (5 of 22) | −30.6 pts |
| `run_script` share of write ops | 25.0% | n/a | **66.7%** (4 of 6) | — |
| Nodes created | ~18 | 0 (reactions) | ~94 scanned / 21 variants + 3 components + 2 scenes | — |

## Tool Call Distribution

| Tool | Calls | Notes |
|---|---|---|
| `screenshot` | 8 | **3 failed (37.5%)** — [BUG-016] 21st recurrence; recovery by scale step then child export |
| `run_script` | 5 | 1 read (page list), 4 `mode: "write"`; **all 5 map to a named tool gap** |
| `read` | 2 | `62:73` structure/depth 2 (variant verification), `5:685` layout/depth 1 (collision discovery) |
| `get_design_system` | 2 | #14 variables via `namePattern`, #15 text styles — first-class, in the opening slice |
| `edit` | 1 | 3 repositions + 1 delete; the delete failed on a node another session had removed |
| `lint` | 1 | 5 roots in one call, 94 nodes, 21 issues, `autoFix` not requested |
| `set_multiple_annotations` | 1 | 12/12 in one batch, 0 failures |
| `use_file` | 1 | fileKey directly, no discovery round trip |
| `write` | **0** | ToolSearch-loaded and never called |
| `combine_as_variants` | **0** | ToolSearch-loaded and never called |
| `component_properties` | **0** | ToolSearch-loaded and never called |
| `grep` | **0** | ToolSearch-loaded and never called |
| Bash | 12 | 10 source/token reads, 1 memory read, 1 memory write; 1 error (`cd` after cwd reset) |
| ToolSearch | 1 | 12 tools selected in one call |

## Efficiency Issues

### 1. `lint` counts COMPONENT_SET wrapper chrome as unbound-token issues (14 of 21 findings = 67% noise)

`lint({nodeId: ["62:73","63:75","63:2","63:4","63:272"], maxIssues: 60})` returned 21 issues across 94 nodes. Fourteen of them — exactly seven per COMPONENT_SET, on both sets — are the set wrapper's own auto-layout:

```
62:73 Context Menu Item   cornerRadius=5  itemSpacing=40  counterAxisSpacing=40  paddingTop/Right/Bottom/Left=40
63:75 Context Menu Popup  cornerRadius=5  itemSpacing=40  counterAxisSpacing=40  paddingTop/Right/Bottom/Left=40
```

**Pattern observed:** the `cornerRadius: 5` is Figma's own default on the dashed set wrapper that `combineAsVariants` creates. The `40`s were set deliberately by the build script (`pset.paddingTop = … = 40; pset.itemSpacing = 40`) as *canvas gutter between variants* — presentation of the set on the page, not part of the component's design contract. Binding either to a design token would be meaningless; there is no `space/40` and there should not be.

**Root cause:** `lint` walks from the root it is given and treats a COMPONENT_SET like any other auto-layout frame. It has no notion that a set wrapper is scaffolding Figma generates and the agent arranges, distinct from the variants inside it.

**Cost:** no extra calls this session — the agent triaged it correctly in its closing summary ("the 21 findings are set-wrapper chrome and the 7 deliberate opacity literals"). But this is the third session where a closing summary has had to hand-wave a lint result, and [TOOL-036] already flags that session 56 made the *same* triage claim from summary buckets alone with 33 issues never returned. This session finally measures it: the claim is true, and it is 67% of the findings.

**Proposed fix:** in `lint.js`, skip a COMPONENT_SET node's own `padding*`/`itemSpacing`/`counterAxisSpacing`/`cornerRadius` when the node type is `COMPONENT_SET` (continue into its children normally). Alternatively report them in a separate `scaffolding` severity bucket that `autoFix` never touches and the summary reports separately. Either turns a 21-issue result into a 7-issue result that is entirely about the design.

**Estimated savings:** 0 calls, but it removes the recurring need to hand-triage a lint result in prose — and it removes the cover under which a *real* finding could hide (which is precisely [TOOL-036]'s concern).

### 2. Four separate build scripts each place nodes with explicit `x`/`y`, and they collided (2 calls to repair)

Scripts #17, #20 and #25 each set absolute page coordinates for the nodes they created: item set at `(0, 0)`, separator at `(0, 480)`, group label at `(260, 480)`, popup set at `(0, 600)`, trigger at `(520, 480)`, scenes at `y: 1120` and `y: 1500`. The trigger is 150px tall at `y: 480`, so its bottom edge is 630 — 30px *inside* the popup set that starts at `y: 600`.

**Pattern observed:** the agent discovered this only by reading the page back (#32 `read({nodeId: "5:685", detail: "layout", depth: 1})`) and repaired it with #33 `edit` moving `63:75 → y:690`, `63:274 → y:1200`, `63:288 → y:1580`.

**Root cause:** each script computes its own coordinates without knowledge of what the previous script's nodes actually measured to (heights are HUG-derived and not known until after creation). CLAUDE.md's "plan zone coordinates for multi-artifact builds" guidance addresses the *auto-placement* case, not this one — here coordinates were explicit and still wrong, because the heights were not.

**Proposed fix:** the cheap version is agent guidance — when a build spans multiple scripts, have each script return the bounding box of what it created and derive the next `y` from it, rather than from an estimate. The tool-side version is a post-write `sibling_overlap` assertion that already exists for `write`/`edit` (`assertions.js`) but does not run for `run_script` — which is [TOOL-033], already tracked, and this is its 12th instance.

**Estimated savings:** 2 calls per multi-script build.

### 3. `read()` is no longer attempted for page enumeration on this file — scar tissue from [BUG-014]

The session's first Figma call after `use_file` is `run_script` #13, a hand-written page lister:

```js
const pages = figma.root.children.map(p => ({ id: p.id, name: p.name, children: p.children.length }));
return pages.filter(p => /menu|cover/i.test(p.name)).concat([{id:'TOTAL',name:String(pages.length),children:0}]);
```

It returned 37 pages. `read()` with no nodeId — the documented way to do this — was never called, in this session or as a first attempt. Session 53 established why: on this exact file `read()` reported one page for a ~40-page document ([BUG-014], 8th recurrence). The behaviour has now hardened into never trying.

**Root cause:** [BUG-014], unfixed for 8 recurrences. The new information is behavioural: the agent has stopped paying the probe cost and goes straight to the workaround, which means the defect is now invisible in the transcript record — it costs one `run_script` call and produces no error to count.

**Proposed fix:** none new — fix [BUG-014]. Recorded here because "the agent no longer even tries the first-class tool" is the terminal state of a tool-trust defect, and it is worth having a session that names it.

## Error Analysis

### 1. `screenshot` — 3 of 8 failed (37.5%), and this session produces the smallest failing export on record ([BUG-016], 21st recurrence)

| # | Node | Node size | Scale | Render px | Shadowed subtrees | Result |
|---|---|---|---|---|---|---|
| 18 | `62:73` Item set | 676×415 | 1.0 | 676×415 | 0 | **FAIL** |
| 19 | `62:73` | 676×415 | 0.5 | 338×208 | 0 | success |
| 21 | `63:75` Popup set | 740×449 | 0.6 | 444×269 | 6 | **FAIL** |
| 22 | `63:75` | 740×449 | 0.5 | **370×225** | 6 | **FAIL** |
| 23 | `63:63` Groups variant | ~180 wide | 1.0 | ~180 | 1 | success |
| 24 | `63:40` Submenu variant | ~180 wide | 1.0 | ~180 | 1 | success |
| 26 | `63:288` Submenu scene | 560×340 | 0.8 | 448×272 | 2 | success |
| 28 | `63:63` | ~180 wide | 1.0 | ~180 | 1 | success |
| 34 | `63:274` Default scene | 560×340 | 0.8 | 448×272 | 2 | success |

Every failure carried the `export.ts` guard text: *"the export for node … returned no image data. This usually means the rendered payload exceeded the ~4MB return cap."*

**A 370×225 export cannot be 4MB.** At that size a PNG of a menu screenshot is on the order of 100KB. This is the smallest failing subject in the entry's 21-session history — smaller than session 52's previous record — and it fails while a *larger* render (448×272, #26) succeeds two minutes earlier in the same session. The stated cause in the guard text is falsified again, cleanly, with both directions present in one transcript.

**The shadow-count model survives and is sharpened.** Session 55 proposed a live `DROP_SHADOW` as the discriminator; session 56 softened it to *how many* shadowed subtrees are in the export; session 57 produced a zero-`effects` failure that killed the necessary-condition form. This session is consistent with the count form and with nothing simpler:

- `63:75` contains **6** popup variants, each carrying a variable-bound `DROP_SHADOW` (`figma.variables.setBoundVariableForEffect(..., 'color', N['color/shadow/default'])`). It fails at 0.6 **and** at 0.5.
- A **single** shadowed popup variant (`63:63`, `63:40`) exports at scale 1.0, three times, no failures.
- A scene containing **2** shadowed popup instances (`63:288`, `63:274`) exports at 0.8, twice, no failures.
- `62:73` has **0** shadows and still fails at 676×415, succeeding at 338×208 — so shadows are sufficient but not necessary, exactly as S57 showed. Fifteen dense variants of text and vector icons is its own entropy source.

The unifying variable across all four rows is **encoded payload size**, which is what session 58 concluded and session 51 concluded before it. This session adds the strongest evidence yet that the fix must not route through `scale`: `63:75` at 0.5 is already tiny and still fails, so telling the agent to shrink further is telling it to produce a useless image.

**Agent recovery — [AGENT-031] executed correctly, 6th consecutive session.** `62:73`: one scale step (1.0 → 0.5), done. `63:75`: exactly two attempts (0.6 → 0.5), then **stop permuting the argument and change the subject** — screenshot the child variants at full scale instead. Total recovery cost: 1 extra call for `62:73`, 2 extra calls for `63:75` (which bought two child views instead of one set view, so arguably 1 net waste). No `format: "SVG"` attempt, no official-MCP defection (14th consecutive session at zero).

**Fix needed:** unchanged from S58 — measure encoded bytes in-VM before returning and step down or re-encode server-side rather than emitting a dataless success, and stop printing a "~4MB cap" explanation that a 370×225 render disproves. The guard text should say what is actually known: *the export returned no data; this correlates with render complexity, not dimensions; export child nodes individually.*

### 2. `edit` reported "Node not found" for a node `read` had returned 11 seconds earlier — and it was right ([BUG-047], new)

```
#32 03:36:15  read({nodeId:"5:685", detail:"layout", depth:1})
              → …  - id: "63:322"  name: probe-frame  type: FRAME  x:0 y:2000 560×200
#33 03:36:26  edit({nodes:[…3 moves…, {nodeId:"63:322", delete:true}]})
              → {"success":false,"nodesEdited":3,"totalNodes":4,
                 "failures":[{"nodeId":"63:322","error":"Node not found: 63:322. Fix: verify the ID with
                 read or search with grep — it may have been deleted or belong to another page"}]}
```

Cross-referencing the concurrent transcript resolves it completely. In session `e95d2d76` (S60), on the **Accordion** task:

```
03:35:47  write({node:{type:"FRAME", name:"probe-frame", x:0, y:2000, width:560, height:200}})
          → {"rootId":"63:322","rootName":"probe-frame",…}
03:35:48  write({fromNodeId:"11:60", parentId:"63:322"})
03:36:18  edit({nodes:[{nodeId:"63:322", delete:true}]})
```

Session 60 created `63:322` at 03:35:47, used it as a scratch probe, and deleted it at 03:36:18 — **eight seconds before this session tried to delete it too**. This session's `read` at 03:36:15 caught it three seconds before it vanished.

**The real defect is where the frame landed.** Session 60 was working on the `Accordion` page (`11:58`); this session was working on `Context Menu` (`5:685`). Session 60's `write` passed **no `parentId`**, so it went to `figma.currentPage` — and `figma.currentPage` on the remote transport is *file state shared across every connected process*. This session's script #27 had called `setCurrentPageAsync(5:685)` at 03:35:12, 35 seconds earlier. Session 60's parentless `write` therefore landed a probe frame on a page it had nothing to do with, in the middle of another session's build.

This is the first **proven** cross-session collision in the tracker. Session 59's analysis explicitly ruled one out by timestamp; here the timestamps prove one. It is a new manifestation of [BUG-018] — whose existing scope is "`currentPage` does not persist between remote calls *within* a session" — extended to "and it is not private to a session either."

**Agent recovery:** none needed. The partial-batch contract worked exactly as documented (`success: false`, `nodesEdited: 3`, per-op `failures[]`), the three real repositions applied, and the agent moved on without retrying. **The error message named the true cause** — "it may have been deleted" was literally correct — which is worth recording on an entry family ([BUG-025], [BUG-039]) whose usual complaint is the opposite.

**Fix needed:** (a) `write` should not silently depend on ambient `currentPage` — when `parentId` is omitted, resolve the target page from the session's own file context and `setCurrentPageAsync` to it inside the handler (the same fix [BUG-018] already prescribes for the import path, applied to the create path); (b) `run_script`'s description should state that `setCurrentPageAsync` mutates state other processes observe, so scripts must not rely on it surviving across calls *or* assume it is theirs.

### 3. Bash `cd` after a cwd reset (1 call)

`#3 cd src/components/Menu && …` → `no such file or directory`, because the previous call's `cd src/components/ContextMenu` had been reset. Recovered immediately with an absolute path (#4). One wasted call, no cascade. Environment behaviour, not a Figmagent issue.

## What Worked Well

1. **Zero font failures on a custom-font file — the first time in this series.** Sessions 53–59 lost scripts, deliverables and whole builds to [BUG-033]/[BUG-040]/[BUG-044]. This session read `figma-remote-vm-gotchas.md` in one Bash call (#16, 11,461 chars) and applied every accumulated remedy first try: `Noto Sans New Tai Lue / Semibold` as the width-safe donor face (S57/S58's correction to the `SF Pro` recommendation), and [BUG-044]'s double-assign — `t.fontName = face; t.setBoundVariable('fontWeight', SEMI); t.fontName = face;` — to keep the weight binding from wiping the face. Script #27 reported `count: 17, semiboldFaces: 1`, all widths non-zero (`w: 70`). **The tracker's findings, written into project memory, eliminated an entire failure class for the cost of one file read.** That is the flywheel working end to end.

2. **[AGENT-025] reversal, second occurrence — and it correlates with [AGENT-026] holding.** `run_script` was 22.7% of Figma calls, the second-lowest on this file after S59's 19.0%. All five scripts map to named gaps: #13 is [BUG-014]; #17/#20/#25 need create-time variable bindings ([TOOL-032]), `setBoundVariableForPaint` on fills and strokes, `effects` with a bound colour ([TOOL-039]), and `combineAsVariants` with page co-location ([BUG-036]); #27 needs `fontWeight` binding ([TOOL-037]) plus the font-face double-assign. **Zero scripts re-implement a loaded tool** — and, as in S59, the session called `get_design_system` first-class in its opening slice (twice, #14 and #15). The two lowest script shares on this file are the two sessions that did that. [AGENT-026] holds for the 6th session.

3. **Batching held throughout.** One `set_multiple_annotations` placed 12/12 annotations in one batch. One `lint` covered 5 roots and 94 nodes. One `edit` carried 3 repositions and a delete. One `get_design_system` used a 300-character `namePattern` regex to pull exactly the variables the build needed instead of paging a 37-page file's whole token set. One `read` with `nodeIds` was not needed because the reads were genuinely single-node.

4. **[AGENT-031] executed correctly for the 6th consecutive session**, and this time the child-node fallback produced *better* output than the failed call would have — two 180px-wide variants at scale 1.0 are more legible than a 6-variant set at 0.5.

5. **Correct lint triage without a re-run — but stated, not assumed.** The closing summary names the two buckets (set-wrapper chrome, deliberate opacity literals) and the count. Compare [TOOL-036], which flags session 56 for making the same claim from summary buckets with 33 issues never returned. Here `maxIssues: 60` against 21 issues means the full list was in hand.

## Priority Improvements

### Tool Changes (ranked by impact)

1. **`write` must not depend on ambient `currentPage`** — resolve the target page from the calling session's file context when `parentId` is omitted. Fixes the class of failure where two concurrent processes cross-contaminate a file ([BUG-047]). Same fix shape as [BUG-018]'s verified import-path remedy.
2. **`screenshot`: stop routing the remedy through `scale`** — a 370×225 render failing proves the argument ladder cannot reach a fix. Measure encoded bytes in-VM, step down or re-encode server-side, and replace the "~4MB cap" guard text with the child-node-export instruction that actually works ([BUG-016], 21st).
3. **`lint`: exclude COMPONENT_SET wrapper layout from findings** — 14 of 21 issues here, 100% attributable to two set wrappers, 0% actionable ([TOOL-049]).
4. **`run_script`: run post-write assertions** — the sibling-overlap assertion that `write`/`edit` already ship would have caught the trigger/popup-set collision at creation time instead of costing a read plus an edit ([TOOL-033], 12th).
5. **Fix [BUG-014]** — 8 recurrences, and the agent has now stopped attempting `read()` for page enumeration entirely, so the defect no longer even generates an error to count.

### Agent Skill Updates

1. **Multi-script builds must derive coordinates from measured output, not estimates.** Have each build script return the bounding box of what it created and place the next artifact relative to it. HUG heights are unknown until after creation, so explicit coordinates computed up front are not sufficient protection against overlap.
2. **Do not rely on `setCurrentPageAsync` sticking, and do not assume it is yours.** Always pass an explicit parent to `write`/`appendChild`. On remote, `currentPage` is shared file state visible to every connected process.
3. **Keep reading the project memory file first.** One 11K-char read eliminated the failure class that cost the previous seven sessions. This should be the opening move on any file with a known gotchas file, not an occasional one.
