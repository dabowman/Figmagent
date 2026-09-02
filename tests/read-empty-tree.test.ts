// BUG-027 — `read` must not render an empty transport result as a successful,
// empty document. A `get_node_tree` result with no `rootId` never reached the
// document; serializing it produced `nodeId: undefined` / `nodeCount: 0`, which
// reads as "this node is empty" rather than "this read failed".
//
// Sibling of BUG-016 (tests/export.test.ts), which closed the same hole for
// image results via `hasImageData`.
//
// Refusing to render the empty result must not cost the nodes that DID arrive:
// `buildReadResult` returns every subtree that survived and names the ones that
// did not, whether they came back empty or rejected outright.

import { describe, expect, test } from "bun:test";
import { looksLikeError } from "../src/figmagent_mcp/instance.js";
import {
  buildMissingDocumentResult,
  buildMissingTreeResult,
  buildReadResult,
  hasDocumentInfo,
  hasNodeTree,
} from "../src/figmagent_mcp/tools/document.js";

const tree = (id: string) => ({
  rootId: id,
  rootName: `Frame ${id}`,
  rootType: "FRAME",
  nodeCount: 1,
  rawTree: [{ id, name: `Frame ${id}`, type: "FRAME" }],
});

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

  test("the TEXT alone trips the real looksLikeError matcher, not just the flag", () => {
    // looksLikeError short-circuits on an explicit isError, so asserting on the
    // built result would never exercise the regex. Drop the flag and check the
    // backstop actually matches — that is the claim "start-anchored with
    // `Error reading nodes:`" is making, for any caller that ignores isError.
    for (const ids of [["43:14"], ["43:14", "43:15"]]) {
      const text = buildMissingTreeResult(ids).content[0].text;
      expect(looksLikeError({ content: [{ type: "text", text }] })).toBe(true);
    }
    // Same for the overview branch's "Error reading document:" prefix.
    const doc = buildMissingDocumentResult().content[0].text;
    expect(looksLikeError({ content: [{ type: "text", text: doc }] })).toBe(true);
  });

  test("names every missing node in a multi-node read", () => {
    const text = buildMissingTreeResult(["43:14", "43:15"]).content[0].text;
    expect(text).toContain("43:14");
    expect(text).toContain("43:15");
    expect(text).toContain("nodes ");
  });

  test("prescribes a smaller payload, not a verbatim retry", () => {
    // Sessions 51/52: identical params reproduced the failure; the same node
    // read cleanly at detail="structure" / a lower depth. The guard text must
    // point there, and must not assert a cause it cannot observe.
    const text = buildMissingTreeResult(["43:22"]).content[0].text;
    expect(text).toContain("depth");
    expect(text).toContain('detail="structure"');
    expect(text).not.toContain("43-14");
  });
});

describe("buildReadResult: partial reads keep the nodes that arrived", () => {
  const params = { detail: "structure" };

  test("renders one block per node when every node arrived", () => {
    const result = buildReadResult(["1:1", "2:2"], [tree("1:1"), tree("2:2")], params);
    expect(result.isError).toBeUndefined();
    expect(result.content).toHaveLength(1);
    expect(result.content[0].text).toContain("1:1");
    expect(result.content[0].text).toContain("2:2");
    expect(result.content[0].text).toContain("\n---\n");
  });

  test("a single failed node fails the whole call", () => {
    const result = buildReadResult(["43:22"], [null], params);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("43:22");
  });

  test("all nodes failed → flagged error, nothing rendered", () => {
    const result = buildReadResult(["1:1", "2:2"], ["<truncated response>", {}], params);
    expect(result.isError).toBe(true);
    expect(result.content).toHaveLength(1);
    expect(result.content[0].text).toContain("1:1");
    expect(result.content[0].text).toContain("2:2");
  });

  test("partial failure keeps the good subtrees and names the missing one", () => {
    // The batch that fails is the batch worth keeping: re-issuing it reproduces
    // the failure, so throwing away two good subtrees costs a full re-read.
    const result = buildReadResult(["1:1", "43:22", "2:2"], [tree("1:1"), null, tree("2:2")], params);
    expect(result.isError).toBeUndefined();
    expect(result.content).toHaveLength(2);
    expect(result.content[0].text).toContain("1:1");
    expect(result.content[0].text).toContain("2:2");
    // The failed node is never rendered as an empty document…
    expect(result.content[0].text).not.toContain("nodeId: undefined");
    // …and its failure is stated, with a fix, in a trailing block.
    expect(result.content[1].text).toContain("43:22");
    expect(result.content[1].text).toContain("Fix:");
  });

  test("a rejected node reports its own reason, verbatim, and keeps its siblings", () => {
    // One stale id used to reject the whole Promise.all and discard every good
    // subtree with it. The reason still reaches the agent unchanged.
    const errors = new Map([["43-14", "Node not found: 43-14"]]);
    const result = buildReadResult(["1:1", "43-14"], [tree("1:1"), undefined], params, errors);
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("1:1");
    expect(result.content[1].text).toContain("Node not found: 43-14");
    // The id is named even though the reason happens to embed it: the caller
    // has to know WHICH of the ids it asked for is missing from the output.
    expect(result.content[1].text).toBe("Error reading nodes: 43-14: Node not found: 43-14");
  });

  test("a PARTIAL failure names every missing id even when the reason repeats", () => {
    // Regression: collapsing a repeated reason to a bare message is right for a
    // whole-call cause, but in a partial read it dropped the ids entirely —
    // "Error reading nodes: Node not found" told the caller nothing about which
    // two of its four nodes were absent from the rendered output.
    const errors = new Map([
      ["43:9", "Node not found"],
      ["43:22", "Node not found"],
    ]);
    const result = buildReadResult(
      ["1:1", "43:9", "2:2", "43:22"],
      [tree("1:1"), undefined, tree("2:2"), undefined],
      params,
      errors,
    );
    expect(result.isError).toBeUndefined();
    expect(result.content).toHaveLength(2);
    expect(result.content[1].text).toContain("43:9");
    expect(result.content[1].text).toContain("43:22");
  });

  test("a single rejected node still fails the whole call with its own message", () => {
    const errors = new Map([["43-14", "Node not found: 43-14"]]);
    const result = buildReadResult(["43-14"], [undefined], params, errors);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe("Error reading nodes: Node not found: 43-14");
  });

  test("one shared reason (connection loss) is stated once, not once per id", () => {
    const errors = new Map([
      ["1:1", "Not connected to Figma. Attempting to connect..."],
      ["2:2", "Not connected to Figma. Attempting to connect..."],
    ]);
    const result = buildReadResult(["1:1", "2:2"], [undefined, undefined], params, errors);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe("Error reading nodes: Not connected to Figma. Attempting to connect...");
  });

  test("mixed silent-empty and reported failures name both", () => {
    const errors = new Map([["2:2", 'Read operation "get_node_tree" timed out after 60s']]);
    const result = buildReadResult(["43:22", "2:2"], [null, undefined], params, errors);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("43:22");
    expect(result.content[0].text).toContain("timed out");
    expect(result.content[0].text).toContain("Fix:");
  });

  test("a partial read stays is_error: false (project convention)", () => {
    const result = buildReadResult(["1:1", "43:22"], [tree("1:1"), null], params);
    // The failure block is trailing, so the start-anchored backstop leaves the
    // response unflagged — same rule as a partial edit/write batch.
    expect(looksLikeError(result)).toBe(false);
  });
});

describe("hasDocumentInfo / buildMissingDocumentResult: the overview branch", () => {
  test("accepts a real overview", () => {
    expect(hasDocumentInfo({ id: "0:1", name: "Page 1", children: [], pages: [] })).toBe(true);
    expect(hasDocumentInfo({ pages: [{ id: "0:1" }] })).toBe(true);
  });

  test("rejects the envelopes a failed round trip leaves behind", () => {
    expect(hasDocumentInfo(null)).toBe(false);
    expect(hasDocumentInfo(undefined)).toBe(false);
    expect(hasDocumentInfo({})).toBe(false);
    expect(hasDocumentInfo("<!doctype html>")).toBe(false);
  });

  test("the failure is flagged and states a fix", () => {
    const result = buildMissingDocumentResult();
    expect(result.isError).toBe(true);
    expect(result.content[0].text.startsWith("Error reading document:")).toBe(true);
    expect(result.content[0].text).toContain("Fix:");
  });
});
