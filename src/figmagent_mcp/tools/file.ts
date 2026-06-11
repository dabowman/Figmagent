import { z } from "zod";
import { server } from "../instance.js";
import { getTransport } from "../transport.js";
import { getRemoteClient } from "../remote/client.js";
import { setFileKey } from "../remote/filecontext.js";

// create_new_file — proxies the official MCP's tool and sets the file
// context so subsequent commands target the new file. Remote transport only:
// the plugin path operates on whatever file is open in the Figma client.
server.tool(
  "create_new_file",
  "Create a new blank Figma file and target it for subsequent commands. Remote transport only (FIGMA_TRANSPORT=remote). Files land in your drafts unless projectId is given. If planKey is omitted the server looks up your plans: with exactly one plan it proceeds, otherwise it returns the plan list to choose from.",
  {
    fileName: z.string().describe("Name for the new Figma file"),
    planKey: z
      .string()
      .optional()
      .describe('Team or organization key, e.g. "team::1234567890". Omit to auto-discover from your account.'),
    editorType: z.enum(["design", "figjam", "slides"]).optional().describe('File type. Default: "design"'),
    projectId: z.string().optional().describe("Project (folder) id to place the file in. Omit for drafts."),
  },
  async ({ fileName, planKey, editorType, projectId }: any) => {
    try {
      if (getTransport().name !== "remote") {
        return {
          content: [
            {
              type: "text",
              text: "create_new_file requires the remote transport. Set FIGMA_TRANSPORT=remote, or create the file manually in the Figma client on the plugin transport.",
            },
          ],
        };
      }

      const client = getRemoteClient();

      let resolvedPlanKey = planKey;
      if (!resolvedPlanKey) {
        const who = (await client.callOfficialTool("whoami", {})) as any;
        const plans = (who && (who.plans || who.teams)) || [];
        if (Array.isArray(plans) && plans.length === 1 && plans[0].key) {
          resolvedPlanKey = plans[0].key;
        } else if (Array.isArray(plans) && plans.length > 1) {
          const listing = plans.map((p: any) => `  • ${p.name || p.key}: ${p.key}`).join("\n");
          return {
            content: [
              {
                type: "text",
                text: `Multiple Figma plans found. Call create_new_file again with one of these planKey values:\n${listing}`,
              },
            ],
          };
        } else {
          return {
            content: [
              {
                type: "text",
                text: `Could not auto-discover a plan from whoami (got: ${JSON.stringify(who).slice(0, 300)}). Pass planKey explicitly (e.g. "team::1234567890").`,
              },
            ],
          };
        }
      }

      const result = (await client.callOfficialTool("create_new_file", {
        fileName,
        planKey: resolvedPlanKey,
        editorType: editorType || "design",
        ...(projectId ? { projectId } : {}),
      })) as any;

      // Extract the fileKey from the response (object field or URL in text)
      const resultText = typeof result === "string" ? result : JSON.stringify(result);
      const fileKey =
        (result && typeof result === "object" && (result.fileKey || result.key)) ||
        (resultText.match(/figma\.com\/(?:design|board|slides)\/([A-Za-z0-9]+)/) || [])[1];

      if (fileKey) {
        setFileKey(fileKey);
        return {
          content: [
            {
              type: "text",
              text: `Created file "${fileName}" (fileKey: ${fileKey}) and targeted it for subsequent commands.\n${resultText}`,
            },
          ],
        };
      }
      return {
        content: [
          {
            type: "text",
            text: `File created but no fileKey found in the response — pass its URL to use_file to target it.\n${resultText}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error creating file: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  },
);
