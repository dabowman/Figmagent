// The nightly log is prose; the run record is the structured counterpart —
// one JSON line per stage event, aggregated per run into the morning table.

import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  coerce,
  formatDuration,
  formatStatus,
  parseEvents,
  parseKv,
  summarizeRuns,
} from "../scripts/pipeline-record-lib.ts";

describe("parseKv / coerce", () => {
  test("numeric-looking values become numbers, others stay strings", () => {
    expect(coerce("12")).toBe(12);
    expect(coerce("-3")).toBe(-3);
    expect(coerce("1.5")).toBe(1.5);
    expect(coerce("v0.4.1")).toBe("v0.4.1");
    expect(coerce("")).toBe("");
    expect(coerce("1e3")).toBe("1e3");
  });

  test("splits on the first '=' only and ignores bare words", () => {
    expect(parseKv(["opened=2", "tag=v0.4.1", "reason=a=b", "bare", "=x"])).toEqual({
      opened: 2,
      tag: "v0.4.1",
      reason: "a=b",
    });
  });
});

describe("parseEvents", () => {
  test("skips blank and malformed lines and lines without run/stage", () => {
    const text = [
      '{"run":"r1","stage":"extract","ts":"2026-09-04T03:00:00Z","extracted":3}',
      "",
      "not json",
      '{"stage":"x"}',
      '{"run":"r1","stage":"analyze","ts":"2026-09-04T03:05:00Z","analyzed":1}',
    ].join("\n");
    const events = parseEvents(text);
    expect(events).toHaveLength(2);
    expect(events[0].extracted).toBe(3);
    expect(events[1].stage).toBe("analyze");
  });
});

describe("summarizeRuns", () => {
  const events = parseEvents(
    [
      '{"run":"r1","stage":"extract","ts":"2026-09-04T03:00:00Z","extracted":3}',
      '{"run":"r1","stage":"analyze","ts":"2026-09-04T03:10:00Z","analyzed":1}',
      '{"run":"r1","stage":"analyze","ts":"2026-09-04T03:20:00Z","analyzed":1}',
      '{"run":"r1","stage":"analyze","ts":"2026-09-04T03:21:00Z","failed":1,"session":"abc"}',
      '{"run":"r1","stage":"sync","ts":"2026-09-04T03:22:00Z","created":4,"closed":1,"drift":2}',
      '{"run":"r1","stage":"dispatch","ts":"2026-09-04T03:40:00Z","opened":1,"aborted":0,"deferred":1}',
      '{"run":"r1","stage":"release","ts":"2026-09-04T03:42:00Z","tag":"v0.4.1"}',
      '{"run":"r2","stage":"extract","ts":"2026-09-05T03:00:00Z","extracted":0}',
      '{"run":"r2","stage":"breaker","ts":"2026-09-05T03:01:00Z","paused":1,"reason":"guard denied: git push"}',
    ].join("\n"),
  );
  const runs = summarizeRuns(events);

  test("groups by run in first-seen order", () => {
    expect(runs.map((r) => r.run)).toEqual(["r1", "r2"]);
  });

  test("sums numeric keys across every stage of a run", () => {
    const r1 = runs[0];
    expect(r1.totals.extracted).toBe(3);
    expect(r1.totals.analyzed).toBe(2);
    expect(r1.totals.failed).toBe(1);
    expect(r1.totals.created).toBe(4);
    expect(r1.totals.opened).toBe(1);
    expect(r1.totals.deferred).toBe(1);
  });

  test("keeps the last string value per key and spans start to end", () => {
    const r1 = runs[0];
    expect(r1.last.tag).toBe("v0.4.1");
    expect(r1.last.session).toBe("abc");
    expect(r1.start).toBe("2026-09-04T03:00:00Z");
    expect(r1.end).toBe("2026-09-04T03:42:00Z");
    expect(r1.seconds).toBe(42 * 60);
    expect(r1.stages).toEqual(["extract", "analyze", "sync", "dispatch", "release"]);
  });

  test("a breaker trip shows up as paused with its reason", () => {
    const r2 = runs[1];
    expect(r2.totals.paused).toBe(1);
    expect(r2.last.reason).toBe("guard denied: git push");
  });

  test("formatStatus renders one row per run with the funnel columns", () => {
    const table = formatStatus(runs, 7);
    const lines = table.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(
      /^run\s+start\s+dur\s+sess e\/a\/f\s+entries c\/c\/d\s+plans\s+prs o\/a\/d\s+merge m\/r\/h\s+release\s+deny\s+paused/,
    );
    expect(lines[1]).toMatch(
      /^r1\s+2026-09-04 03:00\s+42m\s+3\/2\/1\s+4\/1\/2\s+0\s+1\/0\/1\s+0\/0\/0\s+v0\.4\.1\s+0\s+no$/,
    );
    expect(lines[2]).toMatch(/^r2\s+.*\s+-\s+0\s+yes: guard denied: git push$/);
  });

  test("formatStatus keeps only the last N runs and handles no runs", () => {
    expect(formatStatus(runs, 1).split("\n")[1]).toMatch(/^r2\b/);
    expect(formatStatus([], 7)).toBe("no pipeline runs recorded");
  });

  test("formatDuration", () => {
    expect(formatDuration(30)).toBe("30s");
    expect(formatDuration(600)).toBe("10m");
    expect(formatDuration(3 * 3600 + 5 * 60)).toBe("3h05m");
  });
});

describe("pipeline-record.ts CLI", () => {
  const SCRIPT = join(import.meta.dir, "..", "scripts", "pipeline-record.ts");

  function run(root: string, ...args: string[]) {
    const r = Bun.spawnSync(["bun", SCRIPT, ...args], {
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
      env: Object.assign({}, process.env, { PIPELINE_ROOT: root, AUTO_IMPROVE_RUN_ID: "" }),
    });
    return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() };
  }

  test("event creates the jsonl on first use and status aggregates it", () => {
    const root = mkdtempSync(join(tmpdir(), "pipeline-record-"));
    expect(run(root, "status").out.trim()).toBe("no pipeline runs recorded");

    expect(run(root, "event", "--run", "20260904T030000", "--stage", "extract", "extracted=2").code).toBe(0);
    expect(run(root, "event", "--run", "20260904T030000", "--stage", "release", "tag=v0.4.1").code).toBe(0);

    const file = join(root, ".claude/analysis/pipeline-runs.jsonl");
    expect(existsSync(file)).toBe(true);
    const lines = readFileSync(file, "utf-8").trim().split("\n");
    expect(lines).toHaveLength(2);
    const first = JSON.parse(lines[0]);
    expect(first.run).toBe("20260904T030000");
    expect(first.stage).toBe("extract");
    expect(first.extracted).toBe(2);
    expect(Number.isNaN(Date.parse(first.ts))).toBe(false);

    const status = run(root, "status", "--runs", "1");
    expect(status.code).toBe(0);
    expect(status.out).toMatch(/20260904T030000\s+.*\s+2\/0\/0\s+.*v0\.4\.1/);

    // --run picks one run by id regardless of order (the morning summary uses it).
    run(root, "event", "--run", "20260905T030000", "--stage", "extract", "extracted=9");
    const one = run(root, "status", "--run", "20260904T030000");
    expect(one.out.split("\n").filter(Boolean)).toHaveLength(2);
    expect(one.out).toMatch(/20260904T030000/);
    expect(one.out).not.toMatch(/20260905T030000/);
    expect(run(root, "status", "--run", "nope").out.trim()).toBe("no pipeline runs recorded");
  });

  test("event without --run/--stage is a usage error", () => {
    const root = mkdtempSync(join(tmpdir(), "pipeline-record-"));
    const r = run(root, "event", "--stage", "x");
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/usage/);
  });

  test("resume deletes .pipeline.paused and records the resume; a second resume is a no-op", () => {
    const root = mkdtempSync(join(tmpdir(), "pipeline-record-"));
    mkdirSync(join(root, ".claude/analysis"), { recursive: true });
    writeFileSync(join(root, ".pipeline.paused"), JSON.stringify({ at: "t", reason: "guard denied: curl x" }));

    const r = run(root, "resume");
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/resumed .*guard denied: curl x/);
    expect(existsSync(join(root, ".pipeline.paused"))).toBe(false);
    const line = JSON.parse(readFileSync(join(root, ".claude/analysis/pipeline-runs.jsonl"), "utf-8").trim());
    expect(line.stage).toBe("resume");
    expect(line.paused).toBe(0);
    expect(line.reason).toBe("guard denied: curl x");
    expect(line.run).toBe("manual");

    const again = run(root, "resume");
    expect(again.code).toBe(0);
    expect(again.out).toMatch(/not paused/);
  });
});
