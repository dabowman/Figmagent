// fig.* stdlib boundary guards — the helpers a run_script author reaches for
// must fail with a stated fix, not a raw TypeError (TOOL-044) or a silent
// substitution that the script only discovers 30 lines later (BUG-041).

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import "../src/figma_plugin/src/remote_entries/stdlib.js";

const fig = (globalThis as any).fig;

beforeEach(() => {
  // A VM that has Inter (Regular, Semi Bold) and nothing else — the remote
  // transport's shape for any file set in a licensed family.
  (globalThis as any).figma = {
    loadFontAsync: async (f: { family: string; style: string }) => {
      if (f.family !== "Inter") throw new Error(`The font family "${f.family}" does not exist`);
      if (f.style !== "Regular" && f.style !== "Semi Bold") throw new Error(`no face ${f.style}`);
    },
  };
});

afterAll(() => {
  delete (globalThis as any).figma;
});

describe("[TOOL-044] fig.prop on a null node", () => {
  test("names the argument and the fix instead of `invalid 'in' operand`", () => {
    expect(() => fig.prop(null, "width")).toThrow(/Fix: getNodeByIdAsync returned null/);
    expect(() => fig.prop(null, "width")).toThrow(/fig\.prop\(null, "width"\)/);
  });

  test("still reads a present property, and undefined for an absent one", () => {
    expect(fig.prop({ width: 3 }, "width")).toBe(3);
    expect(fig.prop({}, "width")).toBeUndefined();
  });
});

describe("[BUG-041] fig.loadFont fails loudly instead of substituting Inter Regular", () => {
  test("a family the VM lacks throws with the remote-font remedy", async () => {
    await expect(fig.loadFont("PP Neue Montreal", "Regular")).rejects.toThrow(/could not be loaded[\s\S]*Fix:/);
  });

  test("a misspelled face on a present family throws too (Inter spells it 'Semi Bold')", async () => {
    await expect(fig.loadFont("Inter", "Semibold")).rejects.toThrow(/Fix:/);
  });

  test("a loadable face returns the FontName, numeric weight mapped", async () => {
    await expect(fig.loadFont("Inter", 600)).resolves.toEqual({ family: "Inter", style: "Semi Bold" });
  });
});
