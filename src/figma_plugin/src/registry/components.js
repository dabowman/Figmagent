// Command registry — components domain.
// The get_instance_overrides / set_instance_overrides wrappers carry the
// resolution + validation logic that previously lived inline in main.js.

import {
  createComponent,
  combineAsVariants,
  createComponentInstance,
  importLibraryComponent,
  swapComponentVariant,
  getMainComponent,
  getInstanceOverrides,
  getValidTargetInstances,
  getSourceInstanceData,
  setInstanceOverrides,
  getComponentProperties,
  addComponentProperty,
  editComponentProperty,
  deleteComponentProperty,
  setExposedInstance,
  componentProperties,
} from "../commands/components.js";

export const COMMANDS = {
  create_component: { lock: "node", handler: (params) => createComponent(params) },
  combine_as_variants: { lock: "global", handler: (params) => combineAsVariants(params) },
  create_component_instance: { lock: "node", handler: (params) => createComponentInstance(params) },
  import_library_component: { lock: "node", handler: (params) => importLibraryComponent(params) },
  swap_component_variant: { lock: "node", handler: (params) => swapComponentVariant(params) },
  get_main_component: { lock: "read", handler: (params) => getMainComponent(params) },
  get_instance_overrides: {
    lock: "read",
    handler: async (params) => {
      if (params && params.instanceNodeId) {
        const instanceNode = await figma.getNodeByIdAsync(params.instanceNodeId);
        if (!instanceNode) {
          throw new Error(`Instance node not found with ID: ${params.instanceNodeId}`);
        }
        return getInstanceOverrides(instanceNode);
      }
      return getInstanceOverrides();
    },
  },
  set_instance_overrides: {
    lock: "global",
    handler: async (params) => {
      if (!params || !params.targetNodeIds) {
        throw new Error("Missing targetNodeIds parameter");
      }
      if (!Array.isArray(params.targetNodeIds)) {
        throw new Error("targetNodeIds must be an array");
      }
      const targetNodes = await getValidTargetInstances(params.targetNodeIds);
      if (!targetNodes.success) {
        figma.notify(targetNodes.message);
        return { success: false, message: targetNodes.message };
      }
      if (!params.sourceInstanceId) {
        throw new Error("Missing sourceInstanceId parameter");
      }
      const sourceInstanceData = await getSourceInstanceData(params.sourceInstanceId);
      if (!sourceInstanceData.success) {
        figma.notify(sourceInstanceData.message);
        return { success: false, message: sourceInstanceData.message };
      }
      return setInstanceOverrides(targetNodes.targetInstances, sourceInstanceData);
    },
  },
  get_component_properties: { lock: "read", handler: (params) => getComponentProperties(params) },
  add_component_property: { lock: "node", handler: (params) => addComponentProperty(params) },
  edit_component_property: { lock: "node", handler: (params) => editComponentProperty(params) },
  delete_component_property: { lock: "node", handler: (params) => deleteComponentProperty(params) },
  set_exposed_instance: { lock: "node", handler: (params) => setExposedInstance(params) },
  component_properties: { lock: "global", handler: (params) => componentProperties(params) },
};
