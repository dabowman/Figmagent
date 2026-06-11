import { describe, expect, test } from "bun:test";
import { COMMANDS, DOMAINS } from "../src/figma_plugin/src/registry.js";
import { COMMAND_DOMAINS } from "../src/figmagent_mcp/remote/domains";
import { getDomainBundle } from "../src/figmagent_mcp/remote/bundles";

// The full command surface main.js dispatched before the registry refactor.
// This is the wire protocol — names here never change (renames happen at the
// MCP tool layer only).
const EXPECTED_COMMANDS = [
  // document
  "get_document_info",
  "get_selection",
  "get_node_tree",
  "get_reactions",
  "export_node_as_image",
  // create / apply
  "create",
  "apply",
  // modify
  "move_node",
  "resize_node",
  "rename_node",
  "delete_node",
  "delete_multiple_nodes",
  "reorder_children",
  "clone_node",
  "clone_and_modify",
  // text
  "set_text_content",
  "set_multiple_text_contents",
  // components
  "create_component",
  "combine_as_variants",
  "create_component_instance",
  "import_library_component",
  "swap_component_variant",
  "get_main_component",
  "get_instance_overrides",
  "set_instance_overrides",
  "get_component_properties",
  "add_component_property",
  "edit_component_property",
  "delete_component_property",
  "set_exposed_instance",
  "component_properties",
  // scan & annotations
  "scan_text_nodes",
  "scan_nodes_by_types",
  "get_annotations",
  "set_annotation",
  "set_multiple_annotations",
  // find
  "find",
  // styles & variables
  "get_styles",
  "get_local_variables",
  "get_local_components",
  "get_design_system",
  "create_variables",
  "update_variables",
  "create_styles",
  "update_styles",
  // lint
  "lint_design",
  // connections & navigation
  "set_default_connector",
  "create_connections",
  "set_focus",
  "set_selections",
].sort();

// Pre-refactor concurrency classification from main.js (READ_OPS / GLOBAL_OPS).
const EXPECTED_READ = [
  "get_document_info",
  "get_selection",
  "get_node_tree",
  "scan_text_nodes",
  "scan_nodes_by_types",
  "get_styles",
  "get_local_variables",
  "get_local_components",
  "get_annotations",
  "get_reactions",
  "get_instance_overrides",
  "get_main_component",
  "get_component_properties",
  "export_node_as_image",
  "set_selections",
  "set_focus",
  "get_design_system",
  "lint_design",
  "find",
];

const EXPECTED_GLOBAL = [
  "create",
  "apply",
  "delete_multiple_nodes",
  "combine_as_variants",
  "reorder_children",
  "create_connections",
  "set_multiple_text_contents",
  "set_multiple_annotations",
  "set_instance_overrides",
  "create_variables",
  "update_variables",
  "create_styles",
  "update_styles",
  "component_properties",
];

describe("plugin command registry", () => {
  test("covers exactly the commands main.js previously dispatched", () => {
    expect(Object.keys(COMMANDS).sort()).toEqual(EXPECTED_COMMANDS);
  });

  test("every entry has a handler function and a domain", () => {
    for (const entry of Object.values(COMMANDS) as any[]) {
      expect(typeof entry.handler).toBe("function");
      expect(typeof entry.domain).toBe("string");
      expect(Object.keys(DOMAINS)).toContain(entry.domain);
    }
  });

  test("lock classification matches the pre-refactor READ_OPS/GLOBAL_OPS", () => {
    for (const name of EXPECTED_READ) {
      expect(`${name}:${(COMMANDS as any)[name].lock}`).toBe(`${name}:read`);
    }
    for (const name of EXPECTED_GLOBAL) {
      expect(`${name}:${(COMMANDS as any)[name].lock}`).toBe(`${name}:global`);
    }
    // Everything else is a per-node write
    for (const name of Object.keys(COMMANDS)) {
      if (!EXPECTED_READ.includes(name) && !EXPECTED_GLOBAL.includes(name)) {
        expect(`${name}:${(COMMANDS as any)[name].lock}`).toBe(`${name}:node`);
      }
    }
  });

  test("server-side COMMAND_DOMAINS map mirrors the registry exactly", () => {
    expect(Object.keys(COMMAND_DOMAINS).sort()).toEqual(Object.keys(COMMANDS).sort());
    for (const [name, entry] of Object.entries(COMMANDS) as [string, any][]) {
      expect(`${name}:${COMMAND_DOMAINS[name]}`).toBe(`${name}:${entry.domain}`);
    }
  });
});

describe("remote domain bundles", () => {
  test("every domain bundles to a < 40KB IIFE exposing __figmagent", async () => {
    for (const domain of Object.keys(DOMAINS)) {
      const code = await getDomainBundle(domain);
      expect(code.length).toBeGreaterThan(0);
      expect(code.length).toBeLessThan(40000);
      expect(code).toContain("__figmagent");
    }
  }, 30000);
});
