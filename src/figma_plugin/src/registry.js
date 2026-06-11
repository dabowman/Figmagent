// Single source of truth for the command surface.
// Aggregates per-domain registries (src/registry/<domain>.js) into one map:
//   COMMANDS[name] = { domain, lock: "read" | "global" | "node", handler(params) }
// main.js dispatches from this map; the remote transport bundles one domain
// at a time via src/remote_entries/<domain>.js (which import the same
// per-domain registries — never this aggregator, to keep bundles small).

import { COMMANDS as DOCUMENT } from "./registry/document.js";
import { COMMANDS as CREATE } from "./registry/create.js";
import { COMMANDS as APPLY } from "./registry/apply.js";
import { COMMANDS as MODIFY } from "./registry/modify.js";
import { COMMANDS as TEXT } from "./registry/text.js";
import { COMMANDS as COMPONENTS } from "./registry/components.js";
import { COMMANDS as SCAN } from "./registry/scan.js";
import { COMMANDS as FIND } from "./registry/find.js";
import { COMMANDS as STYLES } from "./registry/styles.js";
import { COMMANDS as LINT } from "./registry/lint.js";
import { COMMANDS as CONNECTIONS } from "./registry/connections.js";

export const DOMAINS = {
  document: DOCUMENT,
  create: CREATE,
  apply: APPLY,
  modify: MODIFY,
  text: TEXT,
  components: COMPONENTS,
  scan: SCAN,
  find: FIND,
  styles: STYLES,
  lint: LINT,
  connections: CONNECTIONS,
};

export const COMMANDS = {};
for (const domain of Object.keys(DOMAINS)) {
  const cmds = DOMAINS[domain];
  for (const name of Object.keys(cmds)) {
    COMMANDS[name] = Object.assign({ domain: domain }, cmds[name]);
  }
}
