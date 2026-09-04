// INFRA-007 / #196 — reverse-sync: a tracker entry still `identified`/`planned`
// whose GitHub issue was closed by a MERGED PR flips to `implemented — PR #M
// (date)` instead of printing DRIFT every night. A manual close stays DRIFT.

import { describe, expect, test } from "bun:test";
import {
  decideReverse,
  implementedStatus,
  mergedClosers,
  mergedReferencingPRs,
  parseTimelineJson,
  type TimelineEvent,
} from "../scripts/sync-reverse-lib.ts";

const REPO = "dabowman/Figmagent";

function xref(pr: number, mergedAt: string | null, repo = REPO, extra: Record<string, unknown> = {}): TimelineEvent {
  return {
    event: "cross-referenced",
    created_at: "2026-09-01T10:00:00Z",
    source: {
      type: "issue",
      issue: {
        number: pr,
        state: mergedAt ? "closed" : "open",
        pull_request: { merged_at: mergedAt },
        repository: { full_name: repo },
        ...extra,
      },
    },
  };
}
const closedEvent = (commit: string | null = null): TimelineEvent => ({
  event: "closed",
  created_at: "2026-09-02T03:00:00Z",
  commit_id: commit,
});
const comment = (): TimelineEvent => ({ event: "commented", created_at: "2026-09-01T09:00:00Z" });
const issueXref = (n: number): TimelineEvent => ({
  event: "cross-referenced",
  source: { type: "issue", issue: { number: n, state: "open", pull_request: null } },
});

describe("decideReverse", () => {
  test("closed by a merged PR → reverse with the PR number and merge date", () => {
    const d = decideReverse({ state: "closed", state_reason: "completed" }, [
      comment(),
      xref(201, "2026-09-02T02:58:11Z"),
      closedEvent("abc123"),
    ]);
    expect(d).toEqual({ action: "reverse", pr: 201, date: "2026-09-02", mergedAt: "2026-09-02T02:58:11Z" });
  });

  test("manual close with no merged PR stays drift", () => {
    expect(decideReverse({ state: "closed", state_reason: "completed" }, [comment(), closedEvent()])).toEqual({
      action: "drift",
      reason: "closed with no merged PR referencing it",
    });
  });

  test("an unmerged (open or closed-without-merge) PR does not count", () => {
    expect(decideReverse({ state: "closed" }, [xref(202, null), closedEvent()]).action).toBe("drift");
  });

  test("closed as not_planned is a human decision, never reversed even with a merged PR", () => {
    const d = decideReverse({ state: "closed", state_reason: "not_planned" }, [xref(203, "2026-09-02T00:00:00Z")]);
    expect(d).toEqual({ action: "drift", reason: "closed as not_planned" });
  });

  test("with GitHub's closer list, only a PR that actually closed the issue counts (a mere mention does not)", () => {
    const events = [
      xref(149, "2026-09-02T00:15:25Z"),
      xref(146, "2026-09-02T00:33:46Z"),
      xref(152, "2026-09-02T02:42:06Z"),
    ];
    // GraphQL closedByPullRequestsReferences says #146 closed it; #152 merged later and only mentions it.
    const d = decideReverse({ state: "closed", state_reason: "completed" }, events, { closers: [146] });
    expect(d).toEqual({ action: "reverse", pr: 146, date: "2026-09-02", mergedAt: "2026-09-02T00:33:46Z" });
    // No closer on record (a manual close, or a `Closes #n` GitHub did not honour) → drift, never a wrong PR.
    expect(decideReverse({ state: "closed", state_reason: "completed" }, events, { closers: [] })).toEqual({
      action: "drift",
      reason: "closed with no merged PR closing it",
    });
  });

  test("mergedClosers keeps only merged PR numbers from the GraphQL nodes", () => {
    expect(mergedClosers([{ number: 146, merged: true }, { number: 198, merged: false }, {}, null as never])).toEqual([
      146,
    ]);
    expect(mergedClosers(undefined)).toEqual([]);
  });

  test("an open issue needs nothing", () => {
    expect(decideReverse({ state: "open" }, [xref(204, "2026-09-02T00:00:00Z")])).toEqual({ action: "none" });
  });

  test("state comparison is case-insensitive (gh emits lower-case, the sync lower-cases too)", () => {
    expect(decideReverse({ state: "CLOSED" }, [xref(205, "2026-09-02T00:00:00Z")]).action).toBe("reverse");
  });

  test("a merged PR from another repository is ignored when the repo is given", () => {
    const d = decideReverse({ state: "closed" }, [xref(9, "2026-09-02T00:00:00Z", "someone/fork")], { repo: REPO });
    expect(d.action).toBe("drift");
    // …but counts when no repo filter is applied
    expect(decideReverse({ state: "closed" }, [xref(9, "2026-09-02T00:00:00Z", "someone/fork")]).action).toBe(
      "reverse",
    );
  });

  test("the newest merged PR wins when several reference the issue", () => {
    const d = decideReverse({ state: "closed" }, [
      xref(150, "2026-08-20T00:00:00Z"),
      xref(190, "2026-09-01T12:00:00Z"),
      xref(170, "2026-08-25T00:00:00Z"),
    ]);
    expect(d).toMatchObject({ action: "reverse", pr: 190, date: "2026-09-01" });
  });

  test("cross-references from plain issues (no pull_request) and malformed events are skipped", () => {
    const events: TimelineEvent[] = [
      issueXref(7),
      { event: "cross-referenced", source: null },
      { event: "cross-referenced" },
      {} as TimelineEvent,
    ];
    expect(decideReverse({ state: "closed" }, events).action).toBe("drift");
  });

  test("mergedReferencingPRs dedupes and sorts newest first", () => {
    const prs = mergedReferencingPRs([
      xref(1, "2026-01-01T00:00:00Z"),
      xref(2, "2026-02-01T00:00:00Z"),
      xref(1, "2026-01-01T00:00:00Z"),
    ]);
    expect(prs).toEqual([
      { pr: 2, mergedAt: "2026-02-01T00:00:00Z" },
      { pr: 1, mergedAt: "2026-01-01T00:00:00Z" },
    ]);
  });
});

describe("implementedStatus", () => {
  test("formats the Status value the tracker gets", () => {
    expect(implementedStatus(201, "2026-09-02")).toBe("implemented — PR #201 (2026-09-02)");
  });
});

describe("parseTimelineJson", () => {
  test("a flat array", () => {
    expect(parseTimelineJson('[{"event":"closed"}]')).toEqual([{ event: "closed" }]);
  });
  test("--slurp output (array of pages)", () => {
    expect(parseTimelineJson('[[{"event":"a"}],[{"event":"b"}]]')).toEqual([{ event: "a" }, { event: "b" }]);
  });
  test("concatenated pages without --slurp", () => {
    expect(parseTimelineJson('[{"event":"a"}][{"event":"b"}]')).toEqual([{ event: "a" }, { event: "b" }]);
  });
  test("empty or garbage input is an empty timeline, not a crash", () => {
    expect(parseTimelineJson("")).toEqual([]);
    expect(parseTimelineJson("not json")).toEqual([]);
    expect(parseTimelineJson('{"message":"Not Found"}')).toEqual([]);
  });
});
