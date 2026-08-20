// [TOOL-015] cornerRadius variable binding must fan out to all four corners.
// [BUG-020] use_file must accept url/fileKey aliases and flag a failed
// selection as an error instead of shipping it as success.

import { describe, expect, test } from "bun:test";
import { bindVariableToNode } from "../src/figma_plugin/src/commands/apply.js";
import { looksLikeError } from "../src/figmagent_mcp/instance.js";
import { resolveFileTarget } from "../src/figmagent_mcp/tools/scan.js";

const CORNERS = ["topLeftRadius", "topRightRadius", "bottomLeftRadius", "bottomRightRadius"];

function installFigmaMock(variable: any) {
  (globalThis as any).figma = {
    mixed: Symbol("mixed"),
    variables: {
      getVariableByIdAsync: async (id: string) => (id === variable.id ? variable : null),
    },
  };
}

/** A node exposing only the given corner props, recording every bind. */
function makeNode(type: string, corners: string[]) {
  const bound: Record<string, any> = {};
  const node: any = {
    id: "1:1",
    type,
    setBoundVariable: (field: string, v: any) => {
      bound[field] = v;
    },
  };
  for (const c of corners) node[c] = 0;
  node.__bound = bound;
  return node;
}

describe("[TOOL-015] cornerRadius binds all four corners", () => {
  const variable = { id: "VariableID:1:1", name: "radius/md", scopes: ["ALL_SCOPES"] };

  test("a rectangle-like node gets all four corners bound, not just topLeft", async () => {
    installFigmaMock(variable);
    const node = makeNode("FRAME", CORNERS);
    const warning = await bindVariableToNode(node, "cornerRadius", variable.id);

    expect(Object.keys(node.__bound).sort()).toEqual([...CORNERS].sort());
    expect(warning).toBeNull();
  });

  test("regression: the old behavior bound exactly one corner", async () => {
    installFigmaMock(variable);
    const node = makeNode("RECTANGLE", CORNERS);
    await bindVariableToNode(node, "cornerRadius", variable.id);
    // The bug was a 1-of-4 application reported as full success.
    expect(Object.keys(node.__bound)).toHaveLength(4);
    expect(Object.keys(node.__bound)).not.toEqual(["topLeftRadius"]);
  });

  test("an explicit single corner still binds only that corner", async () => {
    installFigmaMock(variable);
    const node = makeNode("FRAME", CORNERS);
    await bindVariableToNode(node, "topRightRadius", variable.id);
    expect(Object.keys(node.__bound)).toEqual(["topRightRadius"]);
  });

  test("a node exposing only some corners returns a partial warning naming them", async () => {
    installFigmaMock(variable);
    const node = makeNode("POLYGON", ["topLeftRadius", "topRightRadius"]);
    const warning: any = await bindVariableToNode(node, "cornerRadius", variable.id);

    expect(Object.keys(node.__bound).sort()).toEqual(["topLeftRadius", "topRightRadius"]);
    expect(warning).not.toBeNull();
    expect(warning.check).toBe("partial_corner_binding");
    expect(warning.message).toContain("bottomLeftRadius");
    expect(warning.fix).toBeTruthy();
  });

  test("a node with no corner properties fails with a stated fix", async () => {
    installFigmaMock(variable);
    const node = makeNode("ELLIPSE", []);
    let err: any = null;
    try {
      await bindVariableToNode(node, "cornerRadius", variable.id);
    } catch (e) {
      err = e;
    }
    expect(err).not.toBeNull();
    expect(String(err.message)).toContain("corner radius");
    // No user-facing error without a stated fix.
    expect(String(err.message) + String(err.fix ?? "")).toMatch(/FRAME|RECTANGLE/);
  });
});

describe("[BUG-020] use_file target resolution", () => {
  const URL = "https://www.figma.com/design/uwhEpCvlz26oQeK0rql95G/VIP-Workflow";

  test("url is accepted as an alias for channel", () => {
    expect(resolveFileTarget("", URL, undefined)).toBe(URL);
  });

  test("fileKey is accepted as an alias for channel", () => {
    expect(resolveFileTarget("", undefined, "uwhEpCvlz26oQeK0rql95G")).toBe("uwhEpCvlz26oQeK0rql95G");
  });

  test("an explicit channel wins over the aliases", () => {
    expect(resolveFileTarget("my-channel", URL, "abc")).toBe("my-channel");
  });

  test("url wins over fileKey when both are given", () => {
    expect(resolveFileTarget("", URL, "abc")).toBe(URL);
  });

  test("all empty resolves to the empty string", () => {
    expect(resolveFileTarget(undefined, undefined, undefined)).toBe("");
    expect(resolveFileTarget("", "", "")).toBe("");
  });
});

describe("[BUG-020] a failed file selection is flagged as an error", () => {
  // The exact text the remote empty-input branch returns.
  const msg =
    'Error: no file specified. Pass the Figma file URL or fileKey as use_file\'s "channel" parameter — ' +
    'e.g. use_file({ channel: "https://www.figma.com/design/<fileKey>/..." }). ' +
    '"url" and "fileKey" are accepted as aliases. The remote transport has no channels.';

  test("the message matches the start-anchored error sentinel", () => {
    expect(looksLikeError({ content: [{ type: "text", text: msg }] })).toBe(true);
  });

  test("the old message did NOT match — this is the regression", () => {
    const old =
      "Remote transport selects files by fileKey, not channels. Pass a Figma file URL (e.g. https://www.figma.com/design/<fileKey>/...) or a bare fileKey.";
    expect(looksLikeError({ content: [{ type: "text", text: old }] })).toBe(false);
  });

  test("an explicit isError flag is respected regardless of text", () => {
    expect(looksLikeError({ content: [{ type: "text", text: msg }], isError: true })).toBe(true);
  });

  test("the message names the parameter, not just the value", () => {
    expect(msg).toContain('"channel" parameter');
    expect(msg).toContain("use_file({ channel:");
  });
});
