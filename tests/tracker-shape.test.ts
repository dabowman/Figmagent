// Guards the two tracker invariants `scripts/sync-tracker-issues.ts` and
// `/dispatch-fixes` depend on. Both were broken silently before INFRA-006:
// 44 entries sat after "## Metrics Over Time" where their Status was never
// read, and `Auto-fixable: yes` carried free prose the pattern gate can't use.

import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

const TRACKER = ".claude/analysis/improvement-tracker.md";
const PATTERNS = [
  "sync-to-async",
  "type-coercion",
  "missing-batch-tool",
  "description-only",
  "lint-scope-filter",
  "boundary-guard",
  "assertion",
];

const lines = readFileSync(TRACKER, "utf-8").split("\n");

describe("improvement tracker shape", () => {
  test("every `### [ID]` entry lives under Active Issues or Resolved Issues", () => {
    let heading = "(before the first heading)";
    const misplaced: string[] = [];
    for (const line of lines) {
      const h2 = line.match(/^## (.+)/);
      if (h2) {
        heading = (h2[1] ?? "").toLowerCase().trim();
        continue;
      }
      const h3 = line.match(/^### \[([A-Z]+-\d+)\]/);
      if (h3 && heading !== "active issues" && heading !== "resolved issues") {
        misplaced.push(`${h3[1]} under "## ${heading}"`);
      }
    }
    expect(misplaced).toEqual([]);
  });

  test("only the Resolved section matches the sync's resolved test", () => {
    // `startsWith("resolved")`, not `includes` — "## Unresolved Issues" would
    // otherwise classify as Resolved and auto-close everything under it.
    const headings = lines.flatMap(
      (l) =>
        l
          .match(/^## (.+)/)?.[1]
          ?.toLowerCase()
          .trim() ?? [],
    );
    expect(headings.filter((h) => h.startsWith("resolved"))).toEqual(["resolved issues"]);
  });

  test("every Auto-fixable line names a Phase 6 pattern or a reason", () => {
    const bad: string[] = [];
    for (const line of lines) {
      const m = line.match(/^- \*\*Auto-fixable\*\*:\s*(yes|no)\b\s*(.*)$/);
      if (!m) continue;
      const [, verdict, rest] = m;
      const token = (rest ?? "")
        .replace(/^\(/, "")
        .replace(/[`*]/g, "")
        .trim()
        .split(/[\s—)]/)[0];
      if (!token) bad.push(`bare "${verdict}" — ${line}`);
      else if (verdict === "yes" && !PATTERNS.includes(token)) bad.push(line);
    }
    expect(bad).toEqual([]);
  });
});
