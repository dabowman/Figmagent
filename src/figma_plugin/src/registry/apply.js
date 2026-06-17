// Command registry — apply domain.

import { apply } from "../commands/apply.js";

export const COMMANDS = {
  apply: { lock: "global", handler: (params) => apply(params) },
};
