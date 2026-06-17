/**
 * Wire command → bundle domain map for the remote transport, plus the Phase 1
 * read-command allowlist. Mirrors the plugin-side registry
 * (src/figma_plugin/src/registry.js) — a test asserts the two stay in sync.
 */

export const COMMAND_DOMAINS: Record<string, string> = {
  // document
  get_document_info: "document",
  get_selection: "document",
  get_node_tree: "document",
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
 * Read commands — no mutation, no atomic-retry note on errors. Everything
 * else is a write: a thrown script error means the whole script rolled back
 * (verified), so write errors carry the atomic-retry suffix.
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

/**
 * Plugin-only navigation/control commands. These don't mutate the file (no
 * atomic rollback applies) and aren't in the remote read-set, so for timeout
 * *messaging* they must not be labelled "Write" or carry the degraded-connection
 * hint. `join` especially: a stalled handshake means the plugin never reached
 * the relay, so "re-join the channel" advice is circular and misdirected.
 */
const NON_MUTATING_CONTROL_COMMANDS = new Set<string>(["join", "set_focus", "set_selections", "set_default_connector"]);

/** True when the command mutates the file (atomic rollback applies). */
export function isWriteCommand(command: string, params: unknown): boolean {
  if (NON_MUTATING_CONTROL_COMMANDS.has(command)) return false;
  if (!REMOTE_READ_COMMANDS.has(command)) return true;
  // lint_design is a read unless autoFix binds variables
  if (command === "lint_design" && params && typeof params === "object" && (params as any).autoFix) {
    return true;
  }
  return false;
}

/**
 * Build a timeout message that names the operation type and command (issue #46)
 * so a write-vs-read distinction is visible to the agent. Read/write is
 * classified with the same {@link isWriteCommand} list both transports share.
 * Writes carry the degraded-connection hint because a stalled write while reads
 * still succeed usually means a flaky connection, not a bad request.
 */
export function timeoutMessage(command: string, timeoutMs: number, params?: unknown, isWrite?: boolean): string {
  const seconds = Math.round(timeoutMs / 1000);
  const write = typeof isWrite === "boolean" ? isWrite : isWriteCommand(command, params);
  const kind = write ? "Write" : "Read";
  const base = `${kind} operation "${command}" timed out after ${seconds}s`;
  if (write) {
    return `${base} (if reads succeed but writes fail, the connection may be degraded — try use_file to re-join the channel)`;
  }
  return base;
}
