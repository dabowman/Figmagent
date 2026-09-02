// BUG-032 — `edit` reported "Text style not found or not cached" whenever the
// style pre-load threw, discarding the real reason. The usual trigger on the
// remote transport is an unloadable font: the style exists, `loadFontAsync`
// throws for a family the VM does not have, and the agent is sent looking for a
// missing style that was there all along.
//
// The project bar is "no user-facing error without a stated fix"; asserting a
// cause you did not measure fails it just as hard as stating no fix.

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { apply } from "../src/figma_plugin/src/commands/apply.js";

const STYLE_ID = "S:abc123,";
const FONT_ERROR = 'Cannot load font "PP Neue Montreal Regular"';

let fakeNodes: Record<string, any>;
let loadFontBehavior: () => void;
let styleLookup: () => any;

function makeTextNode(id: string) {
  return {
    id,
    type: "TEXT",
    name: "Label",
    characters: "Hello",
    effects: [],
    fontName: { family: "PP Neue Montreal", style: "Regular" },
    setTextStyleIdAsync: async () => {},
    setEffectStyleIdAsync: async () => {},
  };
}

beforeEach(() => {
  fakeNodes = { "1:1": makeTextNode("1:1") };
  loadFontBehavior = () => {};
  styleLookup = () => ({ id: STYLE_ID, type: "TEXT", fontName: { family: "PP Neue Montreal", style: "Regular" } });

  (globalThis as any).figma = {
    mixed: Symbol("mixed"),
    getNodeByIdAsync: async (id: string) => fakeNodes[id] || null,
    getStyleByIdAsync: async () => styleLookup(),
    loadFontAsync: async () => loadFontBehavior(),
    currentPage: { id: "0:0", type: "PAGE", children: [] },
    ui: { postMessage: () => {} },
    variables: {
      getLocalVariableCollectionsAsync: async () => [],
      getVariableByIdAsync: async () => null,
    },
  };
});

afterAll(() => {
  delete (globalThis as any).figma;
});

async function applyStyle() {
  const res = await apply({ nodes: [{ nodeId: "1:1", textStyleId: STYLE_ID }] });
  return res.results.find((r: any) => r.nodeId === "1:1");
}

async function applyEffect() {
  const res = await apply({ nodes: [{ nodeId: "1:1", effectStyleId: STYLE_ID }] });
  return res.results.find((r: any) => r.nodeId === "1:1");
}

describe("[BUG-032] a style that failed to load reports why", () => {
  test("an unloadable font surfaces the font error, not 'style not found'", async () => {
    loadFontBehavior = () => {
      throw new Error(FONT_ERROR);
    };

    const op = await applyStyle();
    expect(op.success).toBe(false);
    expect(op.error).toContain(FONT_ERROR);
    // The wrong cause must be gone: the style was found, it just would not load.
    expect(op.error).not.toContain("not found or not cached");
  });

  test("the load failure still states a fix", async () => {
    loadFontBehavior = () => {
      throw new Error(FONT_ERROR);
    };
    expect((await applyStyle()).error).toContain("Fix:");
  });

  test("a genuinely missing style still says not found — and states its own fix", async () => {
    styleLookup = () => null;

    const op = await applyStyle();
    expect(op.success).toBe(false);
    expect(op.error).toContain("not found");
    expect(op.error).toContain("Fix:");
    // No invented font cause when nothing threw.
    expect(op.error).not.toContain("could not be loaded");
  });

  test("a style that loads cleanly still applies", async () => {
    const op = await applyStyle();
    expect(op.success).toBe(true);
  });

  // The font branch is the only one that may talk about fonts. A rejected id
  // (getStyleByIdAsync throws — short def id, bare key, foreign-file id) is a
  // lookup failure, and telling the agent to swap fonts and retry there is the
  // same invented cause BUG-032 is about, only inverted.
  test("a rejected style id reports the id, not a font remedy", async () => {
    styleLookup = () => {
      throw new Error("Invalid ID");
    };

    const op = await applyStyle();
    expect(op.success).toBe(false);
    expect(op.error).toContain("Invalid ID");
    expect(op.error).toContain("Fix:");
    expect(op.error).not.toContain("font");
  });

  // applyEffectStyle shares the styleErrors map; an effect style can only ever
  // fail the lookup, so it must never be handed the font remedy.
  test("an effect style that was rejected does not get font advice", async () => {
    styleLookup = () => {
      throw new Error("Invalid ID");
    };

    const op = await applyEffect();
    expect(op.success).toBe(false);
    expect(op.error).toContain("Effect style id");
    expect(op.error).toContain("Fix:");
    expect(op.error).not.toContain("font");
  });

  // BUG-033's trigger on the other side of the style: the style loads, but the
  // node's own family is absent from the VM. Figma's raw "call loadFontAsync
  // first" text is unactionable, so it must carry a fix like everything else.
  test("an unloadable font on the node itself states a fix", async () => {
    styleLookup = () => ({ id: STYLE_ID, type: "TEXT", fontName: { family: "Inter", style: "Regular" } });
    loadFontBehavior = () => {
      // Only the node's own family is missing; the style's font loads.
      throw new Error(FONT_ERROR);
    };
    (globalThis as any).figma.loadFontAsync = async (f: { family: string }) => {
      if (f.family === "PP Neue Montreal") loadFontBehavior();
    };

    const op = await applyStyle();
    expect(op.success).toBe(false);
    expect(op.error).toContain(FONT_ERROR);
    expect(op.error).toContain("Fix:");
  });
});

// An error message is only as good as the route it points at. Every remedy
// added above tells the agent to move the node onto an available font with
// `edit({ fontFamily })` — so that call has to actually work on a node whose
// current font is the absent one. It did not: the font-property path loaded the
// node's current font unguarded and threw before reaching the swap, making the
// advice circular and the agent's next call fail identically. That is the
// AGENT-029 loop BUG-032 exists to break, so it is covered here rather than
// left to the reader.
describe("[BUG-032] the prescribed remedy is reachable", () => {
  const ABSENT = "PP Neue Montreal";

  // Only ABSENT is missing from this VM; every other family loads.
  function onlyAbsentMissing() {
    (globalThis as any).figma.loadFontAsync = async (f: { family: string; style: string }) => {
      if (f && f.family === ABSENT) throw new Error(FONT_ERROR);
    };
  }

  test("edit({ fontFamily }) escapes an absent current font", async () => {
    onlyAbsentMissing();
    const node = fakeNodes["1:1"];

    const res = await apply({ nodes: [{ nodeId: "1:1", fontFamily: "Inter" }] });
    const op = res.results.find((r: any) => r.nodeId === "1:1");

    expect(op.success).toBe(true);
    expect(node.fontName.family).toBe("Inter");
  });

  test("the swap also works when the node's fonts are mixed", async () => {
    onlyAbsentMissing();
    const node = fakeNodes["1:1"];
    node.fontName = (globalThis as any).figma.mixed;
    node.getRangeFontName = () => ({ family: ABSENT, style: "Regular" });

    const res = await apply({ nodes: [{ nodeId: "1:1", fontFamily: "Inter" }] });
    const op = res.results.find((r: any) => r.nodeId === "1:1");

    expect(op.success).toBe(true);
    expect(node.fontName.family).toBe("Inter");
  });

  // The escape hatch is the replacement FAMILY. An op that only changes size or
  // weight stays on the absent family, so it must keep failing loudly — letting
  // it through would report success having changed nothing, which is exactly the
  // is_error:false hole BUG-033 records.
  for (const [label, op] of [
    ["fontSize", { fontSize: 20 }],
    ["fontWeight", { fontWeight: 700 }],
  ] as const) {
    test(`${label}-only cannot escape, so it fails with a fix instead of silently passing`, async () => {
      onlyAbsentMissing();
      const node = fakeNodes["1:1"];

      const res = await apply({ nodes: [Object.assign({ nodeId: "1:1" }, op)] });
      const result = res.results.find((r: any) => r.nodeId === "1:1");

      expect(result.success).toBe(false);
      expect(result.error).toContain("Fix:");
      expect(result.error).toContain("fontFamily");
      // Unchanged — no partial write hiding behind the failure.
      expect(node.fontName.family).toBe(ABSENT);
    });
  }
});
