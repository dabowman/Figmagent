/**
 * Per-domain bundle cache for the remote transport.
 *
 * Bundles src/figma_plugin/src/remote_entries/<domain>.js into a minified
 * IIFE at runtime via Bun.build (in-memory — no outdir, no build step).
 * Cached per domain; invalidated when any plugin source file's mtime changes
 * (dev convenience — production sessions pay one build per domain).
 */

import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN_SRC = fileURLToPath(new URL("../../figma_plugin/src/", import.meta.url));

const cache = new Map<string, { mtimeKey: number; code: string }>();

/** Max mtime across all plugin source files — cheap cache key (~30 files). */
function sourceMtimeKey(): number {
  let max = 0;
  const dirs = [
    PLUGIN_SRC,
    join(PLUGIN_SRC, "commands"),
    join(PLUGIN_SRC, "registry"),
    join(PLUGIN_SRC, "remote_entries"),
  ];
  for (const dir of dirs) {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!name.endsWith(".js")) continue;
      try {
        const m = statSync(join(dir, name)).mtimeMs;
        if (m > max) max = m;
      } catch {
        // file vanished mid-scan — ignore
      }
    }
  }
  return max;
}

export async function getDomainBundle(domain: string): Promise<string> {
  const mtimeKey = sourceMtimeKey();
  const cached = cache.get(domain);
  if (cached && cached.mtimeKey === mtimeKey) {
    return cached.code;
  }

  const entrypoint = join(PLUGIN_SRC, "remote_entries", `${domain}.js`);
  const build = () =>
    Bun.build({
      entrypoints: [entrypoint],
      target: "browser",
      format: "iife",
      minify: true,
      sourcemap: "none",
    });

  // Bun.build throws (AggregateError) on failure in Bun 1.2+. Inside
  // `bun test` the first build can transiently fail to resolve relative
  // imports while the test's module graph is still settling — retry briefly.
  let result: Awaited<ReturnType<typeof build>> | null = null;
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3 && !result; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 50 * attempt));
    try {
      const r = await build();
      if (r.success) {
        result = r;
      } else {
        lastError = new Error(r.logs.map((l) => String(l)).join("\n"));
      }
    } catch (err) {
      lastError = err;
    }
  }

  if (!result) {
    const detail = lastError instanceof Error ? lastError.message : String(lastError);
    throw new Error(`Failed to bundle remote domain "${domain}":\n${detail}`);
  }

  const code = await result.outputs[0].text();
  cache.set(domain, { mtimeKey, code });
  return code;
}

/** Test cleanup. */
export function clearBundleCacheForTests(): void {
  cache.clear();
}
