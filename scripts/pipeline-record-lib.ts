/**
 * Pure parsing and aggregation for the pipeline run record
 * (.claude/analysis/pipeline-runs.jsonl). One JSON object per line, one line per
 * event: `{ run, stage, ts, ...counters }`. Stages append whatever key=value
 * pairs they know; `summarizeRuns` sums every numeric key per run and keeps the
 * last string value per key, so a new counter needs no schema change — only the
 * status table picks named columns.
 */

export interface RunEvent {
  run: string;
  stage: string;
  ts: string;
  [key: string]: unknown;
}

export interface RunSummary {
  run: string;
  start: string;
  end: string;
  seconds: number;
  stages: string[];
  totals: Record<string, number>;
  last: Record<string, string>;
}

const NUMERIC = /^-?\d+(\.\d+)?$/;

/** "12" → 12, "1.5" → 1.5, anything else stays a string. */
export function coerce(value: string): string | number {
  return NUMERIC.test(value) ? Number(value) : value;
}

/** Parse `key=value` CLI pairs; a pair without `=` is ignored. Later keys win. */
export function parseKv(pairs: string[]): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const pair of pairs) {
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    out[pair.slice(0, eq)] = coerce(pair.slice(eq + 1));
  }
  return out;
}

/** Parse the jsonl text; blank and malformed lines are skipped, never fatal. */
export function parseEvents(text: string): RunEvent[] {
  const events: RunEvent[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj: unknown;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!obj || typeof obj !== "object") continue;
    const ev = obj as Record<string, unknown>;
    if (typeof ev.run !== "string" || typeof ev.stage !== "string") continue;
    events.push(Object.assign({ ts: "" }, ev) as RunEvent);
  }
  return events;
}

function seconds(a: string, b: string): number {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (Number.isNaN(ta) || Number.isNaN(tb)) return 0;
  return Math.max(0, Math.round((tb - ta) / 1000));
}

/** Group events by run (in first-seen order) and aggregate counters. */
export function summarizeRuns(events: RunEvent[]): RunSummary[] {
  const byRun = new Map<string, RunSummary>();
  for (const ev of events) {
    let s = byRun.get(ev.run);
    if (!s) {
      s = { run: ev.run, start: ev.ts, end: ev.ts, seconds: 0, stages: [], totals: {}, last: {} };
      byRun.set(ev.run, s);
    }
    if (ev.ts && (!s.start || ev.ts < s.start)) s.start = ev.ts;
    if (ev.ts && ev.ts > s.end) s.end = ev.ts;
    if (!s.stages.includes(ev.stage)) s.stages.push(ev.stage);
    for (const [k, v] of Object.entries(ev)) {
      if (k === "run" || k === "stage" || k === "ts") continue;
      if (typeof v === "number") s.totals[k] = (s.totals[k] || 0) + v;
      else if (typeof v === "string") s.last[k] = v;
      else if (typeof v === "boolean") s.totals[k] = (s.totals[k] || 0) + (v ? 1 : 0);
    }
  }
  const out = [...byRun.values()];
  for (const s of out) s.seconds = seconds(s.start, s.end);
  return out;
}

export function formatDuration(secs: number): string {
  if (secs < 60) return `${secs}s`;
  const m = Math.round(secs / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}m`;
}

function n(totals: Record<string, number>, key: string): number {
  return totals[key] || 0;
}

/** Columns of the status table, in order. Each maps a summary to one cell. */
export const STATUS_COLUMNS: Array<{ header: string; cell: (s: RunSummary) => string }> = [
  { header: "run", cell: (s) => s.run },
  { header: "start", cell: (s) => s.start.replace("T", " ").slice(0, 16) || "-" },
  { header: "dur", cell: (s) => formatDuration(s.seconds) },
  // sessions extracted / analyzed / failed
  {
    header: "sess e/a/f",
    cell: (s) => `${n(s.totals, "extracted")}/${n(s.totals, "analyzed")}/${n(s.totals, "failed")}`,
  },
  // tracker entries created / closed / drift (Stage C)
  {
    header: "entries c/c/d",
    cell: (s) => `${n(s.totals, "created")}/${n(s.totals, "closed")}/${n(s.totals, "drift")}`,
  },
  { header: "plans", cell: (s) => String(n(s.totals, "plans")) },
  // draft PRs opened / aborted / deferred (Stage D)
  { header: "prs o/a/d", cell: (s) => `${n(s.totals, "opened")}/${n(s.totals, "aborted")}/${n(s.totals, "deferred")}` },
  // merged / reviewed (sent back) / human-only (Stage E)
  {
    header: "merge m/r/h",
    cell: (s) => `${n(s.totals, "merged")}/${n(s.totals, "reviewed")}/${n(s.totals, "human_only")}`,
  },
  { header: "release", cell: (s) => s.last.tag || "-" },
  { header: "deny", cell: (s) => String(n(s.totals, "denials")) },
  { header: "paused", cell: (s) => (n(s.totals, "paused") > 0 ? `yes: ${s.last.reason || "?"}` : "no") },
];

/** A fixed-width table of the last `runs` runs (oldest first). */
export function formatStatus(summaries: RunSummary[], runs = 7): string {
  const rows = summaries.slice(Math.max(0, summaries.length - runs));
  if (rows.length === 0) return "no pipeline runs recorded";
  const cells = rows.map((s) => STATUS_COLUMNS.map((c) => c.cell(s)));
  const widths = STATUS_COLUMNS.map((c, i) => Math.max(c.header.length, ...cells.map((r) => r[i].length)));
  const line = (r: string[]) =>
    r
      .map((v, i) => v.padEnd(widths[i]))
      .join("  ")
      .trimEnd();
  return [line(STATUS_COLUMNS.map((c) => c.header)), ...cells.map(line)].join("\n");
}
