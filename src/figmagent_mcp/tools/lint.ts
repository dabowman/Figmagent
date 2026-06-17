import { z } from "zod";
import { server } from "../instance.js";
import { sendCommandToFigma } from "../connection.js";
import { guardOutput, extractJsonSummary } from "../utils.js";

/**
 * Meta-extractor for the lint truncation path. Builds on the generic JSON
 * summary (which collapses every array to "[N items]") but re-attaches the
 * per-root `roots` breakdown inline — it is small and bounded by the number of
 * roots, and is the whole point of the multi-root form, so it must survive
 * truncation (which fires exactly on large multi-root scans). The large
 * unbounded `issues` array stays collapsed.
 */
function extractLintSummary(text: string): string | null {
  const summary = extractJsonSummary(text);
  if (summary === null) return null;
  try {
    const obj = JSON.parse(text);
    const roots = (obj as { roots?: unknown }).roots;
    if (!Array.isArray(roots)) return summary;
    const merged = JSON.parse(summary);
    merged.roots = roots;
    return JSON.stringify(merged, null, 2);
  } catch {
    return summary;
  }
}

const lintableProperties = z.enum([
  "fills",
  "strokes",
  "cornerRadius",
  "opacity",
  "itemSpacing",
  "counterAxisSpacing",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "fontSize",
  "fontFamily",
]);

server.tool(
  "lint",
  `Scan a Figma subtree for properties not bound to design token variables. Reports unbound fills, strokes, corner radii, spacing, opacity, and font properties. Compares values against local variables using perceptual color distance (CIE76 deltaE) for colors and numeric proximity for scalars. Returns structured issues with severity levels and suggested variable matches.

Use after building or modifying a design to verify all properties are tokenized. With autoFix=true, automatically binds exact matches.

Severity levels:
- exact_match: variable exists with identical value (deltaE < 1.0 for colors, exact equality for scalars). Auto-fixable.
- near_match: variable exists within threshold (deltaE < threshold for colors, within 10% for scalars). Review suggested.
- no_match: no matching variable found. Manual action needed.

Pass multiple root IDs (an array) to lint several frames/pages in one call. With an array, each issue carries a rootNodeId and the response adds a per-root \`roots\` breakdown (nodes scanned, issues, auto-fixed); the top-level summary aggregates across all roots. A single string keeps the original response shape.`,
  {
    nodeId: z
      .union([z.string(), z.array(z.string()).min(1)])
      .describe(
        "Root node ID(s) to scan. All visible descendants are linted. Accepts a single ID string, or an array of IDs to lint several frames/pages in one call. Accepts PAGE node IDs (e.g. '0:1') to lint all top-level components on a page. Duplicate IDs are de-duplicated.",
      ),
    autoFix: z
      .boolean()
      .default(false)
      .describe("When true, automatically bind exact-match variables to unbound properties. Skips instance children."),
    properties: z
      .array(lintableProperties)
      .optional()
      .describe("Filter to specific properties. Default: all lintable properties."),
    threshold: z.coerce
      .number()
      .min(0)
      .max(20)
      .default(5.0)
      .describe("Color distance threshold (deltaE) for near_match suggestions. Default: 5.0"),
    maxIssues: z.coerce
      .number()
      .min(1)
      .max(1000)
      .default(200)
      .describe("Maximum number of issues to return in detail. Summary counts are always complete."),
  },
  async ({ nodeId, autoFix, properties, threshold, maxIssues }: any) => {
    try {
      const result = await sendCommandToFigma("lint_design", {
        nodeId,
        autoFix,
        properties,
        threshold,
        maxIssues,
      });

      const jsonText = JSON.stringify(result, null, 2);
      const guarded = guardOutput(jsonText, {
        metaExtractor: extractLintSummary,
        toolName: "lint",
        narrowingHints: [
          "  • Lower maxIssues to reduce output",
          "  • Filter with the properties param to lint specific property types",
          "  • Lint a smaller subtree, or fewer root IDs per call",
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
            text: `Error running lint: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  },
);
