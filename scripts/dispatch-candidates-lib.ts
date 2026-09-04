/**
 * Candidate selection for Stage D (`dispatch-fix.ts candidates`) — the rules of
 * `.claude/commands/dispatch-fixes.md` constraints 1–4 and step 1, in code:
 *
 *   1. tracker entry has `Auto-fixable: yes`
 *   2. priority P0/P1 — P2 only for `description-only` / `lint-scope-filter`
 *   3. a plan file exists and its `**Pattern**` first token is on the allowlist
 *      (`missing-batch-tool` and unknown tokens are skipped); the plan's pattern
 *      is authoritative over the tracker parenthetical
 *   4. status `identified` or `planned`
 *   - plans carrying `**Partial**: yes` are skipped
 *   - sorted by priority, then lowest issue number (ID as tie-break); cap 4;
 *     at most 2 `boundary-guard` / `assertion`; a later candidate whose plan
 *     names a file an earlier pick already touches is skipped
 *
 * Also here: the recipe `check` runs inside a worktree, and the stale-plan
 * comparison `verify-plan` performs — both pure so they can be tested without
 * a git worktree or `gh`.
 */

import { autoFixable, type ParsedPlan, statusToken, type TrackerEntry } from "./tracker-parse.ts";

export const DISPATCH_PATTERNS = [
  "sync-to-async",
  "type-coercion",
  "description-only",
  "lint-scope-filter",
  "boundary-guard",
  "assertion",
] as const;

/** Patterns that dispatch at P2 as well as P0/P1. */
export const P2_PATTERNS = new Set(["description-only", "lint-scope-filter"]);
/** Patterns capped at two per run. */
export const GUARD_PATTERNS = new Set(["boundary-guard", "assertion"]);
/** Never dispatched — new tools need human design. */
export const NEVER_PATTERNS = new Set(["missing-batch-tool"]);
export const DISPATCH_STATUSES = new Set(["identified", "planned"]);

export interface PlanRef {
  id: string;
  path: string;
  parsed: ParsedPlan;
}

export interface Candidate {
  id: string;
  priority: string;
  pattern: string;
  plan: string;
  files: string[];
  status: string;
  issue?: number;
  namedTest?: string;
}

export interface Skipped {
  id: string;
  reason: string;
}

export interface SelectOptions {
  max?: number; // default 4
  maxGuards?: number; // default 2
}

const PRIORITY_RANK: Record<string, number> = { P0: 0, P1: 1, P2: 2 };
const priorityRank = (p: string): number => PRIORITY_RANK[p.toUpperCase()] ?? 9;

/** The per-entry gate: every reason an entry with `Auto-fixable: yes` is not eligible, or the candidate. */
export function eligibility(entry: TrackerEntry, plan: PlanRef | undefined): Candidate | Skipped {
  const af = autoFixable(entry);
  // Only `yes` entries enter the pool; the rest are not reported (150 lines of noise otherwise).
  if (af.verdict !== "yes") return { id: entry.id, reason: `Auto-fixable is not yes (${af.verdict ?? "missing"})` };

  const status = statusToken(entry.activeStatus);
  if (entry.activeStatus === undefined) return { id: entry.id, reason: "appears only under Resolved Issues" };
  if (!DISPATCH_STATUSES.has(status)) return { id: entry.id, reason: `status is ${status || "empty"}` };

  if (!plan) return { id: entry.id, reason: "no plan file in .claude/plans/" };
  const pattern = plan.parsed.pattern;
  if (!pattern) return { id: entry.id, reason: `plan ${plan.path} has no **Pattern** line` };
  if (NEVER_PATTERNS.has(pattern)) return { id: entry.id, reason: `pattern ${pattern} is never auto-dispatched` };
  if (!(DISPATCH_PATTERNS as readonly string[]).includes(pattern)) {
    return { id: entry.id, reason: `pattern ${pattern} is not on the dispatch allowlist` };
  }
  if (plan.parsed.partial) return { id: entry.id, reason: "plan is marked Partial" };

  const priority = (entry.priority || plan.parsed.priority || "").toUpperCase().split(/[\s—(]/)[0] ?? "";
  const rank = priorityRank(priority);
  if (rank > 2) return { id: entry.id, reason: `priority ${priority || "missing"} is not P0/P1/P2` };
  if (rank === 2 && !P2_PATTERNS.has(pattern)) {
    return { id: entry.id, reason: `priority P2 is below the floor for ${pattern}` };
  }

  return {
    id: entry.id,
    priority,
    pattern,
    plan: plan.path,
    files: plan.parsed.files,
    status,
    issue: entry.issueRef,
    namedTest: plan.parsed.namedTest,
  };
}

export function selectCandidates(
  entries: TrackerEntry[],
  plans: PlanRef[],
  opts: SelectOptions = {},
): { candidates: Candidate[]; skipped: Skipped[] } {
  const max = opts.max ?? 4;
  const maxGuards = opts.maxGuards ?? 2;
  const planById = new Map(plans.map((p) => [p.id, p]));

  const eligible: Candidate[] = [];
  const skipped: Skipped[] = [];
  for (const entry of entries) {
    if (autoFixable(entry).verdict !== "yes") continue;
    const r = eligibility(entry, planById.get(entry.id));
    if ("reason" in r) skipped.push(r);
    else eligible.push(r);
  }

  eligible.sort((a, b) => {
    const pr = priorityRank(a.priority) - priorityRank(b.priority);
    if (pr !== 0) return pr;
    const ai = a.issue ?? Number.POSITIVE_INFINITY;
    const bi = b.issue ?? Number.POSITIVE_INFINITY;
    if (ai !== bi) return ai - bi;
    return a.id.localeCompare(b.id);
  });

  const candidates: Candidate[] = [];
  const claimedFiles = new Map<string, string>(); // file → winner id
  let guards = 0;
  for (const c of eligible) {
    if (candidates.length >= max) {
      skipped.push({ id: c.id, reason: `cap: ${max} candidates per run` });
      continue;
    }
    const isGuard = GUARD_PATTERNS.has(c.pattern);
    if (isGuard && guards >= maxGuards) {
      skipped.push({ id: c.id, reason: `cap: at most ${maxGuards} boundary-guard/assertion per run` });
      continue;
    }
    const clash = c.files.find((f) => claimedFiles.has(f));
    if (clash) {
      skipped.push({ id: c.id, reason: `same-file collision with ${claimedFiles.get(clash)} on ${clash}` });
      continue;
    }
    for (const f of c.files) claimedFiles.set(f, c.id);
    if (isGuard) guards++;
    candidates.push(c);
  }
  return { candidates, skipped };
}

// ---------------------------------------------------------------------------
// `check` recipe
// ---------------------------------------------------------------------------

export interface CheckStep {
  name: string;
  cmd: string[];
}

/** The fixed recipe `check` runs inside a worktree, given what it found there. */
export function checkSteps(input: { nodeModulesPresent: boolean; changedFiles: string[]; test?: string }): CheckStep[] {
  const steps: CheckStep[] = [];
  if (!input.nodeModulesPresent) steps.push({ name: "install", cmd: ["bun", "install", "--frozen-lockfile"] });
  steps.push({ name: "lint", cmd: ["bun", "run", "lint"] });
  steps.push({ name: "test", cmd: ["bun", "run", "test"] });
  if (input.changedFiles.some((f) => f.startsWith("src/figma_plugin/"))) {
    steps.push({ name: "build:plugin", cmd: ["bun", "run", "build:plugin"] });
  }
  if (input.test) steps.push({ name: `test ${input.test}`, cmd: ["bun", "test", input.test] });
  return steps;
}

// ---------------------------------------------------------------------------
// `verify-plan` comparison
// ---------------------------------------------------------------------------

/**
 * What in the plan no longer matches the worktree. `read(path)` returns the
 * file's text or undefined when it does not exist. Files the plan says to
 * create are exempt from the existence check.
 */
export function staleItems(plan: ParsedPlan, read: (path: string) => string | undefined): string[] {
  const stale: string[] = [];
  const contents = new Map<string, string | undefined>();
  for (const f of plan.files) {
    const text = read(f);
    contents.set(f, text);
    if (text === undefined && !plan.createdFiles.includes(f)) stale.push(`missing file ${f}`);
  }
  for (const s of plan.snippets) {
    if (!s.old.trim()) continue;
    const text = contents.get(s.file);
    if (text === undefined) continue; // reported above (or a file to create)
    if (!text.includes(s.old)) {
      stale.push(`${s.file}${s.line !== undefined ? `:${s.line}` : ""} old code not found: \`${s.old}\``);
    }
  }
  return stale;
}
