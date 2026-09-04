// The nightly Stage B loop used to re-hand a session the analyzer could not
// finish to a fresh agent every iteration (up to the run cap) because "needs
// analysis" only compared analysis-vs-source. The manifest now records attempts
// and failures; a failed session drops out of the queue until a human clears it.

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  clearFailed,
  failedSessions,
  type Manifest,
  type ManifestEntry,
  markAttempt,
  markFailed,
  needsAnalysis,
  nextToAnalyze,
  preserveAttemptState,
  selectNeedsAnalysis,
} from "../scripts/refresh-manifest-lib.ts";

function figma(overrides: Partial<ManifestEntry> = {}): ManifestEntry {
  return Object.assign(
    {
      sessionType: "figma" as const,
      toolCalls: 10,
      figmaToolCalls: 4,
      durationMinutes: 5,
      sourceModified: 100,
      sourceSignature: "10:4",
    },
    overrides,
  );
}

describe("needsAnalysis", () => {
  test("a figma session with no analysis needs one", () => {
    expect(needsAnalysis(figma())).toBe(true);
  });

  test("an analyzed session whose signature matches does not", () => {
    expect(needsAnalysis(figma({ analysis: "a.md", analyzedSignature: "10:4" }))).toBe(false);
  });

  test("an analyzed session whose content changed needs re-analysis", () => {
    expect(needsAnalysis(figma({ analysis: "a.md", analyzedSignature: "8:3" }))).toBe(true);
  });

  test("dev and empty sessions never need analysis", () => {
    expect(needsAnalysis(figma({ sessionType: "dev" }))).toBe(false);
    expect(needsAnalysis(figma({ sessionType: "empty" }))).toBe(false);
  });

  test("a session marked analysisFailed is excluded even with no analysis", () => {
    expect(needsAnalysis(figma({ analysisFailed: { at: "2026-09-04T03:00:00Z", reason: "turn cap" } }))).toBe(false);
  });

  test("attempts alone do not exclude a session — only a failed mark does", () => {
    expect(needsAnalysis(figma({ analysisAttempts: 3 }))).toBe(true);
  });
});

describe("selectNeedsAnalysis / nextToAnalyze", () => {
  const sessions: Record<string, ManifestEntry> = {
    newer: figma({ sourceModified: 300 }),
    done: figma({ sourceModified: 50, analysis: "x.md", analyzedSignature: "10:4" }),
    oldest: figma({ sourceModified: 100 }),
    failed: figma({ sourceModified: 10, analysisFailed: { at: "t", reason: "unreadable" } }),
    dev: figma({ sourceModified: 1, sessionType: "dev" }),
  };

  test("oldest source first, skipping analyzed, failed and dev", () => {
    expect(selectNeedsAnalysis(sessions).map(([sid]) => sid)).toEqual(["oldest", "newer"]);
  });

  test("next is the head of that list", () => {
    expect(nextToAnalyze(sessions)).toBe("oldest");
  });

  test("next is undefined for an empty queue", () => {
    expect(nextToAnalyze({ done: sessions.done, failed: sessions.failed })).toBeUndefined();
    expect(nextToAnalyze({})).toBeUndefined();
  });

  test("failedSessions lists only the failed ones", () => {
    expect(failedSessions(sessions).map(([sid]) => sid)).toEqual(["failed"]);
  });
});

describe("attempt / failed transitions", () => {
  const base: Manifest = { sessions: { s1: figma(), s2: figma({ sourceModified: 200 }) } };

  test("markAttempt counts from 1 and increments, without mutating the input", () => {
    const once = markAttempt(base, "s1");
    expect(once.sessions.s1.analysisAttempts).toBe(1);
    expect(markAttempt(once, "s1").sessions.s1.analysisAttempts).toBe(2);
    expect(base.sessions.s1.analysisAttempts).toBeUndefined();
    expect(once.sessions.s2).toBe(base.sessions.s2);
  });

  test("markFailed records the reason and timestamp and removes the session from the queue", () => {
    const failed = markFailed(base, "s1", "did not mark the session analyzed", "2026-09-04T03:14:00.000Z");
    expect(failed.sessions.s1.analysisFailed).toEqual({
      at: "2026-09-04T03:14:00.000Z",
      reason: "did not mark the session analyzed",
    });
    expect(nextToAnalyze(failed.sessions)).toBe("s2");
    expect(nextToAnalyze(base.sessions)).toBe("s1");
  });

  test("markFailed defaults the timestamp to now (ISO-8601)", () => {
    const at = markFailed(base, "s1", "x").sessions.s1.analysisFailed?.at ?? "";
    expect(Number.isNaN(Date.parse(at))).toBe(false);
  });

  test("clearFailed puts the session back in the queue and keeps its attempt count", () => {
    const failed = markFailed(markAttempt(base, "s1"), "s1", "x");
    const cleared = clearFailed(failed, "s1");
    expect(cleared.sessions.s1.analysisFailed).toBeUndefined();
    expect(cleared.sessions.s1.analysisAttempts).toBe(1);
    expect(nextToAnalyze(cleared.sessions)).toBe("s1");
    expect(failed.sessions.s1.analysisFailed).toBeDefined();
  });

  test("an unknown session id throws with the fix", () => {
    expect(() => markAttempt(base, "nope")).toThrow(/refresh-manifest/);
    expect(() => markFailed(base, "nope", "x")).toThrow(/not in the manifest/);
    expect(() => clearFailed(base, "nope")).toThrow(/not in the manifest/);
  });
});

describe("preserveAttemptState: the rebuild keeps loop bookkeeping", () => {
  test("carries attempts and failure onto a freshly built entry", () => {
    const existing = figma({ analysisAttempts: 2, analysisFailed: { at: "t", reason: "r" } });
    const rebuilt = preserveAttemptState(existing, figma({ sessionType: "dev" }));
    expect(rebuilt.analysisAttempts).toBe(2);
    expect(rebuilt.analysisFailed).toEqual({ at: "t", reason: "r" });
    expect(rebuilt.sessionType).toBe("dev");
  });

  test("leaves a new entry untouched when there is nothing to carry", () => {
    const rebuilt = preserveAttemptState(undefined, figma());
    expect(rebuilt.analysisAttempts).toBeUndefined();
    expect(rebuilt.analysisFailed).toBeUndefined();
    expect(preserveAttemptState({}, figma()).analysisAttempts).toBeUndefined();
  });
});

describe("refresh-manifest.ts CLI (cwd-relative, end to end)", () => {
  const SCRIPT = join(import.meta.dir, "..", "scripts", "refresh-manifest.ts");

  function run(cwd: string, ...args: string[]) {
    const r = Bun.spawnSync(["bun", SCRIPT, ...args], { cwd, stdout: "pipe", stderr: "pipe" });
    return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() };
  }

  function fixture(): string {
    const dir = mkdtempSync(join(tmpdir(), "refresh-manifest-"));
    mkdirSync(join(dir, ".claude/sessions-json"), { recursive: true });
    mkdirSync(join(dir, ".claude/analysis"), { recursive: true });
    const session = (id: string) => ({
      sessionId: id,
      metadata: { uniqueTools: ["mcp__Figmagent__read", "Read"], toolCallCount: 3, duration: { minutes: 2 } },
      messages: [
        { content: [{ type: "tool_use", id: "a", name: "mcp__Figmagent__read" }] },
        { content: [{ type: "tool_result", tool_use_id: "a", content: "ok" }] },
      ],
    });
    writeFileSync(join(dir, ".claude/sessions-json/aaa.json"), JSON.stringify(session("aaa")));
    writeFileSync(join(dir, ".claude/sessions-json/bbb.json"), JSON.stringify(session("bbb")));
    return dir;
  }

  test("--count prints only an integer and --next only a session id", () => {
    const dir = fixture();
    const count = run(dir, "--count");
    expect(count.code).toBe(0);
    expect(count.out.trim()).toMatch(/^\d+$/);
    expect(count.out.trim()).toBe("2");
    const next = run(dir, "--next");
    expect(next.code).toBe(0);
    expect(["aaa", "bbb"]).toContain(next.out.trim());
    expect(next.out.split("\n").filter(Boolean)).toHaveLength(1);
  });

  test("--mark-attempt, --mark-failed and --clear-failed round-trip through the manifest and a rescan", () => {
    const dir = fixture();
    run(dir, "--count");
    const first = run(dir, "--next").out.trim();
    const other = first === "aaa" ? "bbb" : "aaa";

    expect(run(dir, "--mark-attempt", first).code).toBe(0);
    const failed = run(
      dir,
      "--mark-failed",
      first,
      "--reason",
      "analyze-session ran but did not mark the session analyzed",
    );
    expect(failed.code).toBe(0);

    // The rescan (--count / --next) rebuilds the manifest and must keep both fields.
    expect(run(dir, "--count").out.trim()).toBe("1");
    expect(run(dir, "--next").out.trim()).toBe(other);
    const manifest = JSON.parse(readFileSync(join(dir, ".claude/analysis/sessions.json"), "utf-8"));
    expect(manifest.sessions[first].analysisAttempts).toBe(1);
    expect(manifest.sessions[first].analysisFailed.reason).toMatch(/did not mark/);

    expect(run(dir, "--clear-failed", first).code).toBe(0);
    expect(run(dir, "--count").out.trim()).toBe("2");
  });

  test("--next prints an empty line when the queue is empty", () => {
    const dir = fixture();
    run(dir, "--count");
    run(dir, "--mark-failed", "aaa", "--reason", "x");
    run(dir, "--mark-failed", "bbb", "--reason", "y");
    const next = run(dir, "--next");
    expect(next.code).toBe(0);
    expect(next.out).toBe("\n");
    expect(run(dir, "--count").out.trim()).toBe("0");
  });

  test("marking an unknown session fails non-zero with the fix", () => {
    const dir = fixture();
    run(dir, "--count");
    const r = run(dir, "--mark-attempt", "nope");
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/run refresh-manifest first/);
  });
});

describe("nextToAnalyze — exclusions for the current run", () => {
  test("a session this run already attempted is skipped for the run, not marked failed", () => {
    const sessions = {
      first: { sessionType: "figma", toolCalls: 5, figmaToolCalls: 2, durationMinutes: 1, sourceModified: 1 },
      second: { sessionType: "figma", toolCalls: 5, figmaToolCalls: 2, durationMinutes: 1, sourceModified: 2 },
    } as const;
    expect(nextToAnalyze(sessions)).toBe("first");
    expect(nextToAnalyze(sessions, new Set(["first"]))).toBe("second");
    expect(nextToAnalyze(sessions, new Set(["first", "second"]))).toBeUndefined();
  });
});
