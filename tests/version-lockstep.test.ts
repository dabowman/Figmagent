// Claude Code pins an installed plugin to `.claude-plugin/plugin.json` `version`
// and `/plugin update` keeps the cached copy until that number changes, so the
// plugin version is the release. scripts/release.ts bumps it together with
// package.json; this pins that the two never drift apart, that both are plain
// semver, and that the marketplace entry does not carry its own `version`
// (when both are set, plugin.json wins silently — a second copy would only mislead).

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "bun:test";
import { parseSemver } from "../scripts/release-lib.ts";

const ROOT = resolve(import.meta.dir, "..");
const read = (rel: string) => JSON.parse(readFileSync(resolve(ROOT, rel), "utf-8"));

const pkg = read("package.json") as { version?: unknown };
const plugin = read(".claude-plugin/plugin.json") as { name?: string; version?: unknown };
const marketplace = read(".claude-plugin/marketplace.json") as { plugins?: Array<Record<string, unknown>> };

describe("plugin version lockstep", () => {
  test("package.json and plugin.json carry the same version", () => {
    expect(plugin.version).toBe(pkg.version);
  });

  test("both versions are plain MAJOR.MINOR.PATCH semver", () => {
    expect(typeof pkg.version).toBe("string");
    expect(typeof plugin.version).toBe("string");
    expect(parseSemver(pkg.version as string)).not.toBeNull();
    expect(parseSemver(plugin.version as string)).not.toBeNull();
  });

  test("the marketplace entry for the plugin declares no version of its own", () => {
    const entry = (marketplace.plugins || []).find((p) => p.name === plugin.name);
    expect(entry).toBeDefined();
    expect(entry).not.toHaveProperty("version");
  });
});
