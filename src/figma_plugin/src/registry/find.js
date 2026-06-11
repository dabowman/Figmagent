// Command registry — find (unified search) domain.

import { find } from "../commands/find.js";

export const COMMANDS = {
  find: { lock: "read", handler: (params) => find(params) },
};
