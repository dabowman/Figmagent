# Figma MCP Session 53 Analysis

## Session Overview

- **Transcript**: `.claude/sessions-json/8ecb5292-12a8-4c69-848d-7aec4a9db1fd.json`
- **Duration**: 37 minutes (2026-09-01 22:16 → 22:52 UTC)
- **Total tool calls**: 86 (65 Figmagent, 15 Bash, 4 ToolSearch, 2 AskUserQuestion)
- **Total errors**: 21 hard (`is_error: true`) + 4 unflagged soft failures
- **Re-analysis note**: this document originally covered calls #1–#67. The session continued for a further 19 calls (#68–#86, 18 minutes) after the first analysis was written; that segment is analysed in **"Second half"** below and produced the session's most consequential findings.
- **Reconnections**: 0 (1 `use_file`, 1 `reauthenticate`)
- **Context restarts**: 0
- **Transport**: remote
- **Project**: external `~/Github/storybook` — **first analysed session on this project**; Figma file `C4zLeQJs8qkAhFSLwMKP9J` ("Archer")
- **Task**: mirror the Storybook `Accordion` component (Base UI + `config/*.tokens.json`) into the Archer Figma file — an 8-variant `Accordion Item` COMPONENT_SET (`Open` x `State`) plus an assembled `Accordion` COMPONENT, bound to `accordion/*` variables; then create the 12 system type styles as Figma text styles bound to font primitives; then bind `font/weight/semibold` to the 8 trigger labels — which is where the session's central defect surfaced.

## Metrics

| Metric | Session 52 | This Session | Change |
|---|---|---|---|
| Total tool calls | 233 | 86 | −63% (smaller task) |
| Figma tool calls | 194 | 65 | −66% |
| Official-MCP calls | 0 | **0** | held (7th session) |
| Hard errors | 34 | 21 | — |
| Figma error rate | 16.0% | **32.3%** (21 of 65) | +16.3pp |
| Estimated waste % | ~21% | **~36%** (31 of 86) | +15pp |
| ToolSearch calls | 4 (1.7%) | 4 (4.7%) | +3.0pp |
| `run_script` share of figma calls | 27% | **44.6%** (29 of 65) | +17.6pp |
| `run_script` share of write ops | 100% | **100%** (0 `write`, 4 `edit` all failed) | held |

Highest `run_script` share on record, and the highest waste percentage since session 6. Five distinct defects account for 29 of the 31 wasted calls, and none of them are agent error.

## Tool Call Distribution

| Tool | Calls | Errors | Notes |
|---|---|---|---|
| `run_script` | 29 | 8 hard + 4 soft | 100% of write operations; 13 of 29 were diagnostic |
| `screenshot` | 16 | 7 | **43.8% failure rate** — [BUG-016] 15th recurrence |
| Bash | 15 | 0 | component source, token JSON, and (#78–#82) reading Figmagent's own plugin source |
| `read` | 6 | 1 | 1 blocked by edit-access; 1 returned 1 page for a ~40-page file |
| AskUserQuestion | 2 | 0 | both well-formed; #85 got a direction change from the user |
| `get_design_system` | 5 | 1 | filtered queries worked well once authed |
| `edit` | 4 | **4** | **100% failure rate** — all four blocked by a misreported font error |
| ToolSearch | 4 | 0 | deferred-tool project; 6.0% overhead |
| `use_file` | 1 | 0 | URL form accepted; `node-id` fragment ignored |
| `reauthenticate` | 1 | 0 | resolved the edit-access wall in one call |
| `get_local_components` | 1 | 0 | `{"count":0}` |
| `lint` | 1 | 0 | 14 near-match issues, 0 auto-fixed |
| `grep` | 1 | 0 | clean — located 12 TEXT nodes across 8 variants in one call |

## Efficiency Issues

### 1. `edit` misreports an unloadable font as a missing text style (saves ~6 calls) — [BUG-032]

`edit({ textStyleId })` failed four consecutive times on a style ID that **`get_design_system` had returned 9 seconds earlier**:

```
{"success":false,"nodesEdited":0,"totalNodes":4,"failures":[
  {"nodeId":"11:32","error":"Text style not found or not cached: S:1ae6a2e7ba3e6949ffed2681446e6c6c2b397a0a,"}, …]}
```

**Pattern observed:** the agent read the message literally and concluded the ID was malformed, then spent four calls permuting the ID format — with the trailing comma (#61), without it (#62), re-fetching the full style list to confirm the exact string (#63), re-sending the comma form as a batch (#64), and finally the bare key with no `S:` prefix (#65). Every one returned the identical error. It then abandoned `edit` and did the work in `run_script` (#66, #67).

**Root cause** — pinned to two lines in `src/figma_plugin/src/commands/apply.js`:

```js
// line 856-869 — style pre-load
try {
  const style = await figma.getStyleByIdAsync(styleKeys[i]);
  if (style && style.type === "TEXT") {
    if (style.fontName) await figma.loadFontAsync(style.fontName);   // <- THROWS
    styleCache[styleKeys[i]] = style;                                 // <- never reached
  } …
} catch (_e) {
  // Style load failure will be caught per-node later
}

// line 200-201 — per-node
const style = styleCache[styleId];
if (!style) throw new Error("Text style not found or not cached: " + styleId);
```

The style resolved fine. `loadFontAsync({family:"PP Neue Montreal", style:"Regular"})` threw because that font does not exist in the remote VM (see issue 2). The bare `catch (_e)` swallows the font error, the style never enters `styleCache`, and the per-node check then reports a **found** style as *not found*. The comment on the catch — "will be caught per-node later" — is the bug: what is caught per-node is a different, false claim.

**Proposed fix:** record the failure reason instead of discarding it — `styleErrors[id] = e.message` in the catch, and have `applyTextStyle` throw `fail(styleErrors[styleId] || "Text style not found: " + styleId, <fix>)`. Same shape for `applyEffectStyle`. This is the project's own "no user-facing error without a stated fix" rule applied to an error that currently states a *wrong* cause.

**Estimated savings:** 6 calls → 1 (a correct first error), and it keeps the agent on `edit` instead of defecting to `run_script`.

### 2. The remote VM cannot load the file's own custom font (saves ~7 calls) — [BUG-033]

`listAvailableFontsAsync()` (#21) returned **zero** matches for `PP Neue Montreal` — the font every text style, `font/family/*` variable and TEXT node in this file references. 1,938 fonts were available (#22); the file's own was not among them.

**Pattern observed:** this broke five separate operations, each discovered independently:

| Call | Operation | Failure |
|---|---|---|
| #20 | `set_textAutoResize` on a new TEXT node | `unloaded font "PP Neue Montreal Regular"` |
| #23 | same, Semi Bold | `unloaded font "PP Neue Montreal Semi Bold"` |
| #25 | `setBoundVariable("fontFamily", …)` | soft — 2 of 12 binds silently in a `warnings` array, `is_error: false` |
| #55 | text-style `setBoundVariable` | `unloaded font "PP Neue Montreal Medium"` |
| #66 | `setTextStyleIdAsync` | soft — 4 of 4 `FAILED`, `is_error: false` |

**Root cause:** the headless `use_figma` VM has no access to fonts installed on the user's machine or licensed to the Figma desktop client. Any file using a non-Google/non-system typeface is affected — which is most design-system files.

**The verified workaround the agent found (#67), worth documenting:** the *binding* survives even though the font cannot render. Temporarily set the target (node or style) to an available font, perform the write, then re-bind the `fontFamily` variable last:

```js
// swap style to Inter → setTextStyleIdAsync on all 4 nodes → rebind fontFamily variable
// verify: "11:32 style=body/1 font=PP Neue Montreal Regular size=14"
```

The agent independently rediscovered a weaker version of this at #24 ("binding fontFamily last so text writes happen while Inter is loaded") and #40 (a repair pass that re-bound the 2 fonts dropped at #25) before landing on the full form.

**Proposed fix:** (a) in `helpers.js`'s font loader, when `loadFontAsync` throws, check `listAvailableFontsAsync` and `fail()` with the real cause — *"font X is not available in the remote VM; write with an available font and bind `fontFamily` afterwards"*; (b) document the swap-write-rebind pattern in the `run_script` and `edit` descriptions; (c) never report a dropped `fontFamily` bind inside a `warnings` array on an `is_error: false` response (#25, #66 — see issue 5).

**Estimated savings:** ~7 calls per session on any custom-font file; unblocks the entire typography path on remote.

### 3. `run_script` does not document the remote VM's missing APIs (saves ~3 calls)

Two full write-script attempts died on the first line for a reason no description states:

- #18 — `figma.loadAllPagesAsync()` → `"loadAllPagesAsync" is not a supported API`
- #24 — `figma.createNodeFromSvgAsync()` → `no such property 'createNodeFromSvgAsync' on the figma global object`

Both scripts were substantial (the #24 attempt was the full 8-variant builder). Both were `mode: "write"` and atomic, so nothing was applied — the loss is the whole authoring round trip.

`loadAllPagesAsync` was already recorded as a sub-finding under [BUG-014] after session 45 and was never added to the description. `createNodeFromSvgAsync` is new (the **sync** `createNodeFromSvg` exists; only the async variant is absent).

**Proposed fix:** add a "Remote VM API gaps" block to `script.ts`'s description beside the existing `?.` / `??` / object-spread constraints: no `loadAllPagesAsync` (loop `await page.loadAsync()`), no `createNodeFromSvgAsync` (use sync `createNodeFromSvg`), and custom fonts are unavailable (issue 2).

**Estimated savings:** ~3 calls, and the failures are the expensive kind — a full builder script re-authored.

### 4. `run_script` used for work `create_styles` already does (recurrence)

Calls #54–#57 created 12 text styles bound to font primitives via `run_script` — including a failed round (#55) and a repair round (#56). `create_styles` supports exactly this, documented at `tokens.ts:649-662`:

```
{ type: "TEXT", name: "Body/MD", fontFamily: "Inter", fontStyle: "Regular", fontSize: 16, lineHeight: 24,
  variables: { fontSize: "VariableID:abc", lineHeight: "VariableID:def" } }
```

The agent ToolSearched `create_styles`/`update_styles` at **#58** — *after* the styles were already built — and then never called them.

**Root cause:** the opening `ToolSearch` (#2) selected 12 tools by name: `use_file, read, write, edit, grep, get_design_system, screenshot, get_local_components, combine_as_variants, component_properties, lint, set_focus`. `create_styles`, `create_variables` and `update_styles` were not among them. In a deferred-tool project the agent builds with whatever slice it guessed in minute 1; anything omitted effectively does not exist until something forces a second search. `run_script` was loaded at #17 and became the default from there.

**Proposed fix:** agent-side — when a task involves creating styles or variables, ToolSearch the `tokens` domain before reaching for `run_script`. This is the [AGENT-026] pattern with a new, concrete trigger (deferred-tool discovery order rather than tool ignorance).

**Estimated savings:** ~3 calls, and it would have surfaced issue 2 through a tool that loads fonts explicitly rather than through a bare `catch`.

### 5. Two write failures shipped as successes

- **#25** — `{"boundTexts": 12, "warnings": ["Label.fontFamily: … unloaded font", "Content.fontFamily: … unloaded font"]}`, `is_error: false`. Two of twelve bindings did not happen; the count says twelve.
- **#66** — all four `applied` entries begin `"11:32 FAILED: …"`, and the script's own `verify` block confirms `styleId=none` on every node. `is_error: false`.

The agent caught both only because it had written its own verify blocks into the scripts. [TOOL-033] already records that `run_script` bypasses the assertion layer; this session shows the second-order cost — the agent must hand-write per-script verification, and when it does not (#25), the failure survives 15 calls until a repair pass (#40) finds it.

## Second half (#68–#86): the `fontWeight` binding

The first 67 calls built the component and hit the font wall. The last 19 chased one
question to the bottom: **why does binding a weight variable to a TEXT node do nothing?**
The answer is three separate defects stacked on each other, and the segment is worth
reading as the session's real result.

### 6. `edit` cannot bind `fontWeight`, and its rejection states a false reason (saves ~6 calls) — [TOOL-037]

`apply.ts:45-46` and `:207` both assert:

> `fontWeight` is a number, settable directly but **not bindable** — font weight binds
> through `fontStyle` (a STRING variable holding e.g. 'Bold').

**This session disproves that.** The Archer file's design system binds a **FLOAT**
variable `font/weight/semibold` (`VariableID:2:450`) to `fontWeight` on TEXT nodes, and
the Figma API accepts it:

- #70 — `n.setBoundVariable('fontWeight', semibold)` on all 8 Label nodes: `failed: []`,
  and the verify block lists `fontFamily,fontSize,fontWeight` for every one.
- #73 — the raw dump reads `boundVariables` back containing `fontWeight` alongside
  `fills`, `fontSize` and `fontFamily`.
- #72 — Figmagent's **own** `read(detail: "full")` resolves it into `defs.vars` as
  `v4: VariableID:2:450`. The serializer reports a binding the writer refuses to make.
- #84 — three of the eight labels resolve to `w=600` from that binding.

**Root cause is two lines, not a Figma limitation:**

```js
// src/figma_plugin/src/commands/styles.js:1166-1168 — FIELD_MAP
  fontSize: "fontSize",
  fontFamily: "fontFamily",
  fontStyle: "fontStyle",     // <- no fontWeight entry
```

`apply.js:227-229` rejects anything missing from `FIELD_MAP`; `apply.ts`'s
`variableFieldEnum` omits it in the same shape one layer up. So the field is blocked
twice and explained once, wrongly.

**Cost:** every weight binding in this session went through `run_script` — #70, #71,
#75, #76, #77, #83, six calls `edit` could have carried as one batch. It also sent the
[BUG-030] fix in the wrong direction: that entry accepted "not bindable" as fact and
shipped an alias message teaching agents to bind `fontStyle` instead. `fontStyle` binding
is a *different* operation (a STRING face literal, not a weight lookup) and would not
have produced what this file's tokens describe.

**Proposed fix:** add `fontWeight: "fontWeight"` to `FIELD_MAP`, add `"fontWeight"` to
`variableFieldEnum`, delete the `VARIABLE_FIELD_ALIASES.fontWeight` entry and the
parenthetical in the `variables` description. Keep [BUG-030]'s other two remedies (enum
dump size, whole-batch discard) — those were correct.

### 7. A `fontWeight` binding made from the remote VM is inert — bound but unresolved (saves ~7 calls) — [BUG-034]

Figma's `fontName` is `{family, style}`. Only `family` is variable-backed; `style` is a
plain literal. Binding `fontWeight` does not store a number — it runs a
**family + weight → face lookup** and rewrites that literal. The lookup fires on a
binding-change event *in a client that can enumerate the family's faces*. The headless VM
cannot (see issue 2), so it silently no-ops and the node keeps the **authoring** font's
face-name spelling.

The spelling is the trap: Inter spells 600 `Semi Bold`, PP Neue Montreal spells it
`Semibold`. Nodes authored on Inter land on `Semi Bold` — a face PP Neue Montreal does
not have. Figma renders them at 400 and shows the weight variable struck through.

**#84 is the measurement:**

```
Open=False, State=Default  | 11:4  | PP Neue Montreal Semibold  | w=600   ← resolved
Open=False, State=Hover    | 11:10 | PP Neue Montreal Semibold  | w=600   ← resolved
Open=False, State=Focused  | 11:16 | PP Neue Montreal Semibold  | w=600   ← resolved
Open=False, State=Disabled | 11:22 | PP Neue Montreal Semi Bold | w=400   ← bound, inert
Open=True,  State=Default  | 11:28 | PP Neue Montreal Semi Bold | w=400   ← bound, inert
Open=True,  State=Hover    | 11:36 | PP Neue Montreal Semi Bold | w=400   ← bound, inert
Open=True,  State=Focused  | 11:44 | PP Neue Montreal Semi Bold | w=400   ← bound, inert
Open=True,  State=Disabled | 11:52 | PP Neue Montreal Semi Bold | w=400   ← bound, inert
```

**Five of eight nodes are bound to a 600 variable and report `fontWeight: 400`.** The node
contradicts itself, and nothing in the response says so — #70 returned `failed: []` with
all eight listed as bound.

**#71 is the cleanest control this class of bug has had.** Four unbind/rebind cycles on a
single node, `attempts: []` (zero exceptions thrown), face unchanged. A silent no-op
wearing a success shape.

**The workaround, verified in one call (#83):** the lookup fires on a *family* change.
Bind `fontFamily` to a different family variable, then back:

```
before: Semibold/600
  toSerif  → PP Editorial Old Semibold/600
  toSans   → PP Neue Montreal Semibold/600      ← re-resolved
```

Worth noting how the agent got there: after #75/#76/#77 failed to rebuild the nodes from
scratch, it stopped permuting the write and went and **read Figmagent's own source**
(#78–#82, five Bash calls) to find out what the tool actually did with a weight. That is
[AGENT-029] executed correctly — the fourth failure triggered a change of strategy, not
another parameter.

**Proposed fix:** a `fontWeight` bind whose face does not resolve must not return
`is_error: false`. After binding, compare `node.fontWeight` against the variable's
resolved value and, on a mismatch, either apply the family-toggle re-resolution
automatically or `fail()` with it as the stated fix.

### 8. The weight → face table is Inter-spelled, in three places, and misses silently (saves ~3 calls) — [BUG-035]

```js
// src/figma_plugin/src/helpers.js:122-132   (FONT_WEIGHT_STYLES, exported as fig.loadFont)
// src/figma_plugin/src/commands/apply.js:838-848   (a local duplicate)
// src/figma_plugin/src/commands/create.js:106      (imports the helpers one)
  600: "Semi Bold",  700: "Bold",  800: "Extra Bold",
```

Every one of those spellings is Inter's. PP Neue Montreal uses `Semibold` and `Extrabold`;
other families use `SemiBold` or `DemiBold`. On a miss, `loadFontWithFallback`
(`helpers.js:146-152`) catches and returns **Inter Regular** with no warning, and
`create.js:108-123` does the same. The agent read both (#81, #82) and wrote the conclusion
into project memory: *"never let a numeric weight choose a face."*

The `font_fallback` post-write assertion (`assertions.js:155-173`) does not cover this —
it compares `fontName.family` only, so a wrong **face inside the right family** never
warns. And `run_script`, which is where all of this session's writes happened, has no
assertion layer at all ([TOOL-033]).

This is [BUG-007]'s root cause — marked `implemented (bda7a09)`, and its description names
*"'Semi Bold' vs 'SemiBold' mismatches are swallowed"* — still present in all three
copies. The `create` symptom was fixed; the shared table underneath it was not.

**Proposed fix:** collapse the three tables to one, and on a miss enumerate the family's
real faces via `listAvailableFontsAsync` and pick by proximity before falling back —
`fail()`ing with the family's actual face names rather than silently landing on Inter.

### 9. Text styles self-heal; individual nodes do not — [AGENT-032]

The same #84 call read the 12 text styles back:

```
body/1    | PP Neue Montreal Regular      body/3    | PP Neue Montreal Semibold
body/2    | PP Neue Montreal Medium       heading/1 | PP Neue Montreal Extrabold
```

**Every style resolved to a correct face on its own** — including `Semibold` and
`Extrabold`, the two spellings the VM had gotten wrong on nodes — because a client that
*does* have the font re-fires the lookup when the style is opened. Face correctness on
styles is a 12-place problem Figma fixes itself; on nodes it is an N-node problem needing
manual re-picks.

This is the session's most transferable lesson and the user reached it independently at
#85: *"let's stick with the remote transport and use the type styles that apply properties
correctly, that's what we should be doing anyways."*

**Agent rule:** on the remote transport, put text on **text styles**, never per-node font
properties. Bind the primitives once on the style; let instances inherit.

## Error Analysis

### 1. `screenshot` — 7 of 16 failed (43.8%), ~8 calls lost — [BUG-016] 15th recurrence

Two shapes, both already tracked:

**(a) Single-node, the "~4MB cap" guard text** — #26 (`11:59`, scale 2), #27 (scale 1), #30 (scale 2), #31 (`format: "SVG"`), #43 (`11:58`, scale 0.5). Byte-identical message every time.

**(b) Batch, no fix text at all** — #34 (`["11:26","11:10","11:18"]`) and #36 (`["11:26","11:8","11:14","11:20"]`) both returned exactly `Exported 0 node(s): none`. Every one of those node IDs then exported **individually and cleanly** at the same `scale: 1` (#37, #38, #44, #48). This is the `buildBatchExportResult` hole (`export.ts:70-105`) confirmed from a **third and fourth input path**.

**This session contributes the first in-VM measurement of what the plugin actually produced.** After four failures the agent ran a diagnostic script (#32):

```js
const out = {};
try { const b = await acc.exportAsync({ format: 'PNG' }); out.png = b.length; } …
// → { "png": 20113, "font": "{\"family\":\"PP Neue Montreal\",\"style\":\"Semi Bold\"} missing=true" }
```

**Figma rendered a 20,113-byte PNG for the node whose `screenshot` had just failed four times claiming the payload "exceeded the ~4MB return cap."** That is 0.5% of the stated cap. This is the [BUG-016] v4 `payloadChars` scalar, measured by hand, and it settles the question the last five sessions have circled: the render succeeds and the loss is downstream, in `remote/client.ts:110-114`. The guard text is not merely imprecise — on this evidence it is false in the one direction that costs calls.

**Agent recovery:** good. Four failures → one diagnostic script → switched to per-variant screenshots, which worked (#37, #38, #44, #45, #48) and carried the session's visual verification the rest of the way. **Zero official-Figma-MCP calls** — the behavioural fix holds a **7th session across a 4th project**, this one with no corrected memory file and no prior Figmagent history at all.

### 2. Edit-access wall → `reauthenticate` (2 failures, ~3 calls, ~1 min) — [BUG-015] recurrence

`read()` (#6) and `get_design_system()` (#7) both returned:

```
Looks like you don't have edit access to this file. The file owner can share it with you and make you an editor.
```

The cached remote token belonged to an identity without editor scope on this file. Recovery was the fastest on record for this bug: one `ToolSearch` for `reauthenticate` (#8), one call (#10), and the same `read` succeeded at #11. Total 3 calls.

**Fix needed:** the remedy is already documented in CLAUDE.md and worked verbatim — it just isn't in the error. Appending *"if the wrong Figma account is cached, run `reauthenticate` and pick an account with editor access"* to this error message removes the `ToolSearch` and the diagnosis step.

### 3. `read()` reports 1 page for a ~40-page file — [BUG-014] 8th recurrence, with a same-session control

`read()` (#11) returned:

```json
{"name":"Cover","id":"0:1","currentPage":{"id":"0:1","name":"Cover","childCount":1},
 "pages":[{"id":"0:1","name":"Cover","childCount":1}]}
```

Nine calls later, `run_script` (#19) enumerated `figma.root.children` in the same file, same session: `Cover, Accordion, Alert Dialog, Autocomplete, Avatar, Button, …` — a 2,054-char list. **`read` reported one page; the file has roughly forty.** This is the cleanest in-session control this bug has had: two calls, same file, 3 minutes apart, one truthful.

Cost here was small (the agent had the target page ID from the user's URL) but it is the reason `run_script` entered the session at call #19 and never left.

### 4. Three failed rebuild attempts, each on a different cause (#75–#77, ~4 calls)

Having found five labels stuck on an unresolvable face, the agent tried to replace them
outright. Each attempt died on a new obstacle:

| Call | Approach | Failure |
|---|---|---|
| #75 | `src.clone()` + `insertChild` | `unloaded font "PP Neue Montreal Semibold"` — [BUG-033]; a node carrying a missing font cannot be re-parented at all |
| #76 | build fresh TEXT on Inter, then bind | `setBoundVariable: fills and strokes variable bindings must be set on paints directly` — raw `setBoundVariable('fills', …)` is not the paint path |
| #77 | same, using `fig.bindVariable(t, 'fill', …)` | its **own** guard fired: `weight did not resolve on 6 node(s): Regular/400 ×6 — rolling back` |

All three were `mode: "write"` and atomic, so nothing was half-applied. #76 is worth
noting on its own: the stdlib's `fig.bindVariable` exists precisely because raw
`setBoundVariable` does not work for paints, and the agent found it only by failing first
— the `run_script` description does not say which fields need the helper.

#77 is the good outcome hiding in the group: the agent had written `if (bad.length) throw`
into its own script, so a build that would have shipped six 400-weight labels rolled
itself back instead. That is the assertion layer [TOOL-033] says `run_script` lacks, hand-
rolled — and it worked.

## What Worked Well

1. **`reauthenticate` is a one-call fix for the edit-access wall.** Third session in a row where it resolved [BUG-015] immediately. The tool is fine; only its discoverability from the error message is missing.
2. **Filtered `get_design_system` beat raising the budget.** Two `namePattern` queries (`^(color/(text|border|background)|radius|space|opacity|font|border-width|cursor)`, then `(accordion|borderWidth|border-width)`) pulled exactly the variables needed from a 28-variable collection in 2 calls. This is the documented pattern being followed correctly.
3. **Per-variant screenshots as a [BUG-016] workaround.** Once the parent COMPONENT would not export, the agent screenshotted individual variants (`11:26`, `11:14`, `11:8`, `11:50`, `11:20`) and kept a working visual channel — 5 clean exports where session 50 had none. It also got the parent at `scale: 0.5` on a later retry.
4. **`grep` did in one call what would have been eight.** `grep({scope:"11:58", name:"^(Label|Content)$", type:["TEXT"]})` returned all 12 TEXT nodes grouped by variant with IDs — exactly the input the following `edit` batch needed.
5. **Self-written verification inside scripts.** Every consequential `run_script` carried its own `verify` block reading state back. That is the only reason the #66 total failure was caught in one call rather than surviving to the end of the session.
6. **The agent wrote its findings to project memory mid-session** (#50, #51) — `figma-remote-vm-gotchas.md` covering fonts, opacity scaling, missing APIs and flaky screenshots. Session 45 showed memory encoding a *wrong* lesson (defect to the official MCP); here it encoded correct, transferable constraints — and **rewrote it at #86** once the second half changed the conclusion, replacing the provisional note with the face-resolution mechanism and the "use text styles, not per-node fonts" rule.
7. **Reading the tool's own source to diagnose the tool** (#78–#82). After three failed rebuilds, the agent stopped writing Figma scripts and went to `src/figma_plugin/src/helpers.js`, found `FONT_WEIGHT_STYLES` and the bare-`catch` fallback, and came back with a mechanism instead of another guess. Five cheap Bash calls replaced an unbounded retry loop — the strongest instance of [AGENT-029] across all 53 sessions.
8. **Self-written rollback guards caught a bad build** (#77). `if (bad.length) throw … — rolling back` stopped six mis-weighted labels from shipping. Agents working through `run_script` should write these by default until [TOOL-033] is closed.
9. **Both `AskUserQuestion` calls were well-formed and one changed the plan.** #85 offered a transport switch as the recommended option; the user declined it in favour of text styles, which was the better answer and is now the documented rule.

## Priority Improvements

### Tool Changes (ranked by call savings)

1. **`remote/client.ts:110-114`** — a `JSON.parse` failure must throw a fix-stating transport error, not silently return the raw string. Unchanged since session 47 pinned it; now supported by a direct in-VM measurement (20,113 bytes rendered, nothing delivered). Closes [BUG-016] and [BUG-027] in one commit. **~8 calls/session, 15 sessions deep.**
2. **`apply.js:856-869` + `:200-201`** — capture the pre-load failure reason and report it instead of "not found or not cached". A style that exists must never be reported as missing. **~6 calls/session.**
3. **Font-availability detection in the remote VM** — when `loadFontAsync` throws, check availability and `fail()` with the swap-write-rebind remedy. **~7 calls/session on any custom-font file.**
4. **`export.ts:70-105`** — a batch that exports zero nodes must state a fix. Three lines, independent of item 1, now confirmed from four distinct input paths. **~2 calls/session.**
5. **`export.ts:19-21`** — delete the "~4MB return cap" sentence and the `scale`/`SVG` remedies. This session is the seventh to watch an agent follow that text into a dead end, and the first to measure the true payload. **~3 calls/session.**
6. **`styles.js` `FIELD_MAP` + `apply.ts` `variableFieldEnum`** — add `fontWeight`, delete the alias that calls it unbindable. Two lines and a doc correction; unblocks weight binding through `edit` and retires a message that teaches a false fact. **~6 calls/session.**
7. **A `fontWeight` bind that does not resolve must not report success** — compare `node.fontWeight` to the variable's resolved value after binding; on a mismatch, apply the family-toggle re-resolution or `fail()` with it. **~7 calls/session on custom-font files.**
8. **`script.ts` description** — add the remote-VM API gaps block (`loadAllPagesAsync`, `createNodeFromSvgAsync`, custom fonts) and name the fields that need `fig.bindVariable` rather than raw `setBoundVariable` (`fills`, `strokes`). **~4 calls/session.**
9. **Collapse the three weight → face tables to one** (`helpers.js:122`, `apply.js:838`, `create.js:106`) and resolve faces against `listAvailableFontsAsync` instead of Inter's spellings. Closes [BUG-007]'s surviving root cause. **~3 calls/session.**
10. **Edit-access error text** — name `reauthenticate` in the message. **~2 calls/session.**

### Agent Skill Updates

1. **In a deferred-tool project, search the tool domain you are about to work in, not the one you started in.** The opening `ToolSearch` shapes the whole session; `create_styles` existed for 40 minutes before it was looked up, and by then `run_script` was the habit.
2. **A stated fix that fails once is a wrong diagnosis** ([AGENT-029], holding): the four `textStyleId` format permutations are the same anti-pattern as the `scale` ladder. Four identical errors on four different inputs means the error message is lying about the variable — change strategy, not parameters.
3. **On the remote transport, treat a custom font as unavailable until proven otherwise.** Write text with a system font and bind `fontFamily` last. Verified working in this session.
4. **Put text on text styles, not per-node font properties — especially on remote.** Styles re-resolve their own faces when opened in a client that has the font; individual nodes stay stuck on the authoring font's face-name spelling. #84 measured both in one call: 12 of 12 styles correct, 5 of 8 nodes wrong.
5. **After three failed writes, read the tool's source rather than writing a fourth.** #78–#82 turned an unbounded retry loop into a named mechanism in five Bash calls. The generalisation of [AGENT-029]: when the target will not move, stop varying the call and go find out what the call does.
6. **Verify a binding by its resolved value, not by its presence.** `boundVariables.fontWeight` being set says nothing about whether `fontWeight` is 600. Every `run_script` write should read back the property the binding was supposed to change.
</content>
