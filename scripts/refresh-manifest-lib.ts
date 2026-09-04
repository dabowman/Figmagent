/**
 * Pure logic behind scripts/refresh-manifest.ts: which figma sessions still
 * need analysis, which one goes next, and the attempt / failed transitions the
 * nightly Stage B loop records. No I/O here — the executable owns the scan and
 * the manifest file, so tests can drive this with plain objects.
 *
 * Why attempts and failures live in the manifest: the Stage B loop used to
 * re-hand any session the analyzer could not finish (unreadable transcript,
 * turn cap hit, crash) to a fresh agent every iteration, up to the per-run cap,
 * because "needs analysis" only looked at analysis-vs-source. A session marked
 * `analysisFailed` drops out of the needs list until a human clears it.
 */

export interface ManifestEntry {
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
  /** How many times the nightly loop handed this session to /analyze-session. */
  analysisAttempts?: number;
  /** Set by the loop when an attempt ran but did not mark the session analyzed. Excludes it from the needs list. */
  analysisFailed?: { at: string; reason: string };
}

export interface Manifest {
  sessions: Record<string, ManifestEntry>;
}

export type NeedsEntry = [sid: string, entry: ManifestEntry];

/** A figma session with no analysis, or whose content changed since it was analyzed — unless it is marked failed. */
export function needsAnalysis(entry: ManifestEntry): boolean {
  if (entry.sessionType !== "figma") return false;
  if (entry.analysisFailed) return false;
  return !entry.analysis || entry.analyzedSignature !== entry.sourceSignature;
}

/** Sessions needing analysis, oldest source first (the order Stage B analyzes them in). */
export function selectNeedsAnalysis(sessions: Record<string, ManifestEntry>): NeedsEntry[] {
  return Object.entries(sessions)
    .filter(([, v]) => needsAnalysis(v))
    .sort((a, b) => a[1].sourceModified - b[1].sourceModified);
}

/** The session id `/analyze-session` would pick next, or undefined when the queue is empty. */
export function nextToAnalyze(sessions: Record<string, ManifestEntry>): string | undefined {
  const first = selectNeedsAnalysis(sessions)[0];
  return first ? first[0] : undefined;
}

/** Failed sessions, for the human-readable summary. */
export function failedSessions(sessions: Record<string, ManifestEntry>): NeedsEntry[] {
  return Object.entries(sessions).filter(([, v]) => v.analysisFailed !== undefined);
}

/**
 * The manifest is rebuilt from disk every refresh; carry the loop's bookkeeping
 * through the rebuild (both figma and demoted-to-dev entries keep it, like the
 * analysis mapping does).
 */
export function preserveAttemptState(
  existing: Partial<ManifestEntry> | undefined,
  entry: ManifestEntry,
): ManifestEntry {
  if (!existing) return entry;
  if (existing.analysisAttempts !== undefined) entry.analysisAttempts = existing.analysisAttempts;
  if (existing.analysisFailed !== undefined) entry.analysisFailed = existing.analysisFailed;
  return entry;
}

function requireEntry(manifest: Manifest, sid: string): ManifestEntry {
  const entry = manifest.sessions[sid];
  if (!entry) throw new Error(`session ${sid} is not in the manifest — run refresh-manifest first`);
  return entry;
}

function withEntry(manifest: Manifest, sid: string, entry: ManifestEntry): Manifest {
  return { sessions: Object.assign({}, manifest.sessions, { [sid]: entry }) };
}

/** Record that the loop is about to hand this session to the analyzer. Returns a new manifest. */
export function markAttempt(manifest: Manifest, sid: string): Manifest {
  const entry = requireEntry(manifest, sid);
  const attempts = (entry.analysisAttempts || 0) + 1;
  return withEntry(manifest, sid, Object.assign({}, entry, { analysisAttempts: attempts }));
}

/** Take the session out of the needs list with a stated reason. Returns a new manifest. */
export function markFailed(manifest: Manifest, sid: string, reason: string, at = new Date().toISOString()): Manifest {
  const entry = requireEntry(manifest, sid);
  return withEntry(manifest, sid, Object.assign({}, entry, { analysisFailed: { at, reason } }));
}

/** Put a failed session back in the queue (a human decided to retry). Returns a new manifest. */
export function clearFailed(manifest: Manifest, sid: string): Manifest {
  const entry = requireEntry(manifest, sid);
  const copy = Object.assign({}, entry);
  delete copy.analysisFailed;
  return withEntry(manifest, sid, copy);
}
