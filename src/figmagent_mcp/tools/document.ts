import { z } from "zod";
import { server } from "../instance.js";
import { sendCommandToFigma } from "../connection.js";
import { serializeYaml } from "../yaml.js";
import { guardOutput, extractYamlMeta, nodeIdParam } from "../utils.js";

// ─── FSGN helpers ────────────────────────────────────────────────────────────

function replaceRefStr(
  str: string,
  varMap: Map<string, string>,
  styleMap: Map<string, string>,
  compMap: Map<string, string>,
): string {
  if (str.startsWith("VAR::")) return varMap.get(str.slice(5)) ?? str;
  if (str.startsWith("STYLE::")) return styleMap.get(str.slice(7)) ?? str;
  if (str.startsWith("COMP::")) return compMap.get(str.slice(6)) ?? str;
  return str;
}

function replaceRefs(
  obj: unknown,
  varMap: Map<string, string>,
  styleMap: Map<string, string>,
  compMap: Map<string, string>,
): void {
  if (!obj || typeof obj !== "object") return;
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      if (typeof obj[i] === "string") {
        obj[i] = replaceRefStr(obj[i] as string, varMap, styleMap, compMap);
      } else {
        replaceRefs(obj[i], varMap, styleMap, compMap);
      }
    }
  } else {
    const rec = obj as Record<string, unknown>;
    for (const key of Object.keys(rec)) {
      if (typeof rec[key] === "string") {
        rec[key] = replaceRefStr(rec[key] as string, varMap, styleMap, compMap);
      } else {
        replaceRefs(rec[key], varMap, styleMap, compMap);
      }
    }
  }
}

/**
 * BUG-027 — an empty transport envelope is not an empty document. When the
 * remote path returns a result with no `rootId` (a dropped/failed `get_node_tree`),
 * `buildFsgn` happily serializes `nodeId: undefined` with `nodeCount: 0` and the
 * caller reads a *successful* response describing a document with nothing in it —
 * the worst possible failure mode, because nothing about it looks like an error.
 * Mirrors the `hasImageData` guard in `export.ts` (BUG-016), which closed the same
 * hole for image results and left it open everywhere else.
 */
export function hasNodeTree(raw: any): boolean {
  return !!raw && typeof raw === "object" && typeof raw.rootId === "string" && raw.rootId.length > 0;
}

/** Same guard for the document overview — a real overview identifies a page. */
export function hasDocumentInfo(raw: any): boolean {
  return !!raw && typeof raw === "object" && (typeof raw.id === "string" || Array.isArray(raw.pages));
}

/**
 * Fix-stating text for reads whose transport returned no tree (BUG-027).
 *
 * The remedy is a SMALLER payload, not a verbatim retry: the mechanism is a
 * response that did not survive the round trip, and sessions 51/52 re-ran
 * identical params for identical failures, then succeeded on the same node at
 * `detail="structure"` / a lower `depth`. Never state a cause this guard cannot
 * observe — confidently-wrong remedy text is what made the `export.ts` guard
 * actively harmful.
 *
 * `wholeCall` says whether these ids are the entire request. It only controls
 * whether ids may be elided: a single shared reason across the WHOLE call is a
 * call-level cause ("Not connected to Figma", "Multiple Figma files are open")
 * and reads better stated once. In a PARTIAL failure the ids are the whole
 * point — the caller cannot act on "some of your nodes failed" — so they are
 * always named, however much the reasons repeat.
 */
export function missingTreeMessage(missingIds: string[], errors?: Map<string, string>, wholeCall = true): string {
  const reason = (id: string) => (errors ? errors.get(id) : undefined);
  const reported = missingIds.filter((id) => reason(id));
  const silent = missingIds.filter((id) => !reason(id));

  // A node that failed with a message of its own gets that message verbatim: it
  // already states its fix (node not found, timed out, not connected), and
  // guessing at a round-trip failure over it would be a cause we never observed.
  if (silent.length === 0) {
    const distinct = Array.from(new Set(reported.map((id) => reason(id) as string)));
    const detail =
      wholeCall && distinct.length === 1 ? distinct[0] : reported.map((id) => `${id}: ${reason(id)}`).join(" | ");
    return `Error reading nodes: ${detail}`;
  }

  const target = silent.length === 1 ? `node ${silent[0]}` : `nodes ${silent.join(", ")}`;
  return (
    `Error reading nodes: the request for ${target} returned no node tree. ` +
    "The response did not survive the round trip, so this is a transport failure — not an empty node. " +
    'Fix: re-request a smaller payload (lower `depth`, or `detail="structure"`), or read the ids one at a ' +
    "time — a verbatim retry usually fails the same way. If a smaller read comes back empty too, confirm " +
    "the id belongs to the selected file (use_file)." +
    (reported.length > 0 ? ` Other failures — ${reported.map((id) => `${id}: ${reason(id)}`).join(" | ")}` : "")
  );
}

/** Every requested node failed — the whole read failed (BUG-027). */
export function buildMissingTreeResult(missingIds: string[], errors?: Map<string, string>) {
  return {
    content: [{ type: "text" as const, text: missingTreeMessage(missingIds, errors) }],
    isError: true,
  };
}

/** The document overview carried no page data — same hole, overview branch (BUG-027). */
export function buildMissingDocumentResult() {
  return {
    content: [
      {
        type: "text" as const,
        text:
          "Error reading document: the document overview returned no page data. " +
          "The response did not survive the round trip, so this is a transport failure — not an empty file. " +
          "Fix: retry read() once; if it fails again, confirm a file is selected (use_file on the remote " +
          "transport) and that the Figma plugin and relay are still connected.",
      },
    ],
    isError: true,
  };
}

function buildFsgn(raw: any, params: any): string {
  const detail: string = params.detail ?? "layout";
  const depth: number | undefined = params.depth;

  const varMap = new Map<string, string>();
  const styleMap = new Map<string, string>();
  const compMap = new Map<string, string>();
  let vi = 1,
    si = 1,
    ci = 1;

  const defs: Record<string, Record<string, unknown>> = { vars: {}, styles: {}, components: {} };

  for (const [id, info] of Object.entries(raw.collectedVars ?? {})) {
    const ref = `v${vi++}`;
    varMap.set(id, ref);
    defs.vars[ref] = info as Record<string, unknown>;
  }
  for (const [id, info] of Object.entries(raw.collectedStyles ?? {})) {
    const ref = `s${si++}`;
    styleMap.set(id, ref);
    defs.styles[ref] = info as Record<string, unknown>;
  }
  for (const [id, info] of Object.entries(raw.collectedComponents ?? {})) {
    const ref = `c${ci++}`;
    compMap.set(id, ref);
    defs.components[ref] = info as Record<string, unknown>;
  }

  // Deep-clone rawTree before mutating refs
  const treeClone = JSON.parse(JSON.stringify(raw.rawTree ?? []));
  replaceRefs(treeClone, varMap, styleMap, compMap);

  const nodeCount: number = raw.nodeCount ?? 0;
  const defCount = vi - 1 + (si - 1) + (ci - 1);
  const tokenMultiplier = detail === "structure" ? 5 : detail === "full" ? 30 : 15;
  const tokenEstimate = nodeCount * tokenMultiplier + defCount * 10;
  const truncated = tokenEstimate > 8000;

  const meta: Record<string, unknown> = {
    nodeId: raw.rootId,
    name: raw.rootName,
    type: raw.rootType,
    detail,
    nodeCount,
    tokenEstimate,
  };
  if (depth !== undefined) meta.depth = depth;
  if (truncated) {
    meta.truncated = true;
    meta.truncationWarning =
      "Response exceeds 8000 token estimate. Consider narrowing with depth, filter, or detail=structure.";
  }
  if (raw.variantAxes && Object.keys(raw.variantAxes).length > 0) {
    meta.variantAxes = raw.variantAxes;
    if (raw.defaultVariant) meta.defaultVariant = raw.defaultVariant;
  }

  return serializeYaml({ meta, defs, nodes: treeClone });
}

/**
 * Assemble the `read` response from the per-node transport results. Exported so
 * the BUG-027 empty/partial decision is testable without a transport.
 *
 * A node whose result carries no tree is never rendered. When EVERY node failed
 * the whole call is flagged `isError`; when only some failed, the nodes that did
 * arrive are still returned and the failure is named in a trailing block — the
 * same shape as `buildBatchExportResult`, and consistent with the project rule
 * that a partial batch failure stays `is_error: false`. Discarding the subtrees
 * that did arrive would cost a full re-read: multi-node reads are exactly where
 * an oversized response fails, so re-issuing the same batch reproduces it.
 *
 * `errors` carries the per-node rejection messages (timeout, node not found,
 * not connected) so one bad id in a batch neither hides its own reason nor
 * takes its siblings down with it.
 */
export function buildReadResult(ids: string[], results: unknown[], params: any, errors?: Map<string, string>) {
  const missing = ids.filter((_id, i) => !hasNodeTree(results[i]));
  if (missing.length === ids.length) return buildMissingTreeResult(missing, errors);

  // Build FSGN for each node that survived the round trip
  const yamls = results.filter((raw) => hasNodeTree(raw)).map((raw) => buildFsgn(raw, params));
  const output = yamls.length === 1 ? yamls[0] : yamls.join("\n---\n");

  // Apply output budget guard
  const guarded = guardOutput(output, {
    maxChars: params.maxOutputChars,
    metaExtractor: extractYamlMeta,
    toolName: "read",
    narrowingHints: [
      "  • Lower depth — try depth=1 or depth=2",
      '  • Use detail="structure" (~5 tokens/node)',
      "  • Target a specific child node instead of the whole subtree",
      "  • Use grep() to locate the nodes you need first",
    ],
  });

  const content: { type: "text"; text: string }[] = [{ type: "text", text: guarded.text }];
  // Trailing, not leading: `looksLikeError` is start-anchored, so a partial read
  // stays unflagged (per CLAUDE.md) while still naming what did not arrive.
  // wholeCall: false so the ids are always named here — in a partial read they
  // are the actionable part, even when several nodes failed for the same reason.
  if (missing.length > 0) content.push({ type: "text", text: missingTreeMessage(missing, errors, false) });
  return { content };
}

// ─── Tools ───────────────────────────────────────────────────────────────────

// Selection Tool
server.tool(
  "get_selection",
  "Get the user's current selection in Figma. Returns selected node IDs and basic info. If empty, ask the user to select something. Use read(nodeId) on the result to read details.",
  {},
  async () => {
    try {
      const result = await sendCommandToFigma("get_selection");
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error getting selection: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  },
);

// Read Tool — read nodes and their subtrees (or the document overview)
server.tool(
  "read",
  `Read one or more Figma nodes and their subtrees. Returns structured YAML (FSGN format) with deduplicated variable, style, and component definitions.

Called with NO nodeId/nodeIds, returns the document overview: pages and top-level frames. Use that first to orient yourself.

IMPORTANT: Always start with detail="structure" and depth=2 for orientation. Only increase detail or depth after reviewing the structure. Going straight to detail="full" with high depth risks hitting the output budget.

Detail levels (pick the cheapest that works):
  - "structure": IDs, names, types, child counts only (~5 tokens/node). Use first.
  - "layout": + dimensions, auto-layout, text content, componentRef/properties (~15 tokens/node). Use for building.
  - "full": + fills, strokes, variable bindings, text styles (~30 tokens/node). Use for styling.

Workflow: read() (document overview) → read(nodeId, detail="structure", depth=2) → narrow with depth/filter → read specific nodes at higher detail.
Use grep() to locate nodes by criteria before calling read() on them.
Instances are leaf nodes by default — call read on the instance ID to expand its internals.`,
  {
    nodeId: nodeIdParam()
      .optional()
      .describe("ID of a single node to read. Omit (and nodeIds) for the document overview."),
    nodeIds: z.array(nodeIdParam()).optional().describe("IDs of multiple nodes to read in parallel"),
    detail: z
      .enum(["structure", "layout", "full"])
      .optional()
      .describe(
        'Detail level. "structure": id/name/type/childCount only. "layout": + dimensions, auto-layout, text, component refs. "full": + fills, strokes, variable bindings, text styles. Default: "layout"',
      ),
    depth: z.coerce
      .number()
      .int()
      .min(0)
      .optional()
      .describe(
        "Max traversal depth. Omit for unlimited (instances treated as leaf nodes). depth=0: root only. depth=1: root + children. depth=3 recommended for component internals.",
      ),
    filter: z
      .object({
        types: z
          .array(z.string())
          .optional()
          .describe(
            'Whitelist of node types to include (e.g. ["FRAME","TEXT"]). Container nodes are always traversed; non-matching nodes are excluded from output.',
          ),
        namePattern: z
          .string()
          .optional()
          .describe(
            "Regex matched against node name. Non-matching nodes excluded from output, containers still traversed.",
          ),
        visibleOnly: z.boolean().optional().describe("Skip invisible nodes. Default: true"),
      })
      .optional(),
    includeVariables: z
      .boolean()
      .optional()
      .describe("Resolve bound variable names and collections in defs.vars. Default: true"),
    includeStyles: z.boolean().optional().describe("Resolve named text/effect style IDs in defs.styles. Default: true"),
    includeComponentMeta: z
      .boolean()
      .optional()
      .describe("Include component key, parent info for instances in defs.components. Default: true"),
    maxOutputChars: z.coerce
      .number()
      .int()
      .min(1000)
      .optional()
      .describe("Max response size in characters. Default: 30000. Raise when you need full unfiltered data."),
  },
  async (params: any) => {
    try {
      // Collect all node IDs from nodeId and/or nodeIds
      const ids: string[] = [];
      if (params.nodeId) ids.push(params.nodeId);
      if (params.nodeIds) ids.push(...params.nodeIds);

      // No node IDs → document overview (pages + top-level frames)
      if (ids.length === 0) {
        const overview = await sendCommandToFigma("get_document_info");
        // The same hole one branch up: an overview carrying no page data never
        // reached the document — don't render it as an empty-but-successful file.
        if (!hasDocumentInfo(overview)) return buildMissingDocumentResult();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(overview),
            },
          ],
        };
      }

      // Fetch all nodes in parallel, each via the plugin's get_node_tree command.
      // allSettled, not all: one stale id or one timed-out node must not discard
      // the siblings that came back fine — its own reason is reported per node.
      const settled = await Promise.allSettled(
        ids.map((id) => sendCommandToFigma("get_node_tree", { ...params, nodeId: id, nodeIds: undefined }, 60000)),
      );
      const results = settled.map((outcome) => (outcome.status === "fulfilled" ? outcome.value : undefined));
      const errors = new Map<string, string>();
      settled.forEach((outcome, i) => {
        if (outcome.status === "rejected") {
          errors.set(ids[i], outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason));
        }
      });

      // A result with no rootId never reached the document — refuse to render it
      // as an empty-but-successful read (BUG-027).
      return buildReadResult(ids, results, params, errors);
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error reading nodes: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  },
);
