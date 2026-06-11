// Command registry — document domain.
// Each entry: { lock: "read" | "global" | "node", handler: (params) => result }.
// Handlers take a single params object; positional-arg command functions are
// wrapped here (including the params-presence validation main.js used to inline).

import { getDocumentInfo, getSelection, getReactions, exportNodeAsImage, getNodeTree } from "../commands/document.js";

export const COMMANDS = {
  get_document_info: { lock: "read", handler: () => getDocumentInfo() },
  get_selection: { lock: "read", handler: () => getSelection() },
  get_node_tree: {
    lock: "read",
    handler: (params) => {
      if (!params || !params.nodeId) {
        throw new Error("Missing nodeId parameter");
      }
      return getNodeTree(params);
    },
  },
  get_reactions: {
    lock: "read",
    handler: (params) => {
      if (!params || !params.nodeIds || !Array.isArray(params.nodeIds)) {
        throw new Error("Missing or invalid nodeIds parameter");
      }
      return getReactions(params.nodeIds);
    },
  },
  export_node_as_image: { lock: "read", handler: (params) => exportNodeAsImage(params) },
};
