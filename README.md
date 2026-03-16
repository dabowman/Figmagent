# Figmagent MCP

MCP server that bridges AI agents (Claude Code, Cursor) with Figma through a WebSocket relay and Figma plugin. Originally forked from [sonnylazuardi/cursor-talk-to-figma-mcp](https://github.com/sonnylazuardi/cursor-talk-to-figma-mcp), now a standalone project with significant additions: structured tree inspection (FSGN), design token binding, batch operations, component property management, design linting, library access, file comments, plugin concurrency control, and sub-agent orchestration.

```
AI Agent <-(stdio)-> MCP Server <-(WebSocket)-> Relay <-(WebSocket)-> Figma Plugin
```

## Setup

### Prerequisites

- [Bun](https://bun.sh) runtime
- Figma desktop app

### Quick Start

1. Install dependencies and configure MCP:

```bash
bun setup
```

This writes MCP config for both Cursor (`.cursor/mcp.json`) and Claude Code (`.mcp.json`).

2. Start the WebSocket relay in a separate terminal:

```bash
bun socket
```

3. In Figma: Plugins > Development > Link existing plugin > select `src/figma_plugin/manifest.json`

4. Run the plugin in Figma and click Connect. The MCP server auto-joins on the first tool call.

### Claude Code Setup

Add the MCP server manually:

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

## Tools (48)

### Document & Navigation

| Tool | Description |
|------|-------------|
| `join_channel` | Join a Figma plugin channel (auto-discovers if no args) |
| `get_document_info` | Get current document structure (pages, top-level frames) |
| `get_selection` | Get the user's current selection |
| `get` | Read nodes and subtrees in FSGN (YAML). Detail levels: `structure` / `layout` / `full`. Accepts `nodeId` or `nodeIds` (parallel). |
| `find` | Search a subtree by criteria: `componentId`, `variableId`, `styleId`, `text`, `name`, `type`, `annotation`, `hasAnnotation`. Results grouped by ancestor. |
| `set_focus` | Select and scroll to a node |
| `set_selections` | Select multiple nodes |

### Creating & Modifying

| Tool | Description |
|------|-------------|
| `create` | Create nodes from a spec — single or nested tree. Types: FRAME, TEXT, RECTANGLE, COMPONENT, INSTANCE. Auto-positions top-level nodes. |
| `apply` | Set properties on existing nodes: fill, stroke, corner radius, opacity, font, layout, variables, text/effect styles, variant swap, exposed instances. |
| `rename_node` | Rename a node |
| `move_node` | Move a node to x/y (position only, not reparent) |
| `resize_node` | Resize a node |
| `clone_node` | Clone a node with optional offset |
| `clone_and_modify` | Clone + reparent + modify in one call |
| `delete_node` | Delete a node |
| `delete_multiple_nodes` | Batch delete |
| `reorder_children` | Reorder children within a parent |

### Text

| Tool | Description |
|------|-------------|
| `set_text_content` | Set text on a single text node |
| `set_multiple_text_contents` | Batch update multiple text nodes |

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
| `lint_design` | Scan a subtree for unbound properties, match against variables (CIE76 deltaE for colors), auto-fix exact matches |

### Library (REST API)

Requires `FIGMA_API_TOKEN` environment variable.

| Tool | Description |
|------|-------------|
| `get_library_components` | Browse library component catalog |
| `search_library_components` | Search library components by name |
| `import_library_component` | Import and instantiate a library component |
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

### Export & Session

| Tool | Description |
|------|-------------|
| `export_node_as_image` | Export a node as PNG, JPG, SVG, or PDF |
| `export_session` | Export session log (tool call metrics, errors, timing) for analysis |

### Deprecated (kept for backward compatibility)

| Tool | Replacement |
|------|-------------|
| `scan_text_nodes` | `find(text: "regex")` |
| `scan_nodes_by_types` | `find(type: [...])` |

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
- `tools/` — domain-grouped tool registrations (document, create, apply, modify, text, components, find, scan, tokens, lint, libraries, comments, export)
- `prompts/` — AI prompt definitions
- `connection.ts` — WebSocket management and channel auto-discovery
- `types.ts`, `utils.ts` — shared types and utilities

The Figma plugin source lives in `src/figma_plugin/src/` as ES modules, bundled into `code.js` via `bun run build:plugin`. It includes concurrency control (node-level locks, global mutex, max 6 concurrent operations) for safe parallel agent execution.

See [CLAUDE.md](CLAUDE.md) for detailed agent guidance, design patterns, and known gotchas.

## License

MIT — see [LICENSE](LICENSE)
