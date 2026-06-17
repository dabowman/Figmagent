// Task 3.2 fold: the `edit` MCP tool's per-node op schema accepts the folded
// structural fields (x/y move, name rename, index reorder, characters text,
// delete) alongside the original property fields. All ops route over the
// existing `apply` wire command — wire protocol unchanged (see registry.test.ts).

import { describe, expect, test } from "bun:test";
import { nodeOpSchema } from "../src/figmagent_mcp/tools/apply.js";

describe("edit node-op schema (folded ops)", () => {
  test("accepts move/rename/reorder/characters/delete fields", () => {
    const op = {
      nodeId: "12:34",
      x: 100,
      y: -20,
      name: "Size=MD, State=Hover",
      index: 0,
      characters: "New label",
      delete: true,
    };
    const parsed = nodeOpSchema.parse(op);
    expect(parsed.x).toBe(100);
    expect(parsed.y).toBe(-20);
    expect(parsed.name).toBe("Size=MD, State=Hover");
    expect(parsed.index).toBe(0);
    expect(parsed.characters).toBe("New label");
    expect(parsed.delete).toBe(true);
  });

  test("accepts instance text override path in nodeId with characters", () => {
    const parsed = nodeOpSchema.parse({ nodeId: "I123:4;56:7", characters: "Override" });
    expect(parsed.nodeId).toBe("I123:4;56:7");
  });

  test("still accepts the original property fields", () => {
    const parsed = nodeOpSchema.parse({
      nodeId: "1:2",
      fillColor: { r: 0.2, g: 0.4, b: 1 },
      cornerRadius: 8,
      variables: { fill: "VariableID:abc" },
      children: [{ nodeId: "1:3", textStyleId: "S:xyz," }],
    });
    expect(parsed.children.length).toBe(1);
  });

  test("rejects negative reorder index and non-string characters", () => {
    expect(() => nodeOpSchema.parse({ nodeId: "1:2", index: -1 })).toThrow();
    expect(() => nodeOpSchema.parse({ nodeId: "1:2", characters: 42 })).toThrow();
  });
});
