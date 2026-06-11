# Skill: Adding a New MCP Tool to Figmagent

Use this skill when adding new tools or commands that let AI agents control Figma through the MCP server.

## Architecture Overview

One command implementation serves two transports. The relay and plugin UI are generic routers — adding a new tool never touches them:

```
plugin:  MCP Server (tools/*.ts) ←WS→ Relay (socket.ts) ←WS→ Plugin UI (ui.html) ←postMessage→ code.js (registry dispatch)
remote:  MCP Server (tools/*.ts) → remote/executor.ts → per-domain bundle of the same command modules → Figma's use_figma VM
```

MCP tool names (first arg of `server.tool`) are **decoupled from wire command names** — e.g. the `edit` tool sends the `apply` wire command. Pick an agent-facing tool name freely; the wire command name is permanent protocol (it never changes after shipping — renames happen at the MCP layer only).

**Before adding a tool, check it's needed**: `write`/`edit` already cover most node creation/mutation, `grep`/`read` cover search/reads, and `run_script` is the escape hatch for one-offs. New first-class tools should come from recurring needs (recurring `run_script` scripts in session logs are the roadmap).

## Files to edit for a new wire command (the checklist that tests enforce)

1. `src/figma_plugin/src/commands/<domain>.js` — the handler function. Takes a single `params` object, returns a JSON-serializable result. Runs in BOTH Figma VMs (see constraints below).
2. `src/figma_plugin/src/registry/<domain>.js` — registry entry:
   ```js
   my_command: { lock: "read", handler: (params) => myCommand(params) },
   ```
   `lock` is the concurrency class: `"read"` (runs freely), `"global"` (serialized via global mutex — tree mutations, batch writes), `"node"` (locks by `params.nodeId` — single-node writes). The registry is the single source of truth; `main.js` dispatches from it and the remote entry shim (`src/figma_plugin/src/remote_entries/<domain>.js`) picks the new command up **automatically** — do not edit the shim.
3. `src/figmagent_mcp/remote/domains.ts` — add the command to `COMMAND_DOMAINS` (command → bundle domain). If it's a pure read, also add it to `REMOTE_READ_COMMANDS` (controls the atomic-retry suffix on remote errors).
4. `src/figmagent_mcp/types.ts` — add the wire name to the `FigmaCommand` union.
5. `tests/registry.test.ts` — add the wire name to `EXPECTED_COMMANDS`, and to `EXPECTED_READ` or `EXPECTED_GLOBAL` if its lock is `read`/`global` (anything not in those lists must be `node`). This test also asserts `COMMAND_DOMAINS` mirrors the registry — steps 2/3/5 fail loudly if they drift.
6. `src/figmagent_mcp/tools/<domain>.ts` — the MCP tool registration (or extend an existing tool's schema — folding an op into `edit`/`write` is often better than a new tool).
7. Run `bun run build:plugin` (regenerates `code.js`), `bun test`, `bun run check`.

**Files you do NOT edit**: `src/socket.ts` (relay), `src/figma_plugin/ui.html` (forwarder), `src/figma_plugin/src/remote_entries/<domain>.js` (auto-derived from the registry), `src/figma_plugin/code.js` (build artifact — never hand-edit).

New domain instead of new command? Also create `src/figma_plugin/src/registry/<newdomain>.js` + `src/figma_plugin/src/remote_entries/<newdomain>.js` (copy an existing shim, swap the import), register the domain in `src/figma_plugin/src/registry.js` (`DOMAINS`), and keep the bundle under 40KB (asserted in tests).

## Request/Response Lifecycle

Plugin transport:
1. **tools/<domain>.ts** handler calls `sendCommandToFigma(wireCommand, params)` (from `../connection.js`)
2. A UUID is generated, stored in `pendingRequests` with resolve/reject callbacks and a 30s timeout (extended when progress updates arrive)
3. Message → relay → plugin UI → `code.js`, which looks the command up in the registry, acquires the lock, runs the handler
4. Result (sanitized of `figma.mixed` symbols) flows back and resolves the promise by UUID

Remote transport: the same `sendCommandToFigma` call routes through `remote/executor.ts`, which prepends the domain's bundled IIFE, injects `params` as JSON, awaits `globalThis.__figmagent.<command>(params)` inside one `use_figma` script, and returns the JSON result. Scripts are atomic (a thrown error rolls back everything) and queue FIFO per fileKey. `sendProgressUpdate` is a no-op remotely.

**Critical**: the wire command string must match EXACTLY across `sendCommandToFigma("my_command")`, the registry key, `COMMAND_DOMAINS`, and `FigmaCommand`. Parameter shapes must agree between the Zod schema and the handler's destructuring — there is no shared schema, just convention (and tests).

## MCP tool registration template

```typescript
server.tool(
  "my_new_tool",                               // agent-facing name
  "Description — this is the source of truth the agent reads. State capabilities, call shapes, and constraints here, not in CLAUDE.md.",
  {
    nodeId: z.string().describe("The ID of the node to modify"),
    someValue: z.number().describe("A numeric value"),
  },
  async ({ nodeId, someValue }: any) => {
    try {
      const result = await sendCommandToFigma("my_new_tool", { nodeId, someValue });
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    } catch (error) {
      return {
        content: [
          { type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` },
        ],
      };
    }
  }
);
```

For write tools, append `formatWarningsBlock(result.warnings)` (from `../utils.js`) to surface post-write assertion warnings, and consider running `runPostWriteAssertions`/`miniLint` in the handler (see `commands/create.js` / `commands/apply.js` for the pattern).

## Handler constraints (both Figma VMs)

- **Async-first**: `await figma.getNodeByIdAsync(nodeId)`, never the sync version; `await page.loadAsync()` before touching another page's children.
- **No `?.`, no `??`, no object spread** (`{ ...obj }`) in `src/figma_plugin/src/` — the VMs reject them and Bun does not transpile them down. Use `Object.assign({}, obj)`. Array spread is fine. Biome enforces part of this.
- **Strict property guard**: the remote VM throws on reading properties that don't exist on a node type. Use `prop(node, "name")` (from `helpers.js`) for any duck-typed read at serializer/read boundaries.
- **Errors state fixes**: use `fail(message, fix)` from `helpers.js` — no user-facing error without a stated fix.
- **Font loading before text mutation**: `await figma.loadFontAsync(node.fontName)` before setting `.characters`; for mixed fonts use the existing `setCharacters()` from `setcharacters.js`.
- **Immutable property arrays**: clone-modify-reassign `.fills`/`.strokes`/`.effects` (`JSON.parse(JSON.stringify(...))`); never mutate in place.
- **Colors are 0–1 floats**, opacity separate.
- **Type-check before type-specific access**: `if (!("fills" in node)) fail(...)` or `if (node.type !== "TEXT") fail(...)`.
- **Return JSON-serializable values only** (no Figma objects; run results through `sanitizeSymbols` if they may contain `figma.mixed` — the registry shim and `routeCommand` do this for you on the standard paths).

## Batch/chunked pattern (10+ nodes)

Chunk with `CHUNK_SIZE = 5`: chunks sequential, items within a chunk parallel (`Promise.all`). Call `sendProgressUpdate(commandId, type, status, progress, total, processed, message)` per chunk — on the plugin path it resets the server-side inactivity timeout (30s → extended); remotely it's a harmless no-op. `params.commandId` is injected by `sendCommandToFigma`. Return `{ success, totalCount, successCount, failureCount, results }` with per-item success/error entries — batches continue past per-op failures.

See `setMultipleTextContents` in `commands/text.js` for the canonical implementation.

## Helpers available in `src/figma_plugin/src/`

| Helper (module) | Purpose |
|--------|---------|
| `prop(node, name)` (helpers) | Strict-guard property read — required for duck-typed reads on the remote VM |
| `fail(message, fix)` (helpers) | Throw an error that states its fix |
| `sendProgressUpdate(...)` (helpers) | Progress through the chain — required for batch ops on the plugin path |
| `loadFontWithFallback(family, weightOrStyle)` (helpers) | Font resolution with fallback chain (weight→style name→Inter Regular) |
| `setCharacters(node, text, options)` (setcharacters) | Font-safe text replacement (mixed fonts) |
| `sanitizeSymbols(obj)` (helpers) | Replace `figma.mixed` symbols with the string `"mixed"` |
| `toNumber(value, fallback)`, `rgbaToHex(color)`, `delay(ms)`, `generateCommandId()`, `findNodeByIdInTree(nodeId)`, `customBase64Encode(bytes)` (helpers) | Utilities |
| `runPostWriteAssertions(ctx)`, `checkNodes(nodeIds)` (assertions) | Post-write structural warnings (balloon, width collapse, FILL-not-applied, font fallback, overlaps) |
| `matchVariable(...)`, `miniLint(rawSets)` (commands/lint) | Write-time exact-match variable suggestions |

## Checklist

- [ ] Wire command string identical in tools/<domain>.ts, registry/<domain>.js, remote/domains.ts, types.ts
- [ ] Registry entry has the right `lock` (`read`/`global`/`node`)
- [ ] `tests/registry.test.ts` EXPECTED lists updated (EXPECTED_COMMANDS always; EXPECTED_READ/EXPECTED_GLOBAL per lock)
- [ ] `REMOTE_READ_COMMANDS` updated if the command is a pure read
- [ ] Handler takes a single params object; param names match the Zod schema
- [ ] No `?.`/`??`/object-spread; `prop()` for duck-typed reads; `fail(message, fix)` for errors
- [ ] Font loaded before text mutation (if applicable); node type/capability checked
- [ ] Batch operations chunked with `sendProgressUpdate()`
- [ ] Tool description carries the full agent-facing knowledge (descriptions are the source of truth, not CLAUDE.md)
- [ ] `bun run build:plugin` + `bun test` + `bun run check` all green
