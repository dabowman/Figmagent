// Apply command: unified property application for existing nodes.
// Handles direct values, layout properties, rename/move/reorder, text content,
// variable bindings, text styles, effect styles, and deletion in a single call.
// Accepts a flat list or nested tree of node references.

import { toNumber, sendProgressUpdate, findNodeByIdInTree, prop, fail } from "../helpers.js";
import { setCharacters } from "../setcharacters.js";
import { FIELD_MAP } from "./styles.js";
import { runPostWriteAssertions } from "../assertions.js";
import { miniLint, getCompatibleScopes, isScopeCompatible } from "./lint.js";

// Maps variables-map field names to lint property names for scope validation.
// Fields without a lint scope mapping (width, visible, characters, ...) skip the check.
const SCOPE_CHECK_FIELDS = {
  fill: "fills",
  fills: "fills",
  stroke: "strokes",
  strokes: "strokes",
  opacity: "opacity",
  cornerRadius: "cornerRadius",
  topLeftRadius: "cornerRadius",
  topRightRadius: "cornerRadius",
  bottomLeftRadius: "cornerRadius",
  bottomRightRadius: "cornerRadius",
  paddingTop: "paddingTop",
  paddingRight: "paddingRight",
  paddingBottom: "paddingBottom",
  paddingLeft: "paddingLeft",
  itemSpacing: "itemSpacing",
  counterAxisSpacing: "counterAxisSpacing",
  fontSize: "fontSize",
  fontFamily: "fontFamily",
};

// Walk parents to detect nodes living inside an INSTANCE (their structure is
// owned by the main component — structural mutations fail or are reverted).
function isInsideInstance(node) {
  let parent = prop(node, "parent");
  while (parent) {
    if (parent.type === "INSTANCE") return true;
    parent = prop(parent, "parent");
  }
  return false;
}

function parentHasAutoLayout(node) {
  const parent = prop(node, "parent");
  if (!parent) return false;
  const layoutMode = prop(parent, "layoutMode");
  return !!layoutMode && layoutMode !== "NONE";
}

// Flatten a potentially nested node list into a flat array of operations
function flattenNodes(nodeList) {
  const flat = [];
  for (let i = 0; i < nodeList.length; i++) {
    flat.push(nodeList[i]);
    if (nodeList[i].children && Array.isArray(nodeList[i].children)) {
      const childFlat = flattenNodes(nodeList[i].children);
      for (let j = 0; j < childFlat.length; j++) {
        flat.push(childFlat[j]);
      }
    }
  }
  return flat;
}

function applyFillColor(node, colorSpec) {
  node.fills = [
    {
      type: "SOLID",
      color: { r: parseFloat(colorSpec.r) || 0, g: parseFloat(colorSpec.g) || 0, b: parseFloat(colorSpec.b) || 0 },
      opacity: colorSpec.a !== undefined ? parseFloat(colorSpec.a) : 1,
    },
  ];
}

function applyStrokeColor(node, colorSpec) {
  node.strokes = [
    {
      type: "SOLID",
      color: { r: parseFloat(colorSpec.r) || 0, g: parseFloat(colorSpec.g) || 0, b: parseFloat(colorSpec.b) || 0 },
      opacity: colorSpec.a !== undefined ? parseFloat(colorSpec.a) : 1,
    },
  ];
}

// Binds a variable to a node field. Returns a warning object (and skips the
// bind) when the variable's declared scopes don't cover this field on this
// node type — Figma's API would accept the bind silently, so we surface it.
export async function bindVariableToNode(node, field, variableId) {
  const variable = await figma.variables.getVariableByIdAsync(variableId);
  if (!variable)
    fail(
      "Variable not found: " + variableId,
      "list variables with get_design_system and pass the full VariableID:xxx id (or the short v1/v2 id from a read result's defs)",
    );

  const figmaField = FIELD_MAP[field];
  if (!figmaField) {
    fail("Unsupported variable field: " + field, "use one of: " + Object.keys(FIELD_MAP).join(", "));
  }

  // Boundary validation: variable scope must cover this field on this node type
  const lintProp = SCOPE_CHECK_FIELDS[field];
  if (lintProp) {
    const scopes = variable.scopes || [];
    const requiredScopes = getCompatibleScopes(lintProp, node.type);
    if (!isScopeCompatible(scopes, requiredScopes)) {
      return {
        nodeId: node.id,
        check: "scope_mismatch",
        message:
          "Skipped binding " +
          field +
          " on " +
          node.id +
          " (" +
          node.type +
          "): variable " +
          variable.name +
          " has scopes [" +
          scopes.join(", ") +
          "], which don't cover this field (needs one of: " +
          requiredScopes.join(", ") +
          "). Fix: bind a variable scoped for this field, or widen the variable's scopes with update_variables.",
      };
    }
  }

  if (figmaField === "fills" || figmaField === "strokes") {
    if (!(figmaField in node)) {
      fail(
        "Node does not support " + figmaField + ": " + node.id + " (type: " + node.type + ")",
        "bind " + field + " on a node type that has " + figmaField + " (FRAME, RECTANGLE, TEXT, ...)",
      );
    }
    let paints = JSON.parse(JSON.stringify(node[figmaField]));
    if (!paints || paints.length === 0) {
      paints = [{ type: "SOLID", color: { r: 0, g: 0, b: 0 }, opacity: 1 }];
      node[figmaField] = paints;
    }
    const paintCopy = JSON.parse(JSON.stringify(node[figmaField]));
    paintCopy[0] = figma.variables.setBoundVariableForPaint(paintCopy[0], "color", variable);
    node[figmaField] = paintCopy;
  } else {
    node.setBoundVariable(figmaField, variable);
  }
  return null;
}

async function applyTextStyle(node, styleId, styleCache) {
  if (node.type !== "TEXT") throw new Error("Not a TEXT node: " + node.id + " (type: " + node.type + ")");

  const style = styleCache[styleId];
  if (!style) throw new Error("Text style not found or not cached: " + styleId);

  // Load the node's current fonts before restyling
  if (node.fontName !== figma.mixed) {
    await figma.loadFontAsync(node.fontName);
  } else {
    const len = node.characters.length;
    const fontsToLoad = {};
    for (let i = 0; i < len; i++) {
      const f = node.getRangeFontName(i, i + 1);
      const key = f.family + ":" + f.style;
      if (!fontsToLoad[key]) fontsToLoad[key] = f;
    }
    const fontEntries = Object.keys(fontsToLoad);
    for (let j = 0; j < fontEntries.length; j++) {
      await figma.loadFontAsync(fontsToLoad[fontEntries[j]]);
    }
  }

  await node.setTextStyleIdAsync(styleId);
}

async function applyEffectStyle(node, styleId, styleCache) {
  if (!("effects" in node)) throw new Error("Node does not support effects: " + node.id + " (type: " + node.type + ")");

  const style = styleCache[styleId];
  if (!style) throw new Error("Effect style not found or not cached: " + styleId);

  await node.setEffectStyleIdAsync(styleId);
}

async function processNode(op, styleCache, ctx) {
  const warnings = [];
  let node = await figma.getNodeByIdAsync(op.nodeId);
  if (!node) {
    // Fallback for instance-internal paths (I<instance>;<node>) — same
    // resolution chain commands/text.js uses for text overrides.
    node = findNodeByIdInTree(op.nodeId);
  }
  if (!node)
    fail(
      "Node not found: " + op.nodeId,
      "verify the ID with read or search with grep — it may have been deleted or belong to another page",
    );

  // ── Boundary validation (Phase 4.3): reject-or-warn BEFORE mutating ──────

  // Structural mutations on instance children fail or revert — point at the main component.
  if ((op.delete === true || op.index !== undefined) && isInsideInstance(node)) {
    fail(
      "Cannot " + (op.delete === true ? "delete" : "reorder") + " " + op.nodeId + " — it is inside an instance",
      "edit the main component instead (read the instance to get its componentRef / main component id)",
    );
  }

  // Text props on non-TEXT nodes are silently impossible — warn instead of absorbing.
  if (node.type !== "TEXT") {
    const TEXT_PROPS = [
      "fontFamily",
      "fontWeight",
      "fontSize",
      "fontColor",
      "textAutoResize",
      "textTruncation",
      "maxLines",
    ];
    const requested = [];
    for (let tp = 0; tp < TEXT_PROPS.length; tp++) {
      if (op[TEXT_PROPS[tp]] !== undefined) requested.push(TEXT_PROPS[tp]);
    }
    if (requested.length > 0) {
      warnings.push({
        nodeId: op.nodeId,
        check: "inapplicable_property",
        message:
          requested.join(", ") +
          " ignored on " +
          op.nodeId +
          " — it is a " +
          node.type +
          ", not TEXT. Fix: target a TEXT node instead (grep with type: ['TEXT'] under " +
          op.nodeId +
          " to find one).",
      });
    }
  }

  // clipsContent only exists on frame-like nodes.
  if (op.clipsContent !== undefined && !("clipsContent" in node)) {
    warnings.push({
      nodeId: op.nodeId,
      check: "inapplicable_property",
      message:
        "clipsContent ignored on " +
        op.nodeId +
        " — " +
        node.type +
        " nodes don't clip. Fix: apply clipsContent to a FRAME or COMPONENT node.",
    });
  }

  // Phase 0: Component operations (swap variant, set exposed instance)
  if (op.swapVariantId) {
    if (node.type !== "INSTANCE")
      fail(
        "swapVariantId requires an INSTANCE node: " + op.nodeId + " (type: " + node.type + ")",
        "target an instance of the component set — find instances with grep ({ componentId: [...] })",
      );
    const newVariant = await figma.getNodeByIdAsync(op.swapVariantId);
    if (!newVariant)
      fail(
        "Variant component not found: " + op.swapVariantId,
        "read the instance's component set to list its variant ids",
      );
    if (newVariant.type !== "COMPONENT")
      fail(
        "Target is not a COMPONENT: " + op.swapVariantId + " (type: " + newVariant.type + ")",
        newVariant.type === "COMPONENT_SET"
          ? "pass the id of one variant inside the set (read " + op.swapVariantId + " to list them)"
          : "pass a variant COMPONENT id from the instance's component set",
      );
    // Boundary validation: the target must be a sibling variant in the same set.
    let mainComp = null;
    try {
      if (typeof node.getMainComponentAsync === "function") {
        mainComp = await node.getMainComponentAsync();
      }
    } catch (_mcErr) {}
    if (mainComp && mainComp.parent && mainComp.parent.type === "COMPONENT_SET") {
      const targetParent = prop(newVariant, "parent");
      if (!targetParent || targetParent.id !== mainComp.parent.id) {
        fail(
          "swapVariantId " +
            op.swapVariantId +
            " is not a sibling variant of instance " +
            op.nodeId +
            " — its component set is '" +
            mainComp.parent.name +
            "' (" +
            mainComp.parent.id +
            ")",
          "pass a COMPONENT id from that set (read " + mainComp.parent.id + " to list its variants)",
        );
      }
    }
    node.swapComponent(newVariant);
  }

  if (op.isExposedInstance !== undefined) {
    if (node.type !== "INSTANCE") throw new Error("isExposedInstance requires an INSTANCE node: " + op.nodeId);
    node.isExposedInstance = op.isExposedInstance;
  }

  // Phase 1: Layout mode (must come first — enables padding/alignment/sizing)
  if (op.layoutMode !== undefined && "layoutMode" in node) {
    node.layoutMode = op.layoutMode;
    if (op.layoutWrap !== undefined) node.layoutWrap = op.layoutWrap;
  }

  // Phase 1.5: Rename / move / reorder
  if (op.name !== undefined) {
    node.name = op.name;
  }
  if (op.x !== undefined && "x" in node) node.x = toNumber(op.x, 0);
  if (op.y !== undefined && "y" in node) node.y = toNumber(op.y, 0);
  if (op.index !== undefined) {
    const parent = node.parent;
    if (!parent || !("insertChild" in parent)) {
      throw new Error("Cannot reorder node " + op.nodeId + ": parent does not support children");
    }
    let targetIndex = toNumber(op.index, 0);
    if (targetIndex < 0) targetIndex = 0;
    const maxIndex = parent.children.length - 1;
    if (targetIndex > maxIndex) targetIndex = maxIndex;
    parent.insertChild(targetIndex, node);
  }

  // Phase 2: Direct values
  if (op.fillColor && "fills" in node) applyFillColor(node, op.fillColor);
  if (op.fontColor && node.type === "TEXT") applyFillColor(node, op.fontColor);
  if (op.strokeColor && "strokes" in node) applyStrokeColor(node, op.strokeColor);
  if (op.strokeWeight !== undefined && "strokeWeight" in node) node.strokeWeight = toNumber(op.strokeWeight, 1);
  if (op.cornerRadius !== undefined && "cornerRadius" in node) node.cornerRadius = toNumber(op.cornerRadius, 0);
  if (op.opacity !== undefined && "opacity" in node) node.opacity = toNumber(op.opacity, 1);
  if (op.clipsContent !== undefined && "clipsContent" in node) node.clipsContent = !!op.clipsContent;

  if (op.width !== undefined && op.height !== undefined && "resize" in node) {
    node.resize(toNumber(op.width, node.width), toNumber(op.height, node.height));
  } else if (op.width !== undefined && "resize" in node) {
    node.resize(toNumber(op.width, node.width), node.height);
  } else if (op.height !== undefined && "resize" in node) {
    node.resize(node.width, toNumber(op.height, node.height));
  }

  // Phase 2.5: Font properties (TEXT nodes only — load current font first, then apply new one)
  if (node.type === "TEXT" && (op.fontFamily || op.fontWeight || op.fontSize)) {
    // Load current font to allow property mutations
    if (node.fontName !== figma.mixed) {
      await figma.loadFontAsync(node.fontName);
    } else {
      const len = node.characters.length;
      const fontsToLoad = {};
      for (let i = 0; i < len; i++) {
        const f = node.getRangeFontName(i, i + 1);
        const key = f.family + ":" + f.style;
        if (!fontsToLoad[key]) fontsToLoad[key] = f;
      }
      const fontEntries = Object.keys(fontsToLoad);
      for (let j = 0; j < fontEntries.length; j++) {
        await figma.loadFontAsync(fontsToLoad[fontEntries[j]]);
      }
    }

    const weightMap = {
      100: "Thin",
      200: "Extra Light",
      300: "Light",
      400: "Regular",
      500: "Medium",
      600: "Semi Bold",
      700: "Bold",
      800: "Extra Bold",
      900: "Black",
    };

    const family = op.fontFamily || (node.fontName !== figma.mixed ? node.fontName.family : "Inter");
    const currentStyle = node.fontName !== figma.mixed ? node.fontName.style : "Regular";
    const styleName = op.fontWeight ? weightMap[toNumber(op.fontWeight, 400)] || "Regular" : currentStyle;

    try {
      await figma.loadFontAsync({ family: family, style: styleName });
      node.fontName = { family: family, style: styleName };
    } catch (_fontErr) {
      // If exact weight not available, try Regular for the family
      try {
        await figma.loadFontAsync({ family: family, style: "Regular" });
        node.fontName = { family: family, style: "Regular" };
      } catch (_fallbackErr) {
        // Keep current font if family not available at all
      }
    }

    if (op.fontSize !== undefined) {
      node.fontSize = toNumber(op.fontSize, 14);
    }
  }

  // Snapshot dimensions BEFORE the width-0 TEXT recovery (below) or any sizing
  // mutation runs, so a post-write assertion can tell whether a FILL request
  // actually changed the dimension (vs. a no-op that left an already-collapsed
  // width-0 TEXT at 0 — issue #50). Captured here, not just before
  // layoutSizing*, because the recovery resizes 0→100 and would mask the
  // collapse the assertion exists to catch.
  const priorWidth = prop(node, "width");
  const priorHeight = prop(node, "height");

  // Text layout/resize properties (applies to any TEXT node — not gated on font props).
  // Ordered BEFORE layoutSizingHorizontal so coercion and width-recovery happen before
  // FILL is applied: setting FILL on a TEXT node with WIDTH_AND_HEIGHT collapses width to 0,
  // and setting textAutoResize to HEIGHT on a width-0 node freezes 0 (FILL can't recover).
  if (node.type === "TEXT") {
    // Resolve effective textAutoResize: respect user value; else coerce WIDTH_AND_HEIGHT→HEIGHT
    // when going FILL (matches Figma UI behavior; prevents width collapse).
    let effectiveTextAutoResize = op.textAutoResize;
    if (
      effectiveTextAutoResize === undefined &&
      op.layoutSizingHorizontal === "FILL" &&
      node.textAutoResize === "WIDTH_AND_HEIGHT"
    ) {
      effectiveTextAutoResize = "HEIGHT";
    }

    // Width-0 recovery: nudge width non-zero before locking it via textAutoResize or FILL.
    const willLockWidth = effectiveTextAutoResize !== undefined && effectiveTextAutoResize !== "WIDTH_AND_HEIGHT";
    const willSetFill = op.layoutSizingHorizontal === "FILL";
    if ((willLockWidth || willSetFill) && node.width === 0 && "resize" in node) {
      node.resize(100, Math.max(node.height, 1));
    }

    if (effectiveTextAutoResize !== undefined) {
      node.textAutoResize = effectiveTextAutoResize;
    }
    if (op.textTruncation !== undefined) {
      node.textTruncation = op.textTruncation;
    }
    if (op.maxLines !== undefined) {
      node.maxLines = toNumber(op.maxLines, null);
    }
  }

  // Layout direct values (require layoutMode !== "NONE")
  if (op.paddingTop !== undefined && "paddingTop" in node) node.paddingTop = toNumber(op.paddingTop, 0);
  if (op.paddingRight !== undefined && "paddingRight" in node) node.paddingRight = toNumber(op.paddingRight, 0);
  if (op.paddingBottom !== undefined && "paddingBottom" in node) node.paddingBottom = toNumber(op.paddingBottom, 0);
  if (op.paddingLeft !== undefined && "paddingLeft" in node) node.paddingLeft = toNumber(op.paddingLeft, 0);
  if (op.primaryAxisAlignItems !== undefined && "primaryAxisAlignItems" in node) {
    node.primaryAxisAlignItems = op.primaryAxisAlignItems;
  }
  if (op.counterAxisAlignItems !== undefined && "counterAxisAlignItems" in node) {
    node.counterAxisAlignItems = op.counterAxisAlignItems;
  }
  if (op.itemSpacing !== undefined && "itemSpacing" in node) node.itemSpacing = toNumber(op.itemSpacing, 0);
  if (op.counterAxisSpacing !== undefined && "counterAxisSpacing" in node) {
    node.counterAxisSpacing = toNumber(op.counterAxisSpacing, 0);
  }
  // layoutSizing* (FILL/HUG/FIXED) only takes effect when the node lives in an
  // auto-layout context — its PARENT must be an auto-layout frame. Set
  // otherwise it is a silent no-op (Figma reports success but nothing changes)
  // — issues #50/#53. layoutMode is applied earlier (Phase 1), so a combined
  // { layoutMode, layoutSizing* } call on a parent works; but layoutSizing* on
  // a child whose parent isn't auto-layout (yet) is the wasted-call trap.
  // Pre-check the parent so we warn + skip instead of letting the no-op (or a
  // mid-op throw) masquerade as success.
  const wantsSizing = op.layoutSizingHorizontal !== undefined || op.layoutSizingVertical !== undefined;
  const sizingContextMissing = wantsSizing && !parentHasAutoLayout(node);
  if (sizingContextMissing) {
    const blockedParent = prop(node, "parent");
    const parentLabel = blockedParent ? blockedParent.id + ' ("' + blockedParent.name + '")' : "the parent";
    const requested = [];
    if (op.layoutSizingHorizontal !== undefined) requested.push("layoutSizingHorizontal");
    if (op.layoutSizingVertical !== undefined) requested.push("layoutSizingVertical");
    warnings.push({
      nodeId: op.nodeId,
      check: "fill_not_applied",
      message:
        requested.join("/") +
        " on " +
        op.nodeId +
        " skipped — parent " +
        parentLabel +
        " has no auto-layout, so the sizing is a silent no-op. Fix: edit the parent with layoutMode: 'HORIZONTAL' " +
        "or 'VERTICAL' first (combine layoutMode + layoutSizing* in one apply on the parent), or give " +
        op.nodeId +
        " an explicit width/height.",
    });
  }
  if (op.layoutSizingHorizontal !== undefined && "layoutSizingHorizontal" in node && !sizingContextMissing) {
    node.layoutSizingHorizontal = op.layoutSizingHorizontal;
  }
  if (op.layoutSizingVertical !== undefined && "layoutSizingVertical" in node && !sizingContextMissing) {
    node.layoutSizingVertical = op.layoutSizingVertical;
  }
  if (wantsSizing && !sizingContextMissing && ctx) {
    ctx.sizingRequests.push({
      id: node.id,
      horizontal: op.layoutSizingHorizontal,
      vertical: op.layoutSizingVertical,
      priorWidth: typeof priorWidth === "number" ? priorWidth : null,
      priorHeight: typeof priorHeight === "number" ? priorHeight : null,
    });
  }

  // Phase 2.8: Text content (font-safe replacement via setcharacters.js —
  // handles mixed fonts, same path as the set_text_content command)
  if (op.characters !== undefined) {
    if (node.type !== "TEXT") {
      fail(
        "characters requires a TEXT node: " + op.nodeId + " (type: " + node.type + ")",
        "target the TEXT child instead — find it with grep ({ type: ['TEXT'] }) under " + op.nodeId,
      );
    }
    await setCharacters(node, op.characters);
  }

  // Phase 3: Variable bindings (override direct values with token refs).
  // Scope mismatches come back as warnings (bind skipped, op continues).
  if (op.variables && typeof op.variables === "object") {
    const fields = Object.keys(op.variables);
    for (let i = 0; i < fields.length; i++) {
      const bindWarning = await bindVariableToNode(node, fields[i], op.variables[fields[i]]);
      if (bindWarning) warnings.push(bindWarning);
    }
  }

  // Phase 4: Text style (loads fonts, must happen after other props)
  if (op.textStyleId) {
    await applyTextStyle(node, op.textStyleId, styleCache);
  }

  // Phase 5: Effect style (drop shadows, inner shadows, blurs)
  if (op.effectStyleId) {
    await applyEffectStyle(node, op.effectStyleId, styleCache);
  }

  // Phase 6: Delete — always runs LAST so any other ops on this node complete first
  if (op.delete === true) {
    const deletedName = node.name;
    node.remove();
    const delResult = { success: true, nodeId: op.nodeId, nodeName: deletedName, deleted: true };
    if (warnings.length > 0) delResult.warnings = warnings;
    return delResult;
  }

  // Record post-write validation context (deleted nodes never get here)
  if (ctx) {
    ctx.modifiedIds.push(node.id);
    if (op.height !== undefined) ctx.explicitHeightIds.push(node.id);
    if (node.type === "TEXT" && op.fontFamily !== undefined) {
      ctx.fontRequests.push({ id: node.id, family: op.fontFamily });
    }
    // Raw values eligible for the write-time mini-lint — skipped when the op
    // already binds the same field via variables.
    const vars = op.variables && typeof op.variables === "object" ? op.variables : {};
    if (op.fillColor && !vars.fill && "fills" in node) {
      ctx.rawSets.push({ nodeId: node.id, property: "fills", field: "fill", value: op.fillColor, nodeType: node.type });
    }
    if (node.type === "TEXT" && op.fontColor && !vars.fill) {
      ctx.rawSets.push({ nodeId: node.id, property: "fills", field: "fill", value: op.fontColor, nodeType: node.type });
    }
    if (op.cornerRadius !== undefined && !vars.cornerRadius && "cornerRadius" in node) {
      ctx.rawSets.push({
        nodeId: node.id,
        property: "cornerRadius",
        field: "cornerRadius",
        value: toNumber(op.cornerRadius, 0),
        nodeType: node.type,
      });
    }
    if (op.itemSpacing !== undefined && !vars.itemSpacing && "itemSpacing" in node) {
      ctx.rawSets.push({
        nodeId: node.id,
        property: "itemSpacing",
        field: "itemSpacing",
        value: toNumber(op.itemSpacing, 0),
        nodeType: node.type,
      });
    }
    const paddingFields = ["paddingTop", "paddingRight", "paddingBottom", "paddingLeft"];
    for (let pf = 0; pf < paddingFields.length; pf++) {
      const pField = paddingFields[pf];
      if (op[pField] !== undefined && !vars[pField] && pField in node) {
        ctx.rawSets.push({
          nodeId: node.id,
          property: pField,
          field: pField,
          value: toNumber(op[pField], 0),
          nodeType: node.type,
        });
      }
    }
    if (node.type === "TEXT" && op.fontSize !== undefined && !vars.fontSize) {
      ctx.rawSets.push({
        nodeId: node.id,
        property: "fontSize",
        field: "fontSize",
        value: toNumber(op.fontSize, 14),
        nodeType: node.type,
      });
    }
  }

  const result = { success: true, nodeId: op.nodeId, nodeName: node.name };
  if (warnings.length > 0) result.warnings = warnings;
  return result;
}

export async function apply(params) {
  const nodes = params.nodes;
  const commandId = params.commandId;

  if (!nodes || !Array.isArray(nodes) || nodes.length === 0) {
    throw new Error("Missing or empty nodes array");
  }

  // Flatten nested structure into operation list
  const allOps = flattenNodes(nodes);
  const totalOps = allOps.length;

  if (commandId) {
    sendProgressUpdate(commandId, "apply", "started", 0, totalOps, 0, "Starting property application");
  }

  // Pre-load all unique text and effect styles
  const uniqueStyleIds = {};
  for (let i = 0; i < allOps.length; i++) {
    if (allOps[i].textStyleId) uniqueStyleIds[allOps[i].textStyleId] = true;
    if (allOps[i].effectStyleId) uniqueStyleIds[allOps[i].effectStyleId] = true;
  }
  const styleCache = {};
  const styleKeys = Object.keys(uniqueStyleIds);
  for (let i = 0; i < styleKeys.length; i++) {
    try {
      const style = await figma.getStyleByIdAsync(styleKeys[i]);
      if (style && style.type === "TEXT") {
        if (style.fontName) await figma.loadFontAsync(style.fontName);
        styleCache[styleKeys[i]] = style;
      } else if (style && style.type === "EFFECT") {
        styleCache[styleKeys[i]] = style;
      }
    } catch (_e) {
      // Style load failure will be caught per-node later
    }
  }

  // Post-write validation context (Phase 4.1/4.2) — shared across all ops in
  // this command invocation.
  const ctx = {
    modifiedIds: [],
    explicitHeightIds: [],
    sizingRequests: [],
    fontRequests: [],
    rawSets: [],
  };

  // Process nodes in chunks
  const CHUNK_SIZE = 5;
  const totalChunks = Math.ceil(totalOps / CHUNK_SIZE);
  const results = [];
  let successCount = 0;
  let failureCount = 0;

  for (let chunkIdx = 0; chunkIdx < totalChunks; chunkIdx++) {
    const start = chunkIdx * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, totalOps);
    const chunk = allOps.slice(start, end);

    const chunkPromises = chunk.map((op) =>
      processNode(op, styleCache, ctx).catch((e) => {
        // Per-op error entry — one bad op never aborts the batch.
        let message = e.message || String(e);
        // Mixed-value failures (figma.mixed symbols) get a stated fix.
        if (message.indexOf("Fix:") === -1 && (message.indexOf("symbol") !== -1 || message.indexOf("mixed") !== -1)) {
          message =
            message +
            ". Fix: the node has mixed text properties — set characters via edit (font-safe) or apply a textStyleId to unify ranges, then retry.";
        }
        return { success: false, nodeId: op.nodeId, error: message };
      }),
    );

    const chunkResults = await Promise.all(chunkPromises);
    for (let ri = 0; ri < chunkResults.length; ri++) {
      results.push(chunkResults[ri]);
      if (chunkResults[ri].success) successCount++;
      else failureCount++;
    }

    if (commandId) {
      const processed = Math.min(end, totalOps);
      const pct = Math.round((processed / totalOps) * 100);
      sendProgressUpdate(
        commandId,
        "apply",
        "in_progress",
        pct,
        totalOps,
        processed,
        "Applied " + processed + " of " + totalOps + " nodes",
      );
    }
  }

  if (commandId) {
    sendProgressUpdate(commandId, "apply", "completed", 100, totalOps, totalOps, "Property application completed");
  }

  // Aggregate per-op boundary warnings, then run post-write assertions and
  // mini-lint over the nodes this command actually touched (deleted nodes
  // excluded). Advisory only — never fails the write.
  const warnings = [];
  for (let ri = 0; ri < results.length; ri++) {
    if (results[ri].warnings) {
      for (let wi = 0; wi < results[ri].warnings.length; wi++) warnings.push(results[ri].warnings[wi]);
      delete results[ri].warnings;
    }
  }
  try {
    const assertionWarnings = await runPostWriteAssertions({
      nodeIds: ctx.modifiedIds,
      explicitHeightIds: ctx.explicitHeightIds,
      sizingRequests: ctx.sizingRequests,
      fontRequests: ctx.fontRequests,
    });
    for (let wi = 0; wi < assertionWarnings.length; wi++) warnings.push(assertionWarnings[wi]);
    const lintWarnings = await miniLint(ctx.rawSets);
    for (let wi = 0; wi < lintWarnings.length; wi++) warnings.push(lintWarnings[wi]);
  } catch (_assertErr) {
    // assertions are best-effort
  }

  const response = {
    success: failureCount === 0,
    totalNodes: totalOps,
    successCount: successCount,
    failureCount: failureCount,
    results: results,
  };
  if (warnings.length > 0) response.warnings = warnings;
  return response;
}
