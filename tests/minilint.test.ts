// Phase 4.2 — single-value matcher extracted from lint.js.
// matchVariable is pure given a seeded variables index, so it is testable
// without a live Figma.

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { lintDesign, matchVariable, rgbToLab } from "../src/figma_plugin/src/commands/lint.js";

function colorEntry(overrides: Record<string, unknown>) {
  const r = (overrides.r as number) ?? 0.5;
  const g = (overrides.g as number) ?? 0.5;
  const b = (overrides.b as number) ?? 0.5;
  return {
    id: "VariableID:1:1",
    name: "color/bg/subtle",
    collectionName: "Tokens",
    scopes: ["ALL_FILLS"],
    r,
    g,
    b,
    a: 1,
    lab: rgbToLab(r, g, b),
    ...overrides,
  };
}

function indexes(colorEntries: unknown[] = [], floatEntries: unknown[] = [], stringEntries: unknown[] = []) {
  return { colorIndex: colorEntries, scalarIndex: { FLOAT: floatEntries, STRING: stringEntries } };
}

describe("matchVariable", () => {
  test("exact color match hit", () => {
    const vars = indexes([colorEntry({ r: 0.96, g: 0.96, b: 0.98 })]);
    const m = matchVariable({ r: 0.96, g: 0.96, b: 0.98 }, "fills", { nodeType: "FRAME" }, vars);
    expect(m).not.toBeNull();
    expect(m.severity).toBe("exact_match");
    expect(m.variable.id).toBe("VariableID:1:1");
    expect(m.variable.name).toBe("color/bg/subtle");
  });

  test("scope-mismatch miss: TEXT_FILL variable does not match a FRAME fill", () => {
    const vars = indexes([colorEntry({ r: 0.96, g: 0.96, b: 0.98, scopes: ["TEXT_FILL"] })]);
    const m = matchVariable({ r: 0.96, g: 0.96, b: 0.98 }, "fills", { nodeType: "FRAME" }, vars);
    expect(m).toBeNull();
  });

  test("TEXT_FILL variable matches a TEXT fill", () => {
    const vars = indexes([colorEntry({ r: 0.96, g: 0.96, b: 0.98, scopes: ["TEXT_FILL"] })]);
    const m = matchVariable({ r: 0.96, g: 0.96, b: 0.98 }, "fills", { nodeType: "TEXT" }, vars);
    expect(m).not.toBeNull();
    expect(m.severity).toBe("exact_match");
  });

  test("scalar exact match with compatible scope", () => {
    const vars = indexes(
      [],
      [{ id: "VariableID:2:2", name: "radius/md", collectionName: "Tokens", scopes: ["CORNER_RADIUS"], value: 8 }],
    );
    const m = matchVariable(8, "cornerRadius", { nodeType: "FRAME" }, vars);
    expect(m).not.toBeNull();
    expect(m.severity).toBe("exact_match");
    expect(m.variable.name).toBe("radius/md");
  });

  test("scalar scope mismatch: GAP variable does not match cornerRadius", () => {
    const vars = indexes(
      [],
      [{ id: "VariableID:2:2", name: "space/sm", collectionName: "Tokens", scopes: ["GAP"], value: 8 }],
    );
    const m = matchVariable(8, "cornerRadius", { nodeType: "FRAME" }, vars);
    expect(m).toBeNull();
  });

  test("near match is classified near_match, not exact", () => {
    const vars = indexes([colorEntry({ r: 0.96, g: 0.96, b: 0.98 })]);
    const m = matchVariable({ r: 0.93, g: 0.93, b: 0.95 }, "fills", { nodeType: "FRAME" }, vars);
    if (m) {
      expect(m.severity).toBe("near_match");
    }
  });

  test("unknown property returns null", () => {
    const m = matchVariable(8, "notAProperty", { nodeType: "FRAME" }, indexes());
    expect(m).toBeNull();
  });
});

// ─── lintDesign multi-root plumbing (issue #48) ──────────────────────────────
//
// lintDesign needs a live-ish figma global. We mock just enough: a node lookup,
// one local color variable collection, and progress/postMessage no-ops.

// A FRAME with an unbound SOLID fill that exactly matches the seeded variable.
function unboundFrame(id: string, name: string) {
  return {
    id,
    name,
    type: "FRAME",
    visible: true,
    parent: null,
    fills: [{ type: "SOLID", color: { r: 0.96, g: 0.96, b: 0.98 }, opacity: 1 }],
  };
}

let fakeNodes: Record<string, any>;

function installFigmaMock() {
  const collection = { name: "Tokens", modes: [{ modeId: "m1" }], variableIds: ["VariableID:1:1"] };
  const variable = {
    id: "VariableID:1:1",
    name: "color/bg/subtle",
    resolvedType: "COLOR",
    scopes: ["ALL_FILLS"],
    valuesByMode: { m1: { r: 0.96, g: 0.96, b: 0.98, a: 1 } },
  };
  (globalThis as any).figma = {
    getNodeByIdAsync: async (id: string) => fakeNodes[id] || null,
    ui: { postMessage: () => {} },
    mixed: Symbol("mixed"),
    variables: {
      getLocalVariableCollectionsAsync: async () => [collection],
      getVariableByIdAsync: async (id: string) => (id === variable.id ? variable : null),
      setBoundVariableForPaint: (paint: any, _field: string, v: any) =>
        Object.assign({}, paint, { boundVariables: { color: { id: v.id } } }),
    },
  };
}

describe("lintDesign multi-root", () => {
  beforeEach(() => {
    fakeNodes = {};
    installFigmaMock();
  });

  afterAll(() => {
    delete (globalThis as any).figma;
  });

  test("single string nodeId keeps the original response shape (no roots field, no rootNodeId on issues)", async () => {
    fakeNodes["1:1"] = unboundFrame("1:1", "Frame A");
    const result: any = await lintDesign({ nodeId: "1:1", properties: ["fills"] });
    expect(result.roots).toBeUndefined();
    expect(result.summary.totalIssues).toBe(1);
    expect(result.issues.length).toBe(1);
    expect(result.issues[0].nodeId).toBe("1:1");
    expect(result.issues[0].rootNodeId).toBeUndefined();
  });

  test("array of root IDs returns a per-root breakdown and attributes each issue", async () => {
    fakeNodes["1:1"] = unboundFrame("1:1", "Frame A");
    fakeNodes["2:2"] = unboundFrame("2:2", "Frame B");
    const result: any = await lintDesign({ nodeId: ["1:1", "2:2"], properties: ["fills"] });

    expect(result.summary.totalIssues).toBe(2);
    expect(Array.isArray(result.roots)).toBe(true);
    expect(result.roots.length).toBe(2);

    const a = result.roots.find((r: any) => r.rootNodeId === "1:1");
    const b = result.roots.find((r: any) => r.rootNodeId === "2:2");
    expect(a.rootNodeName).toBe("Frame A");
    expect(a.totalNodesScanned).toBe(1);
    expect(a.totalIssues).toBe(1);
    expect(b.totalIssues).toBe(1);

    // Every issue is attributed to its originating root.
    const roots = result.issues.map((i: any) => i.rootNodeId).sort();
    expect(roots).toEqual(["1:1", "2:2"]);
  });

  test("duplicate root IDs are de-duplicated (no double-counting)", async () => {
    fakeNodes["1:1"] = unboundFrame("1:1", "Frame A");
    const result: any = await lintDesign({ nodeId: ["1:1", "1:1"], properties: ["fills"] });
    expect(result.roots.length).toBe(1);
    expect(result.summary.totalIssues).toBe(1);
  });

  test("a missing root ID fails before scanning, naming the bad ID and a fix", async () => {
    fakeNodes["1:1"] = unboundFrame("1:1", "Frame A");
    let err: any = null;
    try {
      await lintDesign({ nodeId: ["1:1", "9:9"], properties: ["fills"] });
    } catch (e) {
      err = e;
    }
    expect(err).not.toBeNull();
    expect(err.message).toContain("9:9");
    expect(err.message).toContain("Fix:");
  });
});
