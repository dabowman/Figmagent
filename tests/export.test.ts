// Issue #56 — batch export_node_as_image: single-node stays backward compatible,
// `nodeIds` array returns images keyed by nodeId with per-node errors and a
// payload cap (truncated list). Runs the plugin handler against a mocked figma.
//
// BUG-016 — the payload cap now also applies to single-node mode, and the MCP
// layer never emits an image content block without real `data` (an undefined
// `data` made the SDK reject the whole tool result with `invalid_union`).

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { exportNodeAsImage } from "../src/figma_plugin/src/commands/document.js";
import { buildBatchExportResult, buildSingleExportResult } from "../src/figmagent_mcp/tools/export.js";

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

  test("cap is a ceiling: a node that would overshoot is truncated, not appended", async () => {
    // Node 1 ~2.67M base64 chars, node 2 ~2.67M — together ~5.3M > 4M cap.
    // After-export check truncates node 2 instead of letting the total overshoot.
    fakeNodes["1:1"] = makeExportableNode("1:1", 2_000_000);
    fakeNodes["2:2"] = makeExportableNode("2:2", 2_000_000);
    const result = await exportNodeAsImage({ nodeIds: ["1:1", "2:2"] });
    expect(Object.keys(result.images)).toEqual(["1:1"]);
    expect(result.truncated).toEqual(["2:2"]);
    expect(result.images["1:1"].imageData.length).toBeLessThanOrEqual(4_000_000);
  });

  test("a single oversized first node is still returned (never empty)", async () => {
    // 5MB raw → ~6.7M base64 chars, larger than the whole 4M cap, but it is
    // the first image so it is returned rather than silently producing nothing.
    fakeNodes["1:1"] = makeExportableNode("1:1", 5_000_000);
    const result = await exportNodeAsImage({ nodeIds: ["1:1"] });
    expect(Object.keys(result.images)).toEqual(["1:1"]);
    expect(result.truncated).toBeUndefined();
  });

  test("a non-Error thrown value is stored as a string (no undefined)", async () => {
    fakeNodes["1:1"] = makeExportableNode("1:1", 30);
    fakeNodes["bad"] = {
      id: "bad",
      type: "FRAME",
      name: "bad",
      // Simulate a Figma-internal rejection with a non-Error value (no .message).
      exportAsync: () => Promise.reject("kaboom"),
    };
    const result = await exportNodeAsImage({ nodeIds: ["1:1", "bad"] });
    expect(Object.keys(result.images)).toEqual(["1:1"]);
    expect(result.errors.bad).toBe("kaboom");
  });
});

// ─── BUG-016: single-node payload cap (plugin side) ─────────────────────────

describe("exportNodeAsImage: single-node payload cap (BUG-016)", () => {
  test("an oversized single-node render fails instead of returning an uncapped payload", async () => {
    // 5MB raw → ~6.7M base64 chars, past the 4M-char ceiling.
    fakeNodes["1:1"] = makeExportableNode("1:1", 5_000_000);
    await expect(exportNodeAsImage({ nodeId: "1:1" })).rejects.toThrow(/too large to return/);
  });

  test("the failure names both remedies: lower scale and SVG", async () => {
    fakeNodes["1:1"] = makeExportableNode("1:1", 5_000_000);
    let message = "";
    try {
      await exportNodeAsImage({ nodeId: "1:1" });
    } catch (err: any) {
      message = err.message;
    }
    expect(message).toMatch(/Fix:/);
    expect(message).toMatch(/scale/);
    expect(message).toMatch(/SVG/);
  });

  test("a render inside the cap still returns imageData", async () => {
    // 1.5MB raw → ~2M base64 chars, well under the ceiling.
    fakeNodes["1:1"] = makeExportableNode("1:1", 1_500_000);
    const result = await exportNodeAsImage({ nodeId: "1:1" });
    expect(typeof result.imageData).toBe("string");
    expect(result.imageData.length).toBeLessThanOrEqual(4_000_000);
  });

  test("batch mode keeps truncating (the cap is not inherited as a throw)", async () => {
    // Same oversized node that fails in single mode is still returned by a
    // batch — batch has its own ceiling logic and reports `truncated`.
    fakeNodes["1:1"] = makeExportableNode("1:1", 5_000_000);
    const result = await exportNodeAsImage({ nodeIds: ["1:1"] });
    expect(Object.keys(result.images)).toEqual(["1:1"]);
    expect(result.errors).toBeUndefined();
  });
});

// ─── BUG-016: MCP result shape guards (server side) ─────────────────────────

function imageBlocks(content: Array<{ type: string; data?: string }>) {
  return content.filter((c) => c.type === "image");
}

describe("buildSingleExportResult (BUG-016)", () => {
  test("returns an image block when imageData is present", () => {
    const r = buildSingleExportResult({ imageData: "AAAA", mimeType: "image/png" }, "1:1");
    expect(r.isError).toBeUndefined();
    expect(r.content).toEqual([{ type: "image", data: "AAAA", mimeType: "image/png" }]);
  });

  test("defaults the mimeType when the plugin omits it", () => {
    const r = buildSingleExportResult({ imageData: "AAAA" } as any, "1:1");
    expect(r.content[0].mimeType).toBe("image/png");
  });

  test("missing imageData returns a text error, never an image block with undefined data", () => {
    const r = buildSingleExportResult({ mimeType: "image/png" } as any, "1:1");
    expect(r.isError).toBe(true);
    expect(imageBlocks(r.content)).toEqual([]);
    expect(r.content[0].type).toBe("text");
    expect(r.content[0].text).toMatch(/no image data/);
    expect(r.content[0].text).toMatch(/1:1/);
  });

  test("the failure text names both remedies: lower scale and SVG", () => {
    const r = buildSingleExportResult(undefined, "1:1");
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/Fix:/);
    expect(r.content[0].text).toMatch(/scale/);
    expect(r.content[0].text).toMatch(/SVG/);
  });

  test("an empty-string payload is treated as missing", () => {
    const r = buildSingleExportResult({ imageData: "", mimeType: "image/png" }, "1:1");
    expect(r.isError).toBe(true);
    expect(imageBlocks(r.content)).toEqual([]);
  });

  test("no content block ever carries undefined data", () => {
    for (const bad of [undefined, null, {} as any, { imageData: undefined } as any]) {
      const r = buildSingleExportResult(bad, "1:1");
      for (const block of r.content) {
        expect(block.data === undefined || typeof block.data === "string").toBe(true);
        expect(block.type).toBe("text");
      }
    }
  });
});

describe("buildBatchExportResult (BUG-016)", () => {
  const base = { batch: true as const, format: "PNG", scale: 1 };

  test("emits one marker + image pair per exported node", () => {
    const r = buildBatchExportResult({
      ...base,
      images: { "1:1": { imageData: "AAAA", mimeType: "image/png" } },
    });
    expect(r.isError).toBeUndefined();
    expect(imageBlocks(r.content)).toEqual([{ type: "image", data: "AAAA", mimeType: "image/png" }]);
    expect(r.content[0].text).toMatch(/Exported 1 node/);
  });

  test("zero exported ids is an error even when the plugin reported no per-node errors", () => {
    const r = buildBatchExportResult({ ...base, images: {} });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/Exported 0 node\(s\): none/);
  });

  test("zero exported ids with per-node errors stays an error", () => {
    const r = buildBatchExportResult({ ...base, images: {}, errors: { "1:1": "Node not found" } });
    expect(r.isError).toBe(true);
    expect(r.content.some((c) => (c.text || "").includes("Node not found"))).toBe(true);
  });

  test("a dataless entry is reported as text, not as an image block with undefined data", () => {
    const r = buildBatchExportResult({
      ...base,
      images: { "1:1": { imageData: "AAAA", mimeType: "image/png" }, "2:2": {} as any },
    });
    expect(imageBlocks(r.content)).toEqual([{ type: "image", data: "AAAA", mimeType: "image/png" }]);
    expect(r.isError).toBeUndefined();
    const notice = r.content.find((c) => (c.text || "").startsWith("Returned no image data"));
    expect(notice).toBeDefined();
    expect(notice!.text).toMatch(/2:2/);
    expect(notice!.text).toMatch(/SVG/);
  });

  test("every dataless entry means a total failure", () => {
    const r = buildBatchExportResult({ ...base, images: { "1:1": {} as any } });
    expect(r.isError).toBe(true);
    expect(imageBlocks(r.content)).toEqual([]);
  });

  test("truncated ids are still reported", () => {
    const r = buildBatchExportResult({
      ...base,
      images: { "1:1": { imageData: "AAAA", mimeType: "image/png" } },
      truncated: ["2:2"],
    });
    expect(r.content.some((c) => (c.text || "").includes("Truncated"))).toBe(true);
  });
});
