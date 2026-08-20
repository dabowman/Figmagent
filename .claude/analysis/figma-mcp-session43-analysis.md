# Figma MCP Session 43 Analysis

## Session Overview

- **Transcript**: `087bd997-8e00-4c3e-952e-2da99490cf5d.json`
- **Date**: 2026-07-31, 19:57–22:19 UTC
- **Duration**: 141 minutes
- **Project**: external — `~/Github/vip-workflows`, branch `sequence-editor-ui-refinements`
- **Transport**: remote
- **Total tool calls**: 313
- **Figmagent tool calls**: 8 (`read` ×4, `screenshot` ×3, `use_file` ×1)
- **Official Figma MCP calls**: 4 (`get_screenshot`)
- **Total errors**: 6 (2 of them Figmagent)
- **Reconnections**: 0
- **Context restarts**: none detected
- **Task**: a code-first session (sequence-editor edge routing, marker geometry, checkpoint
  slots). Figma was used **read-only, as the spec of record** — the agent measured the
  `StageNode` connection-handle artwork in Figma to reproduce it exactly in SVG/CSS.

This is a different shape from sessions 34–41: Figma is not the work surface, it is the
reference. That makes it an unusually clean test of the **read + verify** path in isolation,
and the verify half failed hard.

## Metrics

| Metric | Session 41 | This Session | Change |
|---|---|---|---|
| Total tool calls | 41 main + 7 agent | 313 | task is code-led, not comparable |
| Figmagent tool calls | 31 | 8 | −74% (Figma is reference-only here) |
| Figmagent error rate | 3 / 41 (7.3%) | 2 / 8 (**25%**) | +17.7pp |
| Calls lost to `[BUG-016]` | ~4 | **17** | +325% |
| Minutes lost to `[BUG-016]` | ~2 | **~8** | +300% |
| Fell back to the *official* Figma MCP | no | **yes (4 calls)** | new |

## Tool Call Distribution

| Tool | Calls | Errors | Notes |
|---|---|---|---|
| `Bash` | 147 | 2 | code work; 6 of these are `[BUG-016]` fallout (curl/sips/cat) |
| `Edit` | 80 | 1 | code work |
| `Read` | 50 | 0 | code work; 4 are `[BUG-016]` fallout |
| `Write` | 7 | 0 | |
| `mcp__claude-in-chrome__*` | 13 | 1 | live-app visual verification |
| `mcp__Figmagent__read` | 4 | 1 | 1 pre-`use_file` failure; 3 well-batched |
| `mcp__plugin_figma_figma__get_screenshot` | 4 | 0 | **competitor fallback, 100% caused by `[BUG-016]`** |
| `ToolSearch` | 3 | 0 | 1 was to *find* the competitor's screenshot tool |
| `mcp__Figmagent__screenshot` | 3 | 1 | 1 PNG failure, 2 SVG successes |
| `AskUserQuestion` | 1 | 0 | |
| `mcp__Figmagent__use_file` | 1 | 0 | accepted a full URL via `channel:` |
| **Total** | **313** | **6** | |

## Efficiency Issues

### 1. One failed screenshot cost 17 calls and ~8 minutes (`[BUG-016]`, 5th recurrence)

Call #126 — `screenshot({nodeId:"2210:680", scale:4})` — failed with the familiar
`MCP error -32602 ... invalid_union`. What followed is the most expensive recovery this
bug has produced across five sessions:

**Pattern observed** (calls #129–#145, 20:37:11 → 20:41:56):

| # | Call | Purpose |
|---|---|---|
| 129 | `Bash echo "check siblings"` | stall / re-plan |
| 130 | `ToolSearch select:mcp__plugin_figma_figma__get_screenshot` | **go find the competitor's tool** |
| 131 | official `get_screenshot(2210:680, maxDimension:1600)` | replacement screenshot |
| 132–134 | `curl` → `sips -Z 1044` → `Read` | download + upscale + view |
| 135 | `Bash` probe for `magick`/PIL | look for an upscaler |
| 136–138 | official `get_screenshot(2210:679)` → `curl` → `Read` | per-node geometry |
| 140–142 | official `get_screenshot(2210:661)` → `curl` → `Read` | per-node geometry |
| 143–145 | official `get_screenshot(2210:657)` → `curl` → `Read` | per-node geometry |

The agent then returned to Figmagent at #146 with `format: "SVG"` — which worked
immediately, on the same file, on the same nodes, two minutes later.

**Root cause — sharpened.** The tracker's standing hypothesis was a *"larger/complex node"*
correlation. This session **falsifies that**: node `2210:680` is a **261×202 frame with 11
descendants** — small and simple by any measure. The distinguishing variable is `scale: 4`,
i.e. a 1044×808 render. The correlation is **raster payload size, not node complexity**.

That fits the code exactly, and exposes an asymmetry not previously recorded:

- `src/figma_plugin/src/commands/document.js:609` defines `EXPORT_MAX_PAYLOAD_CHARS = 4000000`,
  and its comment states the cap exists specifically because *"Enforcing the ceiling on the
  plugin side also bounds the remote transport's return payload, where `use_figma` does
  `JSON.stringify` with no size guard of its own."*
- That cap is applied **only in the batch path** (`document.js:673–711`).
  `exportSingleNode` (`document.js:626–651`) returns `imageData` with **no cap at all**.
- So on remote, a single-node export has no payload guard, and
  `src/figmagent_mcp/tools/export.ts:105–112` then builds
  `{ type: "image", data: result.imageData, mimeType: ... }` with **no check that
  `imageData` exists** — producing a content block that is neither a valid `text` nor
  `image` member. That is precisely the observed `invalid_union`.

This explains every data point on record: batch calls are capped and survive; single-node
calls are uncapped and fail once the payload is big enough — whether from a complex node
(sessions 34/38/39/41) or, here, from a small node at `scale: 4`.

**Proposed fix**: apply the same payload ceiling in `exportSingleNode`, and guard
`export.ts:105–112` — if `imageData` is missing, return a `text` block with
`isError: true` naming the cap and the fix (*"re-request at a lower `scale`, or use
`format: \"SVG\"`"*). Also close the two adjacent holes already logged in session 41:
`export.ts:114–121` returns its catch-block error without `isError: true`, and
`export.ts:88–90` only flags a zero-image batch when `result.errors` is also populated.

**Estimated savings**: 17 calls → 1 in this session. Across verification-heavy sessions,
~6–17 calls each, plus the reputational cost below.

### 2. The failure drove a defection to the official Figma MCP

Call #130 is a `ToolSearch` whose only purpose was to locate
`mcp__plugin_figma_figma__get_screenshot`. The agent then used the **competing product**
for all four subsequent screenshots, each requiring a `curl` + `Read` round trip because
that tool returns a URL rather than image bytes.

This is the concrete form of the risk the tracker's benchmark note flagged: `[BUG-016]` is
not merely a call-count tax, it is the one failure mode that makes an agent abandon
Figmagent mid-task for the official server. Worth weighting above raw call savings when
prioritising.

### 3. `screenshot(format:"SVG")` returns 182-byte text files as binary blobs (`[TOOL-028]`)

Calls #146 and #148 succeeded, returning five SVGs of **182, 303, 707, 231 and 299 bytes**.
Every one was emitted as an `image` content block with `mimeType: "image/svg+xml"`, which
the client cannot render, so each was written to disk as
`[Image from Figmagent] Binary content (image/svg+xml, 182 bytes) saved to …`.

The agent then had to spend calls #147 and #149 running `cat` over the blob paths to read
content that is plain text and would have fit inline several times over.

**Pattern observed**: `screenshot {nodeIds:[…], format:"SVG"}` → `Bash cat <blob paths>` →
usable SVG source. Twice, back to back.

**Root cause**: `export.ts:74` (batch) and `export.ts:105–112` (single) always emit
`{ type: "image" }`, regardless of format. SVG is text.

**Proposed fix**: when `format === "SVG"`, base64-decode and emit
`{ type: "text", text: <svg source> }` instead of an image block (subject to the normal
output budget). This makes SVG the natural, inline-readable fallback for exactly the
geometry-measurement use case this session needed — and the working escape hatch from
issue 1.

**Estimated savings**: 2 calls here; more importantly it converts the `[BUG-016]` workaround
from "usable after a `cat`" into "usable directly".

### 4. `read` before `use_file` on remote — 4th occurrence (`[BUG-014]`)

Call #123 was `read({nodeId:"2210:680"})` → `No Figma file selected`. Call #124 was
`use_file` with the full `figma.com/design/uwhEpCvlz26oQeK0rql95G/…` URL, which succeeded,
and #125 re-ran the identical `read`. The agent had the URL the entire time.

Identical to the session 36 and 38 occurrences already recorded under `[BUG-014]`. One
wasted call, recovered in one turn, but now consistent enough across four sessions to be
worth a docs/description fix rather than continued observation.

Worth noting for `[BUG-020]`: here the agent passed the URL as `channel:` and it worked
cleanly — confirming that the parameter *accepts* a URL on remote and that the session 40
failure was purely the parameter **name** (`url:` silently dropped), not the value.

## Error Analysis

### 1. `screenshot` `-32602 invalid_union` (1 failure, ~8 minutes lost)

```
MCP error -32602: MCP error -32602: Invalid tools/call result: [
  { "code": "invalid_union", "errors": [ [
      { "code": "invalid_value", "values": ["text"], "path": ["type"],
        "message": "Invalid input: expected \"text\"" },
      { "expected": "string", "code": "invalid_type", "path": ["text"], … } ] ] } ]
```

Input: `{"nodeId": "2210:680", "scale": 4}`. Covered in full above.

**Agent recovery**: good judgement, bad outcome. It did **not** retry-storm — one failure,
then straight to an alternative. But the alternative it chose was the competing MCP plus a
six-call shell pipeline, and it took ~8 minutes and 17 calls to arrive at `format: "SVG"`,
which was available from the start and worked first try. The error message gave it nothing
to work with: a raw Zod union dump names no cause and states no fix, in direct violation of
the project's "no user-facing error without a stated fix" rule.

**Fix needed**: as in issue 1 — cap the single-node payload, guard the missing `imageData`,
and return a fix-stating `isError: true` text block naming both remedies (lower `scale`,
or `format: "SVG"`).

### 2. `read` before file selection (1 failure, ~5 seconds lost)

```
Error reading nodes: No Figma file selected. Pass a file URL to use_file
(e.g. https://www.figma.com/design/<fileKey>/...) or set FIGMA_FILE_KEY.
```

**Agent recovery**: exemplary — one call, correct fix applied immediately from the message.
The error did its job. This is a documentation gap, not an error-quality gap.

## What Worked Well

1. **`read` batching was near-optimal.** Three `read` calls covered the entire measurement
   task: one `structure/depth:3` to orient (11 nodes, 55 tokens), then
   `read({nodeIds:[6 nodes], detail:"full"})` in a single call for the handle artwork, then
   `read({nodeIds:[2], detail:"layout", depth:0})` for frame geometry. The documented
   *"pass sibling nodes as a `nodeIds` array"* guidance was followed exactly — a naive agent
   would have spent 9 calls here.

2. **Detail levels were chosen correctly.** `structure` to orient, `full` only on the six
   nodes whose paint/stroke values were actually needed, `layout` for pure geometry. No
   over-fetching, and `detail: "full"` correctly surfaced the bound variable
   (`wpds-color/background/thumb/neutral-weak`) that the code needed to match — the exact
   mistake flagged as `[AGENT-024]` in session 41 was **not** repeated.

3. **`format: "SVG"` is a genuine, verified `[BUG-016]` workaround.** Two batch SVG calls
   succeeded on the same file and nodes minutes after the PNG failure. This is the first
   session to establish it empirically, and it should go in the `screenshot` tool
   description.

4. **Figma-as-spec worked.** Reading exact SVG path data out of Figma to reproduce marker
   geometry in code (`points="-6.5,-4 0,0 -6.5,4"`, dash patterns, cap geometry) is a
   read-only use case the FSGN format serves well — 8 Figmagent calls supported ~230 calls
   of downstream code work.

## Priority Improvements

### Tool Changes (ranked by impact)

1. **`screenshot` / `export.ts` + `document.js`** — cap the single-node export payload
   (mirror `EXPORT_MAX_PAYLOAD_CHARS` from the batch path), guard the missing `imageData`,
   and return a fix-stating error. `[BUG-016]`, **P0, 5th recurrence**. Saves ~17 calls in
   sessions like this one and closes the only failure mode that pushes agents to the
   official MCP.
2. **`screenshot`** — return SVG as inline `text`, not a binary blob. `[TOOL-028]`, P2.
   Saves 2 calls per SVG batch and makes the `[BUG-016]` workaround directly usable.
3. **`screenshot` description** — document `format: "SVG"` as the fallback when a raster
   export fails, and note that `scale` multiplies payload size. Zero-code mitigation
   available today.

### Agent Skill Updates

1. **On remote, call `use_file` before the first `read`** when a Figma URL is already in
   hand. `[BUG-014]`, 4th occurrence — promote from observation to an explicit line in the
   remote-onboarding docs.
2. **When a Figmagent screenshot fails, try `format: "SVG"` before reaching for another
   MCP.** This session spent 17 calls learning that lesson the expensive way.
