/**
 * Session classification for the auto-improve pipeline.
 *
 * Pure + side-effect free so it can be unit-tested; `refresh-manifest.ts` is a
 * top-level-await executable and cannot be imported from a test.
 */

// INFRA-005 — a session used to be classified "figma" on the mere PRESENCE of a
// Figmagent tool name, so a session whose only Figmagent call threw, or which just
// dumped its own log with export_session, entered the analysis queue as if it had
// exercised the tools. Those sessions cost an analysis pass and dilute the tracker
// with findings drawn from a session that never touched a canvas.
//
// The bar: at least one Figmagent call that (a) did not come back is_error, and
// (b) is not a pure metadata call. Everything else is a dev session.
export const METADATA_ONLY_COMMANDS = ["export_session"];

interface ContentBlock {
  type?: string;
  id?: string;
  name?: string;
  tool_use_id?: string;
  is_error?: boolean;
}
interface ExtractedMessage {
  content?: ContentBlock[] | string;
}
interface ExtractedSessionShape {
  messages?: unknown;
  subAgents?: unknown;
}

/** Shared with refresh-manifest.ts / extract-sessions.ts — one definition of "a Figmagent tool". */
export const isFigmagentTool = (name: string): boolean => name.includes("Figmagent");

const isMetadataOnly = (name: string): boolean =>
  METADATA_ONLY_COMMANDS.some((cmd) => name.endsWith(`__${cmd}`) || name === cmd);

/**
 * Does this message list contain a Figmagent call that actually did something?
 *
 * Returns undefined when the list carries no usable content blocks — an extracted
 * JSON written before messages were stored, or a `--raw` dump (whose entries are
 * unparsed JSONL records, not `{content: [...]}` messages). `--compact` is NOT
 * one of these: it only shortens tool-result *text* and keeps every block plus
 * `is_error`, so the nightly pipeline's `--compact` extraction is fully decidable.
 * On undefined the caller falls back to the old name-presence test rather than
 * silently demoting a real session to "dev" and dropping it from the queue.
 */
export function hasEffectiveFigmaCall(messages: unknown): boolean | undefined {
  if (!Array.isArray(messages)) return undefined;

  const figmaCallNames = new Map<string, string>(); // tool_use id → tool name
  const erroredCallIds = new Set<string>();
  let sawContentBlocks = false;

  for (const message of messages as ExtractedMessage[]) {
    const content = message?.content;
    if (!Array.isArray(content)) continue;
    sawContentBlocks = true;
    for (const block of content) {
      if (block?.type === "tool_use" && typeof block.name === "string" && block.id) {
        if (isFigmagentTool(block.name)) figmaCallNames.set(block.id, block.name);
      } else if (block?.type === "tool_result" && block.is_error && block.tool_use_id) {
        erroredCallIds.add(block.tool_use_id);
      }
    }
  }

  if (!sawContentBlocks) return undefined;

  for (const [id, name] of figmaCallNames) {
    if (erroredCallIds.has(id)) continue;
    if (isMetadataOnly(name)) continue;
    return true;
  }
  return false;
}

/**
 * Session-level verdict: the parent transcript OR any sub-agent transcript.
 *
 * `extract-sessions.ts --include-agents` (what the nightly pipeline runs) stores
 * Builder/Styler/Discovery transcripts under `subAgents`, and CLAUDE.md points
 * large Figma tasks at exactly that architecture — the parent may delegate every
 * canvas write. Judging the parent alone would demote such a session to "dev"
 * (and drop hundreds of real Figmagent calls from the queue) whenever the
 * parent's own handful of calls happened to error.
 *
 * Any decidable `true` wins; otherwise a decidable `false` wins; otherwise
 * undefined, so the caller still falls back to the name-presence test.
 */
export function sessionHasEffectiveFigmaCall(data: ExtractedSessionShape | null | undefined): boolean | undefined {
  let sawDecidable = false;
  const consider = (messages: unknown): boolean => {
    const verdict = hasEffectiveFigmaCall(messages);
    if (verdict !== undefined) sawDecidable = true;
    return verdict === true;
  };

  if (consider(data?.messages)) return true;

  const subAgents = data?.subAgents;
  if (subAgents && typeof subAgents === "object") {
    for (const agent of Object.values(subAgents as Record<string, ExtractedSessionShape>)) {
      if (consider(agent?.messages)) return true;
    }
  }

  return sawDecidable ? false : undefined;
}
