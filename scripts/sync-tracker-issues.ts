#!/usr/bin/env bun
/**
 * Sync the improvement tracker to GitHub issues.
 *
 * The improvement tracker (.claude/analysis/improvement-tracker.md) is the
 * deduplicated source of truth for Figmagent self-improvement work. Each
 * `### [CATEGORY-NNN] Title` block maps to at most one GitHub issue.
 *
 * Matching an entry to its GitHub issue (in priority order):
 *   1. An existing issue whose title is prefixed `[CATEGORY-NNN]` (issues this
 *      script created on a previous run) — the reliable key.
 *   2. A structured `- **Issue**: #N` field, else an `/issues/N` URL in the entry
 *      HEADER line (where the tracker links pre-existing issues). We never scrape
 *      `/issues/N` from free body prose — a "Follow-up: #57" cross-reference must
 *      not bind the entry to that unrelated issue.
 *   3. Neither → the entry has no issue yet.
 *
 * Reconciliation:
 *   - active entry, no issue            → create `[ID] Title`, labelled
 *   - resolved entry, issue still open  → close it with a comment
 *   - active entry, issue closed by a   → REVERSE: rewrite the entry's Status to
 *     merged PR (INFRA-007)               `implemented — PR #M (date)` in the tracker
 *   - active entry, issue closed        → report drift (reopen only with --reopen)
 *     otherwise (manual close)
 *   - resolved entry, no issue          → skip (don't create just to close)
 *
 * The summary line always reports create/close/reopen/reverse/drift/in-sync/
 * resolved-unfiled, and appends DANGLING (tracker points at an issue number that
 * is not on the repo), DEFERRED (entry needs an issue but --limit was hit, so it
 * is NOT on GitHub) and FAILED (a gh create/close/reopen exited non-zero, so the
 * action did NOT happen) only when non-zero — those mean findings are missing
 * from GitHub and should stand out in the nightly log.
 *
 * "Resolved" derivation: the same ID can appear under both "## Active Issues"
 * and "## Resolved Issues". The ACTIVE occurrence's Status is authoritative — if
 * an entry is active with Status `identified`, a stale Resolved-section recap
 * does NOT mark it resolved (so re-activated work is never auto-closed). An ID
 * that appears ONLY under Resolved (no active occurrence) is resolved. A Status
 * of verified / resolved / implemented counts as resolved.
 *
 * Sections: only a heading starting with "Resolved" is the Resolved section;
 * every other heading is treated as active so its Status IS read (entries used
 * to be appended after "## Metrics Over Time", where `implemented` never closed
 * an issue). Entries outside the two known headings are still reconciled, but
 * they are reported — misplacement is an authoring slip that stays visible.
 * The parser itself lives in `tracker-parse.ts` (shared with `dispatch-fix.ts`
 * and `tracker.ts`); `tests/tracker-parse.test.ts` pins it to these semantics.
 *
 * Reverse-sync (INFRA-007 / #196): a closed issue whose timeline carries a
 * cross-reference from a MERGED pull request was closed by that PR, so the
 * tracker — not GitHub — is stale. The entry's Status line is rewritten in
 * place (nothing else in the file changes) and the row is reported as REVERSE.
 * A close with no merged PR (manual, or `not_planned`) still needs a human and
 * stays DRIFT. The decision is `decideReverse` in `sync-reverse-lib.ts`; the
 * tracker is written once, after the loop, only when something changed, and
 * never under --dry-run. Reverse-sync never reopens an issue.
 *
 * Idempotent: safe to run nightly. Keys on stable issue numbers / ID prefixes,
 * so it never creates duplicates.
 *
 * Usage:
 *   bun scripts/sync-tracker-issues.ts             # apply
 *   bun scripts/sync-tracker-issues.ts --dry-run   # preview, no writes
 *   bun scripts/sync-tracker-issues.ts --limit=10  # cap new issues this run
 *   bun scripts/sync-tracker-issues.ts --reopen    # reopen issues that regressed
 */

import { readdir, readFile, writeFile } from "node:fs/promises";
import { $ } from "bun";
import { decideReverse, implementedStatus, mergedClosers, parseTimelineJson } from "./sync-reverse-lib.ts";
import { parseTrackerFull, priorityToken, type TrackerEntry, updateEntryField } from "./tracker-parse.ts";

const TRACKER = ".claude/analysis/improvement-tracker.md";
const ANALYSIS_DIR = ".claude/analysis";
const REPO = process.env.AUTO_IMPROVE_REPO || "dabowman/Figmagent";
const LABEL = "figmagent-improvement";

const dryRun = process.argv.includes("--dry-run");
const reopen = process.argv.includes("--reopen");

// --limit caps new issues per run. Absent ⇒ no cap. A malformed value
// (--limit=, --limit=abc) is an error, not a silently-disabled cap.
let createLimit = Number.POSITIVE_INFINITY;
const limitArg = process.argv.find((a) => a.startsWith("--limit="));
if (limitArg) {
  const n = Number.parseInt(limitArg.split("=")[1] ?? "", 10);
  if (Number.isNaN(n) || n < 0) {
    console.error(`Invalid ${limitArg} — expected a non-negative integer (e.g. --limit=10).`);
    process.exit(1);
  }
  createLimit = n;
}

// ---- parse the tracker into deduped issues ---------------------------------

type TrackerIssue = TrackerEntry;

const raw = await readFile(TRACKER, "utf-8");
const parsed = parseTrackerFull(raw);
const byId = new Map<string, TrackerIssue>(parsed.entries.map((e) => [e.id, e]));
// IDs reused for materially different issues (an analyzer numbering bug): two
// distinct findings would collapse onto one GitHub issue. Detect and warn.
const collisions = parsed.collisions;
// A `### [ID]` written outside the two known sections is reported instead of
// silently absorbed.
const misplaced = parsed.misplaced; // id → heading it was found under

// Entries outside "## Active Issues" / "## Resolved Issues" are still synced
// (their Status is read), but the placement is an authoring slip: it hid 44
// entries' Status for months. Warn, don't fail — the sync itself is correct.
if (misplaced.size > 0) {
  const rows = [...misplaced.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, h]) => `      ${id} — under "## ${h}"`);
  console.error(
    `⚠️  ${misplaced.size} tracker entr${misplaced.size === 1 ? "y is" : "ies are"} outside ` +
      `"## Active Issues" / "## Resolved Issues". Move them to the end of Active Issues:\n${rows.join("\n")}`,
  );
}

if (collisions.size > 0) {
  console.error(
    `⚠️  Duplicate tracker IDs with different titles — renumber them (each maps to one GitHub issue): ${[...collisions].join(", ")}`,
  );
}

// ---- upstream check: every ID written into an analysis doc reached the tracker
// The tracker is the source of truth for the GitHub sync, so a finding that an
// analysis doc names but that never got a tracker entry is invisible to every
// later stage — it silently never becomes an issue. Nothing else checks this
// direction. Warn (don't fail): the sync itself is still correct, and Stage C
// aborting would stop Stage D for an unrelated authoring slip.
// Generic `[PREFIX-N]` shape, not a hardcoded prefix list, so a new category is
// caught rather than skipped. Prefixes seen so far: BUG, TOOL, AGENT, INFRA.
const ID_IN_PROSE = /\[([A-Z]{2,}-\d+)\]/g;
const trackerBase = TRACKER.slice(TRACKER.lastIndexOf("/") + 1);
const missingFromTracker = new Map<string, Set<string>>(); // id → docs naming it
try {
  const docs = (await readdir(ANALYSIS_DIR)).filter((f) => f.endsWith(".md") && f !== trackerBase).sort();
  for (const doc of docs) {
    const text = await readFile(`${ANALYSIS_DIR}/${doc}`, "utf-8");
    for (const m of text.matchAll(ID_IN_PROSE)) {
      const id = m[1];
      if (id === undefined || byId.has(id)) continue;
      const seen = missingFromTracker.get(id) ?? new Set<string>();
      seen.add(doc);
      missingFromTracker.set(id, seen);
    }
  }
} catch (e) {
  console.error(`⚠️  Could not scan ${ANALYSIS_DIR} for orphaned finding IDs: ${e}`);
}
if (missingFromTracker.size > 0) {
  const lines = [...missingFromTracker.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, docs]) => `      ${id} — named in ${[...docs].sort().join(", ")}`);
  console.error(
    `⚠️  ${missingFromTracker.size} finding ID(s) appear in analysis docs but have no ` +
      `\`### [ID]\` entry in ${trackerBase}, so they will never reach GitHub. ` +
      `Add a tracker entry (or fix the ID in the doc):\n${lines.join("\n")}`,
  );
}

const trackerIssues = [...byId.values()];

const issueBody = (t: TrackerIssue): string =>
  [
    t.body,
    "",
    "---",
    "*Auto-synced from `.claude/analysis/improvement-tracker.md` by `scripts/sync-tracker-issues.ts`.*",
    `*Tracker ID: \`${t.id}\` — keep the \`[${t.id}]\` title prefix; it is the sync key.*`,
  ].join("\n");

// ---- read current GitHub state (fully paginated, PRs excluded) --------------

interface GhIssue {
  number: number;
  title: string;
  state: string;
  stateReason: string | null;
}

// `gh issue list --limit N` caps the snapshot; once the repo exceeds N an
// existing [ID]-titled issue could fall outside the window and get duplicated.
// `gh api --paginate --slurp` walks every page and returns one JSON array (of
// per-page arrays). The REST issues endpoint also returns PRs, so filter them
// out (`.pull_request` present ⇒ it's a PR).
// Params go in the URL (query string) — `-f` would make `gh api` issue a POST.
const listJson = await $`gh api --paginate --slurp ${`repos/${REPO}/issues?state=all&per_page=100`}`.nothrow().text();
let existingIssues: GhIssue[];
try {
  const pages = JSON.parse(listJson) as Array<
    Array<{ number: number; title: string; state: string; state_reason?: string | null; pull_request?: unknown }>
  >;
  existingIssues = pages
    .flat()
    .filter((e) => !e.pull_request)
    .map((e) => ({ number: e.number, title: e.title, state: e.state, stateReason: e.state_reason ?? null }));
} catch {
  console.error(`Failed to list GitHub issues. Is \`gh\` authenticated for ${REPO}?`);
  process.exit(1);
}

const stateByNumber = new Map<number, string>();
const stateReasonByNumber = new Map<number, string | null>();
const numberByPrefix = new Map<string, number>();
for (const e of existingIssues) {
  stateByNumber.set(e.number, e.state.toLowerCase());
  stateReasonByNumber.set(e.number, e.stateReason);
  const m = e.title.match(/^\[([A-Z]+-\d+)\]/);
  if (m?.[1]) numberByPrefix.set(m[1], e.number);
}

// The [ID]-title match is the reliable primary key; the header/struct ref is a
// fallback for pre-existing issues the sync didn't create.
const resolveNum = (t: TrackerIssue): number | undefined => numberByPrefix.get(t.id) ?? t.issueRef;

// The issue timeline carries a `cross-referenced` event (with `merged_at`) for
// EVERY PR that mentions the issue, closing or not — so the PR that actually
// closed it comes from GitHub's own record, `closedByPullRequestsReferences`,
// and only a PR on that list may flip the entry. Both are fetched only for the
// closed-but-active cases, a handful per night. Any fetch failure reads as
// "no closer", so the entry falls back to DRIFT — never to a wrong REVERSE.
const fetchTimeline = async (num: number) => {
  const json = await $`gh api --paginate --slurp ${`repos/${REPO}/issues/${num}/timeline?per_page=100`}`
    .nothrow()
    .text();
  return parseTimelineJson(json);
};
const [REPO_OWNER, REPO_NAME] = REPO.split("/") as [string, string];
const CLOSERS_QUERY =
  "query($owner: String!, $name: String!, $number: Int!) { repository(owner: $owner, name: $name) { issue(number: $number) { closedByPullRequestsReferences(first: 20, includeClosedPrs: true) { nodes { number merged } } } } }";
const fetchClosers = async (num: number): Promise<number[]> => {
  const r =
    await $`gh api graphql -f query=${CLOSERS_QUERY} -F owner=${REPO_OWNER} -F name=${REPO_NAME} -F number=${num}`
      .nothrow()
      .quiet();
  if (r.exitCode !== 0) return [];
  try {
    const data = JSON.parse(r.stdout.toString()) as {
      data?: { repository?: { issue?: { closedByPullRequestsReferences?: { nodes?: unknown[] } } } };
    };
    return mergedClosers(data.data?.repository?.issue?.closedByPullRequestsReferences?.nodes as never);
  } catch {
    return [];
  }
};

// ---- ensure labels exist ----------------------------------------------------

const ensureLabel = async (name: string, color: string, desc: string): Promise<void> => {
  if (dryRun) return;
  await $`gh label create ${name} --repo ${REPO} --color ${color} --description ${desc} --force`.nothrow().quiet();
};

const prioColor: Record<string, string> = {
  P0: "b60205",
  P1: "d93f0b",
  P2: "fbca04",
};
const toCreate = trackerIssues.filter((t) => !t.resolved && resolveNum(t) === undefined);
if (!dryRun && toCreate.length > 0) {
  await ensureLabel(LABEL, "1d76db", "Figmagent self-improvement issue (auto-synced from tracker)");
  for (const p of new Set(toCreate.map((t) => priorityToken(t)).filter(Boolean))) {
    await ensureLabel(`priority:${p}`, prioColor[p] || "ededed", `Priority ${p}`);
  }
  for (const c of new Set(toCreate.map((t) => t.category).filter(Boolean))) {
    await ensureLabel(c, "5319e7", `Tracker category: ${c}`);
  }
}

// ---- reconcile --------------------------------------------------------------

let created = 0;
let closed = 0;
let reopened = 0;
let reversed = 0; // tracker Status rewritten to implemented from a merged PR
let drift = 0;
// `skipped` was one bucket for four unrelated outcomes, so a run that filed
// nothing looked identical to a run that was in sync. Count them separately.
let inSync = 0; // matched an issue in the state the tracker wants
let unfiled = 0; // resolved and never filed — deliberate, no noise
let dangling = 0; // tracker refs an issue number that isn't on the repo
let deferred = 0; // needed an issue but hit --limit; NOT on GitHub yet
let failed = 0; // a gh create/close/reopen that exited non-zero; NOT applied on GitHub
const actions: string[] = [];
let trackerText = raw;

for (const t of trackerIssues) {
  const num = resolveNum(t);
  const wantOpen = !t.resolved;

  if (num !== undefined) {
    const state = stateByNumber.get(num);
    if (state === undefined) {
      actions.push(`MISSING [${t.id}] → #${num} not found on ${REPO}; skipping`);
      dangling++;
    } else if (!wantOpen && state === "open") {
      actions.push(`CLOSE   #${num} [${t.id}] (${t.resolvedReason || "resolved"})`);
      if (!dryRun) {
        const r =
          await $`gh issue close ${num} --repo ${REPO} --comment ${`Resolved in tracker (${t.resolvedReason || "resolved"}). Closed by auto-improve sync.`}`
            .nothrow()
            .quiet();
        if (r.exitCode !== 0) {
          actions.push(
            `FAILED  close #${num} [${t.id}]: ${r.stderr.toString().trim().split("\n")[0] || `exit ${r.exitCode}`}`,
          );
          failed++;
          continue;
        }
      }
      closed++;
    } else if (wantOpen && state === "closed") {
      const decision = decideReverse(
        { state, state_reason: stateReasonByNumber.get(num) ?? null },
        await fetchTimeline(num),
        { repo: REPO, closers: await fetchClosers(num) },
      );
      if (decision.action === "reverse") {
        const status = implementedStatus(decision.pr, decision.date);
        const next = updateEntryField(trackerText, t.id, "Status", status);
        if (next === trackerText) {
          // Should not happen (the entry was parsed from this text); keep it visible.
          actions.push(
            `DRIFT   #${num} [${t.id}] closed by PR #${decision.pr} but its Status line could not be rewritten`,
          );
          drift++;
        } else {
          trackerText = next;
          actions.push(`REVERSE #${num} [${t.id}] → implemented (PR #${decision.pr})`);
          reversed++;
        }
      } else if (reopen) {
        actions.push(`REOPEN  #${num} [${t.id}]`);
        if (!dryRun) {
          const r = await $`gh issue reopen ${num} --repo ${REPO}`.nothrow().quiet();
          if (r.exitCode !== 0) {
            actions.push(
              `FAILED  reopen #${num} [${t.id}]: ${r.stderr.toString().trim().split("\n")[0] || `exit ${r.exitCode}`}`,
            );
            failed++;
            continue;
          }
        }
        reopened++;
      } else {
        actions.push(`DRIFT   #${num} [${t.id}] closed but tracker active (use --reopen)`);
        drift++;
      }
    } else {
      inSync++; // already in sync
    }
    continue;
  }

  if (!wantOpen) {
    unfiled++; // resolved and never filed — no noise
    continue;
  }
  if (created >= createLimit) {
    // The one genuinely silent case: a finding that belongs on GitHub and
    // isn't there yet. Name it, or the next run's summary hides the backlog.
    actions.push(`DEFERRED [${t.id}] (${t.priority || "—"}) needs an issue; --limit ${createLimit} reached`);
    deferred++;
    continue;
  }
  actions.push(`CREATE  [${t.id}] (${t.priority || "—"}) ${t.cleanTitle}`);
  if (!dryRun) {
    const prio = priorityToken(t);
    const labels = [LABEL, prio && `priority:${prio}`, t.category].filter(Boolean).join(",");
    const r = await $`gh issue create --repo ${REPO} --title ${t.fullTitle} --body ${issueBody(t)} --label ${labels}`
      .nothrow()
      .quiet();
    if (r.exitCode !== 0) {
      // Counted separately: a summary that says "N create" must mean N issues exist.
      actions.push(`FAILED  create [${t.id}]: ${r.stderr.toString().trim().split("\n")[0] || `exit ${r.exitCode}`}`);
      failed++;
      continue;
    }
  }
  created++;
}

// One write, after the loop, only when a Status line actually changed.
if (trackerText !== raw && !dryRun) {
  await writeFile(TRACKER, trackerText);
}

console.log(
  `${dryRun ? "[DRY RUN] " : ""}tracker→issues: ${trackerIssues.length} unique entries · ` +
    `${created} create, ${closed} close, ${reopened} reopen, ${reversed} reverse, ${drift} drift, ` +
    `${inSync} in-sync, ${unfiled} resolved-unfiled` +
    `${dangling ? `, ${dangling} DANGLING` : ""}` +
    `${deferred ? `, ${deferred} DEFERRED` : ""}` +
    `${failed ? `, ${failed} FAILED` : ""}`,
);
if (actions.length) console.log(actions.join("\n"));
if (reversed > 0) {
  console.log(
    dryRun
      ? `[DRY RUN] would rewrite ${reversed} Status line(s) in ${TRACKER}`
      : `rewrote ${reversed} Status line(s) in ${TRACKER}`,
  );
}
