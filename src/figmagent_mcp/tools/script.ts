/**
 * run_script — escape-hatch tool (Task 4.4, plan D4). Executes a raw Figma
 * Plugin API script in the remote VM with the fig.* stdlib preloaded.
 * Remote transport only; the plugin transport refuses with the fix.
 *
 * mode: "read" is enforced by a best-effort server-side static deny-list scan
 * over mutating Plugin API names — runtime monkey-patching is impossible
 * (figma.* properties are read-only on the remote global). The real
 * protection is per-script rollback: a thrown error means nothing was applied.
 */

import { z } from "zod";
import { server } from "../instance.js";
import { getTransport } from "../transport.js";
import { getDomainBundle } from "../remote/bundles.js";
import { executeRawScript } from "../remote/executor.js";
import { resolveFileKey } from "../remote/filecontext.js";

export const PLUGIN_TRANSPORT_REFUSAL =
  "run_script requires the remote transport — the plugin transport cannot execute raw scripts. " +
  "Fix: set FIGMA_TRANSPORT=remote (and complete the Figma OAuth flow) then restart the MCP server. " +
  "On the plugin transport, use the first-class tools (read/grep/edit/write/lint/screenshot) instead.";

// ─── Read-mode deny list ─────────────────────────────────────────────────────
// Best-effort static scan for mutating Plugin API calls. Order matters where
// one name prefixes another (setBoundVariableForPaint before setBoundVariable
// is not needed thanks to \b, but keep specific-first for clear reporting).

const DENY_PATTERNS: Array<{ re: RegExp; label?: string }> = [
  // figma.createRectangle / createFrame / createNodeFromSvg / createImage / ...
  { re: /\bfigma\.(create[A-Z]\w*)\b/ },
  { re: /\.remove\s*\(/, label: ".remove()" },
  { re: /\.appendChild\s*\(/, label: ".appendChild()" },
  { re: /\.insertChild\s*\(/, label: ".insertChild()" },
  { re: /\bsetProperties\b/, label: "setProperties" },
  { re: /\bsetBoundVariableForPaint\b/, label: "setBoundVariableForPaint" },
  { re: /\bsetBoundVariable\b/, label: "setBoundVariable" },
  { re: /\bcombineAsVariants\b/, label: "combineAsVariants" },
  { re: /\bcreateImage\b/, label: "createImage" },
  // stdlib write helpers count as writes too
  { re: /\bfig\.(createNode|setCharacters|bindVariable)\b/ },
];

/** Property assignment (`.foo = bar`) — excludes ==, ===, <=, >=, !=, =>. */
const PROPERTY_ASSIGNMENT_RE = /\.\w+\s*=(?![=>])/;

/**
 * Scan user code for mutating Plugin API calls. Returns the offending name,
 * or null when the script looks read-only. Best-effort by design.
 */
export function findWriteCall(code: string): string | null {
  for (const entry of DENY_PATTERNS) {
    const m = code.match(entry.re);
    if (m) return entry.label || m[1] || m[0];
  }
  // loadFontAsync is only meaningful as a write when paired with an
  // assignment (node.fontName = ..., node.characters = ...).
  if (/\bloadFontAsync\b/.test(code) && PROPERTY_ASSIGNMENT_RE.test(code)) {
    return "loadFontAsync";
  }
  return null;
}

// ─── Script assembly ─────────────────────────────────────────────────────────

/**
 * stdlib bundle + user code (wrapped so the return value is captured) +
 * for mode "write": the { nodeIds } post-run convention — fig.check runs over
 * the returned ids in the same script and warnings ride the response.
 */
export async function assembleRunScript(code: string, mode: "read" | "write"): Promise<string> {
  const stdlib = await getDomainBundle("stdlib");
  const lines = [stdlib, "const __userScript = async () => {", code, "};", "const __result = await __userScript();"];
  if (mode === "write") {
    lines.push(
      "let __warnings = [];",
      "if (__result && typeof __result === 'object' && Array.isArray(__result.nodeIds)) {",
      "  try { __warnings = await globalThis.fig.check(__result.nodeIds); } catch (_e) {}",
      "}",
      "const __out = { result: __result === undefined ? null : __result };",
      "if (__warnings.length > 0) __out.warnings = __warnings;",
      "return JSON.stringify(__out);",
    );
  } else {
    lines.push("return JSON.stringify({ result: __result === undefined ? null : __result });");
  }
  return lines.join("\n");
}

// ─── Tool ────────────────────────────────────────────────────────────────────

server.tool(
  "run_script",
  `LAST RESORT — execute a raw Figma Plugin API script in the remote VM. Use ONLY when no first-class tool (read/grep/edit/write/lint/screenshot, variables/styles/components tools) covers the operation. Remote transport only (FIGMA_TRANSPORT=remote).

The script runs with top-level await and return, with the fig.* stdlib preloaded:
- fig.prop(node, name) — strict-guard-safe property read (the remote VM throws on properties missing from a node type; always use this for optional props)
- fig.setCharacters(node, text) — font-safe text replacement (handles mixed-font nodes)
- fig.loadFont(family, weightOrStyle) — load a font; numeric weight maps to style (600 → "Semi Bold"), falls back to Inter Regular; returns the loaded FontName
- fig.serialize(nodeOrId, detail) — FSGN raw tree for a node; detail: "structure" | "layout" | "full"
- fig.bindVariable(node, field, variableId) — scope-validated design-token binding (fill, stroke, cornerRadius, opacity, padding*, itemSpacing, width, height, fontSize, ...); returns a warning or null
- fig.check(nodeIds) — post-write structural assertions (zero-width text, 100px balloons, overlaps); returns warnings[]
- fig.createNode(spec, parentId) — the full write tree builder (two-pass FILL sizing, font loading, no default fills)

Conventions:
- mode: "read" (default) is enforced by a best-effort static scan for mutating API names; the real protection is per-script rollback — a thrown error means nothing was applied. Mutating scripts MUST pass mode: "write".
- When a mode: "write" script returns { nodeIds: [...] }, fig.check runs over those ids in the same execution and warnings are appended to the response — so return the ids you created/modified.
- Budget: stdlib + your code must fit 49,000 chars combined (~19K for your code).
- Every script is session-logged in full; recurring scripts become first-class tools.`,
  {
    code: z
      .string()
      .describe(
        "Plugin API script body. Runs inside an async function: top-level await and return work. " +
          "Return JSON-serializable data; for writes, return { nodeIds: [...] } to get post-run checks.",
      ),
    mode: z
      .enum(["read", "write"])
      .default("read")
      .describe("'read' (default) rejects scripts that call mutating APIs; 'write' allows mutations."),
    description: z.string().describe("One-line description of what the script does (logged + sent to Figma)."),
  },
  (params: { code: string; mode: "read" | "write"; description: string }) => runScriptHandler(params),
);

/** Tool handler — exported for direct unit testing. */
export async function runScriptHandler({
  code,
  mode,
  description,
}: {
  code: string;
  mode: "read" | "write";
  description: string;
}) {
  try {
    if (getTransport().name !== "remote") {
      return {
        content: [{ type: "text" as const, text: PLUGIN_TRANSPORT_REFUSAL }],
      };
    }

    if (mode === "read") {
      const offender = findWriteCall(code);
      if (offender) {
        return {
          content: [
            {
              type: "text" as const,
              text: `This script calls ${offender} but mode is 'read'; rerun with mode: 'write'.`,
            },
          ],
        };
      }
    }

    const fileKey = resolveFileKey();
    const script = await assembleRunScript(code, mode);
    const result = await executeRawScript({
      fileKey,
      code: script,
      description,
      atomicWrite: mode === "write",
    });

    return {
      content: [
        {
          type: "text" as const,
          text: typeof result === "string" ? result : JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: "text" as const,
          text: `Error running script: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
    };
  }
}
