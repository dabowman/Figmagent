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
  const code = await assembleScript(command, params);
  const client = getRemoteClient();

  return enqueue(fileKey, async () => {
    const start = performance.now();
    try {
      const result = await client.runScript({ fileKey, code, description: `figmagent:${command}` }, timeoutMs);
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
  });
}

/** Test cleanup. */
export function resetQueuesForTests(): void {
  fileQueues.clear();
}

export { enqueue as enqueuePerFile };
