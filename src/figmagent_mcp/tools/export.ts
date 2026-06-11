import { z } from "zod";
import { server } from "../instance.js";
import { sendCommandToFigma } from "../connection.js";

// Screenshot Tool — export a node as an image
server.tool(
  "screenshot",
  "Export a Figma node as an image (PNG/JPG/SVG/PDF). Use for visual spot-checks after building or modifying a design.",
  {
    nodeId: z.string().describe("The ID of the node to export"),
    format: z.enum(["PNG", "JPG", "SVG", "PDF"]).optional().describe("Export format"),
    scale: z.coerce.number().positive().optional().describe("Export scale"),
  },
  async ({ nodeId, format, scale }: any) => {
    try {
      const result = await sendCommandToFigma("export_node_as_image", {
        nodeId,
        format: format || "PNG",
        scale: scale || 1,
      });
      const typedResult = result as { imageData: string; mimeType: string };

      return {
        content: [
          {
            type: "image",
            data: typedResult.imageData,
            mimeType: typedResult.mimeType || "image/png",
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
