// Phase 4.5 — error-message audit: rewritten messages must state their fix.

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { fail as figmaFail } from "../src/figma_plugin/src/helpers.js";
import { combineAsVariants } from "../src/figma_plugin/src/commands/components.js";
import { setTextContent } from "../src/figma_plugin/src/commands/text.js";
import { lintDesign } from "../src/figma_plugin/src/commands/lint.js";

let fakeNodes: Record<string, any>;

beforeEach(() => {
  fakeNodes = {};
  (globalThis as any).figma = {
    getNodeByIdAsync: async (id: string) => fakeNodes[id] || null,
    currentPage: { id: "0:0", type: "PAGE", children: [] },
    mixed: Symbol("mixed"),
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

describe("fail helper", () => {
  test("formats message + fix", () => {
    expect(() => figmaFail("Node not found: 1:1", "search with grep")).toThrow(
      "Node not found: 1:1. Fix: search with grep",
    );
  });
});

describe("rewritten error messages state fixes", () => {
  test("combine_as_variants rejects non-variant names with the naming convention", async () => {
    fakeNodes.c1 = { id: "c1", type: "COMPONENT", name: "Default" };
    fakeNodes.c2 = { id: "c2", type: "COMPONENT", name: "Hover" };
    let message = "";
    try {
      await combineAsVariants({ componentIds: ["c1", "c2"] });
    } catch (e: any) {
      message = e.message;
    }
    expect(message).toContain("variant format");
    expect(message).toContain("Property=Value");
    expect(message).toContain("Fix:");
  });

  test("combine_as_variants unknown component id suggests grep/read", async () => {
    let message = "";
    try {
      await combineAsVariants({ componentIds: ["nope"] });
    } catch (e: any) {
      message = e.message;
    }
    expect(message).toContain("Component not found: nope");
    expect(message).toContain("Fix:");
  });

  test("set_text_content on a non-TEXT node points at grep for the TEXT child", async () => {
    fakeNodes["1:1"] = { id: "1:1", type: "FRAME", name: "frame" };
    let message = "";
    try {
      await setTextContent({ nodeId: "1:1", text: "hello" });
    } catch (e: any) {
      message = e.message;
    }
    expect(message).toContain("not a TEXT node");
    expect(message).toContain("Fix:");
    expect(message).toContain("grep");
  });

  test("lint_design unknown node id suggests read/grep", async () => {
    let message = "";
    try {
      await lintDesign({ nodeId: "404:404" });
    } catch (e: any) {
      message = e.message;
    }
    expect(message).toContain("Node not found: 404:404");
    expect(message).toContain("Fix:");
  });
});
