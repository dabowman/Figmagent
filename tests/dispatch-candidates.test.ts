// WS1.3 — Stage D's candidate gate in code. Each rule of
// `.claude/commands/dispatch-fixes.md` constraints 1–4 and step 1 has a case.

import { describe, expect, test } from "bun:test";
import { checkSteps, eligibility, selectCandidates, staleItems } from "../scripts/dispatch-candidates-lib.ts";
import { parsePlan, parseTracker, type TrackerEntry } from "../scripts/tracker-parse.ts";

interface EntrySpec {
  id: string;
  status?: string;
  priority?: string;
  fixable?: string; // the Auto-fixable line value, e.g. "yes (assertion)"
  issue?: number;
}

function tracker(specs: EntrySpec[], resolvedIds: string[] = []): TrackerEntry[] {
  const active = specs
    .map((s) => {
      const lines = [`### [${s.id}] Title for ${s.id}`];
      if (s.status) lines.push(`- **Status**: ${s.status}`);
      if (s.priority) lines.push(`- **Priority**: ${s.priority}`);
      lines.push("- **Category**: x");
      if (s.issue) lines.push(`- **Issue**: #${s.issue}`);
      if (s.fixable) lines.push(`- **Auto-fixable**: ${s.fixable}`);
      return lines.join("\n");
    })
    .join("\n\n");
  const resolved = resolvedIds.map((id) => `### [${id}] Resolved ${id}\n- **Resolved in**: x`).join("\n\n");
  return parseTracker(`## Active Issues\n\n${active}\n\n## Resolved Issues\n\n${resolved}\n`);
}

function plan(
  id: string,
  pattern: string | undefined,
  files: string[],
  extra = "",
): {
  id: string;
  path: string;
  parsed: ReturnType<typeof parsePlan>;
} {
  const header = pattern === undefined ? "" : `**Pattern**: \`${pattern}\`\n`;
  // A plan must name at least one `### File:` to be dispatchable; tests that do
  // not care which file get a placeholder (pass files explicitly to test scope).
  const named = files.length > 0 ? files : [`src/${id.toLowerCase()}.ts`];
  const text = `# Fix: [${id}]\n\n${header}**Priority**: P1\n${extra}\n## Changes\n\n${named
    .map((f) => `### File: \`${f}\`\n- Line 1: \`a\` → \`b\`\n`)
    .join("\n")}\n## Verification\n- [ ] Run \`bun run test\` — \`tests/${id.toLowerCase()}.test.ts\`\n`;
  return { id, path: `.claude/plans/2026-09-02-${id}.md`, parsed: parsePlan(text) };
}

describe("eligibility — per-entry rules", () => {
  const good = tracker([{ id: "BUG-001", status: "planned", priority: "P1", fixable: "yes (boundary-guard)" }])[0];
  const goodPlan = plan("BUG-001", "boundary-guard", ["src/a.js"]);

  test("a planned P1 boundary-guard with a plan is a candidate", () => {
    expect(eligibility(good as TrackerEntry, goodPlan)).toEqual({
      id: "BUG-001",
      priority: "P1",
      pattern: "boundary-guard",
      plan: ".claude/plans/2026-09-02-BUG-001.md",
      files: ["src/a.js"],
      status: "planned",
      issue: undefined,
      namedTest: "tests/bug-001.test.ts",
    });
  });

  test("rule 1: Auto-fixable must be yes", () => {
    const [no, missing] = tracker([
      { id: "A-1", status: "planned", priority: "P1", fixable: "no (mixed)" },
      { id: "A-2", status: "planned", priority: "P1" },
    ]);
    expect(eligibility(no as TrackerEntry, goodPlan)).toMatchObject({ reason: "Auto-fixable is not yes (no)" });
    expect(eligibility(missing as TrackerEntry, goodPlan)).toMatchObject({
      reason: "Auto-fixable is not yes (missing)",
    });
  });

  test("rule 4: status must be identified or planned", () => {
    const [impl, verified] = tracker([
      { id: "A-1", status: "implemented — PR #3", priority: "P1", fixable: "yes (assertion)" },
      { id: "A-2", status: "verified", priority: "P1", fixable: "yes (assertion)" },
    ]);
    expect(eligibility(impl as TrackerEntry, plan("A-1", "assertion", []))).toMatchObject({
      reason: "status is implemented",
    });
    expect(eligibility(verified as TrackerEntry, plan("A-2", "assertion", []))).toMatchObject({
      reason: "status is verified",
    });
  });

  test("an entry that only appears under Resolved is skipped", () => {
    const entries = tracker([], ["R-1"]);
    const r = entries[0] as TrackerEntry;
    r.body = "- **Auto-fixable**: yes (assertion)"; // even if a stale verdict line survives
    expect(eligibility(r, plan("R-1", "assertion", []))).toMatchObject({
      reason: "appears only under Resolved Issues",
    });
  });

  test("rule 3: plan must exist and carry an allowlisted pattern; the plan's pattern wins", () => {
    const e = tracker([
      { id: "T-1", status: "planned", priority: "P1", fixable: "yes (type-coercion)" },
    ])[0] as TrackerEntry;
    expect(eligibility(e, undefined)).toMatchObject({ reason: "no plan file in .claude/plans/" });
    expect(eligibility(e, plan("T-1", undefined, []))).toMatchObject({
      reason: ".claude/plans/2026-09-02-T-1.md has no **Pattern** line".replace(/^/, "plan "),
    });
    expect(eligibility(e, plan("T-1", "missing-batch-tool", []))).toMatchObject({
      reason: "pattern missing-batch-tool is never auto-dispatched",
    });
    expect(eligibility(e, plan("T-1", "refactor", []))).toMatchObject({
      reason: "pattern refactor is not on the dispatch allowlist",
    });
    // tracker says type-coercion, plan says description-only → description-only
    expect(eligibility(e, plan("T-1", "description-only", []))).toMatchObject({ pattern: "description-only" });
  });

  test("a plan with no `### File:` section is skipped — nothing to apply verbatim or scope", () => {
    const e = tracker([{ id: "T-1", status: "planned", priority: "P1", fixable: "yes (boundary-guard)" }])[0];
    const prose = {
      id: "T-1",
      path: ".claude/plans/2026-09-02-T-1.md",
      parsed: parsePlan(
        "# Fix: [T-1]\n\n**Pattern**: `boundary-guard`\n**Priority**: P1\n\n- `src/a.js`: add a guard\n",
      ),
    };
    expect(eligibility(e as TrackerEntry, prose)).toMatchObject({
      reason: "plan .claude/plans/2026-09-02-T-1.md names no `### File:` section — nothing to apply verbatim",
    });
  });

  test("Partial plans are skipped", () => {
    const e = tracker([{ id: "T-1", status: "planned", priority: "P1", fixable: "yes (boundary-guard)" }])[0];
    const p = plan("T-1", "boundary-guard", ["src/a.js"], "**Partial**: yes — half\n");
    expect(eligibility(e as TrackerEntry, p)).toMatchObject({ reason: "plan is marked Partial" });
  });

  test("rule 2: P2 dispatches only for description-only / lint-scope-filter", () => {
    const mk = (fixable: string) =>
      tracker([{ id: "T-1", status: "identified", priority: "P2", fixable }])[0] as TrackerEntry;
    expect(eligibility(mk("yes (boundary-guard)"), plan("T-1", "boundary-guard", []))).toMatchObject({
      reason: "priority P2 is below the floor for boundary-guard",
    });
    expect(eligibility(mk("yes (sync-to-async)"), plan("T-1", "sync-to-async", []))).toMatchObject({
      reason: "priority P2 is below the floor for sync-to-async",
    });
    expect(eligibility(mk("yes (description-only)"), plan("T-1", "description-only", []))).toMatchObject({
      priority: "P2",
      pattern: "description-only",
    });
    expect(eligibility(mk("yes (lint-scope-filter)"), plan("T-1", "lint-scope-filter", []))).toMatchObject({
      priority: "P2",
    });
  });

  test("a missing tracker priority falls back to the plan's; neither → skipped", () => {
    const e = tracker([{ id: "T-1", status: "planned", fixable: "yes (assertion)" }])[0] as TrackerEntry;
    expect(eligibility(e, plan("T-1", "assertion", []))).toMatchObject({ priority: "P1" });
    const p = plan("T-1", "assertion", []);
    p.parsed.priority = undefined;
    expect(eligibility(e, p)).toMatchObject({ reason: "priority missing is not P0/P1/P2" });
  });
});

describe("selectCandidates — ordering, caps, collisions", () => {
  test("sorts by priority then lowest issue number then ID, caps at 4 and reports the overflow", () => {
    const entries = tracker([
      { id: "E-1", status: "planned", priority: "P1", issue: 50, fixable: "yes (type-coercion)" },
      { id: "E-2", status: "planned", priority: "P0", issue: 90, fixable: "yes (type-coercion)" },
      { id: "E-3", status: "planned", priority: "P1", issue: 10, fixable: "yes (type-coercion)" },
      { id: "E-4", status: "planned", priority: "P2", fixable: "yes (description-only)" },
      { id: "E-5", status: "planned", priority: "P1", fixable: "yes (type-coercion)" },
      { id: "E-6", status: "planned", priority: "P0", issue: 90, fixable: "yes (type-coercion)" },
    ]);
    const plans = ["E-1", "E-2", "E-3", "E-5", "E-6"]
      .map((id, i) => plan(id, "type-coercion", [`src/${i}.ts`]))
      .concat(plan("E-4", "description-only", ["docs.md"]));
    const { candidates, skipped } = selectCandidates(entries, plans);
    expect(candidates.map((c) => c.id)).toEqual(["E-2", "E-6", "E-3", "E-1"]);
    expect(skipped).toEqual([
      { id: "E-5", reason: "cap: 4 candidates per run" },
      { id: "E-4", reason: "cap: 4 candidates per run" },
    ]);
  });

  test("at most two boundary-guard/assertion plans; a third guard is skipped but a non-guard still fits", () => {
    const entries = tracker([
      { id: "G-1", status: "planned", priority: "P0", issue: 1, fixable: "yes (boundary-guard)" },
      { id: "G-2", status: "planned", priority: "P0", issue: 2, fixable: "yes (assertion)" },
      { id: "G-3", status: "planned", priority: "P0", issue: 3, fixable: "yes (boundary-guard)" },
      { id: "D-4", status: "planned", priority: "P1", issue: 4, fixable: "yes (description-only)" },
    ]);
    const plans = [
      plan("G-1", "boundary-guard", ["a"]),
      plan("G-2", "assertion", ["b"]),
      plan("G-3", "boundary-guard", ["c"]),
      plan("D-4", "description-only", ["d"]),
    ];
    const { candidates, skipped } = selectCandidates(entries, plans);
    expect(candidates.map((c) => c.id)).toEqual(["G-1", "G-2", "D-4"]);
    expect(skipped).toEqual([{ id: "G-3", reason: "cap: at most 2 boundary-guard/assertion per run" }]);
  });

  test("same-file collision: the later candidate is skipped naming the winner and the file", () => {
    const entries = tracker([
      { id: "F-1", status: "planned", priority: "P1", issue: 1, fixable: "yes (type-coercion)" },
      { id: "F-2", status: "planned", priority: "P1", issue: 2, fixable: "yes (description-only)" },
      { id: "F-3", status: "planned", priority: "P1", issue: 3, fixable: "yes (type-coercion)" },
    ]);
    const plans = [
      plan("F-1", "type-coercion", ["src/shared.ts", "src/one.ts"]),
      plan("F-2", "description-only", ["src/two.ts", "src/shared.ts"]),
      plan("F-3", "type-coercion", ["src/three.ts"]),
    ];
    const { candidates, skipped } = selectCandidates(entries, plans);
    expect(candidates.map((c) => c.id)).toEqual(["F-1", "F-3"]);
    expect(skipped).toEqual([{ id: "F-2", reason: "same-file collision with F-1 on src/shared.ts" }]);
  });

  test("entries without Auto-fixable: yes are neither candidates nor reported", () => {
    const entries = tracker([
      { id: "N-1", status: "identified", priority: "P0" },
      { id: "N-2", status: "identified", priority: "P0", fixable: "no (mixed: design)" },
    ]);
    expect(selectCandidates(entries, [])).toEqual({ candidates: [], skipped: [] });
  });

  test("ineligible yes-entries are reported with their reason", () => {
    const entries = tracker([{ id: "S-1", status: "planned", priority: "P1", fixable: "yes (assertion)" }]);
    expect(selectCandidates(entries, [])).toEqual({
      candidates: [],
      skipped: [{ id: "S-1", reason: "no plan file in .claude/plans/" }],
    });
  });

  test("IDs already in flight on origin are skipped before the caps, so the slots go to new work", () => {
    const entries = tracker([
      { id: "I-1", status: "planned", priority: "P0", issue: 1, fixable: "yes (type-coercion)" },
      { id: "I-2", status: "planned", priority: "P1", issue: 2, fixable: "yes (type-coercion)" },
    ]);
    const plans = [plan("I-1", "type-coercion", ["a"]), plan("I-2", "type-coercion", ["b"])];
    const { candidates, skipped } = selectCandidates(entries, plans, { max: 1, inFlight: new Set(["I-1"]) });
    expect(candidates.map((c) => c.id)).toEqual(["I-2"]);
    expect(skipped).toEqual([{ id: "I-1", reason: "in flight: auto-fix/I-1 already exists on origin" }]);
  });

  test("caps are configurable", () => {
    const entries = tracker([
      { id: "C-1", status: "planned", priority: "P1", issue: 1, fixable: "yes (type-coercion)" },
      { id: "C-2", status: "planned", priority: "P1", issue: 2, fixable: "yes (type-coercion)" },
    ]);
    const plans = [plan("C-1", "type-coercion", ["a"]), plan("C-2", "type-coercion", ["b"])];
    expect(selectCandidates(entries, plans, { max: 1 }).candidates.map((c) => c.id)).toEqual(["C-1"]);
  });
});

describe("checkSteps — the fixed verification recipe", () => {
  test("lint + test always; install only without node_modules; build only for plugin source; named test last", () => {
    expect(checkSteps({ nodeModulesPresent: true, changedFiles: ["src/figmagent_mcp/tools/a.ts"] })).toEqual([
      { name: "lint", cmd: ["bun", "run", "lint"] },
      { name: "test", cmd: ["bun", "run", "test"] },
    ]);
    expect(
      checkSteps({
        nodeModulesPresent: false,
        changedFiles: ["src/figma_plugin/src/commands/apply.js"],
        test: "tests/x.test.ts",
      }).map((s) => s.name),
    ).toEqual(["install", "lint", "test", "build:plugin", "test tests/x.test.ts"]);
  });
});

describe("staleItems — verify-plan comparison", () => {
  const p = parsePlan(
    "**Pattern**: `boundary-guard`\n\n### File: `src/a.js`\n- Line 3: `const x = 1;` → `const x = 2;`\n\n### File: `tests/new.test.ts` (create it)\n\n### File: `src/gone.js`\n- Line 9: `foo()` → `bar()`\n",
  );
  const fs: Record<string, string> = { "src/a.js": "let y;\nconst x = 1;\n" };
  const read = (path: string) => fs[path];

  test("all present → nothing stale", () => {
    const ok: Record<string, string> = { ...fs, "src/gone.js": "call foo() here" };
    expect(staleItems(p, (path) => ok[path])).toEqual([]);
  });
  test("a missing file that is not marked for creation is stale; a file to create is not", () => {
    expect(staleItems(p, read)).toEqual(["missing file src/gone.js"]);
  });
  test("old code no longer present verbatim is stale, with file:line and the snippet", () => {
    const changed: Record<string, string> = { ...fs, "src/a.js": "const x = 5;\n", "src/gone.js": "foo()" };
    expect(staleItems(p, (path) => changed[path])).toEqual(["src/a.js:3 old code not found: `const x = 1;`"]);
  });
  test("a plan with no File sections has nothing to check", () => {
    expect(staleItems(parsePlan("**Pattern**: x\n"), read)).toEqual([]);
  });
});

// ---- dispatch-fix.ts CLI: the subcommands that need no git/gh ----------------
// Spawned with a temp directory as cwd holding a fixture tracker, plan and a
// fake worktree, so the real tracker and plans are never read or written.

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = join(import.meta.dir, "..", "scripts", "dispatch-fix.ts");

function run(args: string[], cwd: string) {
  const p = Bun.spawnSync(["bun", SCRIPT, ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  return { code: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() };
}

function repoFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "figmagent-dispatch-"));
  mkdirSync(join(dir, ".claude", "analysis"), { recursive: true });
  mkdirSync(join(dir, ".claude", "plans"), { recursive: true });
  mkdirSync(join(dir, ".claude", "worktrees", "auto-fix-BUG-001", "src"), { recursive: true });
  writeFileSync(
    join(dir, ".claude", "analysis", "improvement-tracker.md"),
    [
      "## Active Issues",
      "",
      "### [BUG-001] Guard it — [#41](https://github.com/o/r/issues/41)",
      "- **Status**: planned",
      "- **Priority**: P1",
      "- **Category**: plugin-bug",
      "- **Auto-fixable**: yes (boundary-guard)",
      "",
      "### [TOOL-002] Batch it",
      "- **Status**: planned",
      "- **Priority**: P1",
      "- **Category**: missing-batch-tool",
      "- **Auto-fixable**: yes (missing-batch-tool)",
      "",
      "## Resolved Issues",
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(dir, ".claude", "plans", "2026-09-02-BUG-001.md"),
    "# Fix: [BUG-001]\n\n**Pattern**: `boundary-guard`\n**Priority**: P1\n\n## Changes\n\n### File: `src/a.js`\n- Line 1: `throw new TypeError()` → `fail('x', 'y')`\n\n## Verification\n- [ ] Run `bun run test` — `tests/a.test.ts` fails without it\n",
  );
  writeFileSync(
    join(dir, ".claude", "plans", "2026-09-02-TOOL-002.md"),
    "# Fix: [TOOL-002]\n\n**Pattern**: `missing-batch-tool`\n**Priority**: P1\n",
  );
  writeFileSync(
    join(dir, ".claude", "worktrees", "auto-fix-BUG-001", "src", "a.js"),
    "if (!n) throw new TypeError();\n",
  );
  return dir;
}

describe("dispatch-fix.ts CLI (no git/gh needed)", () => {
  test("candidates prints the JSON contract", () => {
    const r = run(["candidates"], repoFixture());
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out)).toEqual({
      candidates: [
        {
          id: "BUG-001",
          priority: "P1",
          pattern: "boundary-guard",
          plan: ".claude/plans/2026-09-02-BUG-001.md",
          files: ["src/a.js"],
          status: "planned",
          issue: 41,
          namedTest: "tests/a.test.ts",
        },
      ],
      skipped: [{ id: "TOOL-002", reason: "pattern missing-batch-tool is never auto-dispatched" }],
    });
  });

  test("verify-plan: exit 0 when the plan matches, 5 with plan-stale lines when it does not, 2 without a worktree", () => {
    const dir = repoFixture();
    const ok = run(["verify-plan", "BUG-001"], dir);
    expect(ok.code).toBe(0);
    expect(ok.out).toContain("plan-ok: .claude/plans/2026-09-02-BUG-001.md — 1 file(s), 1 snippet(s) checked");

    writeFileSync(join(dir, ".claude", "worktrees", "auto-fix-BUG-001", "src", "a.js"), "if (!n) fail('x', 'y');\n");
    const stale = run(["verify-plan", "BUG-001"], dir);
    expect(stale.code).toBe(5);
    expect(stale.out.trim()).toBe("plan-stale: src/a.js:1 old code not found: `throw new TypeError()`");

    expect(run(["verify-plan", "TOOL-002"], dir).code).toBe(2); // no worktree
  });

  test("check refuses a --test file that is not in the worktree before running anything", () => {
    const r = run(["check", "BUG-001", "--test", "tests/nope.test.ts"], repoFixture());
    expect(r.code).toBe(1);
    expect(r.out).toContain("FAIL test tests/nope.test.ts (file not found in .claude/worktrees/auto-fix-BUG-001)");
    expect(run(["check", "BUG-001", "--test", "../escape.ts"], repoFixture()).code).toBe(2);
    expect(run(["check", "TOOL-002"], repoFixture()).code).toBe(2); // no worktree
  });

  test("comment guards its arguments before touching gh", () => {
    const dir = repoFixture();
    expect(run(["comment", "BUG-001", "--body", "x"], dir).code).toBe(2); // no --issue
    expect(run(["comment", "BUG-001", "--issue", "41"], dir).code).toBe(2); // no --body
    const long = run(["comment", "BUG-001", "--issue", "41", "--body", "x".repeat(2001)], dir);
    expect(long.code).toBe(2);
    expect(long.err).toContain("2001 chars; the limit is 2000");
  });

  test("usage: unknown subcommand and malformed ID exit 2", () => {
    const dir = repoFixture();
    expect(run(["nope"], dir).code).toBe(2);
    expect(run(["verify-plan", "bug-1"], dir).code).toBe(2);
  });
});
