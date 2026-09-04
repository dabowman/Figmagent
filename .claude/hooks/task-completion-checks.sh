#!/bin/bash
# Runs lint, test, and build when an agent task completes (Stop hook, and run
# directly by /tidy-up).
# Exit code 2 = block completion and send feedback to the agent.
#
# Two guards keep this from trapping an agent that cannot make the checks pass
# (an agent that is never allowed to stop will eventually route around whatever
# is in its way — see .claude/plans/2026-09-03-pipeline-prompt-review.md, #2):
#   1. `stop_hook_active` in the hook input: Claude Code sets it when the agent is
#      already continuing because a Stop hook blocked it. We let that second stop
#      through without running the checks, so a failing check blocks at most once.
#   2. A final assistant message beginning `BLOCKED:` is a sanctioned ending (the
#      unattended contract in scripts/pipeline/contract.md); we let it through
#      without running the checks. This reads the transcript named by
#      `transcript_path` in the hook input; when there is no hook input (run by
#      hand) or the transcript is unreadable, the checks simply run.
#
# No `set -e`: every failure path is handled explicitly below.
set -uo pipefail
cd "$CLAUDE_PROJECT_DIR" || exit 2

# Hook input arrives as JSON on stdin. Only read stdin when it is not a terminal
# (running by hand from a shell must not block), and give up after 5s of silence.
INPUT=""
if [ ! -t 0 ]; then
  IFS= read -r -d '' -t 5 INPUT || true
fi

DECISION="run"
if [ -n "$INPUT" ]; then
  DECISION="$(printf '%s' "$INPUT" | bun -e '
    let input = {};
    try { input = JSON.parse(await Bun.stdin.text()); } catch { console.log("run"); process.exit(0); }
    if (input.stop_hook_active === true) { console.log("skip:stop_hook_active"); process.exit(0); }
    const path = input.transcript_path;
    if (typeof path === "string") {
      try {
        const lines = (await Bun.file(path).text()).split("\n");
        // Walk back to the last assistant message that carries text (tool-use-only
        // entries are skipped) and look at how it begins.
        for (let i = lines.length - 1; i >= 0; i--) {
          let line;
          try { line = JSON.parse(lines[i]); } catch { continue; }
          if (!line || line.type !== "assistant") continue;
          const content = line.message && line.message.content;
          const texts = (Array.isArray(content) ? content : [])
            .filter((b) => b && b.type === "text" && typeof b.text === "string")
            .map((b) => b.text);
          if (texts.length === 0) continue;
          console.log(texts.join("\n").trim().startsWith("BLOCKED:") ? "skip:blocked" : "run");
          process.exit(0);
        }
      } catch {}
    }
    console.log("run");
  ' 2>/dev/null || echo "run")"
fi

case "$DECISION" in
  skip:stop_hook_active)
    echo "Post-task checks already ran once for this stop; letting the agent stop." >&2
    exit 0 ;;
  skip:blocked)
    echo "Agent ended with BLOCKED: — a sanctioned ending; skipping post-task checks." >&2
    exit 0 ;;
esac

echo "Running post-task checks..." >&2

# Lint
if ! bun run lint 2>&1; then
  echo "Lint failed. Fix lint errors before completing this task." >&2
  exit 2
fi

# Test
if ! bun run test 2>&1; then
  echo "Tests failed. Fix failing tests before completing this task." >&2
  exit 2
fi

# Build plugin
if ! bun run build:plugin 2>&1; then
  echo "Build failed. Fix build errors before completing this task." >&2
  exit 2
fi

echo "All checks passed." >&2
exit 0
