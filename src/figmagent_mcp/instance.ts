import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { recordToolCall } from "./session-logger.js";

const instructions = `Figmagent bridges AI agents with Figma via a WebSocket relay. The Figma plugin must be running for tools to work.

The core tools mirror Claude Code primitives but operate on Figma nodes, NOT files: read/grep/edit/write here take node IDs, never file paths.

## Quick Start
1. Call any tool — the server auto-joins the active Figma file. If multiple files are open, you'll get a list to pick from (use_file selects one).
2. Use read() with no nodeId to see pages and top-level frames, then get_selection() to find what the user is looking at.
3. Use read(nodeId, detail="structure", depth=2) to orient before making changes.

## Core Workflow: grep → read → edit
- grep() — search Figma nodes by regex pattern or criteria (text, name, type, component usage, variable bindings, styles)
- read() — read Figma node subtrees at three cost levels: "structure" (~5 tokens/node), "layout" (~15), "full" (~30). No nodeId = document overview.
- edit() — modify existing Figma nodes (fill, stroke, fonts, text content, layout, position, name, reorder, variables, styles, delete)
- write() — create Figma nodes (single or nested trees; FRAME, TEXT, RECTANGLE, COMPONENT, INSTANCE, SVG) or clone existing ones (fromNodeId)
- lint() — scan for properties not bound to design tokens; autoFix binds exact matches
- screenshot() — export a node as an image for visual verification

## Critical Rules
- **FRAME not RECTANGLE for stretchy shapes.** RECTANGLE cannot use FILL sizing. Use a FRAME with fillColor instead.
- **Bind variables on COMPONENTs, not instances.** Bindings propagate from component to all instances automatically.
- **Reparenting = clone + delete.** edit's x/y only changes coordinates. To reparent: write({ fromNodeId, parentId: newParent }) + edit({ nodes: [{ nodeId: original, delete: true }] }).
- **Colors are RGBA 0-1** (not 0-255). Example: { r: 0.2, g: 0.4, b: 1.0 }
- **Batch over singles.** One edit() call handles many nodes — property changes, text (characters), deletions (delete: true).
- **Connection drops.** If 2+ commands time out, the server auto-recovers by re-discovering channels. If that fails, call use_file() manually.
- **Stop after 2 identical errors.** Diagnose the root cause instead of retrying.

## Design System
- get_design_system() — discover all styles and variables in one call
- edit() with variables field — bind design tokens to node properties
- edit() with textStyleId/effectStyleId — apply styles from the design system
- lint() — scan for unbound properties, auto-fix exact matches

## Available Tools

All 42 tools provided by this server, grouped by domain:

**Core:** read, grep, edit, write, lint, screenshot, use_file, get_selection
**Escape Hatch:** run_script (remote transport only) — raw Plugin API script with the fig.* stdlib preloaded. LAST RESORT: use only when no first-class tool covers the operation. mode: "write" scripts that return { nodeIds: [...] } get post-run structural checks.
**Creating Files:** create_new_file (remote transport)
**Components:** get_local_components, combine_as_variants, component_properties, get_instance_overrides, set_instance_overrides
**Design System:** get_design_system, create_variables, update_variables, create_styles, update_styles, prepare_figma_variables
**Libraries:** get_library_components, search_library_components, import_library_component, import_library_components, get_component_variants, get_library_variables, get_enabled_library_variables, import_library_variable
**Annotations & Comments:** get_annotations, set_annotation, set_multiple_annotations, get_comments, post_comment, delete_comment
**Connections & Prototyping:** get_reactions, set_default_connector, create_connections, set_focus, set_selections
**Session:** export_session
**Auth:** reauthenticate (remote transport — re-run Figma OAuth, e.g. wrong-account or edit-access errors)

## Prompts Available
Request these for detailed workflow guidance:
- design_workflow — full 6-phase workflow with examples and pitfalls
- text_replacement — finding and replacing text content
- component_architecture — building components, variants, and instances
- annotation_conversion — converting manual annotations to native Figma annotations
- instance_override_transfer — transferring overrides between instances
- reaction_to_connector — visualizing prototype flows as connector lines`;

// Create MCP server (exported for tool/prompt registration)
export const server = new McpServer(
  {
    name: "Figmagent",
    version: "1.0.0",
  },
  { instructions },
);

// ─── Session logging wrapper ─────────────────────────────────────────────────
// Patches server.tool() to record every tool call (timing, success, errors).
// Must run before any tool file imports — tool files import `server` from here.
const originalTool = server.tool.bind(server);
server.tool = ((...args: any[]) => {
  // The tool name is always the first arg
  const toolName = args[0] as string;

  // The callback is always the last arg
  const lastIdx = args.length - 1;
  const originalCb = args[lastIdx];

  if (typeof originalCb === "function") {
    args[lastIdx] = async (params: any, extra: any) => {
      const start = performance.now();
      try {
        const result = await originalCb(params, extra);
        const responseChars = result?.content?.reduce((sum: number, c: any) => sum + (c.text?.length || 0), 0) ?? 0;
        recordToolCall(toolName, params, start, true, responseChars);
        return result;
      } catch (err: any) {
        const msg = err?.message || String(err);
        recordToolCall(toolName, params, start, false, 0, msg);
        throw err;
      }
    };
  }

  return (originalTool as any)(...args);
}) as any;
