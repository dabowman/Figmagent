#!/usr/bin/env bun
/**
 * Pipeline run record — one JSON line per event in
 * .claude/analysis/pipeline-runs.jsonl (committed; created on first use).
 *
 * Usage:
 *   bun scripts/pipeline-record.ts event --run <RUN_ID> --stage <stage> [key=value ...]
 *       appends {run, stage, ts, ...kv}; numeric-looking values become numbers
 *   bun scripts/pipeline-record.ts status [--runs N]
 *       one row per run for the last N runs (default 7): sessions
 *       extracted/analyzed/failed, entries created/closed/drift, plans written,
 *       PRs opened/aborted/deferred, merged/reviewed/human-only, release tag,
 *       guard denials, paused
 *   bun scripts/pipeline-record.ts resume
 *       deletes .pipeline.paused (the circuit breaker) and records the resume
 *
 * Paths resolve from the repo root (this script's parent directory); set
 * PIPELINE_ROOT to relocate them (tests do).
 */

import { appendFile, mkdir, readFile, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { formatStatus, parseEvents, parseKv, summarizeRuns } from "./pipeline-record-lib.ts";

const ROOT = process.env.PIPELINE_ROOT || resolve(import.meta.dir, "..");
const RUNS_FILE = join(ROOT, ".claude/analysis/pipeline-runs.jsonl");
const PAUSED_FILE = join(ROOT, ".pipeline.paused");

const argv = process.argv.slice(2);
const cmd = argv[0];

function flag(name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

async function append(event: Record<string, unknown>): Promise<void> {
  await mkdir(dirname(RUNS_FILE), { recursive: true });
  await appendFile(RUNS_FILE, `${JSON.stringify(event)}\n`);
}

function usage(): never {
  console.error("usage: pipeline-record.ts event --run <id> --stage <stage> [k=v ...] | status [--runs N] | resume");
  process.exit(2);
}

if (cmd === "event") {
  const run = flag("--run");
  const stage = flag("--stage");
  if (!run || !stage) usage();
  // Everything after the flags that looks like k=v is a counter; the flag
  // values themselves never contain "=" so they cannot be mistaken for one.
  const kv = parseKv(argv.slice(1).filter((a) => a.includes("=") && a !== run && a !== stage));
  await append(Object.assign({ run, stage, ts: new Date().toISOString() }, kv));
} else if (cmd === "status") {
  const runs = Number(flag("--runs") || 7);
  let text = "";
  try {
    text = await readFile(RUNS_FILE, "utf-8");
  } catch {
    // no record yet
  }
  console.log(formatStatus(summarizeRuns(parseEvents(text)), Number.isFinite(runs) && runs > 0 ? runs : 7));
} else if (cmd === "resume") {
  let previous = "";
  try {
    previous = await readFile(PAUSED_FILE, "utf-8");
  } catch {
    console.log("pipeline is not paused (no .pipeline.paused)");
    process.exit(0);
  }
  let reason = previous.trim();
  try {
    const parsed = JSON.parse(previous);
    if (parsed && typeof parsed.reason === "string") reason = parsed.reason;
  } catch {
    // free-form reason
  }
  await unlink(PAUSED_FILE);
  await append({
    run: process.env.AUTO_IMPROVE_RUN_ID || "manual",
    stage: "resume",
    ts: new Date().toISOString(),
    paused: 0,
    reason,
  });
  console.log(`pipeline resumed (was paused: ${reason})`);
} else {
  usage();
}
