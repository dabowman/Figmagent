#!/usr/bin/env bun
/**
 * Pipeline guard — a PreToolUse hook for Bash, registered in .claude/settings.json
 * and run as `bun "$CLAUDE_PROJECT_DIR"/scripts/pipeline/guard.ts`.
 *
 * Inert unless AUTO_IMPROVE_RUN=1 (auto-improve.sh exports it), so day sessions
 * never see it. At night it is the deterministic backstop behind the per-stage
 * allowlists (scripts/pipeline/settings.*.json): the allowlists say what is
 * permitted; this file says what is never permitted even if a rule is loosened
 * later or the flags are flipped back. A denial means an agent tried something
 * outside its lane — exactly when a human should look — so every denial is
 * logged to .claude/analysis/pipeline-guard.log and trips the circuit breaker
 * (.pipeline.paused) if it is not already tripped.
 *
 * The rule set is the exported pure `judge(command)` so tests can drive it
 * with plain strings; only the block under `import.meta.main` does I/O.
 */

import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface Verdict {
  deny: boolean;
  rule?: string;
  reason?: string;
}

// A token at "command position": start of input, or after a shell separator
// (`;`, `&&`, `||`, `|`, `(`, `{`, `$(`, backtick, newline), optionally behind
// env assignments, transparent wrappers (`env`, `xargs`, `exec`, `timeout`, ...)
// and control keywords (`if`, `then`, `do`, ...) in any order — `env X=1 git push`
// and `if git push; then` are both `git push` at command position. Plain
// whitespace is NOT a separator: `--body "open question"` or `grep curl src/`
// must not trip `open` / `curl`. Quoted strings are neutralised by `sanitize`
// before the rules run, so `"no (open question)"` is not a `(`-separated `open`.
const SEP = String.raw`(?:^|[;&|({\x60\n]|\$\()`;
const ENV_ASSIGN = String.raw`[A-Za-z_][A-Za-z0-9_]*=\S*\s+`;
const WRAPPER = String.raw`(?:env|command|exec|nohup|time|xargs|builtin|nice|caffeinate|sudo|if|elif|while|until|then|else|do)\s+(?:-\S+(?:\s+\d+)?\s+)*`;
const TIMEOUT = String.raw`g?timeout\s+(?:-\S+(?:\s+\d+)?\s+)*[\d.]+[smhd]?\s+`;
const P = String.raw`${SEP}\s*(?:${ENV_ASSIGN}|${WRAPPER}|${TIMEOUT})*`;
// A command may be named by path (`/usr/bin/git`, `./x/curl`).
const BIN = String.raw`(?:\S*/)?`;
// git / gh accept global options before the subcommand (`git -C dir push`,
// `gh -R o/r pr merge`); allow any number of `-opt` or `-opt value` pairs.
const OPTS = String.raw`(?:\s+-\S+(?:\s+[^\s-]\S*)?)*`;
// Rest of the current simple command (up to a separator).
const REST = String.raw`[^\n;|&]*`;

interface Rule {
  name: string;
  re: RegExp;
  reason: string;
}

export const RULES: Rule[] = [
  {
    name: "git-push",
    re: new RegExp(`${P}${BIN}git${OPTS}\\s+push\\b`),
    reason: "git push is reserved for the pipeline scripts (dispatch-fix.ts publish, release.ts)",
  },
  {
    name: "git-force",
    re: new RegExp(`${P}${BIN}git\\b${REST}\\s(?:--force(?:-with-lease)?(?:=\\S*)?|-[a-zA-Z]*f[a-zA-Z]*)(?=\\s|$)`),
    reason: "forced git operations are never permitted overnight",
  },
  {
    name: "rm-recursive",
    re: new RegExp(`${P}${BIN}rm\\b${REST}\\s(?:-[a-zA-Z]*[rR][a-zA-Z]*|--recursive)(?=\\s|$)`),
    reason: "recursive delete is never permitted overnight (worktree cleanup goes through the scripts)",
  },
  {
    name: "gh-pr-merge",
    re: new RegExp(`${P}${BIN}gh${OPTS}\\s+pr\\s+(?:merge|ready)\\b`),
    reason: "merging or un-drafting a PR goes through merge-queue.ts, never the agent",
  },
  {
    name: "gh-admin",
    re: new RegExp(`${P}${BIN}gh${OPTS}\\s+(?:release|repo|auth)\\b`),
    reason: "gh release / repo / auth are outside every stage's scope",
  },
  {
    name: "gh-api-write",
    // gh api with an explicit non-GET method, or with field/input flags (which imply POST)
    re: new RegExp(
      `${P}${BIN}gh${OPTS}\\s+api\\b(?=${REST}(?:\\s(?:-X|--method)[\\s=]+(?!GET\\b)\\S|\\s(?:-f|-F|--field|--raw-field|--input)(?=\\s|=|$)))`,
    ),
    reason: "gh api may only read (GET) overnight",
  },
  {
    name: "shell-wrapper",
    // Any shell invocation (`bash x.sh`, `sh -c …`, `| sh`, `source x`, `. x`) hides the real command.
    re: new RegExp(`${P}(?:${BIN}(?:ba|z|da|k)?sh(?:\\s|$)|(?:source|\\.)\\s+\\S)`),
    reason: "running a shell, a script, or `sh -c` hides the real command from the guard",
  },
  {
    name: "interpreter",
    // `python3 -c`, `node -e`, `bun -e`, `perl -e` … evaluate code the guard cannot see.
    re: new RegExp(
      `${P}${BIN}(?:python[0-9.]*|node|bun|deno|perl|ruby|php)(?:\\s+-\\S+)*\\s+(?:-[a-zA-Z]*[cep](?:\\s|$)|--(?:eval|print|command)\\b)`,
    ),
    reason: "an inline interpreter (-c / -e / --eval) hides the real command from the guard",
  },
  {
    name: "eval",
    re: new RegExp(`${P}eval(?:\\s|$)`),
    reason: "eval hides the real command from the guard",
  },
  {
    name: "privileged",
    re: new RegExp(`${P}${BIN}(?:sudo|launchctl|osascript|security|chmod|chown)\\b`),
    reason: "privileged or system-level commands are outside every stage's scope",
  },
  {
    name: "network",
    re: new RegExp(`${P}${BIN}(?:curl|wget|ssh|scp)\\b`),
    reason: "network tools are outside every stage's scope (GitHub access goes through the scripts)",
  },
  {
    name: "open",
    re: new RegExp(`${P}${BIN}open(?:\\s|$)`),
    reason: "open (launching apps or URLs) is outside every stage's scope",
  },
  {
    name: "defaults-write",
    re: new RegExp(`${P}${BIN}defaults\\s+write\\b`),
    reason: "writing macOS defaults is outside every stage's scope",
  },
  {
    name: "base64-decode",
    re: new RegExp(`${P}${BIN}base64\\b${REST}\\s(?:-[a-zA-Z]*[dD][a-zA-Z]*|--decode)(?=\\s|$)`),
    reason: "decoding base64 is a common exfiltration / obfuscation step",
  },
  {
    name: "secret-path",
    re: /(?:~|\$HOME|\$\{HOME\}|\/Users\/[^/\s]+|\/home\/[^/\s]+)\/\.(?:ssh|figmagent|aws|config\/gh|claude\/\.credentials)(?![\w-])/,
    reason: "credential and key stores are never readable overnight",
  },
  {
    name: "dotenv",
    re: /(?:^|[\s/"'=])\.env(?:\.[A-Za-z0-9_-]+)?(?=[\s"';|&)]|$)/,
    reason: ".env files are never readable overnight",
  },
];

/**
 * Neutralise quoting before the rules run. A quoted bare word is unquoted
 * (`"git" push` is `git push`); every other single-quoted string, and every
 * double-quoted string that cannot expand (no `$` or backtick), is emptied so
 * the free text the stage prompts dictate (`--reason "no (open question)"`)
 * cannot be read as a separator plus a command. `\git` becomes `git`.
 */
export function sanitize(command: string): string {
  return command
    .replace(/\\(?=[A-Za-z])/g, "")
    .replace(/(["'])([^\s"'$`\\;&|(){}]+)\1/g, "$2")
    .replace(/'[^']*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, (m) => (/[$`]/.test(m) ? m : '""'));
}

/** Pure: does this Bash command hit a rule? First matching rule wins. */
export function judge(command: string): Verdict {
  const text = sanitize(command);
  for (const rule of RULES) {
    if (rule.re.test(text)) {
      return { deny: true, rule: rule.name, reason: `${rule.reason} [guard rule: ${rule.name}]` };
    }
  }
  return { deny: false };
}

interface HookInput {
  hook_event_name?: string;
  tool_name?: string;
  tool_input?: { command?: unknown };
  cwd?: string;
  session_id?: string;
}

function deny(reason: string): never {
  process.stdout.write(
    `${JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    })}\n`,
  );
  process.exit(0);
}

function recordDenial(root: string, verdict: Verdict, command: string, input: HookInput): void {
  const now = new Date().toISOString();
  const log = join(root, ".claude/analysis/pipeline-guard.log");
  try {
    mkdirSync(dirname(log), { recursive: true });
    appendFileSync(
      log,
      `${JSON.stringify({
        ts: now,
        run: process.env.AUTO_IMPROVE_RUN_ID || null,
        rule: verdict.rule,
        reason: verdict.reason,
        command,
        cwd: input.cwd || null,
        session: input.session_id || null,
      })}\n`,
    );
  } catch {
    // logging must never turn a deny into a crash
  }
  // Trip the circuit breaker: every later auto-improve run exits at the top
  // until a human resumes (bun scripts/pipeline-record.ts resume).
  const paused = join(root, ".pipeline.paused");
  if (!existsSync(paused)) {
    try {
      writeFileSync(
        paused,
        `${JSON.stringify({ at: now, reason: `guard denied: ${command.slice(0, 200)}`, run: process.env.AUTO_IMPROVE_RUN_ID || null }, null, 2)}\n`,
      );
    } catch {
      // same: a breaker write failure is not a reason to allow the command
    }
  }
}

if (import.meta.main) {
  if (process.env.AUTO_IMPROVE_RUN !== "1") process.exit(0);
  let input: HookInput;
  try {
    input = JSON.parse(await Bun.stdin.text()) as HookInput;
  } catch {
    // Fail closed at night: an unparseable hook payload is not a reason to run.
    deny("pipeline guard could not parse the hook input [guard rule: input]");
  }
  if (input.tool_name && input.tool_name !== "Bash") process.exit(0);
  const command = input.tool_input ? input.tool_input.command : undefined;
  if (typeof command !== "string") deny("pipeline guard: Bash call without a command string [guard rule: input]");
  const verdict = judge(command);
  if (!verdict.deny) process.exit(0);
  const root = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
  recordDenial(root, verdict, command, input);
  deny(verdict.reason || "denied by the pipeline guard");
}
