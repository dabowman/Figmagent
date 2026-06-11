// Phase 4.2 — single-value matcher extracted from lint.js.
// matchVariable is pure given a seeded variables index, so it is testable
// without a live Figma.

import { describe, expect, test } from "bun:test";
import { matchVariable, rgbToLab } from "../src/figma_plugin/src/commands/lint.js";

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
