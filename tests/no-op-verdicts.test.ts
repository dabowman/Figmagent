// Three ways a response misrepresented what happened:
//
// [BUG-026] run_script's mode-mismatch rejection shipped as is_error: false —
//           nothing ran, but a caller branching on is_error saw a result.
// [BUG-024] set_focus / set_selections are deliberate no-ops on remote, which
//           returns { success, note } and no node details. The handler formatted
//           those absent fields anyway.
// [BUG-025] write's componentKey path threw Figma's raw text with no stated fix,
//           the only branch in that function that did.

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { create } from "../src/figma_plugin/src/commands/create.js";
import { looksLikeError } from "../src/figmagent_mcp/instance.js";
import { buildModeMismatchResult } from "../src/figmagent_mcp/tools/script.js";
import { buildFocusResult, buildSelectionsResult } from "../src/figmagent_mcp/tools/scan.js";

// ─── [BUG-026] the flag, and why prose alone was not enough ──────────────────

describe("[BUG-026] a rejection reads as an error", () => {
  const REJECTION = buildModeMismatchResult("figma.createFrame").content[0].text;

  test("the rejection is flagged", () => {
    expect(buildModeMismatchResult("figma.createFrame").isError).toBe(true);
  });

  test("and therefore reads as an error end to end", () => {
    expect(looksLikeError(buildModeMismatchResult("figma.createFrame"))).toBe(true);
  });

  test("it still names the offending call and the remedy", () => {
    expect(REJECTION).toContain("figma.createFrame");
    expect(REJECTION).toContain("mode: 'write'");
  });

  test("the rejection text is NOT caught by the looksLikeError backstop", () => {
    // This is why the explicit flag is required: the sentinel matcher is
    // start-anchored on Error/Failed/Could not/…, and a refusal phrased as
    // prose matches none of them.
    expect(looksLikeError({ content: [{ type: "text", text: REJECTION }] })).toBe(false);
  });

  test("with isError set, looksLikeError reports it regardless of wording", () => {
    expect(looksLikeError({ isError: true, content: [{ type: "text", text: REJECTION }] })).toBe(true);
  });

  test("an explicit false still wins over a scary-looking string", () => {
    // Guards the precedence rule the fix relies on: the handler's flag is
    // authoritative, so a read tool serializing a node named "Error: ..." is safe.
    expect(looksLikeError({ isError: false, content: [{ type: "text", text: "Error: not really" }] })).toBe(false);
  });
});

// ─── [BUG-025] a stated fix on the componentKey path ─────────────────────────

describe("[BUG-025] importing by componentKey states a fix", () => {
  let importError: Error | null;

  beforeEach(() => {
    importError = null;
    (globalThis as any).figma = {
      mixed: Symbol("mixed"),
      currentPage: { id: "0:0", type: "PAGE", children: [], appendChild() {} },
      getNodeByIdAsync: async () => null,
      importComponentByKeyAsync: async () => {
        if (importError) throw importError;
        return {
          type: "COMPONENT",
          name: "Button",
          createInstance: () => ({ id: "i1", type: "INSTANCE", name: "Button", children: [] }),
        };
      },
    };
  });

  afterAll(() => {
    delete (globalThis as any).figma;
  });

  test("a failed import names the key, the cause, and what to do next", async () => {
    importError = new Error("Cannot find component with key abc123");

    await expect(create({ tree: { type: "INSTANCE", componentKey: "abc123" } })).rejects.toThrow(/Fix:/);

    try {
      await create({ tree: { type: "INSTANCE", componentKey: "abc123" } });
    } catch (e: any) {
      expect(e.message).toContain("abc123");
      expect(e.message).toContain("Cannot find component with key");
      // The COMPONENT_SET case is the usual cause and the one an agent can act on.
      expect(e.message).toContain("COMPONENT_SET");
      expect(e.message).toContain("search_library_components");
    }
  });

  test("a successful import is unaffected", async () => {
    const res = await create({ tree: { type: "INSTANCE", componentKey: "abc123" } });
    expect(res.tree.id).toBe("i1");
  });
});

// ─── [BUG-024] a remote no-op reads as a no-op ───────────────────────────────

// What remote/transport.ts actually returns for these two commands.
const REMOTE_NO_OP = (command: string) => ({
  success: true,
  note: `${command} is a no-op on the remote transport (headless — no viewport or live selection).`,
});

describe("[BUG-024] set_focus / set_selections on the remote transport", () => {
  test("set_focus surfaces the note instead of 'Focused on node \"undefined\"'", () => {
    const text = buildFocusResult(REMOTE_NO_OP("set_focus"), "1:1").content[0].text;
    expect(text).toContain("no-op on the remote transport");
    expect(text).not.toContain("undefined");
    expect(text).toContain("Fix:");
  });

  test("set_selections surfaces the note instead of throwing on undefined.selectedNodes", () => {
    // The old handler called .map() on an absent array, turning a deliberate
    // no-op into a TypeError.
    expect(() => buildSelectionsResult(REMOTE_NO_OP("set_selections"))).not.toThrow();
    const text = buildSelectionsResult(REMOTE_NO_OP("set_selections")).content[0].text;
    expect(text).toContain("no-op on the remote transport");
    expect(text).toContain("Fix:");
  });

  test("the no-op is not flagged as an error — it is intentional, just not a completed action", () => {
    expect(buildFocusResult(REMOTE_NO_OP("set_focus"), "1:1").isError).toBeUndefined();
  });
});

describe("[BUG-024] the plugin transport is unchanged", () => {
  test("set_focus still reports the focused node", () => {
    const text = buildFocusResult({ success: true, name: "Card", id: "1:1" }, "1:1").content[0].text;
    expect(text).toBe('Focused on node "Card" (ID: 1:1)');
  });

  test("set_selections still lists the selected nodes", () => {
    const result = {
      count: 2,
      selectedNodes: [
        { name: "A", id: "1:1" },
        { name: "B", id: "1:2" },
      ],
    };
    expect(buildSelectionsResult(result).content[0].text).toBe('Selected 2 nodes: "A" (1:1), "B" (1:2)');
  });
});

describe("[BUG-024] a malformed result is an error, not a fake success", () => {
  test("set_focus with neither note nor id is flagged", () => {
    const res = buildFocusResult({ success: true }, "1:1");
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("Fix:");
    expect(res.content[0].text).toContain("1:1");
  });

  test("set_selections with neither note nor an array is flagged", () => {
    const res = buildSelectionsResult({ success: true });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("Fix:");
  });
});
