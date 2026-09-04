#!/usr/bin/env bun
/**
 * Stage F of the auto-improve pipeline: cut a plugin release.
 *
 * Why this exists: Claude Code pins an installed plugin to its plugin.json
 * `version`, and `/plugin update` keeps the cached copy until that number
 * changes. Merged PRs alone never reach the harness — the version bump is the
 * release. Judgement is not needed here, so no agent runs this stage; it is
 * plain git + gh with fixed parameters (see .claude/plans/2026-09-03-auto-improve-v2.md, WS3).
 *
 * Steps, each logged:
 *   1. Preconditions: on main, clean tree, no .pipeline.paused. A real run
 *      refuses (exit 2); --dry-run only reports and carries on.
 *   2. git fetch --tags origin; the last tag is the highest v* by version
 *      order. With no tag yet, the 0.4.0 bump commit (18b4a72) is the baseline.
 *   3. Commits since then (first-parent, plus PR merges nested inside those)
 *      and the changed paths. Analysis-only changes → "nothing to release",
 *      exit 0 — unless --force.
 *   4. CI gate: the CI workflow run for HEAD on main must be completed/success.
 *      Anything else → "nothing to release: CI not green", exit 0; the next
 *      night retries. --force does not skip this. Without gh, --dry-run and
 *      --no-push report that the gate was skipped; a real run refuses.
 *   5. Bump package.json and .claude-plugin/plugin.json in lockstep (in-place
 *      string replace, no re-serialising), prepend the CHANGELOG section,
 *      commit `chore(release): vX.Y.Z`, tag vX.Y.Z, push main + tag, and
 *      `gh release create` with the section as notes.
 *   6. Print `released vX.Y.Z` — or, in --dry-run, `would release vX.Y.Z` and
 *      the rendered section, having written nothing.
 *
 * Flags:
 *   --dry-run   preview only; never writes, commits, tags or pushes
 *   --minor / --major   bump kind (default patch — minor and major are by hand)
 *   --force     skip the "worth releasing" gate (never the CI gate)
 *   --no-push   everything local: no fetch, push or GitHub Release (for a clone)
 * Env: AUTO_IMPROVE_RELEASE=0 disables the stage (exit 0; --dry-run still previews);
 *      AUTO_IMPROVE_REPO (default dabowman/Figmagent).
 *
 * Exit codes: 0 released or nothing to do · 1 git/gh failure · 2 refused / usage.
 * Every git and gh invocation goes through the wrappers below; the logic that
 * decides what to write lives in release-lib.ts and is tested without them.
 */

import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import {
  type BumpKind,
  bumpVersion,
  type ChangeGroups,
  classifyCommits,
  type CommitEntry,
  latestVersionTag,
  prependChangelog,
  releaseWorthy,
  renderChangelogSection,
  replaceVersionField,
  versionOf,
} from "./release-lib.ts";

const REPO = process.env.AUTO_IMPROVE_REPO || "dabowman/Figmagent";
// "chore: bump version to 0.4.0" — the last hand-cut version, before any v* tag existed.
const BASELINE_COMMIT = "18b4a72";
const PAUSE_FILE = ".pipeline.paused";
const VERSION_FILES = ["package.json", ".claude-plugin/plugin.json"];
const CHANGELOG = "CHANGELOG.md";
const CI_WORKFLOW = "CI";
const MERGE_PR_RE = /^Merge pull request #\d+ from /;

interface Options {
  dryRun: boolean;
  kind: BumpKind;
  force: boolean;
  noPush: boolean;
}

function usage(): string {
  return "usage: bun scripts/release.ts [--dry-run] [--minor | --major] [--force] [--no-push]";
}

function parseArgs(argv: string[]): Options {
  const o: Options = { dryRun: false, kind: "patch", force: false, noPush: false };
  for (const a of argv) {
    if (a === "--dry-run") o.dryRun = true;
    else if (a === "--minor") o.kind = "minor";
    else if (a === "--major") o.kind = "major";
    else if (a === "--force") o.force = true;
    else if (a === "--no-push") o.noPush = true;
    else if (a === "--help" || a === "-h") {
      console.log(usage());
      process.exit(0);
    } else die(`Unknown flag: ${a}\n${usage()}`);
  }
  return o;
}

function log(msg: string): void {
  console.log(`release: ${msg}`);
}

function die(msg: string, code = 2): never {
  console.error(msg);
  process.exit(code);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// The only place git and gh run.
// ---------------------------------------------------------------------------

async function run(tool: "git" | "gh", args: string[]): Promise<string> {
  const r = tool === "git" ? await $`git ${args}`.nothrow().quiet() : await $`gh ${args}`.nothrow().quiet();
  if (r.exitCode !== 0) {
    const err = r.stderr.toString().trim() || r.stdout.toString().trim();
    throw new Error(`${tool} ${args.join(" ")} failed (exit ${r.exitCode})${err ? `: ${err}` : ""}`);
  }
  return r.stdout.toString();
}

const git = (args: string[]) => run("git", args);
const gh = (args: string[]) => run("gh", args);

async function gitOk(args: string[]): Promise<boolean> {
  const r = await $`git ${args}`.nothrow().quiet();
  return r.exitCode === 0;
}

function hasGh(): boolean {
  return Bun.which("gh") !== null;
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

async function preconditions(): Promise<string[]> {
  const problems: string[] = [];
  const branch = (await git(["branch", "--show-current"])).trim();
  if (branch !== "main")
    problems.push(`not on main (on ${branch ? `"${branch}"` : "a detached HEAD"}) — git switch main`);
  const status = (await git(["status", "--porcelain"])).trim();
  if (status) {
    const n = status.split("\n").length;
    problems.push(`working tree is not clean (${n} path${n === 1 ? "" : "s"}) — commit, stash or discard first`);
  }
  if (existsSync(PAUSE_FILE)) {
    const reason = readFileSync(PAUSE_FILE, "utf-8").trim().split("\n")[0] || "no reason recorded";
    problems.push(`${PAUSE_FILE} exists (${reason}) — the pipeline is paused; delete the file to resume`);
  }
  return problems;
}

async function fetchTags(o: Options): Promise<void> {
  if (o.noPush) {
    log("fetch skipped (--no-push): using local tags");
    return;
  }
  try {
    await git(["fetch", "--tags", "--quiet", "origin"]);
    log("fetched tags from origin");
  } catch (e) {
    if (!o.dryRun) throw e;
    log(`fetch failed, using local tags (${(e as Error).message.split("\n")[0]})`);
  }
}

async function baseline(): Promise<string> {
  const tags = (await git(["tag", "--list", "v*"]))
    .split("\n")
    .map((t) => t.trim())
    .filter(Boolean);
  const latest = latestVersionTag(tags);
  if (latest) {
    log(`last tag: ${latest}`);
    return latest;
  }
  log(`no v* tag yet — using the 0.4.0 bump commit (${BASELINE_COMMIT}) as the baseline`);
  return BASELINE_COMMIT;
}

async function changedPathsOf(sha: string): Promise<string[] | null> {
  const r = await $`git diff --name-only ${`${sha}^1`} ${sha}`.nothrow().quiet();
  if (r.exitCode !== 0) return null; // root commit: no parent to diff against
  return r.stdout
    .toString()
    .split("\n")
    .map((p) => p.trim())
    .filter(Boolean);
}

interface RawCommit {
  sha: string;
  parents: string[];
  subject: string;
  body: string;
}

async function logCommits(args: string[]): Promise<RawCommit[]> {
  const raw = await git(["log", "--format=%H%x1f%P%x1f%s%x1f%b%x1e", ...args]);
  const out: RawCommit[] = [];
  for (const rec of raw.split("\x1e")) {
    const [sha, parents, subject, body] = rec.replace(/^\n/, "").split("\x1f");
    if (!sha) continue;
    out.push({ sha, parents: (parents || "").split(" ").filter(Boolean), subject: subject || "", body: body || "" });
  }
  return out;
}

/**
 * A commit as release-lib sees it. For a merge commit the merged branch's own
 * messages are appended to the body (so `Closes #n` and tracker IDs written on
 * the branch are found), and any `Merge pull request` commit nested inside the
 * branch is returned as an entry of its own — a PR merged into another PR's
 * branch before that one landed is still a merged PR.
 */
async function expand(commit: RawCommit, seen: Set<string>): Promise<CommitEntry[]> {
  if (seen.has(commit.sha)) return [];
  seen.add(commit.sha);
  const entry: CommitEntry = { sha: commit.sha, subject: commit.subject, body: commit.body };
  if (commit.parents.length < 2) return [entry];

  const range = `${commit.sha}^1..${commit.sha}^2`;
  const branchMessages = await git(["log", "--format=%s%n%b", range]);
  entry.body = `${commit.body}\n${branchMessages}`;

  const entries = [entry];
  for (const nested of await logCommits(["--merges", range])) {
    if (!MERGE_PR_RE.test(nested.subject)) continue;
    entries.push(...(await expand(nested, seen)));
  }
  return entries;
}

async function collect(base: string): Promise<{ entries: CommitEntry[]; skipped: number }> {
  const entries: CommitEntry[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  for (const commit of await logCommits(["--first-parent", `${base}..HEAD`])) {
    for (const entry of await expand(commit, seen)) {
      const paths = await changedPathsOf(entry.sha);
      if (paths !== null && !releaseWorthy(paths)) {
        skipped++;
        continue;
      }
      entries.push(entry);
    }
  }
  return { entries, skipped };
}

async function ciGate(sha: string, o: Options): Promise<"green" | "not-green" | "skipped"> {
  if (!hasGh()) {
    if (o.dryRun || o.noPush) {
      log("CI gate skipped: gh is not installed");
      return "skipped";
    }
    die("gh is required for the CI gate — install the GitHub CLI (https://cli.github.com), or preview with --dry-run");
  }
  const json = await gh([
    "run",
    "list",
    "--repo",
    REPO,
    "--branch",
    "main",
    "--commit",
    sha,
    "--workflow",
    CI_WORKFLOW,
    "--json",
    "conclusion,status",
    "--limit",
    "1",
  ]);
  const runs = JSON.parse(json) as Array<{ status?: string; conclusion?: string }>;
  const ci = runs[0];
  if (ci && ci.status === "completed" && ci.conclusion === "success") {
    log(`CI green on ${sha.slice(0, 7)}`);
    return "green";
  }
  log(`CI on ${sha.slice(0, 7)}: ${ci ? `${ci.status || "?"}/${ci.conclusion || "-"}` : "no run found"}`);
  return "not-green";
}

async function cut(next: string, current: string, section: string, o: Options): Promise<void> {
  const tag = `v${next}`;
  for (const file of VERSION_FILES) {
    writeFileSync(file, replaceVersionField(readFileSync(file, "utf-8"), current, next));
  }
  const existing = existsSync(CHANGELOG) ? readFileSync(CHANGELOG, "utf-8") : "";
  writeFileSync(CHANGELOG, prependChangelog(existing, section));
  log(`bumped ${VERSION_FILES.join(" and ")} to ${next}; prepended ${CHANGELOG} section`);

  await git(["add", ...VERSION_FILES, CHANGELOG]);
  await git(["-c", "commit.gpgsign=false", "commit", "-q", "-m", `chore(release): ${tag}`]);
  await git(["-c", "tag.gpgsign=false", "tag", "-a", tag, "-m", tag]);
  log(`committed chore(release): ${tag} and tagged ${tag}`);

  if (o.noPush) {
    log("push and GitHub Release skipped (--no-push)");
    return;
  }
  await git(["push", "origin", "main", tag]);
  log(`pushed main and ${tag} to origin`);
  const notes = join(mkdtempSync(join(tmpdir(), "figmagent-release-")), `${tag}.md`);
  writeFileSync(notes, section);
  await gh(["release", "create", tag, "--repo", REPO, "--title", tag, "--notes-file", notes]);
  log(`created GitHub Release ${tag}`);
}

async function main(): Promise<void> {
  const o = parseArgs(process.argv.slice(2));

  if (process.env.AUTO_IMPROVE_RELEASE === "0" && !o.dryRun) {
    console.log("release disabled (AUTO_IMPROVE_RELEASE=0)");
    return;
  }
  if (o.dryRun) log("dry run: nothing will be written, committed, tagged or pushed");

  // 1. Preconditions.
  const problems = await preconditions();
  if (problems.length > 0) {
    if (!o.dryRun) die(`refusing to release:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    for (const p of problems) log(`note: ${p} (a real run would refuse)`);
  } else {
    log("on main, clean tree, pipeline not paused");
  }

  // 2. Last tag.
  await fetchTags(o);
  const base = await baseline();

  // 3. What changed.
  const head = (await git(["rev-parse", "HEAD"])).trim();
  const changed = (await git(["diff", "--name-only", base, head]))
    .split("\n")
    .map((p) => p.trim())
    .filter(Boolean);
  const worthy = releaseWorthy(changed);
  log(`${changed.length} path(s) changed since ${base}${changed.length > 0 && !worthy ? " — all analysis-only" : ""}`);
  if (!worthy && !o.force) {
    console.log(changed.length === 0 ? "nothing to release: no changes" : "nothing to release: analysis-only changes");
    return;
  }
  if (!worthy) log("--force: releasing anyway");
  const { entries, skipped } = await collect(base);
  const groups: ChangeGroups = classifyCommits(entries);
  const count = Object.values(groups).reduce((n, g) => n + g.length, 0);
  log(`${count} change(s) for the changelog (${skipped} analysis-only commit(s) left out)`);

  // 4. CI gate.
  const ci = await ciGate(head, o);
  if (ci === "not-green") {
    if (!o.dryRun) {
      console.log(`nothing to release: CI not green on ${head.slice(0, 7)}`);
      return;
    }
    log("note: a real run would stop here — CI is not green");
  }

  // 5. Version, changelog, commit, tag, push, release.
  const current = versionOf(readFileSync(VERSION_FILES[0], "utf-8"));
  const pluginVersion = versionOf(readFileSync(VERSION_FILES[1], "utf-8"));
  if (pluginVersion !== current) {
    die(
      `${VERSION_FILES.join(" and ")} disagree (${current} vs ${pluginVersion}) — set both to the same version by hand first`,
    );
  }
  const next = bumpVersion(current, o.kind);
  const tag = `v${next}`;
  if (await gitOk(["rev-parse", "--verify", "-q", `refs/tags/${tag}`])) {
    die(
      `tag ${tag} already exists but ${VERSION_FILES[0]} is at ${current} — bump the files by hand or delete the stray tag`,
    );
  }
  const section = renderChangelogSection(next, today(), groups);
  log(`${current} → ${next} (${o.kind})`);

  if (o.dryRun) {
    console.log(`would release ${tag}`);
    console.log("");
    console.log(section);
    return;
  }

  await cut(next, current, section, o);
  console.log(`released ${tag}`);
}

try {
  await main();
} catch (e) {
  console.error(`release failed: ${(e as Error).message}`);
  process.exit(1);
}
