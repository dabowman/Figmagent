/**
 * File context for the remote transport.
 *
 * The remote MCP has no channels — it addresses files by fileKey. Resolution
 * order: (1) value set via the use_file tool (URL or bare fileKey),
 * (2) FIGMA_FILE_KEY env var.
 */

let currentFileKey: string | null = null;

/**
 * Extract a fileKey from a Figma URL, or pass a bare key through.
 * URL shapes: figma.com/design/<fileKey>/<name>, figma.com/file/<fileKey>/...,
 * figma.com/board/<fileKey>/... (FigJam), with optional /branch/<branchKey>/.
 */
export function parseFileKey(input: string): string {
  const trimmed = input.trim();
  const urlMatch = trimmed.match(
    /figma\.com\/(?:design|file|board|slides)\/([A-Za-z0-9]+)(?:\/branch\/([A-Za-z0-9]+))?/,
  );
  if (urlMatch) {
    // For branch URLs the branch key is the addressable file
    return urlMatch[2] || urlMatch[1];
  }
  if (/^[A-Za-z0-9]{10,}$/.test(trimmed)) {
    return trimmed;
  }
  throw new Error(
    `Could not parse a Figma fileKey from "${input}". Pass a file URL ` +
      "(e.g. https://www.figma.com/design/<fileKey>/...) or a bare fileKey.",
  );
}

export function setFileKey(urlOrKey: string): string {
  currentFileKey = parseFileKey(urlOrKey);
  return currentFileKey;
}

export function getFileKey(): string | null {
  if (currentFileKey) return currentFileKey;
  const envKey = process.env.FIGMA_FILE_KEY;
  if (envKey) return parseFileKey(envKey);
  return null;
}

export function resolveFileKey(): string {
  const key = getFileKey();
  if (!key) {
    throw new Error(
      "No Figma file selected. Pass a file URL to use_file " +
        "(e.g. https://www.figma.com/design/<fileKey>/...) or set FIGMA_FILE_KEY.",
    );
  }
  return key;
}

/** Test cleanup. */
export function resetFileKeyForTests(): void {
  currentFileKey = null;
}
