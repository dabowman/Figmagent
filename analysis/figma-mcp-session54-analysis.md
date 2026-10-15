# Figma MCP Session 54 Analysis

## Session Overview

- **Transcript**: `.claude/sessions-json/2be20c1a-fc5e-4df3-9568-ca461678c34d.json`
- **Duration**: 25 minutes wall clock (2026-09-01 22:54 → 23:19 UTC); one 7.7-minute idle gap before call #66 → **~17 minutes active**
- **Total tool calls**: 73 (53 Figmagent, 18 Bash, 2 ToolSearch)
- **Total errors**: 9 hard (`is_error: true`, all Figmagent) + **2 unflagged soft failures**
- **Reconnections**: 0 (1 `use_file`)
- **Context restarts**: 0
- **Transport**: remote — Figma file `C4zLeQJs8qkAhFSLwMKP9J` ("Archer")
- **Project**: external `~/Github/storybook`, branch `main` — **second analysed session on this project/file**, starting **two minutes** after session 53 ended (22:52 → 22:54)
- **Task**: mirror the Storybook `AlertDialog` component (Base UI + `config/*.tokens.json` + `AlertDialog.scss`) into the Archer Figma file — a 2-variant `Alert Dialog Popup` COMPONENT_SET (`State=Default` / `State=Focused`) with TEXT/BOOLEAN component properties, plus an assembled `Alert Dialog` portal-scene COMPONENT (backdrop + centred popup instance), everything bound to `alert-dialog/*` and semantic variables, then annotated against the source and linted.

The session **completed its task**: ~20 nodes across a 2-variant COMPONENT_SET and a scene COMPONENT, 5 component properties defined and bound, all colour/radius/spacing bound to variables, 4 annotations written, `lint` clean of exact matches. The cost shape is what is interesting — **29 of 53 Figmagent calls (54.7%) were `run_script`, the highest share on record**, beating session 53's 44.6% set two minutes earlier on the same file.

## Metrics

| Metric | Session 53 | This Session | Change |
|---|---|---|---|
| Total tool calls | 86 | 73 | −15% (smaller task) |
| Figma tool calls | 65 | 53 | −18% |
| Official-MCP calls | 0 | **0** | held (**8th consecutive session**) |
| Hard errors | 21 | 9 | −12 |
| Figma error rate | 32.3% | **17.0%** (9 of 53) | **−15.3pp** |
| Unflagged soft failures | 4 | 2 | −2 |
| `run_script` share of Figma calls | 44.6% | **54.7%** (29 of 53) | **+10.1pp — new record** |
| `run_script` share of write operations | 100% | **74%** (17 of 23) | −26pp |
| ToolSearch | 4 (4.7%) | 2 (2.7%) | −2.0pp |
| Estimated waste % | ~36% | **~34%** (25 of 73) | −2pp |

Waste composition (25 calls): 9 hard errors · 8 recovery/diagnosis calls caused by them (#19, #33, #40, #42, #45, #68, #70, plus one screenshot retry) · 2 soft-failure calls (#39, #67) · 3 dark-mode misfire repairs (#59, #60, #61) · 5 `run_script` discovery calls that duplicated `get_design_system` (#20, #21, #22, #27, #66).

## Tool Call Distribution

| Tool | Calls | Errors | Notes |
|---|---|---|---|
| `run_script` | 29 | 4 | 54.7% of Figma calls — **highest share in 54 sessions**; 17 in `mode: "write"` |
| Bash | 18 | 0 | source reading (`AlertDialog.tsx/.scss/.stories.tsx`, token JSON) + memory writes |
| `screenshot` | 8 | 3 | [BUG-016] 16th recurrence; 5 succeeded |
| `read` | 5 | 0 | used well — orientation + one structural verify |
| `set_multiple_annotations` | 3 | 0 | 4 annotations, no failures |
| ToolSearch | 2 | 0 | one 12-tool opening slice, one 2-tool top-up |
| `component_properties` | 2 | 0 | 5 properties defined, then bound — clean |
| `edit` | 2 | 1 | the failure is [BUG-032]'s pre-fix message |
| `use_file` / `write` / `combine_as_variants` / `lint` | 1 each | 0/0/1/0 | |

## Efficiency Issues

### 1. A raw `clone()` inside `run_script` silently escaped to the wrong page (costs ~3 calls)

The sharpest self-contained finding in the session, and it is a clean argument for the first-class surface.

**Pattern observed.** Call #31 cloned the `State=Default` COMPONENT inside a script:

```js
const P = await figma.getNodeByIdAsync("23:3");
const F = P.clone();
F.name = "State=Focused";
F.x = 0; F.y = P.height + 80;      // positioned as if it were beside P
```

`#32 combine_as_variants({componentIds: ["23:3","24:2"], parentId: "3:678"})` then failed. `#33` diagnosed it:

```
current: "0:1 Cover",  aParent: "3:678 PAGE",  bParent: "0:1 PAGE"
```

The clone had landed on the **Cover** page. `#34` repaired it with `page.appendChild(F)` before re-combining.

**Root cause.** Figma's `clone()` appends to `figma.currentPage`, and on the remote transport `currentPage` is whatever page the file was last left on — here `0:1 Cover`, never the page being written to. Every *other* write script in the session opened with a three-line `setCurrentPageAsync` preamble; **#31 is the only one that did not**, which is exactly why it broke. This is [BUG-018]'s root condition (`currentPage` does not persist between remote calls, confirmed in session 52) surfacing at a new call site.

**Figmagent's own clone path already guards this.** `cloneNode` (`src/figma_plugin/src/commands/modify.js:487-491`) does `node.parent.appendChild(clone)`, and `cloneAndModify` (`:518-521`) does the same. A `write({ fromNodeId: "23:3", parentId: "3:678" })` would have been correct by construction. The escape hatch has no equivalent — `fig.*` exposes no clone helper and the `run_script` description says nothing about it.

**Estimated savings:** 3 calls per occurrence, plus a class of silently-misplaced nodes. Filed as **[AGENT-033]**.

### 2. `combine_as_variants` lets Figma's raw page-mismatch error through (costs ~2 calls)

`combineAsVariants` (`src/figma_plugin/src/commands/components.js:34-76`) pre-checks three things — node exists, node is a COMPONENT, name is in `Property=Value` form — each with a `fail(message, fix)`. It does **not** check that the components share a page with the parent, so Figma's own message escapes verbatim:

```
Error combining as variants: Error: in combineAsVariants: Grouped nodes must be in the same page as the parent
```

No stated fix, in a codebase whose stated rule is *"No user-facing error without a stated fix."* The information needed for a perfect fix line is already in hand at that point in the function: the component's parent page, the target parent's page, and the remedy (`write({fromNodeId, parentId})`, or pass a parent on the component's own page). Filed as **[BUG-036]**.

### 3. Six calls to look at one component in dark mode

Checking a two-mode design system in its second mode is a routine review action with no first-class support. `setExplicitVariableModeForCollection` / `clearExplicitVariableModeForCollection` appear **nowhere** in the repository, so the sequence was:

| # | Call | Purpose |
|---|---|---|
| 57 | `run_script` | `setExplicitVariableModeForCollection(…, "2:0")` — Dark |
| 58 | `screenshot` | looked wrong — popup floating on nothing |
| 59 | `run_script` | diagnose: scene fill is `visible: false` |
| 60 | `run_script` | repair: make the fill visible |
| 61 | `screenshot` | re-verify |
| 62 | `run_script` | `clearExplicitVariableModeForCollection` + tidy |

Calls #59/#60 exist because of a second, independent trap: the scene was built with `figma.createComponent()` (#38), and the agent's `paintVar` helper bound a variable onto the node's **existing** paint — inheriting its `visible: false`. The colour bound correctly and could never render. `write`/`edit` have a `fill_not_applied` assertion for exactly this shape of mistake; `run_script` has no assertion layer at all ([TOOL-033]).

**Estimated savings:** a `variableModes` field on `edit` (set and clear) turns 6 calls into 2. Filed as **[TOOL-038]**; the invisible-paint case is added to [TOOL-033].

### 4. Five `run_script` calls re-implemented `get_design_system`, which was never called

`get_design_system` was not invoked once this session. In its place:

- **#20, #21, #22** — three scripts filtering `getLocalVariablesAsync()` by regex for `alert-dialog|backdrop|button|border/width` names. This is `get_design_system({ namePattern })`, which exists and returns the same `VariableID:…` strings the scripts needed.
- **#27, #66** — two scripts dumping text-style `fontName` / `fontSize` / `lineHeight` / `letterSpacing` / `boundVariables`. `getStyles` (`src/figma_plugin/src/commands/styles.js:140-157`) already returns **every one of those fields**, `boundVariables` included.

The monoculture also produced its own signature failure at **#69**, where the script called `figma.grepNodes(...)`:

```
TypeError: figma.grepNodes: no such property 'grepNodes' on the figma global object
```

— the agent reaching for Figmagent's `grep` semantics *inside the VM* rather than as a tool call. This is [AGENT-025] in a form the entry has not recorded before: not a capability gap, and not laziness, but a session so far inside `run_script` that the first-class surface stopped being visible as an option.

**Estimated savings:** ~5 calls. Recurrence logged on [AGENT-025].

## Error Analysis

### 1. [BUG-016] 16th recurrence — 3 screenshot failures, 2 more small-node falsifications (3 calls)

| # | Call | Node geometry | Result |
|---|---|---|---|
| 47 | `screenshot({nodeIds: ["24:11","24:12"], scale: 0.75})` | — | `Exported 0 node(s): none` — **no `Errors:`, no `Returned no image data`, no fix text** |
| 48 | `screenshot({nodeId: "24:11", scale: 0.6})` | **560 × 456** (measured by `read` #50) | "exceeded the ~4MB return cap" |
| 49 | `screenshot({nodeId: "23:3", scale: 1})` | **480 wide** COMPONENT | same |

Two new size falsifications: a **336 × 274** render (#48) and a 480-wide single component (#49) are three orders of magnitude under the cap the guard text names. The **batch signature recurs a 6th time** — `allIds`, `ids` and `dataless` empty at once, which the plugin loop cannot produce and `remote/client.ts:110-114` predicts exactly.

**The no-fix-text hole ([BUG-016] v5 item 2b) is confirmed from a 5th input path.** `buildBatchExportResult` (`export.ts:70-105`) emits `OVERSIZED_FIX` only inside `if (dataless.length > 0)`. With an empty `images` map the agent received `Exported 0 node(s): none` and `isError: true` and nothing else — and immediately began laddering `scale` on singles, which is the [AGENT-031] pattern arriving *because* the message that would have redirected it was absent.

**Agent recovery was the best on record for this bug.** Three failures, then a switch to `read(detail: "layout")` for structural verification (#50), then `screenshot` at `scale: 0.5` on a different node — which worked, and worked **5 more times** across the rest of the session (#54, #55, #58, #61, #71). No retry storm, no `ToolSearch` for the competitor, **zero official-Figma-MCP calls**. The behavioural half of the v3 fix now holds across **8 consecutive sessions and 4 distinct projects**.

One [AGENT-031] blemish: the ladder ran 0.75 → 0.6 → **1.0**, i.e. the third rung went *up*. Consistent with the entry's thesis that `scale` is not the governing variable and the agent had no model for what was.

### 2. [BUG-033] recurrence — custom fonts absent on remote, and a better remedy than the one we ship (4 errors, ~7 calls)

Second consecutive session on this file, same root cause: `PP Neue Montreal` — the family behind every text style and `font/family/*` variable in Archer — does not exist in the headless VM. Confirmed directly at #40 (all three faces `The font family "PP Neue Montreal" does not exist`, `avail: []`) and #42 (**8,927** fonts in the VM, zero matching).

It broke four operations, two of them **silently**:

- **#39** (soft, `is_error: false`) — `setTextStyleIdAsync` on all 8 TEXT nodes returned `"23:4 FAIL … unloaded font"` ×8. Every operation failed; the call reported success.
- **#41** (hard) — `edit({textStyleId})` × 2, the **pre-fix [BUG-032] message**: `Text style not found or not cached: S:b1b8…` on a style ID that `figma.getStyleByIdAsync` had resolved fine 5 minutes earlier (#27). This session is the second independent instance of the exact defect BUG-032 was filed for.
- **#43, #44** (hard) — `set_lineHeight` / `setBoundVariable` throwing `unloaded font "Noto Looped Thai Bold"` and `"PP Neue Montreal Bold"`.
- **#67** (soft, `is_error: false`) — both nodes returned `how: "FAIL async=… | sync=…"` and `style: ""`.

**What is new: the agent found a strictly better remedy than the one we now ship.** BUG-032's fix has since landed (`apply.js:328-336`) and tells the agent, on an unloadable style font, to *"skip `textStyleId` and set the type directly with `edit` (`fontFamily` … plus `fontWeight`/`fontSize`), then re-bind the `fontFamily` variable last."* Call **#68** did something else — it swapped the **style's own** `fontName` to an available family, applied the style, then re-bound the style's `fontFamily` variable:

```
before: { face: "PP Neue Montreal/Regular", bv: {fontSize, fontFamily, fontWeight} }
after:  { face: "PP Neue Montreal/Regular", bv: {fontSize, fontFamily, fontWeight} }
applied: ["23:5 style=set", "24:4 style=set"]
```

The style link is **kept**, the family comes back, and every node on the style is fixed at once instead of one at a time. The shipped remedy does the opposite — it abandons the style for per-node font properties, which is precisely what **[AGENT-032]** ("put text on text styles, not per-node font properties — styles self-heal, nodes do not") was filed the previous session to forbid. Two tracker entries written from the same file, 48 hours apart, currently give opposite advice. Filed as **[BUG-037]**.

### 3. `figma.currentPage = p` — unsupported setter (1 call)

`#18` assigned `figma.currentPage` directly; the VM rejected it with its own fix (`Use await figma.setCurrentPageAsync(page)`), and `#19` succeeded. Cheap and self-correcting, but it is the third distinct page-handling stumble in one session (#18, #31/#32, and the `setCurrentPageAsync` preamble copy-pasted into 14 separate scripts) — supporting evidence for **[TOOL-023]**, which would remove page handling from script authorship entirely.

## What Worked Well

1. **`component_properties` — 2 calls, 5 properties, zero errors.** `#36` defined `Title` (TEXT), `Description` (TEXT), `Show Description` (BOOLEAN), `Cancel Label`, `Confirm Label`; `#37` bound them to the corresponding nodes on both variants. This is the atomic multi-step operation [AGENT-025] keeps saying `run_script` is needed for — here a first-class tool did it cleanly, twice.
2. **Annotation quality.** `set_multiple_annotations` (#51, #52, #72) carried real source provenance — CSS selector, React component, the file it lives in, and the declarations that produced each Figma property (`position: fixed; inset: 0` → the absolute-positioned STRETCH backdrop). Three calls, four annotations, no failures.
3. **`read` used for orientation, then trusted.** Five calls, zero errors, and `#50` (`detail: "layout", depth: 4`) is what replaced the failed screenshots — a structural verify instead of a retry storm. Compare session 44, where an unhelpful `read` ended `read` usage for 2h45m.
4. **`write`'s mini-lint fired and was acted on.** `#29`'s response carried `[unbound_value] 23:3: fill #f3f2f2 matches variable color/neutral/100` and `cornerRadius 8 matches radius/4`; `#30` bound both. The one `write` call in the session paid for itself.
5. **Post-build `lint`** (`#53`, both roots in one call) returned 6 `near_match` and **0 `exact_match` / 0 `ambiguous`** — the build was genuinely bound, not merely believed to be.
6. **Learnings written to persistent project memory** (#63, #64, #65, #73) — the Archer file's variable/style/component inventory and the remote-VM font gotchas, including the working style-face-swap technique.

## Priority Improvements

### Tool Changes (ranked by call savings)

1. **`screenshot` / `remote/client.ts:110-114`** — [BUG-016] v5, unchanged and now at 16 recurrences. **Ship item (2b) alone if nothing else**: `buildBatchExportResult` must state a fix when `images` is empty. Three lines; this session is the 5th input path to hit the hole, and the missing text is what launched the `scale` ladder. ~3–6 calls/session.
2. **`edit({ variableModes })`** — set and clear a collection's explicit mode on a node. Turns "show me this in dark mode" from 6 calls into 2. **[TOOL-038]**, ~4 calls per themed-review session.
3. **`combine_as_variants` page pre-check** — one comparison, one `fail(message, fix)`, in a function that already has three such checks. **[BUG-036]**, ~2 calls per occurrence.
4. **`edit({ effects })`** — `effectStyleId` is supported, raw `effects` are not, so a variable-bound drop shadow (`setBoundVariableForEffect`) must go through `run_script`. **[TOOL-039]**, ~1–2 calls per component with elevation.
5. **Correct BUG-032's shipped remedy text** to the style-face-swap, not "skip `textStyleId`". **[BUG-037]** — no new capability, and it stops `edit` from advising the thing [AGENT-032] forbids.
6. **An `invisible_paint_binding` assertion** — binding a variable to a paint with `visible: false` produces a colour that can never render. Added to **[TOOL-033]**, ~3 calls.

### Agent Skill Updates

1. **Never use raw `clone()` in `run_script`** — it parents to `figma.currentPage`, which on remote is not the page you are writing to. Use `write({ fromNodeId, parentId })`, or `appendChild` to an explicit parent immediately after cloning. **[AGENT-033]**.
2. **Reach for `get_design_system` before scripting variable/style discovery** — it already returns variable IDs by `namePattern` and full text-style specs including `boundVariables`. Five scripts this session re-implemented it. [AGENT-025].
3. **On the remote transport, repair the STYLE, not the nodes** — when a text style's font is unavailable, swap the style's own `fontName` to an available family, apply, then re-bind the style's `fontFamily`. Fixes every node on the style at once and keeps the style link. [BUG-037], [AGENT-032].
4. **[AGENT-031] holds**: after two `screenshot` failures, stop changing `scale` and change the target — a child node, or a structural `read`. This session did switch to `read`, but only after a third rung that went the wrong way.
