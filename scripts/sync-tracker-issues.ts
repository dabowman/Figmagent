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
 *   - active entry, issue closed        → report drift (reopen only with --reopen)
 *   - resolved entry, no issue          → skip (don't create just to close)
 *
 * "Resolved" derivation: the same ID can appear under both "## Active Issues"
 * and "## Resolved Issues". The ACTIVE occurrence's Status is authoritative — if
 * an entry is active with Status `identified`, a stale Resolved-section recap
 * does NOT mark it resolved (so re-activated work is never auto-closed). An ID
 * that appears ONLY under Resolved (no active occurrence) is resolved. A Status
 * of verified / resolved / implemented counts as resolved.
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

import { readFile } from "node:fs/promises";
import { $ } from "bun";

const TRACKER = ".claude/analysis/improvement-tracker.md";
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

const isResolutionStatus = (s: string): boolean =>
	/^(verified|resolved|implemented)\b/i.test(s);

// ---- parse the tracker into deduped issues ---------------------------------

interface TrackerIssue {
	id: string; // TOOL-001
	cleanTitle: string; // header text with " — [#N]…" decoration stripped
	fullTitle: string; // "[TOOL-001] cleanTitle"
	priority: string; // P0 | P1 | P2 | ""
	category: string;
	body: string;
	issueRef?: number; // structured **Issue** field, else header /issues/N
	activeStatus?: string; // Status from an Active-section occurrence (authoritative)
	inResolved: boolean; // appeared under "## Resolved Issues"
	resolved: boolean; // derived after parsing
	resolvedReason: string; // for the close comment (never contradicts status)
}

// Issue ref from the HEADER line only (the entry's own link), never body prose.
const headerIssueRef = (titleLine: string): number | undefined => {
	const m = titleLine.match(/\/issues\/(\d+)/);
	return m?.[1] ? Number.parseInt(m[1], 10) : undefined;
};

const raw = await readFile(TRACKER, "utf-8");
const lines = raw.split("\n");
const byId = new Map<string, TrackerIssue>();
// IDs reused for materially different issues (an analyzer numbering bug): two
// distinct findings would collapse onto one GitHub issue. Detect and warn.
const collisions = new Set<string>();
const normTitle = (s: string): string =>
	s.toLowerCase().replace(/[`*_]/g, "").replace(/\s+/g, " ").trim();

let section: "active" | "resolved" | "other" = "other";
let curId = "";
let curTitleLine = "";
let curStatus = "";
let curPriority = "";
let curCategory = "";
let curIssue: number | undefined;
let bodyLines: string[] = [];

const commit = (): void => {
	if (!curId) return;
	const body = bodyLines.join("\n").trim();
	const cleanTitle = curTitleLine.replace(/\s*—\s*\[(?:#|PR\b).*$/u, "").trim();
	const ref = curIssue ?? headerIssueRef(curTitleLine);

	const existing = byId.get(curId);
	if (!existing) {
		byId.set(curId, {
			id: curId,
			cleanTitle,
			fullTitle: `[${curId}] ${cleanTitle}`,
			priority: curPriority,
			category: curCategory,
			body,
			issueRef: ref,
			activeStatus: section === "active" ? curStatus : undefined,
			inResolved: section === "resolved",
			resolved: false,
			resolvedReason: "",
		});
	} else {
		// Same ID, materially different title ⇒ two different issues share an ID.
		if (normTitle(cleanTitle) !== normTitle(existing.cleanTitle)) {
			collisions.add(curId);
		}
		// Merge duplicates. Richest body wins for display; the ACTIVE occurrence's
		// status is authoritative; resolved-ness is derived later, not OR-ed here.
		if (body.length > existing.body.length) {
			existing.body = body;
			existing.cleanTitle = cleanTitle;
			existing.fullTitle = `[${curId}] ${cleanTitle}`;
			if (curPriority) existing.priority = curPriority;
			if (curCategory) existing.category = curCategory;
		}
		if (section === "active" && curStatus) existing.activeStatus = curStatus;
		if (section === "resolved") existing.inResolved = true;
		existing.issueRef = existing.issueRef ?? ref;
	}
};

for (const line of lines) {
	const h2 = line.match(/^## (.+)/);
	if (h2) {
		commit();
		curId = "";
		bodyLines = [];
		const t = (h2[1] ?? "").toLowerCase();
		section = t.includes("resolved")
			? "resolved"
			: t.includes("active")
				? "active"
				: "other";
		continue;
	}
	const h3 = line.match(/^### \[([A-Z]+-\d+)\]\s+(.+)/);
	if (h3) {
		commit();
		curId = h3[1] ?? "";
		curTitleLine = (h3[2] ?? "").trim();
		curStatus = "";
		curPriority = "";
		curCategory = "";
		curIssue = undefined;
		bodyLines = [];
		continue;
	}
	if (curId) {
		bodyLines.push(line);
		const s = line.match(/^- \*\*Status\*\*:\s*(.+)/);
		if (s) curStatus = (s[1] ?? "").trim();
		const p = line.match(/^- \*\*Priority\*\*:\s*(.+)/);
		if (p) curPriority = (p[1] ?? "").trim();
		const c = line.match(/^- \*\*Category\*\*:\s*(.+)/);
		if (c) curCategory = (c[1] ?? "").trim();
		// Optional structured override: `- **Issue**: #123` (preferred over header).
		const iss = line.match(/^- \*\*Issue\*\*:\s*#?(\d+)/);
		if (iss?.[1]) curIssue = Number.parseInt(iss[1], 10);
	}
}
commit();

if (collisions.size > 0) {
	console.error(
		`⚠️  Duplicate tracker IDs with different titles — renumber them (each maps to one GitHub issue): ${[...collisions].join(", ")}`,
	);
}

// Derive resolved-ness from the authoritative occurrence.
for (const t of byId.values()) {
	if (t.activeStatus !== undefined) {
		t.resolved = isResolutionStatus(t.activeStatus);
		t.resolvedReason = t.resolved ? `status: ${t.activeStatus}` : "";
	} else {
		t.resolved = t.inResolved; // only appears under Resolved
		t.resolvedReason = t.inResolved ? "listed under Resolved Issues" : "";
	}
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
}

// `gh issue list --limit N` caps the snapshot; once the repo exceeds N an
// existing [ID]-titled issue could fall outside the window and get duplicated.
// `gh api --paginate --slurp` walks every page and returns one JSON array (of
// per-page arrays). The REST issues endpoint also returns PRs, so filter them
// out (`.pull_request` present ⇒ it's a PR).
// Params go in the URL (query string) — `-f` would make `gh api` issue a POST.
const listJson =
	await $`gh api --paginate --slurp ${`repos/${REPO}/issues?state=all&per_page=100`}`
		.nothrow()
		.text();
let existingIssues: GhIssue[];
try {
	const pages = JSON.parse(listJson) as Array<
		Array<{ number: number; title: string; state: string; pull_request?: unknown }>
	>;
	existingIssues = pages
		.flat()
		.filter((e) => !e.pull_request)
		.map((e) => ({ number: e.number, title: e.title, state: e.state }));
} catch {
	console.error(`Failed to list GitHub issues. Is \`gh\` authenticated for ${REPO}?`);
	process.exit(1);
}

const stateByNumber = new Map<number, string>();
const numberByPrefix = new Map<string, number>();
for (const e of existingIssues) {
	stateByNumber.set(e.number, e.state.toLowerCase());
	const m = e.title.match(/^\[([A-Z]+-\d+)\]/);
	if (m?.[1]) numberByPrefix.set(m[1], e.number);
}

// The [ID]-title match is the reliable primary key; the header/struct ref is a
// fallback for pre-existing issues the sync didn't create.
const resolveNum = (t: TrackerIssue): number | undefined =>
	numberByPrefix.get(t.id) ?? t.issueRef;

// ---- ensure labels exist ----------------------------------------------------

const ensureLabel = async (
	name: string,
	color: string,
	desc: string,
): Promise<void> => {
	if (dryRun) return;
	await $`gh label create ${name} --repo ${REPO} --color ${color} --description ${desc} --force`
		.nothrow()
		.quiet();
};

const prioColor: Record<string, string> = {
	P0: "b60205",
	P1: "d93f0b",
	P2: "fbca04",
};
const toCreate = trackerIssues.filter(
	(t) => !t.resolved && resolveNum(t) === undefined,
);
if (!dryRun && toCreate.length > 0) {
	await ensureLabel(
		LABEL,
		"1d76db",
		"Figmagent self-improvement issue (auto-synced from tracker)",
	);
	for (const p of new Set(toCreate.map((t) => t.priority).filter(Boolean))) {
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
let drift = 0;
let skipped = 0;
const actions: string[] = [];

for (const t of trackerIssues) {
	const num = resolveNum(t);
	const wantOpen = !t.resolved;

	if (num !== undefined) {
		const state = stateByNumber.get(num);
		if (state === undefined) {
			actions.push(`MISSING [${t.id}] → #${num} not found on ${REPO}; skipping`);
			skipped++;
		} else if (!wantOpen && state === "open") {
			actions.push(`CLOSE   #${num} [${t.id}] (${t.resolvedReason || "resolved"})`);
			if (!dryRun) {
				await $`gh issue close ${num} --repo ${REPO} --comment ${`Resolved in tracker (${t.resolvedReason || "resolved"}). Closed by auto-improve sync.`}`
					.nothrow()
					.quiet();
			}
			closed++;
		} else if (wantOpen && state === "closed") {
			if (reopen) {
				actions.push(`REOPEN  #${num} [${t.id}]`);
				if (!dryRun) await $`gh issue reopen ${num} --repo ${REPO}`.nothrow().quiet();
				reopened++;
			} else {
				actions.push(`DRIFT   #${num} [${t.id}] closed but tracker active (use --reopen)`);
				drift++;
			}
		} else {
			skipped++; // already in sync
		}
		continue;
	}

	if (!wantOpen) {
		skipped++; // resolved and never filed — no noise
		continue;
	}
	if (created >= createLimit) {
		skipped++;
		continue;
	}
	actions.push(`CREATE  [${t.id}] (${t.priority || "—"}) ${t.cleanTitle}`);
	if (!dryRun) {
		const labels = [LABEL, t.priority && `priority:${t.priority}`, t.category]
			.filter(Boolean)
			.join(",");
		await $`gh issue create --repo ${REPO} --title ${t.fullTitle} --body ${issueBody(t)} --label ${labels}`
			.nothrow()
			.quiet();
	}
	created++;
}

console.log(
	`${dryRun ? "[DRY RUN] " : ""}tracker→issues: ${trackerIssues.length} unique entries · ` +
		`${created} create, ${closed} close, ${reopened} reopen, ${drift} drift, ${skipped} in-sync/skip`,
);
if (actions.length) console.log(actions.join("\n"));
