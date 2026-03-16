/**
 * Session logger — records all MCP tool calls to a local JSON file.
 * Each session gets a unique file in ~/.figmagent/sessions/.
 * The log captures tool name, params summary, duration, success/error, and response size.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { logger } from "./utils.js";

const SESSION_DIR = join(homedir(), ".figmagent", "sessions");

interface ToolCallEntry {
  tool: string;
  /** ISO timestamp */
  ts: string;
  /** Duration in ms */
  durationMs: number;
  /** Truncated params (first 500 chars of JSON) */
  params: string;
  /** Whether the call succeeded */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** Response character count */
  responseChars: number;
}

interface SessionLog {
  sessionId: string;
  startedAt: string;
  serverVersion: string;
  toolCalls: ToolCallEntry[];
}

let session: SessionLog | null = null;
let sessionFile: string | null = null;

function ensureSession(): SessionLog {
  if (session) return session;

  const id = crypto.randomUUID();
  session = {
    sessionId: id,
    startedAt: new Date().toISOString(),
    serverVersion: "1.0.0",
    toolCalls: [],
  };

  try {
    mkdirSync(SESSION_DIR, { recursive: true });
  } catch {
    // directory may already exist
  }

  // File named by date + short ID for easy browsing
  const dateStr = new Date().toISOString().slice(0, 10);
  sessionFile = join(SESSION_DIR, `${dateStr}_${id.slice(0, 8)}.json`);
  logger.info(`Session log: ${sessionFile}`);
  flush();
  return session;
}

function flush(): void {
  if (!session || !sessionFile) return;
  try {
    writeFileSync(sessionFile, JSON.stringify(session, null, 2));
  } catch (err) {
    logger.warn(`Failed to write session log: ${err}`);
  }
}

/** Summarize params — truncate to avoid logging huge payloads */
function summarizeParams(params: unknown): string {
  try {
    const json = JSON.stringify(params);
    if (json.length <= 500) return json;
    return json.slice(0, 497) + "...";
  } catch {
    return "{}";
  }
}

/** Record a tool call. Called by the tool wrapper. */
export function recordToolCall(
  tool: string,
  params: unknown,
  startTime: number,
  success: boolean,
  responseChars: number,
  error?: string,
): void {
  const s = ensureSession();
  s.toolCalls.push({
    tool,
    ts: new Date().toISOString(),
    durationMs: Math.round(performance.now() - startTime),
    params: summarizeParams(params),
    success,
    error,
    responseChars,
  });
  // Flush every call — sessions can end abruptly
  flush();
}

/** Get a summary of the current session for the export tool. */
export function getSessionSummary(): object {
  const s = ensureSession();
  const calls = s.toolCalls;

  // Tool frequency
  const toolCounts: Record<string, number> = {};
  for (const c of calls) {
    toolCounts[c.tool] = (toolCounts[c.tool] || 0) + 1;
  }

  // Errors
  const errors = calls.filter((c) => !c.success);
  const errorsByTool: Record<string, string[]> = {};
  for (const e of errors) {
    if (!errorsByTool[e.tool]) errorsByTool[e.tool] = [];
    if (e.error && errorsByTool[e.tool].length < 3) {
      errorsByTool[e.tool].push(e.error);
    }
  }

  // Timing
  const totalDurationMs = calls.reduce((sum, c) => sum + c.durationMs, 0);
  const avgDurationMs = calls.length > 0 ? Math.round(totalDurationMs / calls.length) : 0;

  // Sorted tool frequency
  const toolFrequency = Object.entries(toolCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([tool, count]) => ({ tool, count }));

  return {
    sessionId: s.sessionId,
    startedAt: s.startedAt,
    totalToolCalls: calls.length,
    totalErrors: errors.length,
    errorRate: calls.length > 0 ? `${((errors.length / calls.length) * 100).toFixed(1)}%` : "0%",
    totalDurationMs,
    avgDurationMs,
    toolFrequency,
    errors: errorsByTool,
    logFile: sessionFile,
  };
}

/** Get the full session log (for export). */
export function getSessionLog(): SessionLog | null {
  return session;
}

/** Get the session log file path. */
export function getSessionLogPath(): string | null {
  return sessionFile;
}
