// Command registry — create domain.

import { create } from "../commands/create.js";

export const COMMANDS = {
  create: { lock: "global", handler: (params) => create(params) },
};
