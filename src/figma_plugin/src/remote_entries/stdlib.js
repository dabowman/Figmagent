// Remote stdlib entry — preloaded ahead of run_script user code (Task 4.4).
// Exposes globalThis.fig (NOT __figmagent — user-facing API, short name) so
// model-written scripts call high-level helpers instead of 60 gotcha-laden
// lines of raw Plugin API. Bundled by bundles.ts (getDomainBundle("stdlib")).
//
// No optional chaining (?.), nullish coalescing (??), or object spread — this
// code runs in the remote Figma VM.

import { prop, sanitizeSymbols, loadFontWithFallback, fail } from "../helpers.js";
import { setCharacters } from "../setcharacters.js";
import { checkNodes } from "../assertions.js";
import { getNodeTree } from "../commands/document.js";
import { bindVariableToNode } from "../commands/apply.js";
import { create } from "../commands/create.js";

globalThis.fig = {
  // Strict-guard-safe property read (the remote VM throws on missing props).
  prop: prop,

  // Font-safe text replacement — handles mixed-font nodes.
  setCharacters: setCharacters,

  // Load a font; numeric weight maps to a style name (600 → "Semi Bold"),
  // falls back to Inter Regular. Returns the FontName actually loaded.
  loadFont: loadFontWithFallback,

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
