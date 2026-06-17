// Document, selection, node info, and export commands

import { sendProgressUpdate, generateCommandId, customBase64Encode, rgbaToHex, toNumber, prop, fail } from "../helpers.js";

export async function getDocumentInfo() {
  await figma.currentPage.loadAsync();
  const page = figma.currentPage;
  return {
    name: page.name,
    id: page.id,
    type: page.type,
    children: page.children.map((node) => ({
      id: node.id,
      name: node.name,
      type: node.type,
    })),
    currentPage: {
      id: page.id,
      name: page.name,
      childCount: page.children.length,
    },
    pages: [
      {
        id: page.id,
        name: page.name,
        childCount: page.children.length,
      },
    ],
  };
}

export async function getSelection() {
  return {
    selectionCount: figma.currentPage.selection.length,
    selection: figma.currentPage.selection.map((node) => ({
      id: node.id,
      name: node.name,
      type: node.type,
      visible: prop(node, "visible"),
    })),
  };
}

export async function getReactions(nodeIds) {
  try {
    const commandId = generateCommandId();
    sendProgressUpdate(
      commandId,
      "get_reactions",
      "started",
      0,
      nodeIds.length,
      0,
      `Starting deep search for reactions in ${nodeIds.length} nodes and their children`,
    );

    async function findNodesWithReactions(node, processedNodes = new Set(), depth = 0, results = []) {
      if (processedNodes.has(node.id)) {
        return results;
      }

      processedNodes.add(node.id);

      let filteredReactions = [];
      const reactions = prop(node, "reactions");
      if (reactions && reactions.length > 0) {
        filteredReactions = reactions.filter((r) => {
          if (r.action && r.action.navigation === "CHANGE_TO") return false;
          if (Array.isArray(r.actions)) {
            return !r.actions.some((a) => a.navigation === "CHANGE_TO");
          }
          return true;
        });
      }
      const hasFilteredReactions = filteredReactions.length > 0;

      if (hasFilteredReactions) {
        results.push({
          id: node.id,
          name: node.name,
          type: node.type,
          depth: depth,
          hasReactions: true,
          reactions: filteredReactions,
          path: getNodePath(node),
        });
        await highlightNodeWithAnimation(node);
      }

      const children = prop(node, "children");
      if (children) {
        for (const child of children) {
          await findNodesWithReactions(child, processedNodes, depth + 1, results);
        }
      }

      return results;
    }

    async function highlightNodeWithAnimation(node) {
      const originalStrokeWeight = prop(node, "strokeWeight");
      const currentStrokes = prop(node, "strokes");
      const originalStrokes = currentStrokes ? [...currentStrokes] : [];

      try {
        node.strokeWeight = 4;
        node.strokes = [
          {
            type: "SOLID",
            color: { r: 1, g: 0.5, b: 0 },
            opacity: 0.8,
          },
        ];

        setTimeout(() => {
          try {
            node.strokeWeight = originalStrokeWeight;
            node.strokes = originalStrokes;
          } catch (restoreError) {
            console.error(`Error restoring node stroke: ${restoreError.message}`);
          }
        }, 1500);
      } catch (highlightError) {
        console.error(`Error highlighting node: ${highlightError.message}`);
      }
    }

    function getNodePath(node) {
      const path = [];
      let current = node;

      while (current && current.parent) {
        path.unshift(current.name);
        current = current.parent;
      }

      return path.join(" > ");
    }

    let allResults = [];
    let processedCount = 0;
    const totalCount = nodeIds.length;

    for (let i = 0; i < nodeIds.length; i++) {
      try {
        const nodeId = nodeIds[i];
        const node = await figma.getNodeByIdAsync(nodeId);

        if (!node) {
          processedCount++;
          sendProgressUpdate(
            commandId,
            "get_reactions",
            "in_progress",
            processedCount / totalCount,
            totalCount,
            processedCount,
            `Node not found: ${nodeId}`,
          );
          continue;
        }

        const processedNodes = new Set();
        const nodeResults = await findNodesWithReactions(node, processedNodes);

        allResults = allResults.concat(nodeResults);

        processedCount++;
        sendProgressUpdate(
          commandId,
          "get_reactions",
          "in_progress",
          processedCount / totalCount,
          totalCount,
          processedCount,
          `Processed node ${processedCount}/${totalCount}, found ${nodeResults.length} nodes with reactions`,
        );
      } catch (error) {
        processedCount++;
        sendProgressUpdate(
          commandId,
          "get_reactions",
          "in_progress",
          processedCount / totalCount,
          totalCount,
          processedCount,
          `Error processing node: ${error.message}`,
        );
      }
    }

    sendProgressUpdate(
      commandId,
      "get_reactions",
      "completed",
      1,
      totalCount,
      totalCount,
      `Completed deep search: found ${allResults.length} nodes with reactions.`,
    );

    return {
      nodesCount: nodeIds.length,
      nodesWithReactions: allResults.length,
      nodes: allResults,
    };
  } catch (error) {
    throw new Error(`Failed to get reactions: ${error.message}`);
  }
}

// ─── get_node_tree helpers ────────────────────────────────────────────────────

async function buildNodeOutput(n, detail, inclVars, inclStyles, inclComp, collVarIds, collStyleIds, collCompIds) {
  if (detail === "structure") {
    return { id: n.id, name: n.name, type: n.type };
  }

  const out = { id: n.id, name: n.name, type: n.type };

  // dimensions
  const bbox = prop(n, "absoluteBoundingBox");
  if (bbox) {
    out.x = bbox.x;
    out.y = bbox.y;
    out.width = bbox.width;
    out.height = bbox.height;
  }

  // auto-layout (omit defaults)
  const layoutMode = prop(n, "layoutMode");
  if (layoutMode && layoutMode !== "NONE") {
    out.layoutMode = layoutMode;
    const primaryAxisSizingMode = prop(n, "primaryAxisSizingMode");
    if (primaryAxisSizingMode) out.primaryAxisSizingMode = primaryAxisSizingMode;
    const counterAxisSizingMode = prop(n, "counterAxisSizingMode");
    if (counterAxisSizingMode) out.counterAxisSizingMode = counterAxisSizingMode;
    const primaryAxisAlignItems = prop(n, "primaryAxisAlignItems");
    if (primaryAxisAlignItems && primaryAxisAlignItems !== "MIN") out.primaryAxisAlignItems = primaryAxisAlignItems;
    const counterAxisAlignItems = prop(n, "counterAxisAlignItems");
    if (counterAxisAlignItems && counterAxisAlignItems !== "MIN") out.counterAxisAlignItems = counterAxisAlignItems;
    const itemSpacing = prop(n, "itemSpacing");
    if (itemSpacing && itemSpacing > 0) out.itemSpacing = itemSpacing;
    const paddingLeft = prop(n, "paddingLeft");
    if (paddingLeft && paddingLeft > 0) out.paddingLeft = paddingLeft;
    const paddingRight = prop(n, "paddingRight");
    if (paddingRight && paddingRight > 0) out.paddingRight = paddingRight;
    const paddingTop = prop(n, "paddingTop");
    if (paddingTop && paddingTop > 0) out.paddingTop = paddingTop;
    const paddingBottom = prop(n, "paddingBottom");
    if (paddingBottom && paddingBottom > 0) out.paddingBottom = paddingBottom;
    if (prop(n, "layoutWrap") === "WRAP") out.layoutWrap = "WRAP";
  }

  if (prop(n, "clipsContent")) out.clipsContent = true;

  // text content
  if (n.type === "TEXT" && n.characters) {
    out.text = n.characters;
  }

  // instance: componentRef + componentProperties
  if (n.type === "INSTANCE" && inclComp) {
    const mc = await n.getMainComponentAsync();
    if (mc) {
      out.componentRef = "COMP::" + mc.id;
      collCompIds[mc.id] = true;
    } else {
      out.componentRef = "(unresolved)";
    }
    if (n.componentProperties) {
      // Strip preferredValues from instance componentProperties — they're only useful
      // on definitions and can be 200+ entries per INSTANCE_SWAP property.
      const cleaned = {};
      const propKeys = Object.keys(n.componentProperties);
      for (let i = 0; i < propKeys.length; i++) {
        const k = propKeys[i];
        const cp = n.componentProperties[k];
        cleaned[k] = { type: cp.type, value: cp.value };
        if (cp.boundVariables) {
          cleaned[k].boundVariables = cp.boundVariables;
        }
      }
      out.componentProperties = cleaned;
    }
  }

  // component property definitions (COMPONENT_SET nodes and non-variant COMPONENT nodes)
  // Variant components (children of COMPONENT_SET) don't own property definitions — accessing throws.
  // Check isVariant BEFORE touching the property, as the Figma API throws on access for variants.
  if (n.type === "COMPONENT_SET" || (n.type === "COMPONENT" && !(n.parent && n.parent.type === "COMPONENT_SET"))) {
    const rawDefs = n.componentPropertyDefinitions;
    if (rawDefs) {
      const cleanedDefs = {};
      const defKeys = Object.keys(rawDefs);
      for (let i = 0; i < defKeys.length; i++) {
        const k = defKeys[i];
        const def = rawDefs[k];
        const entry = { type: def.type, defaultValue: def.defaultValue };
        if (def.variantOptions) {
          entry.variantOptions = def.variantOptions;
        }
        if (def.preferredValues && def.preferredValues.length > 0) {
          entry.preferredValuesCount = def.preferredValues.length;
        }
        cleanedDefs[k] = entry;
      }
      out.componentPropertyDefinitions = cleanedDefs;
    }
  }

  // variant properties (COMPONENT nodes)
  const variantProperties = prop(n, "variantProperties");
  if (variantProperties) {
    out.variantProperties = variantProperties;
  }

  // component property references (child nodes wired to component properties)
  const cpRefs = prop(n, "componentPropertyReferences");
  if (cpRefs) {
    const refKeys = Object.keys(cpRefs);
    if (refKeys.length > 0) {
      out.componentPropertyReferences = cpRefs;
    }
  }

  // full level: fills, strokes, variable bindings, text style
  if (detail === "full") {
    const fills = prop(n, "fills");
    if (fills && typeof fills !== "symbol" && fills.length > 0) {
      out.fills = fills.map((fill) => {
        const f = { type: fill.type };
        if (fill.color) f.color = rgbaToHex(fill.color);
        if (fill.opacity !== undefined && fill.opacity !== 1) f.opacity = fill.opacity;
        if (fill.visible !== undefined && !fill.visible) f.visible = false;
        return f;
      });
    }

    const strokes = prop(n, "strokes");
    if (strokes && typeof strokes !== "symbol" && strokes.length > 0) {
      const strokeWeight = prop(n, "strokeWeight");
      const strokeAlign = prop(n, "strokeAlign");
      out.strokes = strokes.map((stroke) => {
        const s = { type: stroke.type };
        if (stroke.color) s.color = rgbaToHex(stroke.color);
        if (strokeWeight && typeof strokeWeight !== "symbol") s.weight = strokeWeight;
        if (strokeAlign) s.align = strokeAlign;
        return s;
      });
    }

    const cornerRadius = prop(n, "cornerRadius");
    if (cornerRadius !== undefined && cornerRadius !== null && typeof cornerRadius !== "symbol") {
      out.cornerRadius = cornerRadius;
    }

    const opacity = prop(n, "opacity");
    if (opacity !== undefined && opacity !== 1) {
      out.opacity = opacity;
    }

    // variable bindings
    const boundVariables = inclVars ? prop(n, "boundVariables") : null;
    if (boundVariables) {
      const bindings = {};
      const bvKeys = Object.keys(boundVariables);
      for (const field of bvKeys) {
        const binding = boundVariables[field];
        if (Array.isArray(binding)) {
          const refs = [];
          for (const slot of binding) {
            if (slot && slot.id) {
              refs.push("VAR::" + slot.id);
              collVarIds[slot.id] = true;
            }
          }
          if (refs.length > 0) bindings[field] = refs;
        } else if (binding && binding.id) {
          bindings[field] = "VAR::" + binding.id;
          collVarIds[binding.id] = true;
        }
      }
      if (Object.keys(bindings).length > 0) {
        out.variableBindings = bindings;
      }
    }

    // text style
    const textStyleId = inclStyles ? prop(n, "textStyleId") : null;
    if (textStyleId && typeof textStyleId === "string") {
      out.textStyle = "STYLE::" + textStyleId;
      collStyleIds[textStyleId] = true;
    }
  }

  return out;
}

export async function getNodeTree(params) {
  const nodeId = params && params.nodeId ? params.nodeId : null;
  const detail = params && params.detail ? params.detail : "layout";
  const userDepth =
    params && params.depth !== undefined && params.depth !== null ? toNumber(params.depth, undefined) : undefined;
  const filter = params && params.filter ? params.filter : {};
  const visibleOnly = filter.visibleOnly !== false;
  const typeWhitelist = filter.types && filter.types.length > 0 ? filter.types : null;
  const namePattern = filter.namePattern && filter.namePattern.length > 0 ? filter.namePattern : null;
  const inclVars = params && params.includeVariables !== false;
  const inclStyles = params && params.includeStyles !== false;
  const inclComp = params && params.includeComponentMeta !== false;

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }

  let nameRegex = null;
  if (namePattern) {
    try {
      nameRegex = new RegExp(namePattern);
    } catch (_e) {
      throw new Error("Invalid namePattern regex: " + namePattern);
    }
  }

  const root = await figma.getNodeByIdAsync(nodeId);
  if (!root) {
    throw new Error("Node not found: " + nodeId);
  }

  // Collectors (keyed by full ID, deduplicated)
  const collVarIds = {};
  const collStyleIds = {};
  const collCompIds = {};
  let nodeCount = 0;

  // walkNode returns an array of output nodes.
  // When a node is filtered out (type/name mismatch), its matching children are promoted up.
  async function walkNode(n, currentDepthFromRoot) {
    nodeCount++;

    const isVisible = prop(n, "visible") !== false;
    if (visibleOnly && !isVisible) return [];

    const typeOk = !typeWhitelist || typeWhitelist.indexOf(n.type) !== -1;
    const nameOk = !nameRegex || nameRegex.test(n.name);

    const isInstance = n.type === "INSTANCE";
    const children = prop(n, "children");
    const hasChildren = children && children.length > 0;
    const atDepthLimit = userDepth !== undefined && currentDepthFromRoot >= userDepth;
    // Stop at instance boundary when no explicit depth, except at root
    const stopAtInstance = isInstance && userDepth === undefined && currentDepthFromRoot > 0;
    const shouldExpand = hasChildren && !atDepthLimit && !stopAtInstance;

    // Collect child results (always descend even if this node is filtered)
    const childResults = [];
    if (shouldExpand) {
      for (const child of children) {
        const sub = await walkNode(child, currentDepthFromRoot + 1);
        for (const item of sub) {
          childResults.push(item);
        }
      }
    }

    // If this node is filtered, promote children
    if (!typeOk || !nameOk) {
      return childResults;
    }

    const out = await buildNodeOutput(n, detail, inclVars, inclStyles, inclComp, collVarIds, collStyleIds, collCompIds);

    if (childResults.length > 0) {
      out.children = childResults;
    }

    if (hasChildren && (atDepthLimit || stopAtInstance)) {
      out.childCount = children.length;
    }

    return [out];
  }

  const treeNodes = await walkNode(root, 0);

  // Phase 2: batch async resolution of collected IDs
  const resolvedVars = {};
  const resolvedStyles = {};
  const resolvedComponents = {};

  if (inclVars && figma.variables) {
    const varIdList = Object.keys(collVarIds);
    const varResults = await Promise.all(
      varIdList.map(async (vid) => {
        try {
          const v = await figma.variables.getVariableByIdAsync(vid);
          if (!v) return null;
          let coll = null;
          if (v.variableCollectionId) {
            coll = await figma.variables.getVariableCollectionByIdAsync(v.variableCollectionId);
          }
          return {
            id: vid,
            name: v.name,
            resolvedType: v.resolvedType,
            collection: coll ? coll.name : null,
          };
        } catch (_e) {
          return null;
        }
      }),
    );
    for (const entry of varResults) {
      if (entry) resolvedVars[entry.id] = entry;
    }
  }

  if (inclStyles) {
    const styleIdList = Object.keys(collStyleIds);
    const styleResults = await Promise.all(
      styleIdList.map(async (sid) => {
        try {
          const s = await figma.getStyleByIdAsync(sid);
          if (!s) return null;
          return { id: sid, name: s.name, type: s.type };
        } catch (_e) {
          return null;
        }
      }),
    );
    for (const entry of styleResults) {
      if (entry) resolvedStyles[entry.id] = entry;
    }
  }

  if (inclComp) {
    const compIdList = Object.keys(collCompIds);
    const compResults = await Promise.all(
      compIdList.map(async (cid) => {
        try {
          const comp = await figma.getNodeByIdAsync(cid);
          if (!comp) return null;
          return {
            id: cid,
            name: comp.name,
            key: prop(comp, "key") || null,
            description: prop(comp, "description") || null,
            parentType: comp.parent ? comp.parent.type : null,
            parentName: comp.parent ? comp.parent.name : null,
          };
        } catch (_e) {
          return null;
        }
      }),
    );
    for (const entry of compResults) {
      if (entry) resolvedComponents[entry.id] = entry;
    }
  }

  // COMPONENT_SET: build variantAxes from children
  let variantAxes = null;
  let defaultVariant = null;
  if (root.type === "COMPONENT_SET" && root.children) {
    const axesMap = {};
    for (const child of root.children) {
      if (child.type !== "COMPONENT") continue;
      const pairs = child.name.split(",");
      for (const pairRaw of pairs) {
        const pair = pairRaw.trim();
        const eqIdx = pair.indexOf("=");
        if (eqIdx === -1) continue;
        const propName = pair.substring(0, eqIdx).trim();
        const propVal = pair.substring(eqIdx + 1).trim();
        if (!axesMap[propName]) axesMap[propName] = [];
        if (axesMap[propName].indexOf(propVal) === -1) axesMap[propName].push(propVal);
      }
    }
    variantAxes = axesMap;
    defaultVariant = root.defaultVariant && root.defaultVariant.name ? root.defaultVariant.name : null;
  }

  return {
    rootId: root.id,
    rootName: root.name,
    rootType: root.type,
    nodeCount: nodeCount,
    rawTree: treeNodes,
    collectedVars: resolvedVars,
    collectedStyles: resolvedStyles,
    collectedComponents: resolvedComponents,
    variantAxes: variantAxes,
    defaultVariant: defaultVariant,
  };
}

// Max nodes accepted in one batch export call.
const EXPORT_MAX_NODES = 20;
// Hard ceiling on total base64 payload (~chars) returned by one call. Roughly
// 4 MB of image data. This is a true ceiling, not a floor: a node is only added
// if it fits within the remaining budget, so the returned payload never exceeds
// this cap (the only exception is a single first image larger than the whole
// cap — see below). Enforcing the ceiling on the plugin side also bounds the
// remote transport's return payload, where `use_figma` does `JSON.stringify`
// with no size guard of its own (remote/executor.ts only budgets the input
// script). Over-budget nodes are reported in `truncated` so the caller can
// re-request them in a follow-up batch.
const EXPORT_MAX_PAYLOAD_CHARS = 4000000;

function mimeTypeForFormat(format) {
  switch (format) {
    case "PNG":
      return "image/png";
    case "JPG":
      return "image/jpeg";
    case "SVG":
      return "image/svg+xml";
    case "PDF":
      return "application/pdf";
    default:
      return "application/octet-stream";
  }
}

async function exportSingleNode(nodeId, format, scale) {
  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    fail(`Node not found with ID: ${nodeId}`, "Verify the node ID with `grep` or `read` — it may be stale after a delete.");
  }

  if (!("exportAsync" in node)) {
    fail(`Node does not support exporting: ${nodeId}`, "Export a node that supports rendering, such as a FRAME, COMPONENT, or GROUP.");
  }

  const settings = {
    format: format,
    constraint: { type: "SCALE", value: scale },
  };

  const bytes = await node.exportAsync(settings);
  const base64 = customBase64Encode(bytes);

  return {
    nodeId,
    format,
    scale,
    mimeType: mimeTypeForFormat(format),
    imageData: base64,
  };
}

export async function exportNodeAsImage(params) {
  const p = params || {};
  const scale = p.scale === undefined ? 1 : p.scale;
  const format = p.format ? p.format : "PNG";

  // Batch mode: a `nodeIds` array returns images keyed by nodeId.
  if (p.nodeIds !== undefined) {
    const nodeIds = p.nodeIds;
    if (!Array.isArray(nodeIds) || nodeIds.length === 0) {
      fail("nodeIds must be a non-empty array of node IDs", "Pass nodeIds: [\"1:2\", \"3:4\"] or use a single nodeId.");
    }
    if (nodeIds.length > EXPORT_MAX_NODES) {
      fail(
        `Too many nodes for one batch export: ${nodeIds.length} (max ${EXPORT_MAX_NODES})`,
        `Split nodeIds into batches of ${EXPORT_MAX_NODES} or fewer.`,
      );
    }

    const images = {};
    const errors = {};
    const truncated = [];
    let payloadChars = 0;

    for (const id of nodeIds) {
      try {
        const single = await exportSingleNode(id, format, scale);
        const imageChars = single.imageData.length;
        // Enforce the cap AFTER export so it is a true ceiling: only add this
        // image if it fits in the remaining budget. Always allow the first
        // image through (images empty) so a single oversized node still
        // returns one result rather than silently producing nothing.
        const isFirst = Object.keys(images).length === 0;
        if (!isFirst && payloadChars + imageChars > EXPORT_MAX_PAYLOAD_CHARS) {
          truncated.push(id);
          continue;
        }
        images[id] = {
          format: single.format,
          scale: single.scale,
          mimeType: single.mimeType,
          imageData: single.imageData,
        };
        payloadChars += imageChars;
      } catch (error) {
        errors[id] = error && error.message ? error.message : String(error);
      }
    }

    const result = {
      batch: true,
      format,
      scale,
      images,
    };
    if (Object.keys(errors).length > 0) {
      result.errors = errors;
    }
    if (truncated.length > 0) {
      result.truncated = truncated;
    }
    return result;
  }

  // Single-node mode (backward compatible). The not-found / unsupported checks
  // in exportSingleNode already throw descriptive, fix-stated errors, so call
  // it directly rather than re-wrapping (which would double-prefix the message).
  const nodeId = p.nodeId;
  if (!nodeId) {
    fail("Missing nodeId parameter", "Pass `nodeId` for one node or `nodeIds` for a batch.");
  }

  return await exportSingleNode(nodeId, format, scale);
}
