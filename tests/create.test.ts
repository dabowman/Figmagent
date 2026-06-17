// Plugin-side `create` handler tests against a mocked figma global.
// Covers issue #47 (TEXT defaults to FILL + HEIGHT in auto-layout parents)
// and issue #43 (INSTANCE results carry override paths for TEXT children).

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { create } from "../src/figma_plugin/src/commands/create.js";

// ─── Fake node factories ────────────────────────────────────────────────────

let idCounter: number;
const nodesById: Record<string, any> = {};

function makeBaseNode(type: string) {
  const node: any = {
    id: `n${idCounter++}`,
    type,
    name: type,
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    fills: [],
    children: [],
    resize(w: number, h: number) {
      this.width = w;
      this.height = h;
    },
    appendChild(child: any) {
      child.parent = this;
      this.children.push(child);
    },
  };
  nodesById[node.id] = node;
  return node;
}

function makeFrame() {
  const f = makeBaseNode("FRAME");
  f.layoutMode = "NONE";
  f.cornerRadius = 0;
  return f;
}

function makeText() {
  const t = makeBaseNode("TEXT");
  // Track sizing/resize props the handler reads + writes.
  t._textAutoResize = "WIDTH_AND_HEIGHT";
  Object.defineProperty(t, "textAutoResize", {
    get() {
      return this._textAutoResize;
    },
    set(v) {
      this._textAutoResize = v;
    },
    enumerable: true,
    configurable: true,
  });
  t.fontName = { family: "Inter", style: "Regular" };
  t.characters = "";
  t.fontSize = 14;
  // layoutSizingHorizontal/Vertical: assignment must not throw under an
  // auto-layout parent (handler swallows throws otherwise).
  t._lsh = undefined;
  t._lsv = undefined;
  Object.defineProperty(t, "layoutSizingHorizontal", {
    get() {
      return this._lsh;
    },
    set(v) {
      this._lsh = v;
    },
    enumerable: true,
    configurable: true,
  });
  Object.defineProperty(t, "layoutSizingVertical", {
    get() {
      return this._lsv;
    },
    set(v) {
      this._lsv = v;
    },
    enumerable: true,
    configurable: true,
  });
  return t;
}

function installFigmaMock() {
  idCounter = 1;
  for (const k of Object.keys(nodesById)) delete nodesById[k];
  (globalThis as any).figma = {
    currentPage: { id: "0:0", type: "PAGE", children: [], appendChild() {} },
    mixed: Symbol("mixed"),
    createFrame: () => makeFrame(),
    createText: () => makeText(),
    createRectangle: () => makeBaseNode("RECTANGLE"),
    createComponent: () => {
      const c = makeFrame();
      c.type = "COMPONENT";
      return c;
    },
    loadFontAsync: async () => {},
    getNodeByIdAsync: async (id: string) => nodesById[id] || null,
  };
}

beforeEach(() => {
  installFigmaMock();
});

afterAll(() => {
  delete (globalThis as any).figma;
});

// ─── Issue #47: TEXT defaults in auto-layout parents ────────────────────────

describe("create: TEXT defaults in auto-layout parents (#47)", () => {
  test("TEXT in an auto-layout FRAME defaults to FILL + HEIGHT when sizing is omitted", async () => {
    const res = await create({
      tree: {
        type: "FRAME",
        layoutMode: "VERTICAL",
        children: [{ type: "TEXT", text: "Hello world" }],
      },
    });
    const textId = res.tree.children[0].id;
    const text = nodesById[textId];
    expect(text.layoutSizingHorizontal).toBe("FILL");
    expect(text.textAutoResize).toBe("HEIGHT");
  });

  test("explicit layoutSizingHorizontal: FIXED is respected (no FILL default)", async () => {
    const res = await create({
      tree: {
        type: "FRAME",
        layoutMode: "VERTICAL",
        children: [{ type: "TEXT", text: "Hello", layoutSizingHorizontal: "FIXED" }],
      },
    });
    const text = nodesById[res.tree.children[0].id];
    expect(text.layoutSizingHorizontal).toBe("FIXED");
    // textAutoResize keeps Figma's default since neither default nor coerce fires
    expect(text.textAutoResize).toBe("WIDTH_AND_HEIGHT");
  });

  test("explicit textAutoResize is respected and suppresses the FILL default", async () => {
    const res = await create({
      tree: {
        type: "FRAME",
        layoutMode: "VERTICAL",
        children: [{ type: "TEXT", text: "Hello", textAutoResize: "WIDTH_AND_HEIGHT" }],
      },
    });
    const text = nodesById[res.tree.children[0].id];
    expect(text.layoutSizingHorizontal).toBeUndefined();
    expect(text.textAutoResize).toBe("WIDTH_AND_HEIGHT");
  });

  test("TEXT under a non-auto-layout parent keeps Figma defaults", async () => {
    const res = await create({
      tree: {
        type: "FRAME",
        children: [{ type: "TEXT", text: "Hello" }],
      },
    });
    const text = nodesById[res.tree.children[0].id];
    expect(text.layoutSizingHorizontal).toBeUndefined();
    expect(text.textAutoResize).toBe("WIDTH_AND_HEIGHT");
  });
});

// ─── Issue #43: INSTANCE override paths ─────────────────────────────────────

describe("create: INSTANCE override paths for TEXT children (#43)", () => {
  test("textOverrides maps each TEXT descendant id to { name, characters }", async () => {
    // A fake COMPONENT whose createInstance() yields an INSTANCE with TEXT
    // descendants whose ids are already in override-path format.
    const label = {
      id: "I58:128;4:60",
      type: "TEXT",
      name: "Label",
      characters: "Submit",
      children: [],
    };
    const nestedFrame = { id: "I58:128;4:59", type: "FRAME", name: "row", children: [label] };
    const instance = {
      id: "58:128",
      type: "INSTANCE",
      name: "Button",
      x: 0,
      y: 0,
      width: 100,
      height: 40,
      fills: [],
      children: [nestedFrame],
      resize() {},
      appendChild() {},
    };
    nodesById["comp1"] = {
      id: "comp1",
      type: "COMPONENT",
      createInstance: () => instance,
    };

    const res = await create({ tree: { type: "INSTANCE", componentId: "comp1" } });
    expect(res.tree.type).toBe("INSTANCE");
    expect(res.tree.textOverrides).toBeDefined();
    expect(res.tree.textOverrides["I58:128;4:60"]).toEqual({ name: "Label", characters: "Submit" });
    // Only TEXT descendants appear — the nested frame is not in the map.
    expect(Object.keys(res.tree.textOverrides)).toEqual(["I58:128;4:60"]);
  });

  test("an INSTANCE with no TEXT descendants omits textOverrides", async () => {
    const instance = {
      id: "59:1",
      type: "INSTANCE",
      name: "Icon",
      x: 0,
      y: 0,
      width: 24,
      height: 24,
      fills: [],
      children: [{ id: "I59:1;1:1", type: "VECTOR", name: "vec", children: [] }],
      resize() {},
      appendChild() {},
    };
    nodesById["comp2"] = { id: "comp2", type: "COMPONENT", createInstance: () => instance };
    const res = await create({ tree: { type: "INSTANCE", componentId: "comp2" } });
    expect(res.tree.textOverrides).toBeUndefined();
  });
});
