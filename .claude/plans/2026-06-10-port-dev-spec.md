# Dev Spec: Official-MCP Port — Phases 1–6

Date: 2026-06-10
Status: Spec — validated against the codebase and live probes (see §Validation log at end).
Parent plan: `.claude/plans/2026-06-10-official-mcp-port.md` (decisions D1–D8, validation §9).
Assessment: `.claude/analysis/figma-official-mcp-assessment.md` (probe + spike evidence).

Conventions used below: each task lists Files, Depends on, Parallelizable, Details,
and Tests — same format as `2026-03-13-find-tool.md`. "Remote" = Figma's official MCP
(`use_figma` executor). "Plugin" = existing websocket relay + Figma plugin path.

Cross-phase invariants:

- **Wire protocol command names never change.** Renames (Phase 3) happen at the MCP
  tool layer only; `src/figma_plugin/src/commands/*` handler names and command strings
  stay stable so plugin and remote backends share one implementation with no version
  skew.
- **Shared command modules stay lowest-common-denominator JS** (no object spread, no
  `?.`/`??`) — they must run in both the desktop plugin VM and the remote VM (D1).
- **Plugin path stays green**: `bun test` and `bun run build:plugin` must pass after
  every phase.

---

## Phase 1 — Transport abstraction + remote reads

Goal: `FIGMA_TRANSPORT=remote` serves every read tool against a Figma file with no
relay, no plugin, no open Figma client. Plugin path untouched.

- [x] **Task 1.1: Transport interface + plugin refactor**
  - Files: `src/figmagent_mcp/transport.ts` (new), `src/figmagent_mcp/connection.ts`
    (edit), `src/figmagent_mcp/server.ts` (edit)
  - Depends on: none
  - Parallelizable: yes (with 1.2, 1.4)
  - Details:
    - `transport.ts` exports:
      ```ts
      interface FigmaTransport {
        name: "plugin" | "remote";
        sendCommand(command: FigmaCommand, params: unknown, timeoutMs?: number): Promise<unknown>;
      }
      function getTransport(): FigmaTransport;   // selected once at startup
      ```
    - Selection: `FIGMA_TRANSPORT` env — `plugin` (default through Phase 5), `remote`,
      or `auto` (remote if cached OAuth token exists, else plugin; becomes default in
      Phase 6).
    - `connection.ts`: existing `sendCommandToFigma` body becomes the
      `PluginTransport` implementation. **Keep `sendCommandToFigma` exported from
      `connection.ts` with the same signature**, delegating to
      `getTransport().sendCommand(...)` — all 14 `tools/*.ts` files keep their
      imports unchanged. `connectToFigma()` call in `server.ts` becomes conditional
      on plugin transport.
    - Server-side-only tools (`prepare_figma_variables`, `export_session`, comments
      via `figma_rest_api.ts`) never touch the transport — unaffected.
  - Tests: existing suite passes with `FIGMA_TRANSPORT=plugin` (default); unit test
    that `getTransport` honors the env var.

- [x] **Task 1.2: Remote MCP client + OAuth**
  - Files: `src/figmagent_mcp/remote/client.ts` (new),
    `src/figmagent_mcp/remote/auth.ts` (new)
  - Depends on: none
  - Parallelizable: yes (with 1.1, 1.4)
  - Details:
    - `@modelcontextprotocol/sdk` client side (verified present in v1.27.1):
      `Client` from `client/index.js`, `StreamableHTTPClientTransport` from
      `client/streamableHttp.js`, `OAuthClientProvider` interface from
      `client/auth.js`.
    - Endpoint `https://mcp.figma.com/mcp`, overridable via `FIGMA_MCP_URL`.
    - `auth.ts` implements `OAuthClientProvider`: dynamic client registration,
      tokens + client info persisted to `~/.figmagent/auth.json` (0600 perms,
      same dir as session logs), refresh handled by the SDK. First-run interactive
      flow: spin a loopback HTTP server on an ephemeral port for the redirect,
      print the authorization URL to **stderr** (stdout is MCP protocol), open
      browser if possible. Headless fallback: print URL + wait.
    - On any auth failure with `FIGMA_TRANSPORT=auto`: log and fall back to plugin
      transport (D1).
    - Client wraps `callTool("use_figma", { fileKey, code, description })`; parse the
      text content as JSON when the script returned `JSON.stringify(...)`; surface
      `isError` results as thrown errors carrying Figma's message verbatim (their
      messages already state fixes — never truncate them).
  - Tests: unit-test token persistence round-trip with a mock provider; manual
    first-run auth flow (documented in README); `whoami` smoke call.

- [x] **Task 1.3: File context (replaces channels on remote)**
  - Files: `src/figmagent_mcp/remote/filecontext.ts` (new),
    `src/figmagent_mcp/tools/document.ts` (edit — `join_channel` tool)
  - Depends on: 1.1
  - Parallelizable: yes (with 1.2, 1.4)
  - Details:
    - Remote has no channels; it has fileKeys. Current fileKey resolution order:
      (1) value set by the `join_channel` tool — on remote transport this tool
      accepts a Figma URL or bare fileKey and stores it (tool description updated to
      cover both transports; rename to `use_file` happens in Phase 3, not here);
      (2) `FIGMA_FILE_KEY` env.
    - No fileKey set → error that states the fix: "No Figma file selected. Pass a
      file URL to join_channel (e.g. https://www.figma.com/design/<fileKey>/...) or
      set FIGMA_FILE_KEY."
    - `create_new_file` passthrough is **out of scope until Phase 2** (write).
  - Tests: resolution order unit tests; error message snapshot.

- [x] **Task 1.4: Command registry + remote entry shims + bundle cache**
  - Files: `src/figma_plugin/src/registry.js` (new), `src/figma_plugin/src/main.js`
    (edit), `src/figma_plugin/src/remote_entries/<domain>.js` (new, ~11 files),
    `src/figmagent_mcp/remote/bundles.ts` (new)
  - Depends on: none
  - Parallelizable: yes (with 1.1, 1.2)
  - Details:
    - **Single source of truth**: `registry.js` exports
      `COMMANDS = { get_document_info: { domain: "document", handler: getDocumentInfo }, ... }`
      built from the same imports `main.js` uses today. `main.js`'s dispatcher
      switch is replaced by a registry lookup (concurrency classification
      `READ_OPS`/`GLOBAL_OPS` moves into registry entries:
      `{ domain, handler, lock: "read" | "global" | "node" }`).
    - **Arg-shape normalization** (validation finding): several dispatcher cases
      pass positional args today (`getNodeInfo(params.nodeId)`,
      `getNodesInfo(params.nodeIds)`, …). The registry contract is
      `handler(params)` — wrap positional-arg handlers in the registry entry
      (`handler: (p) => getNodeInfo(p.nodeId)`), including the params-presence
      validation currently inlined in the switch. The remote executor depends on
      this uniform shape.
    - Per-domain entry shim, e.g. `remote_entries/document.js`:
      ```js
      import { getDocumentInfo, getSelection, getReactions, exportNodeAsImage, getNodeTree } from "../commands/document.js";
      globalThis.__figmagent = Object.assign(globalThis.__figmagent || {}, {
        getDocumentInfo, getSelection, getReactions, exportNodeAsImage, getNodeTree });
      ```
    - `bundles.ts`: runtime bundling with `Bun.build({ entrypoints, target:
      "browser", format: "iife", minify: true })` reading output via
      `outputs[0].text()` — no outdir, no build step (validated: Bun 1.3.x runtime
      API + in-memory text output work; per-domain minified sizes 5–16KB, spike §6).
      In-memory cache keyed by domain; invalidated by source mtime in dev
      (`fs.statSync` over the domain's source files).
  - Tests: registry covers every command `main.js` previously dispatched
    (assert key-set equality in a unit test); bundle for each domain builds and is
    < 40KB; dispatcher behavior unchanged on plugin path (`bun run build:plugin` +
    existing tests).

- [x] **Task 1.5: Remote executor (script assembly + per-file FIFO queue)**
  - Files: `src/figmagent_mcp/remote/executor.ts` (new),
    `src/figmagent_mcp/remote/transport.ts` (new — implements `FigmaTransport`)
  - Depends on: 1.2, 1.3, 1.4
  - Parallelizable: no
  - Details:
    - Script assembly for command `c` with params `p`:
      ```
      <domain bundle (IIFE)>
      const __params = <JSON.stringify(p)>;
      const __r = await globalThis.__figmagent.<handler>(__params);
      return JSON.stringify(__r);
      ```
      Top-level `await`/`return` are supported by `use_figma` (verified in probes).
    - 50KB guard: if assembled code > 49,000 chars, throw a descriptive error
      naming the param that dominates (chunking lands in Phase 2.3).
    - **Per-file FIFO queue** (plan §9.1: server serializes per file; parallelism
      buys nothing): one in-flight `use_figma` call per fileKey; queue depth logged.
      Replaces the plugin's 6-way concurrency on this transport.
    - `sendProgressUpdate` is a no-op remotely (verified: `figma.ui.postMessage`
      is safe). Timeout = the MCP call's own lifetime; map MCP timeout errors to
      the existing "Request to Figma timed out" shape.
    - Atomicity surface: a thrown script error means **nothing was applied**
      (verified rollback). Wrap Figma's error verbatim and append
      `"(atomic: no changes were applied; safe to retry)"` for write commands.
    - Session logger (`session-logger.ts`): add `transport: "plugin" | "remote"`
      field to every entry — feeds the Phase 6 A/B.
  - Tests: assembly snapshot per domain; queue serialization unit test (two
    concurrent commands, same fileKey → sequential); 50KB guard test.

- [x] **Task 1.6: `prop()` strict-guard compat in serializers**
  - Files: `src/figma_plugin/src/helpers.js` (edit), `src/figma_plugin/src/commands/`
    `document.js`, `scan.js`, `find.js`, `lint.js`, `styles.js` (edit)
  - Depends on: none
  - Parallelizable: yes (with everything)
  - Details:
    - Add to `helpers.js`: `export function prop(node, name) { return name in node ? node[name] : undefined; }`
      (`in` verified safe on both VMs, spike §6.2).
    - Mechanical codemod at **serializer/read boundaries only** (write paths set
      known-valid properties and are exempt): every `node.someOptionalProp` read in
      `getNodeTree`, `filterFigmaNode`, scan/find walkers, lint property collectors,
      and style readers where the property may not exist on the node type →
      `prop(node, "someOptionalProp")`. The throw set is inconsistent per property
      (spike §6.2), so do not hand-pick — convert all duck-typed reads in these
      paths.
  - Tests: plugin-path tests still green (the helper is a behavioral no-op on
    desktop); remote smoke: `getNodeTree` at `detail: "full"` on a TEXT-bearing tree
    no longer throws (this exact case failed in the spike).

- [x] **Task 1.7: Wire read commands over remote + parity harness**
  - Files: `src/figmagent_mcp/remote/transport.ts` (edit),
    `scripts/parity-check.ts` (new)
  - Depends on: 1.5, 1.6
  - Parallelizable: no
  - Details:
    - Commands in scope: `get_document_info`, `get_node_tree` (`get`), `find`,
      `get_design_system`, `get_styles`, `get_local_variables`,
      `get_local_components`, `get_annotations`, `get_reactions`,
      `scan_text_nodes`, `scan_nodes_by_types`, `lint_design` (read mode),
      `export_node_as_image`, library reads, `get_selection` (returns empty with a
      note on remote — headless has no selection).
    - `find`/`lint_design` with `scope: "DOCUMENT"`: the **handler** loops
      `figma.root.children` with `await page.loadAsync()` inside one script
      (validated plan §9.7) — implement in the shared command modules guarded by
      `typeof page.loadAsync === "function"` so desktop (dynamic-page access
      already declared in manifest) takes the same path.
    - `export_node_as_image`: keep `exportAsync` in-script; encode with
      `figma.base64Encode` (verify availability remotely in first smoke — fallback:
      manual base64 in helpers).
    - `scripts/parity-check.ts`: runs a read suite against the same file on both
      transports and diffs normalized outputs (ignore: timing fields, ordering
      where unspecified). This is the Phase 1 acceptance gate and stays for
      Phase 2.
  - Tests: parity check passes on the scratch file for every in-scope command;
    latency per command logged (expect ~4–7s/call overhead, §9.3 — record actuals).

**Phase 1 acceptance:** parity harness green for all reads; plugin suite green;
first-run OAuth documented; per-command remote latency recorded in the session log.

> **Execution log (2026-06-11):** Tasks 1.1–1.7 landed. Remote side
> live-validated against the scratch file (`39H3zGBDrKOzYWvBo0kqFG`) by running
> the executor-assembled scripts through `use_figma`: get_document_info,
> get_node_tree (`detail:"full"` — the pre-`prop()` failure case), get_selection,
> find (`scope:"DOCUMENT"`, multi-page loadAsync), get_design_system,
> lint_design (page scope), export_node_as_image (PNG 8,164 base64 chars) — all
> 7 pass, zero strict-property errors. Script sizes 6.0–15.8KB, all 11 domain
> bundles < 40KB. The dual-transport `parity-check.ts` run (plugin side needs a
> live desktop plugin + relay) remains to be executed on a dev machine —
> remote-side outputs were verified structurally instead. First-run OAuth flow
> implemented + documented in README but not yet exercised end-to-end against
> mcp.figma.com (headless container; carry as a checklist item alongside the
> §9.2 token-lifetime test).

---

## Phase 2 — Remote writes

Goal: every write tool works atomically over remote; legacy JSON_REST_V1 reads retired.

- [ ] **Task 2.1: Wire write commands**
  - Files: `src/figmagent_mcp/remote/transport.ts` (edit)
  - Depends on: Phase 1
  - Parallelizable: partially (command groups independent)
  - Details: enable `create`, `apply`, `set_text_content`,
    `set_multiple_text_contents`, modify group (`move_node`, `resize_node`,
    `rename_node`, `delete_node`, `delete_multiple_nodes`, `reorder_children`,
    `clone_node`, `clone_and_modify`), components group, variables/styles CRUD,
    annotation writes, `set_focus`/`set_selections` (no-op + note on remote),
    connector tools (FigJam-gated as today). Spike verdict: these run
    near-verbatim; the work is enabling + testing, not porting.
    `create_new_file` proxies the official tool and sets file context (1.3).
  - Tests: per-group smoke on scratch file; atomicity test — `create` a tree with a
    deliberately invalid trailing node, assert zero nodes created and error message
    carries Figma's fix text + our atomic-retry suffix.

- [ ] **Task 2.2: Retire JSON_REST_V1 legacy reads**
  - Files: `src/figmagent_mcp/tools/document.ts` (edit),
    `src/figma_plugin/src/commands/document.js` (edit), `registry.js` (edit)
  - Depends on: 1.4
  - Parallelizable: yes
  - Details: `get_node_info`, `get_nodes_info`, `read_my_design` depend on
    `exportAsync({format: "JSON_REST_V1"})`, unsupported remotely (spike §6.1) and
    fully subsumed by `get`. Remove their MCP registrations and plugin handlers;
    tool descriptions for `get` already cover the use cases. (Their absence from
    CLAUDE.md's recommended flows means no skill updates needed before Phase 5.)
  - Tests: registry key-set test updated; grep for dangling references.

- [ ] **Task 2.3: >50KB chunking for large creates**
  - Files: `src/figmagent_mcp/remote/executor.ts` (edit)
  - Depends on: 2.1
  - Parallelizable: no
  - Details: params dominate script size (bundles ≤16KB). When `create` payload
    exceeds the guard: split `nodes[]` arrays across sequential scripts; for a
    single oversized `node` tree, split at depth-1 children — script N creates the
    root + first slice and returns the root ID, scripts N+1… create remaining
    slices with `parentId` = root. Document the atomicity caveat in the response
    (`chunked: true, chunks: N` — rollback is per-chunk, not whole-call) so the
    agent knows a mid-chunk failure leaves a partial tree with the root ID to
    clean up.
  - Tests: synthetic 80KB tree creates successfully; chunk-boundary failure leaves
    documented state.

- [ ] **Task 2.4: Representative-build A/B battery (acceptance gate)**
  - Files: `scripts/parity-check.ts` (extend)
  - Depends on: 2.1–2.3
  - Parallelizable: no
  - Details: scripted battery on both transports: 8-variant component set
    (`create` ×8 via `nodes[]` → `combine_as_variants` → `component_properties` →
    `apply` variable bindings → `lint_design`). Compare: resulting node counts,
    lint issue counts, total tool calls, wall time per transport.
  - Tests: the battery is the test. Record results in the session log for Phase 6.

**Phase 2 acceptance:** full suite + parity harness green on both transports;
battery completes remotely with ≥ equal correctness (lint parity) — call count and
wall time recorded, not gated (remote wins on calls, plugin on per-call latency).

---

## Phase 3 — Surface reshape (head/tail split + renames)

Goal: core tool count ≤15; names/call shapes mirror Claude Code primitives (D3).
Wire protocol unchanged.

- [ ] **Task 3.1: Session-log frequency analysis → final disposition table**
  - Files: analysis only (`scripts/extract-sessions.ts` exists); output table into
    this spec
  - Depends on: none (run against existing `~/.figmagent/sessions/` history)
  - Parallelizable: yes
  - Details: confirm/adjust the provisional disposition below with real call
    frequencies. Rules: most-sessions tools stay core; sub-monthly tools demote to
    stdlib (Phase 4) or retire.
  - **Provisional disposition (subject to 3.1 data):**

    | Disposition | Tools |
    |---|---|
    | Core, renamed | `get`→`read` · `find`→`grep` · `apply`→`edit` · `create`→`write` · `lint_design`→`lint` · `export_node_as_image`→`screenshot` · `join_channel`→`use_file` |
    | Core, kept | `get_design_system` · `get_document_info` (absorbed into `read` with no nodeId → document overview; drop standalone) |
    | **Folded into `edit`** (ops on existing nodes) | `move_node` (x/y) · `resize_node` · `rename_node` · `delete_node` · `delete_multiple_nodes` · `reorder_children` · `set_text_content` · `set_multiple_text_contents` (as `characters` op, reusing setcharacters.js) |
    | **Folded into `write`** | `clone_node` / `clone_and_modify` (as `fromNodeId` source — also the documented reparent recipe) |
    | Domain tier, kept | `create_variables` · `update_variables` · `create_styles` · `update_styles` · `prepare_figma_variables` · `component_properties` · `combine_as_variants` · `import_library_components` · `get_component_variants` · `search_library_components` · comments (3) · `export_session` |
    | Demote to stdlib (Phase 4) | `get_selection` · `set_focus` · `set_selections` · connector tools (2) · `get_instance_overrides` / `set_instance_overrides` · `get_reactions` · `set_annotation` / `set_multiple_annotations` / `get_annotations` (grep covers search; rare writes via stdlib) · `import_library_component` (singular) · `get_library_components` / `get_library_variables` / `get_local_components` |
    | Retire | `scan_text_nodes` · `scan_nodes_by_types` (grep covers) · `get_node_info` / `get_nodes_info` / `read_my_design` (gone in 2.2) · `get_styles` / `get_local_variables` (get_design_system covers) |

    Net: 9 core + ~13 domain ≈ **22 first-class**, trending to ~15 as 3.1 data
    confirms demotions. (Plan target ≤15 core is met; domain tier is additional by
    design.)
  - Tests: n/a (analysis).

- [ ] **Task 3.2: Implement folds (`edit` ops, `write` clone source)**
  - Files: `src/figmagent_mcp/tools/apply.ts`, `create.ts`, `text.ts`, `modify.ts`
    (edit/delete); `src/figma_plugin/src/commands/apply.js`, `create.js` (edit)
  - Depends on: 3.1
  - Parallelizable: yes (with 3.3)
  - Details: `edit` node-op gains `x`/`y`, `name`, `delete: true`, `index`
    (reorder), `characters` (routes through `setcharacters.js` for mixed-font
    safety; instance text path format `I<instance>;<textNode>` unchanged).
    Plugin side: `apply.js` dispatches these to the existing modify/text handlers —
    **no logic moves**, only the entry point. `write` gains `fromNodeId` mapped to
    `cloneAndModify` (with `parentId` = reparent recipe, now first-class).
    Execution-order doc in tool description updated (component ops → layout →
    rename/move/reorder → values → fonts → characters → variables → styles →
    delete last).
  - Tests: each folded op via `edit`/`write` on both transports; old tools removed
    from registry key-set test.

- [ ] **Task 3.3: Renames + param alignment**
  - Files: all `src/figmagent_mcp/tools/*.ts`; `src/figmagent_mcp/prompts/*`;
    `CLAUDE.md`; `.claude/agents/figma-discovery.md`; `.claude/skills/` (figma
    skills that name tools); `README.md`
  - Depends on: 3.2
  - Parallelizable: no (atomic rename pass)
  - Details:
    - MCP-layer renames per 3.1 table. Param alignment: `grep`'s `text`/`name`
      stay but description leads with "regex pattern" (matching Grep's `pattern`
      vocabulary); `read` keeps `detail`/`depth` (our offset/limit analog).
    - **Naming-collision decision (plan §9.6)**: keep the bare names
      `read`/`grep`/`edit`/`write` — MCP namespacing disambiguates mechanically;
      every description's first sentence starts "…a Figma node/subtree" to steer
      the agent. Revisit only if Phase 6 logs show built-in/MCP confusion.
    - One atomic commit; grep the whole repo (including `.claude/`) for old names.
  - Tests: full suite; `bun run check`; repo-wide grep for stale tool names is
    clean (except wire-protocol strings and historical docs under
    `.claude/analysis/`, `.claude/plans/`, `.claude/transcripts/`).

**Phase 3 acceptance:** ≤15 core tools registered + domain tier; all renames atomic;
both transports green; CLAUDE.md/skills/agents reference only new names.

---

## Phase 4 — Validation layer + `run_script` + error audit

Goal: write responses carry the verdict (D5); escape hatch with stdlib (D4); errors
state fixes.

- [ ] **Task 4.1: Post-write structural assertions**
  - Files: `src/figma_plugin/src/assertions.js` (new), `commands/create.js`,
    `apply.js` (edit), `src/figmagent_mcp/utils.ts` (edit — warnings formatting)
  - Depends on: Phase 3 (final response shapes)
  - Parallelizable: yes (with 4.4)
  - Details:
    - `assertions.js` exports `checkNodes(nodeIds) → warnings[]`, run at the end of
      `create`/`apply` handlers **in the same execution** (same script remotely —
      zero extra round trips; same command invocation on plugin).
    - Checks (each = the known failure class it kills, sourced from CLAUDE.md
      patterns + improvement tracker): zero/near-zero-width TEXT
      (width < 2px); 100px-balloon (auto-layout frame, defaulted height exactly
      100, HUG not set); FILL-requested-but-not-applied (op asked for FILL sizing,
      node reports FIXED — parent lacked auto-layout); font fallback occurred
      (resolved family ≠ requested); overlapping siblings in a non-auto-layout
      parent (AABB check, only when the op created/moved those siblings).
    - Warning shape: `{ nodeId, check, message }` where message states the fix in
      Figma's voice ("Set layoutSizingVertical: 'HUG' on 12:7 or give it an
      explicit height — it ballooned to the 100px default.").
    - Response: `warnings` block appended by `utils.ts` formatter; empty array
      omitted.
  - Tests: one fixture per check on the plugin path (deterministic); remote smoke
    for the same fixtures.

- [ ] **Task 4.2: Inline mini-lint at write time**
  - Files: `src/figma_plugin/src/commands/lint.js` (export matcher),
    `create.js`/`apply.js` (edit)
  - Depends on: 4.1
  - Parallelizable: no (same files as 4.1)
  - Details: extract lint.js's single-value matcher
    (`matchVariable(value, property, nodeContext) → { severity, variable }`) and
    run it over **only the raw values this op just set** (fills, cornerRadius,
    spacing, fontSize…). `exact_match` hits append to `warnings`:
    `"fill #F5F5FA matches variable color/bg/subtle — pass variables: { fill: 'v1' } to bind"`.
    Variables list fetched once per command invocation, skipped when the op
    already binds that field. Full `lint` is unchanged.
  - Tests: write a raw value that exactly matches a seeded variable → warning
    present; bound write → no warning.

- [ ] **Task 4.3: Boundary validation (Edit semantics)**
  - Files: `src/figmagent_mcp/tools/apply.ts` (Zod refinements), `apply.js` (edit)
  - Depends on: Phase 3
  - Parallelizable: yes
  - Details: reject-or-warn **before** mutating when the request can't take
    effect: text props on non-TEXT, `clipsContent` on non-frame, FILL sizing under
    a non-auto-layout parent (error names the parent and the fix), unknown
    variable scope for the bound field, `swapVariantId` not a sibling variant.
    Each message states the fix. Where the plugin already silently skips, convert
    to warning (don't break batch ops with hard errors mid-list — per-op error
    entries, batch continues, summary reports per-op status).
  - Tests: one test per rejection path; batch-continues-on-per-op-error test.

- [ ] **Task 4.4: `run_script` tool (remote transport only)**
  - Files: `src/figmagent_mcp/tools/script.ts` (new),
    `src/figma_plugin/src/remote_entries/stdlib.js` (new),
    `src/figmagent_mcp/remote/executor.ts` (edit)
  - Depends on: 1.4, 1.5
  - Parallelizable: yes (with 4.1–4.3)
  - Details:
    - Params: `{ code: string, mode: "read" | "write" (default "read"), description: string }`.
      `mode: "read"` enforcement is a **server-side static deny-list scan** of the
      script text (regex over mutating API names: `create[A-Z]\w+`, `\.remove\(`,
      `\.appendChild\(`, `setProperties`, `setBoundVariable`, `loadFontAsync`
      paired with assignment, …) that rejects before execution with
      `"This script calls <name> but mode is 'read'; rerun with mode: 'write'."`
      Runtime monkey-patching is **not possible** — validation confirmed `figma.*`
      properties are read-only on the remote global
      (`figma.createRectangle = …` throws). Best-effort guard, documented as such —
      the real protection is per-script rollback.
    - stdlib bundle = helpers + setcharacters + assertions + FSGN serializer +
      apply's FIELD_MAP binding helpers, exposed as `fig.*`:
      `fig.prop(node, name)`, `fig.setCharacters(node, text)`,
      `fig.loadFont(family, weightOrStyle)`, `fig.serialize(node, detail)`,
      `fig.bindVariable(node, field, variableId)`, `fig.check(nodeIds)`
      (assertions), `fig.createNode(spec)` (the `create` handler). Tool
      description enumerates the API — this replaces Figma's 4,700-line skills
      corpus with ~30 lines of API listing.
    - Post-run: `mode: "write"` scripts get `fig.check` run over
      `figma.currentPage.selection.length ? selection : returned ids` when the
      script returns `{ nodeIds: [...] }` (documented convention).
    - Session logging: full script text logged (D4 — recurring scripts are the
      tool roadmap). Plugin transport: tool returns "run_script requires the
      remote transport" with the fix (set `FIGMA_TRANSPORT=remote`).
  - Tests: read-mode guard blocks `createRectangle`; write-mode round trip;
    stdlib functions callable; script text appears in session log.

- [ ] **Task 4.5: Error-message audit**
  - Files: `src/figma_plugin/src/helpers.js` (error helper), all `commands/*.js`
    (touch error paths), `src/figmagent_mcp/utils.ts`
  - Depends on: none (can start any time)
  - Parallelizable: yes
  - Details: add `fail(message, fix)` helper → `"<message>. Fix: <fix>"`. Convert
    the top failure modes (source: improvement tracker + CLAUDE.md gotchas):
    unknown node ID (suggest `grep`/`read`), font-load failure (name the exact
    `fontFamily`/`fontStyle` to pass), variant-name format, scope-invalid variable
    binding (list valid scopes for the type — table already in styles.js),
    instance-child mutation (point at the main component), mixed-value reads
    (suggest per-range or `setcharacters` path). Rule going forward (add to
    CLAUDE.md in Phase 5): no user-facing error without a stated fix.
  - Tests: snapshot the rewritten messages; grep that no `throw new Error` in
    command modules lacks fix text (lint rule or test walking the AST is
    overkill — a review checklist line suffices).

**Phase 4 acceptance:** the five assertion classes are caught in tests; mini-lint
fires on exact matches; `run_script` works with stdlib + logging; audited errors
all state fixes.

---

## Phase 5 — Knowledge migration

Goal: CLAUDE.md shrinks; every pattern lives in code, error, or assertion first.

- [ ] **Task 5.1: Pattern-by-pattern disposition of CLAUDE.md "Figma Design Patterns"**
  - Files: `CLAUDE.md`, tool descriptions in `tools/*.ts`
  - Depends on: Phase 4 complete (destinations must exist)
  - Parallelizable: yes
  - Details — disposition per section:
    | CLAUDE.md pattern | Destination |
    |---|---|
    | Sizing sequencing | already in `write` two-pass code → delete prose, one line in tool description |
    | FRAME-not-RECTANGLE for stretchy | boundary validation 4.3 (error states it) → delete prose |
    | Auto-layout sizing defaults checklist | assertions 4.1 (balloon + FILL checks) → shrink to one line |
    | Variant naming convention | `combine_as_variants` error message (4.5) + keep two lines |
    | Reparenting recipe | first-class in `write fromNodeId` (3.2) → delete prose |
    | Instance text override format | `edit` tool description → delete prose |
    | Bind-on-COMPONENT-not-instance | mini-lint warning when binding on instance child (4.2) + keep one line |
    | Connection drops / channel recovery | plugin-transport-only appendix section |
    | Tool-usage guidance (get/find/apply flows) | rewritten for new names, halved — descriptions carry the detail |
  - Tests: n/a; acceptance = diff shows net deletion.

- [ ] **Task 5.2: Skills + agent defs update**
  - Files: `.claude/skills/figma-guidelines/`, `.claude/skills/figma-sub-agents/`,
    `.claude/agents/figma-discovery.md`, `.claude/skills/add-mcp-tool/`
  - Depends on: 5.1
  - Parallelizable: yes
  - Details: new tool names; sub-agent concurrency guidance updated for per-file
    FIFO on remote (parallel agents still help on *plugin* transport only — note
    explicitly); `add-mcp-tool` skill gains the registry.js + remote_entries step;
    discovery agent's tool list updated.
  - Tests: skill dry-run on a small Figma task.

**Phase 5 acceptance:** CLAUDE.md line count materially down (target: Patterns
section ≥60% smaller); no pattern that merely restates enforced behavior.

---

## Phase 6 — Measure & switch

- [ ] **Task 6.1: A/B battery + metric report**
  - Files: `scripts/parity-check.ts` (extend), analysis via `analyze-session` skill
  - Depends on: Phases 1–5
  - Details: run the Phase 2.4 battery + two real tasks (one read-heavy audit, one
    build-heavy) on each transport. Metrics per plan §6: calls/task, errors/task,
    wall-clock/task, escape-hatch share, warning-acted-on rate. Compare against
    pre-port session-log baselines (extract with `scripts/extract-sessions.ts`).
  - Acceptance: remote ≤ plugin on calls/task and errors/task. Wall-clock reported
    honestly — §9.3 predicts remote loses per-call; the bet is fewer calls ×
    fewer retries nets out. If it doesn't, remote stays opt-in and the plan's D1
    hedge becomes the default — that is a legitimate outcome, not a failure.

- [ ] **Task 6.2: Flip defaults + docs**
  - Files: `transport.ts` (default `auto`), `README.md`, `CLAUDE.md`, `scripts/setup.sh`
  - Depends on: 6.1 passes
  - Details: `FIGMA_TRANSPORT=auto` default (remote when authed); setup docs lead
    with OAuth flow, relay/plugin moves to "local fallback" section; relay +
    plugin stay in CI permanently (D1).

---

## Validation log (2026-06-10)

Spec-level claims verified against the codebase and live remote VM before this spec
was committed:

1. **SDK client surface**: `@modelcontextprotocol/sdk@1.27.1` (installed) ships
   `client/index.js` (Client), `client/streamableHttp.js`
   (`StreamableHTTPClientTransport`), `client/auth.js` (`OAuthClientProvider`). ✓
2. **End-to-end executor PoC (1.4 + 1.5)**: `Bun.build` runtime API (Bun 1.3.11),
   in-memory `outputs[0].text()`, entry shim assigning `getNodeTree` to
   `globalThis.__figmagent`, assembled script (6.6KB) with JSON params executed
   live via `use_figma` → correct FSGN raw-tree JSON returned for the scratch
   page. The exact script shape `executor.ts` will emit, proven working. ✓
3. **Strict guard hit live (1.6 is mandatory, not defensive)**: the unpatched
   bundle threw `no such property 'visible' on PAGE node` mid-traversal — even
   "safe-looking" properties throw on some node types. A `'visible' in node`
   patch fixed it; rerun passed. Confirms the codemod must cover *all* duck-typed
   serializer reads, per spike §6.2. ✓
4. **Tool import seam**: 13 of 14 `tools/*.ts` import `sendCommandToFigma` from
   `../connection.js` (exception: `session.ts`, server-side only — consistent
   with 1.1's "server-side tools never touch the transport"). Delegate shim
   avoids touching them. ✓
5. **Registry feasibility**: `main.js` dispatch is thin but some cases pass
   positional args + inline validation — registry needs `handler(params)`
   wrappers (folded into Task 1.4 details). ✓ (with caveat)
6. **Existing scripts**: `scripts/extract-sessions.ts` exists (3.1, 6.1);
   `session-logger.ts` exists (1.5 transport tag). ✓
7. **`figma.base64Encode` on remote VM**: verified live (encoded a PNG export,
   8,164 chars) — `export_node_as_image` ports as specced (1.7). ✓
8. **Read-mode guard (4.4): runtime wrapping REFUTED.** `figma.createRectangle`
   is a read-only property on the remote global — assignment throws. Task 4.4
   rewritten to a server-side static deny-list scan. ✗→ design corrected
9. **Multi-page single-script traversal** (1.7): verified live (plan §9.7). ✓
10. **Test baseline**: `bun test` green on fresh install — 104 pass, 0 fail. ✓
