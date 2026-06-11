// Post-write structural assertions (Phase 4.1).
// Run at the end of create/apply handlers in the same execution — the write
// response carries the verdict, no read-after-write round trip needed.
//
// Warning shape: { nodeId, check, message } where message states the fix in
// Figma's voice. Pure predicates are exported separately so they are
// unit-testable on plain objects; only checkNodes/runPostWriteAssertions
// touch the figma global.
//
// No optional chaining (?.), nullish coalescing (??), or object spread — the
// bundled code runs in Figma's sandboxed VM and the remote VM.

import { prop } from "./helpers.js";

// ─── Pure predicates (unit-testable on plain objects) ───────────────────────

// Strict AABB overlap — touching edges do NOT count as overlap.
// a/b: { x, y, width, height }
export function aabbOverlap(a, b) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

// Zero/near-zero-width TEXT: the text is effectively invisible.
export function isNearZeroWidthText(node) {
  if (prop(node, "type") !== "TEXT") return false;
  const width = prop(node, "width");
  return typeof width === "number" && width < 2;
}

// 100px-balloon: auto-layout frame whose height-axis sizing defaulted to
// FIXED at exactly 100px (Figma's default when no explicit height was set
// and HUG was not requested).
export function isBalloonFrame(node) {
  const layoutMode = prop(node, "layoutMode");
  if (!layoutMode || layoutMode === "NONE") return false;
  if (prop(node, "height") !== 100) return false;
  // Height is the counter axis for HORIZONTAL layouts, primary for VERTICAL.
  const heightSizing =
    layoutMode === "HORIZONTAL" ? prop(node, "counterAxisSizingMode") : prop(node, "primaryAxisSizingMode");
  return heightSizing === "FIXED";
}

// FILL-requested-but-not-applied: the op asked for FILL sizing but the node
// reports something else because the parent lacked auto-layout.
// requested: { horizontal: boolean, vertical: boolean }
// Returns an array of warnings (one per failed axis).
export function checkFillRequested(node, requested) {
  const warnings = [];
  if (!requested) return warnings;
  const parent = prop(node, "parent");
  const parentLabel = parent ? parent.id + ' ("' + parent.name + '")' : "the parent";
  const axes = [
    { flag: requested.horizontal, field: "layoutSizingHorizontal", dim: "width" },
    { flag: requested.vertical, field: "layoutSizingVertical", dim: "height" },
  ];
  for (let i = 0; i < axes.length; i++) {
    const axis = axes[i];
    if (!axis.flag) continue;
    const actual = prop(node, axis.field);
    if (actual === "FILL" || actual === undefined) continue;
    warnings.push({
      nodeId: node.id,
      check: "fill_not_applied",
      message:
        axis.field +
        ": 'FILL' on " +
        node.id +
        " did not apply — it reports " +
        actual +
        " because parent " +
        parentLabel +
        " has no auto-layout. Fix: set layoutMode: 'HORIZONTAL' or 'VERTICAL' on the parent, or give " +
        node.id +
        " an explicit " +
        axis.dim +
        ".",
    });
  }
  return warnings;
}

// Font fallback: the resolved fontName.family differs from what the op asked for.
// Returns a warning or null.
export function checkFontFallback(node, requestedFamily) {
  if (!requestedFamily) return null;
  const fontName = prop(node, "fontName");
  // figma.mixed (a Symbol) or missing — can't compare, skip.
  if (!fontName || typeof fontName !== "object") return null;
  if (fontName.family === requestedFamily) return null;
  return {
    nodeId: node.id,
    check: "font_fallback",
    message:
      "Requested fontFamily '" +
      requestedFamily +
      "' on " +
      node.id +
      " but it resolved to '" +
      fontName.family +
      "' (fallback). Fix: pass a fontFamily/fontStyle combination that exists in this file — check get_design_system text styles or use an installed family.",
  };
}

// Find overlapping pairs among rect-like items: [{ id, x, y, width, height }].
// Returns array of [idA, idB] pairs.
export function findOverlappingPairs(items) {
  const pairs = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (aabbOverlap(items[i], items[j])) {
        pairs.push([items[i].id, items[j].id]);
      }
    }
  }
  return pairs;
}

// ─── Figma-touching wrappers ─────────────────────────────────────────────────

async function getNodeSafe(nodeId) {
  try {
    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node) return null;
    if (prop(node, "removed")) return null;
    return node;
  } catch (_e) {
    return null;
  }
}

// Context-free checks over a set of node IDs the op just created/moved:
// zero-width TEXT, 100px-balloon, overlapping siblings (only among these
// nodes, only inside non-auto-layout parents). Deleted nodes are skipped.
// opts: { explicitHeightIds: string[] } — nodes whose height was explicitly
// requested are exempt from the balloon check.
export async function checkNodes(nodeIds, opts) {
  const warnings = [];
  if (!nodeIds || nodeIds.length === 0) return warnings;

  const explicitHeight = {};
  if (opts && opts.explicitHeightIds) {
    for (let i = 0; i < opts.explicitHeightIds.length; i++) {
      explicitHeight[opts.explicitHeightIds[i]] = true;
    }
  }

  // Fetch each unique node once; skip deleted/unresolvable nodes.
  const seen = {};
  const fetched = [];
  for (let i = 0; i < nodeIds.length; i++) {
    const id = nodeIds[i];
    if (seen[id]) continue;
    seen[id] = true;
    const node = await getNodeSafe(id);
    if (node) fetched.push(node);
  }

  for (let i = 0; i < fetched.length; i++) {
    const node = fetched[i];

    if (isNearZeroWidthText(node)) {
      warnings.push({
        nodeId: node.id,
        check: "zero_width_text",
        message:
          "TEXT node " +
          node.id +
          ' ("' +
          node.name +
          '") is ' +
          prop(node, "width") +
          "px wide — its text is invisible. Fix: set textAutoResize: 'WIDTH_AND_HEIGHT' or give it an explicit width.",
      });
    }

    if (!explicitHeight[node.id] && isBalloonFrame(node)) {
      warnings.push({
        nodeId: node.id,
        check: "balloon_height",
        message:
          "Set layoutSizingVertical: 'HUG' on " +
          node.id +
          " or give it an explicit height — it ballooned to the 100px default.",
      });
    }
  }

  // Overlap check: only among the nodes this op touched, grouped by parent,
  // and only when the parent has no active auto-layout.
  const byParent = {};
  for (let i = 0; i < fetched.length; i++) {
    const node = fetched[i];
    const parent = prop(node, "parent");
    if (!parent) continue;
    const parentLayout = prop(parent, "layoutMode");
    if (parentLayout && parentLayout !== "NONE") continue;
    const x = prop(node, "x");
    const y = prop(node, "y");
    const width = prop(node, "width");
    const height = prop(node, "height");
    if (typeof x !== "number" || typeof y !== "number" || typeof width !== "number" || typeof height !== "number") {
      continue;
    }
    if (!byParent[parent.id]) byParent[parent.id] = { parentId: parent.id, items: [] };
    byParent[parent.id].items.push({ id: node.id, x: x, y: y, width: width, height: height });
  }
  const parentIds = Object.keys(byParent);
  for (let i = 0; i < parentIds.length; i++) {
    const group = byParent[parentIds[i]];
    if (group.items.length < 2) continue;
    const pairs = findOverlappingPairs(group.items);
    for (let p = 0; p < pairs.length; p++) {
      warnings.push({
        nodeId: pairs[p][0],
        check: "overlapping_siblings",
        message:
          "Nodes " +
          pairs[p][0] +
          " and " +
          pairs[p][1] +
          " overlap inside " +
          group.parentId +
          ", which has no auto-layout. Fix: set layoutMode on " +
          group.parentId +
          " to stack them, or adjust x/y so they don't overlap.",
      });
    }
  }

  return warnings;
}

// Run all post-write assertions for one command invocation.
// ctx: {
//   nodeIds:           ids created/modified by the op (deleted ids excluded),
//   explicitHeightIds: ids where the op explicitly set height,
//   fillRequests:      [{ id, horizontal, vertical }] — FILL sizing the op asked for,
//   fontRequests:      [{ id, family }] — font families the op asked for,
// }
export async function runPostWriteAssertions(ctx) {
  const warnings = [];
  if (!ctx) return warnings;

  const fillRequests = ctx.fillRequests || [];
  for (let i = 0; i < fillRequests.length; i++) {
    const req = fillRequests[i];
    const node = await getNodeSafe(req.id);
    if (!node) continue;
    const ws = checkFillRequested(node, req);
    for (let j = 0; j < ws.length; j++) warnings.push(ws[j]);
  }

  const fontRequests = ctx.fontRequests || [];
  for (let i = 0; i < fontRequests.length; i++) {
    const req = fontRequests[i];
    const node = await getNodeSafe(req.id);
    if (!node) continue;
    const w = checkFontFallback(node, req.family);
    if (w) warnings.push(w);
  }

  const contextFree = await checkNodes(ctx.nodeIds || [], { explicitHeightIds: ctx.explicitHeightIds || [] });
  for (let i = 0; i < contextFree.length; i++) warnings.push(contextFree[i]);

  return warnings;
}
