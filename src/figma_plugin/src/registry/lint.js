// Command registry — lint domain.
// lint_design is read-only by default; routeCommand in main.js upgrades it to
// the global lock when params.autoFix is set.

import { lintDesign } from "../commands/lint.js";

export const COMMANDS = {
  lint_design: { lock: "read", handler: (params) => lintDesign(params) },
};
