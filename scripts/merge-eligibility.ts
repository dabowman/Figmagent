/**
 * Merge eligibility for Stage E (merge-queue) of the auto-improve pipeline.
 *
 * Pure + side-effect free: `scripts/merge-queue.ts` gathers a PullRequest from
 * `gh`, computes the CI status of the exact head SHA, and calls `evaluate` —
 * once when listing the queue and AGAIN on the refetched head immediately before
 * any irreversible action. Every failed rule appends a human-readable reason so
 * the run record and the reviewer see exactly why a PR was skipped.
 *
 * A PR that touches a protected path (see `scripts/protected-paths.ts`) is
 * `humanOnly` and is never eligible, whatever else it passes: the pipeline may
 * propose changes to its own gates but never merge them.
 */

import { protectedPathsIn } from "./protected-paths.ts";

/** Maximum PRs the queue merges in one run. */
export const MERGE_CAP = 6;
/** Diff-size ceiling: pipeline PRs are small by construction. */
export const MAX_CHANGED_LINES = 400;
export const MAX_CHANGED_FILES = 10;
/** Label a human adds to opt a PR into the queue. */
export const AUTO_MERGE_LABEL = "auto-merge";
/** Labels that take a PR out of the queue. */
export const EXCLUDE_LABELS: readonly string[] = ["hold", "needs-human"];
/** Heads produced by the pipeline itself (Stage D) or by the `claude` issue label workflow. */
export const PIPELINE_HEAD_RE = /^(auto-fix\/|claude\/issue-)/;
/** `[TOOL-006]` or `fix(TOOL-006):` in a PR title — the tracker ID the PR implements. */
export const TRACKER_ID_IN_TITLE_RE = /\[([A-Z]+-\d+)\]|^[a-z]+\(([A-Z]+-\d+)\)/;

export type CiStatus = "success" | "failure" | "pending" | "none";

export interface PullRequest {
  number: number;
  title: string;
  draft: boolean;
  headRef: string;
  baseRef: string;
  headSha: string;
  labels: string[];
  /** true = MERGEABLE, false = CONFLICTING, null = GitHub has not computed it yet. */
  mergeable: boolean | null;
  /** GitHub's mergeStateStatus, lower-cased (clean, blocked, behind, dirty, unstable, unknown, draft). */
  mergeableState: string;
  changedFiles: string[];
  additions: number;
  deletions: number;
  author: string;
  /** ISO timestamp; used only for queue ordering (oldest first). */
  createdAt?: string;
  body?: string;
}

export interface EligibilityContext {
  /** CI verdict for `pr.headSha` — the `check` job of workflow `CI`. */
  ci: CiStatus;
  /** PRs already merged by this run. */
  mergedThisRun: number;
  /** Override the daily cap (default MERGE_CAP). */
  mergeCap?: number;
  /** Clock, so reasons can say when a pending check was observed. */
  now?: Date;
}

export interface Eligibility {
  eligible: boolean;
  /** True when the PR touches a protected path — listed, commented on, never merged. */
  humanOnly: boolean;
  reasons: string[];
}

export function isPipelineHead(headRef: string): boolean {
  return PIPELINE_HEAD_RE.test(headRef);
}

export function trackerIdFromTitle(title: string): string | undefined {
  const m = title.match(TRACKER_ID_IN_TITLE_RE);
  return m?.[1] ?? m?.[2];
}

export function evaluate(pr: PullRequest, ctx: EligibilityContext): Eligibility {
  const reasons: string[] = [];
  const cap = ctx.mergeCap ?? MERGE_CAP;
  const now = ctx.now ?? new Date();
  const labels = pr.labels.map((l) => l.toLowerCase());
  const optedIn = labels.includes(AUTO_MERGE_LABEL);

  if (pr.baseRef !== "main") {
    reasons.push(`base is ${pr.baseRef}, not main`);
  }

  if (!isPipelineHead(pr.headRef) && !optedIn) {
    reasons.push(`head ${pr.headRef} is not auto-fix/* or claude/issue-* and carries no ${AUTO_MERGE_LABEL} label`);
  }

  if (pr.draft && !isPipelineHead(pr.headRef)) {
    reasons.push("draft PR from a human head — mark it ready before labeling it auto-merge");
  }

  for (const label of EXCLUDE_LABELS) {
    if (labels.includes(label)) reasons.push(`labeled ${label}`);
  }

  if (ctx.ci !== "success") {
    const at = now.toISOString();
    const detail =
      ctx.ci === "none"
        ? `no CI check run found for head ${pr.headSha}`
        : `CI is ${ctx.ci} for head ${pr.headSha} (observed ${at})`;
    reasons.push(detail);
  }

  if (pr.mergeable !== true) {
    const state = pr.mergeableState ? ` (${pr.mergeableState})` : "";
    reasons.push(pr.mergeable === null ? `mergeability not yet computed by GitHub${state}` : `not mergeable${state}`);
  }

  const changedLines = pr.additions + pr.deletions;
  if (changedLines > MAX_CHANGED_LINES) {
    reasons.push(`${changedLines} changed lines exceeds the ${MAX_CHANGED_LINES}-line cap`);
  }
  if (pr.changedFiles.length > MAX_CHANGED_FILES) {
    reasons.push(`${pr.changedFiles.length} changed files exceeds the ${MAX_CHANGED_FILES}-file cap`);
  }

  const protectedHits = protectedPathsIn(pr.changedFiles);
  const humanOnly = protectedHits.length > 0;
  if (humanOnly) {
    reasons.push(`touches protected path(s): ${protectedHits.join(", ")} — human-only, never auto-merged`);
  }

  if (ctx.mergedThisRun >= cap) {
    reasons.push(`merge cap reached (${ctx.mergedThisRun}/${cap} this run)`);
  }

  return { eligible: reasons.length === 0 && !humanOnly, humanOnly, reasons };
}

export type Priority = "P0" | "P1" | "P2" | "P3";

const PRIORITY_RANK: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };

/**
 * Queue order: PRs whose title carries a tracker ID first (P0 before P1 before
 * P2 when `priorityById` knows the entry; unknown IDs after known ones), then
 * everything else; oldest first within a tier; PR number as the final tiebreak
 * so the order is stable across runs.
 */
export function orderQueue<T extends Pick<PullRequest, "number" | "title" | "createdAt">>(
  prs: readonly T[],
  priorityById: ReadonlyMap<string, Priority | string> = new Map(),
): T[] {
  const key = (pr: T): [number, number, number, number] => {
    const id = trackerIdFromTitle(pr.title);
    const tier = id ? 0 : 1;
    const priority = id ? (PRIORITY_RANK[(priorityById.get(id) ?? "").toUpperCase()] ?? 9) : 9;
    const created = pr.createdAt ? Date.parse(pr.createdAt) : Number.MAX_SAFE_INTEGER;
    return [tier, priority, Number.isNaN(created) ? Number.MAX_SAFE_INTEGER : created, pr.number];
  };
  return [...prs].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    for (let i = 0; i < ka.length; i++) {
      if (ka[i] !== kb[i]) return (ka[i] as number) - (kb[i] as number);
    }
    return 0;
  });
}

/** Shape of one entry in the GitHub `check-runs` API (only the fields we read). */
export interface CheckRunLike {
  name?: string;
  head_sha?: string;
  status?: string; // queued | in_progress | completed
  conclusion?: string | null; // success | failure | neutral | cancelled | skipped | timed_out | action_required
  completed_at?: string | null;
  started_at?: string | null;
}

/**
 * Reduce the check runs of ONE commit to a CiStatus for the named job. Re-runs
 * produce several entries with the same name; the most recently started wins.
 * `neutral`/`skipped` count as failure: the queue merges only on a green check.
 */
export function ciStatusFromCheckRuns(runs: readonly CheckRunLike[], jobName: string, headSha?: string): CiStatus {
  const ours = runs.filter((r) => r.name === jobName && (!headSha || !r.head_sha || r.head_sha === headSha));
  if (ours.length === 0) return "none";
  const latest = [...ours].sort((a, b) => {
    const ta = Date.parse(a.started_at ?? a.completed_at ?? "") || 0;
    const tb = Date.parse(b.started_at ?? b.completed_at ?? "") || 0;
    return tb - ta;
  })[0] as CheckRunLike;
  if (latest.status !== "completed") return "pending";
  return latest.conclusion === "success" ? "success" : "failure";
}
