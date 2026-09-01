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
});
