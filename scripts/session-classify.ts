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

const isFigmagentTool = (name: string): boolean => name.includes("Figmagent");

const isMetadataOnly = (name: string): boolean =>
	METADATA_ONLY_COMMANDS.some((cmd) => name.endsWith(`__${cmd}`) || name === cmd);

/**
 * Does this session contain a Figmagent call that actually did something?
 *
 * Returns undefined when the extracted JSON carries no usable message array —
 * sessions extracted before messages were stored, or a --compact run. The caller
 * falls back to the old name-presence test there rather than silently demoting a
 * real session to "dev", which would drop it out of the analysis queue for good.
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
