// [TOOL-025] letterSpacing / lineHeight / textCase / textDecoration / visible /
//            min-max sizing
// [TOOL-027] layoutPositioning
// [TOOL-035] per-side stroke weights
//
// One family of bug: the property was bindable-to-a-variable but not settable as
// a literal, so pure property-setting fell to `run_script` — forfeiting edit's
// per-op errors, boundary pre-checks and post-write assertions. Session 50 went
// further and deleted three finished variants to re-clone a bottom-only stroke.

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { nodeOpSchema } from "../src/figmagent_mcp/tools/apply.js";
import { apply } from "../src/figma_plugin/src/commands/apply.js";

let fakeNodes: Record<string, any>;
const MIXED = Symbol("mixed");

function makeFrame(id: string, extra: Record<string, any> = {}) {
  return Object.assign(
    {
      id,
      type: "FRAME",
      name: "Frame",
      visible: true,
      clipsContent: true,
      // Figma's strokeWeight writes all four sides. Model that, or a test for
      // "base then per-side override" passes on a fixture that was already 0.
      _strokeWeight: 0,
      get strokeWeight() {
        return this._strokeWeight;
      },
      set strokeWeight(v: number) {
        this._strokeWeight = v;
        this.strokeTopWeight = v;
        this.strokeBottomWeight = v;
        this.strokeLeftWeight = v;
        this.strokeRightWeight = v;
      },
      strokeTopWeight: 0,
      strokeBottomWeight: 0,
      strokeLeftWeight: 0,
      strokeRightWeight: 0,
      minWidth: null,
      maxWidth: null,
      minHeight: null,
      maxHeight: null,
      layoutPositioning: "AUTO",
      width: 100,
      height: 100,
      children: [],
      resize(w: number, h: number) {
        this.width = w;
        this.height = h;
      },
    },
    extra,
  );
}

function makeText(id: string, extra: Record<string, any> = {}) {
  return Object.assign(
    {
      id,
      type: "TEXT",
      name: "Label",
      visible: true,
      characters: "hello",
      fontName: { family: "Space Grotesk", style: "Medium" },
      fontSize: 14,
      letterSpacing: { value: 0, unit: "PIXELS" },
      lineHeight: { unit: "AUTO" },
      textCase: "ORIGINAL",
      textDecoration: "NONE",
      textAutoResize: "HEIGHT",
      width: 100,
      height: 20,
      loadedFonts: [] as any[],
      getRangeFontName: (_a: number, _b: number) => ({ family: "Space Grotesk", style: "Medium" }),
      resize(w: number, h: number) {
        this.width = w;
        this.height = h;
      },
    },
    extra,
  );
}

let loadedFonts: any[];

function installFigmaMock() {
  loadedFonts = [];
  (globalThis as any).figma = {
    mixed: MIXED,
    getNodeByIdAsync: async (id: string) => fakeNodes[id] || null,
    currentPage: { id: "0:0", type: "PAGE", children: [] },
    loadFontAsync: async (f: any) => {
      loadedFonts.push(f);
    },
    variables: {
      getLocalVariableCollectionsAsync: async () => [],
      getVariableByIdAsync: async () => null,
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

// ─── Schema ──────────────────────────────────────────────────────────────────

describe("nodeOpSchema accepts the new direct-value fields", () => {
  test("letterSpacing takes a bare CSS number or an explicit unit object", () => {
    expect(nodeOpSchema.parse({ nodeId: "1:1", letterSpacing: 0.4 }).letterSpacing).toBe(0.4);
    expect(nodeOpSchema.parse({ nodeId: "1:1", letterSpacing: { value: 5, unit: "PERCENT" } }).letterSpacing).toEqual({
      value: 5,
      unit: "PERCENT",
    });
  });

  test("lineHeight takes a number, 'AUTO', or a unit object", () => {
    expect(nodeOpSchema.parse({ nodeId: "1:1", lineHeight: 24 }).lineHeight).toBe(24);
    expect(nodeOpSchema.parse({ nodeId: "1:1", lineHeight: "AUTO" }).lineHeight).toBe("AUTO");
    expect(nodeOpSchema.parse({ nodeId: "1:1", lineHeight: { value: 150, unit: "PERCENT" } }).lineHeight).toEqual({
      value: 150,
      unit: "PERCENT",
    });
  });

  test("enum fields reject nonsense", () => {
    expect(() => nodeOpSchema.parse({ nodeId: "1:1", textCase: "uppercase" })).toThrow();
    expect(() => nodeOpSchema.parse({ nodeId: "1:1", textDecoration: "underline" })).toThrow();
    expect(() => nodeOpSchema.parse({ nodeId: "1:1", layoutPositioning: "FIXED" })).toThrow();
  });

  test("per-side stroke weights allow 0 — unlike strokeWeight, which must be positive", () => {
    expect(nodeOpSchema.parse({ nodeId: "1:1", strokeTopWeight: 0 }).strokeTopWeight).toBe(0);
    expect(() => nodeOpSchema.parse({ nodeId: "1:1", strokeWeight: 0 })).toThrow();
    expect(() => nodeOpSchema.parse({ nodeId: "1:1", strokeTopWeight: -1 })).toThrow();
  });

  test("min/max sizing accepts null to clear the constraint", () => {
    expect(nodeOpSchema.parse({ nodeId: "1:1", minWidth: null }).minWidth).toBeNull();
    expect(nodeOpSchema.parse({ nodeId: "1:1", maxHeight: 640 }).maxHeight).toBe(640);
  });
});

// ─── numericParam, not z.coerce.number() ─────────────────────────────────────
//
// Every new numeric field goes through numericParam() (src/figmagent_mcp/utils.ts),
// which converts only non-empty strings. z.coerce.number() is Number(value) under
// the hood, so it would turn null / "" / [] / false into 0 and true into 1 and
// then apply it: `edit({ strokeTopWeight: null })` would erase a border, and
// `edit({ minWidth: [] })` would pin a frame to 0. Those are the values a
// half-populated agent payload actually carries, so they have to stay errors.

const NEVER_A_NUMBER = [null, "", "   ", false, true, [], {}, "1px"] as const;

// Numeric fields where null is not a legal value.
const STRICT_NUMERIC_FIELDS = [
  "letterSpacing",
  "lineHeight",
  "strokeTopWeight",
  "strokeBottomWeight",
  "strokeLeftWeight",
  "strokeRightWeight",
] as const;

// Numeric fields where null is documented as "clear the constraint".
const NULLABLE_NUMERIC_FIELDS = ["minWidth", "maxWidth", "minHeight", "maxHeight"] as const;

describe("the new numeric fields use numericParam, not z.coerce.number()", () => {
  test("null, empty strings, booleans, arrays and objects are hard errors — never 0", () => {
    for (const field of STRICT_NUMERIC_FIELDS) {
      for (const bad of NEVER_A_NUMBER) {
        const r = nodeOpSchema.safeParse({ nodeId: "1:1", [field]: bad });
        expect(`${field}=${JSON.stringify(bad)} -> ${r.success}`).toBe(`${field}=${JSON.stringify(bad)} -> false`);
      }
    }
  });

  test("min/max sizing rejects the same values, but keeps null as the documented clear", () => {
    for (const field of NULLABLE_NUMERIC_FIELDS) {
      for (const bad of NEVER_A_NUMBER) {
        if (bad === null) continue;
        const r = nodeOpSchema.safeParse({ nodeId: "1:1", [field]: bad });
        expect(`${field}=${JSON.stringify(bad)} -> ${r.success}`).toBe(`${field}=${JSON.stringify(bad)} -> false`);
      }
      expect(nodeOpSchema.safeParse({ nodeId: "1:1", [field]: null }).success).toBe(true);
    }
  });

  test("the { value, unit } forms reject a non-numeric value too", () => {
    for (const bad of NEVER_A_NUMBER) {
      expect(nodeOpSchema.safeParse({ nodeId: "1:1", letterSpacing: { value: bad, unit: "PIXELS" } }).success).toBe(
        false,
      );
      expect(nodeOpSchema.safeParse({ nodeId: "1:1", lineHeight: { value: bad, unit: "PERCENT" } }).success).toBe(false);
    }
  });

  test("non-empty numeric strings still convert, on every new numeric field", () => {
    for (const field of [...STRICT_NUMERIC_FIELDS, ...NULLABLE_NUMERIC_FIELDS]) {
      const r = nodeOpSchema.safeParse({ nodeId: "1:1", [field]: "12" });
      expect(`${field} -> ${r.success && (r.data as Record<string, unknown>)[field]}`).toBe(`${field} -> 12`);
    }
    expect(nodeOpSchema.parse({ nodeId: "1:1", letterSpacing: { value: "5", unit: "PERCENT" } }).letterSpacing).toEqual({
      value: 5,
      unit: "PERCENT",
    });
  });

  test("range checks still run after conversion", () => {
    expect(nodeOpSchema.safeParse({ nodeId: "1:1", strokeTopWeight: "-1" }).success).toBe(false);
    expect(nodeOpSchema.safeParse({ nodeId: "1:1", minWidth: "-1" }).success).toBe(false);
  });

  test("lineHeight's non-numeric union members survive numericParam", () => {
    // numericParam runs Number("AUTO") -> NaN, which z.number() rejects, so the
    // literal branch has to be the one that matches.
    expect(nodeOpSchema.parse({ nodeId: "1:1", lineHeight: "AUTO" }).lineHeight).toBe("AUTO");
    expect(nodeOpSchema.parse({ nodeId: "1:1", lineHeight: { unit: "AUTO" } }).lineHeight).toEqual({ unit: "AUTO" });
  });
});

// ─── [TOOL-035] per-side stroke weights ──────────────────────────────────────

describe("[TOOL-035] per-side stroke weight", () => {
  test("the session-50 case: a bottom-only rule leaves the other sides untouched", async () => {
    fakeNodes["1:1"] = makeFrame("1:1", { strokeTopWeight: 2, strokeLeftWeight: 2, strokeRightWeight: 2 });

    const res = await apply({ nodes: [{ nodeId: "1:1", strokeBottomWeight: 1, strokeTopWeight: 0 }] });

    expect(res.successCount).toBe(1);
    expect(fakeNodes["1:1"].strokeBottomWeight).toBe(1);
    expect(fakeNodes["1:1"].strokeTopWeight).toBe(0);
    expect(fakeNodes["1:1"].strokeLeftWeight).toBe(2);
    expect(fakeNodes["1:1"].strokeRightWeight).toBe(2);
  });

  test("strokeWeight sets the base and a per-side field overrides it in the same call", async () => {
    fakeNodes["1:1"] = makeFrame("1:1");

    await apply({ nodes: [{ nodeId: "1:1", strokeWeight: 2, strokeBottomWeight: 0 }] });

    expect(fakeNodes["1:1"].strokeWeight).toBe(2);
    // The three sides strokeWeight wrote must survive, and the one the caller
    // named must win — which only holds if the per-side write runs second.
    expect(fakeNodes["1:1"].strokeTopWeight).toBe(2);
    expect(fakeNodes["1:1"].strokeLeftWeight).toBe(2);
    expect(fakeNodes["1:1"].strokeRightWeight).toBe(2);
    expect(fakeNodes["1:1"].strokeBottomWeight).toBe(0);
  });

  test("a node type without per-side weights warns instead of skipping silently", async () => {
    fakeNodes["1:1"] = { id: "1:1", type: "TEXT", name: "t", characters: "x" };

    const res = await apply({ nodes: [{ nodeId: "1:1", strokeBottomWeight: 1 }] });

    const w = res.warnings.find((x: any) => x.check === "inapplicable_property");
    expect(w.message).toContain("strokeBottomWeight");
    expect(w.message).toContain("Fix:");
  });
});

// ─── [TOOL-025] text properties ──────────────────────────────────────────────

describe("[TOOL-025] text style properties", () => {
  test("letterSpacing 0.4 becomes Figma's { value, unit: PIXELS }", async () => {
    fakeNodes["1:1"] = makeText("1:1");
    await apply({ nodes: [{ nodeId: "1:1", letterSpacing: 0.4 }] });
    expect(fakeNodes["1:1"].letterSpacing).toEqual({ value: 0.4, unit: "PIXELS" });
  });

  test("an explicit unit object passes through", async () => {
    fakeNodes["1:1"] = makeText("1:1");
    await apply({ nodes: [{ nodeId: "1:1", letterSpacing: { value: 5, unit: "PERCENT" } }] });
    expect(fakeNodes["1:1"].letterSpacing).toEqual({ value: 5, unit: "PERCENT" });
  });

  test("lineHeight accepts a number and 'AUTO'", async () => {
    fakeNodes["1:1"] = makeText("1:1");
    await apply({ nodes: [{ nodeId: "1:1", lineHeight: 24 }] });
    expect(fakeNodes["1:1"].lineHeight).toEqual({ value: 24, unit: "PIXELS" });

    await apply({ nodes: [{ nodeId: "1:1", lineHeight: "AUTO" }] });
    expect(fakeNodes["1:1"].lineHeight).toEqual({ unit: "AUTO" });
  });

  test("textCase and textDecoration — the session-40 and session-45 cases", async () => {
    fakeNodes["1:1"] = makeText("1:1");
    await apply({ nodes: [{ nodeId: "1:1", textCase: "UPPER", textDecoration: "UNDERLINE" }] });
    expect(fakeNodes["1:1"].textCase).toBe("UPPER");
    expect(fakeNodes["1:1"].textDecoration).toBe("UNDERLINE");
  });

  test("fonts are loaded before the write — Figma rejects it otherwise", async () => {
    fakeNodes["1:1"] = makeText("1:1");
    await apply({ nodes: [{ nodeId: "1:1", textCase: "UPPER" }] });
    expect(loadedFonts).toContainEqual({ family: "Space Grotesk", style: "Medium" });
  });

  test("setting letter spacing does NOT rewrite the font", async () => {
    // Phase 2.5 resolves and reassigns fontName; routing these props through it
    // would silently restyle the node. Asking for uppercase must not change type.
    fakeNodes["1:1"] = makeText("1:1");
    await apply({ nodes: [{ nodeId: "1:1", letterSpacing: 0.4, textCase: "UPPER" }] });
    expect(fakeNodes["1:1"].fontName).toEqual({ family: "Space Grotesk", style: "Medium" });
  });

  test("a mixed-font node keeps its mixed fonts, and every range is loaded", async () => {
    const ranges = [
      { family: "Inter", style: "Bold" },
      { family: "Inter", style: "Regular" },
    ];
    fakeNodes["1:1"] = makeText("1:1", {
      fontName: MIXED,
      characters: "ab",
      getRangeFontName: (i: number) => ranges[i],
    });

    await apply({ nodes: [{ nodeId: "1:1", textCase: "UPPER" }] });

    expect(fakeNodes["1:1"].fontName).toBe(MIXED);
    expect(loadedFonts).toContainEqual({ family: "Inter", style: "Bold" });
    expect(loadedFonts).toContainEqual({ family: "Inter", style: "Regular" });
  });

  test("text props on a non-TEXT node warn rather than vanishing", async () => {
    fakeNodes["1:1"] = makeFrame("1:1");

    const res = await apply({ nodes: [{ nodeId: "1:1", letterSpacing: 0.4, textCase: "UPPER" }] });

    const w = res.warnings.find((x: any) => x.check === "inapplicable_property");
    expect(w.message).toContain("letterSpacing");
    expect(w.message).toContain("textCase");
    expect(w.message).toContain("not TEXT");
  });
});

// ─── [TOOL-025] visible + min/max sizing ─────────────────────────────────────

describe("[TOOL-025] visible and min/max sizing", () => {
  test("visible: false hides the node — the session-45 unused-Radio-option case", async () => {
    fakeNodes["1:1"] = makeFrame("1:1");
    await apply({ nodes: [{ nodeId: "1:1", visible: false }] });
    expect(fakeNodes["1:1"].visible).toBe(false);
  });

  test("minWidth 120 — the session-40 case", async () => {
    fakeNodes["1:1"] = makeFrame("1:1");
    await apply({ nodes: [{ nodeId: "1:1", minWidth: 120, maxWidth: 480 }] });
    expect(fakeNodes["1:1"].minWidth).toBe(120);
    expect(fakeNodes["1:1"].maxWidth).toBe(480);
  });

  test("null clears a constraint rather than being ignored as falsy", async () => {
    fakeNodes["1:1"] = makeFrame("1:1", { minWidth: 120 });
    await apply({ nodes: [{ nodeId: "1:1", minWidth: null }] });
    expect(fakeNodes["1:1"].minWidth).toBeNull();
  });
});

// ─── [TOOL-027] layoutPositioning ────────────────────────────────────────────

describe("[TOOL-027] layoutPositioning", () => {
  test("ABSOLUTE applies inside an auto-layout parent — the badge/dot idiom", async () => {
    const parent = makeFrame("0:9", { layoutMode: "VERTICAL" });
    const child = makeFrame("1:1", { parent });
    fakeNodes["1:1"] = child;

    const res = await apply({ nodes: [{ nodeId: "1:1", layoutPositioning: "ABSOLUTE" }] });

    expect(res.successCount).toBe(1);
    expect(child.layoutPositioning).toBe("ABSOLUTE");
  });

  test("clipsContent: false pairs with it on the parent, for children that straddle the border", async () => {
    fakeNodes["0:9"] = makeFrame("0:9", { layoutMode: "VERTICAL" });
    await apply({ nodes: [{ nodeId: "0:9", clipsContent: false }] });
    expect(fakeNodes["0:9"].clipsContent).toBe(false);
  });

  test("ABSOLUTE outside an auto-layout parent warns and skips — it would be a no-op", async () => {
    const parent = makeFrame("0:9", { layoutMode: "NONE" });
    const child = makeFrame("1:1", { parent });
    fakeNodes["1:1"] = child;

    const res = await apply({ nodes: [{ nodeId: "1:1", layoutPositioning: "ABSOLUTE" }] });

    const w = res.warnings.find((x: any) => x.check === "inapplicable_property");
    expect(w.message).toContain("layoutPositioning");
    expect(w.message).toContain("Fix:");
    expect(child.layoutPositioning).toBe("AUTO");
  });

  test("x/y land where the caller asked, not where auto-layout left the node", async () => {
    // The whole point of ABSOLUTE is positioning by x/y. Phase 1.5 writes them
    // while the node is still AUTO, and an auto-layout parent recomputes its
    // children's coordinates — so they have to be written again after the flip,
    // in that order, or `{ layoutPositioning: "ABSOLUTE", x, y }` silently
    // leaves the badge wherever the layout engine had it.
    const order: string[] = [];
    const parent = makeFrame("0:9", { layoutMode: "VERTICAL" });
    const child = makeFrame("1:1", { parent });
    let xv = 0;
    let lp = "AUTO";
    Object.defineProperty(child, "x", {
      get: () => xv,
      set(v) {
        xv = v;
        order.push(`x=${v}`);
      },
      enumerable: true,
      configurable: true,
    });
    Object.defineProperty(child, "layoutPositioning", {
      get: () => lp,
      set(v) {
        lp = v;
        order.push(`layoutPositioning=${v}`);
      },
      enumerable: true,
      configurable: true,
    });
    fakeNodes["1:1"] = child;

    await apply({ nodes: [{ nodeId: "1:1", layoutPositioning: "ABSOLUTE", x: -8, y: -8 }] });

    expect(child.x).toBe(-8);
    expect(order.at(-1)).toBe("x=-8");
    expect(order.indexOf("layoutPositioning=ABSOLUTE")).toBeLessThan(order.lastIndexOf("x=-8"));
  });

  test("a PAGE target warns instead of reporting a successful no-op", async () => {
    // read/lint hand back PAGE ids constantly; PAGE has neither property, so the
    // `in node` guards would drop the op and still report success.
    fakeNodes["0:1"] = { id: "0:1", type: "PAGE", name: "Page 1", children: [] };

    const res = await apply({ nodes: [{ nodeId: "0:1", visible: false, layoutPositioning: "ABSOLUTE" }] });

    const w = res.warnings.find((x: any) => x.check === "inapplicable_property");
    expect(w.message).toContain("visible");
    expect(w.message).toContain("layoutPositioning");
    expect(w.message).toContain("Fix:");
  });

  test("AUTO is always allowed — it is the default, not a no-op request", async () => {
    const parent = makeFrame("0:9", { layoutMode: "NONE" });
    const child = makeFrame("1:1", { parent, layoutPositioning: "ABSOLUTE" });
    fakeNodes["1:1"] = child;

    await apply({ nodes: [{ nodeId: "1:1", layoutPositioning: "AUTO" }] });

    expect(child.layoutPositioning).toBe("AUTO");
  });
});
