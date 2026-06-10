# Figma Official MCP Server — Assessment & Figmagent Port Plan

Date: 2026-06-10
Method: live probing of the official Figma remote MCP server (headless, from a cloud
container with no Figma client running), plus a full read of Figma's published skills
corpus ([figma/mcp-server-guide](https://github.com/figma/mcp-server-guide)).
Scratch file used for probes: `https://www.figma.com/design/39H3zGBDrKOzYWvBo0kqFG`
(named `figmagent-mcp-assessment-scratch`, in drafts — safe to delete).

---

## 1. Executive summary

Figma's MCP server now has a real write path: **`use_figma`, an arbitrary-JavaScript
executor against the Plugin API that runs fully headless** — no desktop app, no plugin,
no websocket. It works today: from this cloud container I created a file, built
auto-layout frames with text, created and bound scoped variables, and took inline
screenshots, authenticated only by the user's Figma OAuth session.

Figma's correctness strategy is the opposite of ours. They ship a maximally expressive
low-level tool and push **all** correctness knowledge into ~5,000 lines of skill
documents the model must read and obey (17 "critical rules", a 20-item pre-flight
checklist, a 1,053-line gotchas file). The agent writes raw Plugin API code and is told
to validate its own work by calling `get_metadata`/`get_screenshot` and eyeballing the
result. That burns context and inference on exactly the things Figmagent encodes in
tool code: font loading, sizing order, two-pass FILL, auto-placement, variable scoping.

But the harness underneath `use_figma` is genuinely good engineering and validates the
"offload to compute" thesis in three places we should steal from:

1. **Atomic script execution** — an uncaught error rolls back *everything* the script
   did (verified empirically). No partial state, retry is always safe.
2. **Harness-extended Plugin API** — `node.query()` (CSS selectors), `node.set()`
   (batch props with `layoutMode` force-ordered before `width`/`height` — ordering
   hazards solved in the harness, not the prompt), `figma.createAutoLayout()`,
   `node.placeholder`, inline `await node.screenshot()`.
3. **Error messages that state the fix** — e.g. `Cannot use unloaded font "Roboto
   Bold". Please call figma.loadFontAsync({family:"Roboto",style:"Bold"}) and await
   the returned promise first.` — with script line numbers and a debug UUID.

**Recommendation:** keep Figmagent's deterministic, validated tool surface as the
agent-facing interface, and replace the websocket+plugin transport with a backend that
*compiles* each tool call into battle-tested Plugin API JS executed via `use_figma`.
Figma supplies the headless execution and atomicity; we supply the compiler, the
validation, and the structured feedback. Claude never writes Plugin API code and never
reads a gotchas file.

---

## 2. What Figma shipped

### Architecture

- Remote MCP server (`mcp.figma.com`), OAuth-authenticated, addressed by `fileKey`
  from the URL. Truly headless — no client needs to be open anywhere.
- `whoami` returns the user identity and plan/team keys; `create_new_file` creates
  design/FigJam/Slides files into drafts or a project.
- Works on Design, FigJam, and Slides files with per-editor node-type restrictions.

### Tool inventory (18 tools)

| Domain | Tools |
|---|---|
| Write | `use_figma` (JS executor, ≤50KB code), `create_new_file`, `upload_assets`, `generate_diagram` (Mermaid→FigJam), `generate_figma_design` (web-capture only) |
| Read | `get_design_context` (React+Tailwind code gen + screenshot), `get_metadata` (XML skeleton), `get_screenshot`, `get_variable_defs`, `get_figjam`, `download_assets` |
| Design system | `search_design_system` (text search over published libraries), `get_libraries` |
| Code Connect | `get_code_connect_map`, `add_code_connect_map`, `get_code_connect_suggestions`, `send_code_connect_mappings`, `get_context_for_code_connect` |
| Meta | `whoami` |

Everything that isn't covered by a dedicated tool — components, variants, variables,
styles, text editing, layout, cloning, reparenting — goes through `use_figma`.

### The skills corpus

`figma/mcp-server-guide` ships 9 skills. The load-bearing ones:

- **figma-use** (mandatory before any `use_figma` call): 439-line SKILL.md + 11
  reference docs (~4,700 lines total) including a 1,053-line gotchas file, the full
  Plugin API `.d.ts` to grep, and pattern docs for components/variables/text styles.
- **figma-generate-library**: design-system building workflow, with 9 **canned `.js`
  scripts** (`createComponentWithVariants.js`, `bindVariablesToComponent.js`,
  `validateCreation.js`, `rehydrateState.js`…) — their own tacit admission that
  model-written JS is unreliable, so they ship deterministic script templates.
- **figma-generate-design**: screen assembly from published components
  (`search_design_system` → import by key → build incrementally).

Their incremental workflow doctrine: ≤10 logical operations per call, build skeleton →
fill sections → validate each step with `get_metadata` (structure) and screenshots
(visual), placeholder shimmer (`node.placeholder`) for in-progress sections, return all
created/mutated IDs from every script.

---

## 3. Empirical probe results

All probes run headless from this container against the scratch file.

| Probe | Result |
|---|---|
| Create file via `create_new_file` | Works; returns fileKey + URL. |
| Build card (`createAutoLayout`, fonts, FILL sizing child) | Works; clean JSON return; `await node.screenshot()` attaches a PNG inline in the same tool response. |
| `node.query('TEXT').values([...])` | Works — compact projection, very token-efficient reads. |
| Unloaded-font error | Error message includes the exact corrective call, the script line number (`PLUGIN_1_SOURCE:6:2`), and a Figma debug UUID. |
| **Atomicity** | Verified: a rect created *before* the font error was rolled back. Caught (`try/catch`) errors do **not** roll back — rollback is per-script on uncaught error only. |
| `layoutSizingHorizontal='FILL'` on non-auto-layout child | Clear value-rejection error naming the structural requirement. |
| Variable create + scope + `setBoundVariableForPaint` | Works headlessly, including scoping (`FRAME_FILL`). |
| `query('FRAME[name=Test Card]')` (unquoted, space) | **Silently matches nothing** — no parse error, returned null downstream. Quoted form works. A real footgun. |
| `get_metadata` | Compact XML: id/type/name/x/y/w/h only. No layout props, no fills, no component refs. Response includes a nag to call `get_design_context`. |
| `get_variable_defs` | `{"color/bg/subtle":"#f5f5fa"}` — resolved values only. **No variable IDs, no scopes, no modes, no collections** — unusable for binding without a follow-up `use_figma` read. |
| `get_design_context` | Returns generated React+Tailwind with `data-node-id` attributes. Design-to-code biased; lossy as a scene-graph read (no component property definitions, no bound-variable structure). |

### Where their read surface is weak vs ours

`get_metadata` ≈ our `get(detail="structure")` but with no layout detail, no
token estimates, no output budget, no defs dedup. `get_variable_defs` is far below
`get_design_system` (no IDs/scopes/modes/collections). There is no equivalent of
`find` (criteria search with ancestor grouping), no `lint_design`, no comments or
annotations tooling. Their answer to all of these is "write a `use_figma` script,"
which works but costs the model reasoning + tokens every time, with zero guardrails.

---

## 4. Strategy comparison

| Dimension | Figma official MCP | Figmagent today |
|---|---|---|
| Transport | Remote, headless, OAuth | Local websocket relay + plugin running in an open Figma client |
| Write model | One JS executor; model writes Plugin API code | ~50 typed tools; Zod-validated params; plugin executes known-good code |
| Correctness | ~5,000 lines of skills the model must internalize; 20-item pre-flight checklist | Encoded in tool implementations (two-pass FILL sizing, font resolution chains, auto-coercion, empty-fill defaults, auto-placement) |
| Atomicity | Per-script rollback on uncaught error (verified) | None — partial failures leave partial state |
| Validation | Manual: agent calls `get_metadata`/`get_screenshot` and judges | Partially structural: lint_design (scope-aware variable matching, deltaE, autofix); no automatic post-write validation yet |
| Error feedback | Excellent messages with fix text + line numbers | Mixed; raw plugin errors in places |
| Reads | XML skeleton / generated code / resolved values; no budget controls | FSGN with defs dedup, token estimates, detail levels, 30K budget |
| Design system | `search_design_system` (text search, published libs), Code Connect | `get_design_system` (full structured styles+variables), lint, DTCG pipeline, no text search, no Code Connect |
| Batching | One script = arbitrary batch; ≤10-ops guidance | Dedicated batch tools, 6-way concurrency, per-node locks |
| Feedback loop | None visible | Session logging + analyze-session + improvement tracker |
| Long-tail coverage | Total (full Plugin API) | Bounded by tool surface; gaps require new tool releases + MCP restart |

The synthesis writes itself: **their backend, our interface.**

---

## 5. Recommendations

### 5.1 Port the transport: compile tools to `use_figma` (P0)

Add a second backend beside `connection.ts` — `remote.ts` — that implements the same
command interface by generating Plugin API JS and executing it via Figma's MCP
(`use_figma`, plus `create_new_file`/`upload_assets`/`get_screenshot` where they map
directly). Select with `FIGMA_TRANSPORT=remote|plugin` (keep the plugin path as a
fallback until parity is proven, then demote it).

Key properties of the compiled scripts:

- **They are templates, not model output.** Each tool (`create`, `apply`, `get`,
  `find`, `create_variables`, …) emits canned, parameterized JS that already encodes
  every gotcha our plugin code encodes today (font load→await→mutate, append-then-FILL,
  resize-before-sizing-modes, scope validation, mixed-symbol sanitization). Claude
  never sees Plugin API code; it keeps calling `apply` with a variables map.
- **Atomicity for free.** Our `create` of a 40-node tree becomes one script — if any
  node fails, the file is untouched. This removes a whole class of "partial tree"
  recovery work the agent does today.
- **Reads compile too.** `get` becomes a traversal script that serializes FSGN
  (or returns raw JSON for the server to format — keeps the YAML/defs/dedup/budget
  logic in TypeScript where it's testable). Adopt their perf idioms in the generated
  code: `figma.skipInvisibleInstanceChildren = true`, `findAllWithCriteria` over
  predicate `findAll`, subtree-scoped traversal.
- The MCP SDK we already use supports acting as an MCP *client*; the Figmagent server
  connects out to `mcp.figma.com` (OAuth) instead of listening for the plugin.

What this kills: the relay server, the plugin UI, channels, join/reconnect logic,
timeouts-as-disconnect heuristics, `bun socket`, "is the plugin running?" — the
entire INFRA-001 class in the improvement tracker.

Constraints to engineer around (spike items):

- **50KB code limit per call** → chunk large trees; we already chunk for UI-freeze
  reasons, same seams apply.
- **Page context resets per call; one `setCurrentPageAsync` per script** → our
  `scope: "DOCUMENT"` find must fan out one call per page (their own doctrine);
  the server can do this fan-out internally and merge results — invisible to the agent.
- **`getPluginData`/`setPluginData` unsupported; `figma.notify` throws** — we use
  neither in command paths (verify `setcharacters.js` has no plugin-data dependency).
- **Rate limits unknown** — the server exposes a `rate-limits-access.md` resource;
  measure during the spike, especially for our 6-way parallel patterns.
- **Auth lifecycle** — OAuth token refresh for long headless sessions; document setup.
- Confirm whether the `use_figma` VM accepts object spread (the desktop plugin VM does
  not — our Biome rules assume that); if it does, generated code can be simpler, but
  keeping the conservative style costs nothing.

### 5.2 Move validation into the tool response (P0 — the differentiator)

Figma tells the model: *after every write, call `get_metadata`, compare against your
intent, then screenshot and look for clipped text and overlaps.* That is two extra
round trips plus visual reasoning per step. We can return the verdict **in the write
response itself**, computed in the same script execution:

- **Structural assertions, post-write, same script:** after mutations, the generated
  script re-reads affected nodes and reports: zero/near-zero-width text nodes,
  100px-balloon frames (auto-layout + defaulted height), FILL requested but not
  applied, text truncation/overflow, children overlapping in a non-auto-layout parent,
  fonts that fell back. Emit as a `warnings` array with node IDs and suggested fixes —
  same voice as Figma's error messages (state the fix, not just the fault).
- **Inline mini-lint:** when `apply`/`create` set raw values for which an
  exact-match scoped variable exists, say so in the response
  (`fill #F5F5FA matches variable color/bg/subtle (v1) — pass autoFix or bind via
  variables`). The full `lint_design` stays for sweeps; this catches drift at write
  time for free.
- **Optional inline screenshot:** `screenshot: true` on `create`/`apply`, riding on
  `await node.screenshot()`. Default off; one flag replaces an
  `export_node_as_image` round trip when visual confirmation matters.

### 5.3 Adopt their best harness ideas (P1)

- **Selector targeting:** accept a CSS-like `selector` in `find`/`apply` alongside
  current criteria (their `query` grammar: `FRAME[name^=Card] TEXT`, `:nth-child`,
  `#id`). Compile to their engine on the remote backend. Require/auto-add quoting so
  the silent-empty-match footgun we found can't happen — reject unparseable selectors
  loudly.
- **Error message audit:** every error our tools return should name the fix. We have
  the table of failure modes (improvement tracker, gotchas); convert the top ones into
  prescriptive error strings.
- **`run_figma_js` escape hatch:** one new tool that forwards raw JS (remote backend
  only), for the long tail our 50 tools don't cover — instead of the agent stalling
  until we ship a new tool + MCP restart. Guardrails: read-only flag by default,
  post-run structural assertions from 5.2, all of it session-logged so escape-hatch
  usage feeds the tool roadmap (every recurring script = a missing tool).
- **Published-library search:** `search_design_system`-equivalent (or proxy theirs on
  the remote backend). Today we can import by key but can't *discover* by text query
  across libraries; their tool fills a real gap in our library story.

### 5.4 What NOT to copy

- **The skills-corpus approach.** 4,700 lines of mandatory reading is the cost of
  shipping one generic tool. Our CLAUDE.md should shrink as validation moves into
  responses — knowledge belongs in tool descriptions and tool feedback, in that order,
  and in prose only as a last resort.
- **React+Tailwind as the canonical read.** FSGN with defs dedup and budgets is
  strictly better for design *operations* (code gen is a different product).
- **Self-validation doctrine.** "Screenshot it and look carefully" spends vision
  tokens on what structural assertions catch deterministically. Screenshots remain the
  final visual check, not the per-step verifier.
- **`get_variable_defs`'s lossy shape.** Resolved values without IDs/scopes/modes
  can't drive binding. `get_design_system` keeps its shape.

### 5.5 Suggested sequencing

1. **Spike (1–2 days):** `remote.ts` implementing `get`, `create`, `apply` over
   `use_figma` against a scratch file. Measure: latency per call, rate limits,
   max practical script size, object-spread support, OAuth token lifetime.
2. **Phase 1 — reads:** `get`, `find` (with per-page fan-out), `get_design_system`,
   `export_node_as_image` (via `get_screenshot`/`download_assets`).
3. **Phase 2 — writes:** `create`, `apply`, text tools, variable/style CRUD,
   component tools. Atomic-by-default; port the concurrency limits to a client-side
   queue sized to observed rate limits.
4. **Phase 3 — validation layer (5.2)** + `run_figma_js` + selector support.
5. **Phase 4:** session-log A/B against plugin transport (calls/task, errors/task,
   wall time); then make remote the default and demote relay+plugin to fallback.

---

## 6. Phase 0 spike results (2026-06-10, same session)

The spike from §5.5 was executed immediately. **Verdict: the port is a transport swap
plus a bounded compatibility layer — our existing plugin command modules run inside
`use_figma` largely unmodified.**

### Method

Bundled slices of `src/figma_plugin/src/commands/` with
`bun build --minify --format=iife`, exposed handlers on `globalThis.__figmagent`,
prepended the bundle to a `use_figma` call, and invoked the real handlers against the
scratch file.

### What worked

- **`getDocumentInfo` + `getNodeTree` (FSGN traversal, structure detail) ran
  end-to-end remotely, unmodified — 45ms in-VM** for a 5-node traversal.
- **Bundle sizes are a non-issue.** Per-domain tree-shaken bundles, minified:
  document 13.7KB, create 5.8KB, apply 8.4KB, modify 10.6KB, text 7.0KB,
  components 14.3KB, find 5.4KB, scan 11.5KB, styles 15.8KB, lint 10.6KB.
  Every domain fits a 50KB call with room for the invocation + params. The
  `getNodeTree` slice alone is 6.7KB.
- **The remote VM is *more* permissive than the desktop plugin sandbox.** Object
  spread, optional chaining, nullish coalescing, private class fields all parse and
  run (the desktop VM rejects spread). `eval` works. `globalThis` is writable within
  a script. Our conservative `Object.assign` style runs as-is; the Biome restrictions
  could even be relaxed for remote-only code paths.
- **No UI shim needed.** `figma.ui.postMessage` is a safe no-op — `sendProgressUpdate`
  calls don't crash. `console.log` doesn't throw (output is just discarded).
  `figma.clientStorage`, `getSharedPluginData`, `importComponentByKeyAsync`,
  `exportAsync` (image formats), `createImageAsync`, `findAllWithCriteria` all present.

### Incompatibilities found (both bounded)

1. **`exportAsync({format: "JSON_REST_V1"})` is unsupported** ("not supported in this
   context"). Affects exactly three legacy reads: `getNodeInfo`, `getNodesInfo`,
   `readMyDesign` (document.js:58/72/95). The FSGN path (`getNodeTree`) reads live
   properties and is unaffected. Fix: reimplement the three on live-property
   serialization (or retire them in favor of `get`).
2. **Strict property guard on node objects.** Reading a property a node type doesn't
   have *sometimes throws* `TypeError: no such property 'X' on TEXT node` instead of
   returning `undefined` — and it's inconsistent per property (`layoutMode` on TEXT →
   `undefined`, but `clipsContent`, `cornerRadius`, `itemSpacing`, `paddingLeft`,
   `mainComponent`, `defaultVariant` on TEXT → throw; `characters`, `textStyleId` on
   FRAME → throw). The same guard applies to the `figma` global
   (`figma.documentAccess` throws). Our serializers (`getNodeTree`,
   `filterFigmaNode`, scan/find/lint walkers) duck-type heavily, so this is the main
   compat cost. Verified mitigations:
   - `'prop' in node` returns `false` safely → mechanical codemod works and is
     desktop-safe;
   - `try/catch` around reads works (the throw is catchable);
   - a ~6-line forwarding Proxy (`lax(node)`) fully restores desktop semantics —
     missing props → `undefined`, real props and bound methods pass through.

   Because the throw set is unpredictable per property, the right fix is mechanical:
   a `prop(node, name)` helper (or lax-wrap) at serializer boundaries, not hand-picked
   guards. Write paths are mostly safe — they set known properties on nodes whose
   types they just created.

### Revised effort estimate

Phase 1 (reads) is mostly the compat helper + the JSON_REST_V1 replacement. Phase 2
(writes) should run near-verbatim. The bundling pipeline already exists
(`bun build`); the remote transport needs: per-domain bundle cache → script assembly
(bundle + handler invocation with JSON-encoded params) → `use_figma` call via MCP
client → result passthrough to the existing response formatters. The open items
remain OAuth lifecycle and rate limits (not measurable from a single session; the
server publishes a `rate-limits-access.md` resource worth reading during
implementation).

---

## Appendix: probe log

1. `whoami` → identity + 2 team plan keys. Headless auth confirmed.
2. `create_new_file` → fileKey `39H3zGBDrKOzYWvBo0kqFG` in drafts.
3. Build script: `createAutoLayout('VERTICAL', {...})`, two text nodes (Inter
   Semi Bold/Regular), child `FILL` after append, `query('TEXT').values()`,
   inline `screenshot()` → JSON `{createdNodeIds:[1:2,1:3,1:4], queryResult:[...]}`
   + PNG attached in response.
4. Error script: created rect `AtomicProbe`, then set unloaded `Roboto Bold` →
   error with corrective call, line numbers, debug UUID.
5. Follow-up read: `AtomicProbe` absent → **rollback confirmed**. `try/catch`-ed
   sizing error did not roll back its rect → rollback only on uncaught error.
6. `query('FRAME[name=Test Card]')` (unquoted) → silent empty match → null deref.
   Quoted selector matched. Variable create+scope+bind succeeded headlessly.
7. `get_metadata` → XML skeleton (geometry only). `get_variable_defs` → resolved
   values only. `get_design_context` → React+Tailwind with `data-node-id`s.
8. VM capability probe → modern syntax all supported; `figma.ui.postMessage` no-op;
   unknown props on `figma` global and (inconsistently) on nodes **throw** instead
   of returning `undefined`; `in` operator and try/catch both safe.
9. Bundled `getDocumentInfo`+`getNodeInfo` (2.6KB min) → `JSON_REST_V1` export
   rejected. Bundled `getNodeTree` full-detail → strict-guard throw on
   `clipsContent` of TEXT. Structure-detail rerun → clean pass, 45ms in-VM.
10. Per-domain bundle size sweep → all 10 command domains 5–16KB minified.
