#!/usr/bin/env bun
/**
 * Sync the improvement tracker to GitHub issues.
 *
 * The improvement tracker (.claude/analysis/improvement-tracker.md) is the
 * deduplicated source of truth for Figmagent self-improvement work. Each
 * `### [CATEGORY-NNN] Title` block maps to at most one GitHub issue.
 *
 * Matching an entry to its GitHub issue (in priority order):
 *   1. An `/issues/N` URL embedded in the entry header/body (the tracker links
 *      many entries to issues that already exist) → that issue number.
 *   2. An existing issue whose title is prefixed `[CATEGORY-NNN]` (issues this
 *      script created on a previous run).
 *   3. Neither → the entry has no issue yet.
 *
 * Reconciliation:
 *   - active entry, no issue            → create `[ID] Title`, labelled
 *   - resolved entry, issue still open  → close it with a comment
 *   - active entry, issue closed        → report drift (reopen only with --reopen)
 *   - resolved entry, no issue          → skip (don't create just to close)
 *
 * "Resolved" = the entry appears under "## Resolved Issues", or its Status
 * starts with `verified` / `resolved`. The same ID can appear in both the Active
 * and Resolved sections; entries are deduped by ID (richest body wins, resolved
 * is sticky, first issue ref wins).
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
const limitArg = process.argv.find((a) => a.startsWith("--limit="));
const createLimit = limitArg
	? Number.parseInt(limitArg.split("=")[1] ?? "", 10)
	: Number.POSITIVE_INFINITY;

// ---- parse the tracker into deduped issues ---------------------------------

interface TrackerIssue {
	id: string; // TOOL-001
	cleanTitle: string; // header text with " — [#N]…" decoration stripped
	fullTitle: string; // "[TOOL-001] cleanTitle"
	status: string;
	priority: string; // P0 | P1 | P2 | ""
	category: string;
	resolved: boolean;
	issueRef?: number; // existing /issues/N referenced by the tracker
	body: string;
}

const parseIssueRef = (text: string): number | undefined => {
	const m = text.match(/\/issues\/(\d+)/);
	return m?.[1] ? Number.parseInt(m[1], 10) : undefined;
};

const raw = await readFile(TRACKER, "utf-8");
const lines = raw.split("\n");
const byId = new Map<string, TrackerIssue>();

let section: "active" | "resolved" | "other" = "other";
let curId = "";
let curTitleLine = "";
let curStatus = "";
let curPriority = "";
let curCategory = "";
let bodyLines: string[] = [];

const commit = (): void => {
	if (!curId) return;
	const body = bodyLines.join("\n").trim();
	// An entry is "resolved" (→ its GitHub issue should be closed) when it sits
	// under Resolved, or its Status is verified / resolved / implemented. Note
	// "partially implemented" and "mixed" deliberately stay open (work remains).
	const resolved =
		section === "resolved" || /^(verified|resolved|implemented)\b/i.test(curStatus);
	const cleanTitle = curTitleLine.replace(/\s*—\s*\[(?:#|PR\b).*$/u, "").trim();
	const issueRef = parseIssueRef(`${curTitleLine}\n${body}`);

	const existing = byId.get(curId);
	if (!existing) {
		byId.set(curId, {
			id: curId,
			cleanTitle,
			fullTitle: `[${curId}] ${cleanTitle}`,
			status: curStatus,
			priority: curPriority,
			category: curCategory,
			resolved,
			issueRef,
			body,
		});
	} else {
		// Merge duplicates (Active + Resolved recap). Richest body wins;
		// resolved is sticky; keep the first issue ref we saw.
		if (body.length > existing.body.length) {
			existing.body = body;
			existing.cleanTitle = cleanTitle;
			existing.fullTitle = `[${curId}] ${cleanTitle}`;
			if (curStatus) existing.status = curStatus;
			if (curPriority) existing.priority = curPriority;
			if (curCategory) existing.category = curCategory;
		}
		existing.resolved = existing.resolved || resolved;
		existing.issueRef = existing.issueRef ?? issueRef;
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
	}
}
commit();

const trackerIssues = [...byId.values()];

const issueBody = (t: TrackerIssue): string =>
	[
		t.body,
		"",
		"---",
		"*Auto-synced from `.claude/analysis/improvement-tracker.md` by `scripts/sync-tracker-issues.ts`.*",
		`*Tracker ID: \`${t.id}\` — keep the \`[${t.id}]\` title prefix; it is a sync key.*`,
	].join("\n");

// ---- read current GitHub state ---------------------------------------------

interface GhIssue {
	number: number;
	title: string;
	state: string;
}

const listJson =
	await $`gh issue list --repo ${REPO} --state all --limit 1000 --json number,title,state`
		.nothrow()
		.text();
let existingIssues: GhIssue[] = [];
try {
	existingIssues = JSON.parse(listJson);
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

const resolveNum = (t: TrackerIssue): number | undefined =>
	t.issueRef ?? numberByPrefix.get(t.id);

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
			actions.push(`CLOSE   #${num} [${t.id}] (${t.status || "resolved"})`);
			if (!dryRun) {
				await $`gh issue close ${num} --repo ${REPO} --comment ${`Resolved in tracker (status: ${t.status || "resolved"}). Closed by auto-improve sync.`}`
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
