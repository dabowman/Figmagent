import { describe, expect, test } from "bun:test";
import { VARIANT_THRESHOLD, processLocalComponents } from "../src/figmagent_mcp/tools/components.js";

function makeSet(name: string, count: number) {
  const variants = [];
  for (let i = 0; i < count; i++) {
    const vName = `Size=${i}, State=Default`;
    variants.push({ id: `10:${i}`, name: vName, key: `key${i}` });
  }
  return {
    id: "4:82",
    name,
    type: "COMPONENT_SET",
    variantCount: count,
    variantAxes: { Size: ["0", "1"], State: ["Default"] },
    variants,
  };
}

describe("processLocalComponents — variantIds map", () => {
  test("attaches variantIds map for small sets and keeps full variants", () => {
    const out = processLocalComponents([makeSet("Button", 3)]);
    const set = out[0];
    expect(set.variantIds).toEqual({
      "Size=0, State=Default": "10:0",
      "Size=1, State=Default": "10:1",
      "Size=2, State=Default": "10:2",
    });
    expect(set.variants.length).toBe(3);
    expect(set.variantsOmitted).toBeUndefined();
  });

  test("large sets keep variantIds map but drop the full variants array", () => {
    const count = VARIANT_THRESHOLD + 5;
    const out = processLocalComponents([makeSet("Button", count)]);
    const set = out[0];
    // Compact map is ALWAYS present, even past the threshold (the issue #45 fix)
    expect(Object.keys(set.variantIds).length).toBe(count);
    expect(set.variantIds["Size=0, State=Default"]).toBe("10:0");
    // Verbose array is gated
    expect(set.variants).toEqual([]);
    expect(set.variantsOmitted).toBe(true);
    expect(set.variantsOmittedHint).toContain("variantIds map is included");
  });

  test("includeVariants:true keeps both map and full array for large sets", () => {
    const count = VARIANT_THRESHOLD + 5;
    const out = processLocalComponents([makeSet("Button", count)], { includeVariants: true });
    const set = out[0];
    expect(Object.keys(set.variantIds).length).toBe(count);
    expect(set.variants.length).toBe(count);
    expect(set.variantsOmitted).toBeUndefined();
  });

  test("nameFilter is case-insensitive and matches set + standalone names", () => {
    const standalone = { id: "5:1", name: "IconButton", type: "COMPONENT" };
    const out = processLocalComponents([makeSet("Button", 2), standalone, makeSet("Card", 2)], {
      nameFilter: "button",
    });
    expect(out.map((c: any) => c.name).sort()).toEqual(["Button", "IconButton"]);
  });

  test("standalone components pass through untouched (no variantIds)", () => {
    const standalone = { id: "5:1", name: "Logo", type: "COMPONENT" };
    const out = processLocalComponents([standalone]);
    expect(out[0]).toEqual(standalone);
    expect(out[0].variantIds).toBeUndefined();
  });

  test("skips variant entries missing name or id when building the map", () => {
    const set = makeSet("Button", 2);
    set.variants.push({ id: "", name: "Size=3, State=Default", key: "k" } as any);
    set.variants.push({ id: "10:9", name: "", key: "k" } as any);
    const out = processLocalComponents([set]);
    expect(Object.keys(out[0].variantIds).length).toBe(2);
  });
});
