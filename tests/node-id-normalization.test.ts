// [TOOL-022] Figma deep-link URLs encode node IDs with a hyphen (?node-id=43-14);
// the Plugin API wants a colon (43:14). An agent copying an ID out of a URL the
// user pasted got a bare "Node not found" and burned a round-trip — while
// `use_file`, two calls earlier in the same session, accepted the full hyphenated
// URL verbatim. One ID format, accepted by one tool and rejected by the next.
//
// Normalizing at the schema boundary via `nodeIdParam()` means no handler body and
// no wire command changes, so both transports pick it up.
//
// The second describe block is the regression guard that matters: the first pass
// applied the transform by hand and missed fifteen node-ID params — including
// `grep`'s componentId, where an unconverted id matches nothing and returns an
// empty result set instead of an error. The sweep fails if a node-ID param is
// ever added without the shared schema.

import { describe, expect, test } from "bun:test";
import type { z } from "zod";
import { normalizeNodeId } from "../src/figmagent_mcp/utils.js";
import { server } from "../src/figmagent_mcp/instance.js";
import { nodeOpSchema } from "../src/figmagent_mcp/tools/apply.js";
import { nodeSpecSchema } from "../src/figmagent_mcp/tools/create.js";
import "../src/figmagent_mcp/tools/document.js";
import "../src/figmagent_mcp/tools/components.js";
import "../src/figmagent_mcp/tools/export.js";
import "../src/figmagent_mcp/tools/scan.js";
import "../src/figmagent_mcp/tools/find.js";
import "../src/figmagent_mcp/tools/libraries.js";
import "../src/figmagent_mcp/tools/comments.js";
import "../src/figmagent_mcp/tools/lint.js";

describe("normalizeNodeId: converts only the unambiguous URL form", () => {
  test("the URL form becomes colon form", () => {
    expect(normalizeNodeId("43-14")).toBe("43:14");
    expect(normalizeNodeId("0-1")).toBe("0:1");
    expect(normalizeNodeId("1234-5678")).toBe("1234:5678");
  });

  test("an already-correct ID is untouched", () => {
    expect(normalizeNodeId("43:14")).toBe("43:14");
    expect(normalizeNodeId("0:0")).toBe("0:0");
  });

  test("a colon-form instance-descendant path is left alone", () => {
    // These already carry colons and semicolons; a blind hyphen swap would corrupt
    // any that contain one.
    expect(normalizeNodeId("I103:1135;66:19")).toBe("I103:1135;66:19");
    expect(normalizeNodeId("I103:1135;I66:19;12:3")).toBe("I103:1135;I66:19;12:3");
  });

  test("a URL-form instance-descendant path is converted", () => {
    // A link to a layer inside an instance hyphenates every segment. Such a string
    // is never a valid Plugin API id (those use colons), so the swap is lossless.
    expect(normalizeNodeId("I43-14;66-19")).toBe("I43:14;66:19");
    expect(normalizeNodeId("I103-1135;I66-19;12-3")).toBe("I103:1135;I66:19;12:3");
  });

  test("a half-converted path is not a URL id and is left alone", () => {
    expect(normalizeNodeId("I103:1135;66-19")).toBe("I103:1135;66-19");
  });

  test("non-ID strings pass through — including grep's DOCUMENT scope keyword", () => {
    expect(normalizeNodeId("DOCUMENT")).toBe("DOCUMENT");
    expect(normalizeNodeId("abc-def")).toBe("abc-def");
    expect(normalizeNodeId("Card-Header")).toBe("Card-Header");
    expect(normalizeNodeId("")).toBe("");
  });

  test("only a two-segment id qualifies — 3-segment forms are not IDs", () => {
    expect(normalizeNodeId("1-2-3")).toBe("1-2-3");
  });

  test("a mixed form is not a URL id and is left alone", () => {
    expect(normalizeNodeId("43:14-2")).toBe("43:14-2");
  });
});

// Param names that carry a Figma node ID. A tool param with one of these names
// must accept the URL form; anything else (componentKey, variableId, styleId,
// fileKey, collectionId) is a different namespace and must NOT be rewritten.
const NODE_ID_PARAMS = [
  "nodeId",
  "nodeIds",
  "parentId",
  "parentNodeId",
  "fromNodeId",
  "componentId",
  "componentIds",
  "targetNodeId",
  "targetNodeIds",
  "sourceInstanceId",
  "connectorId",
  "startNodeId",
  "endNodeId",
  "scope",
  "swapVariantId",
  "componentSetNodeId",
  "componentSetNodeIds",
];

/** True when the schema accepts the URL form (scalar or array) and normalizes it. */
function normalizesUrlForm(schema: z.ZodTypeAny): boolean {
  const scalar = schema.safeParse("43-14");
  if (scalar.success) return scalar.data === "43:14";
  const array = schema.safeParse(["43-14"]);
  if (array.success) return Array.isArray(array.data) && array.data[0] === "43:14";
  return false;
}

describe("every registered node-ID param normalizes the URL form", () => {
  const registered = (server as any)._registeredTools as Record<string, { inputSchema?: any }>;

  test("the tool registry is populated (guards against a vacuous sweep)", () => {
    expect(Object.keys(registered).length).toBeGreaterThan(20);
  });

  test("no top-level node-ID param is left un-normalized", () => {
    const missed: string[] = [];
    for (const [toolName, tool] of Object.entries(registered)) {
      const shape = tool.inputSchema?.shape;
      if (!shape) continue;
      for (const param of NODE_ID_PARAMS) {
        if (shape[param] && !normalizesUrlForm(shape[param])) missed.push(`${toolName}.${param}`);
      }
    }
    expect(missed).toEqual([]);
  });
});

describe("nested node-ID params are normalized too", () => {
  test("edit: nodeId, children, and swapVariantId", () => {
    const parsed = nodeOpSchema.parse({
      nodeId: "1-2",
      swapVariantId: "5-6",
      children: [{ nodeId: "3-4" }],
    });
    expect(parsed.nodeId).toBe("1:2");
    expect(parsed.swapVariantId).toBe("5:6");
    expect(parsed.children[0].nodeId).toBe("3:4");
  });

  test("edit leaves an instance-override path intact", () => {
    expect(nodeOpSchema.parse({ nodeId: "I103:1135;66:19" }).nodeId).toBe("I103:1135;66:19");
  });

  test("write: an INSTANCE spec's componentId", () => {
    expect(nodeSpecSchema.parse({ type: "INSTANCE", componentId: "43-14" }).componentId).toBe("43:14");
  });

  test("component_properties: operations[].targetNodeId", () => {
    const shape = (server as any)._registeredTools["component_properties"].inputSchema.shape;
    const parsed = shape.operations.parse([{ action: "bind", propertyName: "Label#1:2", targetNodeId: "43-14" }]);
    expect(parsed[0].targetNodeId).toBe("43:14");
  });

  test("set_multiple_annotations: annotations[].nodeId", () => {
    const shape = (server as any)._registeredTools["set_multiple_annotations"].inputSchema.shape;
    const parsed = shape.annotations.parse([{ nodeId: "43-14", labelMarkdown: "note" }]);
    expect(parsed[0].nodeId).toBe("43:14");
  });

  test("import_library_components: components[].parentNodeId", () => {
    const shape = (server as any)._registeredTools["import_library_components"].inputSchema.shape;
    const parsed = shape.components.parse([{ componentKey: "abc", parentNodeId: "43-14" }]);
    expect(parsed[0].parentNodeId).toBe("43:14");
  });

  test("create_connections: startNodeId and endNodeId", () => {
    const shape = (server as any)._registeredTools["create_connections"].inputSchema.shape;
    const parsed = shape.connections.parse([{ startNodeId: "1-2", endNodeId: "3-4" }]);
    expect(parsed[0].startNodeId).toBe("1:2");
    expect(parsed[0].endNodeId).toBe("3:4");
  });
});

describe("adjacent ID namespaces are never rewritten", () => {
  test("a TEXT component-property default value keeps its hyphen", () => {
    // "2026-2027" matches the URL-id shape but is a caption, not a node id —
    // componentProperties values are deliberately left alone.
    const parsed = nodeOpSchema.parse({ nodeId: "1-2", componentProperties: { Year: "2026-2027" } });
    expect(parsed.componentProperties.Year).toBe("2026-2027");
  });
});
