#!/bin/bash
###############################################################################
# Figmagent auto-improve pipeline (nightly).
#
# Closes the loop from "I ran a Figmagent session" to "the finding is captured
# in GitHub and a fix is proposed", with no manual steps:
#
#   A. Extract every Figmagent session across ALL repos + refresh the manifest
#   B. Analyze each unanalyzed figma session  (the /analyze-session skill)
#   C. Sync the improvement tracker → GitHub issues  (create/close, deduped)
#   D. Open DRAFT PRs for safe, auto-fixable issues that have a fix plan
#
# Stages A and C are deterministic scripts. Stages B and D invoke Claude Code
# headless (`claude -p`). Nothing is pushed to main and no PR is opened
# ready-for-review — only draft PRs reach GitHub for code changes.
#
# Wire it to launchd with scripts/launchd/com.figmagent.auto-improve.plist.
# Run manually any time: bun run auto-improve   (or bash scripts/auto-improve.sh)
###############################################################################

# NOTE: no `set -e` — a failure in one stage should not abort the rest; each
# stage logs its own outcome and we continue.
set -uo pipefail

REPO_DIR="/Users/davidbowman/Github/cursor-talk-to-figma-mcp"
BUN="/Users/davidbowman/.bun/bin/bun"
CLAUDE="/Users/davidbowman/.local/bin/claude"
# launchd starts with a minimal PATH; make the tools we shell out to reachable.
export PATH="/opt/homebrew/bin:/Users/davidbowman/.bun/bin:/Users/davidbowman/.local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"

# Tunables (override via env / launchd EnvironmentVariables)
MAX_ANALYZE="${AUTO_IMPROVE_MAX_ANALYZE:-25}"   # hard cap on analyses per run
DO_COMMIT="${AUTO_IMPROVE_COMMIT:-1}"           # commit analysis artifacts to main (local, no push)
DO_DISPATCH="${AUTO_IMPROVE_DISPATCH:-1}"       # Stage D: open draft fix PRs
PERMS="${AUTO_IMPROVE_CLAUDE_FLAGS:---dangerously-skip-permissions}"

cd "$REPO_DIR" || { echo "cannot cd to $REPO_DIR"; exit 1; }
mkdir -p .claude/analysis
LOG=".claude/analysis/auto-improve.log"
ts() { date "+%Y-%m-%d %H:%M:%S"; }

{
echo ""
echo "========================= auto-improve $(ts) ========================="

# ---- Stage A: extract (all repos) + refresh manifest -----------------------
echo "[$(ts)] Stage A — extract Figmagent sessions across all repos"
"$BUN" scripts/extract-sessions.ts --all-projects --compact --no-thinking --include-agents
"$BUN" scripts/refresh-manifest.ts

# ---- Stage B: analyze each unanalyzed figma session ------------------------
echo "[$(ts)] Stage B — analyze sessions (cap $MAX_ANALYZE)"
for ((n = 1; n <= MAX_ANALYZE; n++)); do
  NEEDS="$("$BUN" scripts/refresh-manifest.ts --count 2>/dev/null)"
  echo "[$(ts)]   sessions needing analysis: ${NEEDS:-?}"
  [[ "${NEEDS:-0}" =~ ^[0-9]+$ ]] || { echo "[$(ts)]   manifest count unreadable — stopping Stage B"; break; }
  [ "$NEEDS" -eq 0 ] && break
  # Each call is a fresh, small-context session (the skill analyzes one at a
  # time and marks it done in the manifest). The loop guard above stops us.
  "$CLAUDE" -p "/analyze-session" $PERMS \
    || echo "[$(ts)]   /analyze-session exited non-zero (continuing)"
done

# ---- commit analysis artifacts so Stage D branches from a clean tree --------
if [ "$DO_COMMIT" = "1" ]; then
  if ! git diff --quiet -- .claude/analysis .claude/plans 2>/dev/null \
     || [ -n "$(git ls-files --others --exclude-standard .claude/analysis .claude/plans)" ]; then
    echo "[$(ts)] committing analysis artifacts (local, no push)"
    git add .claude/analysis .claude/plans
    git -c commit.gpgsign=false commit -q -m "auto-improve: session analyses $(date +%F)" \
      || echo "[$(ts)]   nothing to commit / commit failed (continuing)"
  fi
fi

# ---- Stage C: sync tracker → GitHub issues ---------------------------------
echo "[$(ts)] Stage C — sync improvement tracker → GitHub issues"
"$BUN" scripts/sync-tracker-issues.ts

# ---- Stage D: open draft PRs for safe auto-fixable issues ------------------
if [ "$DO_DISPATCH" = "1" ]; then
  echo "[$(ts)] Stage D — dispatch draft fix PRs"
  "$CLAUDE" -p "/dispatch-fixes" $PERMS \
    || echo "[$(ts)]   /dispatch-fixes exited non-zero (continuing)"
else
  echo "[$(ts)] Stage D — skipped (AUTO_IMPROVE_DISPATCH=0)"
fi

echo "[$(ts)] run complete"
} >> "$LOG" 2>&1
