/**
 * Wire command → bundle domain map for the remote transport, plus the Phase 1
 * read-command allowlist. Mirrors the plugin-side registry
 * (src/figma_plugin/src/registry.js) — a test asserts the two stay in sync.
 */

export const COMMAND_DOMAINS: Record<string, string> = {
  // document
  get_document_info: "document",
  get_selection: "document",
  get_node_info: "document",
  get_nodes_info: "document",
  get_node_tree: "document",
  read_my_design: "document",
  get_reactions: "document",
  export_node_as_image: "document",
  // create
  create: "create",
  // apply
  apply: "apply",
  // modify
  move_node: "modify",
  resize_node: "modify",
  rename_node: "modify",
  delete_node: "modify",
  delete_multiple_nodes: "modify",
  reorder_children: "modify",
  clone_node: "modify",
  clone_and_modify: "modify",
  // text
  set_text_content: "text",
  set_multiple_text_contents: "text",
  // components
  create_component: "components",
  combine_as_variants: "components",
  create_component_instance: "components",
  import_library_component: "components",
  swap_component_variant: "components",
  get_main_component: "components",
  get_instance_overrides: "components",
  set_instance_overrides: "components",
  get_component_properties: "components",
  add_component_property: "components",
  edit_component_property: "components",
  delete_component_property: "components",
  set_exposed_instance: "components",
  component_properties: "components",
  // scan & annotations
  scan_text_nodes: "scan",
  scan_nodes_by_types: "scan",
  get_annotations: "scan",
  set_annotation: "scan",
  set_multiple_annotations: "scan",
  // find
  find: "find",
  // styles & variables
  get_styles: "styles",
  get_local_variables: "styles",
  get_local_components: "styles",
  get_design_system: "styles",
  create_variables: "styles",
  update_variables: "styles",
  create_styles: "styles",
  update_styles: "styles",
  // lint
  lint_design: "lint",
  // connections & navigation
  set_default_connector: "connections",
  create_connections: "connections",
  set_focus: "connections",
  set_selections: "connections",
};

/**
 * Commands enabled on the remote transport in Phase 1 (reads only).
 * Phase 2 wires the writes; until then write commands fail with a
 * fix-stating error pointing at FIGMA_TRANSPORT=plugin.
 */
export const REMOTE_READ_COMMANDS = new Set<string>([
  "get_document_info",
  "get_selection",
  "get_node_tree",
  "find",
  "get_design_system",
  "get_styles",
  "get_local_variables",
  "get_local_components",
  "get_annotations",
  "get_reactions",
  "scan_text_nodes",
  "scan_nodes_by_types",
  "lint_design",
  "export_node_as_image",
  "get_main_component",
  "get_instance_overrides",
  "get_component_properties",
]);

export function isRemoteEnabled(command: string, params: unknown): boolean {
  if (!REMOTE_READ_COMMANDS.has(command)) return false;
  // lint_design with autoFix mutates — write path, Phase 2
  if (command === "lint_design" && params && typeof params === "object" && (params as any).autoFix) {
    return false;
  }
  return true;
}
