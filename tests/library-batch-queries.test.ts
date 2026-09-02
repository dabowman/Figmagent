// [TOOL-021] search_library_components took one term per call, so N lookups meant
//            N tool round trips. Session 44 made 31 single-query calls; session 49
//            made 18 in four clean runs. The REST component list is already
//            memoized per fileKey (componentsCache in figma_rest_api.ts), so what
//            batching saves here is the round trip, not the fetch.
// [TOOL-026] get_enabled_library_variables had the same shape, one term per call.
//            Nothing caches behind figma.teamLibrary, so THAT batch really does
//            save the fetch — which is what the fetchCount test below pins.

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import type { ComponentMetadata } from "../src/figmagent_mcp/figma_rest_api.js";
import { blockHasMatches, formatSearchResults, normalizeQueryTerms } from "../src/figmagent_mcp/tools/libraries.js";
import { getLibraryVariables } from "../src/figma_plugin/src/commands/styles.js";

// ─── [TOOL-021] per-term formatting ──────────────────────────────────────────

function comp(key: string, name: string, node_id: string): ComponentMetadata {
  return {
    key,
    name,
    node_id,
    description: "",
    file_key: "abc123",
    thumbnail_url: "",
    containing_frame: { name: "", pageName: "", nodeId: "" },
    created_at: "",
    updated_at: "",
  };
}

const COMPONENTS = [comp("k1", "Button", "1:1"), comp("k2", "Notice", "1:2")];
const SETS = [comp("s1", "Button Set", "2:1")];

describe("[TOOL-021] formatSearchResults", () => {
  test("scores each term independently against the same pre-fetched lists", () => {
    // The structural guarantee behind the change: formatSearchResults takes the
    // already-fetched lists and has no fileKey to fetch with, so a batch cannot
    // re-fetch per term. Two terms over one pair of lists must produce two
    // independent, correctly labelled blocks.
    const blocks = ["Notice", "Button"].map((t) => formatSearchResults(t, COMPONENTS, SETS, 10, true));
    expect(blocks[0]).toContain("## Notice");
    expect(blocks[0]).not.toContain("Button Set");
    expect(blocks[1]).toContain("## Button");
    expect(blocks[1]).toContain("Button Set");
  });

  test("a miss names the file searched — a wrong fileKey looks like an absent component", () => {
    expect(formatSearchResults("Carousel", COMPONENTS, SETS, 10, false, "abc123")).toContain("in file abc123");
  });

  test("a miss block is distinguishable from a hit block without re-scoring", () => {
    // The handler suppresses the '[COMPONENT]/[SET] results:' footer when nothing
    // matched — pre-batch, an all-misses response carried no footer. The check has
    // to key on the hit markers, not on prose like "Found ", which a component
    // description could contain.
    expect(blockHasMatches(formatSearchResults("Carousel", COMPONENTS, SETS, 10, false, "abc123"))).toBe(false);
    expect(blockHasMatches(formatSearchResults("Button", COMPONENTS, SETS, 10, false, "abc123"))).toBe(true);
    expect(blockHasMatches(formatSearchResults("Notice", COMPONENTS, [], 10, true))).toBe(true);
    const decoy = [comp("k9", "Widget", "9:9")];
    decoy[0].description = 'Found 3 results for "Widget"';
    expect(blockHasMatches(formatSearchResults("Carousel", decoy, [], 10, false))).toBe(false);
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
    const many = Array.from({ length: 30 }, (_, i) => comp(`k${i}`, `Button ${i}`, `1:${i}`));
    const out = formatSearchResults("Button", many, [], 3, false);
    expect(out).toContain('Found 3 results for "Button"');
  });
});

describe("[TOOL-021] normalizeQueryTerms", () => {
  test("query and queries are both kept — neither silently wins", () => {
    expect(normalizeQueryTerms("Notice", ["Button"])).toEqual(["Button", "Notice"]);
  });

  test("a one-element queries is the same search as the scalar query — same terms, so same output", () => {
    // Back-compat contract: terms.length drives both the `## ` heading and the
    // whole response shape, so a one-element batch must normalize identically.
    expect(normalizeQueryTerms(undefined, ["Button"])).toEqual(normalizeQueryTerms("Button", undefined));
    const viaScalar = normalizeQueryTerms("Button", undefined);
    const viaArray = normalizeQueryTerms(undefined, ["Button"]);
    expect(viaArray.length).toBe(1);
    expect(formatSearchResults(viaArray[0], COMPONENTS, SETS, 10, viaArray.length > 1, "abc123")).toBe(
      formatSearchResults(viaScalar[0], COMPONENTS, SETS, 10, viaScalar.length > 1, "abc123"),
    );
  });

  test("blank terms are dropped — an empty term startsWith-matches every component", () => {
    expect(normalizeQueryTerms(undefined, ["", "   ", "Button"])).toEqual(["Button"]);
  });

  test("case-insensitive duplicates collapse so a term is not reported twice", () => {
    expect(normalizeQueryTerms("button", ["Button", "Notice"])).toEqual(["Button", "Notice"]);
  });

  test("nothing usable yields no terms, so the handler can reject with a fix", () => {
    expect(normalizeQueryTerms(undefined, undefined)).toEqual([]);
    expect(normalizeQueryTerms("  ", [""])).toEqual([]);
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

  test("a blank term does not shift the labels of the terms after it", async () => {
    // Regression: labels came from the unfiltered list and matches from the
    // filtered one, so a blank entry filed "text"'s hits under "" and "space"'s
    // hits under "text", dropping the last term entirely.
    const res: any = await getLibraryVariables({ queries: ["", "text", "space"] });
    expect(Object.keys(res.collections[0].queries)).toEqual(["text", "space"]);
    expect(res.collections[0].queries.text.map((v: any) => v.key)).toEqual(["v2"]);
    expect(res.collections[1].queries.space.map((v: any) => v.key)).toEqual(["v3"]);
  });

  test("query and queries are both honoured rather than one silently winning", async () => {
    const res: any = await getLibraryVariables({ query: "space", queries: ["bg"] });
    expect(res.collections[0].queries.bg.map((v: any) => v.key)).toEqual(["v1"]);
    expect(res.collections[1].queries.space.map((v: any) => v.key)).toEqual(["v3"]);
  });

  test("duplicate terms collapse instead of colliding on one result key", async () => {
    const res: any = await getLibraryVariables({ queries: ["bg", "BG", "text"] });
    expect(Object.keys(res.collections[0].queries)).toEqual(["bg", "text"]);
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
