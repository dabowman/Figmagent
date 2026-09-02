// `set_focus` / `set_selections` crossed a page boundary Figma does not allow.
//
// A Figma selection is per-page: `figma.currentPage.selection = [node]` throws
// "The selection of a page can only include nodes in that page" whenever the
// node lives on another page — which is the norm as soon as a file has more
// than one page. Both commands assigned the selection without ever resolving
// the node's page, so they surfaced Figma's raw error with no stated fix. This
// is the same page boundary that broke import_library_component (BUG-018), and
// the tracker records an agent reaching for `set_focus` to recover from that
// bug and hitting this one instead (session 48).
//
// Both commands are short-circuited on the remote transport
// (remote/transport.ts) — this is plugin-transport behavior only.
//
// These tests model the boundary: the selection setter rejects foreign nodes
// exactly as Figma does.

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { setFocus, setSelections } from "../src/figma_plugin/src/commands/connections.js";

let nodesById: Record<string, any>;
let pageA: any;
let pageB: any;
let loadedPages: string[];
let scrolled: boolean;

function makePage(id: string, name: string) {
  const page: any = {
    id,
    type: "PAGE",
    name,
    parent: null,
    children: [],
    _selection: [] as any[],
    loadAsync: async () => {
      loadedPages.push(id);
    },
    appendChild(child: any) {
      child.parent = this;
      this.children.push(child);
    },
  };
  // Figma rejects a selection containing nodes from another page.
  Object.defineProperty(page, "selection", {
    get() {
      return this._selection;
    },
    set(nodes: any[]) {
      for (const n of nodes) {
        let cur = n;
        while (cur && cur.type !== "PAGE") cur = cur.parent;
        if (cur !== this) {
          throw new Error("in set_selection: The selection of a page can only include nodes in that page");
        }
      }
      this._selection = nodes;
    },
    configurable: true,
  });
  nodesById[id] = page;
  return page;
}

function makeFrame(id: string, page: any) {
  const frame: any = {
    id,
    type: "FRAME",
    name: "Target",
    parent: null,
    children: [],
    appendChild(child: any) {
      child.parent = this;
      this.children.push(child);
    },
  };
  page.appendChild(frame);
  nodesById[id] = frame;
  return frame;
}

beforeEach(() => {
  nodesById = {};
  loadedPages = [];
  scrolled = false;
  pageA = makePage("0:1", "Page 1");
  pageB = makePage("132:4931", "Brands");
  (globalThis as any).figma = {
    currentPage: pageA,
    root: { children: [pageA, pageB] },
    getNodeByIdAsync: async (id: string) => nodesById[id] || null,
    setCurrentPageAsync: async (page: any) => {
      (globalThis as any).figma.currentPage = page;
    },
    viewport: {
      scrollAndZoomIntoView: () => {
        scrolled = true;
      },
    },
  };
});

afterAll(() => {
  delete (globalThis as any).figma;
});

describe("set_focus crosses the page boundary", () => {
  test("moves to the node's page before selecting, and loads it first", async () => {
    const target = makeFrame("137:14", pageB);

    const res = await setFocus({ nodeId: target.id });

    expect(res.success).toBe(true);
    expect((globalThis as any).figma.currentPage.id).toBe(pageB.id);
    expect(loadedPages).toContain(pageB.id);
    expect(pageB.selection.map((n: any) => n.id)).toEqual(["137:14"]);
    expect(scrolled).toBe(true);
  });

  test("a same-page node still selects and scrolls, with no page switch", async () => {
    const target = makeFrame("5:5", pageA);

    await setFocus({ nodeId: target.id });

    expect((globalThis as any).figma.currentPage.id).toBe(pageA.id);
    expect(loadedPages).toEqual([]);
    expect(pageA.selection.map((n: any) => n.id)).toEqual(["5:5"]);
  });

  test("a PAGE id switches to that page instead of selecting it", async () => {
    // A PAGE can never be an entry in its own selection, so the old code always threw.
    const res = await setFocus({ nodeId: pageB.id });

    expect(res.success).toBe(true);
    expect((globalThis as any).figma.currentPage.id).toBe(pageB.id);
    expect(pageB.selection).toEqual([]);
  });

  test("a detached node fails with a stated fix", async () => {
    const orphan: any = { id: "9:9", type: "FRAME", name: "Orphan", parent: null };
    nodesById[orphan.id] = orphan;

    await expect(setFocus({ nodeId: orphan.id })).rejects.toThrow(/Node 9:9 is not on any page\. Fix: /);
  });
});

describe("set_selections crosses the page boundary", () => {
  test("switches to the target page and selects every node", async () => {
    const one = makeFrame("137:14", pageB);
    const two = makeFrame("137:15", pageB);

    const res = await setSelections({ nodeIds: [one.id, two.id] });

    expect(res.success).toBe(true);
    expect((globalThis as any).figma.currentPage.id).toBe(pageB.id);
    expect(pageB.selection.map((n: any) => n.id)).toEqual(["137:14", "137:15"]);
  });

  test("a cross-page nodeIds list fails with a stated fix, not Figma's raw error", async () => {
    // No retry can satisfy this — a Figma selection is per-page — so say so.
    const onA = makeFrame("5:5", pageA);
    const onB = makeFrame("137:14", pageB);

    await expect(setSelections({ nodeIds: [onA.id, onB.id] })).rejects.toThrow(
      /Nodes span 2 pages \(Page 1, Brands\)\. Fix: /,
    );
  });

  test("a same-page list still selects and scrolls, with no page switch", async () => {
    const one = makeFrame("5:5", pageA);

    const res = await setSelections({ nodeIds: [one.id] });

    expect(res.success).toBe(true);
    expect((globalThis as any).figma.currentPage.id).toBe(pageA.id);
    expect(loadedPages).toEqual([]);
    expect(scrolled).toBe(true);
  });
});
