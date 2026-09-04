/**
 * Pure helpers behind scripts/release.ts (Stage F of the auto-improve pipeline).
 *
 * Nothing here touches git, gh, or the filesystem: every function is a function
 * of its inputs, so tests/release.test.ts can pin the release's behaviour —
 * version bumps, commit classification, CHANGELOG rendering, the "is there
 * anything worth releasing" gate — without ever cutting one.
 */

import { isAnalysisOnly } from "./protected-paths.ts";

export type BumpKind = "patch" | "minor" | "major";

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)$/;

/** `"1.2.3"` → `[1, 2, 3]`; anything that is not plain MAJOR.MINOR.PATCH → null. */
export function parseSemver(version: string): [number, number, number] | null {
  const m = SEMVER_RE.exec(version.trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

export function bumpVersion(current: string, kind: BumpKind): string {
  const parts = parseSemver(current);
  if (!parts) {
    throw new Error(`Not a semver version: "${current}" — expected MAJOR.MINOR.PATCH (e.g. 0.4.0), no "v" prefix`);
  }
  const [major, minor, patch] = parts;
  switch (kind) {
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "major":
      return `${major + 1}.0.0`;
    default:
      throw new Error(`Unknown bump kind: "${kind}" — use patch, minor or major`);
  }
}

export function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) throw new Error(`compareSemver needs two MAJOR.MINOR.PATCH versions, got "${a}" and "${b}"`);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

/** The highest `vX.Y.Z` tag in the list (version order, not lexical); non-semver tags are ignored. */
export function latestVersionTag(tags: string[]): string | null {
  let best: string | null = null;
  for (const raw of tags) {
    const tag = raw.trim();
    if (!tag.startsWith("v") || !parseSemver(tag.slice(1))) continue;
    if (best === null || compareSemver(tag.slice(1), best.slice(1)) > 0) best = tag;
  }
  return best;
}

/** The `version` field of a package.json / plugin.json text. */
export function versionOf(json: string): string {
  const parsed = JSON.parse(json) as { version?: unknown };
  if (typeof parsed.version !== "string") throw new Error(`No string "version" field in ${json.slice(0, 40)}…`);
  return parsed.version;
}

/**
 * Replace `"version": "<from>"` with `"version": "<to>"` in place, leaving every
 * other byte (indentation, key order, trailing newline) exactly as it was. Refuses
 * unless the field occurs exactly once — a second match would mean the file's
 * shape changed and a blind replace could hit the wrong key.
 */
export function replaceVersionField(json: string, from: string, to: string): string {
  const re = new RegExp(`("version"\\s*:\\s*")${escapeRegExp(from)}(")`, "g");
  const count = (json.match(re) || []).length;
  if (count !== 1) {
    throw new Error(`Expected exactly one "version": "${from}" field, found ${count} — bump this file by hand`);
  }
  return json.replace(re, `$1${to}$2`);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------------------------------------------------------------------------
// Commit classification
// ---------------------------------------------------------------------------

export type ChangeType = "fix" | "feat" | "docs" | "chore" | "refactor" | "test" | "other";

export interface CommitEntry {
  sha: string;
  subject: string;
  /** Commit body. For merge commits the CLI appends the merged branch's messages so `Closes #n` and IDs are seen. */
  body?: string;
}

export interface Change {
  sha: string;
  type: ChangeType;
  /** Subject with the conventional prefix stripped (merge commits: the PR title). */
  subject: string;
  /** PR numbers: `(#N)` squash suffix or `Merge pull request #N`. */
  prs: number[];
  /** Issue numbers from `Closes #n` / `Fixes #n` / `Resolves #n` (GitHub's keywords). */
  closes: number[];
  /** Tracker IDs from `[BUG-021]` or `fix(BUG-021/030)` forms. */
  ids: string[];
}

export type ChangeGroups = Record<ChangeType, Change[]>;

const TYPE_MAP: Record<string, ChangeType> = {
  fix: "fix",
  feat: "feat",
  docs: "docs",
  doc: "docs",
  chore: "chore",
  build: "chore",
  ci: "chore",
  refactor: "refactor",
  perf: "refactor",
  style: "refactor",
  test: "test",
  tests: "test",
};

// type(scope)!: subject  — scope and "!" optional
const PREFIX_RE = /^([a-z]+)(?:\(([^)]*)\))?!?:\s*(.*)$/s;
const MERGE_RE = /^Merge pull request #(\d+) from \S+/;
const PR_SUFFIX_RE = /\s*\(#(\d+)\)\s*$/;
const CLOSES_RE = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s+#(\d+)/gi;
const BRACKET_ID_RE = /\[([A-Z]+-\d+)\]/g;
const RELEASE_COMMIT_RE = /^chore(?:\(release\))?:\s*(?:v?\d+\.\d+\.\d+\b|bump version\b)/i;

export function emptyGroups(): ChangeGroups {
  return { fix: [], feat: [], docs: [], chore: [], refactor: [], test: [], other: [] };
}

/** `BUG-021/030` → `["BUG-021", "BUG-030"]`; `TOOL-025/027/035` → three IDs; `dispatch` → `[]`. */
export function expandScopeIds(scope: string): string[] {
  const out: string[] = [];
  let category: string | null = null;
  for (const part of scope.split("/")) {
    const p = part.trim();
    const full = /^([A-Z]+)-(\d+)$/.exec(p);
    if (full) {
      category = full[1];
      out.push(p);
    } else if (category && /^\d+$/.test(p)) {
      out.push(`${category}-${p}`);
    }
  }
  return out;
}

/** The release's own commit (`chore(release): v0.4.1`, `chore: bump version to 0.4.0`) is never a changelog entry. */
export function isReleaseCommit(subject: string): boolean {
  return RELEASE_COMMIT_RE.test(subject.trim());
}

export function classifyCommit(entry: CommitEntry): Change | null {
  let subject = entry.subject.trim();
  const body = entry.body || "";
  const prs = new Set<number>();
  const closes = new Set<number>();
  const ids = new Set<string>();

  // GitHub merge commit: the PR title is the first non-empty body line.
  const merge = MERGE_RE.exec(subject);
  if (merge) {
    prs.add(Number(merge[1]));
    const title = body
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.length > 0);
    if (title) subject = title;
  }

  // Squash merge: "subject (#N)".
  const suffix = PR_SUFFIX_RE.exec(subject);
  if (suffix) {
    prs.add(Number(suffix[1]));
    subject = subject.replace(PR_SUFFIX_RE, "");
  }

  if (isReleaseCommit(subject)) return null;

  let type: ChangeType = "other";
  const conv = PREFIX_RE.exec(subject);
  if (conv) {
    const mapped = TYPE_MAP[conv[1]];
    if (conv[2]) for (const id of expandScopeIds(conv[2])) ids.add(id);
    if (mapped) {
      type = mapped;
      subject = conv[3].trim();
    }
  }

  const text = `${subject}\n${body}`;
  for (const m of text.matchAll(CLOSES_RE)) closes.add(Number(m[1]));
  for (const m of text.matchAll(BRACKET_ID_RE)) ids.add(m[1]);
  // `fix(ID): …` lines inside the body — the merged branch's own commit subjects.
  for (const line of body.split("\n")) {
    const c = PREFIX_RE.exec(line.trim());
    if (c?.[2]) for (const id of expandScopeIds(c[2])) ids.add(id);
  }
  for (const pr of prs) closes.delete(pr);

  return {
    sha: entry.sha,
    type,
    subject,
    prs: [...prs].sort((a, b) => a - b),
    closes: [...closes].sort((a, b) => a - b),
    ids: sortIds([...ids]),
  };
}

export function classifyCommits(entries: CommitEntry[]): ChangeGroups {
  const groups = emptyGroups();
  for (const entry of entries) {
    const change = classifyCommit(entry);
    if (change) groups[change.type].push(change);
  }
  return groups;
}

export function sortIds(ids: string[]): string[] {
  const key = (id: string): [string, number] => {
    const m = /^([A-Z]+)-(\d+)$/.exec(id);
    return m ? [m[1], Number(m[2])] : [id, 0];
  };
  return [...new Set(ids)].sort((a, b) => {
    const [ca, na] = key(a);
    const [cb, nb] = key(b);
    return ca === cb ? na - nb : ca < cb ? -1 : 1;
  });
}

// ---------------------------------------------------------------------------
// CHANGELOG rendering
// ---------------------------------------------------------------------------

const SECTION_ORDER: ChangeType[] = ["fix", "feat", "docs", "refactor", "test", "chore", "other"];
const SECTION_TITLES: Record<ChangeType, string> = {
  fix: "Fixes",
  feat: "Features",
  docs: "Docs",
  refactor: "Refactors",
  test: "Tests",
  chore: "Chores",
  other: "Other",
};

/** `- <subject> (#199, closes #165)` */
export function formatChangeLine(change: Change): string {
  const refs: string[] = change.prs.map((n) => `#${n}`);
  if (change.closes.length > 0) refs.push(`closes ${change.closes.map((n) => `#${n}`).join(", ")}`);
  return refs.length > 0 ? `- ${change.subject} (${refs.join(", ")})` : `- ${change.subject}`;
}

/** `## v0.4.1 — 2026-09-04` for a version; a non-version label (`Unreleased`) is used verbatim. */
export function sectionHeading(version: string, dateISO: string): string {
  return parseSemver(version) ? `## v${version} — ${dateISO}` : `## ${version}`;
}

export function renderChangelogSection(version: string, dateISO: string, groups: ChangeGroups): string {
  const lines: string[] = [sectionHeading(version, dateISO), ""];
  const ids: string[] = [];
  let count = 0;
  for (const type of SECTION_ORDER) {
    const changes = groups[type] || [];
    if (changes.length === 0) continue;
    lines.push(`### ${SECTION_TITLES[type]}`, "");
    for (const change of changes) {
      lines.push(formatChangeLine(change));
      ids.push(...change.ids);
      count++;
    }
    lines.push("");
  }
  if (count === 0) lines.push("_No changes listed._", "");
  const findings = sortIds(ids);
  if (findings.length > 0) lines.push(`Findings this release: ${findings.map((id) => `[${id}]`).join(", ")}`, "");
  return lines.join("\n");
}

/**
 * Insert a new section as the first `## ` section of the changelog, keeping the
 * preamble (title + intro) above it. An existing `## Unreleased` section is
 * replaced — its entries are what the new section releases. Empty input becomes
 * a fresh `# Changelog`.
 */
export function prependChangelog(existing: string, section: string): string {
  const text = existing.replace(/\r\n/g, "\n");
  const { preamble, sections } = splitSections(text.trim() === "" ? "# Changelog\n" : text);
  const kept = sections.filter((s) => !/^## Unreleased\b/i.test(s));
  const chunks = [preamble.trimEnd(), section.trimEnd(), ...kept.map((s) => s.trimEnd())].filter((c) => c.length > 0);
  return `${chunks.join("\n\n")}\n`;
}

function splitSections(text: string): { preamble: string; sections: string[] } {
  const lines = text.split("\n");
  const preamble: string[] = [];
  const sections: string[] = [];
  let current: string[] | null = null;
  for (const line of lines) {
    if (/^## /.test(line)) {
      if (current) sections.push(current.join("\n"));
      current = [line];
    } else if (current) {
      current.push(line);
    } else {
      preamble.push(line);
    }
  }
  if (current) sections.push(current.join("\n"));
  return { preamble: preamble.join("\n"), sections };
}

// ---------------------------------------------------------------------------
// Release gate
// ---------------------------------------------------------------------------

/** Paths the nightly analysis stages write: changing only these is not a release (one rule, in protected-paths.ts). */
export function isAnalysisOnlyPath(path: string): boolean {
  return isAnalysisOnly([path]);
}

/** False for an empty list or when every path is analysis-only (analysis-only nights do not release). */
export function releaseWorthy(changedPaths: string[]): boolean {
  if (changedPaths.length === 0) return false;
  return !isAnalysisOnly(changedPaths);
}
