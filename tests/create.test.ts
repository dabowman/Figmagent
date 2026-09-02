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
    // Figma reports FIXED on a freshly created node, never undefined. The mock
    // has to as well: checkSizingRequested skips its fill_not_applied check when
    // the node reports undefined, so a node without these would make every
    // "no warning was emitted" assertion vacuously true (makeText overrides both
    // with its own accessors, so TEXT sizing behavior is unaffected).
    layoutSizingHorizontal: "FIXED",
    layoutSizingVertical: "FIXED",
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
    // A real PAGE parents what it appends and has no layoutMode — both matter
    // now that create.js resolves the effective parent from the node itself.
    currentPage: {
      id: "0:0",
      type: "PAGE",
      children: [] as any[],
      appendChild(child: any) {
        child.parent = this;
        this.children.push(child);
      },
    },
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

  test("nested instance: TEXT child's chained override path is captured verbatim", async () => {
    // An instance nested inside the created instance — Figma chains an I-segment
    // per nesting boundary, so the deep TEXT child's id is I<outer>;I<inner>;<comp>.
    const deepLabel = {
      id: "I60:5;I58:128;4:60",
      type: "TEXT",
      name: "Label",
      characters: "Submit",
      children: [],
    };
    const innerInstance = {
      id: "I60:5;58:128",
      type: "INSTANCE",
      name: "Button",
      children: [deepLabel],
    };
    const outerInstance = {
      id: "60:5",
      type: "INSTANCE",
      name: "Card",
      x: 0,
      y: 0,
      width: 200,
      height: 80,
      fills: [],
      children: [innerInstance],
      resize() {},
      appendChild() {},
    };
    nodesById["comp3"] = { id: "comp3", type: "COMPONENT", createInstance: () => outerInstance };

    const res = await create({ tree: { type: "INSTANCE", componentId: "comp3" } });
    expect(res.tree.textOverrides).toBeDefined();
    // The full chained path round-trips verbatim — not just the single-level form.
    expect(res.tree.textOverrides["I60:5;I58:128;4:60"]).toEqual({ name: "Label", characters: "Submit" });
    expect(Object.keys(res.tree.textOverrides)).toEqual(["I60:5;I58:128;4:60"]);
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

// BUG-022 — the root of a write({parentId}) tree is built with
// buildNode(tree, null) and appended via the parentId branch, so the old
// `parentNode &&` guards saw no parent and silently skipped both the FILL pass
// and the TEXT auto-layout default. Children were unaffected (they get
// parentNode), which is why this only ever bit the node the caller named.
describe("create: parentId root gets parent-dependent sizing (BUG-022)", () => {
  test("root FRAME with layoutSizingHorizontal FILL applies under an auto-layout parentId", async () => {
    const parent = makeFrame();
    parent.layoutMode = "VERTICAL";

    const res = await create({
      parentId: parent.id,
      tree: { type: "FRAME", layoutSizingHorizontal: "FILL" },
    });

    const root = nodesById[res.tree.id];
    expect(root.parent.id).toBe(parent.id);
    expect(root.layoutSizingHorizontal).toBe("FILL");
    // The other half of the bug: the FILL that never applied also produced a
    // fill_not_applied warning naming the wrong fix ("give the parent
    // auto-layout" — it already had it). Applying the FILL retires the warning.
    expect(res.warnings).toBeUndefined();
  });

  test("root FRAME with layoutSizingVertical FILL applies under an auto-layout parentId", async () => {
    const parent = makeFrame();
    parent.layoutMode = "HORIZONTAL";

    const res = await create({
      parentId: parent.id,
      tree: { type: "FRAME", layoutSizingVertical: "FILL" },
    });

    expect(nodesById[res.tree.id].layoutSizingVertical).toBe("FILL");
    expect(res.warnings).toBeUndefined();
  });

  test("root TEXT under an auto-layout parentId still gets the FILL + HEIGHT default", async () => {
    const parent = makeFrame();
    parent.layoutMode = "VERTICAL";

    const res = await create({
      parentId: parent.id,
      tree: { type: "TEXT", text: "Hello" },
    });

    const text = nodesById[res.tree.id];
    expect(text.layoutSizingHorizontal).toBe("FILL");
    expect(text.textAutoResize).toBe("HEIGHT");
  });

  test("a non-auto-layout parentId does not force FILL, and still warns", async () => {
    const parent = makeFrame(); // layoutMode stays NONE

    const res = await create({
      parentId: parent.id,
      tree: { type: "FRAME", layoutSizingHorizontal: "FILL" },
    });

    expect(nodesById[res.tree.id].layoutSizingHorizontal).toBe("FIXED");
    // The true-positive counterpart of the bug: here the parent really does
    // lack auto-layout, so fill_not_applied is correct and must survive.
    const warnings = res.warnings || [];
    expect(warnings.map((w: any) => w.check)).toContain("fill_not_applied");
  });

  test("a top-level write (no parentId) is unaffected — PAGE is not an auto-layout parent", async () => {
    const res = await create({
      tree: { type: "FRAME", layoutSizingHorizontal: "FILL" },
    });

    // The node is now parented to the PAGE, so the effective-parent lookup
    // resolves to something real; PAGE has no layoutMode, so nothing is forced.
    const root = nodesById[res.tree.id];
    expect(root.parent.type).toBe("PAGE");
    expect(root.layoutSizingHorizontal).toBe("FIXED");
  });

  test("a top-level TEXT (no parentId) does not get the auto-layout FILL + HEIGHT default", async () => {
    const res = await create({
      tree: { type: "TEXT", text: "Hello" },
    });

    const text = nodesById[res.tree.id];
    expect(text.parent.type).toBe("PAGE");
    expect(text.layoutSizingHorizontal).toBeUndefined();
    expect(text.textAutoResize).toBe("WIDTH_AND_HEIGHT");
  });

  // The fix routes the parentId root through the post-append FILL pass for the
  // first time. Figma can reject a FILL assignment even under an auto-layout
  // parent, and the nodes are already on the canvas by this point — so a
  // rejection has to degrade to the fill_not_applied warning, never abort the
  // write (on remote, an abort rolls the whole tree back).
  test("a FILL Figma rejects is reported as a warning, not thrown", async () => {
    const parent = makeFrame();
    parent.layoutMode = "VERTICAL";

    (globalThis as any).figma.createFrame = () => {
      const f = makeFrame();
      Object.defineProperty(f, "layoutSizingHorizontal", {
        get() {
          return "FIXED";
        },
        set() {
          throw new Error("Cannot set layoutSizingHorizontal on this node");
        },
        configurable: true,
      });
      return f;
    };

    const res = await create({
      parentId: parent.id,
      tree: { type: "FRAME", layoutSizingHorizontal: "FILL" },
    });

    expect(res.success).toBe(true);
    const warnings = res.warnings || [];
    expect(warnings.map((w: any) => w.check)).toContain("fill_not_applied");
  });
});
