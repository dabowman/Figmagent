// Text commands: setTextContent, setMultipleTextContents

import { sendProgressUpdate, generateCommandId, findNodeByIdInTree, delay } from "../helpers.js";
import { setCharacters } from "../setcharacters.js";

export async function setTextContent(params) {
  const { nodeId, text } = params || {};

  if (!nodeId) throw new Error("Missing nodeId parameter");
  if (text === undefined) throw new Error("Missing text parameter");

  let node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    node = findNodeByIdInTree(nodeId);
  }
  if (!node) throw new Error(`Node not found with ID: ${nodeId}`);
  if (node.type !== "TEXT") throw new Error(`Node is not a text node: ${nodeId}`);

  try {
    await setCharacters(node, text);

    return {
      id: node.id,
      name: node.name,
      characters: node.characters,
      fontName: node.fontName,
    };
  } catch (error) {
    throw new Error(`Error setting text content: ${error.message}`);
  }
}

export async function setMultipleTextContents(params) {
  const { nodeId, text } = params || {};
  const commandId = params.commandId || generateCommandId();

  if (!nodeId || !text || !Array.isArray(text)) {
    const errorMsg = "Missing required parameters: nodeId and text array";
    sendProgressUpdate(commandId, "set_multiple_text_contents", "error", 0, 0, 0, errorMsg, { error: errorMsg });
    throw new Error(errorMsg);
  }

  console.log(`Starting text replacement for node: ${nodeId} with ${text.length} text replacements`);

  sendProgressUpdate(
    commandId,
    "set_multiple_text_contents",
    "started",
    0,
    text.length,
    0,
    `Starting text replacement for ${text.length} nodes`,
    { totalReplacements: text.length },
  );

  const results = [];
  let successCount = 0;
  let failureCount = 0;

  const CHUNK_SIZE = 5;
  const chunks = [];
  for (let i = 0; i < text.length; i += CHUNK_SIZE) {
    chunks.push(text.slice(i, i + CHUNK_SIZE));
  }

  sendProgressUpdate(
    commandId,
    "set_multiple_text_contents",
    "in_progress",
    5,
    text.length,
    0,
    `Preparing to replace text in ${text.length} nodes using ${chunks.length} chunks`,
    { totalReplacements: text.length, chunks: chunks.length, chunkSize: CHUNK_SIZE },
  );

  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
    const chunk = chunks[chunkIndex];

    sendProgressUpdate(
      commandId,
      "set_multiple_text_contents",
      "in_progress",
      Math.round(5 + (chunkIndex / chunks.length) * 90),
      text.length,
      successCount + failureCount,
      `Processing text replacements chunk ${chunkIndex + 1}/${chunks.length}`,
      { currentChunk: chunkIndex + 1, totalChunks: chunks.length, successCount, failureCount },
    );

    const chunkPromises = chunk.map(async (replacement) => {
      if (!replacement.nodeId || replacement.text === undefined) {
        return {
          success: false,
          nodeId: replacement.nodeId || "unknown",
          error: "Missing nodeId or text in replacement entry",
        };
      }

      try {
        const textNode = await figma.getNodeByIdAsync(replacement.nodeId);

        if (!textNode) {
          return { success: false, nodeId: replacement.nodeId, error: `Node not found: ${replacement.nodeId}` };
        }

        if (textNode.type !== "TEXT") {
          return {
            success: false,
            nodeId: replacement.nodeId,
            error: `Node is not a text node: ${replacement.nodeId} (type: ${textNode.type})`,
          };
        }

        const originalText = textNode.characters;

        let originalFills;
        try {
          originalFills = JSON.parse(JSON.stringify(textNode.fills));
          textNode.fills = [{ type: "SOLID", color: { r: 1, g: 0.5, b: 0 }, opacity: 0.3 }];
        } catch (highlightErr) {
          console.error(`Error highlighting text node: ${highlightErr.message}`);
        }

        await setTextContent({ nodeId: replacement.nodeId, text: replacement.text });

        if (originalFills) {
          try {
            await delay(500);
            textNode.fills = originalFills;
          } catch (restoreErr) {
            console.error(`Error restoring fills: ${restoreErr.message}`);
          }
        }

        return { success: true, nodeId: replacement.nodeId, originalText, translatedText: replacement.text };
      } catch (error) {
        return { success: false, nodeId: replacement.nodeId, error: `Error applying replacement: ${error.message}` };
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
      "set_multiple_text_contents",
      "in_progress",
      Math.round(5 + ((chunkIndex + 1) / chunks.length) * 90),
      text.length,
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
    "set_multiple_text_contents",
    "completed",
    100,
    text.length,
    successCount + failureCount,
    `Text replacement complete: ${successCount} successful, ${failureCount} failed`,
    {
      totalReplacements: text.length,
      replacementsApplied: successCount,
      replacementsFailed: failureCount,
      completedInChunks: chunks.length,
      results,
    },
  );

  return {
    success: successCount > 0,
    nodeId: nodeId,
    replacementsApplied: successCount,
    replacementsFailed: failureCount,
    totalReplacements: text.length,
    results,
    completedInChunks: chunks.length,
    commandId,
  };
}
