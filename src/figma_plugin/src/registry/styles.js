// Command registry — styles & variables domain.

import {
  getStyles,
  getLocalVariables,
  getLocalComponents,
  getDesignSystem,
  createVariables,
  updateVariables,
  createStyles,
  updateStyles,
} from "../commands/styles.js";

export const COMMANDS = {
  get_styles: { lock: "read", handler: () => getStyles() },
  get_local_variables: { lock: "read", handler: (params) => getLocalVariables(params) },
  get_local_components: { lock: "read", handler: () => getLocalComponents() },
  get_design_system: { lock: "read", handler: (params) => getDesignSystem(params) },
  create_variables: { lock: "global", handler: (params) => createVariables(params) },
  update_variables: { lock: "global", handler: (params) => updateVariables(params) },
  create_styles: { lock: "global", handler: (params) => createStyles(params) },
  update_styles: { lock: "global", handler: (params) => updateStyles(params) },
};
