// Task 4.4: run_script escape hatch — read-mode deny-list guard, plugin
// transport refusal, stdlib bundle surface, script assembly wrapper, and
// full-script session logging.

import { afterEach, describe, expect, test } from "bun:test";
import { getDomainBundle } from "../src/figmagent_mcp/remote/bundles";
import { recordToolCall, getSessionLog } from "../src/figmagent_mcp/session-logger";
import { resetFileKeyForTests } from "../src/figmagent_mcp/remote/filecontext";
import { resetTransportForTests } from "../src/figmagent_mcp/transport";
import {
  PLUGIN_TRANSPORT_REFUSAL,
  assembleRunScript,
  findWriteCall,
  runScriptHandler,
} from "../src/figmagent_mcp/tools/script";

const READ_ONLY_SCRIPT = `
const node = await figma.getNodeByIdAsync("1:2");
const tree = await fig.serialize(node, "structure");
const name = fig.prop(node, "name");
return { tree, name };
`;

describe("read-mode deny-list guard", () => {
  test("blocks figma.createRectangle", () => {
    expect(findWriteCall("const r = figma.createRectangle(); return r.id;")).toBe("createRectangle");
  });

  test("blocks .remove(", () => {
    expect(findWriteCall('const n = await figma.getNodeByIdAsync("1:2"); n.remove();')).toBe(".remove()");
  });

  test("blocks .appendChild( and .insertChild(", () => {
    expect(findWriteCall("parent.appendChild(node);")).toBe(".appendChild()");
    expect(findWriteCall("parent.insertChild(0, node);")).toBe(".insertChild()");
  });

  test("blocks setProperties / setBoundVariable / setBoundVariableForPaint", () => {
    expect(findWriteCall('instance.setProperties({ "Label#1:0": "Hi" });')).toBe("setProperties");
    expect(findWriteCall('node.setBoundVariable("opacity", v);')).toBe("setBoundVariable");
    expect(findWriteCall('figma.variables.setBoundVariableForPaint(p, "color", v);')).toBe("setBoundVariableForPaint");
  });

  test("blocks combineAsVariants and createImage", () => {
    expect(findWriteCall("figma.combineAsVariants(nodes, page);")).toBe("combineAsVariants");
    expect(findWriteCall("const img = figma.createImage(bytes);")).toBe("createImage");
  });

  test("blocks stdlib write helpers (fig.createNode, fig.setCharacters, fig.bindVariable)", () => {
    expect(findWriteCall('await fig.createNode({ type: "FRAME" });')).toBe("createNode");
    expect(findWriteCall('await fig.setCharacters(node, "hello");')).toBe("setCharacters");
    expect(findWriteCall('await fig.bindVariable(node, "fill", "VariableID:1");')).toBe("bindVariable");
  });

  test("blocks loadFontAsync only when paired with assignment", () => {
    expect(findWriteCall("await figma.loadFontAsync(f); node.fontName = f;")).toBe("loadFontAsync");
    // loadFontAsync without any property assignment is read-safe
    expect(findWriteCall("await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });")).toBeNull();
  });

  test("allows read-only code", () => {
    expect(findWriteCall(READ_ONLY_SCRIPT)).toBeNull();
    expect(findWriteCall("return figma.currentPage.children.map((c) => c.id);")).toBeNull();
    // comparisons are not assignments
    expect(findWriteCall("if (node.width === 100) return true;")).toBeNull();
  });
});

describe("run_script transport gating", () => {
  const savedTransport = process.env.FIGMA_TRANSPORT;

  afterEach(() => {
    if (savedTransport === undefined) delete process.env.FIGMA_TRANSPORT;
    else process.env.FIGMA_TRANSPORT = savedTransport;
    resetTransportForTests();
  });

  test("plugin transport refuses with the fix", async () => {
    process.env.FIGMA_TRANSPORT = "plugin";
    resetTransportForTests();
    const result = await runScriptHandler({ code: "return 1;", mode: "read", description: "noop" });
    expect(result.content[0].text).toBe(PLUGIN_TRANSPORT_REFUSAL);
    expect(result.content[0].text).toContain("run_script requires the remote transport");
    expect(result.content[0].text).toContain("FIGMA_TRANSPORT=remote");
  });

  test("read mode rejects a mutating script with the spec message (before any network)", async () => {
    process.env.FIGMA_TRANSPORT = "remote";
    resetTransportForTests();
    const result = await runScriptHandler({
      code: "const r = figma.createRectangle(); return r.id;",
      mode: "read",
      description: "should be rejected",
    });
    expect(result.content[0].text).toBe(
      "This script calls createRectangle but mode is 'read'; rerun with mode: 'write'.",
    );
  });

  test("write mode passes the guard (fails later on file resolution, not the deny list)", async () => {
    process.env.FIGMA_TRANSPORT = "remote";
    resetTransportForTests();
    resetFileKeyForTests();
    delete process.env.FIGMA_FILE_KEY;
    const result = await runScriptHandler({
      code: "const r = figma.createRectangle(); return { nodeIds: [r.id] };",
      mode: "write",
      description: "guard passthrough",
    });
    // No fileKey set in tests → the next gate after the guard is file resolution.
    expect(result.content[0].text).not.toContain("rerun with mode: 'write'");
    expect(result.content[0].text).toContain("No Figma file selected");
  });
});

describe("stdlib bundle", () => {
  test("builds, stays well under 40KB, and exposes the fig.* surface", async () => {
    const code = await getDomainBundle("stdlib");
    expect(code.length).toBeGreaterThan(0);
    expect(code.length).toBeLessThan(40000);
    // user-facing namespace is fig, not __figmagent
    expect(code).toContain("fig");
    for (const name of ["prop", "setCharacters", "loadFont", "serialize", "bindVariable", "check", "createNode"]) {
      expect(code).toContain(name);
    }
  }, 30000);

  // Issue #63: fig.bindVariable must bind BOTH fill and stroke paints (via
  // setBoundVariableForPaint) and must throw — not silently return a warning —
  // when a bind is skipped, so a no-op can't masquerade as success.
  test("bindVariable binds paints via setBoundVariableForPaint and throws on warnings", async () => {
    const code = await getDomainBundle("stdlib");
    // The shared bindVariableToNode path routes fill AND stroke paint binding
    // through the known-good Plugin API.
    expect(code).toContain("setBoundVariableForPaint");
    expect(code).toContain("strokes");
    // The fig.bindVariable wrapper inspects the returned warning and raises it
    // instead of returning it (a returned warning has a .message; the wrapper
    // surfaces it through the fail() error helper rather than `return warning`).
    expect(code).toContain(".message");
    // The wrapper returns null on success (no warning) — never the warning object.
    expect(code).toMatch(/bindVariable:\s*\([^)]*\)\s*=>/);
  }, 30000);
});

describe("script assembly", () => {
  test("read mode: stdlib + wrapped user code + plain result return", async () => {
    const script = await assembleRunScript(READ_ONLY_SCRIPT, "read");
    expect(script).toContain("globalThis.fig");
    expect(script).toContain(READ_ONLY_SCRIPT);
    expect(script).toContain("const __userScript = async () => {");
    expect(script).toContain("const __result = await __userScript();");
    expect(script).toContain("return JSON.stringify({ result: __result === undefined ? null : __result });");
    // no post-run check wrapper in read mode
    expect(script).not.toContain("fig.check(__result.nodeIds)");
  }, 30000);

  test("write mode: appends the { nodeIds } fig.check wrapper", async () => {
    const userCode = "const r = await fig.createNode({ type: 'FRAME' }); return { nodeIds: [r.tree.id] };";
    const script = await assembleRunScript(userCode, "write");
    expect(script).toContain(userCode);
    expect(script).toContain("Array.isArray(__result.nodeIds)");
    expect(script).toContain("__warnings = await globalThis.fig.check(__result.nodeIds);");
    expect(script).toContain("if (__warnings.length > 0) __out.warnings = __warnings;");
    expect(script).toContain("return JSON.stringify(__out);");
  }, 30000);
});

describe("session logging", () => {
  test("run_script params (the full script) are logged untruncated", () => {
    const longScript = "// recurring scripts are the tool roadmap\n" + "x".repeat(2000);
    recordToolCall(
      "run_script",
      { code: longScript, mode: "read", description: "log test" },
      performance.now(),
      true,
      42,
    );
    const log = getSessionLog();
    expect(log).not.toBeNull();
    const entry = log!.toolCalls[log!.toolCalls.length - 1];
    expect(entry.tool).toBe("run_script");
    expect(entry.params).toContain("x".repeat(2000));
    expect(entry.params.length).toBeGreaterThan(500);
  });

  test("other tools' params remain truncated at 500 chars", () => {
    recordToolCall("read", { nodeId: "1:2", filler: "y".repeat(2000) }, performance.now(), true, 10);
    const log = getSessionLog();
    const entry = log!.toolCalls[log!.toolCalls.length - 1];
    expect(entry.params.length).toBe(500);
    expect(entry.params.endsWith("...")).toBe(true);
  });
});
