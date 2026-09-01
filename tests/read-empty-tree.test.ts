// BUG-027 — `read` must not render an empty transport result as a successful,
// empty document. A `get_node_tree` result with no `rootId` never reached the
// document; serializing it produced `nodeId: undefined` / `nodeCount: 0`, which
// reads as "this node is empty" rather than "this read failed".
//
// Sibling of BUG-016 (tests/export.test.ts), which closed the same hole for
// image results via `hasImageData`.

import { describe, expect, test } from "bun:test";
import { buildMissingTreeResult, hasNodeTree } from "../src/figmagent_mcp/tools/document.js";

describe("hasNodeTree: what counts as a real tree", () => {
  test("accepts a result carrying a rootId", () => {
    expect(hasNodeTree({ rootId: "43:14", rawTree: [], nodeCount: 0 })).toBe(true);
  });

  test("a node with no children is still a real read", () => {
    // The distinction that matters: an empty FRAME has a rootId; a failed
    // transport does not. Only the latter is an error.
    expect(hasNodeTree({ rootId: "1:1", rootName: "Empty Frame", rawTree: [], nodeCount: 0 })).toBe(true);
  });

  test("rejects the empty envelopes the remote path can return", () => {
    expect(hasNodeTree({})).toBe(false);
    expect(hasNodeTree({ rootId: "" })).toBe(false);
    expect(hasNodeTree({ rawTree: [], nodeCount: 0 })).toBe(false);
    expect(hasNodeTree(null)).toBe(false);
    expect(hasNodeTree(undefined)).toBe(false);
    expect(hasNodeTree("")).toBe(false);
  });

  test("rejects a non-string rootId", () => {
    expect(hasNodeTree({ rootId: 4314 })).toBe(false);
  });
});

describe("buildMissingTreeResult: flagged and fix-stating", () => {
  test("sets isError so callers can branch without parsing text", () => {
    expect(buildMissingTreeResult(["43:14"]).isError).toBe(true);
  });

  test("names the requested node and states a fix", () => {
    const text = buildMissingTreeResult(["43:14"]).content[0].text;
    expect(text).toContain("43:14");
    expect(text).toContain("Fix:");
    // Must be caught by the looksLikeError backstop too (start-anchored).
    expect(text.startsWith("Error reading nodes:")).toBe(true);
  });

  test("names every missing node in a multi-node read", () => {
    const text = buildMissingTreeResult(["43:14", "43:15"]).content[0].text;
    expect(text).toContain("43:14");
    expect(text).toContain("43:15");
    expect(text).toContain("nodes ");
  });
});
