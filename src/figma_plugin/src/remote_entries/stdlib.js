// Remote stdlib entry — preloaded ahead of run_script user code (Task 4.4).
// Exposes globalThis.fig (NOT __figmagent — user-facing API, short name) so
// model-written scripts call high-level helpers instead of 60 gotcha-laden
// lines of raw Plugin API. Bundled by bundles.ts (getDomainBundle("stdlib")).
//
// No optional chaining (?.), nullish coalescing (??), or object spread — this
// code runs in the remote Figma VM.

import { prop, sanitizeSymbols, loadFontStrict, fail } from "../helpers.js";
import { setCharacters } from "../setcharacters.js";
import { checkNodes } from "../assertions.js";
import { getNodeTree } from "../commands/document.js";
import { bindVariableToNode } from "../commands/apply.js";
import { create } from "../commands/create.js";

globalThis.fig = {
  // Strict-guard-safe property read (the remote VM throws on missing props).
  // A null node (getNodeByIdAsync on a deleted id) used to surface as a raw
  // `TypeError: invalid 'in' operand` naming neither node nor fix (TOOL-044).
  prop: (node, name) => {
    if (!node || typeof node !== "object") {
      fail(
        "fig.prop(" + String(node) + ", " + JSON.stringify(name) + "): node is not an object",
        "getNodeByIdAsync returned null — the node was deleted, or belongs to a different file than the one selected; check the return value before reading properties",
      );
    }
    return prop(node, name);
  },

  // Font-safe text replacement — handles mixed-font nodes.
  setCharacters: setCharacters,

  // Load a font; numeric weight maps to a style name (600 → "Semi Bold").
  // THROWS (with a stated fix) when the requested face cannot be loaded: the
  // silent fallback to Inter Regular is right for edit/write's internal
  // callers, but a script that named a family must not be told it loaded and
  // then die 30 lines later on Figma's "call loadFontAsync first" (BUG-041).
  loadFont: loadFontStrict,

  // FSGN raw tree for a node (or node id). detail: "structure"|"layout"|"full".
  serialize: (nodeOrId, detail) => {
    var nodeId = typeof nodeOrId === "string" ? nodeOrId : nodeOrId.id;
    return getNodeTree({ nodeId: nodeId, detail: detail || "layout" }).then(sanitizeSymbols);
  },

  // Scope-validated design-token binding (FIELD_MAP fields). Binds fill AND
  // stroke paints via setBoundVariableForPaint (see bindVariableToNode). Unlike
  // the edit/apply batch path — which collects scope-mismatch warnings and
  // continues — a run_script caller has no warnings channel: a returned warning
  // would be silently discarded and a no-op (e.g. an unscoped variable on a
  // stroke) would masquerade as success. So throw with the stated fix instead.
  //
  // MUST be awaited: this returns a Promise and the scope-mismatch guard throws
  // *inside* it. A script that calls it without `await` swallows the rejection
  // and the skipped-bind no-op silently masquerades as success again (issue #63).
  // bindVariableToNode returns structured { message, fix }, so the throw path
  // forwards both fields to fail() directly — no string round-tripping.
  bindVariable: (node, field, variableId) => {
    return bindVariableToNode(node, field, variableId).then((warning) => {
      if (warning) {
        fail(warning.message, warning.fix || "adjust the variable or field so the bind applies");
      }
      return null;
    });
  },

  // Post-write structural assertions over node ids → warnings[].
  check: (nodeIds) => checkNodes(nodeIds, {}),

  // The full `write` tree builder (two-pass FILL sizing, font loading,
  // no default fills). spec = the same node tree `write` accepts.
  createNode: (spec, parentId) => create({ tree: spec, parentId: parentId }),
};
