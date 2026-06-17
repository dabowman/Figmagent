# Figmagent MCP

MCP server that bridges AI agents (Claude Code, Cursor) with Figma. Originally forked from [sonnylazuardi/cursor-talk-to-figma-mcp](https://github.com/sonnylazuardi/cursor-talk-to-figma-mcp), now a standalone project with significant additions: structured tree inspection (FSGN), design token binding, batch operations, component property management, design linting, library access, file comments, plugin concurrency control, and sub-agent orchestration.

Two transports share one command implementation:

```
plugin:  AI Agent <-(stdio)-> MCP Server <-(WebSocket)-> Relay <-(WebSocket)-> Figma Plugin
remote:  AI Agent <-(stdio)-> MCP Server <-(HTTPS/OAuth)-> Figma official MCP (use_figma)
```

The default `FIGMA_TRANSPORT=auto` picks the plugin path when the local relay is running (fastest: ~10–75ms/command) and falls back to the remote path when you're authed with Figma (headless, no relay, no plugin, no open Figma client; ~1–2.5s/command, atomic scripts). Both transports passed a full read-parity and build A/B with identical outputs, call counts, and error counts.

## Setup

### Prerequisites

- [Bun](https://bun.sh) runtime
- Figma desktop app (plugin transport only)

### Quick Start (remote transport — no relay, no plugin)

1. Install dependencies and configure MCP:

```bash
bun setup
```

This installs dependencies and writes Cursor's MCP config (`.cursor/mcp.json`). For Claude Code, install the plugin instead (see [Claude Code Setup](#claude-code-setup)) — it ships the MCP server plus skills, sub-agents, and the `/figmagent:reauth` command.

2. Issue any Figma tool call. On first run the server prints an OAuth URL to stderr (and opens your browser) — approve, and tokens persist to `~/.figmagent/auth.json`. Select a file by passing a Figma URL to `use_file` or setting `FIGMA_FILE_KEY`.

### Plugin transport (fastest — local relay + Figma plugin)

When per-command latency matters (large interactive sessions, parallel sub-agents), run the local path; `auto` prefers it whenever the relay is up:

1. Start the WebSocket relay in a separate terminal:

```bash
bun socket
```

2. In Figma: Plugins > Development > Link existing plugin > select `src/figma_plugin/manifest.json`

3. Run the plugin in Figma and click Connect. The MCP server auto-joins on the first tool call.

### Claude Code Setup

Figmagent ships as a Claude Code **plugin** — installing it registers the MCP server **and** the bundled Figma skills, sub-agents, and the `/figmagent:reauth` command in one step, available across all your projects (no per-project `.mcp.json`).

The plugin lives in this repo (the repo root is the plugin: `.claude-plugin/plugin.json`, `commands/`, `skills/`, `agents/`, `.mcp.json`). Its `.mcp.json` runs the server via `bun ${CLAUDE_PLUGIN_ROOT}/src/figmagent_mcp/server.ts`, so dependencies must be installed in the cloned repo first:

```bash
bun install   # or: bun setup
```

Then add this repo as a plugin marketplace and install it (a single repo can be its own marketplace):

```
/plugin marketplace add /absolute/path/to/cursor-talk-to-figma-mcp
/plugin install figmagent
```

Reload, and `mcp__Figmagent__*` tools, the `/figmagent:reauth` command, and the Figma skills/sub-agents are available everywhere. Update with `/plugin update figmagent` after pulling.

**Manual MCP registration (alternative, no plugin):** if you only want the MCP server (not the bundled skills/commands), register it directly — but then skills and `/figmagent:reauth` are not installed:

```bash
claude mcp add Figmagent -- bun /path-to-repo/src/figmagent_mcp/server.ts
```

### Cursor Setup

Add to your MCP configuration:

```json
{
  "mcpServers": {
    "Figmagent": {
      "command": "bun",
      "args": ["/path-to-repo/src/figmagent_mcp/server.ts"]
    }
  }
}
```

### Windows/WSL

Uncomment the `hostname: "0.0.0.0"` line in `src/socket.ts` to allow connections from the Windows host.

### Transport selection

Select with the `FIGMA_TRANSPORT` env var on the MCP server process:

- `auto` (default) — plugin when the local relay is reachable, otherwise remote when a cached OAuth token exists (`~/.figmagent/auth.json`), otherwise plugin
- `plugin` — local relay + Figma plugin, always
- `remote` — Figma's official MCP (`mcp.figma.com`), always; full read + write command surface, atomic per-script execution (a failed write rolls back entirely; oversized `write` payloads are chunked at depth-1 with a per-chunk rollback note)

**First-run OAuth:** on the first remote command the server prints an authorization URL to stderr (and tries to open your browser), then waits up to 5 minutes for the redirect on a local loopback port. Approve in the browser; tokens are saved to `~/.figmagent/auth.json` (0600) and refreshed automatically. Headless machines: open the printed URL anywhere, then complete the redirect from a browser that can reach `127.0.0.1` on that machine.

**Re-authenticating:** if commands start failing with an authorization error or "you don't have edit access" (usually the stored token belongs to the wrong Figma account), run the `/figmagent:reauth` slash command (Claude Code) or call the `reauthenticate` tool directly — no need to hand-edit `~/.figmagent/auth.json`. It clears the cached token, reopens the browser login so you can pick an account with editor access, and reports which account is now authenticated. (`use_figma` runs every command — reads included — as a script in the file's VM, so the authenticated account must be an **editor** on the file.) Note: because Figmagent is a stdio MCP server doing its own OAuth, it can't surface a "Reauthenticate" entry in Claude Code's `/mcp` menu — that menu is reserved for remote HTTP servers whose OAuth Claude Code manages.

**Selecting a file:** the remote transport has no channels. Pass a Figma file URL (or bare fileKey) to `use_file`, or set `FIGMA_FILE_KEY`. Override the endpoint with `FIGMA_MCP_URL` if needed.

**Parity harness:** `bun scripts/parity-check.ts --file <figmaUrl> [--channel <relayChannel>]` runs the read suite (add `--battery` for the representative 8-variant build A/B) on both transports against the same file, diffs normalized outputs, and prints per-command latency. Measured (2026-06-11, 13-command suite + battery): identical outputs and call counts on both transports; remote ~0.8–2.5s/call vs plugin ~5–75ms/call — remote trades per-call speed for zero local setup and atomic rollback.

## Tools (39)

The core tools mirror Claude Code primitives (`read`, `grep`, `edit`, `write`) but operate on Figma nodes, not files.

### Core

| Tool | Description |
|------|-------------|
| `use_file` | Select the working file: relay channel (plugin transport) or Figma URL/fileKey (remote transport) |
| `read` | Read Figma nodes and subtrees in FSGN (YAML). No `nodeId` = document overview (pages, top-level frames). Detail levels: `structure` / `layout` / `full`. Accepts `nodeId` or `nodeIds` (parallel). |
| `grep` | Search Figma nodes by regex pattern or criteria: `text`, `name`, `type`, `componentId`, `variableId`, `styleId`, `annotation`, `hasAnnotation`. Results grouped by ancestor. |
| `edit` | Modify existing nodes: fill, stroke, corner radius, opacity, font, layout, variables, text/effect styles, variant swap, exposed instances — plus x/y move, rename, reorder (`index`), text content (`characters`), and `delete: true`. |
| `write` | Create nodes from a spec — single or nested tree. Types: FRAME, TEXT, RECTANGLE, COMPONENT, INSTANCE, SVG. `fromNodeId` clones an existing node (with `parentId` = the reparent recipe). Auto-positions top-level nodes. |
| `lint` | Scan a subtree for unbound properties, match against variables (CIE76 deltaE for colors), auto-fix exact matches |
| `screenshot` | Export a node as PNG, JPG, SVG, or PDF |
| `get_selection` | Get the user's current selection |
| `run_script` | Escape hatch (remote transport only): run a raw Plugin API script with the `fig.*` stdlib preloaded (font-safe text, FSGN serializer, scope-validated variable binding, post-write checks). Last resort — use only when no first-class tool covers the operation. Scripts are session-logged in full. |

### Files & Navigation

| Tool | Description |
|------|-------------|
| `create_new_file` | Create a blank Figma file and target it (remote transport only) |
| `set_focus` | Select and scroll to a node |
| `set_selections` | Select multiple nodes |

### Components & Instances

| Tool | Description |
|------|-------------|
| `get_local_components` | List component sets and standalone components, with variant axes |
| `combine_as_variants` | Combine components into a COMPONENT_SET (auto-layout enabled) |
| `component_properties` | Batch add/edit/delete/bind property definitions. `add` supports `targetNodeId` to wire properties to child nodes. |
| `get_instance_overrides` | Extract overrides from an instance |
| `set_instance_overrides` | Apply overrides to target instances |
| `get_component_variants` | Get variants for a component set |

### Design Tokens & Styles

| Tool | Description |
|------|-------------|
| `get_design_system` | Get all styles and variables in one call |
| `create_variables` | Create variable collections, modes, and variables (COLOR, FLOAT, STRING, BOOLEAN) |
| `update_variables` | Update values, rename, or delete variables |
| `create_styles` | Create paint, text, effect, and grid styles in batch |
| `update_styles` | Update, rename, or delete styles |
| `prepare_figma_variables` | Convert DTCG design token JSON to `create_variables`-ready payloads (server-side, no Figma connection) |

### Library (REST API)

Requires `FIGMA_API_TOKEN` environment variable.

| Tool | Description |
|------|-------------|
| `get_library_components` | Browse library component catalog |
| `search_library_components` | Search library components by name |
| `import_library_component` | Import and instantiate a library component |
| `import_library_components` | Batch import multiple library components in parallel |
| `get_library_variables` | Get design token variables from a library |

### Annotations

| Tool | Description |
|------|-------------|
| `get_annotations` | Get annotations from nodes (single, batch `nodeIds`, or page scan) |
| `set_annotation` | Create or update an annotation |
| `set_multiple_annotations` | Batch create/update annotations |

### Prototyping & Connections

| Tool | Description |
|------|-------------|
| `get_reactions` | Get prototype reactions from nodes |
| `set_default_connector` | Set default connector style |
| `create_connections` | Create connector lines between nodes |

### Comments (REST API)

Requires `FIGMA_API_TOKEN` with `file_comments:read` and `file_comments:write` scopes.

| Tool | Description |
|------|-------------|
| `get_comments` | Read file comments |
| `post_comment` | Post a comment or reply |
| `delete_comment` | Delete a comment |

### Session

| Tool | Description |
|------|-------------|
| `export_session` | Export session log (tool call metrics, errors, timing) for analysis |

### Renamed, folded & retired (since the surface reshape)

MCP tool names changed; wire-protocol command names are unchanged.

| Old tool | Now |
|------|-------------|
| `get` / `get_document_info` | `read` (no `nodeId` = document overview) |
| `find` | `grep` |
| `apply` | `edit` |
| `create` | `write` |
| `lint_design` | `lint` |
| `export_node_as_image` | `screenshot` |
| `join_channel` | `use_file` |
| `move_node`, `resize_node`, `rename_node`, `reorder_children`, `delete_node`, `delete_multiple_nodes`, `set_text_content`, `set_multiple_text_contents` | folded into `edit` ops (`x`/`y`, `width`/`height`, `name`, `index`, `delete: true`, `characters`) |
| `clone_node`, `clone_and_modify` | folded into `write` (`fromNodeId`) |
| `scan_text_nodes`, `scan_nodes_by_types` | retired — `grep(type: ["TEXT"], text: "regex")` covers |
| `get_styles`, `get_local_variables` | retired — `get_design_system` covers |

## MCP Prompts (6)

| Prompt | Description |
|--------|-------------|
| `design_workflow` | End-to-end workflow for reading, creating, and modifying Figma designs |
| `text_replacement` | Strategy for finding and replacing text content |
| `component_architecture` | Guide to building components, variants, and instances |
| `annotation_conversion` | Converting manual annotations to native Figma annotations |
| `instance_override_transfer` | Transferring overrides between instances |
| `reaction_to_connector` | Converting prototype reactions to connector lines |

## Development

```bash
bun install              # Install dependencies
bun socket               # Start WebSocket relay (port 3055)
bun run build:plugin     # Bundle Figma plugin (src/ → code.js)
bun run test             # Run tests
bun run lint             # Lint with Biome
bun run lint:fix         # Auto-fix lint + format
bun run check            # Lint + format check
```

### Architecture

The MCP server is modular (`src/figmagent_mcp/`):
- `server.ts` — entry point
- `tools/` — domain-grouped tool registrations (document, create, apply, components, find, scan, tokens, lint, libraries, comments, export)
- `prompts/` — AI prompt definitions
- `connection.ts` — WebSocket management and channel auto-discovery
- `types.ts`, `utils.ts` — shared types and utilities

The Figma plugin source lives in `src/figma_plugin/src/` as ES modules, bundled into `code.js` via `bun run build:plugin`. It includes concurrency control (node-level locks, global mutex, max 6 concurrent operations) for safe parallel agent execution.

See [CLAUDE.md](CLAUDE.md) for detailed agent guidance, design patterns, and known gotchas.

## License

MIT — see [LICENSE](LICENSE)
