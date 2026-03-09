// Create commands: rectangle, frame, text, frame tree

import { toNumber, sendProgressUpdate } from "../helpers.js";
import { setCharacters } from "../setcharacters.js";

export async function createRectangle(params) {
  const { x = 0, y = 0, width = 100, height = 100, name = "Rectangle", parentId } = params || {};

  const rect = figma.createRectangle();
  rect.x = x;
  rect.y = y;
  rect.resize(width, height);
  rect.name = name;

  if (parentId) {
    const parentNode = await figma.getNodeByIdAsync(parentId);
    if (!parentNode) {
      throw new Error(`Parent node not found with ID: ${parentId}`);
    }
    if (!("appendChild" in parentNode)) {
      throw new Error(`Parent node does not support children: ${parentId}`);
    }
    parentNode.appendChild(rect);
  } else {
    figma.currentPage.appendChild(rect);
  }

  return {
    id: rect.id,
    name: rect.name,
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    fills: rect.fills,
    cornerRadius: rect.cornerRadius,
    parentId: rect.parent ? rect.parent.id : undefined,
  };
}

export async function createFrame(params) {
  const {
    x = 0,
    y = 0,
    width = 100,
    height = 100,
    name = "Frame",
    parentId,
    fillColor,
    strokeColor,
    strokeWeight,
    layoutMode = "NONE",
    layoutWrap = "NO_WRAP",
    paddingTop = 10,
    paddingRight = 10,
    paddingBottom = 10,
    paddingLeft = 10,
    primaryAxisAlignItems = "MIN",
    counterAxisAlignItems = "MIN",
    layoutSizingHorizontal = "FIXED",
    layoutSizingVertical = "FIXED",
    itemSpacing = 0,
    cornerRadius,
  } = params || {};

  const frame = figma.createFrame();
  frame.x = x;
  frame.y = y;
  frame.resize(width, height);
  frame.name = name;

  if (layoutMode !== "NONE") {
    frame.layoutMode = layoutMode;
    frame.layoutWrap = layoutWrap;
    frame.paddingTop = paddingTop;
    frame.paddingRight = paddingRight;
    frame.paddingBottom = paddingBottom;
    frame.paddingLeft = paddingLeft;
    frame.primaryAxisAlignItems = primaryAxisAlignItems;
    frame.counterAxisAlignItems = counterAxisAlignItems;
    frame.layoutSizingHorizontal = layoutSizingHorizontal;
    frame.layoutSizingVertical = layoutSizingVertical;
    frame.itemSpacing = itemSpacing;
  }

  if (cornerRadius !== undefined) {
    frame.cornerRadius = cornerRadius;
  }

  if (fillColor) {
    const paintStyle = {
      type: "SOLID",
      color: {
        r: parseFloat(fillColor.r) || 0,
        g: parseFloat(fillColor.g) || 0,
        b: parseFloat(fillColor.b) || 0,
      },
      opacity: fillColor.a !== undefined ? parseFloat(fillColor.a) : 1,
    };
    frame.fills = [paintStyle];
  }

  if (strokeColor) {
    const strokeStyle = {
      type: "SOLID",
      color: {
        r: parseFloat(strokeColor.r) || 0,
        g: parseFloat(strokeColor.g) || 0,
        b: parseFloat(strokeColor.b) || 0,
      },
      opacity: strokeColor.a !== undefined ? parseFloat(strokeColor.a) : 1,
    };
    frame.strokes = [strokeStyle];
  }

  if (strokeWeight !== undefined) {
    frame.strokeWeight = strokeWeight;
  }

  if (parentId) {
    const parentNode = await figma.getNodeByIdAsync(parentId);
    if (!parentNode) {
      throw new Error(`Parent node not found with ID: ${parentId}`);
    }
    if (!("appendChild" in parentNode)) {
      throw new Error(`Parent node does not support children: ${parentId}`);
    }
    parentNode.appendChild(frame);
  } else {
    figma.currentPage.appendChild(frame);
  }

  return {
    id: frame.id,
    name: frame.name,
    x: frame.x,
    y: frame.y,
    width: frame.width,
    height: frame.height,
    fills: frame.fills,
    strokes: frame.strokes,
    strokeWeight: frame.strokeWeight,
    cornerRadius: frame.cornerRadius,
    layoutMode: frame.layoutMode,
    layoutWrap: frame.layoutWrap,
    paddingTop: frame.paddingTop,
    paddingRight: frame.paddingRight,
    paddingBottom: frame.paddingBottom,
    paddingLeft: frame.paddingLeft,
    primaryAxisAlignItems: frame.primaryAxisAlignItems,
    counterAxisAlignItems: frame.counterAxisAlignItems,
    layoutSizingHorizontal: frame.layoutSizingHorizontal,
    layoutSizingVertical: frame.layoutSizingVertical,
    itemSpacing: frame.itemSpacing,
    parentId: frame.parent ? frame.parent.id : undefined,
  };
}

export async function createText(params) {
  const {
    x = 0,
    y = 0,
    text = "Text",
    fontSize = 14,
    fontWeight = 400,
    fontColor = { r: 0, g: 0, b: 0, a: 1 },
    name = "",
    parentId,
  } = params || {};

  const getFontStyle = (weight) => {
    switch (weight) {
      case 100:
        return "Thin";
      case 200:
        return "Extra Light";
      case 300:
        return "Light";
      case 400:
        return "Regular";
      case 500:
        return "Medium";
      case 600:
        return "Semi Bold";
      case 700:
        return "Bold";
      case 800:
        return "Extra Bold";
      case 900:
        return "Black";
      default:
        return "Regular";
    }
  };

  const textNode = figma.createText();
  textNode.x = x;
  textNode.y = y;
  textNode.name = name || text;
  try {
    await figma.loadFontAsync({
      family: "Inter",
      style: getFontStyle(fontWeight),
    });
    textNode.fontName = { family: "Inter", style: getFontStyle(fontWeight) };
    textNode.fontSize = parseInt(fontSize, 10);
  } catch (error) {
    console.error("Error setting font size", error);
  }
  setCharacters(textNode, text);

  const paintStyle = {
    type: "SOLID",
    color: {
      r: parseFloat(fontColor.r) || 0,
      g: parseFloat(fontColor.g) || 0,
      b: parseFloat(fontColor.b) || 0,
    },
    opacity: fontColor.a !== undefined ? parseFloat(fontColor.a) : 1,
  };
  textNode.fills = [paintStyle];

  if (parentId) {
    const parentNode = await figma.getNodeByIdAsync(parentId);
    if (!parentNode) {
      throw new Error(`Parent node not found with ID: ${parentId}`);
    }
    if (!("appendChild" in parentNode)) {
      throw new Error(`Parent node does not support children: ${parentId}`);
    }
    parentNode.appendChild(textNode);
  } else {
    figma.currentPage.appendChild(textNode);
  }

  return {
    id: textNode.id,
    name: textNode.name,
    x: textNode.x,
    y: textNode.y,
    width: textNode.width,
    height: textNode.height,
    characters: textNode.characters,
    fontSize: textNode.fontSize,
    fontWeight: fontWeight,
    fontColor: fontColor,
    fontName: textNode.fontName,
    fills: textNode.fills,
    parentId: textNode.parent ? textNode.parent.id : undefined,
  };
}

export async function createFrameTree(params) {
  const parentId = params.parentId;
  const tree = params.tree;
  const commandId = params.commandId;

  if (!tree) throw new Error("Missing tree parameter");

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
    sendProgressUpdate(commandId, "create_frame_tree", "started", 0, totalNodes, 0, "Starting tree creation");
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
      try {
        await figma.loadFontAsync({ family: fontFamily, style: fontStyle });
      } catch (_e) {
        await figma.loadFontAsync({ family: "Inter", style: "Regular" });
      }
      if (spec.text !== undefined) {
        node.characters = String(spec.text);
      }
      if (spec.fontSize !== undefined) {
        node.fontSize = toNumber(spec.fontSize, 14);
      }
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
        const styleName = weightMap[w] || "Regular";
        try {
          await figma.loadFontAsync({ family: fontFamily, style: styleName });
          node.fontName = { family: fontFamily, style: styleName };
        } catch (_e2) {
          // Keep default font if weight style not available
        }
      }
      if (spec.fontColor) {
        applyFillColor(node, spec.fontColor);
      }
    } else if (nodeType === "RECTANGLE") {
      node = figma.createRectangle();
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
    }

    if (spec.strokeColor) {
      applyStrokeColor(node, spec.strokeColor);
    }
    if (spec.strokeWeight !== undefined && "strokeWeight" in node) {
      node.strokeWeight = toNumber(spec.strokeWeight, 1);
    }

    if (nodeType === "FRAME" && spec.layoutMode && spec.layoutMode !== "NONE") {
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
      if (!targetParent) throw new Error("Parent node not found: " + parentId);
      if (!("appendChild" in targetParent)) throw new Error("Parent node does not support children: " + parentId);
      targetParent.appendChild(node);
    } else {
      figma.currentPage.appendChild(node);
    }

    createdCount++;
    if (commandId && createdCount % 5 === 0) {
      const pct = Math.round((createdCount / totalNodes) * 100);
      sendProgressUpdate(
        commandId,
        "create_frame_tree",
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

    // Two-pass: set layout sizing AFTER children exist
    if (nodeType === "FRAME" && spec.layoutMode && spec.layoutMode !== "NONE") {
      if (spec.layoutSizingHorizontal) node.layoutSizingHorizontal = spec.layoutSizingHorizontal;
      if (spec.layoutSizingVertical) node.layoutSizingVertical = spec.layoutSizingVertical;
    }

    if (parentNode && "layoutMode" in parentNode && parentNode.layoutMode !== "NONE") {
      if (spec.layoutSizingHorizontal === "FILL") node.layoutSizingHorizontal = "FILL";
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
    sendProgressUpdate(
      commandId,
      "create_frame_tree",
      "completed",
      100,
      totalNodes,
      createdCount,
      "Tree creation completed",
    );
  }

  return {
    success: true,
    totalNodesCreated: createdCount,
    tree: treeResult,
  };
}
