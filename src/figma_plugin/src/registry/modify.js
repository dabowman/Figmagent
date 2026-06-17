// Command registry — modify domain.

import {
  moveNode,
  resizeNode,
  renameNode,
  deleteNode,
  deleteMultipleNodes,
  reorderChildren,
  cloneNode,
  cloneAndModify,
} from "../commands/modify.js";

export const COMMANDS = {
  move_node: { lock: "node", handler: (params) => moveNode(params) },
  resize_node: { lock: "node", handler: (params) => resizeNode(params) },
  rename_node: { lock: "node", handler: (params) => renameNode(params) },
  delete_node: { lock: "node", handler: (params) => deleteNode(params) },
  delete_multiple_nodes: { lock: "global", handler: (params) => deleteMultipleNodes(params) },
  reorder_children: { lock: "global", handler: (params) => reorderChildren(params) },
  clone_node: { lock: "node", handler: (params) => cloneNode(params) },
  clone_and_modify: { lock: "node", handler: (params) => cloneAndModify(params) },
};
