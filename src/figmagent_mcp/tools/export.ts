import { z } from "zod";
import { server } from "../instance.js";
import { sendCommandToFigma } from "../connection.js";

type SingleExport = { imageData: string; mimeType: string };
type BatchExport = {
  batch: true;
  format: string;
  scale: number;
  images: Record<string, SingleExport>;
  errors?: Record<string, string>;
  truncated?: string[];
};

// Screenshot Tool — export one or many nodes as images
server.tool(
  "screenshot",
  "Export Figma node(s) as PNG image(s) for visual spot-checks after building or modifying a design. " +
    "Pass a single `nodeId` to export one node, OR a `nodeIds` array (max 20) to export many in one call — " +
    "the batch response interleaves a text marker (nodeId) before each image so results stay keyed by node. " +
    "Total payload is capped (~4MB); over-budget nodes are listed under `truncated` for a follow-up batch, " +
    "and per-node export failures are reported without failing the whole call.",
  {
    nodeId: z.string().optional().describe("The ID of a single node to export"),
    nodeIds: z
      .array(z.string())
      .max(20)
      .optional()
      .describe("Array of node IDs to export in one batch (max 20). Returns images keyed by nodeId."),
    format: z.enum(["PNG", "JPG", "SVG", "PDF"]).optional().describe("Export format"),
    scale: z.coerce.number().positive().optional().describe("Export scale"),
  },
  async ({ nodeId, nodeIds, format, scale }: any) => {
    if (!nodeId && (!nodeIds || nodeIds.length === 0)) {
      return {
        content: [{ type: "text", text: "Provide either nodeId (single) or nodeIds (array)." }],
        isError: true,
      };
    }

    try {
      // Batch mode
      if (nodeIds && nodeIds.length > 0) {
        const result = (await sendCommandToFigma("export_node_as_image", {
          nodeIds,
          format: format || "PNG",
          scale: scale || 1,
        })) as BatchExport;

        const content: Array<{ type: string; text?: string; data?: string; mimeType?: string }> = [];
        const ids = Object.keys(result.images || {});
        content.push({
          type: "text",
          text: `Exported ${ids.length} node(s): ${ids.join(", ") || "none"}`,
        });
        for (const id of ids) {
          const img = result.images[id];
          content.push({ type: "text", text: `nodeId: ${id}` });
          content.push({ type: "image", data: img.imageData, mimeType: img.mimeType || "image/png" });
        }
        if (result.errors && Object.keys(result.errors).length > 0) {
          content.push({
            type: "text",
            text: `Errors: ${JSON.stringify(result.errors)}`,
          });
        }
        if (result.truncated && result.truncated.length > 0) {
          content.push({
            type: "text",
            text: `Truncated (payload cap reached, re-request in a follow-up batch): ${result.truncated.join(", ")}`,
          });
        }
        return { content };
      }

      // Single mode (backward compatible)
      const result = (await sendCommandToFigma("export_node_as_image", {
        nodeId,
        format: format || "PNG",
        scale: scale || 1,
      })) as SingleExport;

      return {
        content: [
          {
            type: "image",
            data: result.imageData,
            mimeType: result.mimeType || "image/png",
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error exporting node as image: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  },
);
