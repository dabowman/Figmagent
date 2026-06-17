// Issue #66 — library variable enumeration + import (Plugin API teamLibrary).
// Exercises the plugin-side getLibraryVariables / importLibraryVariable handlers
// against a mocked figma global. The MCP tools (get_enabled_library_variables,
// import_library_variable) are thin sendCommandToFigma wrappers over these.

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { getLibraryVariables, importLibraryVariable } from "../src/figma_plugin/src/commands/styles.js";

type Coll = { key: string; name: string; libraryName: string };
type LibVar = { key: string; name: string; resolvedType: string };

function installFigmaMock(opts?: {
  collections?: Coll[];
  variablesInCollection?: Record<string, LibVar[]>;
  importByKey?: Record<string, any>;
  collectionsById?: Record<string, any>;
  noTeamLibrary?: boolean;
  noImport?: boolean;
}) {
  const collections = opts?.collections ?? [];
  const variablesInCollection = opts?.variablesInCollection ?? {};
  const importByKey = opts?.importByKey ?? {};
  const collectionsById = opts?.collectionsById ?? {};

  const figmaMock: any = {
    mixed: Symbol("mixed"),
    variables: {
      getVariableCollectionByIdAsync: async (id: string) => collectionsById[id] || null,
    },
  };

  if (!opts?.noImport) {
    figmaMock.variables.importVariableByKeyAsync = async (key: string) => {
      const v = importByKey[key];
      if (!v) throw new Error("no such key " + key);
      return v;
    };
  }

  if (!opts?.noTeamLibrary) {
    figmaMock.teamLibrary = {
      getAvailableLibraryVariableCollectionsAsync: async () => collections,
      getVariablesInLibraryCollectionAsync: async (key: string) => variablesInCollection[key] || [],
    };
  }

  (globalThis as any).figma = figmaMock;
}

beforeEach(() => {
  installFigmaMock();
});

afterAll(() => {
  delete (globalThis as any).figma;
});

describe("getLibraryVariables — enumerate collections", () => {
  test("returns enabled collections with key/name/libraryName", async () => {
    installFigmaMock({
      collections: [
        { key: "ck1", name: "Color", libraryName: "DS" },
        { key: "ck2", name: "Spacing", libraryName: "DS" },
      ],
    });
    const result: any = await getLibraryVariables({});
    expect(result.collectionCount).toBe(2);
    expect(result.collections[0]).toEqual({ key: "ck1", name: "Color", libraryName: "DS" });
    // No drill-in without a query, so no variables array
    expect(result.collections[0].variables).toBeUndefined();
  });

  test("query surfaces matching variables across all collections", async () => {
    installFigmaMock({
      collections: [{ key: "ck1", name: "Color", libraryName: "DS" }],
      variablesInCollection: {
        ck1: [
          { key: "vk1", name: "color/blue/500", resolvedType: "COLOR" },
          { key: "vk2", name: "color/red/500", resolvedType: "COLOR" },
        ],
      },
    });
    const result: any = await getLibraryVariables({ query: "blue" });
    expect(result.collections[0].variables).toHaveLength(1);
    expect(result.collections[0].variables[0].key).toBe("vk1");
  });
});

describe("getLibraryVariables — drill into a collection", () => {
  test("collectionKey returns the collection's variables", async () => {
    installFigmaMock({
      collections: [{ key: "ck1", name: "Color", libraryName: "DS" }],
      variablesInCollection: {
        ck1: [{ key: "vk1", name: "color/blue/500", resolvedType: "COLOR" }],
      },
    });
    const result: any = await getLibraryVariables({ collectionKey: "ck1" });
    expect(result.collection.name).toBe("Color");
    expect(result.variableCount).toBe(1);
    expect(result.variables[0]).toEqual({ key: "vk1", name: "color/blue/500", resolvedType: "COLOR" });
  });

  test("unknown collectionKey fails with a stated fix naming the right enumerator tool", async () => {
    installFigmaMock({ collections: [{ key: "ck1", name: "Color", libraryName: "DS" }] });
    await expect(getLibraryVariables({ collectionKey: "nope" })).rejects.toThrow(/Fix:/);
    // Regression guard: the fix must point at the Plugin-API enumerator
    // (get_enabled_library_variables), not the REST tool get_library_variables.
    await expect(getLibraryVariables({ collectionKey: "nope" })).rejects.toThrow(
      /get_enabled_library_variables/,
    );
  });
});

describe("getLibraryVariables — environment guard", () => {
  test("fails with a fix when teamLibrary is unavailable", async () => {
    installFigmaMock({ noTeamLibrary: true });
    await expect(getLibraryVariables({})).rejects.toThrow(/Fix:/);
  });
});

describe("importLibraryVariable", () => {
  test("imports a single variable by key and returns its id", async () => {
    installFigmaMock({
      importByKey: {
        vk1: { id: "VariableID:1:2", name: "color/blue/500", resolvedType: "COLOR", variableCollectionId: "VC:1" },
      },
      collectionsById: { "VC:1": { name: "Color" } },
    });
    const result: any = await importLibraryVariable({ variableKey: "vk1" });
    expect(result.importedCount).toBe(1);
    expect(result.variables[0].id).toBe("VariableID:1:2");
    expect(result.variables[0].collectionName).toBe("Color");
  });

  test("imports a batch via variableKeys", async () => {
    installFigmaMock({
      importByKey: {
        vk1: { id: "VariableID:1", name: "a", resolvedType: "COLOR", variableCollectionId: "VC:1" },
        vk2: { id: "VariableID:2", name: "b", resolvedType: "FLOAT", variableCollectionId: "VC:1" },
      },
      collectionsById: { "VC:1": { name: "Color" } },
    });
    const result: any = await importLibraryVariable({ variableKeys: ["vk1", "vk2"] });
    expect(result.importedCount).toBe(2);
    expect(result.variables.map((v: any) => v.id)).toEqual(["VariableID:1", "VariableID:2"]);
  });

  test("missing key fails with a stated fix naming the right enumerator tool", async () => {
    await expect(importLibraryVariable({})).rejects.toThrow(/Fix:/);
    // Regression guard: the fix must name get_enabled_library_variables (the source of
    // importable keys), not the REST tool get_library_variables.
    await expect(importLibraryVariable({})).rejects.toThrow(/get_enabled_library_variables/);
  });

  test("a bad key fails with a stated fix naming the key", async () => {
    installFigmaMock({ importByKey: {} });
    await expect(importLibraryVariable({ variableKey: "ghost" })).rejects.toThrow(/ghost[\s\S]*Fix:/);
  });
});
