// Lightweight YAML serializer for MCP tool output.
// Used by both the `get` tool (FSGN) and the `find` tool (search results).

export function serializeYaml(obj: unknown, indent = 0): string {
  const pad = "  ".repeat(indent);

  if (obj === null || obj === undefined) return "null";
  if (typeof obj === "boolean") return String(obj);
  if (typeof obj === "number") return String(obj);
  if (typeof obj === "string") {
    // Quote strings that contain YAML-significant characters or leading/trailing whitespace
    if (
      obj === "" ||
      /[:#[\]{},&*?|<>=!%@`"'\\]/.test(obj) ||
      obj.includes("\n") ||
      /^\s/.test(obj) ||
      /\s$/.test(obj)
    ) {
      return `"${obj.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
    }
    return obj;
  }

  if (Array.isArray(obj)) {
    if (obj.length === 0) return "[]";
    return obj
      .map((item) => {
        const valStr = serializeYaml(item, indent + 1);
        if (typeof item === "object" && item !== null && !Array.isArray(item)) {
          // Object items: put first property on same line as "- ", rest indented
          const lines = valStr.split("\n");
          const rest = lines.slice(1).join("\n");
          return `${pad}- ${lines[0].trimStart()}${rest ? "\n" + rest : ""}`;
        }
        return `${pad}- ${valStr}`;
      })
      .join("\n");
  }

  if (typeof obj === "object") {
    const entries = Object.entries(obj as Record<string, unknown>).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return "{}";
    return entries
      .map(([k, v]) => {
        const quotedKey = /[:#[\]{},&*?|<>=!%@`"'\s]/.test(k) ? `"${k}"` : k;
        if (v === null || v === undefined) return `${pad}${quotedKey}: null`;
        if (typeof v === "object" && !Array.isArray(v) && Object.keys(v as object).length > 0) {
          return `${pad}${quotedKey}:\n${serializeYaml(v, indent + 1)}`;
        }
        if (Array.isArray(v) && v.length > 0) {
          return `${pad}${quotedKey}:\n${serializeYaml(v, indent + 1)}`;
        }
        return `${pad}${quotedKey}: ${serializeYaml(v, indent)}`;
      })
      .join("\n");
  }

  return String(obj);
}
