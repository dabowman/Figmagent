#!/usr/bin/env bun
/**
 * Deterministic git/gh mechanics for Stage D (dispatch-fixes) of the auto-improve
 * pipeline. The /dispatch-fixes prompt supplies only JUDGEMENT — which issue, does
 * the plan apply cleanly — and calls these subcommands for every irreversible step.
 *
 * Why a script and not prose: the hard safety constraints (draft-only, never push
 * to main, always clean up the worktree, target the configured repo) must hold
 * even if the model misreads its instructions, a tracker entry contains injected
 * text, or the model is updated. Encoding them here makes them non-negotiable.
 *
 * The repo is ALWAYS process.env.AUTO_IMPROVE_REPO (default dabowman/Figmagent) —
 * the same source Stage C uses — so the pipeline can never split across two repos.
 *
 * Subcommands:
 *   preflight <ID>            Verify exactly one OPEN issue exists for [ID] and no
 *                             auto-fix/<ID> branch or PR is already in flight.
 *                             Prints JSON { issueNumber } on success.
 *                             Exit 3 = skip (no open issue); 4 = skip (in flight).
 *   setup <ID>               git fetch + create worktree auto-fix/<ID> off
 *                             origin/main. Prints the worktree path. The model then
 *                             applies the plan and runs lint/test/build INSIDE it.
 *   publish <ID> --issue N --title T --summary S
 *                             Commit all changes in the worktree, push the branch,
 *                             open a DRAFT PR (base main), remove the worktree, and
 *                             comment the PR link on the issue. Prints the PR URL.
 *   abort <ID> [--issue N] [--reason R]
 *                             Remove the worktree + branch and (if --issue) comment
 *                             that auto-fix failed and needs manual work.
 *
 * Exit codes: 0 ok · 2 usage/precondition error · 3 skip:no-open-issue · 4 skip:in-flight.
 */

import { $ } from "bun";

const REPO = process.env.AUTO_IMPROVE_REPO || "dabowman/Figmagent";
const ID_RE = /^[A-Z]+-\d+$/;

function die(msg: string, code = 2): never {
	console.error(msg);
	process.exit(code);
}

function requireId(id: string | undefined): string {
	if (!id || !ID_RE.test(id)) die(`Expected an issue ID like TOOL-006, got: ${id ?? "(none)"}`);
	return id as string;
}

function worktreePath(id: string): string {
	return `.claude/worktrees/auto-fix-${id}`;
}

function branchName(id: string): string {
	return `auto-fix/${id}`;
}

// minimal flag parser: --key value  /  --key=value
function flags(argv: string[]): Record<string, string> {
	const out: Record<string, string> = {};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (!a.startsWith("--")) continue;
		const eq = a.indexOf("=");
		if (eq !== -1) {
			out[a.slice(2, eq)] = a.slice(eq + 1);
		} else {
			out[a.slice(2)] = argv[i + 1] ?? "";
			i++;
		}
	}
	return out;
}

async function preflight(id: string): Promise<void> {
	// Exactly one OPEN issue titled [ID] …
	const issuesJson =
		await $`gh issue list --repo ${REPO} --state open --search ${`[${id}]`} --json number,title`.text();
	const issues = JSON.parse(issuesJson) as Array<{ number: number; title: string }>;
	const matches = issues.filter((i) => i.title.includes(`[${id}]`));
	if (matches.length === 0) {
		die(`No open GitHub issue for [${id}] — Stage C will file it; act next run.`, 3);
	}
	if (matches.length > 1) {
		die(`Multiple open issues match [${id}] (${matches.map((m) => m.number).join(", ")}) — resolve manually.`, 2);
	}
	const issueNumber = matches[0].number;

	// No branch already on origin …
	const lsRemote = await $`git ls-remote --heads origin ${branchName(id)}`.text();
	if (lsRemote.trim() !== "") {
		die(`Branch ${branchName(id)} already exists on origin — already in flight.`, 4);
	}
	// … and no open PR from that head.
	const prJson = await $`gh pr list --repo ${REPO} --head ${branchName(id)} --json number`.text();
	if ((JSON.parse(prJson) as unknown[]).length > 0) {
		die(`A PR from ${branchName(id)} already exists — already in flight.`, 4);
	}

	console.log(JSON.stringify({ issueNumber }));
}

async function setup(id: string): Promise<void> {
	await $`git fetch -q origin`;
	const wt = worktreePath(id);
	// -b creates the branch; origin/main is the fixed base — never the current HEAD.
	await $`git worktree add -b ${branchName(id)} ${wt} origin/main`;
	console.log(wt);
}

async function publish(id: string, f: Record<string, string>): Promise<void> {
	const issue = f.issue;
	const title = f.title;
	const summary = f.summary;
	if (!issue || !/^\d+$/.test(issue)) die("publish requires --issue <number>");
	if (!title) die("publish requires --title <text>");
	if (!summary) die("publish requires --summary <text>");

	const wt = worktreePath(id);
	const branch = branchName(id);

	const commitMsg = `fix(${id}): ${title}

Closes #${issue}

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`;

	const prBody = `${summary}

Closes #${issue}

Auto-generated **draft** by the auto-improve pipeline (Stage D) from \`.claude/plans/\`.
Review before marking ready / merging.

🤖 Generated with [Claude Code](https://claude.com/claude-code)`;

	await $`git -C ${wt} add -A`;
	await $`git -C ${wt} -c commit.gpgsign=false commit -q -m ${commitMsg}`;
	await $`git -C ${wt} push -u origin ${branch}`;

	// --draft is non-negotiable; --base main, head is the auto-fix branch only.
	const url =
		await $`gh pr create --draft --repo ${REPO} --base main --head ${branch} --title ${`fix(${id}): ${title}`} --body ${prBody}`.text();
	const prUrl = url.trim();

	// Worktree's job is done — the branch lives on origin now.
	await $`git worktree remove --force ${wt}`;

	await $`gh issue comment ${issue} --repo ${REPO} --body ${`Draft fix PR opened by the auto-improve pipeline: ${prUrl}`}`;

	console.log(prUrl);
}

async function abort(id: string, f: Record<string, string>): Promise<void> {
	const wt = worktreePath(id);
	// Best-effort cleanup — don't let a missing worktree/branch fail the abort.
	await $`git worktree remove --force ${wt}`.nothrow();
	await $`git branch -D ${branchName(id)}`.nothrow();
	if (f.issue && /^\d+$/.test(f.issue)) {
		const reason = f.reason || "no reason given";
		await $`gh issue comment ${f.issue} --repo ${REPO} --body ${`Auto-fix (Stage D) aborted for [${id}] — ${reason}. Needs manual work.`}`;
	}
	console.log(`aborted ${id}`);
}

const [cmd, idArg, ...rest] = process.argv.slice(2);
const f = flags(rest);

switch (cmd) {
	case "preflight":
		await preflight(requireId(idArg));
		break;
	case "setup":
		await setup(requireId(idArg));
		break;
	case "publish":
		await publish(requireId(idArg), f);
		break;
	case "abort":
		await abort(requireId(idArg), f);
		break;
	default:
		die(`Unknown subcommand: ${cmd ?? "(none)"}. Use preflight | setup | publish | abort.`);
}
