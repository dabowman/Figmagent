import { z } from "zod";

// Custom logging functions that write to stderr instead of stdout to avoid being captured
export const logger = {
  info: (message: string) => process.stderr.write(`[INFO] ${message}\n`),
  debug: (message: string) => process.stderr.write(`[DEBUG] ${message}\n`),
  warn: (message: string) => process.stderr.write(`[WARN] ${message}\n`),
  error: (message: string) => process.stderr.write(`[ERROR] ${message}\n`),
  log: (message: string) => process.stderr.write(`[LOG] ${message}\n`),
};

// ─── Shared tool parameter schemas ──────────────────────────────────────────

/**
 * Numeric tool parameter that also accepts a numeric string — agents routinely
 * quote numbers (`"4"` for a radius, `"0.85"` for a color channel), and a plain
 * `z.number()` rejects them, cancelling the whole parallel batch ([TOOL-006]).
 *
 * Deliberately NOT `z.coerce.number()`: that runs `Number(value)` on everything,
 * so `null`, `""`, `false` and `[]` all become 0 and are silently applied — an
 * `opacity: null` would turn the node invisible instead of erroring, and a color
 * missing a required channel would report "Expected number, received nan"
 * instead of "Required". Only non-empty strings are converted here; every other
 * wrong type stays the hard error it was before.
 */
export const numericParam = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((value) => (typeof value === "string" && value.trim() !== "" ? Number(value) : value), schema);

// The array-valued sibling of `numericParam` ([BUG-021]): agents pass a single
// value as a bare string ("COMPONENT") — the shape every scalar param takes —
// and a plain `z.array(z.string())` answers with a raw "expected array,
// received string" Zod dump that states no fix.
//
// The trailing checks are load-bearing: a list that carries no usable value is
// rejected rather than normalized to `[]` or `[""]`. Either shape builds an id
// set in the plugin that can never match (find.js only length-guards `type`;
// componentId/variableId/styleId go straight into `buildIdSet`), so the call
// would silently return zero results instead of saying what went wrong. The
// array arm needs the same guard as the scalar arm — an array passes through
// untouched, so `["FRAME", ""]` would otherwise keep its blank entry.
// Both are factories, like `numericParam`, rather than shared consts: reusing one
// schema instance across several fields makes zod-to-json-schema emit the later
// ones as `{"$ref": "#/properties/<first>", "description": …}`, and a consumer
// reading draft-07 `$ref` semantics discards that sibling description — which is
// where the "accepts a bare string" guidance lives. A fresh instance per field
// keeps every criterion's description intact in the advertised inputSchema.
const EMPTY_LIST_MESSAGE = "empty value. Fix: pass at least one non-empty value, or omit the parameter entirely";

const scalarTolerantList = (toValues: (value: string) => string[]) =>
  z
    .array(z.string())
    .or(z.string().transform(toValues))
    .pipe(
      z
        .array(z.string())
        .min(1, EMPTY_LIST_MESSAGE)
        .refine((values) => values.every((value) => value.trim() !== ""), EMPTY_LIST_MESSAGE),
    );

/** String-list parameter accepting an array, a bare string, or a comma-separated string. */
export const stringListParam = () =>
  scalarTolerantList((value) =>
    value
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean),
  );

/**
 * Same, minus the comma splitting — for parameters whose values may themselves
 * contain a comma. Figma style IDs do (`"S:abc123,"`, `"S:abc123,4:5"`), so
 * splitting one silently corrupts it into a criterion that can never match.
 * Pass several ids as an array.
 */
export const idListParam = () => scalarTolerantList((value) => (value.trim() === "" ? [] : [value.trim()]));

/** RGBA color parameter (0-1 channels) shared by the `write` and `edit` tools. */
export const colorSchema = z
  .object({
    r: numericParam(z.number().min(0).max(1)).describe("Red (0-1)"),
    g: numericParam(z.number().min(0).max(1)).describe("Green (0-1)"),
    b: numericParam(z.number().min(0).max(1)).describe("Blue (0-1)"),
    a: numericParam(z.number().min(0).max(1)).optional().describe("Alpha (0-1)"),
  })
  .optional();

/** A node id as a Figma URL writes it — every `:` replaced by a `-`. */
const URL_FORM_NODE_ID = /^I?\d+-\d+(?:;I?\d+-\d+)*$/;

/**
 * Figma deep-link URLs encode node IDs with a hyphen (`?node-id=43-14`) while the
 * Plugin API expects a colon (`43:14`). Agents routinely lift an ID straight out of
 * a URL the user pasted and get a bare "Node not found" — and `use_file` already
 * tolerates the full hyphenated URL, so within one session the same ID format is
 * accepted by one tool and rejected by the next.
 *
 * Only the unambiguous URL shape is normalized: a hyphenated pair, optionally
 * chained into an instance-descendant path (`I43-14;66-19`, which is how a link
 * to a layer inside an instance arrives). Such a string can never be a valid
 * Plugin API id — those always use colons — so the swap is lossless. An
 * already-correct id (`43:14`, `I103:1135;66:19`, the `0:0` document sentinel),
 * the "DOCUMENT" scope keyword and every other string pass through untouched.
 */
export function normalizeNodeId(id: string): string {
  return URL_FORM_NODE_ID.test(id) ? id.replace(/-/g, ":") : id;
}

/**
 * Node-ID tool parameter — a `z.string()` that normalizes the URL form. Every
 * schema accepting a node ID calls this (or `z.array(nodeIdParam())`) instead of
 * a bare `z.string()`: hand-applying `.transform()` per call site left fifteen
 * node-ID params un-normalized on the first pass, including `grep`'s
 * `componentId`, where an unconverted id matches nothing and returns an empty
 * result set rather than an error. `tests/node-id-normalization.test.ts` sweeps
 * the registered tools so a new param cannot quietly miss it again.
 *
 * A factory, not a shared constant, for the same reason `numericParam` is one:
 * `zod-to-json-schema` collapses a schema *instance* reused within one tool into
 * a `$ref`, and the SDK emits draft-07, where a `$ref` sibling `description` is
 * ignored — so sharing one instance would silently strip the per-parameter
 * descriptions the agent reads off the tool schema.
 */
export const nodeIdParam = () => z.string().transform(normalizeNodeId);

/**
 * Node-ID list parameter — `stringListParam`'s scalar/array/comma tolerance
 * ([BUG-021]) with the URL-form conversion applied to every element, for criteria
 * like `grep`'s `componentId` that take several node ids. Needed as its own
 * helper because the two fixes compose in one direction only: the list coercion
 * has to run first so the transform sees a `string[]`.
 */
export const nodeIdListParam = () => stringListParam().transform((ids) => ids.map(normalizeNodeId));

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
  /**
   * When true, the truncation message states that raising maxOutputChars does
   * NOT help (the underlying data is intrinsically large — filter instead) and
   * the "pass maxOutputChars: N" suggestion line is omitted.
   */
  filterInsteadOfRaising?: boolean;
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
  const lastLine = options.filterInsteadOfRaising
    ? `Prefer filtering (e.g. collection/namePattern/styleType) over raising maxOutputChars — for moderate overflows pass maxOutputChars: ${Math.min(text.length + 1000, 200_000)}, but very large systems may still hit the ${(200_000).toLocaleString()}-char transport cap, so a filtered query is the reliable path.`
    : `To get full output, pass maxOutputChars: ${Math.min(text.length + 1000, 200_000)}.`;
  const msg = [
    `Output truncated: ${text.length.toLocaleString()} chars exceeds budget of ${max.toLocaleString()}.`,
    hintBlock,
    lastLine,
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
