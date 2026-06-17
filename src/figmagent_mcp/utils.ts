// Custom logging functions that write to stderr instead of stdout to avoid being captured
export const logger = {
  info: (message: string) => process.stderr.write(`[INFO] ${message}\n`),
  debug: (message: string) => process.stderr.write(`[DEBUG] ${message}\n`),
  warn: (message: string) => process.stderr.write(`[WARN] ${message}\n`),
  error: (message: string) => process.stderr.write(`[ERROR] ${message}\n`),
  log: (message: string) => process.stderr.write(`[LOG] ${message}\n`),
};

// ─── Post-Write Warnings (Phase 4.1) ────────────────────────────────────────

export interface FigmaWarning {
  nodeId?: string;
  check?: string;
  message: string;
}

/**
 * Format the `warnings` array a plugin write command returned into a text
 * block appended after the main JSON response. Returns "" when there are no
 * warnings (the block is omitted entirely).
 */
export function formatWarningsBlock(warnings: unknown): string {
  if (!Array.isArray(warnings) || warnings.length === 0) return "";
  const lines = warnings.map((w) => {
    const warning = w as FigmaWarning;
    const check = warning.check ? `[${warning.check}] ` : "";
    const nodeId = warning.nodeId ? `${warning.nodeId}: ` : "";
    return `- ${check}${nodeId}${warning.message}`;
  });
  return `\n\nwarnings:\n${lines.join("\n")}`;
}

// ─── Output Budget System ────────────────────────────────────────────────────

export const DEFAULT_MAX_OUTPUT_CHARS = 30_000;

export interface GuardOptions {
  /** Override default budget (chars). */
  maxChars?: number;
  /** Extract a preserved header (meta/summary) from the output. */
  metaExtractor?: (text: string) => string | null;
  /** Tool name for the truncation message. */
  toolName: string;
  /** Tool-specific hints for narrowing the query. */
  narrowingHints?: string[];
}

export interface GuardResult {
  text: string;
  truncated: boolean;
}

/**
 * Check output string against a character budget.
 * If under budget, return as-is. If over, return a truncation message
 * with the preserved meta/summary and actionable instructions.
 */
export function guardOutput(text: string, options: GuardOptions): GuardResult {
  const max = options.maxChars ?? DEFAULT_MAX_OUTPUT_CHARS;
  if (text.length <= max) {
    return { text, truncated: false };
  }

  // Try to extract a meta/summary section to preserve
  let preserved = "";
  if (options.metaExtractor) {
    const meta = options.metaExtractor(text);
    if (meta) preserved = meta + "\n\n";
  }

  const hints = options.narrowingHints ?? [];
  const hintBlock = hints.length > 0 ? "\n" + hints.join("\n") + "\n" : "";
  const msg = [
    `Output truncated: ${text.length.toLocaleString()} chars exceeds budget of ${max.toLocaleString()}.`,
    hintBlock,
    `To get full output, pass maxOutputChars: ${Math.min(text.length + 1000, 200_000)}.`,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    text: preserved + msg,
    truncated: true,
  };
}

// ─── Group Pagination (Issue #57) ────────────────────────────────────────────

export interface PaginateOptions {
  /** Per-page character budget. Defaults to DEFAULT_MAX_OUTPUT_CHARS. */
  maxChars?: number;
  /** 1-based page index to return. Defaults to 1. */
  page?: number;
}

export interface PaginateResult<T> {
  /** The groups that fit on the requested page. */
  items: T[];
  /** 1-based index of the returned page. */
  page: number;
  /** Total number of pages needed to cover every group at this budget. */
  pageCount: number;
  /** Total number of groups across all pages. */
  totalGroups: number;
  /** True when more than one page is required. */
  paginated: boolean;
  /**
   * True when the requested page was beyond `pageCount` and got clamped to the
   * last page (so the caller knows the returned data isn't the page it asked
   * for). False when no page was requested or the request was in range.
   */
  outOfRange: boolean;
}

/**
 * Split an array of groups into budget-sized pages, packing groups greedily
 * until adding the next one would exceed `maxChars`, then return the requested
 * page. `sizeOf` measures one group's serialized size (in characters); a small
 * per-group overhead absorbs separators/wrapping so the rendered page stays
 * under budget.
 *
 * A single group larger than the budget on its own still occupies its own page
 * (it can't be split further here) — that case is the caller's signal to narrow
 * the query, but pagination never drops a group.
 *
 * This is additive: callers that don't paginate keep using guardOutput.
 */
export function paginateGroups<T>(
  groups: T[],
  sizeOf: (group: T) => number,
  options: PaginateOptions = {},
): PaginateResult<T> {
  const max = options.maxChars ?? DEFAULT_MAX_OUTPUT_CHARS;
  // Reserve room for separators/wrapping rendered around each group.
  const perGroupOverhead = 8;
  const budget = Math.max(1, max);

  // Build pages greedily.
  const pages: T[][] = [];
  let current: T[] = [];
  let currentSize = 0;
  for (const group of groups) {
    const groupSize = sizeOf(group) + perGroupOverhead;
    if (current.length > 0 && currentSize + groupSize > budget) {
      pages.push(current);
      current = [];
      currentSize = 0;
    }
    current.push(group);
    currentSize += groupSize;
  }
  if (current.length > 0) pages.push(current);
  if (pages.length === 0) pages.push([]);

  const pageCount = pages.length;
  const askedFor = Math.max(1, Math.floor(options.page ?? 1));
  const clamped = Math.min(askedFor, pageCount);

  return {
    items: pages[clamped - 1],
    page: clamped,
    pageCount,
    totalGroups: groups.length,
    paginated: pageCount > 1,
    // Only an explicit page request can be out of range; the default (page 1)
    // never overshoots since pageCount >= 1.
    outOfRange: options.page !== undefined && askedFor > pageCount,
  };
}

/** Extract YAML meta section (everything from "meta:" to the next top-level key). */
export function extractYamlMeta(text: string): string | null {
  // Match "meta:" through the end of its indented block, stopping at the next
  // top-level key (a line starting with a non-space character followed by colon).
  const match = text.match(/^meta:\n(?:[ \t]+.*\n?)*/m);
  return match ? match[0].trim() : null;
}

/** Extract top-level JSON summary (scalar values + array lengths). */
export function extractJsonSummary(text: string): string | null {
  try {
    const obj = JSON.parse(text);
    const summary: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v === null || v === undefined || typeof v !== "object") {
        summary[k] = v;
      } else if (Array.isArray(v)) {
        summary[k] = `[${v.length} items]`;
      } else {
        const keys = Object.keys(v);
        summary[k] = `{${keys.length} keys}`;
      }
    }
    return JSON.stringify(summary, null, 2);
  } catch {
    return text.slice(0, 500) + "...";
  }
}
