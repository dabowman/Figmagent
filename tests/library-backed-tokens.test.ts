// Issue TOOL-024 — a file whose tokens all come from enabled team libraries has
// ZERO local variables, so get_design_system returned {"variables":[],"collections":[]}
// and lint returned "No local variables found in this file. Create variables first
// to enable linting." Both are silently useless (an empty result is indistinguishable
// from a too-narrow filter) and lint's advice is actively wrong for a fully tokenized
// file. Both now consult figma.teamLibrary and route the caller to the library tools.
//
// Runs the plugin handlers against a mocked figma global (same pattern as
// design-system.test.ts / minilint.test.ts).

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { lintDesign } from "../src/figma_plugin/src/commands/lint.js";
import { getDesignSystem, getLocalVariables } from "../src/figma_plugin/src/commands/styles.js";

type LibCollection = { key: string; name: string; libraryName: string };
type TeamLibraryMode = "collections" | "absent" | "throws" | "empty";

type LocalCollection = {
  id: string;
  name: string;
  modes: { modeId: string; name: string }[];
  variableIds: string[];
};

// A FRAME with an unbound SOLID fill — something for lint to scan.
function unboundFrame(id: string, name: string) {
  return {
    id,
    name,
    type: "FRAME",
    visible: true,
    parent: null,
    fills: [{ type: "SOLID", color: { r: 0.96, g: 0.96, b: 0.98 }, opacity: 1 }],
  };
}

let fakeNodes: Record<string, any>;

function installFigmaMock(opts?: {
  teamLibrary?: TeamLibraryMode;
  libraryCollections?: LibCollection[];
  localCollections?: LocalCollection[];
  localVariables?: Record<string, any>;
}) {
  const teamLibraryMode: TeamLibraryMode = opts?.teamLibrary ?? "collections";
  const libraryCollections = opts?.libraryCollections ?? [
    { key: "ck1", name: "WPDS Color", libraryName: "WPDS" },
    { key: "ck2", name: "WPDS Spacing", libraryName: "WPDS" },
  ];
  const localCollections = opts?.localCollections ?? [];
  const localVariables = opts?.localVariables ?? {};

  const figmaMock: any = {
    mixed: Symbol("mixed"),
    ui: { postMessage: () => {} },
    getNodeByIdAsync: async (id: string) => fakeNodes[id] || null,
    getLocalPaintStylesAsync: async () => [],
    getLocalTextStylesAsync: async () => [],
    getLocalEffectStylesAsync: async () => [],
    getLocalGridStylesAsync: async () => [],
    variables: {
      getLocalVariableCollectionsAsync: async () => localCollections,
      getVariableByIdAsync: async (id: string) => localVariables[id] || null,
      setBoundVariableForPaint: (paint: any, _field: string, v: any) =>
        Object.assign({}, paint, { boundVariables: { color: { id: v.id } } }),
    },
  };

  if (teamLibraryMode !== "absent") {
    figmaMock.teamLibrary = {
      getAvailableLibraryVariableCollectionsAsync: async () => {
        if (teamLibraryMode === "throws") throw new Error("library enumeration failed");
        if (teamLibraryMode === "empty") return [];
        return libraryCollections;
      },
      getVariablesInLibraryCollectionAsync: async () => [],
    };
  }

  (globalThis as any).figma = figmaMock;
}

// One local collection holding one color variable — the "file has local tokens" case.
function localTokenSet() {
  return {
    localCollections: [
      {
        id: "VariableCollectionId:1",
        name: "Tokens",
        modes: [{ modeId: "m1", name: "Default" }],
        variableIds: ["VariableID:1:1"],
      },
    ],
    localVariables: {
      "VariableID:1:1": {
        id: "VariableID:1:1",
        name: "color/bg/subtle",
        resolvedType: "COLOR",
        scopes: ["ALL_FILLS"],
        valuesByMode: { m1: { r: 0.96, g: 0.96, b: 0.98, a: 1 } },
      },
    },
  };
}

beforeEach(() => {
  fakeNodes = {};
  installFigmaMock();
});

afterAll(() => {
  delete (globalThis as any).figma;
});

describe("getDesignSystem — library-backed file (TOOL-024)", () => {
  test("zero local variables + enabled libraries routes the caller to the library tools", async () => {
    const r: any = await getDesignSystem({});
    expect(r.variables).toEqual([]);
    expect(r.collections).toEqual([]);
    expect(r.message).toBe(
      "No local variables — this file's tokens come from 2 enabled library collections (WPDS Color, WPDS Spacing). " +
        "Enumerate with get_enabled_library_variables and bind with import_library_variable + edit({variables}).",
    );
    expect(r.libraryCollections).toEqual(["WPDS Color", "WPDS Spacing"]);
  });

  test("a single enabled collection uses the singular wording", async () => {
    installFigmaMock({ libraryCollections: [{ key: "ck1", name: "WPDS Color", libraryName: "WPDS" }] });
    const r: any = await getDesignSystem({});
    expect(r.message).toContain("1 enabled library collection (WPDS Color)");
    expect(r.message).not.toContain("collections");
  });

  test("collections that exist but hold no variables still count as zero local variables", async () => {
    installFigmaMock({
      localCollections: [
        {
          id: "VariableCollectionId:empty",
          name: "Empty",
          modes: [{ modeId: "m1", name: "Default" }],
          variableIds: [],
        },
      ],
    });
    const r: any = await getDesignSystem({});
    expect(r.collections).toEqual(["Empty"]);
    expect(r.message).toContain("get_enabled_library_variables");
  });

  test("no message when the file has local variables (libraries enabled or not)", async () => {
    installFigmaMock(localTokenSet());
    const r: any = await getDesignSystem({});
    expect(r.variables).toHaveLength(1);
    expect(r.message).toBeUndefined();
    expect(r.libraryCollections).toBeUndefined();
  });

  test("no message when includeVariables is false (nothing was asked for)", async () => {
    const r: any = await getDesignSystem({ includeVariables: false });
    expect(r.message).toBeUndefined();
  });

  test("degrades silently when figma.teamLibrary is absent", async () => {
    installFigmaMock({ teamLibrary: "absent" });
    const r: any = await getDesignSystem({});
    expect(r.variables).toEqual([]);
    expect(r.message).toBeUndefined();
    expect(r.libraryCollections).toBeUndefined();
  });

  test("degrades silently when the team-library call throws", async () => {
    installFigmaMock({ teamLibrary: "throws" });
    const r: any = await getDesignSystem({});
    expect(r.variables).toEqual([]);
    expect(r.message).toBeUndefined();
  });

  test("no message when no libraries are enabled (genuinely empty file)", async () => {
    installFigmaMock({ teamLibrary: "empty" });
    const r: any = await getDesignSystem({});
    expect(r.message).toBeUndefined();
  });

  test("getLocalVariables keeps its plain-array contract", async () => {
    const vars: any = await getLocalVariables({});
    expect(Array.isArray(vars)).toBe(true);
    expect(vars).toHaveLength(0);
  });
});

describe("lintDesign — library-backed file (TOOL-024)", () => {
  test("replaces the wrong 'create variables first' advice with library routing", async () => {
    fakeNodes["1:1"] = unboundFrame("1:1", "Frame A");
    const r: any = await lintDesign({ nodeId: "1:1", properties: ["fills"] });

    expect(r.message).not.toContain("Create variables first");
    expect(r.message).toContain(
      "No local variables — this file's tokens come from 2 enabled library collections (WPDS Color, WPDS Spacing). " +
        "Enumerate with get_enabled_library_variables and bind with import_library_variable + edit({variables}).",
    );
    expect(r.message).toContain("lint matches local variables only");
    expect(r.libraryCollections).toEqual(["WPDS Color", "WPDS Spacing"]);
    expect(r.summary.totalNodesScanned).toBe(0);
  });

  test("multi-root empty result still carries the per-root breakdown", async () => {
    fakeNodes["1:1"] = unboundFrame("1:1", "Frame A");
    fakeNodes["2:2"] = unboundFrame("2:2", "Frame B");
    const r: any = await lintDesign({ nodeId: ["1:1", "2:2"], properties: ["fills"] });
    expect(r.roots.map((x: any) => x.rootNodeId)).toEqual(["1:1", "2:2"]);
    expect(r.message).toContain("get_enabled_library_variables");
  });

  test("keeps the create-variables advice when no libraries are enabled", async () => {
    installFigmaMock({ teamLibrary: "empty" });
    fakeNodes["1:1"] = unboundFrame("1:1", "Frame A");
    const r: any = await lintDesign({ nodeId: "1:1", properties: ["fills"] });
    expect(r.message).toBe("No local variables found in this file. Create variables first to enable linting.");
    expect(r.libraryCollections).toBeUndefined();
  });

  test("degrades to the original advice when figma.teamLibrary is absent", async () => {
    installFigmaMock({ teamLibrary: "absent" });
    fakeNodes["1:1"] = unboundFrame("1:1", "Frame A");
    const r: any = await lintDesign({ nodeId: "1:1", properties: ["fills"] });
    expect(r.message).toBe("No local variables found in this file. Create variables first to enable linting.");
  });

  test("degrades to the original advice when the team-library call throws", async () => {
    installFigmaMock({ teamLibrary: "throws" });
    fakeNodes["1:1"] = unboundFrame("1:1", "Frame A");
    const r: any = await lintDesign({ nodeId: "1:1", properties: ["fills"] });
    expect(r.message).toBe("No local variables found in this file. Create variables first to enable linting.");
  });

  test("a file with local variables lints normally — no library hint", async () => {
    installFigmaMock(localTokenSet());
    fakeNodes["1:1"] = unboundFrame("1:1", "Frame A");
    const r: any = await lintDesign({ nodeId: "1:1", properties: ["fills"] });
    expect(r.message).toBeUndefined();
    expect(r.summary.totalNodesScanned).toBe(1);
    expect(r.libraryCollections).toBeUndefined();
  });
});
