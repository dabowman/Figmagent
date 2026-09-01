// Two rejections from the same family: the schema refused a shape an agent would
// naturally send, and explained itself with a raw Zod dump instead of a fix.
//
// [BUG-021] grep's array criteria rejected a bare string ("COMPONENT"), the shape
//           every scalar param in the tool takes. Session 40 burned a round-trip.
// [BUG-030] edit's `variables` used z.record(enum, …), which repeats the whole
//           field enum once PER KEY — a two-key call produced a 10,040-char
//           rejection and discarded the entire batch.

import { describe, expect, test } from "bun:test";
import { nodeOpSchema } from "../src/figmagent_mcp/tools/apply.js";

import { stringArray } from "../src/figmagent_mcp/tools/find.js";

describe("[BUG-021] grep array criteria accept the shapes agents send", () => {
  test("a bare string becomes a one-element array — the session-40 case", () => {
    expect(stringArray.parse("COMPONENT")).toEqual(["COMPONENT"]);
  });

  test("an array passes through untouched", () => {
    expect(stringArray.parse(["COMPONENT", "FRAME"])).toEqual(["COMPONENT", "FRAME"]);
  });

  test("a comma-separated string splits, trimming whitespace", () => {
    expect(stringArray.parse("COMPONENT,FRAME")).toEqual(["COMPONENT", "FRAME"]);
    expect(stringArray.parse("COMPONENT, FRAME")).toEqual(["COMPONENT", "FRAME"]);
  });

  test("empty segments are dropped rather than becoming empty criteria", () => {
    // "" would otherwise match nothing and silently narrow the search.
    expect(stringArray.parse("COMPONENT,,FRAME")).toEqual(["COMPONENT", "FRAME"]);
    expect(stringArray.parse("")).toEqual([]);
  });
});

describe("[BUG-030] edit's variables rejection names the fix", () => {
  function reject(variables: Record<string, string>) {
    const r = nodeOpSchema.safeParse({ nodeId: "1:1", variables });
    expect(r.success).toBe(false);
    return r.success ? "" : r.error.issues.map((i) => i.message).join("\n");
  }

  test("fontWeight is redirected to fontStyle, the actual bindable field", () => {
    const msg = reject({ fontWeight: "VariableID:1" });
    expect(msg).toContain("fontStyle");
    expect(msg).toContain("STRING");
    expect(msg).toContain("Fix:");
  });

  test("the rejection is short — the whole point of the issue", () => {
    // The reported failure was 10,040 chars: the field enum, repeated per key.
    const msg = reject({ fontWeight: "VariableID:1", fillColor: "VariableID:2" });
    expect(msg.length).toBeLessThan(500);
  });

  test("both bad keys are named in one message, not one dump each", () => {
    const msg = reject({ fontWeight: "VariableID:1", fillColor: "VariableID:2" });
    expect(msg).toContain("fontWeight");
    expect(msg).toContain("fillColor");
  });

  test("colour aliases point at the bindable names", () => {
    expect(reject({ fillColor: "VariableID:1" })).toContain('bind "fill"');
    expect(reject({ strokeColor: "VariableID:1" })).toContain('bind "stroke"');
  });

  test("an unrecognized name with no alias still lists the valid fields", () => {
    const msg = reject({ nonsense: "VariableID:1" });
    expect(msg).toContain("valid bindable fields");
    expect(msg).toContain("fontSize");
  });

  test("valid bindings still parse", () => {
    const r = nodeOpSchema.safeParse({
      nodeId: "1:1",
      variables: { fill: "VariableID:1", cornerRadius: "VariableID:2" },
    });
    expect(r.success).toBe(true);
  });

  test("the failure names the node, so a batch rejection is traceable", () => {
    expect(reject({ fontWeight: "VariableID:1" })).toContain("1:1");
  });
});
