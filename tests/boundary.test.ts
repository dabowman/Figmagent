// Phase 4.3 — boundary validation (Edit semantics): schema-level refinements
// plus plugin-side checks, including per-op error entries (batch continues).
// The plugin-side tests run apply() against a mocked figma global.

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { nodeOpSchema } from "../src/figmagent_mcp/tools/apply.js";
import { nodeSpecSchema } from "../src/figmagent_mcp/tools/create.js";
import { apply } from "../src/figma_plugin/src/commands/apply.js";

// ─── Schema-level refinements ────────────────────────────────────────────────

describe("write schema: text props on non-TEXT specs (type known)", () => {
  test("rejects fontSize on a RECTANGLE", () => {
    const r = nodeSpecSchema.safeParse({ type: "RECTANGLE", fontSize: 14 });
    expect(r.success).toBe(false);
    if (!r.success) {
      const msg = r.error.issues.map((i) => i.message).join("\n");
      expect(msg).toContain("TEXT");
      expect(msg).toContain("Fix:");
    }
  });

  test("rejects text content on a default (FRAME) spec", () => {
    const r = nodeSpecSchema.safeParse({ text: "hello" });
    expect(r.success).toBe(false);
  });

  test("accepts text props on a TEXT spec", () => {
    const r = nodeSpecSchema.safeParse({ type: "TEXT", text: "hello", fontSize: 14, fontWeight: 700 });
    expect(r.success).toBe(true);
  });

  test("accepts a FRAME without text props", () => {
    const r = nodeSpecSchema.safeParse({ type: "FRAME", layoutMode: "VERTICAL", itemSpacing: 8 });
    expect(r.success).toBe(true);
  });
});

describe("edit schema: delete combined with children ops", () => {
  test("rejects delete: true with children", () => {
    const r = nodeOpSchema.safeParse({ nodeId: "1:1", delete: true, children: [{ nodeId: "1:2", name: "x" }] });
    expect(r.success).toBe(false);
    if (!r.success) {
      const msg = r.error.issues.map((i) => i.message).join("\n");
      expect(msg).toContain("delete");
      expect(msg).toContain("Fix:");
    }
  });

  test("accepts a plain delete", () => {
    expect(nodeOpSchema.safeParse({ nodeId: "1:1", delete: true }).success).toBe(true);
  });
});

// ─── Plugin-side checks against a mocked figma global ───────────────────────

let fakeNodes: Record<string, any>;

function installFigmaMock(options?: { collections?: any[]; variablesById?: Record<string, any> }) {
  const collections = options?.collections ?? [];
  const variablesById = options?.variablesById ?? {};
  (globalThis as any).figma = {
    getNodeByIdAsync: async (id: string) => fakeNodes[id] || null,
    currentPage: { id: "0:0", type: "PAGE", children: [] },
    mixed: Symbol("mixed"),
    variables: {
      getLocalVariableCollectionsAsync: async () => collections,
      getVariableByIdAsync: async (id: string) => variablesById[id] || null,
      setBoundVariableForPaint: (paint: any, _field: string, variable: any) =>
        Object.assign({}, paint, { boundVariables: { color: { id: variable.id } } }),
    },
  };
}

beforeEach(() => {
  fakeNodes = {};
  installFigmaMock();
});

afterAll(() => {
  delete (globalThis as any).figma;
});

describe("apply: per-op errors, batch continues", () => {
  test("one bad op does not abort the batch; error states the fix", async () => {
    fakeNodes["1:1"] = { id: "1:1", type: "FRAME", name: "old" };
    const result = await apply({
      nodes: [
        { nodeId: "missing", name: "A" },
        { nodeId: "1:1", name: "B" },
      ],
    });
    expect(result.successCount).toBe(1);
    expect(result.failureCount).toBe(1);
    const failedOp = result.results.find((r: any) => !r.success);
    expect(failedOp.error).toContain("Fix:");
    expect(failedOp.error).toContain("grep");
    expect(fakeNodes["1:1"].name).toBe("B");
  });
});

describe("apply: boundary warnings instead of silent skips", () => {
  test("text props on a non-TEXT node produce a warning, op still succeeds", async () => {
    fakeNodes["1:1"] = { id: "1:1", type: "FRAME", name: "frame" };
    const result = await apply({ nodes: [{ nodeId: "1:1", fontSize: 14, name: "renamed" }] });
    expect(result.successCount).toBe(1);
    expect(result.warnings).toBeDefined();
    const w = result.warnings.find((w: any) => w.check === "inapplicable_property");
    expect(w.message).toContain("fontSize");
    expect(w.message).toContain("Fix:");
    expect(fakeNodes["1:1"].name).toBe("renamed");
  });

  test("clipsContent on a node that cannot clip warns with a fix", async () => {
    fakeNodes["2:2"] = { id: "2:2", type: "TEXT", name: "t" };
    const result = await apply({ nodes: [{ nodeId: "2:2", clipsContent: true }] });
    expect(result.successCount).toBe(1);
    const w = result.warnings.find((w: any) => w.check === "inapplicable_property");
    expect(w.message).toContain("clipsContent");
    expect(w.message).toContain("Fix:");
  });

  test("FILL sizing under a non-auto-layout parent warns, names the parent, skips the set", async () => {
    fakeNodes["3:3"] = {
      id: "3:3",
      type: "FRAME",
      name: "child",
      layoutSizingHorizontal: "FIXED",
      parent: { id: "9:9", name: "Card", type: "FRAME" },
    };
    const result = await apply({ nodes: [{ nodeId: "3:3", layoutSizingHorizontal: "FILL" }] });
    expect(result.successCount).toBe(1);
    const w = result.warnings.find((w: any) => w.check === "fill_not_applied");
    expect(w.message).toContain("9:9");
    expect(w.message).toContain("Fix:");
    expect(fakeNodes["3:3"].layoutSizingHorizontal).toBe("FIXED");
  });

  test("HUG sizing under a non-auto-layout parent warns and is skipped (#53 generalization)", async () => {
    fakeNodes["4:4"] = {
      id: "4:4",
      type: "FRAME",
      name: "wrapper",
      width: 200,
      height: 80,
      layoutSizingHorizontal: "FIXED",
      parent: { id: "8:8", name: "Page", type: "FRAME" },
    };
    const result = await apply({ nodes: [{ nodeId: "4:4", layoutSizingHorizontal: "HUG" }] });
    expect(result.successCount).toBe(1);
    const w = result.warnings.find((w: any) => w.check === "fill_not_applied");
    expect(w).toBeDefined();
    expect(w.message).toContain("layoutSizingHorizontal");
    expect(w.message).toContain("silent no-op");
    expect(w.message).toContain("Fix:");
    // The sizing value was NOT applied (no auto-layout parent).
    expect(fakeNodes["4:4"].layoutSizingHorizontal).toBe("FIXED");
  });

  test("layoutMode + layoutSizing* combined in one apply: layoutMode applied first, sizing sticks (#53)", async () => {
    // Parent IS auto-layout, so FILL on the child is valid in one call.
    fakeNodes["5:5"] = {
      id: "5:5",
      type: "FRAME",
      name: "row",
      width: 300,
      height: 40,
      layoutMode: "NONE",
      layoutSizingHorizontal: "FIXED",
      parent: { id: "7:7", name: "Col", type: "FRAME", layoutMode: "VERTICAL" },
    };
    const result = await apply({
      nodes: [{ nodeId: "5:5", layoutMode: "HORIZONTAL", layoutSizingHorizontal: "FILL" }],
    });
    expect(result.successCount).toBe(1);
    // layoutMode (Phase 1) applied before layoutSizing — both stuck.
    expect(fakeNodes["5:5"].layoutMode).toBe("HORIZONTAL");
    expect(fakeNodes["5:5"].layoutSizingHorizontal).toBe("FILL");
    const w = (result.warnings || []).find((w: any) => w.check === "fill_not_applied");
    expect(w).toBeUndefined();
  });

  test("FILL on a width-0 TEXT under an auto-layout parent: width-0 recovery resizes before FILL (#50)", async () => {
    fakeNodes["13:163"] = {
      id: "13:163",
      type: "TEXT",
      name: "label",
      width: 0,
      height: 16,
      textAutoResize: "HEIGHT",
      characters: "Hello",
      layoutSizingHorizontal: "FIXED",
      parent: { id: "6:6", name: "Cell", type: "FRAME", layoutMode: "HORIZONTAL" },
      resize(w: number, h: number) {
        this.width = w;
        this.height = h;
      },
    };
    const result = await apply({
      nodes: [{ nodeId: "13:163", textAutoResize: "HEIGHT", layoutSizingHorizontal: "FILL" }],
    });
    expect(result.successCount).toBe(1);
    // Width-0 recovery nudged width off 0 before FILL was applied (so FILL isn't a no-op).
    expect(fakeNodes["13:163"].width).toBeGreaterThan(0);
    expect(fakeNodes["13:163"].layoutSizingHorizontal).toBe("FILL");
  });

  test("swapVariantId to a non-sibling variant is rejected with the component set named", async () => {
    fakeNodes["i1"] = {
      id: "i1",
      type: "INSTANCE",
      name: "inst",
      getMainComponentAsync: async () => ({
        id: "m1",
        type: "COMPONENT",
        parent: { id: "set1", type: "COMPONENT_SET", name: "Button" },
      }),
      swapComponent: () => {},
    };
    fakeNodes["v2"] = { id: "v2", type: "COMPONENT", name: "Size=LG", parent: { id: "set2", type: "COMPONENT_SET" } };
    const result = await apply({ nodes: [{ nodeId: "i1", swapVariantId: "v2" }] });
    expect(result.failureCount).toBe(1);
    const failedOp = result.results.find((r: any) => !r.success);
    expect(failedOp.error).toContain("not a sibling variant");
    expect(failedOp.error).toContain("set1");
    expect(failedOp.error).toContain("Fix:");
  });

  test("swapVariantId to a sibling variant succeeds", async () => {
    let swapped: any = null;
    fakeNodes["i1"] = {
      id: "i1",
      type: "INSTANCE",
      name: "inst",
      getMainComponentAsync: async () => ({
        id: "m1",
        type: "COMPONENT",
        parent: { id: "set1", type: "COMPONENT_SET", name: "Button" },
      }),
      swapComponent: (v: any) => {
        swapped = v;
      },
    };
    fakeNodes["v2"] = { id: "v2", type: "COMPONENT", name: "Size=LG", parent: { id: "set1", type: "COMPONENT_SET" } };
    const result = await apply({ nodes: [{ nodeId: "i1", swapVariantId: "v2" }] });
    expect(result.successCount).toBe(1);
    expect(swapped.id).toBe("v2");
  });

  test("structural mutation of an instance child is rejected, pointing at the main component", async () => {
    fakeNodes["ic"] = {
      id: "ic",
      type: "FRAME",
      name: "inside",
      parent: { id: "i1", type: "INSTANCE", parent: null },
    };
    const result = await apply({ nodes: [{ nodeId: "ic", delete: true }] });
    expect(result.failureCount).toBe(1);
    const failedOp = result.results.find((r: any) => !r.success);
    expect(failedOp.error).toContain("inside an instance");
    expect(failedOp.error).toContain("main component");
  });

  test("variable bind with incompatible scope warns and skips the bind", async () => {
    fakeNodes["1:1"] = { id: "1:1", type: "FRAME", name: "frame", fills: [] };
    installFigmaMock({
      variablesById: {
        "VariableID:9": { id: "VariableID:9", name: "text/primary", scopes: ["TEXT_FILL"] },
      },
    });
    const result = await apply({ nodes: [{ nodeId: "1:1", variables: { fill: "VariableID:9" } }] });
    expect(result.successCount).toBe(1);
    const w = result.warnings.find((w: any) => w.check === "scope_mismatch");
    expect(w.message).toContain("TEXT_FILL");
    expect(w.message).toContain("Fix:");
    expect(fakeNodes["1:1"].fills).toEqual([]);
  });
});

describe("apply: write-time mini-lint", () => {
  const tokenCollection = {
    name: "Tokens",
    modes: [{ modeId: "m1", name: "Default" }],
    variableIds: ["VariableID:1"],
  };
  const colorVariable = {
    id: "VariableID:1",
    name: "color/bg/subtle",
    resolvedType: "COLOR",
    scopes: ["ALL_FILLS"],
    valuesByMode: { m1: { r: 0.96, g: 0.96, b: 0.98, a: 1 } },
  };

  test("raw fill matching a variable exactly produces an unbound_value warning", async () => {
    fakeNodes["1:1"] = { id: "1:1", type: "FRAME", name: "frame", fills: [] };
    installFigmaMock({ collections: [tokenCollection], variablesById: { "VariableID:1": colorVariable } });
    const result = await apply({ nodes: [{ nodeId: "1:1", fillColor: { r: 0.96, g: 0.96, b: 0.98 } }] });
    expect(result.successCount).toBe(1);
    const w = (result.warnings ?? []).find((w: any) => w.check === "unbound_value");
    expect(w).toBeDefined();
    expect(w.message).toContain("color/bg/subtle");
    expect(w.message).toContain("variables: { fill: 'VariableID:1' }");
  });

  test("bound write produces no unbound_value warning", async () => {
    fakeNodes["1:1"] = { id: "1:1", type: "FRAME", name: "frame", fills: [] };
    installFigmaMock({ collections: [tokenCollection], variablesById: { "VariableID:1": colorVariable } });
    const result = await apply({
      nodes: [{ nodeId: "1:1", fillColor: { r: 0.96, g: 0.96, b: 0.98 }, variables: { fill: "VariableID:1" } }],
    });
    expect(result.successCount).toBe(1);
    const unbound = (result.warnings ?? []).filter((w: any) => w.check === "unbound_value");
    expect(unbound).toEqual([]);
  });

  test("deleted nodes are not asserted on", async () => {
    fakeNodes["del"] = { id: "del", type: "TEXT", name: "bye", width: 0, remove: () => {} };
    const result = await apply({ nodes: [{ nodeId: "del", delete: true }] });
    expect(result.successCount).toBe(1);
    const zeroWidth = (result.warnings ?? []).filter((w: any) => w.check === "zero_width_text");
    expect(zeroWidth).toEqual([]);
  });
});
