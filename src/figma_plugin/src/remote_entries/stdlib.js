// Remote stdlib entry — preloaded ahead of run_script user code (Task 4.4).
// Exposes globalThis.fig (NOT __figmagent — user-facing API, short name) so
// model-written scripts call high-level helpers instead of 60 gotcha-laden
// lines of raw Plugin API. Bundled by bundles.ts (getDomainBundle("stdlib")).
//
// No optional chaining (?.), nullish coalescing (??), or object spread — this
// code runs in the remote Figma VM.

import { prop, sanitizeSymbols, loadFontWithFallback } from "../helpers.js";
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

  // Scope-validated design-token binding (FIELD_MAP fields). Returns a
  // warning object when the variable's scopes don't cover the field, else null.
  bindVariable: bindVariableToNode,

  // Post-write structural assertions over node ids → warnings[].
  check: (nodeIds) => checkNodes(nodeIds, {}),

  // The full `write` tree builder (two-pass FILL sizing, font loading,
  // no default fills). spec = the same node tree `write` accepts.
  createNode: (spec, parentId) => create({ tree: spec, parentId: parentId }),
};
