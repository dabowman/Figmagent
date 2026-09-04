// scripts/tracker-parse.ts — the one tracker/plan parser every pipeline stage
// shares. The parity block at the end pins `parseTracker` against a verbatim
// copy of the parser that lived inline in scripts/sync-tracker-issues.ts, over
// the real tracker, because Stage C's create/close decisions ride on it.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  autoFixable,
  decisionDates,
  entryText,
  firstPatternToken,
  parsePlan,
  parseTracker,
  parseTrackerFull,
  planFileFor,
  planFileMatchesId,
  statusToken,
  updateEntryField,
} from "../scripts/tracker-parse.ts";

const FIXTURE = `# Tracker

Last updated: 2026-09-02

## Active Issues

### [TOOL-001] Batch bind — [#12](https://github.com/o/r/issues/12)
- **Status**: identified
- **Priority**: P1
- **Category**: missing-batch-tool
- **Description**: many calls.
- **Auto-fixable**: no (outside the sync-to-async / type-coercion / missing-batch-tool allowlist)

### [BUG-002] Raw throw on null node
- **Status**: planned
- **Priority**: P0
- **Category**: plugin-bug
- **Issue**: #34
- **Auto-fixable**: yes (\`boundary-guard\` — at the entry point)
- **Decision (2026-09-02)**: guard it. Recorded on [#34](https://github.com/o/r/issues/34).

### [AGENT-003] Old entry with no verdict line
- **Status**: identified
- **Priority**: P2
- **Category**: agent-behavior

### [TOOL-004] Re-activated work
- **Status**: identified
- **Priority**: P1
- **Category**: missing-tool

## Resolved Issues

### [TOOL-004] Re-activated work
- **Resolved in**: Session 2

### [BUG-005] Only in resolved
- **Resolved in**: Session 3

## Metrics Over Time

| a | b |
`;

describe("parseTracker", () => {
  const entries = parseTracker(FIXTURE);
  const byId = new Map(entries.map((e) => [e.id, e]));

  test("dedupes IDs and keeps the active occurrence's status authoritative", () => {
    expect(entries.map((e) => e.id)).toEqual(["TOOL-001", "BUG-002", "AGENT-003", "TOOL-004", "BUG-005"]);
    const t4 = byId.get("TOOL-004");
    expect(t4?.activeStatus).toBe("identified");
    expect(t4?.inResolved).toBe(true);
    expect(t4?.resolved).toBe(false); // stale Resolved recap never closes re-activated work
  });

  test("an ID that appears only under Resolved is resolved", () => {
    const b5 = byId.get("BUG-005");
    expect(b5?.activeStatus).toBeUndefined();
    expect(b5?.resolved).toBe(true);
    expect(b5?.resolvedReason).toBe("listed under Resolved Issues");
  });

  test("header issue link and structured Issue field both resolve issueRef", () => {
    expect(byId.get("TOOL-001")?.issueRef).toBe(12);
    expect(byId.get("TOOL-001")?.cleanTitle).toBe("Batch bind");
    expect(byId.get("TOOL-001")?.fullTitle).toBe("[TOOL-001] Batch bind");
    expect(byId.get("BUG-002")?.issueRef).toBe(34);
    expect(byId.get("AGENT-003")?.issueRef).toBeUndefined();
  });

  test("priority, category, body", () => {
    const b2 = byId.get("BUG-002");
    expect(b2?.priority).toBe("P0");
    expect(b2?.category).toBe("plugin-bug");
    expect(b2?.body.startsWith("- **Status**: planned")).toBe(true);
    expect(b2?.body.endsWith("issues/34).")).toBe(true);
  });

  test("resolution statuses count as resolved", () => {
    const text = FIXTURE.replace("- **Status**: planned", "- **Status**: implemented — PR #3 (2026-09-01)");
    const b2 = parseTracker(text).find((e) => e.id === "BUG-002");
    expect(b2?.resolved).toBe(true);
    expect(b2?.resolvedReason).toBe("status: implemented — PR #3 (2026-09-01)");
  });

  test("misplaced entries and only a heading starting with Resolved is the Resolved section", () => {
    const text = `## Unresolved Issues\n\n### [X-1] Not resolved\n- **Status**: identified\n\n## Metrics Over Time\n\n### [Y-2] Lost entry\n- **Status**: implemented\n`;
    const parsed = parseTrackerFull(text);
    const x = parsed.entries.find((e) => e.id === "X-1");
    expect(x?.resolved).toBe(false);
    expect(x?.activeStatus).toBe("identified");
    // Status under a non-Resolved heading IS read (Y-2 is implemented ⇒ resolved)
    expect(parsed.entries.find((e) => e.id === "Y-2")?.resolved).toBe(true);
    expect([...parsed.misplaced.entries()]).toEqual([
      ["X-1", "unresolved issues"],
      ["Y-2", "metrics over time"],
    ]);
  });

  test("the same ID with a materially different title is a collision", () => {
    const text = `## Active Issues\n\n### [A-1] One thing\n- **Status**: identified\n\n### [A-1] Something else entirely\n- **Status**: identified\n`;
    expect([...parseTrackerFull(text).collisions]).toEqual(["A-1"]);
  });
});

describe("entry field helpers", () => {
  const entries = parseTracker(FIXTURE);
  const byId = new Map(entries.map((e) => [e.id, e]));

  test("autoFixable reads yes (pattern) with backticks and qualifiers stripped", () => {
    expect(autoFixable(byId.get("BUG-002") as never)).toEqual({ verdict: "yes", pattern: "boundary-guard" });
  });
  test("autoFixable reads no (reason) verbatim", () => {
    expect(autoFixable(byId.get("TOOL-001") as never)).toEqual({
      verdict: "no",
      reason: "outside the sync-to-async / type-coercion / missing-batch-tool allowlist",
    });
  });
  test("autoFixable is undefined when the line is absent", () => {
    expect(autoFixable(byId.get("AGENT-003") as never)).toEqual({ verdict: undefined });
  });
  test("firstPatternToken", () => {
    expect(firstPatternToken("`type-coercion` (string normalization)")).toBe("type-coercion");
    expect(firstPatternToken("`assertion` — docs ship in the same change")).toBe("assertion");
    expect(firstPatternToken("(boundary-guard)")).toBe("boundary-guard");
    expect(firstPatternToken("P2 — not auto-dispatched")).toBe("P2");
    expect(firstPatternToken("")).toBeUndefined();
  });
  test("decisionDates", () => {
    expect(decisionDates(byId.get("BUG-002") as never)).toEqual(["2026-09-02"]);
    expect(decisionDates(byId.get("TOOL-001") as never)).toEqual([]);
  });
  test("statusToken", () => {
    expect(statusToken("implemented — PR #3 (2026-09-01)")).toBe("implemented");
    expect(statusToken("Planned")).toBe("planned");
    expect(statusToken(undefined)).toBe("");
  });
  test("entryText returns the active occurrence, heading included", () => {
    const t = entryText(FIXTURE, "TOOL-004");
    expect(t?.split("\n")[0]).toBe("### [TOOL-004] Re-activated work");
    expect(t).toContain("- **Status**: identified");
    expect(entryText(FIXTURE, "BUG-005")).toContain("- **Resolved in**: Session 3");
    expect(entryText(FIXTURE, "NOPE-9")).toBeUndefined();
  });
});

describe("updateEntryField", () => {
  test("replaces the field line on the active occurrence and touches nothing else", () => {
    const out = updateEntryField(FIXTURE, "BUG-002", "Status", "implemented — PR #40 (2026-09-03)");
    const diff = out.split("\n").filter((l, i) => l !== FIXTURE.split("\n")[i]);
    expect(diff).toEqual(["- **Status**: implemented — PR #40 (2026-09-03)"]);
    expect(out.length - FIXTURE.length).toBe("implemented — PR #40 (2026-09-03)".length - "planned".length);
  });

  test("targets the active occurrence when the ID also sits under Resolved", () => {
    const out = updateEntryField(FIXTURE, "TOOL-004", "Status", "verified");
    const activeIdx = out.indexOf("### [TOOL-004]");
    const resolvedIdx = out.indexOf("## Resolved Issues");
    const statusIdx = out.indexOf("- **Status**: verified");
    expect(statusIdx).toBeGreaterThan(activeIdx);
    expect(statusIdx).toBeLessThan(resolvedIdx);
    // the Resolved recap is untouched
    expect(out.slice(resolvedIdx)).toBe(FIXTURE.slice(FIXTURE.indexOf("## Resolved Issues")));
  });

  test("inserts after the Status line when the field is absent", () => {
    const out = updateEntryField(FIXTURE, "AGENT-003", "Auto-fixable", "no (mixed: design work)");
    const lines = out.split("\n");
    const i = lines.indexOf("### [AGENT-003] Old entry with no verdict line");
    expect(lines[i + 1]).toBe("- **Status**: identified");
    expect(lines[i + 2]).toBe("- **Auto-fixable**: no (mixed: design work)");
    expect(lines[i + 3]).toBe("- **Priority**: P2");
    expect(lines.length).toBe(FIXTURE.split("\n").length + 1);
  });

  test("inserts directly under the heading when there is no Status line", () => {
    const out = updateEntryField(FIXTURE, "BUG-005", "Status", "verified");
    const lines = out.split("\n");
    const i = lines.indexOf("### [BUG-005] Only in resolved");
    expect(lines[i + 1]).toBe("- **Status**: verified");
    expect(lines[i + 2]).toBe("- **Resolved in**: Session 3");
  });

  test("unknown ID returns the text unchanged", () => {
    expect(updateEntryField(FIXTURE, "ZZZ-999", "Status", "x")).toBe(FIXTURE);
  });

  test("does not match a longer ID with the same prefix", () => {
    const text = "## Active Issues\n\n### [T-10] Ten\n- **Status**: a\n\n### [T-1] One\n- **Status**: b\n";
    const out = updateEntryField(text, "T-1", "Status", "c");
    expect(out).toContain("### [T-10] Ten\n- **Status**: a");
    expect(out).toContain("### [T-1] One\n- **Status**: c");
  });
});

describe("parsePlan", () => {
  const PLAN = `# Fix: [TOOL-040] Something

**Pattern**: \`boundary-guard\` — the docs half inherits this gate
**Priority**: P1
**Estimated savings**: ~3 calls

## Changes

### File: \`src/figma_plugin/src/remote_entries/stdlib.js\`

\`\`\`js
### File: \`not/a/real/heading.js\`
- Line 1: \`inside fence\` → \`ignored\`
\`\`\`

- Line 12: \`createNode: (spec, parentId) => create({ tree: spec })\` → \`createNode: (spec, parentId) => create({ tree: spec }).then(unwrap)\`

### File: \`src/figmagent_mcp/tools/script.ts\` — the write-mode postlude
- Line 40: \`old line\` -> \`new line\`

### File: \`tests/combine-as-variants.test.ts\` (create it — TOOL-047's plan also names this file)

Some prose.

## Verification
- [ ] Run \`bun run lint\`
- [ ] Run \`bun run test\` — \`tests/assertions.test.ts\` "[BUG-040] checkMissingFontWidth" fails without the new export
- [ ] Run \`bun run build:plugin\`
`;

  test("header, files, snippets, created files, named test", () => {
    const p = parsePlan(PLAN);
    expect(p.pattern).toBe("boundary-guard");
    expect(p.priority).toBe("P1");
    expect(p.partial).toBe(false);
    expect(p.files).toEqual([
      "src/figma_plugin/src/remote_entries/stdlib.js",
      "src/figmagent_mcp/tools/script.ts",
      "tests/combine-as-variants.test.ts",
    ]);
    expect(p.createdFiles).toEqual(["tests/combine-as-variants.test.ts"]);
    expect(p.snippets).toEqual([
      {
        file: "src/figma_plugin/src/remote_entries/stdlib.js",
        line: 12,
        old: "createNode: (spec, parentId) => create({ tree: spec })",
        new: "createNode: (spec, parentId) => create({ tree: spec }).then(unwrap)",
      },
      { file: "src/figmagent_mcp/tools/script.ts", line: 40, old: "old line", new: "new line" },
    ]);
    expect(p.namedTest).toBe("tests/assertions.test.ts");
  });

  test("plain (unbackticked) pattern, Partial, bare test file name, no files", () => {
    const p = parsePlan(
      "**Pattern**: type-coercion\n**Priority**: P2 — for a person\n**Partial**: yes — half of it\n\n## Verification\n- [ ] Run `bun run test` — the new `run-script.test.ts` case fails without it\n",
    );
    expect(p.pattern).toBe("type-coercion");
    expect(p.priority).toBe("P2");
    expect(p.partial).toBe(true);
    expect(p.files).toEqual([]);
    expect(p.namedTest).toBe("tests/run-script.test.ts");
  });

  test("absent fields are undefined, not empty strings", () => {
    const p = parsePlan("# Fix: [X-1] no header\n\n## Verification\n- [ ] `bun run test`\n");
    expect(p.pattern).toBeUndefined();
    expect(p.priority).toBeUndefined();
    expect(p.namedTest).toBeUndefined();
    expect(p.partial).toBe(false);
  });

  test("planFileMatchesId / planFileFor", () => {
    expect(planFileMatchesId("2026-09-02-TOOL-040.md", "TOOL-040")).toBe(true);
    expect(planFileMatchesId("2026-09-02-TOOL-0400.md", "TOOL-040")).toBe(false);
    expect(planFileMatchesId("2026-09-02-XTOOL-040.md", "TOOL-040")).toBe(false);
    expect(planFileMatchesId("2026-09-02-TOOL-040.txt", "TOOL-040")).toBe(false);
    expect(planFileFor("TOOL-040", ["2026-01-01-TOOL-040.md", "2026-09-02-TOOL-040.md", "x.md"])).toBe(
      "2026-09-02-TOOL-040.md",
    );
    expect(planFileFor("TOOL-041", ["2026-09-02-TOOL-040.md"])).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Parity with the parser that used to live inline in sync-tracker-issues.ts
// ---------------------------------------------------------------------------

interface LegacyIssue {
  id: string;
  cleanTitle: string;
  fullTitle: string;
  priority: string;
  category: string;
  body: string;
  issueRef?: number;
  activeStatus?: string;
  inResolved: boolean;
  resolved: boolean;
  resolvedReason: string;
}

// Verbatim copy of the pre-refactor inline parser (sync-tracker-issues.ts).
function legacyParse(raw: string): { entries: LegacyIssue[]; misplaced: Map<string, string>; collisions: Set<string> } {
  const isResolutionStatus = (s: string): boolean => /^(verified|resolved|implemented)\b/i.test(s);
  const headerIssueRef = (titleLine: string): number | undefined => {
    const m = titleLine.match(/\/issues\/(\d+)/);
    return m?.[1] ? Number.parseInt(m[1], 10) : undefined;
  };
  const lines = raw.split("\n");
  const byId = new Map<string, LegacyIssue>();
  const collisions = new Set<string>();
  const normTitle = (s: string): string => s.toLowerCase().replace(/[`*_]/g, "").replace(/\s+/g, " ").trim();
  let section: "active" | "resolved" = "active";
  let heading = "";
  const misplaced = new Map<string, string>();
  let curId = "";
  let curTitleLine = "";
  let curStatus = "";
  let curPriority = "";
  let curCategory = "";
  let curIssue: number | undefined;
  let bodyLines: string[] = [];
  const KNOWN_SECTIONS = new Set(["active issues", "resolved issues"]);
  const commit = (): void => {
    if (!curId) return;
    if (!KNOWN_SECTIONS.has(heading)) misplaced.set(curId, heading || "(before the first heading)");
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
        activeStatus: section === "active" && curStatus ? curStatus : undefined,
        inResolved: section === "resolved",
        resolved: false,
        resolvedReason: "",
      });
    } else {
      if (normTitle(cleanTitle) !== normTitle(existing.cleanTitle)) collisions.add(curId);
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
      heading = (h2[1] ?? "").toLowerCase().trim();
      section = heading.startsWith("resolved") ? "resolved" : "active";
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
      const iss = line.match(/^- \*\*Issue\*\*:\s*#?(\d+)/);
      if (iss?.[1]) curIssue = Number.parseInt(iss[1], 10);
    }
  }
  commit();
  for (const t of byId.values()) {
    if (t.activeStatus !== undefined) {
      t.resolved = isResolutionStatus(t.activeStatus);
      t.resolvedReason = t.resolved ? `status: ${t.activeStatus}` : "";
    } else {
      t.resolved = t.inResolved;
      t.resolvedReason = t.inResolved ? "listed under Resolved Issues" : "";
    }
  }
  return { entries: [...byId.values()], misplaced, collisions };
}

describe("parity with the sync script's original inline parser", () => {
  const real = readFileSync(join(import.meta.dir, "..", ".claude/analysis/improvement-tracker.md"), "utf-8");
  for (const [name, text] of [
    ["fixture", FIXTURE],
    ["real tracker", real],
  ] as const) {
    test(`${name}: entries, misplaced and collisions are identical`, () => {
      const a = legacyParse(text);
      const b = parseTrackerFull(text);
      expect(b.entries).toEqual(a.entries);
      expect([...b.misplaced.entries()]).toEqual([...a.misplaced.entries()]);
      expect([...b.collisions]).toEqual([...a.collisions]);
      if (name === "real tracker") expect(b.entries.length).toBeGreaterThan(0);
    });
  }
});
