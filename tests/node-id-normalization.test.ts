// [TOOL-022] Figma deep-link URLs encode node IDs with a hyphen (?node-id=43-14);
// the Plugin API wants a colon (43:14). An agent copying an ID out of a URL the
// user pasted got a bare "Node not found" and burned a round-trip — while
// `use_file`, two calls earlier in the same session, accepted the full hyphenated
// URL verbatim. One ID format, accepted by one tool and rejected by the next.
//
// Normalizing at the schema boundary via .transform() means no handler body and
// no wire command changes, so both transports pick it up.

import { describe, expect, test } from "bun:test";
import { normalizeNodeId } from "../src/figmagent_mcp/utils.js";
import { nodeOpSchema } from "../src/figmagent_mcp/tools/apply.js";

describe("normalizeNodeId: converts only the unambiguous URL form", () => {
  test("the URL form becomes colon form", () => {
    expect(normalizeNodeId("43-14")).toBe("43:14");
    expect(normalizeNodeId("0-1")).toBe("0:1");
    expect(normalizeNodeId("1234-5678")).toBe("1234:5678");
  });

  test("an already-correct ID is untouched", () => {
    expect(normalizeNodeId("43:14")).toBe("43:14");
    expect(normalizeNodeId("0:0")).toBe("0:0");
  });

  test("instance-descendant paths are left alone", () => {
    // These already carry colons and semicolons; a blind hyphen swap would corrupt
    // any that contain one.
    expect(normalizeNodeId("I103:1135;66:19")).toBe("I103:1135;66:19");
    expect(normalizeNodeId("I103:1135;I66:19;12:3")).toBe("I103:1135;I66:19;12:3");
  });

  test("non-ID strings pass through — including grep's DOCUMENT scope keyword", () => {
    expect(normalizeNodeId("DOCUMENT")).toBe("DOCUMENT");
    expect(normalizeNodeId("abc-def")).toBe("abc-def");
    expect(normalizeNodeId("Card-Header")).toBe("Card-Header");
    expect(normalizeNodeId("")).toBe("");
  });

  test("only the first hyphen of a two-segment id qualifies — 3-segment forms are not IDs", () => {
    expect(normalizeNodeId("1-2-3")).toBe("1-2-3");
  });

  test("a mixed form is not a URL id and is left alone", () => {
    expect(normalizeNodeId("43:14-2")).toBe("43:14-2");
  });
});

describe("the transform is wired into the schemas", () => {
  test("edit accepts a URL-form nodeId and normalizes it", () => {
    expect(nodeOpSchema.parse({ nodeId: "43-14" }).nodeId).toBe("43:14");
  });

  test("edit leaves an instance-override path intact", () => {
    expect(nodeOpSchema.parse({ nodeId: "I103:1135;66:19" }).nodeId).toBe("I103:1135;66:19");
  });

  test("nested children are normalized too", () => {
    const parsed = nodeOpSchema.parse({ nodeId: "1-2", children: [{ nodeId: "3-4" }] });
    expect(parsed.nodeId).toBe("1:2");
    expect(parsed.children[0].nodeId).toBe("3:4");
  });
});
