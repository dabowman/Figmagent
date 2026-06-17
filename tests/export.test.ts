// Issue #56 — batch export_node_as_image: single-node stays backward compatible,
// `nodeIds` array returns images keyed by nodeId with per-node errors and a
// payload cap (truncated list). Runs the plugin handler against a mocked figma.

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { exportNodeAsImage } from "../src/figma_plugin/src/commands/document.js";

let fakeNodes: Record<string, any>;

function makeExportableNode(id: string, byteLen: number) {
  return {
    id,
    type: "FRAME",
    name: id,
    exportAsync: async (_settings: any) => new Uint8Array(byteLen),
  };
}

function installFigmaMock() {
  (globalThis as any).figma = {
    getNodeByIdAsync: async (id: string) => fakeNodes[id] || null,
  };
}

beforeEach(() => {
  fakeNodes = {};
  installFigmaMock();
});

afterAll(() => {
  delete (globalThis as any).figma;
});

describe("exportNodeAsImage: single-node (backward compatible)", () => {
  test("exports one node and returns imageData/mimeType", async () => {
    fakeNodes["1:1"] = makeExportableNode("1:1", 30);
    const result = await exportNodeAsImage({ nodeId: "1:1" });
    expect(result.nodeId).toBe("1:1");
    expect(result.mimeType).toBe("image/png");
    expect(typeof result.imageData).toBe("string");
    expect(result.imageData.length).toBeGreaterThan(0);
    expect((result as any).batch).toBeUndefined();
  });

  test("missing nodeId throws", async () => {
    await expect(exportNodeAsImage({})).rejects.toThrow(/Missing nodeId/);
  });

  test("unknown node throws node-not-found", async () => {
    await expect(exportNodeAsImage({ nodeId: "9:9" })).rejects.toThrow(/Node not found/);
  });
});

describe("exportNodeAsImage: batch mode (nodeIds array)", () => {
  test("returns images keyed by nodeId", async () => {
    fakeNodes["1:1"] = makeExportableNode("1:1", 30);
    fakeNodes["2:2"] = makeExportableNode("2:2", 30);
    const result = await exportNodeAsImage({ nodeIds: ["1:1", "2:2"] });
    expect(result.batch).toBe(true);
    expect(Object.keys(result.images)).toEqual(["1:1", "2:2"]);
    expect(result.images["1:1"].mimeType).toBe("image/png");
    expect(typeof result.images["2:2"].imageData).toBe("string");
    expect(result.errors).toBeUndefined();
    expect(result.truncated).toBeUndefined();
  });

  test("per-node failure is reported in errors, batch continues", async () => {
    fakeNodes["1:1"] = makeExportableNode("1:1", 30);
    const result = await exportNodeAsImage({ nodeIds: ["1:1", "missing"] });
    expect(Object.keys(result.images)).toEqual(["1:1"]);
    expect(result.errors.missing).toMatch(/Node not found/);
  });

  test("empty array fails with a stated fix", async () => {
    await expect(exportNodeAsImage({ nodeIds: [] })).rejects.toThrow(/Fix:/);
  });

  test("over the node cap fails with a stated fix", async () => {
    const ids = Array.from({ length: 21 }, (_, i) => `n:${i}`);
    await expect(exportNodeAsImage({ nodeIds: ids })).rejects.toThrow(/max 20.*Fix:/s);
  });

  test("payload cap truncates remaining nodes", async () => {
    // base64 inflates ~4/3: each ~1.5MB raw node is ~2MB of base64 chars.
    // Cap is 4M chars, so nodes 1+2 fit (~4M) and node 3 is truncated.
    fakeNodes["1:1"] = makeExportableNode("1:1", 1_500_000);
    fakeNodes["2:2"] = makeExportableNode("2:2", 1_500_000);
    fakeNodes["3:3"] = makeExportableNode("3:3", 1_500_000);
    const result = await exportNodeAsImage({ nodeIds: ["1:1", "2:2", "3:3"] });
    expect(Object.keys(result.images)).toEqual(["1:1", "2:2"]);
    expect(result.truncated).toEqual(["3:3"]);
  });
});
