/**
 * Remote transport — implements FigmaTransport over Figma's official MCP.
 * Commands compile to use_figma scripts via the executor; no relay, no
 * plugin, no open Figma client.
 */

import type { FigmaCommand } from "../types.js";
import { executeRemoteCommand } from "./executor.js";
import { isWriteCommand, COMMAND_DOMAINS } from "./domains.js";
import { resolveFileKey } from "./filecontext.js";

export class RemoteTransport {
  readonly name = "remote" as const;

  async sendCommand(command: FigmaCommand, params: unknown = {}, timeoutMs: number = 30000): Promise<unknown> {
    if (command === "join") {
      // Channels don't exist remotely; file selection goes through
      // join_channel (tools/scan.ts), which stores a fileKey instead.
      throw new Error(
        "Channels are a plugin-transport concept. On the remote transport, pass a Figma file URL " +
          "to join_channel (e.g. https://www.figma.com/design/<fileKey>/...) or set FIGMA_FILE_KEY.",
      );
    }

    if (!COMMAND_DOMAINS[command]) {
      throw new Error(`Command "${command}" is not available on the remote transport.`);
    }

    // Viewport/selection manipulation has no effect in a headless session.
    if (command === "set_focus" || command === "set_selections") {
      return {
        success: true,
        note: `${command} is a no-op on the remote transport (headless — no viewport or live selection).`,
      };
    }

    const fileKey = resolveFileKey();
    // Remote calls carry ~4-7s round-trip overhead on top of in-VM time;
    // give them at least 120s regardless of the plugin-path default.
    const effectiveTimeout = Math.max(timeoutMs, 120000);

    const result = await executeRemoteCommand({
      fileKey,
      command,
      params,
      timeoutMs: effectiveTimeout,
      atomicWrite: isWriteCommand(command, params),
    });

    // Headless sessions have no user selection — say so instead of returning
    // a bare empty list the agent might misread as "nothing in the file".
    if (command === "get_selection" && result && typeof result === "object") {
      const sel = result as { selectionCount?: number; note?: string };
      if (sel.selectionCount === 0) {
        sel.note =
          "Remote transport is headless: there is no live user selection. Use find() or get() to locate nodes.";
      }
    }

    return result;
  }
}
