# Figma MCP Session 53 Analysis

## Session Overview

- **Transcript**: `.claude/sessions-json/8ecb5292-12a8-4c69-848d-7aec4a9db1fd.json`
- **Duration**: 18 minutes (2026-09-01 22:16 → 22:34 UTC)
- **Total tool calls**: 67 (54 Figmagent, 9 Bash, 4 ToolSearch)
- **Total errors**: 18 hard (`is_error: true`) + 2 unflagged soft failures
- **Reconnections**: 0 (1 `use_file`, 1 `reauthenticate`)
- **Context restarts**: 0
- **Transport**: remote
- **Project**: external `~/Github/storybook` — **first analysed session on this project**; Figma file `C4zLeQJs8qkAhFSLwMKP9J` ("Archer")
- **Task**: mirror the Storybook `Accordion` component (Base UI + `config/*.tokens.json`) into the Archer Figma file — an 8-variant `Accordion Item` COMPONENT_SET (`Open` x `State`) plus an assembled `Accordion` COMPONENT, bound to `accordion/*` variables; then create the 12 system type styles as Figma text styles bound to font primitives.

## Metrics

| Metric | Session 52 | This Session | Change |
|---|---|---|---|
| Total tool calls | 233 | 67 | −71% (smaller task) |
| Figma tool calls | 194 | 54 | −72% |
| Official-MCP calls | 0 | **0** | held (7th session) |
| Hard errors | 34 | 18 | — |
| Figma error rate | 16.0% | **33.3%** (18 of 54) | +17.3pp |
| Estimated waste % | ~21% | **~39%** (26 of 67) | +18pp |
| ToolSearch calls | 4 (1.7%) | 4 (6.0%) | +4.3pp |
| `run_script` share of figma calls | 27% | **37%** (20 of 54) | +10pp |
| `run_script` share of write ops | 100% | **100%** (0 `write`, 4 `edit` all failed) | held |

Highest waste percentage since session 6. Three distinct defects account for 24 of the 26 wasted calls, and none of them are agent error.

## Tool Call Distribution

| Tool | Calls | Errors | Notes |
|---|---|---|---|
| `run_script` | 20 | 5 hard + 2 soft | 100% of write operations; 8 of 20 were diagnostic |
| `screenshot` | 15 | 7 | **46.7% failure rate** — [BUG-016] 15th recurrence |
| Bash | 9 | 0 | reading component source + token JSON |
| `read` | 5 | 1 | 1 blocked by edit-access; 1 returned 1 page for a ~40-page file |
| `get_design_system` | 5 | 1 | filtered queries worked well once authed |
| `edit` | 4 | **4** | **100% failure rate** — all four blocked by a misreported font error |
| ToolSearch | 4 | 0 | deferred-tool project; 6.0% overhead |
| `use_file` | 1 | 0 | URL form accepted; `node-id` fragment ignored |
| `reauthenticate` | 1 | 0 | resolved the edit-access wall in one call |
| `get_local_components` | 1 | 0 | `{"count":0}` |
| `lint` | 1 | 0 | 14 near-match issues, 0 auto-fixed |
| `grep` | 1 | 0 | clean — located 12 TEXT nodes across 8 variants in one call |

## Efficiency Issues

### 1. `edit` misreports an unloadable font as a missing text style (saves ~6 calls)

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

### 2. The remote VM cannot load the file's own custom font (saves ~7 calls)

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

## Error Analysis

### 1. `screenshot` — 7 of 15 failed (46.7%), ~8 calls lost — [BUG-016] 15th recurrence

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

## What Worked Well

1. **`reauthenticate` is a one-call fix for the edit-access wall.** Third session in a row where it resolved [BUG-015] immediately. The tool is fine; only its discoverability from the error message is missing.
2. **Filtered `get_design_system` beat raising the budget.** Two `namePattern` queries (`^(color/(text|border|background)|radius|space|opacity|font|border-width|cursor)`, then `(accordion|borderWidth|border-width)`) pulled exactly the variables needed from a 28-variable collection in 2 calls. This is the documented pattern being followed correctly.
3. **Per-variant screenshots as a [BUG-016] workaround.** Once the parent COMPONENT would not export, the agent screenshotted individual variants (`11:26`, `11:14`, `11:8`, `11:50`, `11:20`) and kept a working visual channel — 5 clean exports where session 50 had none. It also got the parent at `scale: 0.5` on a later retry.
4. **`grep` did in one call what would have been eight.** `grep({scope:"11:58", name:"^(Label|Content)$", type:["TEXT"]})` returned all 12 TEXT nodes grouped by variant with IDs — exactly the input the following `edit` batch needed.
5. **Self-written verification inside scripts.** Every consequential `run_script` carried its own `verify` block reading state back. That is the only reason the #66 total failure was caught in one call rather than surviving to the end of the session.
6. **The agent wrote its findings to project memory mid-session** (#50, #51) — `figma-remote-vm-gotchas.md` covering fonts, opacity scaling, missing APIs and flaky screenshots. Session 45 showed memory encoding a *wrong* lesson (defect to the official MCP); here it encoded correct, transferable constraints.

## Priority Improvements

### Tool Changes (ranked by call savings)

1. **`remote/client.ts:110-114`** — a `JSON.parse` failure must throw a fix-stating transport error, not silently return the raw string. Unchanged since session 47 pinned it; now supported by a direct in-VM measurement (20,113 bytes rendered, nothing delivered). Closes [BUG-016] and [BUG-027] in one commit. **~8 calls/session, 15 sessions deep.**
2. **`apply.js:856-869` + `:200-201`** — capture the pre-load failure reason and report it instead of "not found or not cached". A style that exists must never be reported as missing. **~6 calls/session.**
3. **Font-availability detection in the remote VM** — when `loadFontAsync` throws, check availability and `fail()` with the swap-write-rebind remedy. **~7 calls/session on any custom-font file.**
4. **`export.ts:70-105`** — a batch that exports zero nodes must state a fix. Three lines, independent of item 1, now confirmed from four distinct input paths. **~2 calls/session.**
5. **`export.ts:19-21`** — delete the "~4MB return cap" sentence and the `scale`/`SVG` remedies. This session is the seventh to watch an agent follow that text into a dead end, and the first to measure the true payload. **~3 calls/session.**
6. **`script.ts` description** — add the remote-VM API gaps block (`loadAllPagesAsync`, `createNodeFromSvgAsync`, custom fonts). **~3 calls/session.**
7. **Edit-access error text** — name `reauthenticate` in the message. **~2 calls/session.**

### Agent Skill Updates

1. **In a deferred-tool project, search the tool domain you are about to work in, not the one you started in.** The opening `ToolSearch` shapes the whole session; `create_styles` existed for 40 minutes before it was looked up, and by then `run_script` was the habit.
2. **A stated fix that fails once is a wrong diagnosis** ([AGENT-029], holding): the four `textStyleId` format permutations are the same anti-pattern as the `scale` ladder. Four identical errors on four different inputs means the error message is lying about the variable — change strategy, not parameters.
3. **On the remote transport, treat a custom font as unavailable until proven otherwise.** Write text with a system font and bind `fontFamily` last. Verified working in this session.
</content>
