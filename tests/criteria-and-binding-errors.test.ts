// Two rejections from the same family: the schema refused a shape an agent would
// naturally send, and explained itself with a raw Zod dump instead of a fix.
//
// [BUG-021] grep's array criteria rejected a bare string ("COMPONENT"), the shape
//           every scalar param in the tool takes. Session 40 burned a round-trip.
// [BUG-030] edit's `variables` used z.record(enum, …), which repeats the whole
//           field enum once PER KEY — a two-key call produced a 10,040-char
//           rejection and discarded the entire batch.

import { toJsonSchemaCompat } from "@modelcontextprotocol/sdk/server/zod-json-schema-compat.js";
import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { nodeOpSchema } from "../src/figmagent_mcp/tools/apply.js";
import { NO_CRITERION_ERROR, grepInputShape } from "../src/figmagent_mcp/tools/find.js";

import { idListParam, stringListParam } from "../src/figmagent_mcp/utils.js";

describe("[BUG-021] grep array criteria accept the shapes agents send", () => {
  test("a bare string becomes a one-element array — the session-40 case", () => {
    expect(stringListParam().parse("COMPONENT")).toEqual(["COMPONENT"]);
  });

  test("an array passes through untouched", () => {
    expect(stringListParam().parse(["COMPONENT", "FRAME"])).toEqual(["COMPONENT", "FRAME"]);
  });

  test("a comma-separated string splits, trimming whitespace", () => {
    expect(stringListParam().parse("COMPONENT,FRAME")).toEqual(["COMPONENT", "FRAME"]);
    expect(stringListParam().parse("COMPONENT, FRAME")).toEqual(["COMPONENT", "FRAME"]);
  });

  test("empty segments are dropped between real values", () => {
    expect(stringListParam().parse("COMPONENT,,FRAME")).toEqual(["COMPONENT", "FRAME"]);
  });

  test("a criterion that normalizes to nothing is rejected, not passed on as []", () => {
    // An empty list reaches the plugin as an id set that matches nothing, so the
    // call would return zero results with no error. Say so instead.
    for (const empty of ["", ",,", "   ", []]) {
      const r = stringListParam().safeParse(empty);
      expect(r.success).toBe(false);
      if (!r.success) expect(r.error.issues[0].message).toContain("Fix:");
    }
  });

  test("styleId keeps the comma Figma puts inside style IDs", () => {
    // Style IDs are "S:<key>,<localId>" — splitting one yields a criterion that
    // can never match, so grep would silently report zero matches.
    expect(idListParam().parse("S:abc123,")).toEqual(["S:abc123,"]);
    expect(idListParam().parse("S:abc123,4:5")).toEqual(["S:abc123,4:5"]);
    expect(idListParam().parse(["S:abc123,", "S:def456,"])).toEqual(["S:abc123,", "S:def456,"]);
  });

  test("styleId still rejects an empty value with a stated fix", () => {
    const r = idListParam().safeParse("");
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toContain("Fix:");
  });
});

// The tests above prove the helpers behave; they do NOT prove grep uses them.
// Reverting the four criteria back to z.array(z.string()) while leaving the
// helpers exported reintroduces BUG-021 with every helper test still green —
// verified by doing exactly that. These assertions go through grep's own
// registered input shape, so the wiring is what is under test.
describe("[BUG-021] the coercion is wired into grep, not merely available", () => {
  // Mirrors how the MCP SDK parses tool arguments: z.object(shape), strip mode.
  const grepArgs = z.object(grepInputShape);
  const parse = (args: Record<string, unknown>) => grepArgs.parse(args) as Record<string, unknown>;

  test("every array criterion accepts a scalar through the real tool schema", () => {
    expect(parse({ type: "COMPONENT" }).type).toEqual(["COMPONENT"]);
    expect(parse({ componentId: "1:2" }).componentId).toEqual(["1:2"]);
    expect(parse({ variableId: "VariableID:1:2" }).variableId).toEqual(["VariableID:1:2"]);
    expect(parse({ styleId: "S:abc123,4:5" }).styleId).toEqual(["S:abc123,4:5"]);
  });

  test("scalar, comma-separated and array forms are interchangeable", () => {
    const scalar = parse({ type: "COMPONENT" }).type;
    const comma = parse({ type: "COMPONENT,FRAME" }).type;
    expect(scalar).toEqual(parse({ type: ["COMPONENT"] }).type);
    expect(comma).toEqual(parse({ type: ["COMPONENT", "FRAME"] }).type);
  });

  test("styleId is NOT comma-split by the tool schema", () => {
    // The trailing comma is part of the id. Splitting it yields a criterion the
    // plugin's exact-equality check can never satisfy — zero matches, no error.
    expect(parse({ styleId: "S:abc123," }).styleId).toEqual(["S:abc123,"]);
  });

  test("a criterion that carries no value is rejected by the tool schema", () => {
    // Not merely normalized to []: find.js length-guards only `type`, so an
    // empty componentId/variableId/styleId builds an id set that matches nothing
    // while hasCriteria still passes on a sibling criterion.
    for (const args of [{ componentId: "" }, { variableId: ",," }, { styleId: "  " }, { type: ["FRAME", ""] }]) {
      const r = grepArgs.safeParse(args);
      expect(r.success).toBe(false);
      if (!r.success) expect(r.error.issues.map((i) => i.message).join(" ")).toContain("Fix:");
    }
  });

  test("the no-criterion error names the invented params, not just the valid ones", () => {
    expect(NO_CRITERION_ERROR).toContain("searchIn");
    expect(NO_CRITERION_ERROR).toContain("nodeTypes");
    expect(NO_CRITERION_ERROR).toContain("Fix:");
    // Must stay start-anchored on "Error" so instance.ts flags it as is_error.
    expect(NO_CRITERION_ERROR.startsWith("Error:")).toBe(true);
  });

  test("each criterion keeps its own description in the advertised schema", () => {
    // The helpers are factories for this reason: one shared schema instance
    // makes zod-to-json-schema emit the later fields as a bare $ref, and a
    // consumer applying draft-07 $ref semantics drops the sibling description —
    // which is exactly where "accepts a bare string" is documented.
    const js = toJsonSchemaCompat(z.object(grepInputShape) as never, { strictUnions: true } as never) as {
      properties: Record<string, { $ref?: string; anyOf?: unknown[]; description?: string }>;
    };
    for (const key of ["componentId", "variableId", "styleId", "type"]) {
      expect(js.properties[key].$ref).toBeUndefined();
      // The scalar form must stay visible to an agent reading the schema.
      expect(js.properties[key].anyOf).toHaveLength(2);
      expect(js.properties[key].description).toContain("bare string");
    }
    expect(js.properties.styleId.description).toContain("NOT split");
  });
});

describe("[BUG-030] edit's variables rejection names the fix", () => {
  function reject(variables: Record<string, string>) {
    const r = nodeOpSchema.safeParse({ nodeId: "1:1", variables });
    expect(r.success).toBe(false);
    return r.success ? "" : r.error.issues.map((i) => i.message).join("\n");
  }

  test("[TOOL-037] fontWeight is bindable — a FLOAT weight token, not a fontStyle redirect", () => {
    const r = nodeOpSchema.safeParse({ nodeId: "1:1", variables: { fontWeight: "VariableID:1" } });
    expect(r.success).toBe(true);
  });

  test("the rejection is short — the whole point of the issue", () => {
    // The reported failure was 10,040 chars: the field enum, repeated per key.
    const msg = reject({ textCase: "VariableID:1", fillColor: "VariableID:2" });
    expect(msg.length).toBeLessThan(500);
  });

  test("both bad keys are named in one message, not one dump each", () => {
    const msg = reject({ textCase: "VariableID:1", fillColor: "VariableID:2" });
    expect(msg).toContain("textCase");
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

  test("a mix of aliased and unrecognized names leaves neither without a fix", () => {
    const msg = reject({ fillColor: "VariableID:1", nonsense: "VariableID:2" });
    expect(msg).toContain('bind "fill"');
    expect(msg).toContain("valid bindable fields");
  });

  test("an inherited Object.prototype name is not mistaken for an alias", () => {
    // `ALIASES["toString"]` would otherwise resolve to a native function and be
    // printed as the field to bind instead.
    const msg = reject({ toString: "VariableID:1" });
    expect(msg).not.toContain("native code");
    expect(msg).toContain("valid bindable fields");
  });

  test("the plural FIELD_MAP spellings redirect to the singular bindable name", () => {
    expect(reject({ fills: "VariableID:1" })).toContain('bind "fill"');
    expect(reject({ strokes: "VariableID:1" })).toContain('bind "stroke"');
  });

  test("valid bindings still parse", () => {
    const r = nodeOpSchema.safeParse({
      nodeId: "1:1",
      variables: { fill: "VariableID:1", cornerRadius: "VariableID:2" },
    });
    expect(r.success).toBe(true);
  });

  test("the failure names the node, so a batch rejection is traceable", () => {
    expect(reject({ textCase: "VariableID:1" })).toContain("1:1");
  });
});
