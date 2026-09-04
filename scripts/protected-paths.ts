/**
 * Protected paths for the auto-improve pipeline.
 *
 * The self-modification boundary, in one place: the pipeline may PROPOSE a change
 * to any of these files (a draft PR) and must never MERGE one. The merge queue
 * (`scripts/merge-queue.ts` via `scripts/merge-eligibility.ts`) marks any PR
 * touching one of them `humanOnly`; Stage D denies edits to them inside
 * worktrees; the analysis-push guard in `auto-improve.sh` pipes the changed
 * paths through `bun scripts/protected-paths.ts --analysis-only` (the
 * `import.meta.main` block below) to decide whether a local commit may be
 * pushed to `main` at all, and `release-lib.ts` uses `isAnalysisOnly` for the
 * "worth releasing" gate — one rule, one place.
 *
 * The rule functions are pure + side-effect free so they can be unit-tested and
 * imported anywhere; only the CLI block at the bottom touches stdin/stdout.
 */

/** Globs (`*` = one path segment, `**` = any depth), relative to the repo root. */
export const PROTECTED_PATHS: readonly string[] = [
  ".github/**",
  // Every pipeline script — the CLI entry points AND the `*-lib.ts` modules that
  // hold the gates they enforce (candidate selection, release worthiness,
  // tracker parsing, reverse-sync). The stage sandboxes already deny edits to
  // `scripts/**` in worktrees; the merge boundary matches them.
  "scripts/**",
  ".claude/commands/**",
  ".claude/skills/analyze-session/**",
  ".claude/hooks/**",
  ".claude/settings.json",
  ".claude-plugin/**",
  // Loaded into every pipeline stage as instructions — a merged edit here
  // rewrites how the overnight agents behave.
  "CLAUDE.md",
  "package.json",
  "bun.lock",
  "src/figma_plugin/manifest.json",
  ".mcp.json",
];

/** Directories (and one file) whose changes are "analysis only" — pushable without a release. */
export const ANALYSIS_ONLY_PREFIXES: readonly string[] = [".claude/analysis/", ".claude/plans/"];
export const ANALYSIS_ONLY_FILES: readonly string[] = ["CHANGELOG.md"];

/** Strip a leading `./` or `/` so `./package.json`, `/package.json` and `package.json` agree. */
export function normalizePath(path: string): string {
  return path
    .trim()
    .replace(/\\/g, "/")
    .replace(/^(\.\/|\/)+/, "");
}

const GLOB_CACHE = new Map<string, RegExp>();

/** Compile a glob to a regex. `**` matches across `/`; `*` matches within one segment. */
export function globToRegExp(glob: string): RegExp {
  const cached = GLOB_CACHE.get(glob);
  if (cached) return cached;
  let re = "^";
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === "*") {
      if (glob[i + 1] === "*") {
        re += ".*";
        i++;
        // `/**` at the end should also match the directory itself (`.github/**` ⊇ `.github`)
        if (glob[i + 1] === "/" && i + 2 === glob.length) {
          re += "(/.*)?";
          i++;
        }
      } else {
        re += "[^/]*";
      }
    } else if (/[.+?^${}()|[\]\\]/.test(ch)) {
      re += `\\${ch}`;
    } else {
      re += ch;
    }
  }
  re += "$";
  const compiled = new RegExp(re);
  GLOB_CACHE.set(glob, compiled);
  return compiled;
}

/** Does `path` (repo-relative) match any protected glob? */
export function isProtected(path: string): boolean {
  const p = normalizePath(path);
  if (!p) return false;
  return PROTECTED_PATHS.some((glob) => globToRegExp(glob).test(p));
}

/** The subset of `paths` that is protected (empty when none). */
export function protectedPathsIn(paths: readonly string[]): string[] {
  return paths.filter((p) => isProtected(p)).map(normalizePath);
}

/** True when at least one of `paths` is protected. */
export function touchesProtected(paths: readonly string[]): boolean {
  return paths.some((p) => isProtected(p));
}

/**
 * True when EVERY path is under `.claude/analysis/`, `.claude/plans/`, or is
 * `CHANGELOG.md` — the shape of a Stage B commit that may be pushed to `main`
 * without a review or a release. An empty list is vacuously analysis-only:
 * pushing a commit that touches nothing is harmless.
 */
export function isAnalysisOnly(paths: readonly string[]): boolean {
  return paths.every((raw) => {
    const p = normalizePath(raw);
    if (!p) return false;
    if (ANALYSIS_ONLY_FILES.includes(p)) return true;
    return ANALYSIS_ONLY_PREFIXES.some((prefix) => p.startsWith(prefix) && p.length > prefix.length);
  });
}

// ---------------------------------------------------------------------------
// CLI: `bun scripts/protected-paths.ts --analysis-only < paths` — the push
// guard in auto-improve.sh. Reads one path per line, prints every path that is
// NOT analysis-only, exits 1 when there is at least one (0 when all qualify).
// ---------------------------------------------------------------------------

if (import.meta.main) {
  const mode = process.argv[2];
  if (mode !== "--analysis-only") {
    console.error("usage: bun scripts/protected-paths.ts --analysis-only < paths (one per line)");
    process.exit(2);
  }
  const paths = (await Bun.stdin.text()).split("\n").map(normalizePath).filter(Boolean);
  const outside = paths.filter((p) => !isAnalysisOnly([p]));
  for (const p of outside) console.log(p);
  process.exit(outside.length > 0 ? 1 : 0);
}
