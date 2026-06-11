/**
 * Transport abstraction — selects between the plugin path (WebSocket relay +
 * Figma plugin) and the remote path (Figma's official MCP at mcp.figma.com).
 *
 * Selection happens once at startup via the FIGMA_TRANSPORT env var:
 *   - "plugin" (default): local relay + plugin
 *   - "remote": official MCP via use_figma script execution
 *   - "auto": remote if a cached OAuth token exists, plugin otherwise
 */

import { existsSync } from "node:fs";
import { logger } from "./utils.js";
import type { FigmaCommand } from "./types.js";
import { pluginSendCommand } from "./connection.js";
import { AUTH_FILE } from "./remote/auth.js";
import { RemoteTransport } from "./remote/transport.js";

export interface FigmaTransport {
  name: "plugin" | "remote";
  sendCommand(command: FigmaCommand, params?: unknown, timeoutMs?: number): Promise<unknown>;
}

export type TransportMode = "plugin" | "remote" | "auto";

/** Resolve the transport name from the environment. Exported for tests. */
export function resolveTransportName(env: Record<string, string | undefined> = process.env): "plugin" | "remote" {
  const raw = (env.FIGMA_TRANSPORT || "plugin").toLowerCase();
  if (raw === "remote") return "remote";
  if (raw === "auto") {
    return existsSync(AUTH_FILE) ? "remote" : "plugin";
  }
  if (raw !== "plugin") {
    logger.warn(`Unknown FIGMA_TRANSPORT="${env.FIGMA_TRANSPORT}" — defaulting to plugin transport`);
  }
  return "plugin";
}

const pluginTransport: FigmaTransport = {
  name: "plugin",
  sendCommand(command: FigmaCommand, params: unknown = {}, timeoutMs: number = 30000): Promise<unknown> {
    return pluginSendCommand(command, params, timeoutMs);
  },
};

let activeTransport: FigmaTransport | null = null;

export function getTransport(): FigmaTransport {
  if (!activeTransport) {
    const name = resolveTransportName();
    activeTransport = name === "remote" ? new RemoteTransport() : pluginTransport;
    logger.info(`Figma transport: ${name}`);
  }
  return activeTransport;
}

/** Reset the cached transport (test cleanup only). */
export function resetTransportForTests(): void {
  activeTransport = null;
}
