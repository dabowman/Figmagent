// Modify commands: fill, stroke, move, resize, corner radius, rename,
// delete, delete multiple, multiple properties, reorder, clone, clone and modify

import { toNumber, sendProgressUpdate, generateCommandId, delay } from "../helpers.js";

export async function setFillColor(params) {
  console.log("setFillColor", params);
  const {
    nodeId,
    color: { r, g, b, a },
  } = params || {};

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  if (!("fills" in node)) {
    throw new Error(`Node does not support fills: ${nodeId}`);
  }

  const rgbColor = {
    r: parseFloat(r) || 0,
    g: parseFloat(g) || 0,
    b: parseFloat(b) || 0,
    a: a !== undefined ? parseFloat(a) : 1,
  };

  const paintStyle = {
    type: "SOLID",
    color: {
      r: parseFloat(rgbColor.r),
      g: parseFloat(rgbColor.g),
      b: parseFloat(rgbColor.b),
    },
    opacity: parseFloat(rgbColor.a),
  };

  console.log("paintStyle", paintStyle);

  node.fills = [paintStyle];

  return {
    id: node.id,
    name: node.name,
    fills: [paintStyle],
  };
}

export async function setStrokeColor(params) {
  const {
    nodeId,
    color: { r, g, b, a },
    weight = 1,
  } = params || {};

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  if (!("strokes" in node)) {
    throw new Error(`Node does not support strokes: ${nodeId}`);
  }

  const rgbColor = {
    r: r !== undefined ? r : 0,
    g: g !== undefined ? g : 0,
    b: b !== undefined ? b : 0,
    a: a !== undefined ? a : 1,
  };

  const paintStyle = {
    type: "SOLID",
    color: { r: rgbColor.r, g: rgbColor.g, b: rgbColor.b },
    opacity: rgbColor.a,
  };

  node.strokes = [paintStyle];

  if ("strokeWeight" in node) {
    node.strokeWeight = weight;
  }

  return {
    id: node.id,
    name: node.name,
    strokes: node.strokes,
    strokeWeight: "strokeWeight" in node ? node.strokeWeight : undefined,
  };
}

export async function moveNode(params) {
  const { nodeId, x, y } = params || {};

  if (!nodeId) throw new Error("Missing nodeId parameter");
  if (x === undefined || y === undefined) throw new Error("Missing x or y parameters");

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) throw new Error(`Node not found with ID: ${nodeId}`);
  if (!("x" in node) || !("y" in node)) throw new Error(`Node does not support position: ${nodeId}`);

  node.x = x;
  node.y = y;

  return { id: node.id, name: node.name, x: node.x, y: node.y };
}

export async function resizeNode(params) {
  const { nodeId, width, height } = params || {};

  if (!nodeId) throw new Error("Missing nodeId parameter");
  if (width === undefined || height === undefined) throw new Error("Missing width or height parameters");

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) throw new Error(`Node not found with ID: ${nodeId}`);
  if (!("resize" in node)) throw new Error(`Node does not support resizing: ${nodeId}`);

  node.resize(width, height);

  return { id: node.id, name: node.name, width: node.width, height: node.height };
}

export async function setCornerRadius(params) {
  const { nodeId, radius, corners } = params || {};

  if (!nodeId) throw new Error("Missing nodeId parameter");
  if (radius === undefined) throw new Error("Missing radius parameter");

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) throw new Error(`Node not found with ID: ${nodeId}`);
  if (!("cornerRadius" in node)) throw new Error(`Node does not support corner radius: ${nodeId}`);

  var numRadius = toNumber(radius, 0);

  if (corners && Array.isArray(corners) && corners.length === 4) {
    if ("topLeftRadius" in node) {
      if (corners[0]) node.topLeftRadius = numRadius;
      if (corners[1]) node.topRightRadius = numRadius;
      if (corners[2]) node.bottomRightRadius = numRadius;
      if (corners[3]) node.bottomLeftRadius = numRadius;
    } else {
      node.cornerRadius = numRadius;
    }
  } else {
    node.cornerRadius = numRadius;
  }

  return {
    id: node.id,
    name: node.name,
    cornerRadius: "cornerRadius" in node ? node.cornerRadius : undefined,
    topLeftRadius: "topLeftRadius" in node ? node.topLeftRadius : undefined,
    topRightRadius: "topRightRadius" in node ? node.topRightRadius : undefined,
    bottomRightRadius: "bottomRightRadius" in node ? node.bottomRightRadius : undefined,
    bottomLeftRadius: "bottomLeftRadius" in node ? node.bottomLeftRadius : undefined,
  };
}

export async function renameNode(params) {
  const { nodeId, name } = params || {};

  if (!nodeId) throw new Error("Missing nodeId parameter");
  if (name === undefined) throw new Error("Missing name parameter");

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) throw new Error("Node not found: " + nodeId);

  const oldName = node.name;
  node.name = name;

  return { id: node.id, oldName: oldName, newName: node.name, type: node.type };
}

export async function deleteNode(params) {
  const { nodeId } = params || {};

  if (!nodeId) throw new Error("Missing nodeId parameter");

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) throw new Error(`Node not found with ID: ${nodeId}`);

  const nodeInfo = { id: node.id, name: node.name, type: node.type };
  node.remove();

  return nodeInfo;
}

export async function deleteMultipleNodes(params) {
  const { nodeIds } = params || {};
  const commandId = generateCommandId();

  if (!nodeIds || !Array.isArray(nodeIds) || nodeIds.length === 0) {
    const errorMsg = "Missing or invalid nodeIds parameter";
    sendProgressUpdate(commandId, "delete_multiple_nodes", "error", 0, 0, 0, errorMsg, { error: errorMsg });
    throw new Error(errorMsg);
  }

  console.log(`Starting deletion of ${nodeIds.length} nodes`);

  sendProgressUpdate(
    commandId,
    "delete_multiple_nodes",
    "started",
    0,
    nodeIds.length,
    0,
    `Starting deletion of ${nodeIds.length} nodes`,
    { totalNodes: nodeIds.length },
  );

  const results = [];
  let successCount = 0;
  let failureCount = 0;

  const CHUNK_SIZE = 5;
  const chunks = [];
  for (let i = 0; i < nodeIds.length; i += CHUNK_SIZE) {
    chunks.push(nodeIds.slice(i, i + CHUNK_SIZE));
  }

  sendProgressUpdate(
    commandId,
    "delete_multiple_nodes",
    "in_progress",
    5,
    nodeIds.length,
    0,
    `Preparing to delete ${nodeIds.length} nodes using ${chunks.length} chunks`,
    { totalNodes: nodeIds.length, chunks: chunks.length, chunkSize: CHUNK_SIZE },
  );

  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
    const chunk = chunks[chunkIndex];

    sendProgressUpdate(
      commandId,
      "delete_multiple_nodes",
      "in_progress",
      Math.round(5 + (chunkIndex / chunks.length) * 90),
      nodeIds.length,
      successCount + failureCount,
      `Processing deletion chunk ${chunkIndex + 1}/${chunks.length}`,
      { currentChunk: chunkIndex + 1, totalChunks: chunks.length, successCount, failureCount },
    );

    const chunkPromises = chunk.map(async (nodeId) => {
      try {
        const node = await figma.getNodeByIdAsync(nodeId);
        if (!node) {
          return { success: false, nodeId: nodeId, error: `Node not found: ${nodeId}` };
        }
        const nodeInfo = { id: node.id, name: node.name, type: node.type };
        node.remove();
        return { success: true, nodeId: nodeId, nodeInfo: nodeInfo };
      } catch (error) {
        return { success: false, nodeId: nodeId, error: error.message };
      }
    });

    const chunkResults = await Promise.all(chunkPromises);
    chunkResults.forEach((result) => {
      if (result.success) successCount++;
      else failureCount++;
      results.push(result);
    });

    sendProgressUpdate(
      commandId,
      "delete_multiple_nodes",
      "in_progress",
      Math.round(5 + ((chunkIndex + 1) / chunks.length) * 90),
      nodeIds.length,
      successCount + failureCount,
      `Completed chunk ${chunkIndex + 1}/${chunks.length}. ${successCount} successful, ${failureCount} failed so far.`,
      { currentChunk: chunkIndex + 1, totalChunks: chunks.length, successCount, failureCount, chunkResults },
    );

    if (chunkIndex < chunks.length - 1) {
      await delay(1000);
    }
  }

  sendProgressUpdate(
    commandId,
    "delete_multiple_nodes",
    "completed",
    100,
    nodeIds.length,
    successCount + failureCount,
    `Node deletion complete: ${successCount} successful, ${failureCount} failed`,
    {
      totalNodes: nodeIds.length,
      nodesDeleted: successCount,
      nodesFailed: failureCount,
      completedInChunks: chunks.length,
      results,
    },
  );

  return {
    success: successCount > 0,
    nodesDeleted: successCount,
    nodesFailed: failureCount,
    totalNodes: nodeIds.length,
    results: results,
    completedInChunks: chunks.length,
    commandId,
  };
}

export async function setMultipleProperties(params) {
  const operations = params.operations;
  const commandId = params.commandId;

  if (!operations || !Array.isArray(operations) || operations.length === 0) {
    throw new Error("Missing or empty operations array");
  }

  const totalOps = operations.length;
  let successCount = 0;
  let failureCount = 0;
  const results = [];

  if (commandId) {
    sendProgressUpdate(commandId, "set_multiple_properties", "started", 0, totalOps, 0, "Starting property updates");
  }

  const CHUNK_SIZE = 5;
  const totalChunks = Math.ceil(totalOps / CHUNK_SIZE);

  for (let chunkIdx = 0; chunkIdx < totalChunks; chunkIdx++) {
    const start = chunkIdx * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, totalOps);
    const chunk = operations.slice(start, end);

    const chunkPromises = chunk.map((op) =>
      (async (op) => {
        try {
          const node = await figma.getNodeByIdAsync(op.nodeId);
          if (!node) throw new Error("Node not found: " + op.nodeId);

          if (op.fillColor && "fills" in node) {
            const fc = op.fillColor;
            node.fills = [
              {
                type: "SOLID",
                color: { r: parseFloat(fc.r) || 0, g: parseFloat(fc.g) || 0, b: parseFloat(fc.b) || 0 },
                opacity: fc.a !== undefined ? parseFloat(fc.a) : 1,
              },
            ];
          }
          if (op.strokeColor && "strokes" in node) {
            const sc = op.strokeColor;
            node.strokes = [
              {
                type: "SOLID",
                color: { r: parseFloat(sc.r) || 0, g: parseFloat(sc.g) || 0, b: parseFloat(sc.b) || 0 },
                opacity: sc.a !== undefined ? parseFloat(sc.a) : 1,
              },
            ];
          }
          if (op.strokeWeight !== undefined && "strokeWeight" in node) node.strokeWeight = toNumber(op.strokeWeight, 1);
          if (op.cornerRadius !== undefined && "cornerRadius" in node) node.cornerRadius = toNumber(op.cornerRadius, 0);
          if (op.layoutSizingHorizontal !== undefined && "layoutSizingHorizontal" in node)
            node.layoutSizingHorizontal = op.layoutSizingHorizontal;
          if (op.layoutSizingVertical !== undefined && "layoutSizingVertical" in node)
            node.layoutSizingVertical = op.layoutSizingVertical;
          if (op.paddingTop !== undefined && "paddingTop" in node) node.paddingTop = toNumber(op.paddingTop, 0);
          if (op.paddingRight !== undefined && "paddingRight" in node) node.paddingRight = toNumber(op.paddingRight, 0);
          if (op.paddingBottom !== undefined && "paddingBottom" in node)
            node.paddingBottom = toNumber(op.paddingBottom, 0);
          if (op.paddingLeft !== undefined && "paddingLeft" in node) node.paddingLeft = toNumber(op.paddingLeft, 0);
          if (op.itemSpacing !== undefined && "itemSpacing" in node) node.itemSpacing = toNumber(op.itemSpacing, 0);

          return { success: true, nodeId: op.nodeId };
        } catch (e) {
          return { success: false, nodeId: op.nodeId, error: e.message || String(e) };
        }
      })(op),
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
        "set_multiple_properties",
        "in_progress",
        pct,
        totalOps,
        processed,
        "Processed " + processed + " of " + totalOps,
        { currentChunk: chunkIdx + 1, totalChunks, chunkSize: CHUNK_SIZE },
      );
    }
  }

  if (commandId) {
    sendProgressUpdate(
      commandId,
      "set_multiple_properties",
      "completed",
      100,
      totalOps,
      totalOps,
      "All property updates completed",
    );
  }

  return { success: failureCount === 0, totalOperations: totalOps, successCount, failureCount, results };
}

export async function reorderChildren(params) {
  const parentId = params.parentId;
  const childIds = params.childIds;

  if (!parentId) throw new Error("Missing parentId parameter");
  if (!childIds || !Array.isArray(childIds) || childIds.length === 0) {
    throw new Error("Missing or invalid childIds parameter");
  }

  const parent = await figma.getNodeByIdAsync(parentId);
  if (!parent) throw new Error("Parent node not found: " + parentId);
  if (!("children" in parent)) throw new Error("Node does not support children: " + parentId);

  const childMap = {};
  for (let i = 0; i < parent.children.length; i++) {
    childMap[parent.children[i].id] = parent.children[i];
  }

  let moved = 0;
  for (let idx = 0; idx < childIds.length; idx++) {
    const child = childMap[childIds[idx]];
    if (child) {
      parent.insertChild(idx, child);
      moved++;
    }
  }

  return {
    parentId: parent.id,
    parentName: parent.name,
    newOrder: parent.children.map((c) => ({ id: c.id, name: c.name })),
    movedCount: moved,
  };
}

export async function cloneNode(params) {
  const { nodeId, x, y } = params || {};

  if (!nodeId) throw new Error("Missing nodeId parameter");

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) throw new Error(`Node not found with ID: ${nodeId}`);

  const clone = node.clone();

  if (x !== undefined && y !== undefined) {
    if (!("x" in clone) || !("y" in clone)) throw new Error(`Cloned node does not support position: ${nodeId}`);
    clone.x = x;
    clone.y = y;
  }

  if (node.parent) {
    node.parent.appendChild(clone);
  } else {
    figma.currentPage.appendChild(clone);
  }

  return {
    id: clone.id,
    name: clone.name,
    x: "x" in clone ? clone.x : undefined,
    y: "y" in clone ? clone.y : undefined,
    width: "width" in clone ? clone.width : undefined,
    height: "height" in clone ? clone.height : undefined,
  };
}

export async function cloneAndModify(params) {
  const nodeId = params.nodeId;
  const targetParentId = params.parentId;
  const newName = params.name;

  if (!nodeId) throw new Error("Missing nodeId parameter");

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) throw new Error("Node not found: " + nodeId);

  const clone = node.clone();

  if (targetParentId) {
    const targetParent = await figma.getNodeByIdAsync(targetParentId);
    if (!targetParent) throw new Error("Target parent not found: " + targetParentId);
    if (!("appendChild" in targetParent)) throw new Error("Target parent does not support children: " + targetParentId);
    targetParent.appendChild(clone);
  } else if (node.parent && node.parent.id !== figma.currentPage.id) {
    node.parent.appendChild(clone);
  }

  if (newName !== undefined) clone.name = newName;
  if (params.x !== undefined) clone.x = toNumber(params.x, 0);
  if (params.y !== undefined) clone.y = toNumber(params.y, 0);

  if (params.fillColor && "fills" in clone) {
    const fc = params.fillColor;
    clone.fills = [
      {
        type: "SOLID",
        color: { r: parseFloat(fc.r) || 0, g: parseFloat(fc.g) || 0, b: parseFloat(fc.b) || 0 },
        opacity: fc.a !== undefined ? parseFloat(fc.a) : 1,
      },
    ];
  }

  if (params.cornerRadius !== undefined && "cornerRadius" in clone) {
    clone.cornerRadius = toNumber(params.cornerRadius, 0);
  }

  return {
    id: clone.id,
    name: clone.name,
    type: clone.type,
    x: clone.x,
    y: clone.y,
    width: clone.width,
    height: clone.height,
    parentId: clone.parent ? clone.parent.id : undefined,
  };
}
