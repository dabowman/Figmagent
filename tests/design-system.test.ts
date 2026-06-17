// getDesignSystem filtering: collection, styleType, namePattern, includeStyles/
// includeVariables, and the always-present top-level `collections` list.
// Runs the plugin handler against a mocked figma global (same pattern as
// boundary.test.ts).

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { getDesignSystem } from "../src/figma_plugin/src/commands/styles.js";

function paint(id: string, name: string) {
  return { id, name, key: id, description: "", paints: [] };
}
function textStyle(id: string, name: string) {
  return { id, name, key: id, description: "", fontName: { family: "Inter", style: "Regular" }, fontSize: 16 };
}

function installFigmaMock() {
  const colorColl = {
    id: "VariableCollectionId:color",
    name: "color",
    modes: [{ modeId: "m1", name: "Light" }],
    variableIds: ["v-color-primary", "v-font-base"],
  };
  const spacingColl = {
    id: "VariableCollectionId:spacing",
    name: "spacing",
    modes: [{ modeId: "m1", name: "Default" }],
    variableIds: ["v-spacing-sm"],
  };
  const varsById: Record<string, any> = {
    "v-color-primary": { id: "v-color-primary", name: "color/primary/500", resolvedType: "COLOR", valuesByMode: { m1: { r: 0, g: 0, b: 1 } }, scopes: ["ALL_FILLS"] },
    "v-font-base": { id: "v-font-base", name: "font/size/base", resolvedType: "FLOAT", valuesByMode: { m1: 16 }, scopes: ["FONT_SIZE"] },
    "v-spacing-sm": { id: "v-spacing-sm", name: "spacing/sm", resolvedType: "FLOAT", valuesByMode: { m1: 8 }, scopes: ["GAP"] },
  };

  (globalThis as any).figma = {
    getLocalPaintStylesAsync: async () => [paint("S:c1", "Brand/Primary"), paint("S:c2", "Brand/Secondary")],
    getLocalTextStylesAsync: async () => [textStyle("S:t1", "Heading/H1")],
    getLocalEffectStylesAsync: async () => [],
    getLocalGridStylesAsync: async () => [],
    variables: {
      getLocalVariableCollectionsAsync: async () => [colorColl, spacingColl],
      getVariableByIdAsync: async (id: string) => varsById[id] || null,
    },
  };
}

beforeEach(() => installFigmaMock());
afterAll(() => delete (globalThis as any).figma);

describe("getDesignSystem: collections list (issue #44)", () => {
  test("always returns every collection name at the top level", async () => {
    const r: any = await getDesignSystem({});
    expect(r.collections).toEqual(["color", "spacing"]);
  });

  test("collections list is unaffected by the collection filter", async () => {
    const r: any = await getDesignSystem({ collection: "color" });
    expect(r.collections).toEqual(["color", "spacing"]);
    expect(r.variables.map((c: any) => c.name)).toEqual(["color"]);
  });
});

describe("getDesignSystem: collection filter", () => {
  test("filters variables to a single collection (case-insensitive)", async () => {
    const r: any = await getDesignSystem({ collection: "COLOR" });
    expect(r.variables).toHaveLength(1);
    expect(r.variables[0].name).toBe("color");
  });

  test("accepts an array of collection names", async () => {
    const r: any = await getDesignSystem({ collection: ["color", "spacing"] });
    expect(r.variables.map((c: any) => c.name).sort()).toEqual(["color", "spacing"]);
  });
});

describe("getDesignSystem: namePattern filter (issue #28)", () => {
  test("filters variables by regex on variable name", async () => {
    const r: any = await getDesignSystem({ namePattern: "^font/" });
    const allVars = r.variables.flatMap((c: any) => c.variables);
    expect(allVars.map((v: any) => v.name)).toEqual(["font/size/base"]);
  });

  test("updates variableCount after namePattern filtering", async () => {
    const r: any = await getDesignSystem({ namePattern: "^font/" });
    const colorColl = r.variables.find((c: any) => c.name === "color");
    expect(colorColl.variableCount).toBe(1);
  });

  test("is case-insensitive", async () => {
    const r: any = await getDesignSystem({ namePattern: "PRIMARY" });
    const allVars = r.variables.flatMap((c: any) => c.variables);
    expect(allVars.map((v: any) => v.name)).toEqual(["color/primary/500"]);
  });

  test("also filters style names", async () => {
    const r: any = await getDesignSystem({ namePattern: "primary" });
    expect(r.styles.colors.map((s: any) => s.name)).toEqual(["Brand/Primary"]);
    expect(r.styles.texts).toEqual([]);
  });

  test("combines with collection filter", async () => {
    const r: any = await getDesignSystem({ collection: "color", namePattern: "^font/" });
    const allVars = r.variables.flatMap((c: any) => c.variables);
    expect(allVars.map((v: any) => v.name)).toEqual(["font/size/base"]);
  });

  test("invalid regex fails with a stated fix", async () => {
    await expect(getDesignSystem({ namePattern: "(" })).rejects.toThrow(/Fix:/);
  });
});

describe("getDesignSystem: styleType + include toggles", () => {
  test("styleType filters styles to one group", async () => {
    const r: any = await getDesignSystem({ styleType: "colors" });
    expect(Object.keys(r.styles)).toEqual(["colors"]);
  });

  test("includeVariables: false omits variables and collections", async () => {
    const r: any = await getDesignSystem({ includeVariables: false });
    expect(r.variables).toBeUndefined();
    expect(r.collections).toBeUndefined();
    expect(r.styles).toBeDefined();
  });

  test("includeStyles: false omits styles", async () => {
    const r: any = await getDesignSystem({ includeStyles: false });
    expect(r.styles).toBeUndefined();
    expect(r.variables).toBeDefined();
  });
});
