# Figma MCP Session 51 Analysis

## Session Overview

- **Transcript**: `68f20fe0-a365-45ad-a46c-0217ee9c0aee.json`
- **Date**: 2026-08-26, 21:23–22:08 UTC
- **Duration**: 45 minutes wall clock (one 7-minute gap, #127→#128)
- **Project**: external — `~/Github/site-foundry`, branch `wpds-audit`
- **Transport**: remote (file `07plXV7PsHOrLE3hsIS0jS`, "Site Foundry") — **fourth analysed session on this file**, after 47, 48 and 50; the direct sequel to session 50, same evening
- **Total tool calls**: 138
- **Figmagent tool calls**: 30 (22%) — `read` 15, `screenshot` 11, `grep` 3, `use_file` 1
- **Official Figma MCP calls**: **0**
- **`run_script` calls**: **0**
- **`write` / `edit` calls**: **0** — read-only Figma session
- **Total errors**: 13 (9 Figmagent + 4 Bash, one of which was a user denial), plus **2 unflagged silent failures**
- **Reconnections**: 0 (remote transport)
- **Context restarts**: 0
- **Task**: the **inverse of session 50** — session 50 built the Figma board from the React/SCSS; this session read that board back as the spec and implemented `BlueprintCard` + a DataViews-based `TemplatePicker` in code. Figma was consulted, never modified.

Three results dominate:

- 🔴 **[BUG-016]'s guard message is actively wrong, and the agent obeyed it into four dead retries.** 8 of 11 `screenshot` calls failed. The error text asserts *"the rendered payload exceeded the ~4MB return cap"* and prescribes two fixes; the agent tried **both** — `scale: 0.5` on `43:14`, `format: "SVG"` on `103:1135` — and each returned the **byte-identical** error. A 764×344 COMPONENT_SET (`66:719`) failed at scale 1. The stated fix is not a fix.
- 🆕 **The strongest behavioural evidence yet that [BUG-016] and [BUG-027] are one bug.** The two nodes whose `read` silently returned `nodes: []` (`43:22`, `66:719`) are **the same two nodes** whose `screenshot` failed, within 90 seconds. Both symptoms fall out of the single `catch { return text }` at `remote/client.ts:110-114`. Session 47 pinned this by code reading; this session demonstrates both faces on the same node IDs.
- 🆕 **The real variable is response size, not image size** — and that reframes the whole family. `read(43:22, structure, depth 3)` works; `read(43:22, layout, depth 4)` returns empty. `read(66:719, layout, depth 1)` works; `read(66:719, full, depth 4)` returns empty. Same nodes, only the requested payload differs. The failure is a **JSON parse failure on an oversized/truncated response**, which is why lowering `scale` sometimes helps and sometimes does nothing.

## Metrics

| Metric | Session 50 | This Session | Change |
|---|---|---|---|
| Total tool calls | 261 | 138 | −47% (smaller, code-side scope) |
| Figmagent tool calls | 222 (85%) | 30 (22%) | −63pp share (read-only reference session) |
| Figmagent error rate (flagged) | 5 / 222 (2.3%) | **9 / 30 (30.0%)** | +27.7pp |
| Figmagent failure rate (incl. silent) | 5 / 222 (2.3%) | **11 / 30 (36.7%)** | +34.4pp |
| ToolSearch calls | 5 (1.9%) | 4 (2.9%) | +1.0pp |
| Estimated waste % | ~18% (47 of 261) | **~17% (24 of 138)** | −1pp |
| `-32602 invalid_union` protocol crashes | 0 | **0** | **holds (6th session)** |
| Fell back to the *official* Figma MCP | no | **no** | **holds (6th session, 3rd project)** |
| `screenshot` failure rate | 5 / 5 (100%) | **8 / 11 (72.7%)** | −27.3pp (still catastrophic) |
| Calls lost to the [BUG-016]/[BUG-027] family | 5 | **10** (8 screenshot + 2 silent reads) | — |
| `run_script` share of Figmagent calls | 0% | **0%** | holds |
| Nodes created / modified | 502 / 576 | **0 / 0** | read-only session |

## Tool Call Distribution

| Tool | Calls | Notes |
|---|---|---|
| Bash | 84 | code-side work (DataViews/WPDS source spelunking, jest, lint, build, Playwright) |
| `read` | 15 | **2 returned silent empty results**; 2 used the `nodeIds` batch form (5 + 3 nodes) |
| `screenshot` | 11 | **8 failed** — 6 with the misleading cap message, 1 SVG retry, 1 batch "Exported 0 node(s): none" |
| ToolSearch | 4 | 1 for Figmagent, 3 for a browser-extension detour that yielded nothing |
| Write / Edit | 8 | code files only |
| `grep` | 3 | 1 over-narrow regex, then a widened retry; `scope: "DOCUMENT"` used correctly throughout |
| Skill | 3 | `wordpress-dataviews`, `loupe-authoring`, `loupe-patterns` |
| Read | 3 | 2 were reads of Playwright-captured PNGs |
| claude-in-chrome | 4 | extension never connected — dead end |
| `use_file` | 1 | led with it on remote; correct |
| AskUserQuestion / SendUserFile | 2 | — |

## Efficiency Issues

### 1. The `screenshot` guard prescribes fixes that cannot work (8 failures, ~4 wasted retries)

`export.ts:37-50` returns one fixed string whenever `hasImageData()` is false:

> `Error exporting node as image: the export for node 43:14 returned no image data. This usually means the rendered payload exceeded the ~4MB return cap. Fix: re-request at a lower scale (e.g. scale: 0.5), or use format: "SVG" …`

**Pattern observed** — the agent followed the instructions exactly, twice, and got the same error verbatim:

| # | Call | Result |
|---|---|---|
| 9 | `screenshot(43:14, scale: 1)` | cap error |
| 11 | `screenshot(43:14, scale: 0.5)` | **identical cap error** |
| 15 | `screenshot(103:1135, scale: 1)` | cap error |
| 17 | `screenshot(103:1135, format: "SVG")` | **identical cap error** |
| 25 | `screenshot(66:719, scale: 1)` | cap error — node is **764×344** |

`66:719` at scale 1 cannot approach 4MB, and its sibling components exported as SVG at **210 and 372 bytes** (#129). The size diagnosis is falsified for the third and fourth time on record (sessions 46, 48, 49 falsified it previously).

**Root cause:** `remote/client.ts:110-114` does `try { return JSON.parse(text) } catch { return text }`. When the official MCP returns anything non-JSON — a truncated or error-shaped response — a **bare string** reaches `buildSingleExportResult`. A string has no `.imageData`, so `hasImageData()` is false, and the guard blames a payload cap it never measured. The guard added for [BUG-016] converted a protocol crash into a *confidently wrong diagnosis*, which is cheaper but not free: it steers the agent into retries that are guaranteed to fail.

**Proposed fix:** distinguish the two conditions at the transport, not at the presenter. In `callOfficialTool`, when `JSON.parse` fails for a tool whose contract is JSON, throw a fix-stating transport error naming the tool and the response prefix instead of returning the raw string. Then `export.ts` can keep the cap message for the case it genuinely describes (a parsed result with an empty `imageData`). This is the same one-line site as [BUG-027] — fix once, both symptoms go.

**Estimated savings:** ~4 calls per affected session directly, plus the far larger verification tax of an agent that cannot see its work.

### 2. `read` silently returns an empty document for valid nodes (2 occurrences, unflagged)

**Pattern observed** — same node, two different payload sizes:

| # | Call | `meta.nodeId` | Result |
|---|---|---|---|
| 10 | `read(43:22, layout, depth 4)` | **absent** | `nodeCount: 0`, `nodes: []`, `is_error: false` |
| 12 | `read(43:22, structure, depth 3)` | `43:22` | 40 nodes |
| 18 | `read(66:719, full, depth 4)` | **absent** | `nodeCount: 0`, `nodes: []`, `is_error: false` |
| 19 | `read(66:719, layout, depth 1)` | `66:719` | COMPONENT_SET + variant axes |

The missing `meta.nodeId`/`name`/`type` is the [BUG-027] fingerprint exactly: `buildFsgn` copies those unconditionally from `raw.rootId`/`rootName`/`rootType`, so all three `undefined` proves `raw` was not an object.

**Root cause:** identical to issue 1 — a non-JSON response became a string.

**Why this is the worse half:** `screenshot` at least says something failed. `read` reports **success** with an empty tree, which is indistinguishable from "this node has no children". The agent recovered here only because it happened to retry with different parameters; an agent that trusted the first answer would have concluded `site-foundry__template-picker` was empty and designed against nothing.

**Estimated savings:** ~2 calls per occurrence, plus the correctness hazard.

### 3. Batch `screenshot` total failure still emits no fix text (2nd occurrence)

Call #24, `screenshot({nodeIds: ["102:996","66:14","66:689"]})`, returned exactly:

> `Exported 0 node(s): none`

No node list, no reason, no fix. `buildBatchExportResult` (`export.ts:70-105`) derives `dataless` from `Object.keys(result.images)` — when `result` is a string, `images` is `{}`, `allIds` is `[]`, and the `dataless` branch that carries `OVERSIZED_FIX` **never fires**. The `isError: true` at the end is the only signal. Session 50 found this hole; this is its second observation, from the string-result path rather than the empty-images path.

**Proposed fix:** when `result` is not an object with an `images` map, emit a fix-stating transport error rather than a zero-count success line — the same guard as issues 1 and 2.

### 4. Hyphenated node ID from a Figma URL rejected (3rd session — [TOOL-022])

Call #4: `read({nodeId: "43-14"})` → `Error reading nodes: Error: Node not found: 43-14`. Call #8, `read({nodeId: "43:14"})` → success. `use_file` had accepted the full hyphenated URL two calls earlier (#2). Sessions 38 and 44 recorded the identical shape; the one-line normalisation is still outstanding. The error also states no fix, contrary to the project's `fail(message, fix)` rule.

**Estimated savings:** 1 call per session where an ID is lifted from a URL.

### 5. Over-narrow `grep` regex, then widen (1 call)

Call #14 searched `name: "^Blueprint (card|placeholder image)"` and matched 1 of 2 targets — the second component is named `Picker/Blueprint card`, so the `^` anchor excluded it. Call #16 dropped to the bare substring `Blueprint` and found both. Minor, and the agent self-corrected in one step, but it is the recurring anchored-regex-vs-slash-prefixed-component-name stumble: Figma component names routinely carry a `Group/` prefix that defeats `^`.

## Error Analysis

### 1. `screenshot` — 8 failures of 11 (~2 minutes lost, verification abandoned)

Six calls returned the cap message, one batch returned the bare zero-count line, one SVG retry returned the cap message. The agent probed for **88 seconds** (#9 through #26), exhausted both documented remedies, and then **stopped trying to screenshot the design board at all**. Its remaining Figma work was structural: `grep` for text nodes (#28), batched `read` of specific node IDs (#30, #32), and two successful screenshots of small leaf components (#23, #34).

**Agent recovery:** good on the fail-fast axis — it did not enter a retry storm, and it substituted a structural read strategy that got the job done. But note the shape of the substitution: it read `43:24`/`43:25`/`43:33` text nodes and instance-descendant text (#32) to recover the *copy* it could not see in a render. That is the same "human/structure becomes the render loop" cost session 50 identified, at smaller scale.

**Fix needed:** the transport guard in issue 1.

### 2. `read` — 2 silent empty results (unflagged, `is_error: false`)

Covered in issue 2. These do not appear in any error count, which is precisely the problem — the session's true Figmagent failure rate is 36.7%, not the 30.0% the flags report.

### 3. Bash — 4 errors (~5 minutes)

- **#40** guessed `grid/index.js` in a package that ships `.cjs`; corrected immediately by `ls`.
- **#100** `Cannot find module '@playwright/test'` — script written to a `/tmp` scratchpad outside the project's `node_modules` resolution root. Fixed by moving the script into the repo (#102).
- **#136** `net::ERR_SSL_PROTOCOL_ERROR` against a stale ngrok tunnel.
- **#137** user denied a follow-up `curl` probe of the tunnel, ending the session.

None are Figmagent issues. Worth noting only because #100–#137 are the tail of a ~20-call detour to screenshot the *live WordPress admin* via Playwright — a fallback the agent reached for after the Figma-side visual channel proved unusable, and which itself ended in a dead browser-extension path (#118–#125, 7 calls, nothing produced).

## What Worked Well

1. **Led with `use_file` on remote.** Call #2 passed the full Figma URL before any read — the onboarding lesson from [BUG-014]/session 36 has stuck. Zero "No Figma file selected" errors.
2. **Zero official-MCP defection, sixth consecutive session, third project.** Despite a 73% screenshot failure rate — historically the exact trigger for defection (sessions 43, 44, 45 lost 17/62/24 calls to the official-MCP fallback) — the agent never reached for `mcp__claude_ai_Figma__get_screenshot`. The behavioural fix is holding under maximum provocation.
3. **Batched `read` with `nodeIds`.** Calls #30 (5 nodes) and #32 (3 nodes) used the documented array form instead of 8 separate calls. #32 additionally resolved **instance-descendant IDs** (`I103:1135;66:19`, `I103:1135;66:17`, `I66:720;66:692`) without incident.
4. **`grep` with `scope: "DOCUMENT"`.** All three searches passed it explicitly — [AGENT-023] observed, no current-page blind spot.
5. **Progressive detail escalation.** The agent consistently opened at `structure`/low depth and escalated only where needed (`full, depth 3` on `66:14` once it had identified the card component). The two silent-empty failures were both *high*-detail probes, which the escalation habit recovered from cheaply.

## Cross-Session Notes

- **[BUG-031] does not recur, and the scope is now clearer.** Session 49 recorded the remote VM throwing `Node not found` on `I…;…` instance-descendant IDs. Here, call #32 read three such IDs through the **first-class `read` tool** with no error. The defect is specific to the `use_figma` VM's node proxy inside `run_script`, not to instance-descendant IDs generally — and `read`'s resolution path is a working reference implementation for the proposed stdlib fix.
- **[AGENT-025] (`run_script` monoculture) — third counter-data-point.** 0 `run_script` calls. Consistent with session 50's conclusion that the driver is task shape, not agent habit: this was a read-only reference session with nothing to script.
- **Session-shape note.** Sessions 50 and 51 are a matched pair on one file: code → Figma, then Figma → code, 3 hours apart. The reverse direction is far cheaper in Figmagent calls (30 vs 222) but proportionally far more damaged by the screenshot gap, because reading a design *as a spec* is exactly the workflow that needs a render.

## Priority Improvements

### Tool Changes (ranked by impact)

1. **`remote/client.ts:110-114` — stop returning unparsed text as a result.** One `catch` block is the shared root of [BUG-016] (misdiagnosed screenshot failure, 12 sessions) and [BUG-027] (silent empty `read`, P0). Throw a fix-stating transport error naming the tool and a response prefix. Fixes issues 1, 2 and 3 above at one site. **Highest-value single change in the tracker.**
2. **`export.ts:37-50` — stop asserting a cause the code did not measure.** Reserve the "~4MB cap" text for a parsed result with empty `imageData`; for a non-object result, report a transport failure. A wrong fix is worse than no fix, because agents follow it.
3. **`export.ts:70-105` — batch total-failure path needs fix text** when `result.images` is absent, not just when it is populated-but-dataless (2nd occurrence).
4. **[TOOL-022] — normalise `^(\d+)-(\d+)$` → `$1:$2`** at the node-ID schema boundary (3rd session). One line, one call saved every time an ID comes off a URL.

### Agent Skill Updates

1. **When a stated fix fails once, stop treating the error text as authoritative.** The agent spent 4 calls executing instructions that could not work. A rule — *if the identical error returns after applying its own prescribed fix, the diagnosis is wrong; change strategy rather than parameters* — generalises past this bug and is a strict improvement on the existing "2 identical errors" rule, which only fires on unchanged inputs.
2. **Prefer substring over `^`-anchored regex for `grep` on component names.** Figma components routinely carry a `Group/` prefix (`Picker/Blueprint card`), which silently defeats an anchored pattern.
