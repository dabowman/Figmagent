# Figma MCP Session 62 Analysis

## Session Overview

- **Transcript**: `.claude/sessions-json/0fd99f95-1b29-490e-b5f7-471e1ac2c54e.json`
- **Duration**: 64 minutes (2026-09-02 03:20:22Z → 04:24:06Z)
- **Total tool calls**: 134 (35 Figmagent, 89 Bash, 4 Edit, 3 AskUserQuestion, 2 ToolSearch, 1 Agent)
- **Total errors**: 2 (both Figmagent)
- **Reconnections**: 0 (remote transport — no channels)
- **Context restarts**: 0
- **Transport**: remote (`use_file` by fileKey `C4zLeQJs8qkAhFSLwMKP9J`)
- **Repo**: external — `~/Github/storybook` ("Archer" design system), branch `main`
- **Task**: three linked pieces of work on the same file — (1) scope all 596 Figma variables to the properties they can bind to and delete one orphan, (2) create 8 `ui/*` text styles bound to font variables and apply them across 15 component pages, (3) give the repo's `Checkbox` a label of its own, with two new component tokens mirrored into Figma. Ended in two commits (`754299a`, `8f700fd`).

This is the **10th analysed session on the "Archer" file** and the first that is not a component-mirroring build. It is also the most repo-weighted: 66% of calls are Bash against the token pipeline, and Figma is the downstream target rather than the workspace.

## Metrics

| Metric | Session 61 | This Session | Change |
|---|---|---|---|
| Total tool calls | 35 | 134 | +283% (different task shape) |
| Figmagent tool calls | 22 | 35 | +59% |
| `run_script` share of Figma calls | 12 of 22 (54.5%) | **28 of 35 (80.0%)** | **+25.5 pts — new record** |
| `run_script` share of write ops | — | **11 of 11 (100%)** | every mutation went through the escape hatch |
| Diagnostic scripts (`mode: "read"`) | — | 17 of 28 (61%) | vs 54% in session 44 |
| Errors | 5 | 2 | −3 |
| Error rate (Figma calls) | 18.2% | 5.7% | −12.5 pts |
| Estimated waste | ~20% (7 of 35) | **~8% of all calls (11 of 134); ~31% of Figma calls (11 of 35)** | see note |
| ToolSearch calls | 1 (2.9%) | 2 (1.5%) | — |
| Nodes created | ~120 | 0 | 8 text styles, 2 variables, 596 re-scoped |

**Waste note**: the two denominators tell different stories and both are needed. Against all 134 calls this is the lowest waste figure on record — but that is an artifact of 89 Bash calls doing genuinely productive pipeline work. Against the 35 Figma calls the figure is ~31%, in line with sessions 57–60.

## Tool Call Distribution

| Tool | Calls | Notes |
|---|---|---|
| Bash | 89 | Token pipeline: generate, validate, build, typecheck, lint, plus ~20 throwaway Node/Python analysis scripts in a temp dir |
| `run_script` | 28 | 11 write / 17 read; **all 28 passed `stdlib: false`**; 1 failed |
| `get_design_system` | 5 | 1 failed (before `use_file`); 1 was a `namePattern: ^zzzz` probe to list collection names cheaply |
| Edit | 4 | `Checkbox.tsx` ×2, `Checkbox.stories.tsx` ×2 |
| AskUserQuestion | 3 | zIndex scoping, font-weight acceptance, stale-style disposal |
| ToolSearch | 2 | 5 schemas at 03:22, `run_script` at 03:30 — none after |
| `use_file` | 1 | by fileKey |
| Agent | 1 | general-purpose, "dump live Figma variable names" |
| `read` | 1 | `detail: structure, depth: 1` — one call, never used again |

## Efficiency Issues

### 1. `create_styles` already implements the recipe the agent spent 5 scripts rediscovering (saves ~5 calls)

The session needed 8 text styles whose `fontFamily`/`fontWeight`/`fontSize` are **variable-bound**, on a file whose family (`PP Neue Montreal`) the remote VM cannot load. It solved this from scratch across five `run_script` calls:

- **#6** — created the style, bound family/weight/size first, then tried to set `lineHeight`. Bound three variables, then errored on the metric write.
- **#7** — probed whether `lineHeight`/`letterSpacing` could be bound too (they can, but the binding forces unit PIXELS, so `1.5` renders as `1.5px` — rejected).
- **#8** — rebuilt with the correct order: leave the style on its `createTextStyle()` Inter default, set `lineHeight`/`letterSpacing` as PERCENT literals **first**, bind family/weight/size **last**.
- **#9** — applied that order to the remaining seven styles.
- **#10** — read all eight back to confirm resolved faces.

**`create_styles` does exactly this already.** `createStyles` in `src/figma_plugin/src/commands/styles.js:903-957` runs: `createTextStyle()` → load + set font (`:909-910`) → `fontSize`/`lineHeight`/`letterSpacing` (`:912-920`) → `bindVariablesToStyle` **last** (`:957`). One call with `fontFamily: "Inter", fontStyle: "Regular"` and `variables: { fontFamily, fontWeight, fontSize }` reproduces #8's verified sequence for all eight styles.

Two things in the description stop an agent from finding that:

1. *"TEXT styles require valid fontFamily+fontStyle — fonts are loaded automatically"* (`tokens.ts:661`) reads as **name the real family**. Doing so throws at `loadFontOrFail` (`styles.js:8-17`) on remote, and that failure's stated fix — *"pass a fontFamily/fontStyle pair that exists exactly as Figma lists it"* — points at a spelling problem when the real problem is font absence ([BUG-033]'s misreporting pattern, at a call site the entry does not yet name). Nothing says *author on a loadable face and bind the family*.
2. The `variables` field lists seven bindable TEXT properties and **omits `fontWeight`** (`tokens.ts:723`) — even though `bindVariablesToStyle` (`styles.js:811-815`) passes any non-`color` field straight to `style.setBoundVariable`, so `fontWeight` works on this surface today. The description undersells the tool against the exact field the session needed.

**Root cause:** documentation, not capability. The implementation is correct and the session independently re-derived it.

**Proposed fix:** add `fontWeight` to the `variables` list in the `create_styles`/`update_styles` descriptions; add a worked example for a fully variable-bound text style on an unavailable family; make `loadFontOrFail` check `listAvailableFontsAsync` and, when the *family* is absent, state the bind-the-family fix instead of the spelling fix.

**Estimated savings:** 5 calls → 1.

### 2. `grep` can find nodes that *use* a style, but not nodes that *lack* one (saves ~4 calls)

Six of the 17 diagnostic scripts exist to answer "which TEXT nodes have no text style":

- **#14** — inventory every TEXT node per page with its current style, tallying `NONE`/`MIXED`
- **#15** — the same, reduced to `page total/unstyled` rows
- **#19** — re-run after the first apply pass (`totalUnstyled`)
- **#24** — re-run as the final gate (`unstyledCount`)
- **#11** and **#21** — the presence half, which `grep({ styleId: [...] })` covers outright (`find.ts:52,102`)

`grep` has presence criteria only; there is no negation and no `hasStyle: false`. `lint` does not close the gap either — `lint.js` never reads `textStyleId`, so "TEXT node carrying no text style" is invisible to it.

**Root cause:** missing criterion. Every audit of the form "what have I *not* done yet" is a `run_script`.

**Proposed fix:** add a negation to `grep` — either `hasStyle: false` / `hasVariable: false` booleans alongside the existing `styleId`/`variableId` criteria, or a general `negate: true` flag that inverts whichever criterion is passed.

**Estimated savings:** ~4 calls/session on any token- or style-coverage audit.

### 3. Tool schemas were loaded once, up front, and never revisited when the task pivoted (saves ~4 calls)

Both ToolSearch calls happened in the first 8 minutes:

- 03:22 — `select:use_file, get_design_system, update_variables, read, create_variables`
- 03:30 — `select:run_script`

The text-style phase started at **03:41** and ran for the next 43 minutes. `create_styles` and `update_styles` were never loaded, so they were never candidates — and `update_styles` supports `delete: true` in batch (`tokens.ts:766-771`), which is precisely what `run_script` **#13** hand-rolled to delete two stale styles.

The failure is not "the agent didn't know the tools exist" — it is that the up-front schema selection was made against the *first* phase of the task, and no re-selection happened when the task moved into a different domain. Note the contrast with the variables phase, where `update_variables` and `create_variables` **were** loaded and still lost to `run_script` (issue 4) — so the two causes are independent and both are present.

**Root cause:** agent behaviour under deferred tool schemas. This project's own CLAUDE.md says "No ToolSearch needed" because the MCP server instructions enumerate the tools — but that guidance lives in *this* repo and the session ran in `~/Github/storybook`, where the harness deferred all 45 Figmagent schemas.

**Proposed fix:** agent rule — when a task crosses into a Figma domain you have not fetched schemas for (styles, components, annotations, libraries), ToolSearch that domain before reaching for `run_script`. Cheap: one call, and it is the only thing standing between a 40-line script and a one-line tool call.

**Estimated savings:** ~4 calls (#6–#9 collapse to one `create_styles`; #13 collapses into an `update_styles` batch).

### 4. Token CRUD went to `run_script` even with the right schemas already in context

Unlike issue 3, this one cannot be explained by discovery:

- **#1** set scopes on 596 variables and deleted one orphan. `update_variables` accepts `scopes` and `delete` per operation (`tokens.ts:278,283`) and is batch-first.
- **#25** created two variables with per-mode aliases and scopes. `create_variables` accepts aliases (`{ alias: "VariableID:…" }`) and inline `scopes` (`tokens.ts:193-210`).

Both schemas were fetched at 03:22. The transcript shows no deliberation — the agent went to `run_script` directly.

The visible incentive is **payload shape**. #1 encodes 596 variables as five run-length strings of numeric ID suffixes (`"8,9,10,…"` under `"ALL_FILLS|STROKE_COLOR|EFFECT_COLOR"`), roughly 2.5KB. The equivalent `update_variables` call is 596 objects each repeating a full `VariableID:2:NNN` string — on the order of 48KB. The escape hatch is genuinely more compact here, and it also let the scope-set and the orphan-delete land atomically in one call.

For **#25** there is no such excuse beyond collection count: `create_variables` takes one collection per call, and the two new tokens live in `Color` and `Viewport`. That is 2 calls vs 1 — a real but trivial saving, paid for by forfeiting scope validation and duplicate-name detection.

**Root cause:** `update_variables` has no bulk shorthand for a property-only change across many variables. A `{ scopes: [...], variableIds: [...] }` form would make the first-class path the compact one.

**Estimated savings:** 0 calls (the script was already 1 call) — but it moves 596 writes back behind scope validation, and closes the largest single un-validated mutation in the session.

### 5. Repeated near-identical diagnostic passes (saves ~4 calls)

Several script pairs ask overlapping questions of the same document:

| Pair | Overlap |
|---|---|
| #14 → #15 | #14 tallies `name :: style` per page; #15 re-walks every page for `total/unstyled` counts #14 already had |
| #16 → #22 | both walk ancestry chains of ambiguous label layers; #22 differs only by going 5 levels instead of 4 and covering 3 pages instead of 7 |
| #19 → #24 | both are full-document style-verification passes; #24 adds owner resolution |
| #20 → #27 | #20 counts instances with a `textStyleId` override per page; #27 re-walks the document to list them |

Each pair is one full `figma.root.children` × `loadAsync` × `findAllWithCriteria` traversal repeated. Four of these eight calls are avoidable by asking the wider question first — the standing [TOOL-031] complaint that scripts cannot share a preamble makes each one a fresh from-scratch walk.

**Estimated savings:** ~4 calls.

### 6. `get_design_system` has no cheap "list collections" mode

Call **#12** is `get_design_system({ namePattern: "^zzzz", includeStyles: false })` — a pattern chosen to match nothing, so the response returns the collection list and no variables. It worked (`{"variables":[],"collections":["Color","Static","Viewport"]}`) and cost 1 call.

That is a well-aimed workaround for a missing parameter. The truncation path already lists available collection names when a response is over budget (per CLAUDE.md), so the data is there — it just cannot be requested directly.

**Proposed fix:** `get_design_system({ collectionsOnly: true })`, or document the empty-pattern idiom in the tool description so it stops being a trick each agent reinvents.

**Estimated savings:** ~1 call.

## Error Analysis

### 1. `get_design_system` called before `use_file` on remote (1 failure, ~10 seconds lost)

```
Error getting design system: No Figma file selected. Pass a file URL to use_file
(e.g. https://www.figma.com/design/<fileKey>/...) or set FIGMA_FILE_KEY.
```

Call #9 at 03:22:41, then `use_file(fileKey)` at 03:22:47, then the same call succeeded at 03:22:49.

**Agent recovery:** immediate and correct — 6 seconds, one call, no retry storm.

**This is the 5th recorded occurrence** of the remote-onboarding half of [BUG-014] (sessions 36, 38, 43, and now 62). The error message is good; it names the tool and the parameter shape. The pattern persists because nothing prompts `use_file` *before* the first call. Cheap enough to keep observing rather than fix — but five sessions is the point at which "add a line to the remote-onboarding docs" (already proposed on [BUG-014]) should just ship.

### 2. Unloaded-font throw during the park-and-swap (1 failure, ~10 minutes lost)

```
Error running script: Error: Cannot set style successfully: unloaded font "PP Neue Montreal Regular".
Please call figma.loadFontAsync({ family: "PP Neue Montreal", style: "Regular" }) …
Figma Debug UUID: 14690e86-… (atomic: no changes were applied; safe to retry)
```

Script **#12** tried to retarget stale `support/*` text styles onto `ui/label` with a bare `setTextStyleIdAsync`, without parking either the nodes or the styles on a loadable face. This is [BUG-033] / [BUG-037] exactly: the setter demands the *style's* font be loaded, and the remote VM cannot load `PP Neue Montreal`.

**The stated fix is unactionable on remote** — `loadFontAsync({family: "PP Neue Montreal"})` is the one call that cannot succeed in that VM. The agent did not follow it. It asked the user instead (#79, `AskUserQuestion` about how to handle the 3 stale styles), got a decision, and executed the narrower #13 (delete the two unused ones) plus the full park-and-swap for the rest.

**Agent recovery:** correct, and a clean instance of [AGENT-029] — a stated fix that cannot work means the diagnosis is wrong, so change strategy rather than parameters.

**Fix needed:** the "unloaded font" path should detect that the family is absent from `listAvailableFontsAsync` and state the park-and-swap remedy instead of `loadFontAsync`. Tracked on [BUG-033](c) and [BUG-037]; this session adds `setTextStyleIdAsync`-inside-`run_script` as a call site those entries do not name.

## Concurrency Exposure

Session 62's 64-minute window **fully contains both session 60 (03:29:59–03:41:32Z) and session 61 (03:27:14–03:56:28Z)**, all three on the same Figma file. [BUG-047] established that concurrent remote sessions share `figma.currentPage`, so the overlap is worth pinning down rather than assuming.

Aligning the actual Figma activity:

| Session | Figma activity window | What it was doing |
|---|---|---|
| 61 | 03:27:14 – 03:36:42Z | Building the `Context Menu` page (mirror of `ContextMenu`) |
| 60 | 03:31:39 – 03:36:27Z | Wiring Accordion prototype reactions |
| 62 | **03:30:44Z**, then 03:42:44 – 04:04:31Z | 596-variable re-scope + 1 delete; then all text-style work |

Only **one** session-62 write lands inside another session's active write window: `run_script` #1 at 03:30:44Z, which set scopes on 596 variables and deleted `input/error-color`, while session 61 was mid-build. Every later write — the 8 text styles, all three park-and-swap passes, the 2 new checkbox tokens — begins at 03:42:44Z, a **6-minute gap** after the last Figma call from either concurrent session (03:36:42Z).

Assessed exposure, in order of how much it could have hurt:

- **The variable deletion is the only one with real potential for damage** — but it was verified orphaned first, against the repo's generated output (Bash #15: `stale in Figma: 1 input/error-color`; Bash #31 re-confirmed against live state), and no session-60/61 token references it.
- **Scope changes are picker-visibility only.** They do not alter values or bindings, so session 61's concurrent variable bindings could not have been corrupted by the re-scope.
- **The park-and-swap is the dangerous one and it missed the window entirely.** #18's PLAN covers the `Context Menu` page — the exact page session 61 had just built — and its park temporarily strips `fontFamily` bindings from shared text styles document-wide. Had it run 19 minutes earlier it would have overlapped session 61's writes on that page. It ran at 03:55:35Z, after session 61's last Figma call.
- **[BUG-047]'s specific failure mode is not exposed here**: that entry is about a parentless `write` landing on another session's `currentPage`. Session 62 created no nodes — its writes are variable-, style- and node-property-level, all explicitly targeted.

No interference is visible in the outcome: session 62's own verification passes (#19, #24) report `styleIntegrityIssues: []` and the expected single unstyled node, and the repo↔Figma checksums match on all three collections. The exposure was real but narrow, and mostly avoided by timing rather than by design.

## What Worked Well

1. **The park-and-swap recipe executed at scale, three times, with zero failures.** [BUG-037] argued that `edit`'s "abandon `textStyleId`" remedy is wrong and that walking the style onto a loadable face keeps it. Scripts #17 (Alert Dialog), #18 (six component pages) and #23 (chip/group-label corrections) each snapshot every affected style's bindings and metrics, park style **and** nodes on `Inter/Regular`, apply, then restore metrics → weight → size → **family last**. Final verification (#24) reported `unstyledCount: 1` (the Cover page's `Archer` wordmark, correctly excluded) and `styleIntegrityIssues: []`. This is the strongest confirmation of [BUG-037] to date and the first time the recipe covered a whole document rather than one component.

2. **Mapping text layers by owning component, not by layer name.** Nearly every text layer in the file is called `Label`, meaning five different type styles depending on owner. Script #23 resolves each instance via `getMainComponentAsync()` and checks the main component *and its parent set* name before deciding. A name-only match would have silently mis-styled every chip and group label. The agent derived the mapping from the repo's own SCSS (`grep -rn "type-style(" src/components/*/*.scss`) rather than guessing — code as the source of truth for design intent.

3. **A checksum gate on repo↔Figma parity.** Scripts #3 and #26 hash `id|name|scopes` per collection; Bash #44 and #120 compute the same hash from the repo's generated output and compare. `Color 432 6d790e43 / live 432 6d790e43 MATCH`. This turns "did the 596-variable write land correctly" into one comparison instead of a diff review, and it caught the state at two points in the session. Worth promoting into a first-class capability.

4. **`stdlib: false` on 28 of 28 scripts.** [TOOL-029] moved to `verified` in session 47; this session is the largest sample yet and the flag was used universally with zero oversized-script rejections and zero [BUG-023] parse-error bisects. Largest concern remains [TOOL-031] — the DJB2 hash helper is copy-pasted between #3 and #26, and the ~40-line park/snapshot/restore block appears three times across #17, #18 and #23.

5. **Three well-placed `AskUserQuestion` calls.** zIndex scoping (no Figma equivalent for z-index — scope to nothing, or leave unscoped?), font-weight acceptance, and disposal of the stale `support/*` styles. Each is a genuine judgment call with no correct default, asked before the write rather than after.

6. **Honest scope separation at commit time.** Calls #127–#134 temporarily strip the checkbox-label token additions, commit the token-scope work alone, restore, re-verify the gates, and commit the Checkbox work separately. Two clean commits from one session's interleaved work.

## Priority Improvements

### Tool Changes (ranked by call savings)

1. **`create_styles` / `update_styles` descriptions** — add `fontWeight` to the bindable `variables` list, add a worked example for a fully variable-bound text style authored on a loadable face, and fix `loadFontOrFail`'s stated fix to distinguish *family absent* from *face misspelled*. Saves ~5 calls/session on any custom-font file and retires a description that implies a capability gap the code does not have.

2. **`grep` negation** — `hasStyle: false` / `hasVariable: false`, or a general `negate: true`. Saves ~4 calls/session; every "what is still unbound" audit is currently a `run_script`.

3. **`update_variables` bulk-property form** — `{ scopes: [...], variableIds: [...] }` so a 596-variable scope change is a compact first-class call rather than a 48KB one. Zero call savings, but it moves the session's single largest mutation back behind scope validation.

4. **`get_design_system({ collectionsOnly: true })`** — or document the empty-`namePattern` idiom. Saves ~1 call.

5. **Document-scope override audit** — `get_instance_overrides` reads one instance for copying (`components.ts:245-252`). Scripts #20, #27 and #28 all ask "which instances across this document carry an override on field X, and is resetting it safe". Worth a scoped read: `nodeIds` or a page/document scope plus a field filter.

### Agent Skill Updates

1. **Re-search tool schemas when the task crosses domains.** Under deferred schemas, the up-front selection reflects only the first phase. Before writing a `run_script` for style, component, annotation or library work, spend one ToolSearch on that domain.

2. **Ask the wider diagnostic question first.** Four calls in this session are second traversals that a slightly broader first pass would have covered. When writing a document-walking script, return the superset — the traversal is the cost, not the fields.

3. **Prefer `create_styles`/`update_styles` over `run_script` for text-style CRUD** even on custom-font remote files — the tool implements the correct order and applies font loading, validation and duplicate detection the script path forfeits.
