// BUG-018 — import_library_component(s) failed on the remote transport with
// "The selection of a page can only include nodes in that page".
//
// The import itself was always sound. The instance is appended under
// `parentNodeId`, which on the remote `use_figma` VM routinely lives on a page
// that is not `figma.currentPage` — every remote call starts a fresh VM whose
// currentPage is the file's default page, so this is the normal case there. The
// trailing `currentPage.selection = [instance]` then threw across that page
// boundary, and because remote scripts are atomic it rolled back a completed
// import. One session lost 21/21 components to a cosmetic selection call.
//
// These tests model that page boundary: the selection setter rejects foreign
// nodes exactly as Figma does.

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { importLibraryComponent } from "../src/figma_plugin/src/commands/components.js";

const KEY = "abc123";

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

function installFigmaMock() {
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
    loadFontAsync: async () => {},
    importComponentByKeyAsync: async () => ({
      type: "COMPONENT",
      name: "Button",
      createInstance() {
        const inst: any = {
          id: "i1",
          type: "INSTANCE",
          name: "Button",
          x: 0,
          y: 0,
          width: 100,
          height: 40,
          parent: null,
          children: [],
          variantProperties: {},
        };
        // A fresh instance starts on the current page, as Figma does.
        (globalThis as any).figma.currentPage.appendChild(inst);
        nodesById[inst.id] = inst;
        return inst;
      },
    }),
  };
}

beforeEach(() => {
  nodesById = {};
  loadedPages = [];
  scrolled = false;
  pageA = makePage("0:1", "Page 1");
  pageB = makePage("132:4931", "Brands");
  installFigmaMock();
});

afterAll(() => {
  delete (globalThis as any).figma;
});

describe("[BUG-018] importing into a parent on another page", () => {
  test("succeeds when parentNodeId lives on a page other than currentPage", async () => {
    const target = makeFrame("137:14", pageB);

    const res = await importLibraryComponent({ componentKey: KEY, parentNodeId: target.id });

    expect(res.instanceId).toBe("i1");
    expect(target.children).toHaveLength(1);
    expect(target.children[0].id).toBe("i1");
  });

  test("moves currentPage to the instance's page, and loads it first", async () => {
    const target = makeFrame("137:14", pageB);

    await importLibraryComponent({ componentKey: KEY, parentNodeId: target.id });

    expect((globalThis as any).figma.currentPage.id).toBe(pageB.id);
    expect(loadedPages).toContain(pageB.id);
    expect(pageB.selection.map((n: any) => n.id)).toEqual(["i1"]);
  });

  test("same-page import still selects and scrolls, without a page switch", async () => {
    const target = makeFrame("5:5", pageA);

    await importLibraryComponent({ componentKey: KEY, parentNodeId: target.id });

    expect((globalThis as any).figma.currentPage.id).toBe(pageA.id);
    expect(loadedPages).toEqual([]);
    expect(pageA.selection.map((n: any) => n.id)).toEqual(["i1"]);
    expect(scrolled).toBe(true);
  });

  test("a failing selection never fails the import", async () => {
    const target = makeFrame("137:14", pageB);
    // Headless VMs can refuse the page switch outright; the import must survive.
    (globalThis as any).figma.setCurrentPageAsync = async () => {
      throw new Error("setCurrentPageAsync is not available");
    };

    const res = await importLibraryComponent({ componentKey: KEY, parentNodeId: target.id });

    expect(res.instanceId).toBe("i1");
    expect(target.children[0].id).toBe("i1");
  });

  test("import with no parentNodeId is unaffected", async () => {
    const res = await importLibraryComponent({ componentKey: KEY });
    expect(res.instanceId).toBe("i1");
    expect(pageA.selection.map((n: any) => n.id)).toEqual(["i1"]);
  });
});
