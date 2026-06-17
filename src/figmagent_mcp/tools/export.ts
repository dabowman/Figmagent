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
  "Export Figma node(s) as an image (PNG by default; JPG/SVG/PDF via `format`) for visual spot-checks after building or modifying a design. " +
    "Pass a single `nodeId` to export one node, OR a `nodeIds` array (max 20) to export many in one call (not both) — " +
    "the batch response interleaves a text marker (nodeId) before each image so results stay keyed by node; duplicate IDs are de-duped. " +
    "Total payload is capped (~4MB); over-budget nodes are listed under `truncated` for a follow-up batch, " +
    "and per-node export failures are reported without failing the whole call (a batch where every node fails returns isError).",
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
    const hasBatch = Array.isArray(nodeIds) && nodeIds.length > 0;
    if (!nodeId && !hasBatch) {
      return {
        content: [{ type: "text", text: "Provide either nodeId (single) or nodeIds (array)." }],
        isError: true,
      };
    }
    if (nodeId && hasBatch) {
      return {
        content: [
          {
            type: "text",
            text: "Provide either nodeId (single) or nodeIds (array), not both — they are mutually exclusive.",
          },
        ],
        isError: true,
      };
    }

    try {
      // Batch mode
      if (hasBatch) {
        // De-dupe so the plugin's per-id keying stays 1:1; repeated IDs would
        // otherwise collapse to one key and misreport the exported count.
        const uniqueIds: string[] = [...new Set<string>(nodeIds)];
        const result = (await sendCommandToFigma("export_node_as_image", {
          nodeIds: uniqueIds,
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
        const hasErrors = !!(result.errors && Object.keys(result.errors).length > 0);
        if (hasErrors) {
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
        // A batch where every node failed exported nothing — surface it as an
        // error so an agent branching on isError doesn't read total failure as
        // success.
        if (ids.length === 0 && hasErrors) {
          return { content, isError: true };
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
