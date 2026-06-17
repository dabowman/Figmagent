// Regression tests for #52: update_styles / update_variables must load the
// target's CURRENT font(s) before writing ANY property, not only when a font
// field is in the payload. Writing a non-font prop (lineHeight, value, …) to a
// text style / font-family variable with an unloaded font otherwise throws
// "Cannot write to node with unloaded font …".
//
// These run the plugin-side handlers against a mocked figma global.

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { updateStyles, updateVariables } from "../src/figma_plugin/src/commands/styles.js";

let loadedFonts: Array<{ family: string; style: string }>;
const MIXED = Symbol("mixed");

function installFigmaMock(options?: {
  stylesById?: Record<string, any>;
  variablesById?: Record<string, any>;
  collectionsById?: Record<string, any>;
  availableFonts?: Array<{ family: string; style: string }>;
}) {
  const stylesById = options?.stylesById ?? {};
  const variablesById = options?.variablesById ?? {};
  const collectionsById = options?.collectionsById ?? {};
  const availableFonts = options?.availableFonts ?? [];
  (globalThis as any).figma = {
    mixed: MIXED,
    getStyleByIdAsync: async (id: string) => stylesById[id] || null,
    loadFontAsync: async (font: { family: string; style: string }) => {
      // Mimic Figma: a style/value may reference an unloaded font, but
      // loadFontAsync resolves for any installed font.
      loadedFonts.push({ family: font.family, style: font.style });
    },
    listAvailableFontsAsync: async () => availableFonts.map((f) => ({ fontName: f })),
    variables: {
      getVariableByIdAsync: async (id: string) => variablesById[id] || null,
      getVariableCollectionByIdAsync: async (id: string) => collectionsById[id] || null,
    },
  };
}

beforeEach(() => {
  loadedFonts = [];
  installFigmaMock();
});

afterAll(() => {
  delete (globalThis as any).figma;
});

describe("update_styles: preload current font on text styles (#52)", () => {
  test("updating lineHeight alone loads the style's current font first", async () => {
    const style: any = {
      id: "S:1",
      type: "TEXT",
      name: "Body",
      fontName: { family: "Public Sans", style: "Medium" },
    };
    installFigmaMock({ stylesById: { "S:1": style } });

    const result = await updateStyles({ updates: [{ styleId: "S:1", lineHeight: 1.5 }] });

    expect(result.success).toBe(true);
    expect(result.totalUpdated).toBe(1);
    // The current font must have been loaded before the lineHeight write.
    expect(loadedFonts).toContainEqual({ family: "Public Sans", style: "Medium" });
    expect(style.lineHeight).toEqual({ value: 150, unit: "PERCENT" });
  });

  test("mixed fontName does not throw and skips preload gracefully", async () => {
    const style: any = {
      id: "S:2",
      type: "TEXT",
      name: "Mixed",
      fontName: MIXED,
    };
    installFigmaMock({ stylesById: { "S:2": style } });

    const result = await updateStyles({ updates: [{ styleId: "S:2", letterSpacing: 2 }] });

    expect(result.success).toBe(true);
    // No single font to preload; nothing loaded, but no crash.
    expect(loadedFonts).toEqual([]);
  });

  test("font change still loads the new font in addition to the current one", async () => {
    const style: any = {
      id: "S:3",
      type: "TEXT",
      name: "Heading",
      fontName: { family: "Inter", style: "Regular" },
    };
    installFigmaMock({ stylesById: { "S:3": style } });

    await updateStyles({ updates: [{ styleId: "S:3", fontStyle: "Bold" }] });

    expect(loadedFonts).toContainEqual({ family: "Inter", style: "Regular" });
    expect(loadedFonts).toContainEqual({ family: "Inter", style: "Bold" });
    expect(style.fontName).toEqual({ family: "Inter", style: "Bold" });
  });
});

describe("update_variables: preload font families for FONT_FAMILY variables (#52)", () => {
  test("setting a font-family variable's value loads old and new families", async () => {
    let setValue: any = null;
    const variable: any = {
      id: "V:1",
      name: "font/serif",
      resolvedType: "STRING",
      scopes: ["FONT_FAMILY"],
      variableCollectionId: "C:1",
      valuesByMode: { mode1: "Public Sans" },
      setValueForMode: (_mode: string, value: any) => {
        setValue = value;
      },
    };
    installFigmaMock({
      variablesById: { "V:1": variable },
      collectionsById: { "C:1": { modes: [{ name: "Default", modeId: "mode1" }] } },
      availableFonts: [
        { family: "Public Sans", style: "Regular" },
        { family: "Test Martina Plantijn", style: "Regular" },
        { family: "Test Martina Plantijn", style: "Bold" },
      ],
    });

    const result = await updateVariables({
      updates: [{ variableId: "V:1", values: { Default: "Test Martina Plantijn" } }],
    });

    expect(result.success).toBe(true);
    expect(setValue).toBe("Test Martina Plantijn");
    // Old family loaded (so bound text using it can re-render) …
    expect(loadedFonts).toContainEqual({ family: "Public Sans", style: "Regular" });
    // … and every style of the new family.
    expect(loadedFonts).toContainEqual({ family: "Test Martina Plantijn", style: "Regular" });
    expect(loadedFonts).toContainEqual({ family: "Test Martina Plantijn", style: "Bold" });
  });

  test("non-font-family STRING variable does not trigger font loading", async () => {
    const variable: any = {
      id: "V:2",
      name: "label/text",
      resolvedType: "STRING",
      scopes: ["TEXT_CONTENT"],
      variableCollectionId: "C:1",
      valuesByMode: { mode1: "Hello" },
      setValueForMode: () => {},
    };
    installFigmaMock({
      variablesById: { "V:2": variable },
      collectionsById: { "C:1": { modes: [{ name: "Default", modeId: "mode1" }] } },
      availableFonts: [{ family: "Inter", style: "Regular" }],
    });

    await updateVariables({ updates: [{ variableId: "V:2", values: { Default: "World" } }] });

    expect(loadedFonts).toEqual([]);
  });
});
