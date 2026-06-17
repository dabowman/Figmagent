import { describe, test, expect } from "bun:test";
import {
  guardOutput,
  extractYamlMeta,
  extractJsonSummary,
  paginateGroups,
  DEFAULT_MAX_OUTPUT_CHARS,
} from "../src/figmagent_mcp/utils.js";

// ─── guardOutput ─────────────────────────────────────────────────────────────

describe("guardOutput", () => {
  test("passes through output under budget", () => {
    const text = "short output";
    const result = guardOutput(text, { toolName: "test" });
    expect(result.text).toBe(text);
    expect(result.truncated).toBe(false);
  });

  test("truncates output over default budget", () => {
    const text = "x".repeat(DEFAULT_MAX_OUTPUT_CHARS + 1);
    const result = guardOutput(text, { toolName: "test" });
    expect(result.truncated).toBe(true);
    expect(result.text).toContain("Output truncated");
    expect(result.text).toContain("30,001");
    expect(result.text).toContain("maxOutputChars");
  });

  test("respects custom maxChars", () => {
    const text = "x".repeat(5000);
    const underResult = guardOutput(text, { toolName: "test", maxChars: 10000 });
    expect(underResult.truncated).toBe(false);

    const overResult = guardOutput(text, { toolName: "test", maxChars: 1000 });
    expect(overResult.truncated).toBe(true);
    expect(overResult.text).toContain("5,000");
  });

  test("preserves meta section via metaExtractor", () => {
    const yaml = `meta:\n  nodeId: "123"\n  name: Test\ndefs:\n  vars: {}`;
    const result = guardOutput(yaml, {
      toolName: "get",
      maxChars: 20,
      metaExtractor: extractYamlMeta,
    });
    expect(result.truncated).toBe(true);
    expect(result.text).toContain("nodeId");
    expect(result.text).toContain("Test");
  });

  test("includes narrowing hints in truncation message", () => {
    const text = "x".repeat(50000);
    const result = guardOutput(text, {
      toolName: "get",
      maxChars: 1000,
      narrowingHints: ["  • Use depth=1", "  • Use detail=structure"],
    });
    expect(result.text).toContain("Use depth=1");
    expect(result.text).toContain("Use detail=structure");
  });

  test("caps maxOutputChars suggestion at 200000", () => {
    const text = "x".repeat(250000);
    const result = guardOutput(text, { toolName: "test", maxChars: 1000 });
    expect(result.text).toContain("200000");
    expect(result.text).not.toContain("251000");
  });
});

// ─── extractYamlMeta ─────────────────────────────────────────────────────────

describe("extractYamlMeta", () => {
  test("extracts meta section from YAML", () => {
    const yaml = `meta:\n  nodeId: "123"\n  name: Test\n  nodeCount: 5\ndefs:\n  vars: {}`;
    const meta = extractYamlMeta(yaml);
    expect(meta).toContain("nodeId");
    expect(meta).toContain("nodeCount: 5");
    expect(meta).not.toContain("defs:");
  });

  test("returns null for non-YAML text", () => {
    expect(extractYamlMeta("just some text")).toBeNull();
  });

  test("handles meta at end of string", () => {
    const yaml = `meta:\n  nodeId: "123"`;
    const meta = extractYamlMeta(yaml);
    expect(meta).toContain("nodeId");
  });
});

// ─── extractJsonSummary ──────────────────────────────────────────────────────

describe("extractJsonSummary", () => {
  test("summarizes JSON with arrays and objects", () => {
    const json = JSON.stringify({
      count: 5,
      name: "test",
      items: [1, 2, 3],
      nested: { a: 1, b: 2 },
    });
    const summary = extractJsonSummary(json);
    expect(summary).not.toBeNull();
    const parsed = JSON.parse(summary!);
    expect(parsed.count).toBe(5);
    expect(parsed.name).toBe("test");
    expect(parsed.items).toBe("[3 items]");
    expect(parsed.nested).toBe("{2 keys}");
  });

  test("handles invalid JSON gracefully", () => {
    const result = extractJsonSummary("not json at all");
    expect(result).toContain("not json");
    expect(result).toContain("...");
  });

  test("handles empty object", () => {
    const result = extractJsonSummary("{}");
    expect(result).toBe("{}");
  });
});

// ─── paginateGroups ──────────────────────────────────────────────────────────

describe("paginateGroups", () => {
  // Each group reports a fixed size of 100 via sizeOf; +8 overhead = 108/group.
  const sizeOf = () => 100;
  const groups = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i }));

  test("returns a single page when everything fits the budget", () => {
    const result = paginateGroups(groups(3), sizeOf, { maxChars: 10_000 });
    expect(result.paginated).toBe(false);
    expect(result.pageCount).toBe(1);
    expect(result.page).toBe(1);
    expect(result.items).toHaveLength(3);
    expect(result.totalGroups).toBe(3);
  });

  test("splits groups into budget-sized pages", () => {
    // 108 chars/group, budget 300 → 2 groups per page (216 ok, 324 over).
    const result = paginateGroups(groups(5), sizeOf, { maxChars: 300 });
    expect(result.paginated).toBe(true);
    expect(result.pageCount).toBe(3); // [0,1] [2,3] [4]
    expect(result.page).toBe(1);
    expect(result.items.map((g) => g.id)).toEqual([0, 1]);
  });

  test("returns the requested page", () => {
    const result = paginateGroups(groups(5), sizeOf, { maxChars: 300, page: 2 });
    expect(result.page).toBe(2);
    expect(result.items.map((g) => g.id)).toEqual([2, 3]);
  });

  test("never drops a group across pages", () => {
    const total = 11;
    const seen: number[] = [];
    const first = paginateGroups(groups(total), sizeOf, { maxChars: 300 });
    for (let p = 1; p <= first.pageCount; p++) {
      const pageResult = paginateGroups(groups(total), sizeOf, { maxChars: 300, page: p });
      seen.push(...pageResult.items.map((g) => g.id));
    }
    expect(seen.sort((a, b) => a - b)).toEqual(groups(total).map((g) => g.id));
  });

  test("clamps an out-of-range page to the last page", () => {
    const result = paginateGroups(groups(5), sizeOf, { maxChars: 300, page: 99 });
    expect(result.page).toBe(result.pageCount);
    expect(result.items.map((g) => g.id)).toEqual([4]);
  });

  test("flags an out-of-range page request as outOfRange", () => {
    const result = paginateGroups(groups(5), sizeOf, { maxChars: 300, page: 99 });
    expect(result.outOfRange).toBe(true);
  });

  test("does not flag an in-range page request as outOfRange", () => {
    const result = paginateGroups(groups(5), sizeOf, { maxChars: 300, page: 2 });
    expect(result.outOfRange).toBe(false);
  });

  test("does not flag the default (no explicit page) as outOfRange", () => {
    const result = paginateGroups(groups(5), sizeOf, { maxChars: 300 });
    expect(result.outOfRange).toBe(false);
  });

  test("clamps page below 1 to the first page", () => {
    const result = paginateGroups(groups(5), sizeOf, { maxChars: 300, page: 0 });
    expect(result.page).toBe(1);
    expect(result.items.map((g) => g.id)).toEqual([0, 1]);
    // page 0 clamps up to 1, which is in range — not "out of range" (overshoot).
    expect(result.outOfRange).toBe(false);
  });

  test("a single oversized group still occupies its own page", () => {
    // Group bigger than the budget can't be split — it gets its own page.
    const big = [{ id: 0 }, { id: 1 }];
    const result = paginateGroups(big, () => 1000, { maxChars: 300 });
    expect(result.pageCount).toBe(2);
    expect(result.items.map((g) => g.id)).toEqual([0]);
  });

  test("handles an empty group array", () => {
    const result = paginateGroups([], sizeOf, { maxChars: 300 });
    expect(result.pageCount).toBe(1);
    expect(result.page).toBe(1);
    expect(result.items).toHaveLength(0);
    expect(result.paginated).toBe(false);
  });

  test("defaults to the full budget and page 1", () => {
    const result = paginateGroups(groups(2), () => 10);
    expect(result.page).toBe(1);
    expect(result.paginated).toBe(false);
    expect(result.items).toHaveLength(2);
    // Sanity: default budget is the shared constant.
    expect(DEFAULT_MAX_OUTPUT_CHARS).toBeGreaterThan(0);
  });
});
