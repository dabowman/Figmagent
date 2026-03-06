import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// Create MCP server (exported for tool/prompt registration)
export const server = new McpServer({
  name: "TalkToFigmaMCP",
  version: "1.0.0",
});
