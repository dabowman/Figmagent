// Connection commands: setDefaultConnector, createConnections, setFocus, setSelections

import { sendProgressUpdate, generateCommandId } from "../helpers.js";

export async function setDefaultConnector(params) {
  const { connectorId } = params || {};

  if (connectorId) {
    const node = await figma.getNodeByIdAsync(connectorId);
    if (!node) {
      throw new Error(`Connector node not found with ID: ${connectorId}`);
    }

    if (node.type !== "CONNECTOR") {
      throw new Error(`Node is not a connector: ${connectorId}`);
    }

    await figma.clientStorage.setAsync("defaultConnectorId", connectorId);

    return {
      success: true,
      message: `Default connector set to: ${connectorId}`,
      connectorId: connectorId,
    };
  } else {
    try {
      const existingConnectorId = await figma.clientStorage.getAsync("defaultConnectorId");

      if (existingConnectorId) {
        try {
          const existingConnector = await figma.getNodeByIdAsync(existingConnectorId);

          if (existingConnector && existingConnector.type === "CONNECTOR") {
            return {
              success: true,
              message: `Default connector is already set to: ${existingConnectorId}`,
              connectorId: existingConnectorId,
              exists: true,
            };
          } else {
            console.log(`Stored connector ID ${existingConnectorId} is no longer valid, finding a new connector...`);
          }
        } catch (error) {
          console.log(`Error finding stored connector: ${error.message}. Will try to set a new one.`);
        }
      }
    } catch (error) {
      console.log(`Error checking for existing connector: ${error.message}`);
    }

    try {
      const currentPageConnectors = figma.currentPage.findAllWithCriteria({ types: ["CONNECTOR"] });

      if (currentPageConnectors && currentPageConnectors.length > 0) {
        const foundConnector = currentPageConnectors[0];
        const autoFoundId = foundConnector.id;

        await figma.clientStorage.setAsync("defaultConnectorId", autoFoundId);

        return {
          success: true,
          message: `Automatically found and set default connector to: ${autoFoundId}`,
          connectorId: autoFoundId,
          autoSelected: true,
        };
      } else {
        throw new Error(
          "No connector found in the current page. Please create a connector in Figma first or specify a connector ID.",
        );
      }
    } catch (error) {
      throw new Error(`Failed to find a connector: ${error.message}`);
    }
  }
}

async function createCursorNode(targetNodeId) {
  const svgString = `<svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M16 8V35.2419L22 28.4315L27 39.7823C27 39.7823 28.3526 40.2722 29 39.7823C29.6474 39.2924 30.2913 38.3057 30 37.5121C28.6247 33.7654 25 26.1613 25 26.1613H32L16 8Z" fill="#202125" />
  </svg>`;
  try {
    const targetNode = await figma.getNodeByIdAsync(targetNodeId);
    if (!targetNode) throw new Error("Target node not found");

    const parentNodeId = targetNodeId.includes(";") ? targetNodeId.split(";")[0] : targetNodeId;
    if (!parentNodeId) throw new Error("Could not determine parent node ID");

    let parentNode = await figma.getNodeByIdAsync(parentNodeId);
    if (!parentNode) throw new Error("Parent node not found");

    if (parentNode.type === "INSTANCE" || parentNode.type === "COMPONENT" || parentNode.type === "COMPONENT_SET") {
      parentNode = parentNode.parent;
      if (!parentNode) throw new Error("Parent node not found");
    }

    const importedNode = await figma.createNodeFromSvg(svgString);
    if (!importedNode || !importedNode.id) {
      throw new Error("Failed to create imported cursor node");
    }
    importedNode.name = "TTF_Connector / Mouse Cursor";
    importedNode.resize(48, 48);

    const cursorNode = importedNode.findOne((node) => node.type === "VECTOR");
    if (cursorNode) {
      cursorNode.fills = [
        {
          type: "SOLID",
          color: { r: 0, g: 0, b: 0 },
          opacity: 1,
        },
      ];
      cursorNode.strokes = [
        {
          type: "SOLID",
          color: { r: 1, g: 1, b: 1 },
          opacity: 1,
        },
      ];
      cursorNode.strokeWeight = 2;
      cursorNode.strokeAlign = "OUTSIDE";
      cursorNode.effects = [
        {
          type: "DROP_SHADOW",
          color: { r: 0, g: 0, b: 0, a: 0.3 },
          offset: { x: 1, y: 1 },
          radius: 2,
          spread: 0,
          visible: true,
          blendMode: "NORMAL",
        },
      ];
    }

    parentNode.appendChild(importedNode);

    if ("layoutMode" in parentNode && parentNode.layoutMode !== "NONE") {
      importedNode.layoutPositioning = "ABSOLUTE";
    }

    if (targetNode.absoluteBoundingBox && parentNode.absoluteBoundingBox) {
      console.log("targetNode.absoluteBoundingBox", targetNode.absoluteBoundingBox);
      console.log("parentNode.absoluteBoundingBox", parentNode.absoluteBoundingBox);
      importedNode.x =
        targetNode.absoluteBoundingBox.x -
        parentNode.absoluteBoundingBox.x +
        targetNode.absoluteBoundingBox.width / 2 -
        48 / 2;
      importedNode.y =
        targetNode.absoluteBoundingBox.y -
        parentNode.absoluteBoundingBox.y +
        targetNode.absoluteBoundingBox.height / 2 -
        48 / 2;
    } else if ("x" in targetNode && "y" in targetNode && "width" in targetNode && "height" in targetNode) {
      console.log("targetNode.x/y/width/height", targetNode.x, targetNode.y, targetNode.width, targetNode.height);
      importedNode.x = targetNode.x + targetNode.width / 2 - 48 / 2;
      importedNode.y = targetNode.y + targetNode.height / 2 - 48 / 2;
    } else {
      if ("x" in targetNode && "y" in targetNode) {
        console.log("Fallback to targetNode x/y");
        importedNode.x = targetNode.x;
        importedNode.y = targetNode.y;
      } else {
        console.log("Fallback to (0,0)");
        importedNode.x = 0;
        importedNode.y = 0;
      }
    }

    console.log("importedNode", importedNode);

    return { id: importedNode.id, node: importedNode };
  } catch (error) {
    console.error("Error creating cursor from SVG:", error);
    return { id: null, node: null, error: error.message };
  }
}

export async function createConnections(params) {
  if (!params || !params.connections || !Array.isArray(params.connections)) {
    throw new Error("Missing or invalid connections parameter");
  }

  const { connections } = params;

  const commandId = generateCommandId();
  sendProgressUpdate(
    commandId,
    "create_connections",
    "started",
    0,
    connections.length,
    0,
    `Starting to create ${connections.length} connections`,
  );

  const defaultConnectorId = await figma.clientStorage.getAsync("defaultConnectorId");
  if (!defaultConnectorId) {
    throw new Error(
      'No default connector set. Please try one of the following options to create connections:\n1. Create a connector in FigJam and copy/paste it to your current page, then run the "set_default_connector" command.\n2. Select an existing connector on the current page, then run the "set_default_connector" command.',
    );
  }

  const defaultConnector = await figma.getNodeByIdAsync(defaultConnectorId);
  if (!defaultConnector) {
    throw new Error(`Default connector not found with ID: ${defaultConnectorId}`);
  }
  if (defaultConnector.type !== "CONNECTOR") {
    throw new Error(`Node is not a connector: ${defaultConnectorId}`);
  }

  const results = [];
  let processedCount = 0;
  const totalCount = connections.length;

  for (let i = 0; i < connections.length; i++) {
    try {
      const { startNodeId: originalStartId, endNodeId: originalEndId, text } = connections[i];
      let startId = originalStartId;
      let endId = originalEndId;

      if (startId.includes(";")) {
        console.log(`Nested start node detected: ${startId}. Creating cursor node.`);
        const cursorResult = await createCursorNode(startId);
        if (!cursorResult || !cursorResult.id) {
          throw new Error(`Failed to create cursor node for nested start node: ${startId}`);
        }
        startId = cursorResult.id;
      }

      const startNode = await figma.getNodeByIdAsync(startId);
      if (!startNode) throw new Error(`Start node not found with ID: ${startId}`);

      if (endId.includes(";")) {
        console.log(`Nested end node detected: ${endId}. Creating cursor node.`);
        const cursorResult = await createCursorNode(endId);
        if (!cursorResult || !cursorResult.id) {
          throw new Error(`Failed to create cursor node for nested end node: ${endId}`);
        }
        endId = cursorResult.id;
      }
      const endNode = await figma.getNodeByIdAsync(endId);
      if (!endNode) throw new Error(`End node not found with ID: ${endId}`);

      const clonedConnector = defaultConnector.clone();

      clonedConnector.name = `TTF_Connector/${startNode.id}/${endNode.id}`;

      clonedConnector.connectorStart = {
        endpointNodeId: startId,
        magnet: "AUTO",
      };

      clonedConnector.connectorEnd = {
        endpointNodeId: endId,
        magnet: "AUTO",
      };

      if (text) {
        try {
          try {
            if (defaultConnector.text && defaultConnector.text.fontName) {
              const fontName = defaultConnector.text.fontName;
              await figma.loadFontAsync(fontName);
              clonedConnector.text.fontName = fontName;
            } else {
              await figma.loadFontAsync({ family: "Inter", style: "Regular" });
            }
          } catch (fontError) {
            try {
              await figma.loadFontAsync({ family: "Inter", style: "Medium" });
            } catch (_mediumFontError) {
              try {
                await figma.loadFontAsync({ family: "System", style: "Regular" });
              } catch (_systemFontError) {
                throw new Error(`Failed to load any font: ${fontError.message}`);
              }
            }
          }

          clonedConnector.text.characters = text;
        } catch (textError) {
          console.error("Error setting text:", textError);
          results.push({
            id: clonedConnector.id,
            startNodeId: startId,
            endNodeId: endId,
            text: "",
            textError: textError.message,
          });
          continue;
        }
      }

      results.push({
        id: clonedConnector.id,
        originalStartNodeId: originalStartId,
        originalEndNodeId: originalEndId,
        usedStartNodeId: startId,
        usedEndNodeId: endId,
        text: text || "",
      });

      processedCount++;
      sendProgressUpdate(
        commandId,
        "create_connections",
        "in_progress",
        processedCount / totalCount,
        totalCount,
        processedCount,
        `Created connection ${processedCount}/${totalCount}`,
      );
    } catch (error) {
      console.error("Error creating connection", error);
      processedCount++;
      sendProgressUpdate(
        commandId,
        "create_connections",
        "in_progress",
        processedCount / totalCount,
        totalCount,
        processedCount,
        `Error creating connection: ${error.message}`,
      );

      results.push({
        error: error.message,
        connectionInfo: connections[i],
      });
    }
  }

  sendProgressUpdate(
    commandId,
    "create_connections",
    "completed",
    1,
    totalCount,
    totalCount,
    `Completed creating ${results.length} connections`,
  );

  return {
    success: true,
    count: results.length,
    connections: results,
  };
}

export async function setFocus(params) {
  if (!params || !params.nodeId) {
    throw new Error("Missing nodeId parameter");
  }

  const node = await figma.getNodeByIdAsync(params.nodeId);
  if (!node) {
    throw new Error(`Node with ID ${params.nodeId} not found`);
  }

  figma.currentPage.selection = [node];
  figma.viewport.scrollAndZoomIntoView([node]);

  return {
    success: true,
    name: node.name,
    id: node.id,
    message: `Focused on node "${node.name}"`,
  };
}

export async function setSelections(params) {
  if (!params || !params.nodeIds || !Array.isArray(params.nodeIds)) {
    throw new Error("Missing or invalid nodeIds parameter");
  }

  if (params.nodeIds.length === 0) {
    throw new Error("nodeIds array cannot be empty");
  }

  const nodes = [];
  const notFoundIds = [];

  for (const nodeId of params.nodeIds) {
    const node = await figma.getNodeByIdAsync(nodeId);
    if (node) {
      nodes.push(node);
    } else {
      notFoundIds.push(nodeId);
    }
  }

  if (nodes.length === 0) {
    throw new Error(`No valid nodes found for the provided IDs: ${params.nodeIds.join(", ")}`);
  }

  figma.currentPage.selection = nodes;
  figma.viewport.scrollAndZoomIntoView(nodes);

  const selectedNodes = nodes.map((node) => ({
    name: node.name,
    id: node.id,
  }));

  return {
    success: true,
    count: nodes.length,
    selectedNodes: selectedNodes,
    notFoundIds: notFoundIds,
    message: `Selected ${nodes.length} nodes${notFoundIds.length > 0 ? ` (${notFoundIds.length} not found)` : ""}`,
  };
}
