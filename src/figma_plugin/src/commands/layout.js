// Layout commands: layout mode, padding, axis alignment, sizing, item spacing

import { toNumber } from "../helpers.js";

export async function setLayoutMode(params) {
  const { nodeId, layoutMode = "NONE", layoutWrap = "NO_WRAP" } = params || {};

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) throw new Error(`Node with ID ${nodeId} not found`);

  if (node.type !== "FRAME" && node.type !== "COMPONENT" && node.type !== "COMPONENT_SET" && node.type !== "INSTANCE") {
    throw new Error(`Node type ${node.type} does not support layoutMode`);
  }

  node.layoutMode = layoutMode;

  if (layoutMode !== "NONE") {
    node.layoutWrap = layoutWrap;
  }

  return { id: node.id, name: node.name, layoutMode: node.layoutMode, layoutWrap: node.layoutWrap };
}

export async function setPadding(params) {
  const { nodeId, paddingTop, paddingRight, paddingBottom, paddingLeft } = params || {};

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) throw new Error(`Node with ID ${nodeId} not found`);

  if (node.type !== "FRAME" && node.type !== "COMPONENT" && node.type !== "COMPONENT_SET" && node.type !== "INSTANCE") {
    throw new Error(`Node type ${node.type} does not support padding`);
  }

  if (node.layoutMode === "NONE") {
    throw new Error("Padding can only be set on auto-layout frames (layoutMode must not be NONE)");
  }

  if (paddingTop !== undefined) node.paddingTop = toNumber(paddingTop, 0);
  if (paddingRight !== undefined) node.paddingRight = toNumber(paddingRight, 0);
  if (paddingBottom !== undefined) node.paddingBottom = toNumber(paddingBottom, 0);
  if (paddingLeft !== undefined) node.paddingLeft = toNumber(paddingLeft, 0);

  return {
    id: node.id,
    name: node.name,
    paddingTop: node.paddingTop,
    paddingRight: node.paddingRight,
    paddingBottom: node.paddingBottom,
    paddingLeft: node.paddingLeft,
  };
}

export async function setAxisAlign(params) {
  const { nodeId, primaryAxisAlignItems, counterAxisAlignItems } = params || {};

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) throw new Error(`Node with ID ${nodeId} not found`);

  if (node.type !== "FRAME" && node.type !== "COMPONENT" && node.type !== "COMPONENT_SET" && node.type !== "INSTANCE") {
    throw new Error(`Node type ${node.type} does not support axis alignment`);
  }

  if (node.layoutMode === "NONE") {
    throw new Error("Axis alignment can only be set on auto-layout frames (layoutMode must not be NONE)");
  }

  if (primaryAxisAlignItems !== undefined) {
    if (!["MIN", "MAX", "CENTER", "SPACE_BETWEEN"].includes(primaryAxisAlignItems)) {
      throw new Error("Invalid primaryAxisAlignItems value. Must be one of: MIN, MAX, CENTER, SPACE_BETWEEN");
    }
    node.primaryAxisAlignItems = primaryAxisAlignItems;
  }

  if (counterAxisAlignItems !== undefined) {
    if (!["MIN", "MAX", "CENTER", "BASELINE"].includes(counterAxisAlignItems)) {
      throw new Error("Invalid counterAxisAlignItems value. Must be one of: MIN, MAX, CENTER, BASELINE");
    }
    if (counterAxisAlignItems === "BASELINE" && node.layoutMode !== "HORIZONTAL") {
      throw new Error("BASELINE alignment is only valid for horizontal auto-layout frames");
    }
    node.counterAxisAlignItems = counterAxisAlignItems;
  }

  return {
    id: node.id,
    name: node.name,
    primaryAxisAlignItems: node.primaryAxisAlignItems,
    counterAxisAlignItems: node.counterAxisAlignItems,
    layoutMode: node.layoutMode,
  };
}

export async function setLayoutSizing(params) {
  const { nodeId, layoutSizingHorizontal, layoutSizingVertical } = params || {};

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) throw new Error(`Node with ID ${nodeId} not found`);

  if (node.type !== "FRAME" && node.type !== "COMPONENT" && node.type !== "COMPONENT_SET" && node.type !== "INSTANCE") {
    throw new Error(`Node type ${node.type} does not support layout sizing`);
  }

  if (layoutSizingHorizontal !== undefined) {
    if (!["FIXED", "HUG", "FILL"].includes(layoutSizingHorizontal)) {
      throw new Error("Invalid layoutSizingHorizontal value. Must be one of: FIXED, HUG, FILL");
    }
    if (layoutSizingHorizontal === "HUG" && !["FRAME", "TEXT"].includes(node.type)) {
      throw new Error("HUG sizing is only valid on auto-layout frames and text nodes");
    }
    if (layoutSizingHorizontal === "FILL" && (!node.parent || node.parent.layoutMode === "NONE")) {
      throw new Error("FILL sizing is only valid on auto-layout children");
    }
    node.layoutSizingHorizontal = layoutSizingHorizontal;
  }

  if (layoutSizingVertical !== undefined) {
    if (!["FIXED", "HUG", "FILL"].includes(layoutSizingVertical)) {
      throw new Error("Invalid layoutSizingVertical value. Must be one of: FIXED, HUG, FILL");
    }
    if (layoutSizingVertical === "HUG" && !["FRAME", "TEXT"].includes(node.type)) {
      throw new Error("HUG sizing is only valid on auto-layout frames and text nodes");
    }
    if (layoutSizingVertical === "FILL" && (!node.parent || node.parent.layoutMode === "NONE")) {
      throw new Error("FILL sizing is only valid on auto-layout children");
    }
    node.layoutSizingVertical = layoutSizingVertical;
  }

  return {
    id: node.id,
    name: node.name,
    layoutSizingHorizontal: node.layoutSizingHorizontal,
    layoutSizingVertical: node.layoutSizingVertical,
    layoutMode: node.layoutMode,
  };
}

export async function setItemSpacing(params) {
  const { nodeId, itemSpacing, counterAxisSpacing } = params || {};

  if (itemSpacing === undefined && counterAxisSpacing === undefined) {
    throw new Error("At least one of itemSpacing or counterAxisSpacing must be provided");
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) throw new Error(`Node with ID ${nodeId} not found`);

  if (node.type !== "FRAME" && node.type !== "COMPONENT" && node.type !== "COMPONENT_SET" && node.type !== "INSTANCE") {
    throw new Error(`Node type ${node.type} does not support item spacing`);
  }

  if (node.layoutMode === "NONE") {
    throw new Error("Item spacing can only be set on auto-layout frames (layoutMode must not be NONE)");
  }

  if (itemSpacing !== undefined) {
    const numItemSpacing = toNumber(itemSpacing, undefined);
    if (numItemSpacing === undefined) throw new Error("Item spacing must be a number");
    node.itemSpacing = numItemSpacing;
  }

  if (counterAxisSpacing !== undefined) {
    const numCounterAxisSpacing = toNumber(counterAxisSpacing, undefined);
    if (numCounterAxisSpacing === undefined) throw new Error("Counter axis spacing must be a number");
    if (node.layoutWrap !== "WRAP") {
      throw new Error("Counter axis spacing can only be set on frames with layoutWrap set to WRAP");
    }
    node.counterAxisSpacing = numCounterAxisSpacing;
  }

  return {
    id: node.id,
    name: node.name,
    itemSpacing: node.itemSpacing || undefined,
    counterAxisSpacing: node.counterAxisSpacing || undefined,
    layoutMode: node.layoutMode,
    layoutWrap: node.layoutWrap,
  };
}
