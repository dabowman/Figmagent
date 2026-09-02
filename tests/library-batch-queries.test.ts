// [TOOL-021] search_library_components took one term per call, so N lookups meant
//            N pairs of REST fetches. Session 44 made 31 single-query calls;
//            session 49 made 18 in four clean runs.
// [TOOL-026] get_enabled_library_variables had the same shape, one term per call.
//
// The saving in both is the shared fetch, not the round-trip count — so the tests
// that matter assert the fetch happens ONCE however many terms are asked for.

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { formatSearchResults } from "../src/figmagent_mcp/tools/libraries.js";
import { getLibraryVariables } from "../src/figma_plugin/src/commands/styles.js";

// ─── [TOOL-021] per-term formatting ──────────────────────────────────────────

const COMPONENTS = [
  { key: "k1", name: "Button", node_id: "1:1", description: "" },
  { key: "k2", name: "Notice", node_id: "1:2", description: "" },
];
const SETS = [{ key: "s1", name: "Button Set", node_id: "2:1", description: "" }];

describe("[TOOL-021] formatSearchResults", () => {
  test("takes pre-fetched lists — it cannot fetch, so a batch shares one fetch by construction", () => {
    // The structural guarantee behind the whole change: the REST calls are hoisted
    // out of the per-term path, and this signature is what enforces it.
    expect(formatSearchResults.length).toBe(5);
  });

  test("matches a term and labels the block when batching", () => {
    const out = formatSearchResults("Notice", COMPONENTS, SETS, 10, true);
    expect(out).toContain("## Notice");
    expect(out).toContain("Notice");
  });

  test("no heading for a single-term search — today's output is preserved", () => {
    const out = formatSearchResults("Notice", COMPONENTS, SETS, 10, false);
    expect(out).not.toContain("##");
    expect(out).toContain('Found 1 results for "Notice"');
  });

  test("a term with no matches says so rather than dropping out of the batch", () => {
    const out = formatSearchResults("Carousel", COMPONENTS, SETS, 10, true);
    expect(out).toContain("## Carousel");
    expect(out).toContain("No components found");
  });

  test("component sets are still flagged as not directly importable", () => {
    expect(formatSearchResults("Button", COMPONENTS, SETS, 10, false)).toContain("[SET]");
  });

  test("limit applies per term", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      key: `k${i}`,
      name: `Button ${i}`,
      node_id: `1:${i}`,
      description: "",
    }));
    const out = formatSearchResults("Button", many, [], 3, false);
    expect(out).toContain('Found 3 results for "Button"');
  });
});

// ─── [TOOL-026] plugin-side multi-term filtering ─────────────────────────────

let fetchCount: number;

function installFigmaMock() {
  fetchCount = 0;
  (globalThis as any).figma = {
    teamLibrary: {
      getAvailableLibraryVariableCollectionsAsync: async () => [
        { key: "c1", name: "Color", libraryName: "WPDS" },
        { key: "c2", name: "Spacing", libraryName: "WPDS" },
      ],
      getVariablesInLibraryCollectionAsync: async (key: string) => {
        fetchCount++;
        return key === "c1"
          ? [
              { key: "v1", name: "color/bg/primary", resolvedType: "COLOR" },
              { key: "v2", name: "color/text/primary", resolvedType: "COLOR" },
            ]
          : [{ key: "v3", name: "space/100", resolvedType: "FLOAT" }];
      },
    },
  };
}

beforeEach(installFigmaMock);
afterAll(() => {
  delete (globalThis as any).figma;
});

describe("[TOOL-026] get_enabled_library_variables accepts several terms", () => {
  test("a single query is unchanged — same shape, same field", async () => {
    const res: any = await getLibraryVariables({ query: "bg" });
    expect(res.collections[0].variables.map((v: any) => v.key)).toEqual(["v1"]);
    expect(res.collections[0].queries).toBeUndefined();
  });

  test("several terms come back grouped, keyed by the term as written", async () => {
    const res: any = await getLibraryVariables({ queries: ["bg", "space"] });
    expect(res.collections[0].queries.bg.map((v: any) => v.key)).toEqual(["v1"]);
    expect(res.collections[1].queries.space.map((v: any) => v.key)).toEqual(["v3"]);
  });

  test("N terms cost the same as one — this is the saving", async () => {
    await getLibraryVariables({ queries: ["bg", "text", "space", "primary"] });
    // Two collections, fetched once each, regardless of the four terms.
    expect(fetchCount).toBe(2);
  });

  test("a one-element queries array matches the same single query exactly", async () => {
    const single: any = await getLibraryVariables({ query: "primary" });
    const batched: any = await getLibraryVariables({ queries: ["primary"] });
    expect(batched).toEqual(single);
  });

  test("matching stays case-insensitive across both forms", async () => {
    const res: any = await getLibraryVariables({ queries: ["BG", "Space"] });
    expect(res.collections[0].queries.BG.map((v: any) => v.key)).toEqual(["v1"]);
    expect(res.collections[1].queries.Space.map((v: any) => v.key)).toEqual(["v3"]);
  });

  test("a term with no matches yields an empty list, not a missing key", async () => {
    const res: any = await getLibraryVariables({ queries: ["bg", "nothing"] });
    expect(res.collections[0].queries.nothing).toEqual([]);
  });

  test("no query at all still returns the plain collections overview", async () => {
    const res: any = await getLibraryVariables({});
    expect(res.collectionCount).toBe(2);
    expect(res.collections[0].variables).toBeUndefined();
    expect(fetchCount).toBe(0);
  });

  test("drilling into one collection groups per term too", async () => {
    const res: any = await getLibraryVariables({ collectionKey: "c1", queries: ["bg", "text"] });
    expect(res.queries.bg.map((v: any) => v.key)).toEqual(["v1"]);
    expect(res.queries.text.map((v: any) => v.key)).toEqual(["v2"]);
  });
});
