#!/usr/bin/env bun
/**
 * Refresh the session analysis manifest (.claude/analysis/sessions.json).
 *
 * Scans every extracted session in .claude/sessions-json/, classifies each as
 * figma | dev | empty, and records whether it still needs analysis (a figma
 * session with no analysis, or whose source is newer than its analysis file).
 * Existing analysis mappings are preserved.
 *
 * Usage:
 *   bun scripts/refresh-manifest.ts            # refresh + print human summary
 *   bun scripts/refresh-manifest.ts --count    # refresh + print only the count
 *                                              # of figma sessions needing analysis
 *                                              # (used as the Stage B loop guard)
 */

import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

const SESSIONS_DIR = ".claude/sessions-json";
const ANALYSIS_DIR = ".claude/analysis";
const MANIFEST = join(ANALYSIS_DIR, "sessions.json");
const countOnly = process.argv.includes("--count");

interface Entry {
	sessionType?: "figma" | "dev" | "empty";
	skip?: boolean;
	toolCalls: number;
	figmaToolCalls: number;
	durationMinutes: number;
	sourceModified: number;
	sourceSignature?: string; // "${toolCalls}:${figmaToolCalls}" — content fingerprint
	analysis?: string;
	analyzedAt?: number;
	analyzedSignature?: string; // the sourceSignature the recorded analysis covered
}

// seconds-since-epoch with 2 decimal places, matching the prior Python script
const mtimeSeconds = (ms: number): number => Math.round(ms / 10) / 100;

const HOME = process.env.HOME || "~";

// mtime of the ORIGINAL Claude Code transcript for a session, derived from its
// recorded cwd + id (~/.claude/projects/<encoded-cwd>/<id>.jsonl). Returns
// undefined if it's been rotated away. Preferred over the extracted JSON's
// mtime, which bumps on every re-extraction even when content is unchanged.
async function originalTranscriptMtime(
	cwd: string | undefined,
	sid: string,
): Promise<number | undefined> {
	if (!cwd) return undefined;
	const encoded = cwd.replace(/\//g, "-");
	try {
		return mtimeSeconds(
			(await stat(join(HOME, ".claude/projects", encoded, `${sid}.jsonl`))).mtimeMs,
		);
	} catch {
		return undefined;
	}
}

let manifest: { sessions: Record<string, Entry> };
try {
	manifest = JSON.parse(await readFile(MANIFEST, "utf-8"));
} catch {
	manifest = { sessions: {} };
}

let files: string[] = [];
try {
	files = (await readdir(SESSIONS_DIR)).filter((f) => f.endsWith(".json")).sort();
} catch {
	// sessions-json not created yet — nothing to scan
}

for (const f of files) {
	const path = join(SESSIONS_DIR, f);
	let data: {
		sessionId?: string;
		metadata?: {
			cwd?: string;
			uniqueTools?: string[];
			toolCallCount?: number;
			duration?: { minutes?: number };
		};
	};
	let jsonMtime: number;
	try {
		data = JSON.parse(await readFile(path, "utf-8"));
		// stat inside the try: a TOCTOU removal between readdir and here must
		// not throw an unhandled rejection that aborts the whole refresh.
		jsonMtime = mtimeSeconds((await stat(path)).mtimeMs);
	} catch {
		continue;
	}
	const sid = data.sessionId;
	if (!sid) continue;

	const m = data.metadata || {};
	const tools = m.uniqueTools || [];
	const figmaTools = tools.filter((t) => t.includes("Figmagent"));
	const tc = m.toolCallCount || 0;
	// Content fingerprint — re-analysis is keyed on THIS, not mtime. Even the
	// original transcript's mtime drifts when a session is touched without
	// changing analyzable content, producing false "updated" flags (observed:
	// a transcript 13 min newer than its analysis with identical 12 calls).
	const sourceSignature = `${tc}:${figmaTools.length}`;
	// mtime is still recorded (display / ordering / resync hint) but no longer
	// the freshness key.
	const sourceModified = (await originalTranscriptMtime(m.cwd, sid)) ?? jsonMtime;

	const existing = manifest.sessions[sid] || ({} as Entry);
	const entry: Entry = {
		toolCalls: tc,
		figmaToolCalls: figmaTools.length,
		durationMinutes: Math.round(m.duration?.minutes ?? 0),
		sourceModified,
	};

	if (tc === 0) {
		entry.sessionType = "empty";
		entry.skip = true;
	} else if (figmaTools.length > 0) {
		entry.sessionType = "figma";
		entry.sourceSignature = sourceSignature;
		if (existing.analysis) {
			entry.analysis = existing.analysis;
			try {
				const af = join(ANALYSIS_DIR, existing.analysis);
				entry.analyzedAt = mtimeSeconds((await stat(af)).mtimeMs);
			} catch {
				// analysis file deleted — leave analyzedSignature unset so the
				// needs-filter re-flags it.
			}
			if (entry.analyzedAt !== undefined) {
				// Maintain analyzedSignature here (refresh-owned, no skill help):
				//  • migrate — a pre-signature analysis is assumed to cover current
				//    content (this is what stops the historical mtime false positives);
				//  • resync — the analysis file is at/after the source mtime, so it
				//    reflects current content;
				//  • else keep the prior signature, so a genuine content change
				//    (a different signature) is still detected.
				entry.analyzedSignature =
					existing.analyzedSignature === undefined ||
					entry.analyzedAt >= sourceModified
						? sourceSignature
						: existing.analyzedSignature;
			}
		}
	} else {
		entry.sessionType = "dev";
		entry.skip = true;
	}

	manifest.sessions[sid] = entry;
}

await writeFile(MANIFEST, JSON.stringify(manifest, null, 2));

const figma = Object.entries(manifest.sessions).filter(
	([, v]) => v.sessionType === "figma",
);
const needs = figma
	.filter(([, v]) => !v.analysis || v.analyzedSignature !== v.sourceSignature)
	.sort((a, b) => a[1].sourceModified - b[1].sourceModified);

if (countOnly) {
	console.log(needs.length);
} else {
	console.log(`Figma sessions: ${figma.length}, needs analysis: ${needs.length}`);
	for (const [sid, v] of needs) {
		const status = v.analysis ? "updated" : "new";
		console.log(
			`  ${sid}  ${String(v.toolCalls).padStart(4)} calls  ${String(
				v.figmaToolCalls,
			).padStart(2)} figma  (${status})`,
		);
	}
}
