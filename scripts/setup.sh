#!/bin/bash

# Get the directory where this script lives, then resolve to repo root
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SERVER_PATH="$REPO_DIR/src/figmagent_mcp/server.ts"

MCP_CONFIG="{
  \"mcpServers\": {
    \"Figmagent\": {
      \"command\": \"bun\",
      \"args\": [
        \"$SERVER_PATH\"
      ]
    }
  }
}"

bun install

# Cursor: write .cursor/mcp.json (Cursor has no plugin system — needs an absolute path here)
mkdir -p .cursor
echo "$MCP_CONFIG" > .cursor/mcp.json
echo "✓ Cursor MCP config written to .cursor/mcp.json"

# Claude Code: the MCP server ships inside the Figmagent plugin (tracked .mcp.json at the
# repo root uses ${CLAUDE_PLUGIN_ROOT}). Install the plugin instead of writing a
# project-level .mcp.json — see README "Install as a Claude Code plugin".
echo "✓ Claude Code: install the Figmagent plugin (see README) — no project .mcp.json needed"
