// Command registry — connections & navigation domain.

import { setDefaultConnector, createConnections, setFocus, setSelections } from "../commands/connections.js";

export const COMMANDS = {
  set_default_connector: { lock: "node", handler: (params) => setDefaultConnector(params) },
  create_connections: { lock: "global", handler: (params) => createConnections(params) },
  set_focus: { lock: "read", handler: (params) => setFocus(params) },
  set_selections: { lock: "read", handler: (params) => setSelections(params) },
};
