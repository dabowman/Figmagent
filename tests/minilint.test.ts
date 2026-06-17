// Phase 4.2 — single-value matcher extracted from lint.js.
// matchVariable is pure given a seeded variables index, so it is testable
// without a live Figma.

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { checkColorProperty, lintDesign, matchVariable, rgbToLab } from "../src/figma_plugin/src/commands/lint.js";

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

// Issue #62: lint_design crashed with "cannot read property 'type' of undefined"
// on root frames / pages / sections whose fills are `figma.mixed` (a Symbol).
// Indexing a Symbol yields `undefined`, and the old code then read `.type` off it.
//
// NOTE on coverage: the GRADIENT_LINEAR / IMAGE tests below do NOT reproduce #62 —
// those paints carry a `.type`, so the pre-fix `paint.type !== "SOLID"` check
// already returned null for them. They guard the SOLID-only contract, not the
// crash. The genuine #62 regression guard is the `figma.mixed (a Symbol)` test,
// which asserts both that checkColorProperty no longer throws AND that the
// pre-fix idiom (indexing the Symbol, then reading `.type`) is what crashed.
describe("checkColorProperty (issue #62 — figma.mixed Symbol fills; also non-SOLID paints)", () => {
  const fillsSpec = { type: "color", field: "fills" };
  const vars = indexes([colorEntry({ r: 0.96, g: 0.96, b: 0.98 })]);
  const ctx = { nodeType: "FRAME", threshold: 5.0 };

  test("GRADIENT_LINEAR paint is skipped (returns null, no throw)", () => {
    const node = {
      type: "FRAME",
      fills: [
        {
          type: "GRADIENT_LINEAR",
          gradientStops: [
            { position: 0, color: { r: 1, g: 0, b: 0, a: 1 } },
            { position: 1, color: { r: 0, g: 0, b: 1, a: 1 } },
          ],
        },
      ],
    };
    expect(() => checkColorProperty(node, "fills", fillsSpec, vars, ctx)).not.toThrow();
    expect(checkColorProperty(node, "fills", fillsSpec, vars, ctx)).toBeNull();
  });

  test("figma.mixed fills (a Symbol) is skipped, not indexed into — the genuine #62 guard", () => {
    const node = { type: "FRAME", fills: Symbol("figma.mixed") };
    expect(() => checkColorProperty(node, "fills", fillsSpec, vars, ctx)).not.toThrow();
    expect(checkColorProperty(node, "fills", fillsSpec, vars, ctx)).toBeNull();
    // Pin the exact pre-fix crash this guard prevents: indexing the Symbol gives
    // `undefined`, and reading `.type` off it throws. If a future refactor drops
    // the guard and re-indexes, the not-throw assertion above starts failing.
    const paints = node.fills as unknown as { type: string }[];
    expect(() => paints[0].type).toThrow();
  });

  test("missing fills field returns null", () => {
    const node = { type: "PAGE" };
    expect(() => checkColorProperty(node, "fills", fillsSpec, vars, ctx)).not.toThrow();
    expect(checkColorProperty(node, "fills", fillsSpec, vars, ctx)).toBeNull();
  });

  test("empty fills array returns null", () => {
    const node = { type: "FRAME", fills: [] };
    expect(checkColorProperty(node, "fills", fillsSpec, vars, ctx)).toBeNull();
  });

  test("IMAGE paint is skipped", () => {
    const node = { type: "FRAME", fills: [{ type: "IMAGE", imageHash: "abc" }] };
    expect(() => checkColorProperty(node, "fills", fillsSpec, vars, ctx)).not.toThrow();
    expect(checkColorProperty(node, "fills", fillsSpec, vars, ctx)).toBeNull();
  });

  test("SOLID paint still matches a variable (regression: solid behavior unchanged)", () => {
    const node = { type: "FRAME", fills: [{ type: "SOLID", color: { r: 0.96, g: 0.96, b: 0.98 } }] };
    const result = checkColorProperty(node, "fills", fillsSpec, vars, ctx);
    expect(result).not.toBeNull();
    expect(result.severity).toBe("exact_match");
    expect(result.suggestedVariable.id).toBe("VariableID:1:1");
  });

  test("SOLID paint already bound to a variable returns null", () => {
    const node = {
      type: "FRAME",
      fills: [{ type: "SOLID", color: { r: 0.96, g: 0.96, b: 0.98 }, boundVariables: { color: { id: "x" } } }],
    };
    expect(checkColorProperty(node, "fills", fillsSpec, vars, ctx)).toBeNull();
  });
});
