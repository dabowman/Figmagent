// Command registry — scan & annotations domain.

import {
  scanTextNodes,
  scanNodesByTypes,
  getAnnotations,
  setAnnotation,
  setMultipleAnnotations,
} from "../commands/scan.js";

export const COMMANDS = {
  scan_text_nodes: { lock: "read", handler: (params) => scanTextNodes(params) },
  scan_nodes_by_types: { lock: "read", handler: (params) => scanNodesByTypes(params) },
  get_annotations: { lock: "read", handler: (params) => getAnnotations(params) },
  set_annotation: { lock: "node", handler: (params) => setAnnotation(params) },
  set_multiple_annotations: { lock: "global", handler: (params) => setMultipleAnnotations(params) },
};
