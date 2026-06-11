#!/usr/bin/env bun
/**
 * Parity harness — runs a read-command suite against the same Figma file on
 * both transports and diffs normalized outputs. Phase 1 acceptance gate;
 * extends to writes in Phase 2.
 *
 * Usage:
 *   bun scripts/parity-check.ts --file <figmaUrlOrFileKey> [--channel <relayChannel>] \
 *     [--node <nodeId>] [--only <command,command>] [--transport remote|plugin|both]
 *     [--battery]
 *
 * --battery runs the Phase 2.4 representative build instead of the read
 * suite: 8-variant component set → combine_as_variants → component
 * properties → variable bindings → lint. Reports node counts, lint issue
 * counts, call counts, and wall time per transport, then cleans up.
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

// ─── Representative-build battery (Phase 2.4) ───────────────────────────────
// 8-variant component set: create ×8 → combine_as_variants →
// component_properties → create_variables → apply bindings → lint_design.

interface BatteryMetrics {
  transport: string;
  calls: number;
  errors: number;
  wallMs: number;
  nodesCreated: number;
  lintIssues: number | null;
}

async function runBattery(
  label: string,
  send: (cmd: FigmaCommand, params: unknown) => Promise<unknown>,
): Promise<BatteryMetrics> {
  const metrics: BatteryMetrics = { transport: label, calls: 0, errors: 0, wallMs: 0, nodesCreated: 0, lintIssues: null };
  const started = performance.now();
  const stamp = `${label}-${Date.now().toString(36)}`;
  const call = async (cmd: FigmaCommand, params: unknown): Promise<any> => {
    metrics.calls++;
    try {
      return await send(cmd, params);
    } catch (err) {
      metrics.errors++;
      console.error(`  [${label}] ${cmd} failed: ${err}`);
      throw err;
    }
  };

  const createdRoots: string[] = [];
  try {
    // 1. Eight variant components (two axes: Size × State)
    const sizes = ["SM", "MD", "LG", "XL"];
    const states = ["Default", "Hover"];
    for (const size of sizes) {
      for (const state of states) {
        const result = await call("create", {
          tree: {
            type: "COMPONENT",
            name: `Size=${size}, State=${state}`,
            layoutMode: "HORIZONTAL",
            layoutSizingVertical: "HUG",
            paddingLeft: 16,
            paddingRight: 16,
            paddingTop: 8,
            paddingBottom: 8,
            itemSpacing: 8,
            fillColor: state === "Hover" ? { r: 0.9, g: 0.92, b: 1 } : { r: 0.96, g: 0.96, b: 0.98 },
            children: [{ type: "TEXT", text: `Button ${size}`, fontSize: 14, fontWeight: 600 }],
          },
        });
        createdRoots.push(result.tree.id);
        metrics.nodesCreated += result.totalNodesCreated;
      }
    }

    // 2. Combine into a variant set
    const combined = await call("combine_as_variants", { componentIds: createdRoots });
    const setId = combined.id || (combined.componentSet && combined.componentSet.id) || combined.nodeId;

    // 3. A text component property
    await call("component_properties", {
      nodeId: setId,
      operations: [{ op: "add", name: "Label", type: "TEXT", defaultValue: "Button" }],
    });

    // 4. Seed a color variable and bind it on one variant's fill
    const vars = await call("create_variables", {
      collectionName: `battery-${stamp}`,
      modes: ["Default"],
      variables: [
        {
          name: "color/bg/battery",
          type: "COLOR",
          scopes: ["ALL_FILLS"],
          values: { Default: { r: 0.96, g: 0.96, b: 0.98, a: 1 } },
        },
      ],
    });
    const varId = vars.results && vars.results[0] && vars.results[0].success ? vars.results[0].id : undefined;
    if (varId) {
      await call("apply", { nodes: [{ nodeId: createdRoots[0], variables: { fill: varId } }] });
    } else {
      console.error(`  [${label}] could not resolve created variable id from ${JSON.stringify(vars).slice(0, 200)}`);
      metrics.errors++;
    }

    // 5. Lint the set
    const lint = await call("lint_design", { nodeId: setId, maxIssues: 100 });
    metrics.lintIssues = Array.isArray(lint.issues) ? lint.issues.length : (lint.issueCount ?? null);

    // Cleanup: remove the component set (variables are left in the scratch file)
    await call("delete_multiple_nodes", { nodeIds: [setId] });
  } catch {
    // metrics.errors already counted; clean up whatever was created
    if (createdRoots.length > 0) {
      try {
        await send("delete_multiple_nodes", { nodeIds: createdRoots });
      } catch {
        // best effort
      }
    }
  }

  metrics.wallMs = Math.round(performance.now() - started);
  return metrics;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const wantPlugin = transportArg === "both" || transportArg === "plugin";
  const wantRemote = transportArg === "both" || transportArg === "remote";

  const pluginSend = wantPlugin ? await setupPlugin() : null;
  const remoteSend = wantRemote ? setupRemote() : null;

  if (process.argv.includes("--battery")) {
    const results: BatteryMetrics[] = [];
    if (pluginSend) results.push(await runBattery("plugin", pluginSend));
    if (remoteSend) results.push(await runBattery("remote", remoteSend));
    console.error("\nBattery results:");
    console.error(JSON.stringify(results, null, 2));
    const anyErrors = results.some((r) => r.errors > 0);
    process.exit(anyErrors ? 1 : 0);
  }

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
