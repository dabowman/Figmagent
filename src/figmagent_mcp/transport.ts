/**
 * Transport abstraction — selects between the plugin path (WebSocket relay +
 * Figma plugin) and the remote path (Figma's official MCP at mcp.figma.com).
 *
 * Selection happens once at startup via the FIGMA_TRANSPORT env var:
 *   - "auto" (default): plugin when the local relay is reachable, otherwise
 *     remote when a cached OAuth token exists, otherwise plugin. The Phase 6
 *     A/B showed identical correctness and call counts on both transports but
 *     ~1s/call remote vs ~15ms/call plugin — so a running relay always wins,
 *     and remote is the no-relay/headless fallback.
 *   - "plugin": local relay + plugin, always
 *   - "remote": official MCP via use_figma script execution, always
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

/** Quick reachability probe of the relay's /channels endpoint. */
export async function probeRelay(port: number = 3055, timeoutMs: number = 750): Promise<boolean> {
  try {
    const res = await fetch(`http://localhost:${port}/channels`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Resolve the transport name from the environment. Exported for tests.
 *
 * `relayReachable` feeds the auto mode: when known (server startup probes the
 * relay via initTransport), a reachable relay selects the plugin transport.
 * When unknown (sync callers that never probed), auto falls back to the
 * token-based choice: remote if authed, plugin otherwise.
 */
export function resolveTransportName(
  env: Record<string, string | undefined> = process.env,
  relayReachable?: boolean,
): "plugin" | "remote" {
  const raw = (env.FIGMA_TRANSPORT || "auto").toLowerCase();
  if (raw === "remote") return "remote";
  if (raw === "auto" || raw === "") {
    if (relayReachable === true) return "plugin";
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

function activate(name: "plugin" | "remote", reason: string): FigmaTransport {
  activeTransport = name === "remote" ? new RemoteTransport() : pluginTransport;
  logger.info(`Figma transport: ${name} (${reason})`);
  return activeTransport;
}

/**
 * Async transport selection — call once at server startup. In auto mode this
 * probes the relay so a running relay+plugin wins over remote.
 */
export async function initTransport(env: Record<string, string | undefined> = process.env): Promise<FigmaTransport> {
  if (activeTransport) return activeTransport;
  const raw = (env.FIGMA_TRANSPORT || "auto").toLowerCase();
  if (raw === "auto" || raw === "") {
    const relayUp = await probeRelay();
    const name = resolveTransportName(env, relayUp);
    return activate(
      name,
      relayUp ? "auto: relay reachable" : `auto: relay down, token ${name === "remote" ? "found" : "absent"}`,
    );
  }
  return activate(resolveTransportName(env), `FIGMA_TRANSPORT=${raw}`);
}

export function getTransport(): FigmaTransport {
  if (!activeTransport) {
    // Lazy sync path (scripts/tests that skip initTransport) — no relay probe.
    return activate(resolveTransportName(), "lazy resolution, no relay probe");
  }
  return activeTransport;
}

/** Reset the cached transport (test cleanup only). */
export function resetTransportForTests(): void {
  activeTransport = null;
}
