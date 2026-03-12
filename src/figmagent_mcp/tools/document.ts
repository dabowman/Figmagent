import { z } from "zod";
import { server } from "../instance.js";
import { sendCommandToFigma } from "../connection.js";
import { filterFigmaNode } from "../utils.js";

// ─── FSGN helpers (get_node_tree) ────────────────────────────────────────────

function serializeYaml(obj: unknown, indent = 0): string {
  const pad = "  ".repeat(indent);

  if (obj === null || obj === undefined) return "null";
  if (typeof obj === "boolean") return String(obj);
  if (typeof obj === "number") return String(obj);
  if (typeof obj === "string") {
    // Quote strings that contain YAML-significant characters or leading/trailing whitespace
    if (
      obj === "" ||
      /[:#[\]{},&*?|<>=!%@`"'\\]/.test(obj) ||
      obj.includes("\n") ||
      /^\s/.test(obj) ||
      /\s$/.test(obj)
    ) {
      return `"${obj.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
    }
    return obj;
  }

  if (Array.isArray(obj)) {
    if (obj.length === 0) return "[]";
    return obj
      .map((item) => {
        const valStr = serializeYaml(item, indent + 1);
        if (typeof item === "object" && item !== null && !Array.isArray(item)) {
          // Object items: put first property on same line as "- ", rest indented
          const lines = valStr.split("\n");
          const rest = lines.slice(1).join("\n");
          return `${pad}- ${lines[0].trimStart()}${rest ? "\n" + rest : ""}`;
        }
        return `${pad}- ${valStr}`;
      })
      .join("\n");
  }

  if (typeof obj === "object") {
    const entries = Object.entries(obj as Record<string, unknown>).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return "{}";
    return entries
      .map(([k, v]) => {
        const quotedKey = /[:#[\]{},&*?|<>=!%@`"'\s]/.test(k) ? `"${k}"` : k;
        if (v === null || v === undefined) return `${pad}${quotedKey}: null`;
        if (typeof v === "object" && !Array.isArray(v) && Object.keys(v as object).length > 0) {
          return `${pad}${quotedKey}:\n${serializeYaml(v, indent + 1)}`;
        }
        if (Array.isArray(v) && v.length > 0) {
          return `${pad}${quotedKey}:\n${serializeYaml(v, indent + 1)}`;
        }
        return `${pad}${quotedKey}: ${serializeYaml(v, indent)}`;
      })
      .join("\n");
  }

  return String(obj);
}

function replaceRefStr(
  str: string,
  varMap: Map<string, string>,
  styleMap: Map<string, string>,
  compMap: Map<string, string>,
): string {
  if (str.startsWith("VAR::")) return varMap.get(str.slice(5)) ?? str;
  if (str.startsWith("STYLE::")) return styleMap.get(str.slice(7)) ?? str;
  if (str.startsWith("COMP::")) return compMap.get(str.slice(6)) ?? str;
  return str;
}

function replaceRefs(
  obj: unknown,
  varMap: Map<string, string>,
  styleMap: Map<string, string>,
  compMap: Map<string, string>,
): void {
  if (!obj || typeof obj !== "object") return;
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      if (typeof obj[i] === "string") {
        obj[i] = replaceRefStr(obj[i] as string, varMap, styleMap, compMap);
      } else {
        replaceRefs(obj[i], varMap, styleMap, compMap);
      }
    }
  } else {
    const rec = obj as Record<string, unknown>;
    for (const key of Object.keys(rec)) {
      if (typeof rec[key] === "string") {
        rec[key] = replaceRefStr(rec[key] as string, varMap, styleMap, compMap);
      } else {
        replaceRefs(rec[key], varMap, styleMap, compMap);
      }
    }
  }
}

function buildFsgn(raw: any, params: any): string {
  const detail: string = params.detail ?? "layout";
  const depth: number | undefined = params.depth;

  const varMap = new Map<string, string>();
  const styleMap = new Map<string, string>();
  const compMap = new Map<string, string>();
  let vi = 1,
    si = 1,
    ci = 1;

  const defs: Record<string, Record<string, unknown>> = { vars: {}, styles: {}, components: {} };

  for (const [id, info] of Object.entries(raw.collectedVars ?? {})) {
    const ref = `v${vi++}`;
    varMap.set(id, ref);
    defs.vars[ref] = info as Record<string, unknown>;
  }
  for (const [id, info] of Object.entries(raw.collectedStyles ?? {})) {
    const ref = `s${si++}`;
    styleMap.set(id, ref);
    defs.styles[ref] = info as Record<string, unknown>;
  }
  for (const [id, info] of Object.entries(raw.collectedComponents ?? {})) {
    const ref = `c${ci++}`;
    compMap.set(id, ref);
    defs.components[ref] = info as Record<string, unknown>;
  }

  // Deep-clone rawTree before mutating refs
  const treeClone = JSON.parse(JSON.stringify(raw.rawTree ?? []));
  replaceRefs(treeClone, varMap, styleMap, compMap);

  const nodeCount: number = raw.nodeCount ?? 0;
  const defCount = vi - 1 + (si - 1) + (ci - 1);
  const tokenMultiplier = detail === "structure" ? 5 : detail === "full" ? 30 : 15;
  const tokenEstimate = nodeCount * tokenMultiplier + defCount * 10;
  const truncated = tokenEstimate > 8000;

  const meta: Record<string, unknown> = {
    nodeId: raw.rootId,
    name: raw.rootName,
    type: raw.rootType,
    detail,
    nodeCount,
    tokenEstimate,
  };
  if (depth !== undefined) meta.depth = depth;
  if (truncated) {
    meta.truncated = true;
    meta.truncationWarning =
      "Response exceeds 8000 token estimate. Consider narrowing with depth, filter, or detail=structure.";
  }
  if (raw.variantAxes && Object.keys(raw.variantAxes).length > 0) {
    meta.variantAxes = raw.variantAxes;
    if (raw.defaultVariant) meta.defaultVariant = raw.defaultVariant;
  }

  return serializeYaml({ meta, defs, nodes: treeClone });
}

// Document Info Tool
server.tool("get_document_info", "Get detailed information about the current Figma document", {}, async () => {
  try {
    const result = await sendCommandToFigma("get_document_info");
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: `Error getting document info: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
    };
  }
});

// Selection Tool
server.tool("get_selection", "Get information about the current selection in Figma", {}, async () => {
  try {
    const result = await sendCommandToFigma("get_selection");
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: `Error getting selection: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
    };
  }
});

// Read My Design Tool
server.tool(
  "read_my_design",
  "Get detailed information about the current selection in Figma, including all node details",
  {},
  async () => {
    try {
      const result = await sendCommandToFigma("read_my_design", {});
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error getting node info: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  },
);

// Node Info Tool
server.tool(
  "get_node_info",
  "Get detailed information about a specific node in Figma. Use depth to limit traversal for large nodes — depth=1 returns only immediate children (with childCount for deeper nodes), depth=2 goes two levels deep, etc. Omit depth for the full tree.",
  {
    nodeId: z.string().describe("The ID of the node to get information about"),
    depth: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe(
        "Maximum depth of children to include. Omit for full tree. Use 1-2 for large components to avoid token overflow.",
      ),
  },
  async ({ nodeId, depth }: any) => {
    try {
      const result = await sendCommandToFigma("get_node_info", { nodeId });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(filterFigmaNode(result, depth)),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error getting node info: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  },
);

// Nodes Info Tool
server.tool(
  "get_nodes_info",
  "Get detailed information about multiple nodes in Figma. Use depth to limit traversal for large nodes.",
  {
    nodeIds: z.array(z.string()).describe("Array of node IDs to get information about"),
    depth: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe(
        "Maximum depth of children to include. Omit for full tree. Use 1-2 for large components to avoid token overflow.",
      ),
  },
  async ({ nodeIds, depth }: any) => {
    try {
      const results = await Promise.all(
        nodeIds.map(async (nodeId: any) => {
          const result = await sendCommandToFigma("get_node_info", { nodeId });
          return { nodeId, info: result };
        }),
      );
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(results.map((result) => filterFigmaNode(result.info, depth))),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error getting nodes info: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  },
);

// Node Tree Tool
server.tool(
  "get_node_tree",
  `Returns a structured YAML tree of a Figma node and its descendants (FSGN format).

Use detail levels strategically:
  - "structure": IDs, names, types, child counts only (~5 tokens/node). Use first for orientation.
  - "layout": + dimensions, auto-layout, text content, componentRef/properties (~15 tokens/node). Use for building.
  - "full": + fills, strokes, variable bindings, text styles (~30 tokens/node). Use for styling.

Start with depth=3 for component internals. For large responses (tokenEstimate >8000), narrow with depth or filter.
Instances are shown as leaf nodes by default — call get_node_tree on the instance ID to expand its internals.
Prefer this over read_my_design (which returns raw JSON) and repeated get_node_info depth escalation.`,
  {
    nodeId: z.string().describe("The ID of the root node to traverse"),
    detail: z
      .enum(["structure", "layout", "full"])
      .optional()
      .describe(
        'Detail level. "structure": id/name/type/childCount only. "layout": + dimensions, auto-layout, text, component refs. "full": + fills, strokes, variable bindings, text styles. Default: "layout"',
      ),
    depth: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe(
        "Max traversal depth. Omit for unlimited (instances treated as leaf nodes). depth=0: root only. depth=1: root + children. depth=3 recommended for component internals.",
      ),
    filter: z
      .object({
        types: z
          .array(z.string())
          .optional()
          .describe(
            'Whitelist of node types to include (e.g. ["FRAME","TEXT"]). Container nodes are always traversed; non-matching nodes are excluded from output.',
          ),
        namePattern: z
          .string()
          .optional()
          .describe(
            "Regex matched against node name. Non-matching nodes excluded from output, containers still traversed.",
          ),
        visibleOnly: z.boolean().optional().describe("Skip invisible nodes. Default: true"),
      })
      .optional(),
    includeVariables: z
      .boolean()
      .optional()
      .describe("Resolve bound variable names and collections in defs.vars. Default: true"),
    includeStyles: z.boolean().optional().describe("Resolve named text/effect style IDs in defs.styles. Default: true"),
    includeComponentMeta: z
      .boolean()
      .optional()
      .describe("Include component key, parent info for instances in defs.components. Default: true"),
  },
  async (params: any) => {
    try {
      const result = await sendCommandToFigma("get_node_tree", params, 60000);
      const yaml = buildFsgn(result, params);
      return {
        content: [
          {
            type: "text",
            text: yaml,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error getting node tree: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  },
);
