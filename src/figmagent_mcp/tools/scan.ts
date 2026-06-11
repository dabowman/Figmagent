import { z } from "zod";
import { server } from "../instance.js";
import { sendCommandToFigma } from "../connection.js";
import { joinChannel, discoverChannels } from "../connection.js";
import { getTransport } from "../transport.js";
import { setFileKey } from "../remote/filecontext.js";

// Get Reactions Tool
server.tool(
  "get_reactions",
  "Get Figma Prototyping Reactions from multiple nodes. CRITICAL: The output MUST be processed using the 'reaction_to_connector_strategy' prompt IMMEDIATELY to generate parameters for connector lines via the 'create_connections' tool.",
  {
    nodeIds: z.array(z.string()).min(1).describe("Array of node IDs to get reactions from"),
  },
  async ({ nodeIds }: any) => {
    try {
      const result = await sendCommandToFigma("get_reactions", { nodeIds });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result),
          },
          {
            type: "text",
            text: "IMPORTANT: You MUST now use the reaction data above and follow the `reaction_to_connector_strategy` prompt to prepare the parameters for the `create_connections` tool call. This is a required next step.",
          },
        ],
        followUp: {
          type: "prompt",
          prompt: "reaction_to_connector_strategy",
        },
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error getting reactions: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  },
);

// Set Default Connector Tool
server.tool(
  "set_default_connector",
  "Set a copied connector node as the default connector",
  {
    connectorId: z.string().optional().describe("The ID of the connector node to set as default"),
  },
  async ({ connectorId }: any) => {
    try {
      const result = await sendCommandToFigma("set_default_connector", {
        connectorId,
      });

      return {
        content: [
          {
            type: "text",
            text: `Default connector set: ${JSON.stringify(result)}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error setting default connector: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  },
);

// Connect Nodes Tool
server.tool(
  "create_connections",
  "Create connections between nodes using the default connector style",
  {
    connections: z
      .array(
        z.object({
          startNodeId: z.string().describe("ID of the starting node"),
          endNodeId: z.string().describe("ID of the ending node"),
          text: z.string().optional().describe("Optional text to display on the connector"),
        }),
      )
      .min(1)
      .describe("Array of node connections to create"),
  },
  async ({ connections }: any) => {
    try {
      if (!connections || connections.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "No connections provided",
            },
          ],
        };
      }

      const result = await sendCommandToFigma("create_connections", {
        connections,
      });

      return {
        content: [
          {
            type: "text",
            text: `Created ${connections.length} connections: ${JSON.stringify(result)}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error creating connections: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  },
);

// Set Focus Tool
server.tool(
  "set_focus",
  "Set focus on a specific node in Figma by selecting it and scrolling viewport to it",
  {
    nodeId: z.string().describe("The ID of the node to focus on"),
  },
  async ({ nodeId }: any) => {
    try {
      const result = await sendCommandToFigma("set_focus", { nodeId });
      const typedResult = result as { name: string; id: string };
      return {
        content: [
          {
            type: "text",
            text: `Focused on node "${typedResult.name}" (ID: ${typedResult.id})`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error setting focus: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  },
);

// Set Selections Tool
server.tool(
  "set_selections",
  "Set selection to multiple nodes in Figma and scroll viewport to show them",
  {
    nodeIds: z.array(z.string()).min(1).describe("Array of node IDs to select"),
  },
  async ({ nodeIds }: any) => {
    try {
      const result = await sendCommandToFigma("set_selections", { nodeIds });
      const typedResult = result as { selectedNodes: Array<{ name: string; id: string }>; count: number };
      return {
        content: [
          {
            type: "text",
            text: `Selected ${typedResult.count} nodes: ${typedResult.selectedNodes.map((node) => `"${node.name}" (${node.id})`).join(", ")}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error setting selections: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  },
);

// Use File Tool — select the Figma file to work in
server.tool(
  "use_file",
  "Select the Figma file to work in. On the plugin transport this joins a relay channel: with no argument it auto-discovers active channels and joins if exactly one is found; you usually don't need to call it — the server auto-joins on first command and auto-recovers on timeout. Call it explicitly when (1) auto-recovery fails after repeated timeouts, or (2) you need to switch between multiple open Figma files; named channels are validated against the relay and nonexistent ones return the available options. On the remote transport (FIGMA_TRANSPORT=remote) there are no channels — pass a Figma file URL (https://www.figma.com/design/<fileKey>/...) or a bare fileKey to select the target file.",
  {
    channel: z
      .string()
      .describe("Channel name (plugin transport) or Figma file URL / fileKey (remote transport)")
      .default(""),
  },
  async ({ channel }: any) => {
    try {
      if (getTransport().name === "remote") {
        if (!channel) {
          return {
            content: [
              {
                type: "text",
                text: "Remote transport selects files by fileKey, not channels. Pass a Figma file URL (e.g. https://www.figma.com/design/<fileKey>/...) or a bare fileKey.",
              },
            ],
          };
        }
        const fileKey = setFileKey(channel);
        return {
          content: [
            {
              type: "text",
              text: `Now targeting Figma file ${fileKey} on the remote transport.`,
            },
          ],
        };
      }
      if (!channel) {
        // Auto-discover: query relay for active channels
        try {
          const channels = await discoverChannels();
          const channelNames = Object.keys(channels);

          if (channelNames.length === 0) {
            return {
              content: [
                {
                  type: "text",
                  text: "No active channels found. Make sure the Figma plugin is running and connected to the relay.",
                },
              ],
            };
          }

          if (channelNames.length === 1) {
            // Exactly one channel — auto-join it
            channel = channelNames[0];
          } else {
            // Multiple channels — ask user to pick
            const listing = channelNames
              .map((name) => `  - ${name} (${channels[name].clientCount} client(s))`)
              .join("\n");
            return {
              content: [
                {
                  type: "text",
                  text: `Multiple active channels found. Please specify which one to join:\n${listing}`,
                },
              ],
            };
          }
        } catch (_discoveryError) {
          return {
            content: [
              {
                type: "text",
                text: `Could not auto-discover channels (is the relay running?). Please provide a channel name manually.`,
              },
            ],
          };
        }
      }

      // Validate that the requested channel actually exists on the relay
      try {
        const available = await discoverChannels();
        const availableNames = Object.keys(available);
        if (availableNames.length > 0 && !availableNames.includes(channel)) {
          const listing = availableNames
            .map((name) => `  - ${name} (${available[name].clientCount} client(s))`)
            .join("\n");
          return {
            content: [
              {
                type: "text",
                text: `Channel "${channel}" does not exist on the relay. Available channels:\n${listing}`,
              },
            ],
          };
        }
      } catch (_) {
        // Relay unreachable — try joining anyway, the relay's join handler will create it
      }

      await joinChannel(channel);
      return {
        content: [
          {
            type: "text",
            text: `Successfully joined channel: ${channel}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error joining channel: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  },
);
