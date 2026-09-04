// scripts/tracker.ts — the only writer the nightly /triage-tracker prompt gets.
// Pure rules (`isUntriaged`, ordering) are tested on fixture entries; the CLI is
// spawned against a temp copy of a fixture tracker, and once read-only against
// the real tracker to make sure `untriaged --json` parses it.

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { parseTracker } from "../scripts/tracker-parse.ts";
import {
  formatUntriagedLine,
  isUntriaged,
  isValidAutoFixableValue,
  untriagedEntries,
  untriagedJson,
} from "../scripts/tracker.ts";

const SCRIPT = join(import.meta.dir, "..", "scripts", "tracker.ts");
const REAL_TRACKER = join(import.meta.dir, "..", ".claude", "analysis", "improvement-tracker.md");

const FIXTURE = `# Tracker

## Active Issues

### [TOOL-001] No verdict line at all
- **Status**: identified
- **Priority**: P2
- **Category**: missing-tool

### [BUG-002] Old three-pattern boilerplate
- **Status**: identified
- **Priority**: P0
- **Category**: plugin-bug
- **Auto-fixable**: no (not a sync-to-async, type-coercion, or missing-batch-tool pattern)

### [BUG-003] Old boilerplate but decided after the widening
- **Status**: identified
- **Priority**: P0
- **Category**: plugin-bug
- **Auto-fixable**: no (outside the sync-to-async / type-coercion / missing-batch-tool allowlist)
- **Decision (2026-09-02)**: keep as is.

### [BUG-004] Old boilerplate, decided before the widening
- **Status**: identified
- **Priority**: P1
- **Category**: plugin-bug
- **Auto-fixable**: no (outside the sync-to-async / type-coercion / missing-batch-tool allowlist)
- **Decision (2026-08-30)**: revisit.

### [TOOL-005] Reason names a new pattern — already triaged
- **Status**: identified
- **Priority**: P0
- **Category**: missing-tool
- **Auto-fixable**: no (mixed: boundary-guard plus a new field — outside the seven-pattern allowlist)

### [TOOL-006] Verdict yes
- **Status**: planned
- **Priority**: P0
- **Category**: type-coercion
- **Auto-fixable**: yes (type-coercion)

### [TOOL-007] Reason unrelated to any allowlist
- **Status**: identified
- **Priority**: P1
- **Category**: missing-tool
- **Auto-fixable**: no (design work: per-session working page)

### [INFRA-008] Implemented — not active any more
- **Status**: implemented — PR #12 (2026-09-01)
- **Priority**: P0
- **Category**: infrastructure

### [AGENT-009] Mixed status still counts as active
- **Status**: mixed
- **Priority**: P1
- **Category**: agent-behavior

## Resolved Issues

### [BUG-010] Only under Resolved
- **Resolved in**: Session 3

## Metrics Over Time

| a |
`;

describe("isUntriaged / untriagedEntries", () => {
  const entries = parseTracker(FIXTURE);
  const by = (id: string) => entries.find((e) => e.id === id) as (typeof entries)[number];

  test("no Auto-fixable line → untriaged", () => {
    expect(isUntriaged(by("TOOL-001"))).toBe(true);
    expect(isUntriaged(by("AGENT-009"))).toBe(true);
  });
  test("no (...) naming only the old three patterns, no recent Decision → untriaged", () => {
    expect(isUntriaged(by("BUG-002"))).toBe(true);
    expect(isUntriaged(by("BUG-004"))).toBe(true);
  });
  test("a Decision dated on/after 2026-09-02 settles an old-boilerplate verdict", () => {
    expect(isUntriaged(by("BUG-003"))).toBe(false);
  });
  test("a reason naming one of the four newer patterns was written against the current list", () => {
    expect(isUntriaged(by("TOOL-005"))).toBe(false);
  });
  test("yes verdicts and unrelated no reasons are triaged", () => {
    expect(isUntriaged(by("TOOL-006"))).toBe(false);
    expect(isUntriaged(by("TOOL-007"))).toBe(false);
  });
  test("resolved statuses and resolved-only entries are never untriaged", () => {
    expect(isUntriaged(by("INFRA-008"))).toBe(false);
    expect(isUntriaged(by("BUG-010"))).toBe(false);
  });
  test("ordered by priority, then tracker order; --limit slices", () => {
    expect(untriagedEntries(entries).map((e) => e.id)).toEqual(["BUG-002", "BUG-004", "AGENT-009", "TOOL-001"]);
    expect(untriagedEntries(entries, 2).map((e) => e.id)).toEqual(["BUG-002", "BUG-004"]);
    expect(untriagedEntries(entries, 0)).toEqual([]);
  });
  test("line and JSON shapes", () => {
    expect(formatUntriagedLine(by("BUG-002"))).toBe("BUG-002  P0  identified  Old three-pattern boilerplate");
    expect(untriagedJson(by("BUG-002"))).toEqual({
      id: "BUG-002",
      priority: "P0",
      status: "identified",
      title: "Old three-pattern boilerplate",
      issue: null,
      autoFixable: "no",
      reason: "not a sync-to-async, type-coercion, or missing-batch-tool pattern",
    });
  });
  test("isValidAutoFixableValue accepts only yes (...) / no (...)", () => {
    expect(isValidAutoFixableValue("yes (boundary-guard)")).toBe(true);
    expect(isValidAutoFixableValue("no (mixed: design work — allowlist: seven patterns)")).toBe(true);
    // A reason may itself contain parentheses — the shapes the triage prompt dictates.
    expect(isValidAutoFixableValue("no (mixed: edit({variableModes}) is a new field — allowlist: …)")).toBe(true);
    expect(isValidAutoFixableValue("yes (type-coercion — Zod .or(...transform) on the array criteria)")).toBe(true);
    expect(isValidAutoFixableValue("yes")).toBe(false);
    expect(isValidAutoFixableValue("no ()")).toBe(false);
    expect(isValidAutoFixableValue("maybe (x)")).toBe(false);
  });
});

// ---- CLI ---------------------------------------------------------------------

function run(args: string[], cwd?: string) {
  const p = Bun.spawnSync(["bun", SCRIPT, ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  return { code: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() };
}

function fixtureFile(): string {
  const dir = mkdtempSync(join(tmpdir(), "figmagent-tracker-"));
  const path = join(dir, "tracker.md");
  writeFileSync(path, FIXTURE);
  return path;
}

describe("tracker.ts CLI", () => {
  test("untriaged prints one line per entry; --limit and --json", () => {
    const t = fixtureFile();
    const text = run(["untriaged", "--tracker", t]);
    expect(text.code).toBe(0);
    expect(text.out.trim().split("\n")).toEqual([
      "BUG-002  P0  identified  Old three-pattern boilerplate",
      "BUG-004  P1  identified  Old boilerplate, decided before the widening",
      "AGENT-009  P1  mixed  Mixed status still counts as active",
      "TOOL-001  P2  identified  No verdict line at all",
    ]);
    const json = run(["untriaged", "--limit", "1", "--json", "--tracker", t]);
    expect(json.code).toBe(0);
    expect(JSON.parse(json.out)).toEqual([
      {
        id: "BUG-002",
        priority: "P0",
        status: "identified",
        title: "Old three-pattern boilerplate",
        issue: null,
        autoFixable: "no",
        reason: "not a sync-to-async, type-coercion, or missing-batch-tool pattern",
      },
    ]);
    expect(run(["untriaged", "--limit", "x", "--tracker", t]).code).toBe(2);
  });

  test("entry prints the active occurrence", () => {
    const r = run(["entry", "TOOL-006", "--tracker", fixtureFile()]);
    expect(r.code).toBe(0);
    expect(r.out.trim().split("\n")).toEqual([
      "### [TOOL-006] Verdict yes",
      "- **Status**: planned",
      "- **Priority**: P0",
      "- **Category**: type-coercion",
      "- **Auto-fixable**: yes (type-coercion)",
    ]);
    expect(run(["entry", "NOPE-1", "--tracker", fixtureFile()]).code).toBe(2);
    expect(run(["entry", "lowercase", "--tracker", fixtureFile()]).code).toBe(2);
  });

  test("set-status rewrites only that line and prints it", () => {
    const t = fixtureFile();
    const r = run(["set-status", "TOOL-006", "identified", "--tracker", t]);
    expect(r.code).toBe(0);
    expect(r.out.trim()).toBe("- **Status**: identified");
    const after = readFileSync(t, "utf-8");
    expect(after).not.toBe(FIXTURE);
    expect(after.replace("- **Status**: identified\n- **Priority**: P0\n- **Category**: type-coercion", "X")).toBe(
      FIXTURE.replace("- **Status**: planned\n- **Priority**: P0\n- **Category**: type-coercion", "X"),
    );
    expect(run(["set-status", "TOOL-006", "--tracker", t]).code).toBe(2); // missing value
    expect(run(["set-status", "ZZZ-1", "planned", "--tracker", t]).code).toBe(2); // unknown id
  });

  test("set-status: a resolution status must cite the PR or commit that resolved it (Stage C closes the issue on it)", () => {
    const t = fixtureFile();
    const bare = run(["set-status", "TOOL-006", "verified", "--tracker", t]);
    expect(bare.code).toBe(2);
    expect(bare.err).toContain("must cite the fix");
    expect(readFileSync(t, "utf-8")).toBe(FIXTURE);
    expect(run(["set-status", "TOOL-006", "implemented — PR #40 (2026-09-03)", "--tracker", t]).code).toBe(0);
    expect(run(["set-status", "TOOL-006", "verified in 8dee519a", "--tracker", t]).code).toBe(0);
    expect(run(["set-status", "TOOL-006", "planned", "--tracker", t]).code).toBe(0);
  });

  test("set-autofixable inserts after Status when absent, replaces when present, validates the shape", () => {
    const t = fixtureFile();
    const ins = run(["set-autofixable", "TOOL-001", "no (design work — allowlist: seven patterns)", "--tracker", t]);
    expect(ins.code).toBe(0);
    expect(ins.out.trim()).toBe("- **Auto-fixable**: no (design work — allowlist: seven patterns)");
    const lines = readFileSync(t, "utf-8").split("\n");
    const i = lines.indexOf("### [TOOL-001] No verdict line at all");
    expect(lines[i + 1]).toBe("- **Status**: identified");
    expect(lines[i + 2]).toBe("- **Auto-fixable**: no (design work — allowlist: seven patterns)");
    expect(lines[i + 3]).toBe("- **Priority**: P2");

    const rep = run(["set-autofixable", "BUG-002", "yes (boundary-guard)", "--tracker", t]);
    expect(rep.code).toBe(0);
    const after = readFileSync(t, "utf-8");
    expect(after).toContain(
      "### [BUG-002] Old three-pattern boilerplate\n- **Status**: identified\n- **Priority**: P0\n- **Category**: plugin-bug\n- **Auto-fixable**: yes (boundary-guard)\n",
    );
    expect(after).not.toContain("not a sync-to-async, type-coercion, or missing-batch-tool pattern");

    const bad = run(["set-autofixable", "BUG-002", "yes", "--tracker", t]);
    expect(bad.code).toBe(2);
    expect(bad.err).toContain('"yes (<pattern>)" or "no (<reason>)"');
    expect(readFileSync(t, "utf-8")).toBe(after); // rejected value wrote nothing
  });

  test("unknown subcommand and unreadable tracker exit 2", () => {
    expect(run(["frobnicate"]).code).toBe(2);
    expect(run(["untriaged", "--tracker", "/nonexistent/tracker.md"]).code).toBe(2);
  });

  test("read-only: untriaged --json against the real tracker parses to an array of entries", () => {
    const before = readFileSync(REAL_TRACKER, "utf-8");
    const r = run(["untriaged", "--json", "--tracker", REAL_TRACKER]);
    expect(r.code).toBe(0);
    const arr = JSON.parse(r.out) as Array<{ id: string; status: string | null }>;
    expect(Array.isArray(arr)).toBe(true);
    for (const e of arr) {
      expect(e.id).toMatch(/^[A-Z]+-\d+$/);
      expect(e.status).not.toBeNull();
    }
    expect(readFileSync(REAL_TRACKER, "utf-8")).toBe(before);
  });
});
