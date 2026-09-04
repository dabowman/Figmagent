/**
 * Protected paths for the auto-improve pipeline.
 *
 * The self-modification boundary, in one place: the pipeline may PROPOSE a change
 * to any of these files (a draft PR) and must never MERGE one. The merge queue
 * (`scripts/merge-queue.ts` via `scripts/merge-eligibility.ts`) marks any PR
 * touching one of them `humanOnly`; Stage D denies edits to them inside
 * worktrees; the analysis-push guard in `auto-improve.sh` uses `isAnalysisOnly`
 * to decide whether a local commit may be pushed to `main` at all.
 *
 * Pure + side-effect free so it can be unit-tested and imported anywhere.
 */

/** Globs (`*` = one path segment, `**` = any depth), relative to the repo root. */
export const PROTECTED_PATHS: readonly string[] = [
  ".github/**",
  "scripts/auto-improve.sh",
  "scripts/dispatch-fix.ts",
  "scripts/merge-queue.ts",
  "scripts/merge-eligibility.ts",
  "scripts/protected-paths.ts",
  "scripts/release.ts",
  "scripts/sync-tracker-issues.ts",
  "scripts/pipeline/**",
  "scripts/pipeline-record.ts",
  "scripts/refresh-manifest.ts",
  ".claude/commands/**",
  ".claude/skills/analyze-session/**",
  ".claude/hooks/**",
  ".claude/settings.json",
  ".claude-plugin/**",
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
