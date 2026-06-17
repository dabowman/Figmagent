import { z } from "zod";
import { server } from "../instance.js";
import { sendCommandToFigma } from "../connection.js";
import { serializeYaml } from "../yaml.js";
import { guardOutput, extractYamlMeta, paginateGroups, DEFAULT_MAX_OUTPUT_CHARS } from "../utils.js";

server.tool(
  "grep",
  `Search a Figma subtree for nodes matching a regex pattern or other criteria. Returns matches grouped by nearest component/frame ancestor with ancestry paths.

The text, name, and annotation criteria are regex patterns matched against text content, node names, and annotation labels respectively.

Criteria combine with AND (all must match). Within each criterion, values combine with OR.

Search criteria (at least one required):
- text: regex pattern matched against TEXT node content
- name: regex pattern matched against node names
- type: find nodes of these types (FRAME, TEXT, INSTANCE, COMPONENT, etc.)
- componentId: find instances of these components or component sets
- variableId: find nodes with direct variable bindings to these variable IDs
- styleId: find nodes using these fill/stroke/text/effect/grid styles
- annotation: regex pattern matched against annotation labels
- hasAnnotation: find all nodes that have any annotation (boolean)

Combine type: ["TEXT"] with a text pattern to enumerate text nodes (replaces the old scan_text_nodes/scan_nodes_by_types flows).
Use \`grep\` to locate nodes, then \`read\` for details on specific matches.

Large text extractions (e.g. enumerating every TEXT node in a multi-slide deck) can exceed the output budget. When that happens the result is split into budget-sized pages of whole groups — the \`meta.pagination\` block reports \`page\`, \`pageCount\`, and how to fetch the next page. Pass \`page: 2\`, \`page: 3\`, … to walk through all matches without manual chunking; the grouping (by nearest ancestor) is preserved across pages.`,
  {
    scope: z
      .string()
      .optional()
      .describe('Node ID to search within, or "DOCUMENT" to search all pages (default: current page)'),
    componentId: z.array(z.string()).optional().describe("Find instances of these component or component_set IDs"),
    variableId: z
      .array(z.string())
      .optional()
      .describe("Find nodes with direct variable bindings to these variable IDs"),
    styleId: z
      .array(z.string())
      .optional()
      .describe("Find nodes using these style IDs (fill, stroke, text, effect, or grid styles)"),
    text: z.string().optional().describe("Find TEXT nodes whose content matches this regex pattern"),
    name: z.string().optional().describe("Find nodes whose name matches this regex pattern"),
    type: z
      .array(z.string())
      .optional()
      .describe("Find nodes of these types (e.g. FRAME, TEXT, INSTANCE, COMPONENT, COMPONENT_SET)"),
    annotation: z.string().optional().describe("Find nodes whose annotation label matches this regex pattern"),
    hasAnnotation: z.boolean().optional().describe("Find all nodes that have any annotation (set to true)"),
    excludeDefinitions: z
      .boolean()
      .optional()
      .default(true)
      .describe("When searching by componentId, skip matches inside those component definitions (default: true)"),
    maxResults: z.coerce
      .number()
      .optional()
      .default(200)
      .describe("Maximum number of matches to return (default: 200)"),
    maxOutputChars: z.coerce
      .number()
      .int()
      .min(1000)
      .optional()
      .describe("Max response size in characters. Default: 30000. Raise when you need full unfiltered data."),
    page: z.coerce
      .number()
      .int()
      .min(1)
      .optional()
      .describe(
        "1-based page to return when matches exceed the output budget. Results are split into pages of whole groups; see meta.pagination for pageCount. Default: 1.",
      ),
  },
  async ({
    scope,
    componentId,
    variableId,
    styleId,
    text,
    name,
    type,
    annotation,
    hasAnnotation,
    excludeDefinitions,
    maxResults,
    maxOutputChars,
    page,
  }: {
    scope?: string;
    componentId?: string[];
    variableId?: string[];
    styleId?: string[];
    text?: string;
    name?: string;
    type?: string[];
    annotation?: string;
    hasAnnotation?: boolean;
    excludeDefinitions?: boolean;
    maxResults?: number;
    maxOutputChars?: number;
    page?: number;
  }) => {
    // Validate at least one search criterion
    const hasCriteria =
      (componentId && componentId.length > 0) ||
      (variableId && variableId.length > 0) ||
      (styleId && styleId.length > 0) ||
      text ||
      name ||
      annotation ||
      hasAnnotation === true ||
      (type && type.length > 0);

    if (!hasCriteria) {
      return {
        content: [
          {
            type: "text" as const,
            text: "Error: at least one search criterion is required (componentId, variableId, styleId, text, name, type, annotation, or hasAnnotation)",
          },
        ],
      };
    }

    try {
      const result = await sendCommandToFigma(
        "find",
        {
          scope,
          componentId,
          variableId,
          styleId,
          text,
          name,
          type,
          annotation,
          hasAnnotation,
          excludeDefinitions,
          maxResults,
        },
        60000, // 60s timeout for large trees
      );

      const typedResult = result as {
        success: boolean;
        matchCount: number;
        groupCount: number;
        nodesSearched: number;
        truncated: boolean;
        scope: string;
        groups: Array<{
          name: string;
          id: string | null;
          type: string | null;
          matches: Array<{
            id: string;
            name: string;
            type: string;
            match: Record<string, unknown>;
            path: string[];
          }>;
        }>;
      };

      // Build criteria summary for meta
      const criteria: Record<string, unknown> = {};
      if (componentId) criteria.componentId = componentId;
      if (variableId) criteria.variableId = variableId;
      if (styleId) criteria.styleId = styleId;
      if (text) criteria.text = text;
      if (name) criteria.name = name;
      if (type) criteria.type = type;
      if (annotation) criteria.annotation = annotation;
      if (hasAnnotation) criteria.hasAnnotation = hasAnnotation;

      const baseMeta: Record<string, unknown> = {
        scope: typedResult.scope,
        matchCount: typedResult.matchCount,
        groupCount: typedResult.groupCount,
        nodesSearched: typedResult.nodesSearched,
        truncated: typedResult.truncated || undefined,
        criteria,
      };

      // Serialize the full result first. If it fits the budget, return it as-is
      // (single-page behavior — unchanged from before).
      const fullYaml = serializeYaml({ meta: baseMeta, groups: typedResult.groups });
      const budget = maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS;

      if (fullYaml.length <= budget && (page === undefined || page <= 1)) {
        return { content: [{ type: "text" as const, text: fullYaml }] };
      }

      // Over budget (or an explicit page was requested): split groups into
      // budget-sized pages of whole groups, preserving the ancestor grouping.
      // Reserve a slice of the budget for the meta header (with a pagination
      // block) plus margin so each rendered page stays under budget.
      const metaSample = Object.assign({}, baseMeta, {
        pagination: { page: 999, pageCount: 999, totalGroups: 99999, groupsOnPage: 999, next: "last page" },
      });
      const metaReserve = serializeYaml({ meta: metaSample, groups: [] }).length + 200;
      const groupBudget = Math.max(1, budget - metaReserve);
      // Measure each group as it renders nested under `groups:` (indent level 1),
      // not standalone, so the packed page reflects the real output size.
      const measure = (group: (typeof typedResult.groups)[number]) =>
        serializeYaml({ groups: [group] }).length;
      const paged = paginateGroups(typedResult.groups, measure, { maxChars: groupBudget, page });

      const pagedMeta = Object.assign({}, baseMeta, {
        pagination: {
          page: paged.page,
          pageCount: paged.pageCount,
          totalGroups: paged.totalGroups,
          groupsOnPage: paged.items.length,
          next:
            paged.page < paged.pageCount
              ? `call grep again with page: ${paged.page + 1} for the next page`
              : "last page",
        },
      });

      const pagedYaml = serializeYaml({ meta: pagedMeta, groups: paged.items });

      // Safety net: a single group can exceed the budget on its own (can't be
      // split further here). Guard the rendered page so a runaway group still
      // returns a narrowing message instead of an oversized blob.
      const guarded = guardOutput(pagedYaml, {
        maxChars: maxOutputChars,
        metaExtractor: extractYamlMeta,
        toolName: "grep",
        narrowingHints: [
          "  • A single group exceeds the budget — narrow further:",
          "  • Lower maxResults",
          "  • Add more criteria to narrow matches",
          "  • Search a specific subtree instead of the whole page",
        ],
      });

      return {
        content: [
          {
            type: "text" as const,
            text: guarded.text,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error in grep: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  },
);
