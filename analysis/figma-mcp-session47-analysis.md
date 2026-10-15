# Figma MCP Session 47 Analysis

## Session Overview

- **Transcript**: `af9f2a17-fd0b-44ba-96e6-826866abdba9.json`
- **Date**: 2026-08-25, 19:16–19:36 UTC
- **Duration**: 20 minutes (continuous — no idle gaps)
- **Project**: external — `~/Github/site-foundry`, branch `wpds-audit`
- **Transport**: remote (file `07plXV7PsHOrLE3hsIS0jS`, "Site Foundry") — **a file and project never seen in any prior analysed session**
- **Total tool calls**: 69
- **Figmagent tool calls**: 37 (54%)
- **Official Figma MCP calls**: **0**
- **Total errors**: 9 (all Figmagent — 8 `screenshot`, 1 `run_script`)
- **Reconnections**: 0 (remote transport)
- **Context restarts**: 0
- **Task**: reconcile the Figma page "Site Foundry" against the shipped plugin source. Read `src/` (build-flow React, `admin-ui/` screens, PHP renderers, blueprint JSON), then add the missing screens to Figma — blueprint picker, brand picker, chat-load-failure state, and four wp-admin screens (Blueprints list, Blueprint editor, Brands list, Brand editor) — plus a "What we built" summary on Site ready and a Start-over link on every in-flight frame, then renumber all frames into flow order. 7 frames created, 6 updated.

Two results dominate this session:

- ✅ **The [BUG-016] behavioural fix holds in a project that has never been told about it.** Zero official-Figma-MCP calls across 8 consecutive `screenshot` failures. Sessions 44 and 45 defected after 3 and 1 failures. Session 46's zero-defection could be attributed to the corrected `vip-workflows` memory file that shipped with commit `0af2c9a` — **site-foundry has no such memory file**, so this is the first unbiased confirmation that the readable, `is_error: true` message is by itself sufficient to keep an agent on Figmagent.
- 🔎 **The [BUG-016] / [BUG-027] root cause is located, and it is one line in one file.** `remote/client.ts:110–114` swallows a `JSON.parse` failure and returns the **raw response text** instead of the parsed object. Every downstream result-builder then reads fields off a `string`, gets `undefined` for all of them, and renders a plausible-looking empty result. This single mechanism reproduces every observed symptom in both bugs exactly, including the ones the current "~4MB cap" message cannot explain.

## Metrics

| Metric | Session 46 | This Session | Change |
|---|---|---|---|
| Total tool calls | 100 | 69 | −31% (smaller scope, 20 min vs ~35 active) |
| Figmagent tool calls | 70 (70%) | 37 (54%) | −16pp share (heavy source-reading task) |
| Figmagent error rate | 15 / 70 (21.4%) | 9 / 37 (24.3%) | +2.9pp |
| ToolSearch calls | 3 (3.0%) | 2 (2.9%) | flat |
| Estimated waste % | ~20% (20 of 100) | **~16% (11 of 69)** | −4pp |
| `-32602 invalid_union` protocol crashes | 0 | **0** | holds |
| Fell back to the *official* Figma MCP | no | **no** | **holds — and in an untutored project** |
| Calls lost to `[BUG-016]` family | 11 | **10** | −1 |
| `screenshot` failure rate | 11 / 25 (44%) | **8 / 16 (50%)** | +6pp |
| `run_script` share of Figmagent calls | 24% | **22%** | −2pp |
| `write` / `edit` calls | 0 / 2 | **0 / 0** | creation surface unused (3rd session) |
| Nodes created via `run_script` | 19 frames + 9 texts + 5 clones | 7 frames (+6 frames edited) | — |

Waste breakdown (11 calls): failed `screenshot` 8 · `run_script` error retry 1 ·
`read` calls issued only to substitute for a screenshot that would not render 2.

## Tool Call Distribution

| Tool | Calls | Errors | Notes |
|---|---|---|---|
| `Bash` | 30 | 0 | reading `src/`, `includes/`, `blueprints/*.json` — the design source of truth |
| `mcp__Figmagent__screenshot` | 16 | **8 (50%)** | see Error 1 — the dominant failure, again |
| `mcp__Figmagent__read` | 10 | 0 | 3 multi-`nodeIds` batches ([AGENT-017] holding); 2 forced by screenshot failure |
| `mcp__Figmagent__run_script` | 8 | 1 | 7 `mode: "write"` (all writes), 1 read-only font/binding probe |
| `ToolSearch` | 2 | 0 | both `select:` form, both for Figmagent tools |
| `mcp__Figmagent__use_file` | 1 | 0 | full figma.com URL, first call of the session, worked first try |
| `mcp__Figmagent__grep` | 1 | 0 | one `type:["TEXT"]` sweep of the whole page, `maxResults: 400` |
| `mcp__Figmagent__get_design_system` | 1 | 0 | one call, `includeStyles: false` — fed every variable ID used later |

## Error Analysis

### 1. [BUG-016] `screenshot` returns no image data — 9th recurrence, and the root cause is now pinned (8 failures, ~3 minutes)

Eight of sixteen `screenshot` calls failed, every one with the `export.ts:44–46`
guard text blaming the "~4MB return cap":

| # | Call | Node size | Result |
|---|---|---|---|
| 44 | `nodeIds: ["29:18","29:162"], scale: 1` | 1440×444, 1440×364 | `Exported 0 node(s): none` — **no `Errors:` block, no `Returned no image data` block** |
| 45 | `nodeId: "29:18", scale: 1` | 1440×444 | no image data |
| 46 | `nodeId: "29:18", scale: 0.5` | — | ✅ image |
| 49 | `nodeId: "30:26", scale: 0.5` | 1440×592 | no image data |
| 50 | `nodeId: "30:26", scale: 0.4` | — | ✅ image |
| 56 | `nodeId: "5:783", scale: 0.4` | 1440-wide board | no image data |
| 57 | `nodeId: "5:823", scale: 0.7` | **440×655** | no image data |
| 59 | `nodeId: "5:784", scale: 0.45` | card frame | no image data |
| 60 | `nodeId: "34:4", scale: 1` | small link wrapper | no image data |
| 61 | `nodeId: "34:4", format: "SVG"` | — | no image data |

**The cap diagnosis fails again, in two independent ways.** `5:823` is a
**440×655** frame — at `scale: 0.7` that renders to ~308×458 px, nowhere near
4 MB, and the plugin-side cap error (`document.js:655–660`,
*"is too large to return: N chars (max 4000000)"*) never appears in any of the
eight. And `34:4` failed at `format: "SVG"` — the tool description's own
verified fallback — where vector output cannot plausibly approach the cap.
Of the three remedies the message recommends, lowering `scale` worked twice
(`29:18` 1→0.5, `30:26` 0.5→0.4) and failed four times; SVG failed; the
smaller-child route was not reachable. This is the second consecutive session
in which the message sent the agent down dead ends.

**Root cause — `remote/client.ts:110–114` swallows a JSON parse failure and
returns the raw text.**

```ts
// remote/client.ts:99–114
const text = content.filter((c) => c.type === "text" && ...).map((c) => c.text).join("\n");
...
if (!text) return null;
try {
  return JSON.parse(text);
} catch {
  return text;          // ← a string escapes as if it were the result object
}
```

Every remote command result flows through here. When the official server's
`use_figma` response text is not parseable as JSON — truncated mid-payload, or
carrying a second text content block that `.join("\n")` fuses onto the JSON —
the catch returns the **raw string**, and each downstream builder then reads
properties off a `string` and gets `undefined` for all of them:

- `buildSingleExportResult` (`export.ts:34`) — `("…").imageData` is `undefined`
  → `hasImageData` false → the "returned no image data / ~4MB cap" guess fires.
  **The guard is right that something failed and wrong about what.**
- `buildBatchExportResult` (`export.ts:70–72`) — `("…").images` is `undefined`
  → `images = {}` → `allIds = []` → `ids = []` **and** `dataless = []`, so the
  response is `Exported 0 node(s): none` with **neither** an `Errors:` block
  **nor** a `Returned no image data` block. That is call #44's exact signature,
  and session 46 call #69's, and session 41 call (a)'s. No other explanation
  produces all three empty at once — the plugin loop always writes each id into
  either `images` or `errors`.
- `buildFsgn` (`document.ts:71–92`) — `raw.rootId/rootName/rootType` all
  `undefined`, `raw.nodeCount ?? 0` → `0`, `raw.rawTree ?? []` → `[]`. That is
  **[BUG-027]'s exact observed output**, down to the missing `meta.nodeId`.

So [BUG-016] and [BUG-027] are **one bug in one line**, and the payload-size
hypothesis was a correlation: bigger renders make the response text longer,
which makes truncation more likely, which is why `scale` sometimes helps —
without size being the mechanism. It also explains the two facts size cannot:
SVG failing, and session 46's same-node-same-scale succeed-then-fail.

**Agent recovery:** excellent, and unprompted. After `5:823` and `34:4` refused
to render, the agent stopped retrying screenshots and verified structurally —
`read(5:823, layout, depth:2)`, `read(1:17, layout, depth:1)`,
`read(5:483, layout, depth:2, filter:{namePattern:"start-over|Link|sfp-card$"})` —
then went back to screenshots for the nodes that did render. No retry storm, no
`ToolSearch` for the competitor, **no official-MCP call**. Total recovery cost:
8 failed calls + 2 substitute reads.

**Fix needed:** promote v4 to name the real defect.
(0) In `callOfficialTool`, do not return unparseable text as a result. Log the
first ~200 chars and the length, and throw a fix-stating error
(`the remote server returned N chars that are not valid JSON …`) — a thrown
error already routes correctly through `runOne` and reaches the agent as
`is_error: true` with a true statement.
(1) Before throwing, attempt recovery: if `content` has more than one text
block, try parsing the **last** block alone rather than the `join("\n")`.
(2) Keep the existing `export.ts` guards, but reword them: the current text
asserts a cause it cannot know. Say "the remote transport returned no image
data for this node" and drop the three remedies unless a `payloadChars` scalar
(v4 item 0) shows the render was actually large.
This closes [BUG-027] in the same pass.

### 2. `run_script` write rejected for an unknown FRAME property (1 failure, ~1 minute)

Call #51 (a 9,795-char builder for the Blueprint and Brand editor frames) died
with:

```
Error running script: TypeError: node.headerRow: no such property 'headerRow' on FRAME node
    at set (<input>:60:28)
    at card (PLUGIN_1_SOURCE:52:77)
 Figma Debug UUID: 825e267d-… (atomic: no changes were applied; safe to retry)
```

The script's own `card()` helper passed a spec key (`headerRow`) into a generic
property-assignment loop that forwards every key straight to the node. The
remote VM rejects unknown property writes.

**Agent recovery:** exemplary. One retry (#52, 9,967 chars) with the key
handled explicitly; no bisect, no repeated failure. The **atomic-rollback note
did its job** — the agent re-sent the whole builder without first checking what
had partially landed, which is only safe because the message said so.

**Fix needed:** none for the error itself — this is script-author error, and
the message names the property, the node type, and both stack frames. Worth
noting as a counter-example to [BUG-023]: **runtime** errors from the remote VM
carry position and context; only `SyntaxError` is bare. One rough edge: the two
frames use different labels for the same script (`<input>:60:28` vs
`PLUGIN_1_SOURCE:52:77`), which reads as two files. Cosmetic.

## Efficiency Issues

### 1. [AGENT-025] `run_script` monoculture — 3rd consecutive session with zero `write` (tracking metric)

All seven write operations went through `run_script`. `write`, `edit`, `lint`
and `grep`-for-writes were untouched; `grep` was called once, read-only. The
share metric reads **22% of Figmagent calls**, comfortably under the ~30%
threshold — but that number is now misleading, because the denominator is
inflated by 16 screenshots. **By operation rather than by call, `run_script`
was 100% of writes**, the third session running (44: 100%, 46: 100% of
creates, 47: 100%).

The scripts themselves show *why*, and it is not laziness — the work was
genuinely script-shaped: create a frame tree, clone existing WPDS library
instances, `setProperties` on them, reorder a column, renumber ten frames by
name, and equalise card heights by measuring children. `write` covers the first
of those; nothing covers cloning-an-instance-then-setting-its-properties-then-
renumbering-siblings in one atomic pass. Script #69 is the clearest case: clone
`8:65`, rename it, delete one child by name, `setProperties` on a nested Notice
instance, reposition — five first-class calls with no atomicity, or one script.

**Proposed fix:** no new action; this session is evidence for the existing
entry. Update [AGENT-025] to measure **`run_script` share of write operations**
alongside share of calls — the call-share metric is diluted by read-heavy and
screenshot-heavy sessions and read 22% here for a session that used the
first-class write surface exactly zero times.

### 2. [TOOL-029] verified in the wild — and the opt-out has a cost the entry did not anticipate (new observation)

All seven write scripts passed **`stdlib: false`**, the parameter added by
commit `0af2c9a`. This is the first live remote session to exercise it, and it
worked: no oversized-script rejections, no plugin-data module-cache workaround,
no [BUG-023] parse-error bisect — the exact failure chain session 44 paid 23
calls for. The largest script assembled was 9,967 chars against a 49,000-char
budget. **[TOOL-029] can move to `verified`.**

The unanticipated cost: opting out of the stdlib also forfeits `fig.*`, so each
script hand-rolls what the stdlib provides. Every one of the seven re-declares
the same preamble — an 8-entry `VariableID:…` map, an `RGB` fallback table, and
a `V()` async variable cache — roughly 700–900 chars repeated seven times, plus
a hand-written `card()` helper in three of them. The read-mode probe (#29) kept
the stdlib and used `fig.prop` happily. So the flag is doing its job, and the
"split the bundle into a ~2KB core (`prop`, `setCharacters`) plus a flagged
remainder" half of [TOOL-029]'s proposed fix — deliberately not attempted in
`0af2c9a` — is what would remove the remaining duplication. Worth reopening as
its own item rather than leaving it inside a verified entry.

### 3. No way to carry a helper preamble across `run_script` calls (new, P2)

Related to but distinct from the above: even with a full stdlib, the
**session-specific** preamble (this file's variable IDs, this build's `card()`
helper) has to be re-sent on every call. Session 44 solved this with a
`figma.root.setSharedPluginData` module cache and paid 8 calls plus
[BUG-023] for it. This session solved it by re-sending ~800 chars × 7 — cheaper
and safer, but it is still the same gap: `run_script` is stateless per call
with no supported way to define once and reuse. A `preamble` param (stored
server-side per file+session, prepended after the stdlib) would remove both
workarounds. Low call-savings, meaningful output-token savings on script-heavy
builds.

## What Worked Well

1. **`get_design_system` once, then never again.** One call
   (`includeStyles: false`) at 19:20 supplied every `VariableID:…` used across
   all seven write scripts. No re-discovery, no per-binding lookup — the
   contrast with sessions 44/45's un-batched `get_enabled_library_variables`
   runs ([TOOL-026], 4 recurrences) is stark, and it is because this file's
   variables are local rather than library-enabled.
2. **Batched `read` with `nodeIds` arrays.** Three of ten reads passed arrays —
   `["5:2","5:383","5:483"]`, then all 8 top-level frames at `depth: 0`, then 8
   text/divider nodes at `detail: "full"`. [AGENT-017] is holding without
   prompting.
3. **`use_file` first, with the full URL.** Call #3 of the session, before any
   `read`. [BUG-014]'s remote-onboarding half — 4 recurrences across sessions
   36/38/43 — did **not** recur. Worth noting: this agent had never worked this
   file before, so it had no memory to lean on; leading with `use_file` was the
   correct default rather than a learned one.
4. **Clean fail-fast on the screenshot failures.** Two failures on nodes that
   would not render, then a switch to structural verification via `read` — no
   third attempt, no competitor, no abandoned task. This is what [BUG-016]'s v3
   fix was for, and it is now observed working in an untutored project.
5. **The atomic-rollback note earning its keep.** After the `headerRow`
   TypeError the agent re-sent the entire 10K builder rather than probing for
   partial state. That is only correct because the message said "no changes were
   applied; safe to retry" — and it was.

## Priority Improvements

### Tool Changes (ranked by call savings)

1. **`remote/client.ts:110–114` — stop returning unparseable response text as a
   result.** Throw a fix-stating error, after one recovery attempt on the last
   text block alone. Single highest-value change in the tracker: it is the
   shared root cause of [BUG-016] (10 calls this session, 11 in S46, 24 in S45,
   62 in S44) and [BUG-027], and it is ~10 lines. Everything else in the
   [BUG-016] entry is downstream symptom management.
2. **Reword the `export.ts` guard.** It currently asserts a cause it cannot
   know, and this session proves the assertion false twice over (a 440×655 node,
   and an SVG). Say what is true — the transport returned no image data — and
   gate the `scale`/SVG/child-node remedies on a `payloadChars` scalar.
3. **Split the `run_script` stdlib** into a ~2KB always-on core (`prop`,
   `setCharacters`) plus a flagged remainder. `stdlib: false` is verified
   working but forces scripts to hand-roll what the core would give them free.
4. **`run_script` `preamble` param** — define file/session-scoped helpers once
   instead of re-sending them per call.

### Agent Skill Updates

1. **[AGENT-025] measurement** — track `run_script` share of *write operations*,
   not just of calls. 22% of calls hid 100% of writes this session.
2. **No change needed on screenshot recovery.** The behaviour observed here —
   two failures, then structural verification via `read`, no competitor — is
   the behaviour the guidance asks for, produced without any project-local
   memory prompting it. Leave it alone.
