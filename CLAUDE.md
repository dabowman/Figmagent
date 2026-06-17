# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MCP (Model Context Protocol) server that bridges AI agents (Cursor, Claude Code) with Figma. Two transports share one command implementation:

```
plugin:  Claude Code / Cursor <-(stdio)-> MCP Server <-(WebSocket)-> WebSocket Relay <-(WebSocket)-> Figma Plugin
remote:  Claude Code / Cursor <-(stdio)-> MCP Server <-(HTTPS/OAuth)-> Figma official MCP (use_figma scripts)
```

Select with `FIGMA_TRANSPORT` (`auto` (default) | `plugin` | `remote`). `auto` prefers the plugin path when the relay is reachable (~10ms/command vs ~1s/command remote — Phase 6 A/B showed identical correctness, calls, and errors otherwise) and falls back to remote when a cached OAuth token exists. On the remote transport the same plugin command modules are bundled per domain and executed inside Figma's `use_figma` VM — no relay, no plugin, no open Figma client. Remote scripts are atomic (a thrown error means nothing was applied) and execute through a per-file FIFO queue.

## Build & Development Commands

```bash
bun install              # Install dependencies
bun socket               # Start WebSocket relay server (port 3055)
bun setup                # Full setup (install + write .cursor/mcp.json + .mcp.json)
bun run build:plugin     # Bundle Figma plugin (src/figma_plugin/src/ → code.js)
bun run test             # Run tests (bun:test)
bun run lint             # Lint with Biome
bun run lint:fix         # Auto-fix lint + format issues
bun run format           # Auto-format with Biome
bun run check            # Lint + format check combined
```

## Architecture

### MCP Server (`src/figmagent_mcp/`)
Modular server implementing MCP via `@modelcontextprotocol/sdk`. Entry point is `server.ts` which imports domain-grouped tool modules from `tools/` (document, create, apply, components, export, scan, find, libraries, lint, comments, tokens, file, script, session, auth) and prompt definitions from `prompts/`. Exposes 40 tools and 6 AI prompts. The core tools mirror Claude Code primitives but operate on Figma nodes: `read` (tools/document.ts), `grep` (tools/find.ts), `edit` (tools/apply.ts), `write` (tools/create.ts), `lint` (tools/lint.ts), `screenshot` (tools/export.ts), `use_file` (tools/scan.ts), plus `run_script` (tools/script.ts, remote transport only). MCP tool names are decoupled from the wire protocol — tool handlers still send the original wire command names (`apply`, `create`, `get_node_tree`, `find`, `lint_design`, …). Types in `types.ts` (the `FigmaCommand` union is the wire protocol), utilities in `utils.ts`. Transport selection lives in `transport.ts`; `connection.ts` implements the plugin/WebSocket path (UUID-correlated `pendingRequests` with timeouts), and `remote/` implements the remote path (`client.ts` + `auth.ts` for the official MCP connection, `bundles.ts` for per-domain Bun.build bundling, `domains.ts` for the command→domain map, `executor.ts` for script assembly + per-file FIFO, `filecontext.ts` for fileKey resolution).

### WebSocket Relay (`src/socket.ts`)
Lightweight Bun WebSocket server on port 3055 (configurable via `PORT` env). Routes messages between MCP server and Figma plugin using channel-based isolation. Clients call `join` to enter a channel; messages broadcast only within the same channel. Exposes `GET /channels` HTTP endpoint for auto-discovery of active channels.

### Figma Plugin (`src/figma_plugin/`)
Runs inside Figma. Source lives in `src/figma_plugin/src/` as ES modules, bundled into a single `code.js` via `bun run build:plugin`. `code.js` is the plugin main thread dispatching ~50 wire commands through the command registry. `ui.html` is the plugin UI for WebSocket connection management. `manifest.json` declares permissions (dynamic-page access, localhost network).

**Source structure** (mirrors the MCP server's `tools/` layout):
- `src/main.js` — entry point: registry-based dispatch, concurrency control, plugin UI handlers
- `src/registry.js` — aggregates per-domain registries into the single command map; `src/registry/<domain>.js` — per-domain entries `{ lock: "read" | "global" | "node", handler(params) }` (single source of truth for the wire surface)
- `src/remote_entries/<domain>.js` — remote-transport entry shims exposing each domain's handlers on `globalThis.__figmagent` (plus `stdlib.js` backing `run_script`'s `fig.*` API)
- `src/helpers.js` — shared utilities: state, progress updates, `prop()` strict-guard reads, `fail(message, fix)` error helper, font loading, sanitizeSymbols, etc.
- `src/assertions.js` — post-write structural assertions (balloon frames, width collapse, FILL-not-applied, font fallback, sibling overlaps)
- `src/setcharacters.js` — font-safe text replacement (handles mixed fonts)
- `src/commands/document.js` — getDocumentInfo, getSelection, getNodeTree (FSGN traversal), exportNodeAsImage
- `src/commands/create.js` — create (single nodes and nested trees, including COMPONENT and INSTANCE types)
- `src/commands/apply.js` — unified node modification (backs the `edit` tool): fill, stroke, corner radius, opacity, font properties, layout, move/rename/reorder, text content (via setcharacters.js), variables, text styles, variant swapping, exposed instances, delete
- `src/commands/modify.js` — moveNode, resizeNode, renameNode, deleteNode, cloneNode, cloneAndModify, reorderChildren
- `src/commands/text.js` — setTextContent, setMultipleTextContents
- `src/commands/components.js` — createComponent, combineAsVariants, instance overrides, component properties, exposed instances, etc.
- `src/commands/find.js` — unified search (backs the `grep` tool): componentId, variableId, styleId, text, name, type criteria with auto-grouping
- `src/commands/scan.js` — scanTextNodes, scanNodesByTypes (wire commands kept for internal use; no MCP registration — `grep` covers), annotations
- `src/commands/styles.js` — getStyles, getLocalVariables, getLocalComponents, getDesignSystem, createVariables, updateVariables, createStyles, updateStyles, FIELD_MAP (shared with apply.js)
- `src/commands/lint.js` — lintDesign: subtree scan for unbound properties, variable matching (CIE76 deltaE for colors), auto-fix, plus the `matchVariable`/`miniLint` matchers reused at write time
- `src/commands/connections.js` — setDefaultConnector, createConnections, setFocus, setSelections
- `src/commands/layout.js` — auto-layout helpers shared by create/apply

**Wire protocol stability**: command names in `registry/<domain>.js`, `remote/domains.ts`, `types.ts` (`FigmaCommand`), and `tests/registry.test.ts` never change — renames happen at the MCP tool layer only, so both transports share one implementation with no version skew.

**JS constraints**: The command modules run in Figma's sandboxed JS VMs — both the desktop plugin VM and the remote `use_figma` VM. The source files are modern ES modules (arrow functions, let/const, template literals are all fine — bun bundles them into an IIFE). However, do **not** use optional chaining (`?.`) or nullish coalescing (`??`) in source files — Biome enforces this via `useOptionalChain: off` override. Also do **not** use object spread (`{ ...obj }`) — Figma's VM rejects it with "Unexpected token ...". Use `Object.assign({}, obj)` instead. Array spread (`[...arr]`) is fine. Bun's bundler does NOT transpile these down. Use `prop(node, "name")` for duck-typed property reads at serializer boundaries — the remote VM throws on missing properties. After editing source files, run `bun run build:plugin` to regenerate `code.js`.

## Key Patterns

Tool descriptions (`src/figmagent_mcp/tools/*.ts`) are the source of truth for parameters, capabilities, and call shapes. The notes below are workflow-level only.

- **Logging**: All logs go to stderr. Stdout is reserved for MCP protocol messages.
- **Session logging**: Every tool call is logged to `~/.figmagent/sessions/` (JSON files, with a `transport` field; `run_script` logs full script text). Use `export_session` for a summary or full log.
- **Timeouts & chunking**: 30s default per command; plugin progress updates reset the inactivity timer. Large scans are chunked. Oversized remote `write` payloads are split across sequential scripts — the response carries `chunked: true` and rollback is per-chunk, not whole-call.
- **Output budget**: Variable-size tools (`read`, `grep`, `get_design_system`, `lint`) enforce a 30K char default budget; over-budget responses return the meta/summary plus narrowing instructions. Raise with `maxOutputChars` only when full data is genuinely needed. `figma.mixed` values are sanitized to the string `"mixed"`.
- **Read before write**: `read()` (no nodeId) for the document overview, then `read(nodeId, detail="structure", depth=2)` to orient; increase detail/depth only after reviewing the structure. Use `grep` to locate nodes → `read` for details → `edit` to act.
- **Batch over singles**: one `write` call creates whole trees, multiple roots, or clones (`fromNodeId`); one `edit` call modifies many nodes (text via `characters`, deletes via `delete: true`). Note two `write` behaviors: new FRAME/RECTANGLE/COMPONENT nodes get empty fills (pass `fillColor` explicitly or bind a variable), and top-level nodes without x/y auto-place 100px right of existing page content. When no first-class tool covers an operation, `run_script` (remote transport only) is the last-resort escape hatch — recurring scripts become tool roadmap items.
- **Write responses carry the verdict**: Zod schemas + plugin pre-checks reject or warn on impossible requests before mutating (text props on non-TEXT, FILL under a non-auto-layout parent, scope-mismatched bindings, instance-child structural edits — batches continue with per-op errors). `write`/`edit` responses append a `warnings:` block (balloon frames, width collapse, FILL-not-applied, font fallback, sibling overlaps) plus mini-lint suggestions when a raw value exactly matches a variable. Act on warnings instead of re-reading to verify.
- **FSGN format**: `read` returns YAML with `meta` (`nodeCount`, `tokenEstimate`) and `defs` deduplicating variables (`v1`…), styles (`s1`…), components (`c1`…). Use the short def IDs in `edit`'s `variables`/`textStyleId`. Multiple nodeIds → one FSGN block per node separated by `---`. Variant property definitions live on the COMPONENT_SET, not its child variants; instances resolve `componentRef` in `defs.components`.
- **Design tokens workflow**: `get_design_system` to discover (filter with `collection`/`styleType`/`includeVariables`/`includeStyles`; pass `includeScopes: true` to surface each variable's `scopes` array, e.g. to verify scopes set via `update_variables` — omitted by default to keep output compact) → `edit` with `variables`/`textStyleId`/`effectStyleId` to bind. `prepare_figma_variables` converts DTCG token JSON into `create_variables` payloads entirely server-side. Variable/style CRUD (`create_variables`, `update_variables`, `create_styles`, `update_styles`) is batch-first; invalid scopes and duplicate names fail with the fix stated.
- **Lint after batches**: run `lint` after building or styling (accepts PAGE node IDs to lint a whole page). `autoFix: true` binds exact matches; `ambiguous` issues are never auto-fixed; instance children are linted but not auto-fixed — bind on the main component.
- **Comments & annotations**: comments are REST-API based (`get_comments`/`post_comment`/`delete_comment`, require `FIGMA_API_TOKEN` with `file_comments:*` scopes; `fileKey` from the Figma URL). Annotations: search with `grep` (`hasAnnotation: true` or `annotation: "regex"`), batch-read with `get_annotations(nodeIds)`, replace by index with `set_annotation`.
- **Libraries**: `import_library_components` and `get_component_variants` are batch tools for **published library** files (require a fileKey). For local/unpublished component sets, `read(nodeId)` on the set returns property definitions and variant IDs directly.
- **Exposed instances vs INSTANCE_SWAP vs Slots**: `edit`'s `isExposedInstance` surfaces a nested instance's own properties on the parent — it does NOT create a swap picker (use a `component_properties` INSTANCE_SWAP property for that). Figma's newer "Slot" feature has no plugin API support — UI only.

## Figma Design Patterns

Correctness patterns from real sessions now live in code: two-pass FILL sizing in `write`, boundary validation before mutation, post-write assertions, write-time mini-lint, and fix-stating errors (`fail(message, fix)` — no user-facing error without a stated fix). Tool descriptions carry the details. What remains here is knowledge nothing rejects pre-mutation yet:

- **Use FRAME, not RECTANGLE, for stretchy shapes**: RECTANGLE cannot take FILL sizing — use a FRAME with `fillColor` (e.g. a 1px-wide FRAME as a divider line). The `write` description states this and the post-write `fill_not_applied` warning catches it after the fact, but no boundary error names the FRAME fix pre-mutation.
- **Auto-layout sizing defaults**: auto-layout frames default to a FIXED 100px counter axis — set HUG/FILL/explicit sizes deliberately; post-write assertions warn on 100px balloons and FILL-not-applied.
- **Variant naming**: components in a COMPONENT_SET are named `Property=Value` (e.g. `Size=MD, State=Default`); `combine_as_variants` rejects malformed names with the fix. To add a variant axis to an existing set: rename existing variants to include `, NewProp=DefaultValue`, clone each for the new values, rename the clones — Figma auto-detects the axis.
- **Bind variables and text styles on COMPONENT nodes, not instances** — bindings propagate to all instances automatically.

## Concurrency & Sub-Agents

### Plugin concurrency control
The plugin classifies operations via registry `lock` entries: `read` ops run freely, `global` ops (e.g., the `create`, `apply`, `delete_multiple_nodes` wire commands) serialize via global mutex, and per-node writes lock by `nodeId`. Max 6 concurrent in-flight operations. This makes parallel agent execution safe when agents operate on disjoint node sets — **on the plugin transport only**. On the remote transport the server serializes all commands per fileKey (FIFO queue), so parallel agents do not increase throughput there.

### Sub-agent architecture
For large Figma tasks (8+ variants, 100+ tool calls), use the `/figma-sub-agents` skill to delegate work:
- **Discovery** (`.claude/agents/figma-discovery.md`) — read-only exploration, returns structured JSON summary
- **Builder** — creates/clones node structures, can run in parallel (max 3, plugin transport)
- **Styler** — applies variable bindings and text styles, can run in parallel (max 3, plugin transport)

Phases must be sequential: Discovery → Build → Style. Within Build or Style, agents can run in parallel on disjoint node subtrees (plugin transport; on remote, run them serially — context isolation still helps, wall-clock parallelism doesn't). All agents share one WebSocket channel — request UUID correlation routes responses.

## Two Figma MCPs

Don't confuse these — they have different tool prefixes and different capabilities:
- **Figmagent** (`mcp__Figmagent__*`): this project. Talks to the Figma plugin via the WebSocket relay. Full read/write canvas access.
- **Figma** (`mcp__figma__*`): the official Figma MCP. Uses the Figma REST API directly. Different server, different tools.

## Task Completion Checklist

Run before considering any feature/fix done:
1. `bun run build:plugin` (if plugin source changed)
2. `bun run lint`
3. `bun run test`
4. Update CLAUDE.md / SKILL.md / prompts if agent-facing behavior changed
5. Commit with descriptive message

## Setup

1. Run `bun setup` — installs dependencies and writes MCP config for both Cursor (`.cursor/mcp.json`) and Claude Code (`.mcp.json`)
2. `bun socket` in one terminal (WebSocket relay)
3. In Figma: Plugins > Development > Link existing plugin > select `src/figma_plugin/manifest.json`
4. Run plugin in Figma, click Connect — the plugin joins a channel named after the file (e.g. `my-design-file`). The MCP server auto-joins when you first issue a command.

Remote transport instead: with no relay running, `auto` (the default) selects remote when authed — or force it with `FIGMA_TRANSPORT=remote`. Complete the OAuth flow on first run (see README; the OAuth client registers as "Claude Code (Figmagent)" — Figma's registration endpoint allowlists client names by known-client prefix) and select a file with `use_file` (Figma URL or fileKey) or `FIGMA_FILE_KEY` — no relay or plugin needed.

### Windows/WSL

Uncomment the `hostname: "0.0.0.0"` line in `src/socket.ts` to allow connections from Windows host.

## Agent Notes

- No need to call `use_file` manually — the MCP server auto-joins when you issue the first Figma command. If multiple Figma files are open, the first command returns a list of file names; call `use_file({ channel: "file-name" })` to pick one. (On remote, `use_file` takes a Figma URL or fileKey.)
- **No ToolSearch needed.** The MCP server instructions enumerate all 39 available tools by domain. Sub-agents declare their tools in agent definitions. Call tools directly by name instead of discovering them at runtime.
- Call `read()` (no nodeId) first to understand the design structure
- Use `grep` to search for nodes by regex pattern or criteria (component usage, variable bindings, style usage, text content, name, type) — returns grouped matches with ancestry paths
- Use `read(nodeId, detail="structure", depth=2)` on a target node to orient before making modifications
- Use `get_design_system` to discover styles and variables before applying styles/tokens
- On the plugin transport, the plugin and relay must both be running before any tool calls succeed
- After 2 consecutive identical errors on the same tool, stop retrying and diagnose the root cause (wrong node ID, lost connection, or type mismatch)
- After 2 timeouts in a row on any tool, assume the connection is lost. The MCP server auto-invalidates the channel on timeout and re-discovers on the next command, but if auto-recovery fails, call `use_file` explicitly
- Never launch long-running Agent (sub-agent) calls in the same parallel batch as speculative file reads. A Read error can cancel the entire batch, wasting the Agent's work. Verify file existence with Glob first, or run Agents in a separate batch.
- When applying a new pattern to many nodes (variable bindings, style changes, exposed instances, etc.), always validate on 1 node first and confirm the result before batching. This prevents wasting calls if the approach is wrong.
- When importing design tokens from a project with a token pipeline (e.g. Style Dictionary, Tokens Studio), read the pipeline's output files (e.g. `tokens/figma/`, `build/`) rather than the source/base tokens. Pipeline output has the correct naming, resolved aliases, and Figma-specific formatting.
- No user-facing error without a stated fix. Every error thrown from plugin command modules must state how to resolve it — use the `fail(message, fix)` helper in `src/figma_plugin/src/helpers.js`.

## Plugin Transport Appendix

These apply to the plugin/WebSocket transport only (the remote transport has no relay, channels, or plugin):

- On command timeout the MCP server invalidates the current channel; the next command auto-rejoins and re-discovers available channels. The plugin reuses its channel name on reconnect (increments to `-2` only if another plugin genuinely occupies it). `use_file` validates channel names against the relay and lists available channels on mismatch — manual `use_file` is rarely needed.
- The WebSocket auto-reconnects 2 seconds after a disconnect.
- Newly added MCP tools don't appear until the MCP connection is restarted (`/mcp` in Claude Code); the channel re-joins automatically on the first tool call afterwards. (This one applies to both transports.)
