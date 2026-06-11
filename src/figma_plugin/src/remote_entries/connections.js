// Remote entry shim — connections domain.
// Bundled per-domain by the remote transport (Bun.build, IIFE) and prepended
// to use_figma scripts. Exposes every command handler on globalThis.__figmagent
// keyed by wire command name, with figma.mixed symbols sanitized (the plugin
// path does this in routeCommand; remotely it happens here).

import { COMMANDS } from "../registry/connections.js";
import { sanitizeSymbols } from "../helpers.js";

if (!globalThis.__figmagent) {
  globalThis.__figmagent = {};
}
const target = globalThis.__figmagent;
for (const name of Object.keys(COMMANDS)) {
  const handler = COMMANDS[name].handler;
  target[name] = (params) => Promise.resolve(handler(params)).then(sanitizeSymbols);
}
