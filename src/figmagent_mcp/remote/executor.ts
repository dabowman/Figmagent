/**
 * Remote executor — assembles use_figma scripts (domain bundle + handler call
 * + JSON params) and runs them through a per-file FIFO queue.
 *
 * The official server serializes execution per file (validated: parallel
 * calls run sequentially in-VM), so client-side parallelism buys nothing —
 * one in-flight call per fileKey, queued FIFO.
 */

import { logger } from "../utils.js";
import { getDomainBundle } from "./bundles.js";
import { getRemoteClient } from "./client.js";
import { COMMAND_DOMAINS } from "./domains.js";

/** use_figma rejects scripts over ~50KB; leave headroom for the wrapper. */
const SCRIPT_CHAR_BUDGET = 49000;

// ─── Per-file FIFO queue ─────────────────────────────────────────────────────

const fileQueues = new Map<string, { tail: Promise<unknown>; depth: number }>();

function enqueue<T>(fileKey: string, task: () => Promise<T>): Promise<T> {
  let queue = fileQueues.get(fileKey);
  if (!queue) {
    queue = { tail: Promise.resolve(), depth: 0 };
    fileQueues.set(fileKey, queue);
  }
  queue.depth++;
  if (queue.depth > 1) {
    logger.info(`Remote queue depth for ${fileKey}: ${queue.depth}`);
  }
  const run = queue.tail.then(task, task);
  // The queue tail must never reject, or every later task would skip the line.
  queue.tail = run.then(
    () => undefined,
    () => undefined,
  );
  const finalize = () => {
    queue.depth--;
    if (queue.depth === 0) fileQueues.delete(fileKey);
  };
  run.then(finalize, finalize);
  return run;
}

// ─── Script assembly ─────────────────────────────────────────────────────────

/** Name the param that dominates an oversized payload — guides chunking. */
function dominantParam(params: unknown): string {
  if (!params || typeof params !== "object") return "params";
  let worstKey = "params";
  let worstLen = 0;
  for (const [key, value] of Object.entries(params as Record<string, unknown>)) {
    let len: number;
    try {
      len = JSON.stringify(value)?.length ?? 0;
    } catch {
      len = 0;
    }
    if (len > worstLen) {
      worstLen = len;
      worstKey = key;
    }
  }
  return `${worstKey} (${worstLen} chars)`;
}

export async function assembleScript(command: string, params: unknown): Promise<string> {
  const domain = COMMAND_DOMAINS[command];
  if (!domain) {
    throw new Error(`No remote domain registered for command "${command}"`);
  }
  const bundle = await getDomainBundle(domain);
  const paramsJson = JSON.stringify(params ?? {});
  const code = [
    bundle,
    `const __params = ${paramsJson};`,
    `const __r = await globalThis.__figmagent[${JSON.stringify(command)}](__params);`,
    `return JSON.stringify(__r === undefined ? null : __r);`,
  ].join("\n");

  if (code.length > SCRIPT_CHAR_BUDGET) {
    throw new Error(
      `Assembled script for "${command}" is ${code.length} chars — over the ${SCRIPT_CHAR_BUDGET} ` +
        `char use_figma limit. Largest param: ${dominantParam(params)}. ` +
        "Split the call into smaller batches (chunked creates land in Phase 2.3).",
    );
  }
  return code;
}

// ─── Execution ───────────────────────────────────────────────────────────────

function isTimeoutError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /timed?\s*out|timeout/i.test(msg);
}

export interface ExecuteOptions {
  fileKey: string;
  command: string;
  params: unknown;
  timeoutMs?: number;
  /** Append the atomic-retry note to errors (write commands). */
  atomicWrite?: boolean;
}

export async function executeRemoteCommand(options: ExecuteOptions): Promise<unknown> {
  const { fileKey, command, params, timeoutMs = 120000, atomicWrite = false } = options;

  let code: string;
  try {
    code = await assembleScript(command, params);
  } catch (err) {
    // Oversized create payloads chunk at depth-1 children instead of failing.
    if (command === "create" && err instanceof Error && err.message.includes("use_figma limit")) {
      return executeChunkedCreate(options, err);
    }
    throw err;
  }

  return enqueue(fileKey, () => runOne(fileKey, command, code, timeoutMs, atomicWrite));
}

async function runOne(
  fileKey: string,
  command: string,
  code: string,
  timeoutMs: number,
  atomicWrite: boolean,
  description?: string,
): Promise<unknown> {
  const client = getRemoteClient();
  const start = performance.now();
  try {
    const result = await client.runScript(
      { fileKey, code, description: description || `figmagent:${command}` },
      timeoutMs,
    );
    logger.info(`Remote ${command} completed in ${Math.round(performance.now() - start)}ms`);
    return result;
  } catch (err) {
    if (isTimeoutError(err)) {
      // Match the plugin transport's timeout shape
      throw new Error("Request to Figma timed out");
    }
    const message = err instanceof Error ? err.message : String(err);
    // A thrown script error means the whole script rolled back (verified).
    throw new Error(atomicWrite ? `${message} (atomic: no changes were applied; safe to retry)` : message);
  }
}

// ─── Raw scripts (run_script tool) ───────────────────────────────────────────

export interface RawScriptOptions {
  fileKey: string;
  /** Fully assembled script (stdlib bundle + user code + wrapper). */
  code: string;
  /** Human-readable description, surfaced to the official server. */
  description: string;
  timeoutMs?: number;
  /** Append the atomic-retry note to errors (mode: "write" scripts). */
  atomicWrite?: boolean;
}

/**
 * Run a pre-assembled script through the same per-file FIFO queue and
 * timeout/error mapping as regular commands. Used by the run_script tool —
 * assembly (stdlib + deny-list scan + write wrapper) happens in tools/script.ts.
 */
export async function executeRawScript(options: RawScriptOptions): Promise<unknown> {
  const { fileKey, code, description, timeoutMs = 120000, atomicWrite = false } = options;
  if (code.length > SCRIPT_CHAR_BUDGET) {
    throw new Error(
      `run_script payload is ${code.length} chars — over the ${SCRIPT_CHAR_BUDGET} char use_figma limit ` +
        "(stdlib bundle + your code combined). Split the script into smaller sequential run_script calls.",
    );
  }
  return enqueue(fileKey, () => runOne(fileKey, "run_script", code, timeoutMs, atomicWrite, description));
}

// ─── Chunked create (>50KB payloads) ─────────────────────────────────────────
// Params dominate script size (bundles are ≤16KB). Split the tree at depth-1:
// chunk 1 creates the root plus as many leading children as fit; each
// remaining child is created in its own sequential script with parentId =
// the root ID. All chunks run inside ONE queue slot so no other command
// interleaves mid-create. Rollback is per-chunk, not whole-call — the
// response says so, and a mid-chunk failure names the root to clean up.

interface CreateTreeResult {
  success: boolean;
  totalNodesCreated: number;
  tree: { id: string; name: string; type: string; children?: unknown[] };
}

async function executeChunkedCreate(options: ExecuteOptions, oversizeError: Error): Promise<unknown> {
  const { fileKey, command, timeoutMs = 120000 } = options;
  const params = options.params as { parentId?: string; tree?: { children?: unknown[] } };
  const tree = params?.tree;
  const children = tree && Array.isArray(tree.children) ? tree.children : null;

  if (!children || children.length < 2) {
    // Nothing to split at depth-1 — surface the original guard error.
    throw oversizeError;
  }

  // Budget for the params JSON in each script: total budget minus the create
  // bundle and the fixed wrapper lines (~200 chars).
  const bundleSize = (await getDomainBundle(COMMAND_DOMAINS[command])).length;
  const paramsBudget = SCRIPT_CHAR_BUDGET - bundleSize - 500;

  const rootShell = { ...tree, children: [] as unknown[] };
  const shellSize = JSON.stringify({ parentId: params.parentId, tree: rootShell }).length;

  // Greedily pack leading children into chunk 1 alongside the root.
  const childSizes = children.map((c) => JSON.stringify(c).length);
  let firstSliceEnd = 0;
  let used = shellSize;
  while (firstSliceEnd < children.length && used + childSizes[firstSliceEnd] < paramsBudget) {
    used += childSizes[firstSliceEnd];
    firstSliceEnd++;
  }

  // Each remaining child must fit a script on its own.
  for (let i = Math.max(firstSliceEnd, 1); i < children.length; i++) {
    if (childSizes[i] > paramsBudget - 200) {
      throw new Error(
        `create payload cannot be chunked: child ${i} ("${(children[i] as any)?.name ?? "unnamed"}") is ` +
          `${childSizes[i]} chars by itself — over the per-script budget. Split that subtree into ` +
          "multiple create calls manually.",
      );
    }
  }

  const chunkTrees: { parentRelative: boolean; tree: unknown }[] = [
    { parentRelative: false, tree: { ...tree, children: children.slice(0, Math.max(firstSliceEnd, 1)) } },
  ];
  for (let i = Math.max(firstSliceEnd, 1); i < children.length; i++) {
    chunkTrees.push({ parentRelative: true, tree: children[i] });
  }

  return enqueue(fileKey, async () => {
    let rootResult: CreateTreeResult | null = null;
    let completed = 0;
    try {
      for (const chunk of chunkTrees) {
        const chunkParams = chunk.parentRelative
          ? { parentId: rootResult!.tree.id, tree: chunk.tree }
          : { parentId: params.parentId, tree: chunk.tree };
        const code = await assembleScript(command, chunkParams);
        const result = (await runOne(fileKey, command, code, timeoutMs, true)) as CreateTreeResult;
        if (!chunk.parentRelative) {
          rootResult = result;
          if (!rootResult.tree.children) rootResult.tree.children = [];
        } else {
          rootResult!.totalNodesCreated += result.totalNodesCreated;
          rootResult!.tree.children!.push(result.tree);
        }
        completed++;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (rootResult) {
        throw new Error(
          `${message} — chunked create failed after ${completed}/${chunkTrees.length} chunks; ` +
            `root ${rootResult.tree.id} holds a partial tree (rollback is per-chunk). ` +
            `Delete ${rootResult.tree.id} to clean up, then retry.`,
        );
      }
      throw err;
    }
    return {
      ...rootResult!,
      chunked: true,
      chunks: chunkTrees.length,
      note: "Payload exceeded the 50KB script limit and was created in sequential chunks. Rollback is per-chunk, not whole-call.",
    };
  });
}

/** Test cleanup. */
export function resetQueuesForTests(): void {
  fileQueues.clear();
}

export { enqueue as enqueuePerFile };
