/**
 * Pure parsers for the auto-improve pipeline's two authoring artifacts:
 *
 *   - the improvement tracker (`.claude/analysis/improvement-tracker.md`):
 *     `## <section>` headings, `### [CATEGORY-NNN] Title` entries, and the
 *     `- **Field**: value` lines under each entry
 *   - fix plans (`.claude/plans/<date>-<ID>.md`): the `**Pattern**` /
 *     `**Priority**` / `**Partial**` header, `### File:` sections, and the
 *     `- Line N: \`old\` → \`new\`` snippets under them
 *
 * Nothing here touches the filesystem or `gh`, so every consumer
 * (`sync-tracker-issues.ts`, `dispatch-fix.ts`, `tracker.ts`) shares one
 * definition of "an entry" and the rules can be unit-tested on fixture text.
 *
 * `parseTracker` is the sync script's original inline parser moved verbatim —
 * `tests/tracker-parse.test.ts` pins it against a copy of that parser over the
 * real tracker, because Stage C's create/close decisions depend on it.
 */

// ---------------------------------------------------------------------------
// Tracker
// ---------------------------------------------------------------------------

export interface TrackerEntry {
  id: string; // TOOL-001
  cleanTitle: string; // header text with " — [#N]…" decoration stripped
  fullTitle: string; // "[TOOL-001] cleanTitle"
  priority: string; // P0 | P1 | P2 | ""
  category: string;
  body: string;
  issueRef?: number; // structured **Issue** field, else header /issues/N
  activeStatus?: string; // Status from a non-Resolved occurrence (authoritative)
  inResolved: boolean; // appeared under "## Resolved Issues"
  resolved: boolean; // derived after parsing
  resolvedReason: string; // for the close comment (never contradicts status)
}

export interface ParsedTracker {
  entries: TrackerEntry[];
  /** id → the heading it was found under, for entries outside the two known sections */
  misplaced: Map<string, string>;
  /** IDs reused for materially different titles */
  collisions: Set<string>;
}

export const KNOWN_SECTIONS = new Set(["active issues", "resolved issues"]);

export const isResolutionStatus = (s: string): boolean => /^(verified|resolved|implemented)\b/i.test(s);

// Issue ref from the HEADER line only (the entry's own link), never body prose.
const headerIssueRef = (titleLine: string): number | undefined => {
  const m = titleLine.match(/\/issues\/(\d+)/);
  return m?.[1] ? Number.parseInt(m[1], 10) : undefined;
};

const normTitle = (s: string): string => s.toLowerCase().replace(/[`*_]/g, "").replace(/\s+/g, " ").trim();

/** Is this `## heading` the Resolved section? Anchored: "Unresolved Issues" is not. */
export const isResolvedHeading = (heading: string): boolean => heading.toLowerCase().trim().startsWith("resolved");

/**
 * Parse the tracker text into deduplicated entries plus the two authoring-slip
 * reports the sync prints. Semantics (unchanged from the sync script):
 *
 *  - the same ID may appear under both Active and Resolved; the ACTIVE
 *    occurrence's Status is authoritative, a stale Resolved recap never marks a
 *    re-activated entry resolved
 *  - an ID that appears ONLY under Resolved is resolved
 *  - Status verified / resolved / implemented counts as resolved
 *  - only a heading starting with "resolved" is the Resolved section; every
 *    other heading is treated as active so its Status IS read; entries outside
 *    the two known headings are reported in `misplaced`
 *  - duplicates merge: richest body wins for display
 */
export function parseTrackerFull(raw: string): ParsedTracker {
  const lines = raw.split("\n");
  const byId = new Map<string, TrackerEntry>();
  const collisions = new Set<string>();

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
      // Same ID, materially different title ⇒ two different issues share an ID.
      if (normTitle(cleanTitle) !== normTitle(existing.cleanTitle)) {
        collisions.add(curId);
      }
      // Merge duplicates. Richest body wins for display; the ACTIVE occurrence's
      // status is authoritative; resolved-ness is derived later, not OR-ed here.
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
      // Optional structured override: `- **Issue**: #123` (preferred over header).
      const iss = line.match(/^- \*\*Issue\*\*:\s*#?(\d+)/);
      if (iss?.[1]) curIssue = Number.parseInt(iss[1], 10);
    }
  }
  commit();

  // Derive resolved-ness from the authoritative occurrence.
  for (const t of byId.values()) {
    if (t.activeStatus !== undefined) {
      t.resolved = isResolutionStatus(t.activeStatus);
      t.resolvedReason = t.resolved ? `status: ${t.activeStatus}` : "";
    } else {
      t.resolved = t.inResolved; // only appears under Resolved
      t.resolvedReason = t.inResolved ? "listed under Resolved Issues" : "";
    }
  }

  return { entries: [...byId.values()], misplaced, collisions };
}

/** The entries alone — what most consumers want. */
export function parseTracker(raw: string): TrackerEntry[] {
  return parseTrackerFull(raw).entries;
}

// ---------------------------------------------------------------------------
// Entry fields
// ---------------------------------------------------------------------------

export interface AutoFixable {
  verdict: "yes" | "no" | undefined;
  /** first token of the `yes (...)` parenthetical, backticks stripped */
  pattern?: string;
  /** the `no (...)` parenthetical, verbatim */
  reason?: string;
}

const AUTO_FIXABLE_RE = /^- \*\*Auto-fixable\*\*:\s*(yes|no)\b\s*(.*)$/im;

/** First token of a pattern field: strip backticks/asterisks, split on space, em dash, `(`/`)`. */
export function firstPatternToken(text: string): string | undefined {
  const token = text
    .replace(/^\(/, "")
    .replace(/[`*]/g, "")
    .trim()
    .split(/[\s—()]/)[0];
  return token ? token : undefined;
}

/** Read the entry's `- **Auto-fixable**:` line (from the richest occurrence's body). */
export function autoFixable(entry: Pick<TrackerEntry, "body">): AutoFixable {
  const m = entry.body.match(AUTO_FIXABLE_RE);
  if (!m) return { verdict: undefined };
  const verdict = (m[1] ?? "").toLowerCase() as "yes" | "no";
  const rest = (m[2] ?? "").trim();
  if (verdict === "yes") return { verdict, pattern: firstPatternToken(rest) };
  const reason = rest
    .replace(/^\(/, "")
    .replace(/\)\s*$/, "")
    .trim();
  return { verdict, reason: reason || undefined };
}

/** Dates (YYYY-MM-DD) carried by `- **Decision (2026-09-02)**:` lines in the body. */
export function decisionDates(entry: Pick<TrackerEntry, "body">): string[] {
  const out: string[] = [];
  for (const m of entry.body.matchAll(/^- \*\*Decision\s*\((\d{4}-\d{2}-\d{2})\)\*\*/gim)) {
    if (m[1]) out.push(m[1]);
  }
  return out;
}

/** The first word of the Status line, lowercased — `implemented — PR #3` → `implemented`. */
export function statusToken(status: string | undefined): string {
  return (
    (status ?? "")
      .trim()
      .split(/[\s—(]/)[0]
      ?.toLowerCase() ?? ""
  );
}

/**
 * Return new tracker text with `- **<field>**:` on the entry `id` set to `value`.
 * Targets the entry's ACTIVE occurrence (the authoritative one); falls back to
 * its first occurrence when it only appears under Resolved. When the entry has
 * no such line, one is inserted right after its Status line (or as the first
 * body line when there is no Status line). Every other byte is preserved.
 * Returns the input unchanged when the entry is not found.
 */
export function updateEntryField(text: string, id: string, field: string, value: string): string {
  const lines = text.split("\n");
  const headingRe = new RegExp(`^### \\[${escapeRegExp(id)}\\]\\s`);
  const fieldRe = new RegExp(`^- \\*\\*${escapeRegExp(field)}\\*\\*:`);

  // Locate every occurrence as [start, endExclusive) line ranges with its section.
  const occurrences: Array<{ start: number; end: number; resolved: boolean }> = [];
  let resolvedSection = false;
  let open: { start: number; resolved: boolean } | undefined;
  const close = (at: number): void => {
    if (open) occurrences.push({ start: open.start, end: at, resolved: open.resolved });
    open = undefined;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (/^## /.test(line)) {
      close(i);
      resolvedSection = isResolvedHeading(line.slice(3));
      continue;
    }
    if (/^### \[[A-Z]+-\d+\]/.test(line)) {
      close(i);
      if (headingRe.test(line)) open = { start: i, resolved: resolvedSection };
    }
  }
  close(lines.length);
  if (occurrences.length === 0) return text;

  const target = occurrences.find((o) => !o.resolved) ?? occurrences[0];
  if (!target) return text;
  const newLine = `- **${field}**: ${value}`;

  for (let i = target.start + 1; i < target.end; i++) {
    if (fieldRe.test(lines[i] ?? "")) {
      lines[i] = newLine;
      return lines.join("\n");
    }
  }
  // Absent: insert after the Status line, else directly under the heading.
  let insertAt = target.start + 1;
  for (let i = target.start + 1; i < target.end; i++) {
    if (/^- \*\*Status\*\*:/.test(lines[i] ?? "")) {
      insertAt = i + 1;
      break;
    }
  }
  lines.splice(insertAt, 0, newLine);
  return lines.join("\n");
}

/** The raw text of an entry's active occurrence (heading + body), or undefined. */
export function entryText(text: string, id: string): string | undefined {
  const lines = text.split("\n");
  const headingRe = new RegExp(`^### \\[${escapeRegExp(id)}\\]\\s`);
  const found: Array<{ lines: string[]; resolved: boolean }> = [];
  let resolvedSection = false;
  let cur: { lines: string[]; resolved: boolean } | undefined;
  for (const line of lines) {
    if (/^## /.test(line)) {
      cur = undefined;
      resolvedSection = isResolvedHeading(line.slice(3));
      continue;
    }
    if (/^### \[[A-Z]+-\d+\]/.test(line)) {
      cur = headingRe.test(line) ? { lines: [line], resolved: resolvedSection } : undefined;
      if (cur) found.push(cur);
      continue;
    }
    if (cur) cur.lines.push(line);
  }
  const pick = found.find((f) => !f.resolved) ?? found[0];
  return pick ? pick.lines.join("\n").trimEnd() : undefined;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------------------------------------------------------------------------
// Fix plans
// ---------------------------------------------------------------------------

export interface PlanSnippet {
  file: string;
  line: number | undefined;
  old: string;
  new: string;
}

export interface ParsedPlan {
  /** first token of `**Pattern**`, backticks stripped; undefined when the line is absent */
  pattern: string | undefined;
  /** first token of `**Priority**` (P0 | P1 | P2), undefined when absent */
  priority: string | undefined;
  /** paths from `### File:` headings, in order, deduplicated */
  files: string[];
  /** `### File:` headings whose remainder says the file is to be created */
  createdFiles: string[];
  /** `**Partial**: yes` present */
  partial: boolean;
  /** a `tests/...` path named on the Verification line that mentions `bun run test` */
  namedTest: string | undefined;
  /** `- Line N: \`old\` → \`new\`` items under each `### File:` section */
  snippets: PlanSnippet[];
}

const FILE_HEADING_RE = /^###\s+File:\s*(.+?)\s*$/;

function fileFromHeading(rest: string): { path: string; remainder: string } | undefined {
  const bt = rest.match(/^`([^`]+)`(.*)$/);
  if (bt?.[1]) return { path: bt[1].trim(), remainder: (bt[2] ?? "").trim() };
  const plain = rest.match(/^(\S+)(.*)$/);
  if (plain?.[1]) return { path: plain[1].replace(/[,;:]+$/, ""), remainder: (plain[2] ?? "").trim() };
  return undefined;
}

export function parsePlan(text: string): ParsedPlan {
  const lines = text.split("\n");
  let pattern: string | undefined;
  let priority: string | undefined;
  let partial = false;
  let namedTest: string | undefined;
  const files: string[] = [];
  const createdFiles: string[] = [];
  const snippets: PlanSnippet[] = [];
  let curFile: string | undefined;
  let inFence = false;

  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const pat = line.match(/^\*\*Pattern\*\*:\s*(.+)$/);
    if (pat && pattern === undefined) {
      pattern = firstPatternToken(pat[1] ?? "");
      continue;
    }
    const pri = line.match(/^\*\*Priority\*\*:\s*(.+)$/);
    if (pri && priority === undefined) {
      priority = firstPatternToken(pri[1] ?? "")?.toUpperCase();
      continue;
    }
    const part = line.match(/^\*\*Partial\*\*:\s*(\S+)/);
    if (part) {
      partial = partial || /^yes\b/i.test(part[1] ?? "");
      continue;
    }

    const fh = line.match(FILE_HEADING_RE);
    if (fh) {
      const f = fileFromHeading(fh[1] ?? "");
      curFile = f?.path;
      if (f) {
        if (!files.includes(f.path)) files.push(f.path);
        if (/\bcreate\b/i.test(f.remainder) && !createdFiles.includes(f.path)) createdFiles.push(f.path);
      }
      continue;
    }
    if (/^#{1,3}\s/.test(line) && !/^###\s+File:/.test(line)) {
      // Any other heading ends the current File section.
      curFile = undefined;
    }

    if (curFile) {
      const snip = line.match(/^\s*-\s*Line\s+(\d+)?\s*:?\s*`([^`]*)`\s*(?:→|->)\s*`([^`]*)`/);
      if (snip) {
        snippets.push({
          file: curFile,
          line: snip[1] ? Number.parseInt(snip[1], 10) : undefined,
          old: snip[2] ?? "",
          new: snip[3] ?? "",
        });
      }
    }

    if (namedTest === undefined && /bun (run )?test\b/.test(line) && /^\s*-\s*\[.\]/.test(line)) {
      const full = line.match(/\btests\/[\w./-]+/);
      if (full?.[0]) namedTest = full[0].replace(/[`.,:]+$/, "");
      else {
        const bare = line.match(/`([\w-]+\.test\.ts)`/);
        if (bare?.[1]) namedTest = `tests/${bare[1]}`;
      }
    }
  }

  return { pattern, priority, files, createdFiles, partial, namedTest, snippets };
}

/** Does this plan filename belong to `id`? `2026-09-02-TOOL-040.md` ↔ TOOL-040, not TOOL-0400. */
export function planFileMatchesId(filename: string, id: string): boolean {
  if (!filename.endsWith(".md")) return false;
  return new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(id)}(?![0-9])`).test(filename);
}

/** Pick the plan for `id` from a directory listing: the lexicographically last match (latest date prefix). */
export function planFileFor(id: string, listing: string[]): string | undefined {
  const matches = listing.filter((f) => planFileMatchesId(f, id)).sort();
  return matches.length ? matches[matches.length - 1] : undefined;
}
