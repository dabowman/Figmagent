# Figma MCP Session 40 Analysis

## Session Overview

- **Transcript**: `0ef451ab-ce2c-4dc8-a4dc-ea645e0f6fe2.json` (external project: **vip-workflows**, branch `admin-design-followup`, remote transport)
- **Duration**: 22 minutes (2026-06-29 18:46 → 19:08 UTC)
- **Total tool calls**: 56 (45 Figmagent, no sub-agents)
- **Total errors**: 7 flagged `is_error: true` — but only **4 real tool errors** (3 were user permission rejections), **plus 2 unflagged soft failures** (`use_file`)
- **Reconnections**: 0 (remote transport — no channels)
- **Context restarts**: 0
- **Task**: Restyle the `StageStartMarker` COMPONENT (`2017:199`) in "🔀 VIP Workflow i2" to match the sequence start/end terminal marker — first against the Figma `StageNode/Type=Terminal` variant, then (after checking the actual CSS) against the code's `.wf-terminal-node` pill; finally center + min-width all 3 variants of the resulting component set and audit token coverage.

## Metrics

| Metric | Session 38 | This Session (40) | Change |
|---|---|---|---|
| Total tool calls | 21 (16 figma) | 56 (45 figma) | larger task (2 restyle passes) |
| Meta/overhead calls (ToolSearch) | 3 (~14%) | 6 (10.7%) | slightly better |
| Errors | 3 | 4 hard + 3 user-rejects + **2 unflagged soft** | soft-failure regression |
| Estimated waste % | ~14% | **~29%** (16/56) | worse — 3 discovery dead ends |

Waste breakdown: `use_file` param thrash 4 · `grep` param thrash 2 · `grep` page-scope miss ~2 · `get_design_system` dead end 4 · `get_enabled_library_variables` no-op query 1 · `cornerRadius` rebind 2 · dead `lint` 1.

## Tool Call Distribution

| Tool | Calls | Notes |
|---|---|---|
| `mcp__Figmagent__read` | 11 | 3 errors (1 pre-`use_file`, 2 user-rejected); 1 verification read used the wrong `detail` to confirm bindings |
| `mcp__Figmagent__screenshot` | 7 | good — visual verification drove both restyle passes |
| ToolSearch | 6 | 10.7% overhead (external repo: tools deferred, not preloaded) |
| `mcp__Figmagent__get_enabled_library_variables` | 5 | 1 no-op `query` + 4 per-collection walks |
| `mcp__Figmagent__get_local_components` | 4 | 1 user-rejected |
| `mcp__Figmagent__get_design_system` | 4 | **all 4 returned `{"variables":[],"collections":[]}`** — file has zero local variables |
| `mcp__Figmagent__use_file` | 3 | 2 **silently failed** (wrong param name, `is_error: false`) |
| `mcp__Figmagent__grep` | 3 | 2 failed (missing criterion, then string-vs-array `type`) |
| `mcp__Figmagent__get_selection` | 2 | 1 failed (no file selected — cascade from the silent `use_file` failure) |
| `mcp__Figmagent__edit` | 2 | both reported `success: true`; the first under-applied `cornerRadius` |
| `mcp__Figmagent__run_script` | 2 | escape hatch for `letterSpacing`/`textCase`/`minWidth`/per-corner binds |
| `mcp__Figmagent__lint` | 1 | scanned **0 nodes** — "No local variables found in this file" |
| `mcp__Figmagent__import_library_variable` | 1 | batched 3 keys correctly |
| Bash / Read / AskUserQuestion | 5 | read the real `.wf-terminal-node` CSS — the pivot that saved the task |

## Efficiency Issues

### 1. `use_file` silently ignores an unknown `url` param and reports failure as success (saves ~4 calls) — NEW [BUG-020]

The agent had the file URL from the start and correctly reached for `use_file`. It called `use_file({ url: "https://www.figma.com/design/uwhEpCvlz26oQeK0rql95G/…" })` (call 2) and got back:

> `Remote transport selects files by fileKey, not channels. Pass a Figma file URL (e.g. https://www.figma.com/design/<fileKey>/...) or a bare fileKey.`

The agent did exactly what the message asked — retried with a **bare fileKey** (call 3, still via `url:`) — and got the identical message. It then called `get_selection` (call 4), which failed with `No Figma file selected`. Only after a ToolSearch to re-read the schema (call 5) did it find the answer, narrating: *"The parameter is `channel`, not `url`."* Call 6 — `use_file({ channel: "<the same URL>" })` — succeeded.

**Pattern observed:** 6 calls to select a file the agent already had the URL for; the working call passes a *URL* through a parameter named `channel`.

**Root cause:** three compounding defects, all live in current code:
1. `use_file` (`src/figmagent_mcp/tools/scan.ts:199`) declares exactly one param, `channel`, with `.default("")`. An unknown `url` key is silently dropped by the non-strict Zod object, so `channel` falls back to `""` and the handler takes its empty-input branch.
2. That branch's message says *what* to pass ("a Figma file URL … or a bare fileKey") but never names the **parameter** to pass it in — so an agent that follows the message verbatim loops forever.
3. The message does not match `ERROR_TEXT_PREFIX` in `instance.ts:85`, so `looksLikeError` returns false and the response ships **`is_error: false`**. A *failed file selection* reads as success — which is precisely why the agent proceeded to `get_selection` instead of retrying.

**Proposed fix:** (a) accept `url` and `fileKey` as aliases for `channel` on `use_file`; (b) prefix the empty-input remote message with `Error: ` so `looksLikeError` flags it, and name the parameter — e.g. `Error: no file specified. Pass the Figma file URL or fileKey as use_file's "channel" parameter (remote transport has no channels).` Sibling of [BUG-008].

**Estimated savings:** ~4 calls on every remote session that starts from a URL.

### 2. `get_design_system` and `lint` are blind to library-only files (saves ~6 calls) — NEW [TOOL-024]

This file binds **every** token to enabled team libraries (WPDS Gutenberg 22.3, Automattic Components) and has **zero local variables**. Both discovery tools no-op without saying why:

- `get_design_system` returned `{"variables":[],"collections":[]}` **four times** (calls 35–38) as the agent progressively loosened its filters — specific regex → broad regex → `collection: "Color"` → finally an unfiltered call with `maxOutputChars: 2000` as a sanity check. An empty result is indistinguishable from a bad filter, so the agent had to disprove its own filters one call at a time before concluding *"they're library tokens"* and switching to `get_enabled_library_variables` (calls 39–42).
- `lint(2136:630)` (call 55) returned `totalNodesScanned: 0` with `message: "No local variables found in this file. Create variables first to enable linting."` The agent's own verdict: *"That's a tool limitation, not a design problem."* It then hand-audited the tree and reported the coverage table manually.

The `lint` message is actively misleading — "Create variables first" is the wrong advice for a file that is fully tokenized against libraries.

**Root cause:** `getLocalVariables` / `lintDesign` (`src/figma_plugin/src/commands/lint.js:596`, `styles.js:178`) only consider `figma.variables.getLocalVariables*`. Neither consults `figma.teamLibrary.getAvailableLibraryVariableCollectionsAsync()` — which the plugin already calls elsewhere (`styles.js:1184`) — to detect that the file's tokens live in libraries.

**Proposed fix:** when the local-variable set is empty **and** `getAvailableLibraryVariableCollectionsAsync()` returns ≥1 collection, both tools should say so and route the agent: `No local variables — this file's tokens come from N enabled libraries (WPDS…, Automattic Components…). Enumerate them with get_enabled_library_variables and bind with import_library_variable + edit({variables}).` This converts [AGENT-020] (Session 35, agent-behavior) into a tool-side fix, which is the durable form.

**Estimated savings:** ~6 calls per library-only-file session (3 of the 4 `get_design_system` probes, the no-op `query` call, the dead `lint`).

### 3. `edit` has no direct-value fields for `letterSpacing` / `textCase` / `minWidth` (forces `run_script`) — NEW [TOOL-025]

To match `.wf-terminal-node` the agent needed `letter-spacing: 0.4px`, `text-transform: uppercase`, and `min-width: 120px` as **literals** (the CSS uses raw values; no tokens exist for them). It concluded: *"letter-spacing, text-case, and min-width aren't available through the edit tool"* — and dropped to `run_script` for the whole restyle (call 45), then again for centering + min-width across all 3 variants (call 52).

Verified in current code: `nodeOpSchema` (`src/figmagent_mcp/tools/apply.ts`) exposes 23 direct-value props; `minWidth`, `maxWidth`, `letterSpacing`, `lineHeight`, and `textDecoration` appear **only** in the `VARIABLE_FIELDS` binding enum, and `textCase` exists nowhere in the repo. So these properties are bindable-to-a-variable but not settable as literals — an asymmetry with no stated rationale.

**Root cause:** `VARIABLE_FIELDS` and the direct-value schema drifted apart; text-transform was never added to either.

**Proposed fix:** add `minWidth`, `maxWidth`, `minHeight`, `maxHeight`, `letterSpacing`, `lineHeight`, `textCase`, `textDecoration` as direct-value fields on `nodeOpSchema` + the corresponding `apply.js` setters. Per CLAUDE.md ("recurring scripts become tool roadmap items") both `run_script` calls in this session were pure property-setting that a complete `edit` would have absorbed.

**Estimated savings:** ~2 `run_script` calls/session on any code-fidelity restyle, and removes an atomicity/rollback risk (script writes are all-or-nothing hand-rolled).

### 4. `grep` parameter discovery costs 2 calls, then misses the node by page scope (saves ~4 calls) — NEW [BUG-021], [AGENT-023]

Three consecutive `grep` calls to run one search:
- Call 9: `{ pattern, searchIn: "names", nodeTypes: "COMPONENT,…" }` → `Error: at least one search criterion is required (…)`. All three params the agent passed were invented; the error lists the *valid* criteria but never says the supplied keys were unrecognized — so the failure reads as "I passed too few," not "I passed the wrong names."
- Call 10: `{ name: "(?i)(sequence|…)", type: "COMPONENT" }` → raw MCP `-32602` with an unformatted Zod dump (`"expected": "array", "received": "string"`). No fix stated, in violation of the project's no-error-without-a-fix rule.
- Call 11: `type: ["COMPONENT"]` → succeeded, but returned nothing useful: `grep` defaults to the **current page**, and the target lived on another page. The agent had to fall back to `read({})` for a document overview (call 12) and re-narrow (calls 13–14).

**Root cause:** (a) unknown keys are silently dropped rather than named in the error; (b) scalar-vs-array coercion missing on `type`/`componentId`/`variableId`/`styleId` — the array variant of [TOOL-006]/[BUG-005]; (c) `scope` defaults to "current page", which is a weak default on the **remote** transport where there is no live selection and the entry point is a URL pointing at an arbitrary page.

**Proposed fix:** (a) reject unknown keys with `Error: unknown parameter "searchIn". Did you mean "name"/"text"? Valid criteria: …`; (b) `.or(z.string().transform(s => s.split(",")))` on the array criteria; (c) on remote, default `scope` to `DOCUMENT` (or state the current-page default in the no-results message: *"searched the current page only — pass scope: 'DOCUMENT' to search all pages"*).

**Estimated savings:** ~4 calls per search-driven session.

### 5. `cornerRadius` variable binding covers only one corner (saves ~2 calls) — RECURRENCE of [TOOL-015]

Call 24's `edit` included `variables: { cornerRadius: "VariableID:6aaa…/2145:33" }` and returned `{"success":true,"nodesEdited":2,"totalNodes":2}`. On re-reading, the agent found: *"The corner radius binding only applied to the top-left corner — the other three are still bound to radius/sm."* It issued call 27 re-binding all four per-corner keys explicitly.

**Root cause now pinpointed:** `FIELD_MAP` in `src/figma_plugin/src/commands/styles.js:1128` maps `cornerRadius: "topLeftRadius"`. `bindVariableToNode` (`apply.js:151`) then calls `node.setBoundVariable("topLeftRadius", …)` and returns `null` (no warning), so `edit` reports full success for a 1-of-4 application.

Note the follow-up call 27 was *also* ineffective in principle — it passed all four per-corner keys, which is correct only because `FIELD_MAP` maps each per-corner name to its own field (lines 1129–1132). The agent verified with `read(detail: "layout", depth: 1)` (call 28), which **does not emit `variableBindings`**, so the fix was never actually confirmed; the binding was only truly settled at call 45 via `run_script`'s explicit four `setBoundVariable` calls.

**Proposed fix:** in `bindVariableToNode`, expand a `cornerRadius` field to all four corner properties (one-line fan-out at the `FIELD_MAP` lookup), or at minimum return a warning noting only `topLeftRadius` was bound. Third session affected (19, 35, 40) with an exact one-file fix location — should move from P2 to P1 and be marked auto-fixable.

## Error Analysis

### 1. Silent `use_file` failure cascading to `get_selection` (2 unflagged + 1 flagged, ~1 min lost)

Calls 2 and 3 returned `is_error: false` for a *failed* file selection; call 4 (`get_selection`) then hard-failed with `Error getting selection: No Figma file selected`. Without the unflagged pair, the agent would have retried `use_file` immediately instead of assuming the file was set. This is the same class as [BUG-008] — a failure response that doesn't start with an error sentinel, so `looksLikeError` misses it.

**Agent recovery:** good — after the third symptom it re-read the schema via ToolSearch and fixed the param name in one shot. No retry storm.

**Fix needed:** prefix the message with `Error: ` (covered in Efficiency Issue 1).

### 2. `grep` `-32602` Zod dump with no stated fix (1 failure)

```
MCP error -32602: Input validation error: Invalid arguments for tool grep: [
  { "code": "invalid_type", "expected": "array", "received": "string", "path": ["type"], … }
]
```

**Agent recovery:** immediate and correct — wrapped in an array on the next call. Fail-fast rule respected.

**Fix needed:** scalar→array coercion, plus a human-readable fix line. Same family as [TOOL-006].

### 3. Three user permission rejections (calls 15–17)

Not tool defects — the user interrupted a speculative `get_local_components` + two parallel `read(detail: "full", depth: 4)` calls, then the agent asked a clarifying question via `AskUserQuestion` (call 18) and re-ran the same two reads with approval (calls 19–20). Correct behavior; noted only so the raw `is_error` count (7) isn't misread as 7 tool failures.

## What Worked Well

1. **Reading the real CSS before trusting the Figma reference.** After finishing pass 1, the agent ran two `Bash grep`s and two `Read`s against `SequenceGraphEditor.css` / `TerminalNode.js` and found the Figma `StageNode/Terminal` variant did **not** reflect the shipped `.wf-terminal-node` (pill vs 4px radius, neutral-strong vs neutral, uppercase 11px/600 label vs body text). It redid the restyle against the code. Four cheap local calls prevented shipping a wrong-by-design component — this is the code-as-source-of-truth pattern working exactly as intended.
2. **`screenshot` as the verification primitive.** 7 calls, zero failures, and every restyle decision (the blue→neutral diff, the pill shape, the left-aligned-label bug at call 53) was caught visually rather than by re-reading trees.
3. **Batched `import_library_variable`.** Three variable keys in one call (call 44) — the plural form used correctly, unlike Session 35's 11 singular `import_library_component` calls.
4. **`AskUserQuestion` at the ambiguity.** Rather than guessing which component was the styling reference, the agent asked (call 18) and got a decisive answer. Cost 1 call, avoided a whole wrong-target restyle.
5. **Honest reporting of the dead `lint`.** The agent didn't paper over the empty lint result — it named the limitation, then hand-audited and presented the token coverage table. Correct escalation from a broken tool to manual verification.

## Priority Improvements

### Tool Changes (ranked by call savings)

1. **`get_design_system` + `lint` — detect library-only files** and route to `get_enabled_library_variables` / `import_library_variable` instead of returning empty-or-misleading results. Saves ~6 calls/session and fixes actively wrong advice ("Create variables first"). **P1**
2. **`use_file` — accept `url`/`fileKey` aliases; flag the empty-input remote response as an error and name the parameter.** Saves ~4 calls on every URL-initiated remote session. **P1, auto-fixable**
3. **`grep` — coerce scalar→array on `type`/`componentId`/`variableId`/`styleId`; name unknown params in the criterion error; default `scope` to `DOCUMENT` on remote.** Saves ~4 calls. **P1, partly auto-fixable (type-coercion)**
4. **`edit` — add direct-value `letterSpacing`, `textCase`, `lineHeight`, `minWidth`/`maxWidth`/`minHeight`/`maxHeight`, `textDecoration`.** Removes 2 `run_script` escape hatches per code-fidelity restyle. **P1**
5. **`edit` — fan `cornerRadius` out to all four corners** (`styles.js:1128`). Third recurrence, exact fix location known. **P1 (raised from P2), auto-fixable**

### Agent Skill Updates

1. **Verify variable bindings with `detail: "full"`, not `detail: "layout"`.** [AGENT-024] Call 28 tried to confirm a binding with a `layout` read, which omits `variableBindings` entirely — the confirmation was vacuous. Add to figma-guidelines: binding verification requires `detail: "full"`, or trust the write verdict once [TOOL-015] warns properly.
2. **On remote, lead with `use_file` and pass the URL as `channel`.** Reinforces the existing #65 guidance with the concrete param name, which is the part that actually cost calls here.
3. **When `get_design_system` returns empty, suspect a library-only file before suspecting your filter.** One `get_enabled_library_variables` call distinguishes the two; the agent spent four calls disproving its own regex first.
