// Document, selection, node info, and export commands

import { filterFigmaNode, sendProgressUpdate, generateCommandId, customBase64Encode } from "../helpers.js";

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
      visible: node.visible,
    })),
  };
}

export async function getNodeInfo(nodeId) {
  const node = await figma.getNodeByIdAsync(nodeId);

  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  const response = await node.exportAsync({
    format: "JSON_REST_V1",
  });

  return filterFigmaNode(response.document);
}

export async function getNodesInfo(nodeIds) {
  try {
    const nodes = await Promise.all(nodeIds.map((id) => figma.getNodeByIdAsync(id)));
    const validNodes = nodes.filter((node) => node !== null);

    const responses = await Promise.all(
      validNodes.map(async (node) => {
        const response = await node.exportAsync({
          format: "JSON_REST_V1",
        });
        return {
          nodeId: node.id,
          document: filterFigmaNode(response.document),
        };
      }),
    );

    return responses;
  } catch (error) {
    throw new Error(`Error getting nodes info: ${error.message}`);
  }
}

export async function readMyDesign() {
  try {
    const nodes = await Promise.all(figma.currentPage.selection.map((node) => figma.getNodeByIdAsync(node.id)));
    const validNodes = nodes.filter((node) => node !== null);

    const responses = await Promise.all(
      validNodes.map(async (node) => {
        const response = await node.exportAsync({
          format: "JSON_REST_V1",
        });
        return {
          nodeId: node.id,
          document: filterFigmaNode(response.document),
        };
      }),
    );

    return responses;
  } catch (error) {
    throw new Error(`Error getting nodes info: ${error.message}`);
  }
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
      if (node.reactions && node.reactions.length > 0) {
        filteredReactions = node.reactions.filter((r) => {
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

      if (node.children) {
        for (const child of node.children) {
          await findNodesWithReactions(child, processedNodes, depth + 1, results);
        }
      }

      return results;
    }

    async function highlightNodeWithAnimation(node) {
      const originalStrokeWeight = node.strokeWeight;
      const originalStrokes = node.strokes ? [...node.strokes] : [];

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

export async function exportNodeAsImage(params) {
  const { nodeId, scale = 1 } = params || {};
  const format = "PNG";

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  if (!("exportAsync" in node)) {
    throw new Error(`Node does not support exporting: ${nodeId}`);
  }

  try {
    const settings = {
      format: format,
      constraint: { type: "SCALE", value: scale },
    };

    const bytes = await node.exportAsync(settings);

    let mimeType;
    switch (format) {
      case "PNG":
        mimeType = "image/png";
        break;
      case "JPG":
        mimeType = "image/jpeg";
        break;
      case "SVG":
        mimeType = "image/svg+xml";
        break;
      case "PDF":
        mimeType = "application/pdf";
        break;
      default:
        mimeType = "application/octet-stream";
    }

    const base64 = customBase64Encode(bytes);

    return {
      nodeId,
      format,
      scale,
      mimeType,
      imageData: base64,
    };
  } catch (error) {
    throw new Error(`Error exporting node as image: ${error.message}`);
  }
}
