#!/usr/bin/env bun
/**
 * Parity harness — runs a read-command suite against the same Figma file on
 * both transports and diffs normalized outputs. Phase 1 acceptance gate;
 * extends to writes in Phase 2.
 *
 * Usage:
 *   bun scripts/parity-check.ts --file <figmaUrlOrFileKey> [--channel <relayChannel>] \
 *     [--node <nodeId>] [--only <command,command>] [--transport remote|plugin|both]
 *
 * Plugin side requires the relay (bun socket) + the Figma plugin connected.
 * Remote side requires OAuth (first run prints the authorization URL).
 * Per-command latency is printed for the Phase 6 A/B record.
 */

import { connectToFigma, joinChannel, pluginSendCommand } from "../src/figmagent_mcp/connection.js";
import { RemoteTransport } from "../src/figmagent_mcp/remote/transport.js";
import { setFileKey } from "../src/figmagent_mcp/remote/filecontext.js";
import type { FigmaCommand } from "../src/figmagent_mcp/types.js";

// ─── CLI args ────────────────────────────────────────────────────────────────

function argValue(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

const fileArg = argValue("--file");
const channelArg = argValue("--channel");
const nodeArg = argValue("--node");
const onlyArg = argValue("--only");
const transportArg = argValue("--transport") || "both";

if (!fileArg && transportArg !== "plugin") {
  console.error("Usage: bun scripts/parity-check.ts --file <figmaUrlOrFileKey> [--channel <name>] [--node <id>]");
  process.exit(1);
}

// ─── Normalization ───────────────────────────────────────────────────────────

/** Fields that legitimately differ between transports/runs. */
const VOLATILE_KEYS = new Set(["timestamp", "durationMs", "commandId", "nodesSearched", "note", "imageData"]);

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      if (VOLATILE_KEYS.has(key)) continue;
      out[key] = normalize((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

function diffSummary(a: unknown, b: unknown, path = "$"): string[] {
  if (JSON.stringify(a) === JSON.stringify(b)) return [];
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") {
    return [`${path}: ${JSON.stringify(a)?.slice(0, 80)} ≠ ${JSON.stringify(b)?.slice(0, 80)}`];
  }
  const diffs: string[] = [];
  const keys = new Set([...Object.keys(a as object), ...Object.keys(b as object)]);
  for (const key of keys) {
    diffs.push(...diffSummary((a as any)[key], (b as any)[key], `${path}.${key}`));
    if (diffs.length > 10) {
      diffs.push("… (truncated)");
      break;
    }
  }
  return diffs;
}

// ─── Suite ───────────────────────────────────────────────────────────────────

interface SuiteEntry {
  command: FigmaCommand;
  params: Record<string, unknown>;
  /** Needs a target nodeId discovered from the document. */
  needsNode?: boolean;
}

function buildSuite(nodeId: string | undefined): SuiteEntry[] {
  const suite: SuiteEntry[] = [
    { command: "get_document_info", params: {} },
    { command: "get_selection", params: {} },
    { command: "get_styles", params: {} },
    { command: "get_local_variables", params: {} },
    { command: "get_local_components", params: {} },
    { command: "get_design_system", params: {} },
    { command: "find", params: { type: ["FRAME", "COMPONENT", "TEXT"], maxResults: 50 } },
  ];
  if (nodeId) {
    suite.push(
      { command: "get_node_tree", params: { nodeId, detail: "full" } },
      { command: "get_annotations", params: { nodeId } },
      { command: "scan_text_nodes", params: { nodeId, useChunking: false } },
      { command: "scan_nodes_by_types", params: { nodeId, types: ["TEXT", "FRAME"] } },
      { command: "lint_design", params: { nodeId, maxIssues: 50 } },
      { command: "export_node_as_image", params: { nodeId, format: "PNG", scale: 1 } },
    );
  }
  return suite;
}

// ─── Runners ─────────────────────────────────────────────────────────────────

type RunResult = { ok: true; ms: number; value: unknown } | { ok: false; ms: number; error: string };

async function runOn(
  send: (cmd: FigmaCommand, params: unknown) => Promise<unknown>,
  entry: SuiteEntry,
): Promise<RunResult> {
  const start = performance.now();
  try {
    const value = await send(entry.command, entry.params);
    return { ok: true, ms: Math.round(performance.now() - start), value };
  } catch (err) {
    return { ok: false, ms: Math.round(performance.now() - start), error: String(err) };
  }
}

async function setupPlugin(): Promise<(cmd: FigmaCommand, params: unknown) => Promise<unknown>> {
  connectToFigma();
  // Wait for the websocket to open
  await new Promise((r) => setTimeout(r, 1500));
  if (channelArg) await joinChannel(channelArg);
  return (cmd, params) => pluginSendCommand(cmd, params, 60000);
}

function setupRemote(): (cmd: FigmaCommand, params: unknown) => Promise<unknown> {
  setFileKey(fileArg!);
  const transport = new RemoteTransport();
  return (cmd, params) => transport.sendCommand(cmd, params, 120000);
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const wantPlugin = transportArg === "both" || transportArg === "plugin";
  const wantRemote = transportArg === "both" || transportArg === "remote";

  const pluginSend = wantPlugin ? await setupPlugin() : null;
  const remoteSend = wantRemote ? setupRemote() : null;

  // Discover a target node when none was given: first top-level child of page 1
  let nodeId = nodeArg;
  const discoverer = remoteSend || pluginSend;
  if (!nodeId && discoverer) {
    try {
      const doc = (await discoverer("get_document_info", {})) as any;
      const pages = doc?.pages || [];
      const firstFrame = pages[0]?.topLevelFrames?.[0] || pages[0]?.children?.[0];
      nodeId = firstFrame?.id;
      if (nodeId) console.error(`Discovered target node: ${nodeId} (${firstFrame.name})`);
    } catch (err) {
      console.error(`Node discovery failed (${err}) — running document-level suite only`);
    }
  }

  let suite = buildSuite(nodeId);
  if (onlyArg) {
    const only = new Set(onlyArg.split(","));
    suite = suite.filter((s) => only.has(s.command));
  }

  let failures = 0;
  const latencies: Record<string, { plugin?: number; remote?: number }> = {};

  for (const entry of suite) {
    const label = entry.command.padEnd(26);
    const plugin = pluginSend ? await runOn(pluginSend, entry) : null;
    const remote = remoteSend ? await runOn(remoteSend, entry) : null;
    latencies[entry.command] = {
      plugin: plugin?.ms,
      remote: remote?.ms,
    };

    if (plugin && remote) {
      if (!plugin.ok || !remote.ok) {
        failures++;
        console.error(`✗ ${label} plugin=${plugin.ok ? "ok" : plugin.error} remote=${remote.ok ? "ok" : remote.error}`);
        continue;
      }
      const diffs = diffSummary(normalize(plugin.value), normalize(remote.value));
      if (diffs.length > 0) {
        failures++;
        console.error(`✗ ${label} outputs differ:`);
        for (const d of diffs) console.error(`    ${d}`);
      } else {
        console.error(`✓ ${label} parity (plugin ${plugin.ms}ms, remote ${remote.ms}ms)`);
      }
    } else {
      const single = plugin || remote;
      if (!single) continue;
      if (single.ok) {
        console.error(`✓ ${label} ${single.ms}ms`);
      } else {
        failures++;
        console.error(`✗ ${label} ${single.error}`);
      }
    }
  }

  console.error("\nLatency record (ms):");
  console.error(JSON.stringify(latencies, null, 2));
  console.error(failures === 0 ? "\nPARITY: all commands green" : `\nPARITY: ${failures} command(s) failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
