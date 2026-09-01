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
  referencesStdlib,
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
  // when a bind is skipped, so a no-op can't masquerade as success. These tests
  // *execute* the bundled IIFE against a fake `figma` so they exercise the
  // behavior, not just the bundle's textual shape.

  // Build the stdlib IIFE once and instantiate `fig` against a supplied
  // `figma`/`globalThis` stub. The bundle attaches to globalThis.fig.
  async function loadFig(figmaStub: unknown): Promise<{
    bindVariable: (node: unknown, field: string, variableId: string) => Promise<unknown>;
  }> {
    const code = await getDomainBundle("stdlib");
    const sandboxGlobal: { figma?: unknown; fig?: unknown } = {};
    // The IIFE reads `globalThis` (we pass our sandbox) and `figma` (a free
    // variable we provide as a function arg). Return the attached fig surface.
    const factory = new Function("globalThis", "figma", `${code}\nreturn globalThis.fig;`);
    return factory(sandboxGlobal, figmaStub) as ReturnType<typeof loadFig> extends Promise<infer T> ? T : never;
  }

  // A fake variable with the given scopes, plus a `figma` whose paint binder
  // tags the paint so we can assert the bind actually happened.
  function makeFigma(scopes: string[]) {
    const boundPaints: unknown[] = [];
    return {
      figma: {
        variables: {
          getVariableByIdAsync: async (_id: string) => ({ id: _id, name: "color/primary", scopes }),
          setBoundVariableForPaint: (paint: object, _f: string, v: { id: string }) => {
            const bound = Object.assign({}, paint, { boundVariables: { color: { id: v.id } } });
            boundPaints.push(bound);
            return bound;
          },
        },
      },
      boundPaints,
    };
  }

  test("bindVariable binds BOTH fill and stroke paints via setBoundVariableForPaint", async () => {
    // ALL_SCOPES covers both the FRAME fill and the stroke field.
    const { figma, boundPaints } = makeFigma(["ALL_SCOPES"]);
    const fig = await loadFig(figma);

    const fillNode = { id: "1:1", type: "FRAME", fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0 } }] };
    const strokeNode = { id: "1:2", type: "FRAME", strokes: [{ type: "SOLID", color: { r: 0, g: 0, b: 0 } }] };

    expect(await fig.bindVariable(fillNode, "fill", "VariableID:1")).toBeNull();
    expect(await fig.bindVariable(strokeNode, "stroke", "VariableID:1")).toBeNull();

    // Both paint binds routed through setBoundVariableForPaint (the #63 fix).
    expect(boundPaints.length).toBe(2);
    // And the bound paint was written back onto the node's fills/strokes.
    expect((fillNode.fills[0] as { boundVariables?: unknown }).boundVariables).toBeDefined();
    expect((strokeNode.strokes[0] as { boundVariables?: unknown }).boundVariables).toBeDefined();
  }, 30000);

  test("bindVariable THROWS on a scope mismatch (no silent no-op) with message + fix", async () => {
    // STROKE_COLOR variable, but we bind it to a fill field → scope mismatch.
    const { figma, boundPaints } = makeFigma(["STROKE_COLOR"]);
    const fig = await loadFig(figma);
    const node = { id: "1:3", type: "FRAME", fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0 } }] };

    let thrown: Error | null = null;
    try {
      await fig.bindVariable(node, "fill", "VariableID:1");
    } catch (e) {
      thrown = e as Error;
    }
    expect(thrown).not.toBeNull();
    // The fail() error carries the descriptive message AND the stated fix.
    expect(thrown!.message).toContain("Skipped binding");
    expect(thrown!.message).toContain("Fix:");
    // No double period (the structured {message, fix} fix — issue #74 review).
    expect(thrown!.message).not.toContain("..");
    // The mismatched bind was NOT applied (loud failure, not silent no-op).
    expect(boundPaints.length).toBe(0);
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

// ─── [TOOL-029]: the 30K stdlib bundle is prepended only when it is needed ───
// Measured: the bundle is 30,375 of the 49,000-char script budget (62%), yet
// only ~18% of real run_script calls reference fig.* at all. Gate condition:
//   stdlib !== false && (referencesStdlib(code) || mode === "write")

const FIGMA_ONLY_SCRIPT = `
const page = figma.currentPage;
const frames = page.children.filter((c) => c.type === "FRAME");
return frames.map((f) => ({ id: f.id, name: f.name, width: f.width }));
`;

/**
 * The bundle's attach site — present iff the stdlib was prepended. Matched on
 * the minified assignment (`globalThis.fig=`), not a bare `globalThis.fig`,
 * because the mode "write" postlude mentions globalThis.fig on its own.
 */
function hasStdlibBundle(script: string): boolean {
  return script.startsWith("(()=>{") && script.includes("globalThis.fig=");
}

describe("stdlib reference detection", () => {
  test("detects a bare fig.* call", () => {
    expect(referencesStdlib('const n = fig.prop(node, "name");')).toBe(true);
    expect(referencesStdlib("return await fig.serialize(id);")).toBe(true);
    expect(referencesStdlib("  fig.check(ids)")).toBe(true);
    // start-of-string is not a word character, so a leading fig. still matches
    expect(referencesStdlib('fig.setCharacters(t, "hi");')).toBe(true);
  });

  test("detects the explicit global form", () => {
    expect(referencesStdlib("await globalThis.fig.check(ids);")).toBe(true);
    expect(referencesStdlib("self.fig.prop(n, 'x')")).toBe(true);
  });

  test("does NOT match a fig-suffixed identifier or an unrelated .fig. member", () => {
    expect(referencesStdlib("myfig.prop(node);")).toBe(false);
    expect(referencesStdlib("const c = config.fig.enabled;")).toBe(false);
    expect(referencesStdlib("theme.fig.color")).toBe(false);
    expect(referencesStdlib("$fig.prop(n)")).toBe(false);
    expect(referencesStdlib("_fig.serialize(id)")).toBe(false);
  });

  test("does NOT match raw figma.* code", () => {
    expect(referencesStdlib(FIGMA_ONLY_SCRIPT)).toBe(false);
    expect(referencesStdlib('await figma.getNodeByIdAsync("1:2");')).toBe(false);
    // figma. shares the fig prefix but is not a stdlib reference
    expect(referencesStdlib("figma.currentPage.selection")).toBe(false);
  });
});

describe("conditional stdlib inclusion", () => {
  test("read mode + fig.* reference → stdlib IS prepended", async () => {
    const script = await assembleRunScript(READ_ONLY_SCRIPT, "read");
    expect(hasStdlibBundle(script)).toBe(true);
    expect(script.length).toBeGreaterThan(30000);
  }, 30000);

  test("read mode + figma.*-only code → stdlib is NOT prepended", async () => {
    const script = await assembleRunScript(FIGMA_ONLY_SCRIPT, "read");
    expect(hasStdlibBundle(script)).toBe(false);
    // user code + wrapper only — the whole assembled script stays tiny
    expect(script.length).toBeLessThan(FIGMA_ONLY_SCRIPT.length + 500);
    expect(script).toContain(FIGMA_ONLY_SCRIPT);
    expect(script).toContain("const __result = await __userScript();");
  }, 30000);

  test("a .fig. member read does NOT drag the bundle in", async () => {
    const script = await assembleRunScript("const c = config.fig.enabled; return c;", "read");
    expect(hasStdlibBundle(script)).toBe(false);
  }, 30000);

  test("a myfig. identifier does NOT drag the bundle in", async () => {
    const script = await assembleRunScript("return myfig.prop(figma.currentPage);", "read");
    expect(hasStdlibBundle(script)).toBe(false);
  }, 30000);

  test("mode 'write' includes the stdlib even for figma.*-only code (fig.check postlude)", async () => {
    const script = await assembleRunScript("const r = figma.createFrame(); return { nodeIds: [r.id] };", "write");
    expect(hasStdlibBundle(script)).toBe(true);
    expect(script).toContain("__warnings = await globalThis.fig.check(__result.nodeIds);");
  }, 30000);

  test("stdlib: false forces omission — even when the code references fig.", async () => {
    const script = await assembleRunScript(READ_ONLY_SCRIPT, "read", false);
    expect(hasStdlibBundle(script)).toBe(false);
    expect(script).toContain(READ_ONLY_SCRIPT);
  }, 30000);

  test("stdlib: false forces omission in write mode, and the check postlude self-guards", async () => {
    const script = await assembleRunScript(
      "const r = figma.createFrame(); return { nodeIds: [r.id] };",
      "write",
      false,
    );
    expect(script).not.toContain("globalThis.fig.prop");
    // the postlude is still emitted, but skips itself when fig is absent
    expect(script).toContain("if (globalThis.fig && __result");
    expect(script).toContain("return JSON.stringify(__out);");
    expect(script.length).toBeLessThan(1000);
  }, 30000);

  test("stdlib: true (the default) still means 'when needed', not 'always'", async () => {
    const script = await assembleRunScript(FIGMA_ONLY_SCRIPT, "read", true);
    expect(hasStdlibBundle(script)).toBe(false);
  }, 30000);

  test("budget: dropping the bundle returns ~30K of the 49,000-char budget", async () => {
    const BUDGET = 49000;
    const withStdlib = await assembleRunScript(
      FIGMA_ONLY_SCRIPT.replace("figma.currentPage", "fig.prop(figma, 'currentPage')"),
      "read",
    );
    const without = await assembleRunScript(FIGMA_ONLY_SCRIPT, "read");
    const bundleCost = await getDomainBundle("stdlib");

    expect(bundleCost.length).toBeGreaterThan(25000);
    expect(withStdlib.length - without.length).toBeGreaterThan(25000);
    // headroom for user code: ~18.6K with the bundle vs ~48.6K without
    expect(BUDGET - withStdlib.length).toBeLessThan(20000);
    expect(BUDGET - without.length).toBeGreaterThan(48000);
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
