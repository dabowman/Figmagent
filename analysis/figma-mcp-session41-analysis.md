# Figma MCP Session 41 Analysis

## Session Overview

- **Transcript**: `8caa2afa-e1c6-4dd1-87d8-9c09b7037b18.json` (external project: **vip-workflows**, branch `admin-design-followup`, remote transport)
- **Duration**: 18 minutes (2026-06-29 18:55 → 19:12 UTC)
- **Total tool calls**: 41 main + 7 sub-agent = **48** (31 Figmagent)
- **Total errors**: 2 flagged `is_error: true`, **plus 4 unflagged soft failures** (1 batch `screenshot`, 3 `get_design_system`)
- **Reconnections**: 0 (remote transport — no channels)
- **Context restarts**: 0
- **Task**: Reconcile the Figma `StageNode` COMPONENT_SET (`2055:163`, "🔀 VIP Workflow i2") against the repo's `StageNode.js` + `SequenceGraphEditor.css`. Read both sides, present the divergences, then — on the user's decision that **code is source of truth** — update Figma: fix token drift (radius, default border, right padding), replace the Selected state's gray-fill/blue-text/actions design with the code's brand-border model, add the 4px color accent stripe and the top/bottom connection handles, then tokenize the new surfaces.

Direct continuation of Session 40 (same file, same repo, ~13 minutes later).

## Metrics

| Metric | Session 40 | This Session (41) | Change |
|---|---|---|---|
| Total tool calls | 56 (45 figma) | 41 main + 7 sub-agent (31 figma) | smaller, tighter task |
| Meta/overhead calls (ToolSearch) | 6 (10.7%) | 3 (7.3%) | **better** |
| Errors | 4 hard + 3 user-rejects + 2 unflagged soft | 2 hard + **4 unflagged soft** | fewer hard, same soft-failure problem |
| Estimated waste % | ~29% (16/56) | **~24%** (10/41) | modestly better |

Waste breakdown: `get_design_system` library-blind dead end 3 · `get_enabled_library_variables` un-batched queries 3 · `screenshot` batch silent-zero 1 · `screenshot` single `-32602` 1 · corrective `edit` after `write` dropped FILL 1 · malformed-JSON `write` retry 1.

## Tool Call Distribution

| Tool | Calls | Notes |
|---|---|---|
| `mcp__Figmagent__screenshot` | 11 | 1 hard error (`-32602`), 1 **silent zero-export batch**; the other 9 (3 parallel triplets) all succeeded and drove every verification step |
| `mcp__Figmagent__get_enabled_library_variables` | 4 | one `query` per token — no multi-query batch; each response echoed all 13 collections, 11 of them empty |
| `mcp__Figmagent__edit` | 4 | all `success: true`; batched 7 / 3 / 3 / 6 nodes — excellent batching |
| `mcp__Figmagent__write` | 4 | 1 malformed-JSON reject (model-side), 3 accent frames — **all 3 dropped `layoutSizingVertical: FILL`** |
| `mcp__Figmagent__get_design_system` | 3 | **all 3 returned `{"variables":[],"collections":[]}`** — library-only file |
| `mcp__Figmagent__read` | 2 | clean `structure`-then-`full` escalation |
| ToolSearch | 3 | 7.3% overhead (external repo: tools deferred, not preloaded) |
| `mcp__Figmagent__use_file` | 1 | correct URL form first try (Session 40's `url`-param trap avoided) |
| `mcp__Figmagent__import_library_variable` | 1 | batched 5 keys correctly |
| `mcp__Figmagent__run_script` | 1 | escape hatch for `layoutPositioning: 'ABSOLUTE'` + `createNodeFromSvg` |
| `Agent` (code read) | 1 | 7 sub-agent calls, run **in parallel** with the Figma reads |
| `AskUserQuestion` / `Skill` | 2 | decision fork + `figma-guidelines` load |
| `Write` / `Edit` / `Read` (memory) | 4 | recorded the source-of-truth decision |

## Efficiency Issues

### 1. `write({parentId})` silently drops `layoutSizingHorizontal/Vertical: "FILL"` (saves ~1 call + 3 false warnings per attach)

Calls 25–27 created three `accent` FRAMEs into the three `StageNode` variants with `layoutSizingVertical: "FILL"`. All three returned `success` **plus** an identical `fill_not_applied` warning:

> `layoutSizingVertical: 'FILL' on 2142:31354 did not apply — it reports FIXED. Fix: ensure parent 2017:152 ("Type=Default") has layoutMode: 'HORIZONTAL' or 'VERTICAL', or give 2142:31354 an explicit height.`

**The stated fix was wrong** — `2017:152` already had horizontal auto-layout (call 5's `read` reported "Horizontal auto-layout, center-aligned, gap `md`"). The agent read past the misleading advice correctly (*"The accents were created but vertical FILL didn't take on creation. Let me set FILL now that they're attached"*) and fixed it with a corrective `edit` (call 28), which succeeded with no warning.

**Root cause** (verified in source): `src/figma_plugin/src/commands/create.js:386`

```js
if (parentNode && "layoutMode" in parentNode && parentNode.layoutMode !== "NONE" && nodeType !== "TEXT") {
  if (spec.layoutSizingHorizontal === "FILL") node.layoutSizingHorizontal = "FILL";
  if (spec.layoutSizingVertical === "FILL") node.layoutSizingVertical = "FILL";
}
```

This is the "set FILL after the node is attached" pass, and it is gated on **`parentNode`** — the in-tree parent object, which is only populated when the node is a *child inside the same `write` tree*. When the caller instead passes a top-level **`parentId`** to attach to an existing node (`create.js:215–227` resolves and appends it as `targetParent`, never assigning `parentNode`), the block is skipped entirely. The earlier sizing pass at `create.js:332` is gated on the *node's own* `spec.layoutMode`, which a plain 4×36 divider frame doesn't have. So FILL is never applied on either pass.

The same gate makes the assertion's message wrong: `runPostWriteAssertions` correctly detects `FIXED ≠ FILL`, but the fix text blames the parent's `layoutMode` because nothing on that path ever consulted the *real* parent.

**Proposed fix:** in the post-append pass, resolve the effective parent as `parentNode || node.parent` and use that for both the auto-layout check and the assertion's fix message.

**Estimated savings:** removes 1 corrective `edit` and 3 misleading warnings per `write({parentId})` attach into an auto-layout parent — a common shape (adding a child to an existing component).

### 2. `get_design_system` still no-ops on library-only files (saves ~3 calls) — recurrence of [TOOL-024]

Calls 11–13, the same dead end as Session 40 (which burned four calls on it), one session later in the same file:

| Call | Filter | Result |
|---|---|---|
| 11 | `namePattern: "^wpds-(typography/…|dimension/…|border/radius/md)"` | `{"variables":[],"collections":[]}` |
| 12 | `collection: ["Typography","Dimension","Border"]` + looser regex | `{"variables":[],"collections":[]}` |
| 13 | unfiltered, `maxOutputChars: 2000` | `{"variables":[],"collections":[]}` |

The agent progressively loosened the filter because an empty result is indistinguishable from a bad one, then abandoned the tool and switched to `get_enabled_library_variables` (call 17), which immediately returned 13 collections. Identical failure shape to Session 40 → **second consecutive session**, and the fix is already specified in [TOOL-024].

**Proposed fix:** unchanged from [TOOL-024] — when the local set is empty and `getAvailableLibraryVariableCollectionsAsync()` returns ≥1 collection, say so and route to `get_enabled_library_variables`.

### 3. `get_enabled_library_variables` has no multi-query batch, and echoes empty collections (saves ~3 calls)

Calls 17–20 ran four independent single-term queries — `"radius"`, `"stroke/surface/neutral"`, `"stroke/interactive/brand"`, `"caution"` — to assemble one import list, then fed all five resulting keys into a **single** `import_library_variable` call (call 21). The discovery step is the un-batched half of an otherwise batched workflow.

Each response was also mostly noise: with `query` set, all **13** enabled collections come back, and the 11 that matched nothing carry `"variables":[]`. Two of the four responses were truncated by the output budget (2.5KB and 4.8KB) — spending the budget on empty collections.

**Root cause:** `tools/libraries.ts:611` types `query` as a single `z.string()`, and the plugin handler returns the full collection list regardless of match count.

**Proposed fix:** accept `query: z.string().or(z.array(z.string()))` (matching the batching already present in `import_library_variable`), and omit zero-match collections from the response when a query is supplied. Same shape as [TOOL-021] for `search_library_components`.

**Estimated savings:** 4 calls → 1, and a much smaller payload per call.

### 4. `edit` can't set `layoutPositioning: "ABSOLUTE"` — forces `run_script` (saves ~1 script per overlay build)

Call 33 dropped to `run_script` to add the top target dot and bottom drag-grip handles, which straddle the component's border. The agent stated the gap explicitly:

> *"These need absolute positioning, which the edit tool doesn't expose, so I'll use `run_script`."*

Verified: `layoutPositioning` appears **nowhere** in `src/figmagent_mcp/tools/*.ts` or `src/figma_plugin/src/commands/*.js`. The script also had to set `clipsContent = false` on the parent (also unexposed) and use `createNodeFromSvg` to inline an SVG path into an auto-layout frame.

Per CLAUDE.md ("recurring scripts become tool roadmap items") this is the second consecutive session where a pure property-setting job fell to `run_script` — Session 40 hit the same wall with `letterSpacing`/`textCase`/`minWidth` ([TOOL-025]). Script writes forfeit `edit`'s per-op error reporting, boundary pre-checks, and post-write assertions.

**Proposed fix:** add `layoutPositioning` (`AUTO` | `ABSOLUTE`) and `clipsContent` as direct-value fields on `nodeOpSchema` in `tools/apply.ts` plus setters in `apply.js`. Absolutely-positioned children are the standard Figma idiom for badges, handles, and overlays — this is not an exotic need.

## Error Analysis

### 1. `screenshot` on remote: one `-32602` protocol error and one silent zero-export (2 calls, ~1 minute lost) — 4th recurrence of [BUG-016]

Two distinct failures, both at the start of the session:

**(a) Batch, silent.** Call 6 — `screenshot({nodeIds: ["2017:152","2017:158","2017:191"], scale: 2})` → `Exported 0 node(s): none`, **`is_error: false`**. No `Errors:` block, no `Truncated:` block. An agent branching on `is_error` would read total failure as success.

**(b) Single, protocol-level.** Call 7 — `screenshot({nodeId: "2055:163", scale: 2})` on the COMPONENT_SET → `MCP error -32602: Invalid tools/call result: [{"code":"invalid_union", … "path":["type"], "message":"Invalid input: expected \"text\""}, {"expected":"string","code":"invalid_type","path":["text"]…}]`.

The agent recovered cleanly and cheaply — three parallel single-node `screenshot` calls (8–10) on the child variants, all of which succeeded — and never retried the failing forms. It went on to take 6 more successful screenshots. No retry storm.

**Root cause (new detail).** `src/figmagent_mcp/tools/export.ts:98–113` builds the single-mode response unconditionally:

```ts
const result = (await sendCommandToFigma("export_node_as_image", { … })) as SingleExport;
return { content: [{ type: "image", data: result.imageData, mimeType: result.mimeType || "image/png" }] };
```

There is no check that `result.imageData` is a non-empty string. When the remote path returns a result object without it, the tool emits `{ type: "image", data: undefined }` — which is neither a valid MCP `text` nor `image` block, so the SDK rejects the **whole** result with `-32602`. That is exactly the `invalid_union` shape observed, and it explains why the error is unreadable rather than a plain message. The same file's catch block (line 116–121) returns a text error **without `isError: true`**, so even a clean throw would be mis-flagged (the [BUG-008] family).

The batch path has the mirror-image hole: `ids.length === 0` only returns `isError: true` when `result.errors` is also populated (`export.ts:88–90`), so a result with neither images nor errors reports success.

**Fix needed:** guard `result.imageData` in single mode and return a fix-stating text error with `isError: true` when it's missing; add `isError: true` to the catch block; treat `ids.length === 0` in batch mode as an error regardless of whether `errors` is populated. This does not repair the upstream malformed remote payload, but it converts an opaque protocol crash into a readable, correctly-flagged error.

### 2. Malformed JSON in a `write` call (1 call, ~5 seconds lost)

Call 24 — `write` was invoked with unparseable input: `{"fillColor": {"r": 0.29, "g": 0.66, b_placeholder, "b": 0.42}}` → `InputValidationError: … could not be parsed as JSON`. Model-side serialization slip, not a Figmagent defect. The agent recognized it immediately (*"I had a typo"*) and reissued all three creates correctly in parallel. No tracker entry warranted.

## What Worked Well

1. **Parallel code-read agent overlapped with Figma reads.** Call 2 launched the `StageNode` repo-read sub-agent, then calls 3–13 did the entire Figma-side read, screenshot, and token discovery while it ran. The 7 sub-agent calls cost zero wall-clock on the main thread, and the comparison table was produced the moment the agent reported.
2. **`edit` batching was near-optimal.** Four `edit` calls covered 19 node-operations (7 + 3 + 3 + 6) — token rebinding across all three variants, three deletions, three accent fixes, six handle-surface binds. Zero single-node `edit` calls.
3. **The `scope_mismatch` pre-check paid for itself.** Call 22's attempt to bind `wpds-color/fg/content/caution` to a stroke was caught before mutation with the scopes named (`[SHAPE_FILL, TEXT_FILL]` vs needed `STROKE_COLOR`). The agent adapted in one turn — kept the already-correct `stroke/surface/warning` binding — with no retry, and noted the plugin had independently reproduced the same limitation the *code's* comment describes. This is exactly the "act on warnings instead of re-reading to verify" contract working.
4. **`AskUserQuestion` at the genuine decision fork.** Call 14 stopped at "align code to Figma vs Figma to code" rather than guessing — the divergences (Selected state was a materially different design) made this a real fork, not a routine judgment call.
5. **Screenshot-driven verification at every phase boundary.** Three parallel triplets (8–10, 29–31, 34–36) verified the base state, the accent stripe, and the handles. Despite the transport's screenshot flakiness, visual verification carried the whole build.
6. **`use_file` first try.** Passed the Figma URL as `channel` — avoiding Session 40's `url`-param silent failure ([BUG-020]) without needing the fix to land.

## Priority Improvements

### Tool Changes (ranked by call savings)

1. **`write` — apply FILL sizing after `parentId` attach** ([BUG-022], `create.js:386`). Gate on `parentNode || node.parent`. Removes a corrective `edit` and 3 misleading warnings per attach.
2. **`screenshot` — validate the export result before building the content block** ([BUG-016], `export.ts:98–121`, `export.ts:88`). Converts an opaque `-32602` into a readable flagged error and stops the batch path reporting total failure as success. 4th session affected.
3. **`get_design_system` / `lint` — detect library-only files** ([TOOL-024]). Second consecutive session, 3–4 wasted calls each time.
4. **`get_enabled_library_variables` — accept a `query` array, drop zero-match collections** ([TOOL-026]). 4 calls → 1, plus a large payload reduction.
5. **`edit` — expose `layoutPositioning` and `clipsContent`** ([TOOL-027]). Removes the `run_script` fallback for absolutely-positioned overlays.

### Agent Skill Updates

1. **On a library-only file, skip `get_design_system` entirely.** One empty `{"variables":[],"collections":[]}` is enough — go straight to `get_enabled_library_variables`. Do not loosen the filter and retry (3 calls in this session, 4 in Session 40).
2. **A `fill_not_applied` warning after `write({parentId})` is expected, not diagnostic.** Re-apply the sizing with a follow-up `edit` rather than investigating the parent's `layoutMode` — the warning's stated fix is currently wrong on that path.
3. **Prefer `nodeIds` batch `screenshot`, but treat `Exported 0 node(s): none` as failure.** It is not flagged as an error; fall back to parallel single-node calls immediately (as this session did).
