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

// Resolve a requested layoutSizing value for one axis from either request
// shape: the legacy boolean flag (FILL-only, from create.js) or the richer
// string value (FILL/HUG/FIXED, from apply.js). Returns the requested value
// string, or null when nothing was requested for this axis.
function requestedSizingValue(flag, value) {
  if (typeof value === "string") return value;
  if (flag === true) return "FILL";
  return null;
}

// Sizing-requested-but-not-applied / no-op detection. The op asked for a
// layoutSizing value (FILL/HUG/FIXED) but either the node reports a different
// value (parent lacked auto-layout — silent no-op, issues #50/#53) or a FILL
// request left the dimension collapsed at ~0 (already-collapsed width-0 TEXT
// repair that didn't take — issue #50).
// requested: {
//   horizontal: boolean | "FILL" | "HUG" | "FIXED",
//   vertical:   boolean | "FILL" | "HUG" | "FIXED",
//   priorWidth?:  number | null,   // dimension before the op (collapse check)
//   priorHeight?: number | null,
// }
// Returns an array of warnings (one per failed axis).
export function checkSizingRequested(node, requested) {
  const warnings = [];
  if (!requested) return warnings;
  const parent = prop(node, "parent");
  const parentLabel = parent ? parent.id + ' ("' + parent.name + '")' : "the parent";
  const axes = [
    {
      want: requestedSizingValue(requested.horizontal, requested.horizontal),
      field: "layoutSizingHorizontal",
      dim: "width",
      prior: requested.priorWidth,
    },
    {
      want: requestedSizingValue(requested.vertical, requested.vertical),
      field: "layoutSizingVertical",
      dim: "height",
      prior: requested.priorHeight,
    },
  ];
  for (let i = 0; i < axes.length; i++) {
    const axis = axes[i];
    if (!axis.want) continue;
    const actual = prop(node, axis.field);

    // 1. Value didn't stick — parent isn't auto-layout, sizing is a no-op.
    if (actual !== undefined && actual !== axis.want) {
      warnings.push({
        nodeId: node.id,
        check: "fill_not_applied",
        message:
          axis.field +
          ": '" +
          axis.want +
          "' on " +
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
      continue;
    }

    // 2. FILL stuck (or value unreadable) but the dimension is still collapsed
    // at ~0 — the FILL was a no-op because the node was already broken and the
    // parent gave it no room to expand into.
    if (axis.want === "FILL") {
      const dimValue = prop(node, axis.dim);
      const wasZero = axis.prior === 0 || axis.prior === null || axis.prior === undefined;
      if (typeof dimValue === "number" && dimValue < 2 && wasZero) {
        warnings.push({
          nodeId: node.id,
          check: "width_collapse",
          message:
            axis.field +
            ": 'FILL' on " +
            node.id +
            " left " +
            axis.dim +
            " at " +
            dimValue +
            "px — the FILL was a no-op (the node was collapsed before the op and got no room). Fix: set " +
            axis.dim +
            " explicitly (or textAutoResize: 'HEIGHT' on TEXT) in the same apply, then FILL — combine both in one call.",
        });
      }
    }
  }
  return warnings;
}

// Back-compat alias: callers/tests that pass { horizontal, vertical } boolean
// flags for FILL-only checks. Delegates to checkSizingRequested.
export function checkFillRequested(node, requested) {
  return checkSizingRequested(node, requested);
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
//   fillRequests:      [{ id, horizontal, vertical }] — legacy boolean FILL requests (create.js),
//   sizingRequests:    [{ id, horizontal, vertical, priorWidth, priorHeight }] — layoutSizing requests (apply.js),
//   fontRequests:      [{ id, family }] — font families the op asked for,
// }
export async function runPostWriteAssertions(ctx) {
  const warnings = [];
  if (!ctx) return warnings;

  // Both request lists feed the same checker — the legacy boolean shape and
  // the richer { value, prior* } shape are both handled by checkSizingRequested.
  const sizingRequests = (ctx.fillRequests || []).concat(ctx.sizingRequests || []);
  for (let i = 0; i < sizingRequests.length; i++) {
    const req = sizingRequests[i];
    const node = await getNodeSafe(req.id);
    if (!node) continue;
    const ws = checkSizingRequested(node, req);
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
