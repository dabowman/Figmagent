// Create command: builds one or more nodes from a recursive spec

import { toNumber, sendProgressUpdate, fail } from "../helpers.js";
import { runPostWriteAssertions } from "../assertions.js";
import { miniLint } from "./lint.js";

export async function create(params) {
  const parentId = params.parentId;
  const tree = params.tree;
  const commandId = params.commandId;

  if (!tree) throw new Error("Missing tree parameter");

  // Post-write validation context (Phase 4.1/4.2) — collected during the
  // build, checked at the end of the same command invocation.
  const assertCtx = {
    nodeIds: [],
    explicitHeightIds: [],
    fillRequests: [],
    fontRequests: [],
  };
  const rawSets = [];

  function countNodes(spec) {
    let count = 1;
    if (spec.children && Array.isArray(spec.children)) {
      for (let i = 0; i < spec.children.length; i++) {
        count += countNodes(spec.children[i]);
      }
    }
    return count;
  }

  const totalNodes = countNodes(tree);
  let createdCount = 0;

  if (commandId) {
    sendProgressUpdate(commandId, "create", "started", 0, totalNodes, 0, "Starting creation");
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

  async function buildNode(spec, parentNode) {
    const nodeType = spec.type || "FRAME";
    const fontFamily = spec.fontFamily || "Inter";
    const fontStyle = spec.fontStyle || "Regular";
    let node;

    if (nodeType === "TEXT") {
      node = figma.createText();
      // Determine the target font style: fontWeight mapping takes precedence if provided
      let targetStyle = fontStyle;
      if (spec.fontWeight !== undefined) {
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
        const w = toNumber(spec.fontWeight, 400);
        targetStyle = weightMap[w] || "Regular";
      }
      // Load and assign font BEFORE setting characters
      try {
        await figma.loadFontAsync({ family: fontFamily, style: targetStyle });
        node.fontName = { family: fontFamily, style: targetStyle };
      } catch (_e) {
        // Try the original fontStyle if weight mapping failed
        if (targetStyle !== fontStyle) {
          try {
            await figma.loadFontAsync({ family: fontFamily, style: fontStyle });
            node.fontName = { family: fontFamily, style: fontStyle };
          } catch (_e2) {
            // Fall back to Inter Regular
            await figma.loadFontAsync({ family: "Inter", style: "Regular" });
          }
        } else {
          await figma.loadFontAsync({ family: "Inter", style: "Regular" });
        }
      }
      if (spec.text !== undefined) {
        node.characters = String(spec.text);
      }
      if (spec.fontSize !== undefined) {
        node.fontSize = toNumber(spec.fontSize, 14);
      }
      if (spec.fontColor) {
        applyFillColor(node, spec.fontColor);
      }
      // Apply text-specific properties
      if (spec.textAutoResize !== undefined) {
        node.textAutoResize = spec.textAutoResize;
      }
      if (spec.textTruncation !== undefined) {
        node.textTruncation = spec.textTruncation;
      }
      if (spec.maxLines !== undefined) {
        node.maxLines = spec.maxLines;
      }
    } else if (nodeType === "SVG") {
      if (!spec.svg) throw new Error("SVG type requires an 'svg' property with a valid SVG string");
      node = figma.createNodeFromSvg(spec.svg);
    } else if (nodeType === "RECTANGLE") {
      node = figma.createRectangle();
    } else if (nodeType === "INSTANCE") {
      // Instantiate from componentId (local) or componentKey (library)
      let component;
      if (spec.componentId) {
        const compNode = await figma.getNodeByIdAsync(spec.componentId);
        if (!compNode)
          fail(
            "Component node not found: " + spec.componentId,
            "find local component ids with grep ({ type: ['COMPONENT'] }) or get_design_system; for published library components pass componentKey instead",
          );
        if (compNode.type !== "COMPONENT")
          fail(
            "Node is not a COMPONENT: " + spec.componentId + " (type: " + compNode.type + ")",
            compNode.type === "COMPONENT_SET"
              ? "pass the id of one variant inside the set (read " + spec.componentId + " to list its variants)"
              : "pass a COMPONENT node id — find one with grep ({ type: ['COMPONENT'] })",
          );
        component = compNode;
      } else if (spec.componentKey) {
        component = await figma.importComponentByKeyAsync(spec.componentKey);
      } else {
        fail(
          "INSTANCE type requires componentId or componentKey",
          "pass componentId (local component node id) or componentKey (published library key)",
        );
      }
      node = component.createInstance();
    } else if (nodeType === "COMPONENT") {
      node = figma.createComponent();
    } else {
      node = figma.createFrame();
    }

    if (spec.name !== undefined) node.name = spec.name;
    if (spec.width !== undefined || spec.height !== undefined) {
      node.resize(toNumber(spec.width, 100), toNumber(spec.height, 100));
    }
    if (spec.x !== undefined) node.x = toNumber(spec.x, 0);
    if (spec.y !== undefined) node.y = toNumber(spec.y, 0);

    if (spec.cornerRadius !== undefined && "cornerRadius" in node) {
      node.cornerRadius = toNumber(spec.cornerRadius, 0);
    }

    if (spec.fillColor) {
      applyFillColor(node, spec.fillColor);
    } else if (nodeType !== "TEXT" && nodeType !== "INSTANCE" && nodeType !== "SVG" && "fills" in node) {
      // Clear Figma's default white fill on FRAME, RECTANGLE, COMPONENT nodes.
      // Unbound default fills create lint noise and are rarely intentional.
      node.fills = [];
    }

    if (spec.strokeColor) {
      applyStrokeColor(node, spec.strokeColor);
    }
    if (spec.strokeWeight !== undefined && "strokeWeight" in node) {
      node.strokeWeight = toNumber(spec.strokeWeight, 1);
    }

    if ((nodeType === "FRAME" || nodeType === "COMPONENT") && spec.layoutMode && spec.layoutMode !== "NONE") {
      node.layoutMode = spec.layoutMode;
      if (spec.layoutWrap) node.layoutWrap = spec.layoutWrap;
      if (spec.paddingTop !== undefined) node.paddingTop = toNumber(spec.paddingTop, 0);
      if (spec.paddingRight !== undefined) node.paddingRight = toNumber(spec.paddingRight, 0);
      if (spec.paddingBottom !== undefined) node.paddingBottom = toNumber(spec.paddingBottom, 0);
      if (spec.paddingLeft !== undefined) node.paddingLeft = toNumber(spec.paddingLeft, 0);
      if (spec.primaryAxisAlignItems) node.primaryAxisAlignItems = spec.primaryAxisAlignItems;
      if (spec.counterAxisAlignItems) node.counterAxisAlignItems = spec.counterAxisAlignItems;
      if (spec.itemSpacing !== undefined) node.itemSpacing = toNumber(spec.itemSpacing, 0);
    }

    if (parentNode) {
      parentNode.appendChild(node);
    } else if (parentId) {
      const targetParent = await figma.getNodeByIdAsync(parentId);
      if (!targetParent)
        fail(
          "Parent node not found: " + parentId,
          "verify the ID with read or search with grep — or omit parentId to create at the page level",
        );
      if (!("appendChild" in targetParent))
        fail(
          "Parent node does not support children: " + parentId + " (type: " + targetParent.type + ")",
          "pass a FRAME, COMPONENT, GROUP, SECTION, or PAGE node as parentId",
        );
      targetParent.appendChild(node);
    } else {
      figma.currentPage.appendChild(node);
      // Auto-position top-level nodes to avoid piling up at origin
      if (spec.x === undefined && spec.y === undefined) {
        const siblings = figma.currentPage.children;
        let maxRight = 0;
        for (let si = 0; si < siblings.length; si++) {
          const s = siblings[si];
          if (s.id === node.id) continue;
          const right = s.x + s.width;
          if (right > maxRight) maxRight = right;
        }
        if (maxRight > 0) {
          node.x = maxRight + 100;
        }
      }
    }

    // Record post-write validation context for this node
    assertCtx.nodeIds.push(node.id);
    if (spec.height !== undefined) assertCtx.explicitHeightIds.push(node.id);
    if (spec.layoutSizingHorizontal === "FILL" || spec.layoutSizingVertical === "FILL") {
      assertCtx.fillRequests.push({
        id: node.id,
        horizontal: spec.layoutSizingHorizontal === "FILL",
        vertical: spec.layoutSizingVertical === "FILL",
      });
    }
    if (nodeType === "TEXT" && spec.fontFamily !== undefined) {
      assertCtx.fontRequests.push({ id: node.id, family: spec.fontFamily });
    }
    // Raw values eligible for the write-time mini-lint (Phase 4.2)
    if (spec.fillColor) {
      rawSets.push({ nodeId: node.id, property: "fills", field: "fill", value: spec.fillColor, nodeType: node.type });
    }
    if (nodeType === "TEXT" && spec.fontColor) {
      rawSets.push({ nodeId: node.id, property: "fills", field: "fill", value: spec.fontColor, nodeType: node.type });
    }
    if (spec.cornerRadius !== undefined) {
      rawSets.push({
        nodeId: node.id,
        property: "cornerRadius",
        field: "cornerRadius",
        value: toNumber(spec.cornerRadius, 0),
        nodeType: node.type,
      });
    }
    if (spec.itemSpacing !== undefined) {
      rawSets.push({
        nodeId: node.id,
        property: "itemSpacing",
        field: "itemSpacing",
        value: toNumber(spec.itemSpacing, 0),
        nodeType: node.type,
      });
    }
    const paddingFields = ["paddingTop", "paddingRight", "paddingBottom", "paddingLeft"];
    for (let pf = 0; pf < paddingFields.length; pf++) {
      if (spec[paddingFields[pf]] !== undefined) {
        rawSets.push({
          nodeId: node.id,
          property: paddingFields[pf],
          field: paddingFields[pf],
          value: toNumber(spec[paddingFields[pf]], 0),
          nodeType: node.type,
        });
      }
    }
    if (nodeType === "TEXT" && spec.fontSize !== undefined) {
      rawSets.push({
        nodeId: node.id,
        property: "fontSize",
        field: "fontSize",
        value: toNumber(spec.fontSize, 14),
        nodeType: node.type,
      });
    }

    createdCount++;
    if (commandId && createdCount % 5 === 0) {
      const pct = Math.round((createdCount / totalNodes) * 100);
      sendProgressUpdate(
        commandId,
        "create",
        "in_progress",
        pct,
        totalNodes,
        createdCount,
        "Created " + createdCount + " of " + totalNodes + " nodes",
      );
    }

    const childResults = [];
    if (spec.children && Array.isArray(spec.children)) {
      for (let ci = 0; ci < spec.children.length; ci++) {
        const childResult = await buildNode(spec.children[ci], node);
        childResults.push(childResult);
      }
    }

    // Two-pass: set layout sizing AFTER children exist.
    // Guarded: FILL under a non-auto-layout parent throws in the Figma API —
    // swallow here and let the post-write fill_not_applied assertion report it.
    if ((nodeType === "FRAME" || nodeType === "COMPONENT") && spec.layoutMode && spec.layoutMode !== "NONE") {
      if (spec.layoutSizingHorizontal) {
        try {
          node.layoutSizingHorizontal = spec.layoutSizingHorizontal;
        } catch (_szErr) {}
      }
      if (spec.layoutSizingVertical) {
        try {
          node.layoutSizingVertical = spec.layoutSizingVertical;
        } catch (_szErr) {}
      }
    }

    // For TEXT nodes: coerce textAutoResize and nudge width BEFORE setting FILL.
    // Setting FILL with WIDTH_AND_HEIGHT collapses width; setting textAutoResize to HEIGHT
    // on a width-0 node freezes 0. Handle both preemptively.
    if (nodeType === "TEXT") {
      let effectiveTextAutoResize = spec.textAutoResize;
      if (
        effectiveTextAutoResize === undefined &&
        spec.layoutSizingHorizontal === "FILL" &&
        node.textAutoResize === "WIDTH_AND_HEIGHT"
      ) {
        effectiveTextAutoResize = "HEIGHT";
      }
      const willLockWidth = effectiveTextAutoResize !== undefined && effectiveTextAutoResize !== "WIDTH_AND_HEIGHT";
      const willSetFill = spec.layoutSizingHorizontal === "FILL";
      if ((willLockWidth || willSetFill) && node.width === 0) {
        node.resize(100, Math.max(node.height, 1));
      }
      if (effectiveTextAutoResize !== undefined && effectiveTextAutoResize !== node.textAutoResize) {
        node.textAutoResize = effectiveTextAutoResize;
      }
      if (spec.layoutSizingHorizontal) {
        try {
          node.layoutSizingHorizontal = spec.layoutSizingHorizontal;
        } catch (_szErr) {}
      }
      if (spec.layoutSizingVertical) {
        try {
          node.layoutSizingVertical = spec.layoutSizingVertical;
        } catch (_szErr) {}
      }
    }

    if (parentNode && "layoutMode" in parentNode && parentNode.layoutMode !== "NONE" && nodeType !== "TEXT") {
      if (spec.layoutSizingHorizontal === "FILL") {
        node.layoutSizingHorizontal = "FILL";
      }
      if (spec.layoutSizingVertical === "FILL") node.layoutSizingVertical = "FILL";
    }

    const result = { id: node.id, name: node.name, type: node.type };
    if (childResults.length > 0) {
      result.children = childResults;
    }
    return result;
  }

  const treeResult = await buildNode(tree, null);

  if (commandId) {
    sendProgressUpdate(commandId, "create", "completed", 100, totalNodes, createdCount, "Creation completed");
  }

  // Post-write validation: structural assertions + mini-lint, same execution.
  // Advisory only — never fails the write.
  let warnings = [];
  try {
    warnings = await runPostWriteAssertions(assertCtx);
    const lintWarnings = await miniLint(rawSets);
    for (let wi = 0; wi < lintWarnings.length; wi++) warnings.push(lintWarnings[wi]);
  } catch (_assertErr) {
    // assertions are best-effort
  }

  const response = {
    success: true,
    totalNodesCreated: createdCount,
    tree: treeResult,
  };
  if (warnings.length > 0) response.warnings = warnings;
  return response;
}
