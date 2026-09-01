import { z } from "zod";
import { server } from "../instance.js";
import { sendCommandToFigma } from "../connection.js";
import { normalizeNodeId } from "../utils.js";

type SingleExport = { imageData: string; mimeType: string };
type BatchExport = {
  batch: true;
  format: string;
  scale: number;
  images: Record<string, SingleExport>;
  errors?: Record<string, string>;
  truncated?: string[];
};

type ContentBlock = { type: string; text?: string; data?: string; mimeType?: string };

// Both remedies for an over-budget render, stated the same way everywhere so an
// agent hitting the failure always sees the same two escape routes.
const OVERSIZED_FIX =
  'Fix: re-request at a lower `scale` (e.g. scale: 0.5), or use `format: "SVG"` — vector output is far smaller ' +
  "than a raster render of a large board. Exporting a smaller child node instead of the whole board also works.";

function hasImageData(img: SingleExport | undefined): boolean {
  return !!img && typeof img.imageData === "string" && img.imageData.length > 0;
}

/**
 * BUG-016 — an image content block whose `data` is undefined is neither a valid
 * `text` nor `image` member, so the MCP SDK rejects the WHOLE tool result
 * (`invalid_union` at path ["type"], `expected string` at path ["data"]) and the
 * caller sees a protocol error instead of a diagnosable failure. That happened
 * on the remote transport whenever an oversized render came back without
 * `imageData` (`use_figma` JSON.stringify's the result with no size guard).
 * Never emit an image block unless the payload is a real, non-empty string.
 */
export function buildSingleExportResult(result: SingleExport | undefined | null, nodeId?: string) {
  if (!hasImageData(result as SingleExport)) {
    const target = nodeId ? ` for node ${nodeId}` : "";
    return {
      content: [
        {
          type: "text",
          text:
            `Error exporting node as image: the export${target} returned no image data. ` +
            "This usually means the rendered payload exceeded the ~4MB return cap. " +
            OVERSIZED_FIX,
        },
      ] as ContentBlock[],
      isError: true,
    };
  }
  const img = result as SingleExport;
  return {
    content: [
      {
        type: "image",
        data: img.imageData,
        mimeType: img.mimeType || "image/png",
      },
    ] as ContentBlock[],
  };
}

/**
 * Batch counterpart. Ids whose payload did not survive the round trip are
 * reported as text (same BUG-016 reasoning: no image block without data), and a
 * batch that exported nothing is an error regardless of whether the plugin also
 * reported per-node `errors` — zero images returned is a total failure however
 * it happened.
 */
export function buildBatchExportResult(result: BatchExport) {
  const images = result?.images || {};
  const allIds = Object.keys(images);
  const ids = allIds.filter((id) => hasImageData(images[id]));
  const dataless = allIds.filter((id) => !hasImageData(images[id]));

  const content: ContentBlock[] = [];
  content.push({
    type: "text",
    text: `Exported ${ids.length} node(s): ${ids.join(", ") || "none"}`,
  });
  for (const id of ids) {
    const img = images[id];
    content.push({ type: "text", text: `nodeId: ${id}` });
    content.push({ type: "image", data: img.imageData, mimeType: img.mimeType || "image/png" });
  }
  if (result?.errors && Object.keys(result.errors).length > 0) {
    content.push({
      type: "text",
      text: `Errors: ${JSON.stringify(result.errors)}`,
    });
  }
  if (dataless.length > 0) {
    content.push({
      type: "text",
      text: `Returned no image data (payload likely over the cap): ${dataless.join(", ")}. ${OVERSIZED_FIX}`,
    });
  }
  if (result?.truncated && result.truncated.length > 0) {
    content.push({
      type: "text",
      text: `Truncated (payload cap reached, re-request in a follow-up batch): ${result.truncated.join(", ")}`,
    });
  }
  // A batch that produced no usable image is a total failure — surface it so an
  // agent branching on isError doesn't read it as success.
  if (ids.length === 0) {
    return { content, isError: true };
  }
  return { content };
}

// Screenshot Tool — export one or many nodes as images
server.tool(
  "screenshot",
  "Export Figma node(s) as an image (PNG by default; JPG/SVG/PDF via `format`) for visual spot-checks after building or modifying a design. " +
    "Pass a single `nodeId` to export one node, OR a `nodeIds` array (max 20) to export many in one call (not both) — " +
    "the batch response interleaves a text marker (nodeId) before each image so results stay keyed by node; duplicate IDs are de-duped. " +
    "Total payload is capped (~4MB); over-budget nodes are listed under `truncated` for a follow-up batch, " +
    "and per-node export failures are reported without failing the whole call (a batch that exports nothing returns isError). " +
    "`scale` multiplies payload size roughly quadratically (scale 2 is ~4x the bytes of scale 1), so a large board can blow the cap " +
    'and fail with `isError` at every raster scale. When that happens the verified fallback is `format: "SVG"` ' +
    "(vector output is far smaller than a raster render of a whole board); exporting a smaller child node also works.",
  {
    nodeId: z.string().transform(normalizeNodeId).optional().describe("The ID of a single node to export"),
    nodeIds: z
      .array(z.string().transform(normalizeNodeId))
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

        return buildBatchExportResult(result);
      }

      // Single mode (backward compatible)
      const result = (await sendCommandToFigma("export_node_as_image", {
        nodeId,
        format: format || "PNG",
        scale: scale || 1,
      })) as SingleExport;

      return buildSingleExportResult(result, nodeId);
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error exporting node as image: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);
