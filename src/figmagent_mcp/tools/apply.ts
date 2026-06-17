import { z } from "zod";
import { server } from "../instance.js";
import { sendCommandToFigma } from "../connection.js";
import { formatWarningsBlock } from "../utils.js";

// Color schema shared across fill/stroke/font
const colorSchema = z
  .object({
    r: z.number().min(0).max(1).describe("Red (0-1)"),
    g: z.number().min(0).max(1).describe("Green (0-1)"),
    b: z.number().min(0).max(1).describe("Blue (0-1)"),
    a: z.number().min(0).max(1).optional().describe("Alpha (0-1)"),
  })
  .optional();

// Variable binding fields — matches FIELD_MAP in the plugin
const variableFieldEnum = z.enum([
  "fill",
  "stroke",
  "opacity",
  "cornerRadius",
  "topLeftRadius",
  "topRightRadius",
  "bottomLeftRadius",
  "bottomRightRadius",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "itemSpacing",
  "counterAxisSpacing",
  "width",
  "height",
  "minWidth",
  "maxWidth",
  "minHeight",
  "maxHeight",
  "visible",
  "characters",
  "fontSize",
  "fontFamily",
  "fontStyle",
  "lineHeight",
  "letterSpacing",
  "paragraphSpacing",
  "paragraphIndent",
]);

// Recursive node operation schema (exported for tests)
export const nodeOpSchema: z.ZodType<any> = z.lazy(() =>
  z
    .object({
      nodeId: z.string().describe("ID of the existing node to modify"),

      // Structural operations
      x: z.number().optional().describe("New X position (moves the node; does NOT change parent)"),
      y: z.number().optional().describe("New Y position (moves the node; does NOT change parent)"),
      name: z.string().optional().describe("Rename the node (e.g. variant names like 'Size=MD, State=Default')"),
      index: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe("Reorder the node to this index within its current parent (0 = bottom-most layer; clamped to range)"),
      characters: z
        .string()
        .optional()
        .describe(
          "Set text content (TEXT nodes only). Font-safe — handles mixed fonts. For text inside instances use the path format I<instanceId>;<textNodeId> (nested instances: I<outerInstanceId>;<innerInstanceId>;<textNodeId>). Discover text node IDs with grep({ scope: componentId, type: ['TEXT'] }).",
        ),
      delete: z
        .boolean()
        .optional()
        .describe(
          "true = delete the node. Always runs LAST after all other ops on this node. Do not combine with ops on the node's children in the same call.",
        ),

      // Visual properties (direct values)
      fillColor: colorSchema.describe("Fill color (also sets font color on TEXT nodes)"),
      strokeColor: colorSchema.describe("Stroke color"),
      strokeWeight: z.number().positive().optional().describe("Stroke weight"),
      cornerRadius: z.number().min(0).optional().describe("Corner radius"),
      opacity: z.number().min(0).max(1).optional().describe("Node opacity (0-1)"),
      clipsContent: z
        .boolean()
        .optional()
        .describe("Clip content (frames only). true = overflow hidden, false = overflow visible."),
      width: z.number().positive().optional().describe("Width (resizes the node)"),
      height: z.number().positive().optional().describe("Height (resizes the node)"),

      // Font properties (TEXT nodes only — loads fonts automatically)
      fontFamily: z.string().optional().describe("Font family (e.g. 'Inter', 'Space Grotesk'). TEXT nodes only."),
      fontWeight: z
        .number()
        .optional()
        .describe("Font weight (100-900, e.g. 400=Regular, 600=Semi Bold, 700=Bold). TEXT nodes only."),
      fontSize: z.number().positive().optional().describe("Font size in pixels. TEXT nodes only."),
      fontColor: colorSchema.describe("Font color (convenience alias for fillColor on TEXT nodes)."),
      textAutoResize: z
        .enum(["NONE", "WIDTH_AND_HEIGHT", "HEIGHT", "TRUNCATE"])
        .optional()
        .describe("How the text box adjusts to fit content. HEIGHT is required for FILL sizing. TEXT nodes only."),
      textTruncation: z
        .enum(["DISABLED", "ENDING"])
        .optional()
        .describe("Ellipsis truncation when text overflows. ENDING adds '...' at the end. TEXT nodes only."),
      maxLines: z
        .number()
        .positive()
        .optional()
        .describe("Max lines before truncation. Requires textTruncation: ENDING. TEXT nodes only."),

      // Layout properties
      layoutMode: z.enum(["NONE", "HORIZONTAL", "VERTICAL"]).optional().describe("Auto-layout direction"),
      layoutWrap: z.enum(["NO_WRAP", "WRAP"]).optional().describe("Whether auto-layout wraps children"),
      paddingTop: z.number().optional(),
      paddingRight: z.number().optional(),
      paddingBottom: z.number().optional(),
      paddingLeft: z.number().optional(),
      primaryAxisAlignItems: z.enum(["MIN", "MAX", "CENTER", "SPACE_BETWEEN"]).optional(),
      counterAxisAlignItems: z.enum(["MIN", "MAX", "CENTER", "BASELINE"]).optional(),
      layoutSizingHorizontal: z.enum(["FIXED", "HUG", "FILL"]).optional(),
      layoutSizingVertical: z.enum(["FIXED", "HUG", "FILL"]).optional(),
      itemSpacing: z.number().optional().describe("Spacing between children"),
      counterAxisSpacing: z.number().optional().describe("Spacing between wrapped rows/columns (requires WRAP)"),

      // Design token variable bindings
      variables: z
        .record(variableFieldEnum, z.string())
        .optional()
        .describe(
          "Map of field names to variable IDs. Binds design tokens to node properties. Fields: fill, stroke, cornerRadius, padding*, itemSpacing, width, height, opacity, visible, characters, fontSize, fontFamily, fontStyle, lineHeight, letterSpacing, paragraphSpacing, paragraphIndent.",
        ),

      // Component operations (INSTANCE nodes only)
      swapVariantId: z
        .string()
        .optional()
        .describe(
          "Swap an INSTANCE to a different variant. Value is the COMPONENT node ID to swap to. Instance keeps position and compatible overrides.",
        ),
      isExposedInstance: z
        .boolean()
        .optional()
        .describe(
          "Set isExposedInstance on a nested INSTANCE inside a COMPONENT. Surfaces the instance's properties at the parent level.",
        ),
      componentProperties: z
        .record(z.string(), z.union([z.boolean(), z.string()]))
        .optional()
        .describe(
          "Set component-property VALUES on an existing INSTANCE (maps to instance.setProperties). NOTE: this is the opposite direction of the separate component_properties tool, which DEFINES property definitions on a main COMPONENT — same words, different target and direction. Supports BOOLEAN (true/false), VARIANT (option string e.g. 'Small'), TEXT (string), and INSTANCE_SWAP (target COMPONENT/COMPONENT_SET node ID string) properties. Keys are property names. BOOLEAN/TEXT/INSTANCE_SWAP names carry an id suffix like 'Actions?#123:4'; VARIANT names are bare (e.g. 'Size'). A bare name without the suffix is matched leniently to the unique definition when unambiguous. Unknown or ambiguous names fail with the fix; an invalid VARIANT option fails with the valid options listed (validated against the main component's definitions); an INSTANCE_SWAP value that is not a real COMPONENT/COMPONENT_SET node id fails with the fix. Read the instance to discover exact keys. Example: { 'Actions?': false, 'Size': 'Small' }.",
        ),

      // Style references
      textStyleId: z
        .string()
        .optional()
        .describe("Text style ID to apply (from get_design_system). Loads fonts automatically."),
      effectStyleId: z
        .string()
        .optional()
        .describe("Effect style ID to apply (from get_design_system). Applies drop shadows, inner shadows, blurs."),

      // Nested children — apply to child nodes in the same call
      children: z
        .array(z.lazy(() => nodeOpSchema))
        .optional()
        .describe("Child node operations — apply properties to nested nodes in one call"),
    })
    .superRefine((op, ctx) => {
      // Boundary validation: deleting a node and editing its children in the
      // same call is contradictory — the children go down with the node.
      if (op.delete === true && Array.isArray(op.children) && op.children.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `delete: true on ${op.nodeId} cannot be combined with children ops — the children are deleted with the node. Fix: drop the children entries, or split the edits into a call before the delete.`,
        });
      }
    }),
);

// Edit Tool — unified modification of existing nodes
server.tool(
  "edit",
  `Edit one or more existing Figma nodes: visual properties, font properties, text content, layout, position, name, stacking order, design token variables, styles, component operations, and deletion.

Handles fill color, stroke, corner radius, opacity, width, height, x/y position, rename, reorder (index), text content (characters), font family/weight/size/color, layout mode, padding, alignment, sizing, spacing, variable bindings, text style application, variant swapping (swapVariantId), exposed instances (isExposedInstance), component-property values on instances (componentProperties), and deletion (delete: true).

For a single node:
  { nodes: [{ nodeId: "123", fillColor: { r: 1, g: 0, b: 0 } }] }

For multiple nodes:
  { nodes: [
    { nodeId: "123", cornerRadius: 8, variables: { fill: "VariableID:abc" } },
    { nodeId: "456", textStyleId: "S:style123," }
  ]}

Move, rename, reorder, set text, delete:
  { nodes: [
    { nodeId: "a", x: 100, y: 200 },
    { nodeId: "b", name: "Size=MD, State=Hover" },
    { nodeId: "c", index: 0 },
    { nodeId: "d", characters: "New label text" },
    { nodeId: "e", delete: true }
  ]}

Set text inside an instance (instance text override path format):
  { nodes: [{ nodeId: "I123:4;56:7", characters: "Override text" }] }

Change fonts on existing TEXT nodes (never delete and recreate text just to change font):
  { nodes: [
    { nodeId: "title", fontFamily: "Space Grotesk", fontWeight: 700, fontSize: 32, textAutoResize: "HEIGHT" },
    { nodeId: "body", fontFamily: "Inter", fontWeight: 400, fontSize: 15, fontColor: { r: 0.3, g: 0.3, b: 0.3 }, textTruncation: "ENDING", maxLines: 3 }
  ]}

For nested structures (mirrors write tool pattern):
  { nodes: [{ nodeId: "parent", layoutMode: "VERTICAL", paddingTop: 16, children: [
    { nodeId: "child1", variables: { fill: "VariableID:abc" } },
    { nodeId: "child2", textStyleId: "S:style123," }
  ]}]}

Swap an instance to a different variant (keeps position and compatible overrides):
  { nodes: [{ nodeId: "instance1", swapVariantId: "targetComponentId" }] }

Expose a nested instance's properties at the parent component level:
  { nodes: [{ nodeId: "nestedInstance", isExposedInstance: true }] }

Set component-property values on an instance (toggle a BOOLEAN, pick a VARIANT, swap an INSTANCE_SWAP, set a TEXT property):
  { nodes: [{ nodeId: "instance1", componentProperties: { "Actions?": false, "Size": "Small" } }] }

Execution order per node: component ops (swapVariantId/isExposedInstance/componentProperties) → layout mode → rename/move/reorder → direct values → font properties → characters → variable bindings → text style → effect style → delete last.
Variable bindings override direct values (set both to get a fallback + token).
x/y move the node but do NOT change its parent. To reparent: write({ fromNodeId, parentId: newParent }) then edit with delete: true on the original.
Width and height resize the node. Use variables.width/height to bind dimension tokens.
Font properties load fonts automatically. fontColor is a convenience alias for fillColor on TEXT nodes.
Effect styles apply drop shadows, inner shadows, and blurs from the design system.
Colors use RGBA 0-1 range (e.g. { r: 0.2, g: 0.4, b: 1.0 }), not 0-255.

IMPORTANT: Bind variables and text styles on COMPONENT nodes, not instances — bindings propagate from component to all instances automatically.`,
  {
    nodes: z
      .array(nodeOpSchema)
      .min(1)
      .describe("Array of node operations — flat list or nested tree of property applications"),
  },
  async ({ nodes }: any) => {
    try {
      const result = await sendCommandToFigma("apply", { nodes }, 60000);
      const typedResult = result as {
        success: boolean;
        totalNodes: number;
        successCount: number;
        failureCount: number;
        results: Array<{ success: boolean; nodeId: string; nodeName?: string; error?: string }>;
        warnings?: unknown[];
      };

      const failed = typedResult.results.filter((r) => !r.success);
      const summary: any = {
        success: typedResult.success,
        nodesEdited: typedResult.successCount,
        totalNodes: typedResult.totalNodes,
      };
      if (failed.length > 0) {
        summary.failures = failed.map((f) => ({ nodeId: f.nodeId, error: f.error }));
      }

      return {
        // #60: a batch where the verdict is failure (every op failed, or the
        // plugin reported success:false) must carry is_error — the JSON summary
        // starts with "{" and the central text matcher can't see the verdict.
        isError: typedResult.success === false || (typedResult.successCount === 0 && typedResult.totalNodes > 0),
        content: [
          {
            type: "text",
            text: JSON.stringify(summary) + formatWarningsBlock(typedResult.warnings),
          },
        ],
      };
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Error editing nodes: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  },
);
