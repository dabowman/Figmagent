/**
 * Reverse-sync decision for Stage C (INFRA-007 / #196).
 *
 * When a tracker entry wants its GitHub issue OPEN but the issue is CLOSED, the
 * sync used to print DRIFT every night. If the close came from a merged pull
 * request (`Closes #N` in a PR that landed), the tracker is what is stale, and
 * the fix is to rewrite that entry's Status to `implemented — PR #M (date)`.
 * A manual close with no merged PR still needs a human, so it stays DRIFT.
 *
 * This module is the pure part: issue state + timeline events → decision.
 * `sync-tracker-issues.ts` fetches the timeline with `gh api` and applies it.
 *
 * What the timeline exposes reliably: a `cross-referenced` event for every PR
 * whose body mentions the issue, with `source.issue.pull_request.merged_at`
 * populated once that PR merged. (A `closed` event may carry the merge's
 * `commit_id`, but it does not name the PR, so it is not enough on its own.)
 */

export interface TimelineEvent {
  event?: string;
  created_at?: string;
  commit_id?: string | null;
  source?: {
    type?: string;
    issue?: {
      number?: number;
      state?: string;
      pull_request?: { merged_at?: string | null } | null;
      repository?: { full_name?: string } | null;
    } | null;
  } | null;
}

export interface IssueState {
  state: string; // "open" | "closed"
  state_reason?: string | null; // "completed" | "not_planned" | "reopened" | null
}

export type ReverseDecision =
  | { action: "reverse"; pr: number; date: string; mergedAt: string }
  | { action: "drift"; reason: string }
  | { action: "none" };

export interface ReverseOptions {
  /** `owner/repo` — cross-references from other repositories are ignored when the event names one */
  repo?: string;
}

/** Merged PRs that reference the issue, newest merge first. */
export function mergedReferencingPRs(
  events: TimelineEvent[],
  opts: ReverseOptions = {},
): Array<{ pr: number; mergedAt: string }> {
  const out: Array<{ pr: number; mergedAt: string }> = [];
  const seen = new Set<number>();
  for (const ev of events) {
    if (ev?.event !== "cross-referenced") continue;
    const src = ev.source?.issue;
    if (!src || typeof src.number !== "number") continue;
    const mergedAt = src.pull_request?.merged_at;
    if (!mergedAt) continue;
    const from = src.repository?.full_name;
    if (opts.repo && from && from.toLowerCase() !== opts.repo.toLowerCase()) continue;
    if (seen.has(src.number)) continue;
    seen.add(src.number);
    out.push({ pr: src.number, mergedAt });
  }
  return out.sort((a, b) => b.mergedAt.localeCompare(a.mergedAt));
}

/**
 * Should a tracker entry that is still active flip to `implemented` because its
 * issue was closed by a merged PR?
 *
 *  - open issue → none (nothing to reconcile)
 *  - closed as `not_planned` → drift (a deliberate won't-fix is a human's call)
 *  - closed with a merged PR cross-referencing it → reverse, naming the newest
 *    merged PR and its merge date
 *  - closed otherwise → drift
 */
export function decideReverse(issue: IssueState, events: TimelineEvent[], opts: ReverseOptions = {}): ReverseDecision {
  if (issue.state.toLowerCase() !== "closed") return { action: "none" };
  if ((issue.state_reason ?? "").toLowerCase() === "not_planned") {
    return { action: "drift", reason: "closed as not_planned" };
  }
  const merged = mergedReferencingPRs(events, opts);
  const top = merged[0];
  if (!top) return { action: "drift", reason: "closed with no merged PR referencing it" };
  return { action: "reverse", pr: top.pr, date: top.mergedAt.slice(0, 10), mergedAt: top.mergedAt };
}

/** The Status value written back into the tracker. */
export function implementedStatus(pr: number, date: string): string {
  return `implemented — PR #${pr} (${date})`;
}

/** Parse `gh api --paginate` output: either one JSON array or several concatenated arrays. */
export function parseTimelineJson(text: string): TimelineEvent[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) {
      // `--slurp` yields an array of per-page arrays; a plain page is a flat array.
      return parsed.flatMap((p) => (Array.isArray(p) ? p : [p])) as TimelineEvent[];
    }
    return [];
  } catch {
    // Without --slurp, paginated pages arrive as `[...][...]`; split on the seam.
    const out: TimelineEvent[] = [];
    for (const chunk of trimmed.split(/\]\s*\[/)) {
      const body = chunk.replace(/^\[?/, "[").replace(/\]?$/, "]");
      try {
        const arr = JSON.parse(body) as unknown;
        if (Array.isArray(arr)) out.push(...(arr as TimelineEvent[]));
      } catch {
        // skip an unparsable page rather than fail the whole sync
      }
    }
    return out;
  }
}
