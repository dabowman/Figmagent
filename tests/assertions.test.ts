// Phase 4.1 — post-write structural assertion predicates.
// The figma-API-touching wrapper (checkNodes) stays thin; the predicates are
// pure and unit-tested here on plain objects.

import { describe, expect, test } from "bun:test";
import {
  aabbOverlap,
  findOverlappingPairs,
  isNearZeroWidthText,
  isBalloonFrame,
  checkFillRequested,
  checkSizingRequested,
  checkFontFallback,
} from "../src/figma_plugin/src/assertions.js";

describe("aabbOverlap", () => {
  test("detects overlapping rects", () => {
    expect(aabbOverlap({ x: 0, y: 0, width: 10, height: 10 }, { x: 5, y: 5, width: 10, height: 10 })).toBe(true);
  });

  test("touching edges do not count as overlap", () => {
    expect(aabbOverlap({ x: 0, y: 0, width: 10, height: 10 }, { x: 10, y: 0, width: 10, height: 10 })).toBe(false);
    expect(aabbOverlap({ x: 0, y: 0, width: 10, height: 10 }, { x: 0, y: 10, width: 10, height: 10 })).toBe(false);
  });

  test("disjoint rects do not overlap", () => {
    expect(aabbOverlap({ x: 0, y: 0, width: 10, height: 10 }, { x: 100, y: 100, width: 10, height: 10 })).toBe(false);
  });

  test("containment counts as overlap", () => {
    expect(aabbOverlap({ x: 0, y: 0, width: 100, height: 100 }, { x: 10, y: 10, width: 5, height: 5 })).toBe(true);
  });
});

describe("findOverlappingPairs", () => {
  test("returns each overlapping pair once", () => {
    const pairs = findOverlappingPairs([
      { id: "a", x: 0, y: 0, width: 10, height: 10 },
      { id: "b", x: 5, y: 5, width: 10, height: 10 },
      { id: "c", x: 100, y: 100, width: 10, height: 10 },
    ]);
    expect(pairs).toEqual([["a", "b"]]);
  });

  test("empty when nothing overlaps", () => {
    const pairs = findOverlappingPairs([
      { id: "a", x: 0, y: 0, width: 10, height: 10 },
      { id: "b", x: 20, y: 0, width: 10, height: 10 },
    ]);
    expect(pairs).toEqual([]);
  });
});

describe("isNearZeroWidthText", () => {
  test("TEXT under 2px wide", () => {
    expect(isNearZeroWidthText({ id: "1", type: "TEXT", width: 0 })).toBe(true);
    expect(isNearZeroWidthText({ id: "1", type: "TEXT", width: 1.5 })).toBe(true);
  });

  test("TEXT at 2px or wider is fine", () => {
    expect(isNearZeroWidthText({ id: "1", type: "TEXT", width: 2 })).toBe(false);
    expect(isNearZeroWidthText({ id: "1", type: "TEXT", width: 120 })).toBe(false);
  });

  test("non-TEXT nodes never flag", () => {
    expect(isNearZeroWidthText({ id: "1", type: "FRAME", width: 0 })).toBe(false);
  });
});

describe("isBalloonFrame", () => {
  test("HORIZONTAL auto-layout with FIXED counter axis at exactly 100", () => {
    expect(
      isBalloonFrame({ id: "1", type: "FRAME", layoutMode: "HORIZONTAL", counterAxisSizingMode: "FIXED", height: 100 }),
    ).toBe(true);
  });

  test("VERTICAL auto-layout with FIXED primary axis at exactly 100", () => {
    expect(
      isBalloonFrame({ id: "1", type: "FRAME", layoutMode: "VERTICAL", primaryAxisSizingMode: "FIXED", height: 100 }),
    ).toBe(true);
  });

  test("HUG sizing is not a balloon", () => {
    expect(
      isBalloonFrame({ id: "1", type: "FRAME", layoutMode: "HORIZONTAL", counterAxisSizingMode: "AUTO", height: 100 }),
    ).toBe(false);
  });

  test("height other than 100 is not a balloon", () => {
    expect(
      isBalloonFrame({ id: "1", type: "FRAME", layoutMode: "HORIZONTAL", counterAxisSizingMode: "FIXED", height: 99 }),
    ).toBe(false);
  });

  test("no auto-layout is not a balloon", () => {
    expect(isBalloonFrame({ id: "1", type: "FRAME", layoutMode: "NONE", height: 100 })).toBe(false);
    expect(isBalloonFrame({ id: "1", type: "RECTANGLE", height: 100 })).toBe(false);
  });
});

describe("checkFillRequested", () => {
  const parent = { id: "9:9", name: "Card" };

  test("flags FILL that did not apply, naming the parent and the fix", () => {
    const warnings = checkFillRequested(
      { id: "1:1", layoutSizingHorizontal: "FIXED", parent },
      { horizontal: true, vertical: false },
    );
    expect(warnings.length).toBe(1);
    expect(warnings[0].check).toBe("fill_not_applied");
    expect(warnings[0].message).toContain("9:9");
    expect(warnings[0].message).toContain("Fix:");
  });

  test("no warning when FILL applied", () => {
    const warnings = checkFillRequested(
      { id: "1:1", layoutSizingHorizontal: "FILL", parent },
      { horizontal: true, vertical: false },
    );
    expect(warnings).toEqual([]);
  });

  test("checks each axis independently", () => {
    const warnings = checkFillRequested(
      { id: "1:1", layoutSizingHorizontal: "FILL", layoutSizingVertical: "FIXED", parent },
      { horizontal: true, vertical: true },
    );
    expect(warnings.length).toBe(1);
    expect(warnings[0].message).toContain("layoutSizingVertical");
  });
});

describe("checkSizingRequested", () => {
  const parent = { id: "9:9", name: "Card" };

  test("flags a HUG request that did not apply (parent not auto-layout) — #53", () => {
    const warnings = checkSizingRequested(
      { id: "1:1", layoutSizingHorizontal: "FIXED", width: 200, parent },
      { horizontal: "HUG", vertical: undefined, priorWidth: 200, priorHeight: 40 },
    );
    expect(warnings.length).toBe(1);
    expect(warnings[0].check).toBe("fill_not_applied");
    expect(warnings[0].message).toContain("'HUG'");
    expect(warnings[0].message).toContain("FIXED");
    expect(warnings[0].message).toContain("Fix:");
  });

  test("no warning when the requested value stuck", () => {
    const warnings = checkSizingRequested(
      { id: "1:1", layoutSizingHorizontal: "HUG", width: 80, parent },
      { horizontal: "HUG", vertical: undefined, priorWidth: 80, priorHeight: 40 },
    );
    expect(warnings).toEqual([]);
  });

  test("FILL stuck but width still collapsed at 0 from a prior 0 — width_collapse (#50)", () => {
    const warnings = checkSizingRequested(
      { id: "13:163", type: "TEXT", layoutSizingHorizontal: "FILL", width: 0, parent },
      { horizontal: "FILL", vertical: undefined, priorWidth: 0, priorHeight: 16 },
    );
    expect(warnings.length).toBe(1);
    expect(warnings[0].check).toBe("width_collapse");
    expect(warnings[0].message).toContain("no-op");
    expect(warnings[0].message).toContain("Fix:");
  });

  test("FILL that expanded width past 0 produces no collapse warning", () => {
    const warnings = checkSizingRequested(
      { id: "13:163", type: "TEXT", layoutSizingHorizontal: "FILL", width: 132, parent },
      { horizontal: "FILL", vertical: undefined, priorWidth: 0, priorHeight: 16 },
    );
    expect(warnings).toEqual([]);
  });

  test("FILL collapsed but width was already non-zero before the op — no warning (not a no-op)", () => {
    const warnings = checkSizingRequested(
      { id: "1:1", type: "TEXT", layoutSizingHorizontal: "FILL", width: 0, parent },
      { horizontal: "FILL", vertical: undefined, priorWidth: 120, priorHeight: 16 },
    );
    expect(warnings).toEqual([]);
  });

  test("accepts the legacy boolean FILL request shape (create.js) via checkFillRequested alias", () => {
    const warnings = checkFillRequested(
      { id: "1:1", layoutSizingHorizontal: "FIXED", parent },
      { horizontal: true, vertical: false },
    );
    expect(warnings.length).toBe(1);
    expect(warnings[0].check).toBe("fill_not_applied");
  });

  test("create.js boolean FILL with NO prior + collapsed width: no width_collapse (unknown prior, skip)", () => {
    // create.js pushes { id, horizontal, vertical } with no priorWidth. A
    // freshly-created node has no "before the op", so an unknown prior must not
    // be treated as zero — otherwise every new collapsed FILL node would wrongly
    // claim it was collapsed before the op.
    const warnings = checkSizingRequested(
      { id: "1:1", type: "TEXT", layoutSizingHorizontal: "FILL", width: 0, parent },
      { horizontal: true, vertical: false },
    );
    expect(warnings).toEqual([]);
  });

  test("FILL recovery FAILED on apply path (prior 0, still 0 after) — width_collapse fires (#50 headline)", () => {
    // This mirrors the apply.js path: priorWidth is now captured BEFORE the
    // width-0 TEXT recovery resize, so a width-0 TEXT whose FILL could not
    // recover the dimension is reported here as 0 (not the recovery's 100).
    const warnings = checkSizingRequested(
      { id: "13:163", type: "TEXT", layoutSizingHorizontal: "FILL", width: 0, parent },
      { horizontal: "FILL", vertical: undefined, priorWidth: 0, priorHeight: 16 },
    );
    expect(warnings.length).toBe(1);
    expect(warnings[0].check).toBe("width_collapse");
    expect(warnings[0].message).toContain("already collapsed at 0 before the op");
  });
});

describe("checkFontFallback", () => {
  test("flags resolved family differing from requested", () => {
    const w = checkFontFallback({ id: "1:1", fontName: { family: "Inter", style: "Regular" } }, "Space Grotesk");
    expect(w).not.toBeNull();
    expect(w!.check).toBe("font_fallback");
    expect(w!.message).toContain("Space Grotesk");
    expect(w!.message).toContain("Inter");
    expect(w!.message).toContain("Fix:");
  });

  test("no warning when requested family resolved", () => {
    expect(checkFontFallback({ id: "1:1", fontName: { family: "Inter", style: "Bold" } }, "Inter")).toBeNull();
  });

  test("mixed fonts (symbol) are skipped", () => {
    expect(checkFontFallback({ id: "1:1", fontName: Symbol("mixed") }, "Inter")).toBeNull();
  });

  test("no requested family means no check", () => {
    expect(checkFontFallback({ id: "1:1", fontName: { family: "Inter", style: "Regular" } }, undefined)).toBeNull();
  });
});
