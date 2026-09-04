#!/usr/bin/env bun
/**
 * Tracker CLI for the auto-improve pipeline (WS1.4 nightly triage).
 *
 * The nightly `/triage-tracker` prompt must never edit the tracker by hand —
 * it asks this script which entries need a verdict and writes the verdict back
 * through it, so the file's shape (one `- **Field**:` line per field, nothing
 * else touched) is guaranteed by code rather than by prose.
 *
 * Subcommands:
 *   untriaged [--limit N] [--json]   Active entries that still need an
 *                                    Auto-fixable verdict against the current
 *                                    seven-pattern allowlist (see `isUntriaged`).
 *                                    One line per entry: `ID  P?  status  title`.
 *   entry <ID>                       Print the entry (active occurrence).
 *   set-status <ID> "<status text>"  Rewrite the entry's Status line.
 *   set-autofixable <ID> "yes (<pattern>)" | "no (<reason>)"
 *                                    Rewrite (or insert) the Auto-fixable line.
 *
 * `--tracker <path>` overrides the tracker location (tests use a fixture).
 * Exit codes: 0 ok · 2 usage / unknown ID / malformed value.
 */

import { readFile, writeFile } from "node:fs/promises";
import {
  autoFixable,
  decisionDates,
  entryText,
  isResolutionStatus,
  parseTracker,
  priorityToken,
  statusToken,
  type TrackerEntry,
  updateEntryField,
} from "./tracker-parse.ts";

export const DEFAULT_TRACKER = ".claude/analysis/improvement-tracker.md";

/** The allowlist before 2026-09-02 (INFRA-006 widened it to seven patterns). */
export const OLD_PATTERNS = ["sync-to-async", "type-coercion", "missing-batch-tool"];
/** The four patterns INFRA-006 added — a `no` reason naming any of them was written against the current list. */
export const NEW_PATTERNS = ["description-only", "lint-scope-filter", "boundary-guard", "assertion"];
/** Decisions on or after this date were taken with the current allowlist in view. */
export const ALLOWLIST_WIDENED_ON = "2026-09-02";

const PRIORITY_RANK: Record<string, number> = { P0: 0, P1: 1, P2: 2 };

/** Active = has an authoritative Status that is not a resolution status. */
export function isActive(entry: TrackerEntry): boolean {
  return entry.activeStatus !== undefined && !entry.resolved;
}

/**
 * Does this entry still need a triage verdict?
 *  - no `Auto-fixable` line at all, or
 *  - `Auto-fixable: no (...)` whose reason names only the old three-pattern
 *    allowlist (mentions one of them and none of the four newer patterns) and
 *    the entry carries no `Decision (date)` on or after the widening date.
 */
export function isUntriaged(entry: TrackerEntry): boolean {
  if (!isActive(entry)) return false;
  const af = autoFixable(entry);
  if (af.verdict === undefined) return true;
  if (af.verdict === "yes") return false;
  const reason = (af.reason ?? "").toLowerCase();
  const namesOld = OLD_PATTERNS.some((p) => reason.includes(p));
  const namesNew = NEW_PATTERNS.some((p) => reason.includes(p));
  if (!namesOld || namesNew) return false;
  const decidedRecently = decisionDates(entry).some((d) => d >= ALLOWLIST_WIDENED_ON);
  return !decidedRecently;
}

/** Untriaged entries, highest priority first, tracker order within a priority. */
export function untriagedEntries(entries: TrackerEntry[], limit?: number): TrackerEntry[] {
  const out = entries
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => isUntriaged(e))
    .sort((a, b) => {
      const pr = (PRIORITY_RANK[priorityToken(a.e)] ?? 9) - (PRIORITY_RANK[priorityToken(b.e)] ?? 9);
      return pr !== 0 ? pr : a.i - b.i;
    })
    .map(({ e }) => e);
  return limit !== undefined ? out.slice(0, limit) : out;
}

export function formatUntriagedLine(e: TrackerEntry): string {
  return `${e.id}  ${priorityToken(e) || "P?"}  ${statusToken(e.activeStatus) || "?"}  ${e.cleanTitle}`;
}

export function untriagedJson(e: TrackerEntry): Record<string, unknown> {
  const af = autoFixable(e);
  return {
    id: e.id,
    priority: priorityToken(e) || null,
    status: e.activeStatus ?? null,
    title: e.cleanTitle,
    issue: e.issueRef ?? null,
    autoFixable: af.verdict ?? null,
    reason: af.reason ?? null,
  };
}

/** `yes (<pattern>)` or `no (<reason>)` — the only shapes the Stage D gate can read; the reason may itself contain parentheses. */
export function isValidAutoFixableValue(value: string): boolean {
  return /^(yes|no)\s*\(\s*\S[\s\S]*\)\s*$/i.test(value.trim());
}

/**
 * A resolution status (`implemented` / `verified` / `resolved`) closes the
 * GitHub issue in Stage C, so it must cite what resolved it — `PR #N` or a
 * commit sha — the same evidence rule the analyzer and the triage prompt follow.
 */
export function statusProblem(value: string): string | undefined {
  if (!isResolutionStatus(value)) return undefined;
  if (/\bPR #\d+\b|\b[0-9a-f]{7,40}\b/i.test(value)) return undefined;
  return `Status "${value}" closes the issue in Stage C, so it must cite the fix: "${statusToken(value)} — PR #N (YYYY-MM-DD)" or a commit sha`;
}

// ---- CLI --------------------------------------------------------------------

const ID_RE = /^[A-Z]+-\d+$/;

function die(msg: string, code = 2): never {
  console.error(msg);
  process.exit(code);
}

function parseArgs(argv: string[]): { positional: string[]; flags: Record<string, string | true> } {
  const positional: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? "";
    if (!a.startsWith("--")) {
      positional.push(a);
      continue;
    }
    const eq = a.indexOf("=");
    if (eq !== -1) {
      flags[a.slice(2, eq)] = a.slice(eq + 1);
    } else if (a === "--json") {
      flags.json = true;
    } else {
      flags[a.slice(2)] = argv[i + 1] ?? "";
      i++;
    }
  }
  return { positional, flags };
}

async function main(): Promise<void> {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const [cmd, idArg, valueArg] = positional;
  const trackerPath = typeof flags.tracker === "string" && flags.tracker ? flags.tracker : DEFAULT_TRACKER;

  const load = async (): Promise<string> => {
    try {
      return await readFile(trackerPath, "utf-8");
    } catch (e) {
      return die(`Cannot read tracker at ${trackerPath}: ${e}`);
    }
  };
  const requireId = (): string => {
    if (!idArg || !ID_RE.test(idArg)) die(`Expected an entry ID like TOOL-006, got: ${idArg ?? "(none)"}`);
    return idArg as string;
  };
  const setField = async (field: string, value: string | undefined, validate?: (v: string) => string | undefined) => {
    const id = requireId();
    if (value === undefined || !value.trim()) die(`${cmd} requires a value: ${cmd} ${id} "<text>"`);
    const v = (value as string).trim();
    const problem = validate?.(v);
    if (problem) die(problem);
    const text = await load();
    if (!parseTracker(text).some((e) => e.id === id)) die(`No tracker entry [${id}] in ${trackerPath}`);
    const next = updateEntryField(text, id, field, v);
    if (next !== text) await writeFile(trackerPath, next);
    console.log(`- **${field}**: ${v}`);
  };

  switch (cmd) {
    case "untriaged": {
      let limit: number | undefined;
      if (typeof flags.limit === "string") {
        limit = Number.parseInt(flags.limit, 10);
        if (Number.isNaN(limit) || limit < 0) die(`Invalid --limit ${flags.limit} — expected a non-negative integer.`);
      }
      const entries = untriagedEntries(parseTracker(await load()), limit);
      if (flags.json) console.log(JSON.stringify(entries.map(untriagedJson), null, 2));
      else for (const e of entries) console.log(formatUntriagedLine(e));
      break;
    }
    case "entry": {
      const id = requireId();
      const text = entryText(await load(), id);
      if (text === undefined) die(`No tracker entry [${id}] in ${trackerPath}`);
      console.log(text);
      break;
    }
    case "set-status":
      await setField("Status", valueArg, statusProblem);
      break;
    case "set-autofixable":
      await setField("Auto-fixable", valueArg, (v) =>
        isValidAutoFixableValue(v) ? undefined : `Auto-fixable must be "yes (<pattern>)" or "no (<reason>)", got: ${v}`,
      );
      break;
    default:
      die(`Unknown subcommand: ${cmd ?? "(none)"}. Use untriaged | entry | set-status | set-autofixable.`);
  }
}

if (import.meta.main) await main();
