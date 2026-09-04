#!/bin/bash
###############################################################################
# Figmagent auto-improve pipeline (nightly).
#
# Closes the loop from "I ran a Figmagent session" to "the fix is in the
# released plugin", with no manual steps:
#
#   A.  Extract every Figmagent session across ALL repos + refresh the manifest
#   B.  Analyze each unanalyzed figma session        (/analyze-session, looped)
#   B2. Triage untriaged tracker entries → plans     (/triage-tracker, looped)
#       commit + push analysis artifacts to main     (path-guarded push)
#   C.  Sync the improvement tracker → GitHub issues (create/close, deduped)
#   D.  Open DRAFT PRs for auto-fixable issues       (/dispatch-fixes)
#   E.  Review-and-merge eligible PRs                (/merge-queue + merge-queue.ts)
#   F.  Release: bump, CHANGELOG, tag, GitHub Release (release.ts)
#   R.  One JSON line per stage event → .claude/analysis/pipeline-runs.jsonl
#
# Stages A, C and F, and every irreversible step, are deterministic scripts.
# Stages B, B2, D and E invoke Claude Code headless (`claude -p`) under least
# privilege: --permission-mode dontAsk with a per-stage allowlist
# (scripts/pipeline/settings.<stage>.json), no MCP servers, the OS sandbox, a
# turn cap, a wall-clock watchdog, the unattended contract
# (scripts/pipeline/contract.md) as system prompt, and the PreToolUse guard
# hook (scripts/pipeline/guard.ts — live only while AUTO_IMPROVE_RUN=1).
#
# Safety properties (full list in scripts/launchd/README.md):
#   - the only pushes to main from here carry .claude/analysis/, .claude/plans/
#     or CHANGELOG.md (push guard); release.ts makes its own release push;
#   - merges are squash merges made by merge-queue.ts after re-checking
#     eligibility; draft PRs stay draft until reviewed;
#   - the circuit breaker (.pipeline.paused) stops every later run after a
#     guard denial, a push-guard trip, a release failure or >2 Stage D aborts,
#     until `bun scripts/pipeline-record.ts resume`.
#
# Wire it to launchd with scripts/launchd/com.figmagent.auto-improve.plist.
# Run manually any time: bun run auto-improve   (or bash scripts/auto-improve.sh)
###############################################################################

# NOTE: no `set -e` — a failure in one stage should not abort the rest; each
# stage logs its own outcome and we continue (or trip the breaker on purpose).
set -uo pipefail

# The repo is wherever this script lives (a dedicated clone at night — see the
# README). The plist is the only file that carries a machine-specific path.
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# launchd starts with a minimal PATH; make the tools we shell out to reachable.
export PATH="/opt/homebrew/bin:$HOME/.bun/bin:$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"
BUN="$(command -v bun || echo /Users/davidbowman/.bun/bin/bun)"
CLAUDE="$(command -v claude || echo /Users/davidbowman/.local/bin/claude)"

# ---- knobs (override via env / launchd EnvironmentVariables) ----------------
MAX_ANALYZE="${AUTO_IMPROVE_MAX_ANALYZE:-25}"        # cap on analyses per run
DO_COMMIT="${AUTO_IMPROVE_COMMIT:-1}"                # commit analysis artifacts (main only)
DO_PUSH="${AUTO_IMPROVE_PUSH:-1}"                    # push them to origin/main (path-guarded)
DO_DISPATCH="${AUTO_IMPROVE_DISPATCH:-1}"            # Stage D: open draft fix PRs
DO_TRIAGE="${AUTO_IMPROVE_TRIAGE:-1}"                # Stage B2: triage untriaged tracker entries
MAX_TRIAGE="${AUTO_IMPROVE_MAX_TRIAGE:-6}"           # cap on /triage-tracker calls per run
MERGE_MODE="${AUTO_IMPROVE_MERGE:-dry-run}"          # Stage E: 0 (skip) | dry-run | 1 — a human flips it to 1
DO_RELEASE="${AUTO_IMPROVE_RELEASE:-1}"              # Stage F: 0 | 1
STAGE_TIMEOUT="${AUTO_IMPROVE_STAGE_TIMEOUT:-1800}"  # wall-clock watchdog per `claude -p` call (seconds)
MAX_TURNS_ANALYZE="${AUTO_IMPROVE_MAX_TURNS_ANALYZE:-200}"
MAX_TURNS_TRIAGE="${AUTO_IMPROVE_MAX_TURNS_TRIAGE:-120}"
MAX_TURNS_DISPATCH="${AUTO_IMPROVE_MAX_TURNS_DISPATCH:-150}"
MAX_TURNS_MERGE="${AUTO_IMPROVE_MAX_TURNS_MERGE:-100}"
# merge-queue.ts and release.ts read these themselves; export the effective
# values so a knob defaulted here reaches them unchanged.
export AUTO_IMPROVE_MERGE="$MERGE_MODE"
export AUTO_IMPROVE_RELEASE="$DO_RELEASE"

cd "$REPO_DIR" || { echo "cannot cd to $REPO_DIR"; exit 1; }
mkdir -p .claude/analysis
LOG=".claude/analysis/auto-improve.log"
PAUSED=".pipeline.paused"
LOCK=".pipeline.lock"
GUARD_LOG=".claude/analysis/pipeline-guard.log"
STAGE_OUT="/dev/null"
ts() { date "+%Y-%m-%d %H:%M:%S"; }
log() { echo "[$(ts)] $*"; }

{
echo ""
echo "========================= auto-improve $(ts) ========================="

# ---- circuit breaker: a tripped breaker stops every run until a human resumes
# Trips (below): a guard-hook denial, a push-guard violation, a failed
# rebase, a release failure, more than two Stage D aborts in one run.
if [ -e "$PAUSED" ]; then
  log "PAUSED — $PAUSED exists; not running. Contents:"
  cat "$PAUSED"
  log "resume with: bun scripts/pipeline-record.ts resume"
  exit 0
fi

# ---- run lock: a `launchctl kickstart` during a scheduled run exits instead
# of overlapping (two runs would race on the manifest, worktrees and pushes).
# mkdir is atomic; a lock older than 6h is a crashed run and is removed.
if ! mkdir "$LOCK" 2>/dev/null; then
  if [ -n "$(find "$LOCK" -maxdepth 0 -mmin +360 2>/dev/null)" ]; then
    log "WARNING: stale run lock older than 6h ($LOCK) — removing it"
    rm -f "$LOCK/pid"; rmdir "$LOCK" 2>/dev/null
    mkdir "$LOCK" 2>/dev/null || { log "cannot take the run lock — exiting"; exit 1; }
  else
    log "another run holds $LOCK (pid $(cat "$LOCK/pid" 2>/dev/null || echo '?')) — exiting"
    exit 0
  fi
fi
echo $$ > "$LOCK/pid"
RUN_TMP="$(mktemp -d "${TMPDIR:-/tmp}/auto-improve.XXXXXX")"
cleanup() { rm -f "$LOCK/pid"; rmdir "$LOCK" 2>/dev/null; rm -rf "$RUN_TMP"; }
trap cleanup EXIT

RUN_ID="$(date +%Y%m%dT%H%M%S)"
RUN_START="$(date +%s)"
RUN_START_ISO="$(date -u +%Y-%m-%dT%H:%M:%S)"
export AUTO_IMPROVE_RUN=1            # arms the PreToolUse guard hook for every claude -p below
export AUTO_IMPROVE_RUN_ID="$RUN_ID" # the guard tags its log lines with it; the run record keys on it
export GIT_TERMINAL_PROMPT=0         # never hang on a credential prompt at 03:00
log "run $RUN_ID in $REPO_DIR (bun: $BUN, claude: $CLAUDE)"

# ---- helpers -----------------------------------------------------------------

# record <stage> [key=value ...]: one line in the run record (never fatal)
record() { "$BUN" scripts/pipeline-record.ts event --run "$RUN_ID" --stage "$@" 2>/dev/null || log "  (run record write failed: $*)"; }

# trip_breaker <reason>: write .pipeline.paused (unless already there) so every
# later run exits at the top, and record it. Later stages in THIS run that push,
# merge or release check breaker_tripped and skip — a tripped breaker means a
# human should look before anything else irreversible happens.
BREAKER_RECORDED=0
trip_breaker() {
  local reason="$1"
  log "BREAKER TRIPPED: $reason"
  if [ ! -e "$PAUSED" ]; then
    printf '{ "at": "%s", "reason": "%s", "run": "%s" }\n' \
      "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${reason//\"/\'}" "$RUN_ID" > "$PAUSED"
  fi
  if [ "$BREAKER_RECORDED" -eq 0 ]; then record breaker paused=1 "reason=$reason"; BREAKER_RECORDED=1; fi
}
breaker_tripped() { [ -e "$PAUSED" ]; }
paused_reason() { sed -n 's/.*"reason": *"\([^"]*\)".*/\1/p' "$PAUSED" 2>/dev/null | head -n1; }

# Guard denials during this run: the hook tags each log line with the run id;
# a line stamped after the run started counts too (belt and braces, in case the
# id did not reach the hook's environment). ISO timestamps compare as strings.
guard_denials() {
  [ -f "$GUARD_LOG" ] || { echo 0; return; }
  awk -v id="\"run\":\"$RUN_ID\"" -v start="$RUN_START_ISO" '
    { t = ""; if (match($0, /"ts":"[^"]*"/)) t = substr($0, RSTART + 6, RLENGTH - 7)
      if (index($0, id) || (t != "" && t >= start)) n++ }
    END { print n + 0 }' "$GUARD_LOG" 2>/dev/null || echo 0
}
GUARD_SEEN=0
check_guard() {
  local n; n="$(guard_denials)"
  if [ "$n" -gt "$GUARD_SEEN" ]; then
    log "  GUARD: $((n - GUARD_SEEN)) command(s) denied by scripts/pipeline/guard.ts this stage (see $GUARD_LOG)"
    record guard "denials=$((n - GUARD_SEEN))"
    GUARD_SEEN="$n"
  fi
  # The hook writes .pipeline.paused itself; make sure the run record says so.
  if breaker_tripped && [ "$BREAKER_RECORDED" -eq 0 ]; then
    record breaker paused=1 "reason=$(paused_reason)"; BREAKER_RECORDED=1
    log "BREAKER TRIPPED by the guard hook: $(paused_reason)"
  fi
}

# allowed_tools <settings.json>: the stage's permissions.allow list, for the contract
allowed_tools() {
  SETTINGS_FILE="$1" "$BUN" -e 'const s = await Bun.file(process.env.SETTINGS_FILE).json(); console.log(((s.permissions && s.permissions.allow) || []).join(", "))' 2>/dev/null
}
# sed_escape <text>: safe inside a `|`-delimited sed replacement
sed_escape() { printf '%s' "$1" | sed -e 's/[\\&|]/\\&/g'; }
# fill_contract <stage label> <tools> <max turns>: the unattended contract, filled
fill_contract() {
  sed -e "s|{{STAGE}}|$(sed_escape "$1")|g" \
      -e "s|{{TOOLS}}|$(sed_escape "$2")|g" \
      -e "s|{{MAX_TURNS}}|$(sed_escape "$3")|g" scripts/pipeline/contract.md
}

# run_with_watchdog <seconds> <cmd...>: coreutils timeout when available
# (gtimeout from Homebrew coreutils on macOS), else a sleep && kill sibling.
run_with_watchdog() {
  local secs="$1"; shift
  local t
  for t in gtimeout timeout; do
    if command -v "$t" >/dev/null 2>&1; then "$t" -k 30 "$secs" "$@"; return $?; fi
  done
  "$@" &
  local pid=$!
  ( sleep "$secs"; kill -TERM "$pid" 2>/dev/null; sleep 30; kill -KILL "$pid" 2>/dev/null ) &
  local wd=$!
  wait "$pid"; local rc=$?
  kill "$wd" 2>/dev/null; wait "$wd" 2>/dev/null
  return "$rc"
}

# run_stage <stage> <slash command>: one headless Claude Code call under least
# privilege — dontAsk + the stage's allowlist, no MCP servers, turn cap,
# watchdog, contract as system prompt. Output goes to the log and to
# $STAGE_OUT (a temp file) so the caller can parse counts from the summary.
STAGE_N=0
run_stage() {
  local stage="$1" cmd="$2" label max_turns settings tools contract start rc
  case "$stage" in
    analyze)  label="B (/analyze-session)"; max_turns="$MAX_TURNS_ANALYZE" ;;
    triage)   label="B2 (/triage-tracker)"; max_turns="$MAX_TURNS_TRIAGE" ;;
    dispatch) label="D (/dispatch-fixes)";  max_turns="$MAX_TURNS_DISPATCH" ;;
    merge)    label="E (/merge-queue)";     max_turns="$MAX_TURNS_MERGE" ;;
    *) log "  unknown stage '$stage'"; STAGE_OUT="/dev/null"; return 1 ;;
  esac
  settings="scripts/pipeline/settings.$stage.json"
  if [ ! -f "$settings" ]; then
    log "  missing $settings — refusing to run $cmd without an allowlist"
    record "$stage" exit=127 seconds=0; STAGE_OUT="/dev/null"; return 1
  fi
  tools="$(allowed_tools "$settings")"
  contract="$(fill_contract "$label" "${tools:-none}" "$max_turns")"
  STAGE_N=$((STAGE_N + 1))
  STAGE_OUT="$RUN_TMP/$stage.$STAGE_N.out"
  start="$(date +%s)"
  run_with_watchdog "$STAGE_TIMEOUT" "$CLAUDE" -p "$cmd" \
      --permission-mode dontAsk \
      --settings "$settings" \
      --mcp-config '{"mcpServers":{}}' --strict-mcp-config \
      --max-turns "$max_turns" \
      --append-system-prompt "$contract" \
      </dev/null 2>&1 | tee "$STAGE_OUT"
  rc="${PIPESTATUS[0]}"
  [ "$rc" -eq 124 ] && log "  $cmd hit the ${STAGE_TIMEOUT}s watchdog and was killed"
  record "$stage" "exit=$rc" "seconds=$(( $(date +%s) - start ))"
  check_guard
  return "$rc"
}

count_plans() { ls .claude/plans/*.md 2>/dev/null | wc -l | tr -d ' '; }
# nth <keyword> <text>: the number before <keyword> in a Stage C summary line, or 0
nth() { local v; v="$(printf '%s' "$2" | grep -Eo "[0-9]+ $1" | head -n1 | grep -Eo '^[0-9]+')"; echo "${v:-0}"; }
# bullets <regex> <file>: count bullet lines of an end-of-turn summary matching <regex>
bullets() { local v; v="$(grep -Eci "^[[:space:]]*[-*].*(^|[^a-z])($1)([^a-z]|$)" "$2" 2>/dev/null)"; echo "${v:-0}"; }

# ---- Stage A: extract (all repos) + refresh manifest ------------------------
log "Stage A — extract Figmagent sessions across all repos"
"$BUN" scripts/extract-sessions.ts --all-projects --compact --no-thinking --include-agents 2>&1 | tee "$RUN_TMP/extract.out"
EXTRACTED="$(grep -Eo '^[0-9]+ extracted' "$RUN_TMP/extract.out" | tail -n1 | grep -Eo '^[0-9]+')"
"$BUN" scripts/refresh-manifest.ts 2>&1 | tee "$RUN_TMP/refresh.out"
QUEUED="$(grep -Eo 'needs analysis: [0-9]+' "$RUN_TMP/refresh.out" | tail -n1 | grep -Eo '[0-9]+$')"
record extract "extracted=${EXTRACTED:-0}" "queued=${QUEUED:-0}"

# ---- Stage B: analyze each unanalyzed figma session -------------------------
log "Stage B — analyze sessions (cap $MAX_ANALYZE, $MAX_TURNS_ANALYZE turns each)"
PLANS_BEFORE="$(count_plans)"
PREV=""; ANALYZED=0; FAILED=0; RUNS=0
mark_failed() {
  "$BUN" scripts/refresh-manifest.ts --mark-failed "$1" --reason "analyze-session ran but did not mark the session analyzed"
  record analyze failed=1 "session=$1"
  FAILED=$((FAILED + 1))
}
for ((n = 1; n <= MAX_ANALYZE; n++)); do
  NEEDS="$("$BUN" scripts/refresh-manifest.ts --count 2>/dev/null | tail -n1)"
  log "  sessions needing analysis: ${NEEDS:-<unreadable>}"
  # Test the RAW value: an empty count (script crashed) or non-numeric line must
  # STOP — not fall through and fire analyze up to MAX_ANALYZE times. ${NEEDS:-0}
  # would mask an empty value as "0" and pass this guard.
  [[ "$NEEDS" =~ ^[0-9]+$ ]] || { log "  manifest count unreadable — stopping Stage B"; break; }
  [ "$NEEDS" -eq 0 ] && break
  NEXT="$("$BUN" scripts/refresh-manifest.ts --next 2>/dev/null | tail -n1)"
  [ -n "$NEXT" ] || { log "  --next returned nothing while the count is $NEEDS — stopping Stage B"; break; }
  # Persistence guard (prompt review, finding 1): the analyzer ran on this very
  # session last iteration and the manifest still offers it first, so the skill
  # did not mark it analyzed (unreadable transcript, turn cap, crash). Take it
  # out of the queue with the reason instead of handing it to another fresh
  # agent — that used to happen up to MAX_ANALYZE times, each attempt bumping
  # the analysis filename and possibly appending tracker entries.
  if [ "$NEXT" = "$PREV" ]; then
    log "  $NEXT is still queued after an analysis run — marking it failed and moving on"
    mark_failed "$NEXT"; PREV=""
    continue
  fi
  # The previous pick moved off the head of the queue: that run succeeded.
  [ -n "$PREV" ] && { ANALYZED=$((ANALYZED + 1)); record analyze analyzed=1 "session=$PREV"; }
  "$BUN" scripts/refresh-manifest.ts --mark-attempt "$NEXT" >/dev/null
  log "  analyzing $NEXT"
  # Each call is a fresh, small-context session (the skill analyzes one at a
  # time and marks it done in the manifest).
  run_stage analyze "/analyze-session" || log "  /analyze-session exited non-zero (continuing)"
  RUNS=$((RUNS + 1)); PREV="$NEXT"
  breaker_tripped && { log "  breaker tripped — stopping Stage B"; break; }
done
# Settle the last run's outcome with one more look at the queue.
if [ -n "$PREV" ]; then
  if [ "$("$BUN" scripts/refresh-manifest.ts --next 2>/dev/null | tail -n1)" = "$PREV" ]; then
    log "  $PREV is still queued after the final analysis run — marking it failed"
    mark_failed "$PREV"
  else
    ANALYZED=$((ANALYZED + 1)); record analyze analyzed=1 "session=$PREV"
  fi
fi
log "Stage B done: $RUNS run(s), $ANALYZED analyzed, $FAILED failed"

# ---- Stage B2: triage untriaged tracker entries against the allowlist ------
if [ "$DO_TRIAGE" != "1" ]; then
  log "Stage B2 — skipped (AUTO_IMPROVE_TRIAGE=0)"
elif breaker_tripped; then
  log "Stage B2 — skipped (breaker tripped)"
else
  log "Stage B2 — triage tracker entries (up to $MAX_TRIAGE calls, $MAX_TURNS_TRIAGE turns each)"
  for ((t = 1; t <= MAX_TRIAGE; t++)); do
    run_stage triage "/triage-tracker" || log "  /triage-tracker exited non-zero (continuing)"
    # Each call handles one batch; stop early when it reports there is nothing
    # left (a BLOCKED: line or a "nothing to triage" summary — both are
    # successful runs under the contract).
    if grep -Eqi '^BLOCKED:|nothing (left |more )?to triage|no untriaged entries' "$STAGE_OUT" 2>/dev/null; then
      log "  triage reports nothing more to do"; break
    fi
    breaker_tripped && { log "  breaker tripped — stopping Stage B2"; break; }
  done
fi
record triage "plans=$(( $(count_plans) - PLANS_BEFORE ))"

# Branch guard: this is a main-branch maintenance job. Commit analyses and run
# Stages D–F only on main — otherwise the auto-commit would land on whatever
# feature branch is checked out, and Stage D's PRs would build off the wrong base.
BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"

# push_main: push local main to origin under the PATH GUARD. Only commits whose
# every path is under .claude/analysis/, .claude/plans/ or CHANGELOG.md may
# leave the Mac from here (release.ts makes its own push). Anything else is
# logged loudly, NOT pushed, and trips the breaker — a foreign commit on the
# pipeline clone's main is exactly what a human should look at.
push_main() {
  [ "$DO_PUSH" = "1" ] || { log "  push disabled (AUTO_IMPROVE_PUSH=0)"; return 0; }
  [ "$BRANCH" = "main" ] || return 0
  if breaker_tripped; then log "  breaker tripped — not pushing"; return 1; fi
  if ! git fetch --quiet origin main 2>"$RUN_TMP/fetch.err"; then
    log "  git fetch origin main failed — not pushing"; cat "$RUN_TMP/fetch.err"; record push pushed=0; return 1
  fi
  # The tree is clean right after the commit above except for files git may
  # rewrite during the rebase (autostash covers a stray change). This log is
  # one of them and is held open by the redirect around this whole run, so
  # git's output goes to a temp file and the log is reopened by path afterwards
  # — otherwise the rest of the run would write to an unlinked inode.
  git pull --rebase --autostash --quiet origin main >"$RUN_TMP/pull.out" 2>&1
  local prc=$?
  exec >>"$LOG" 2>&1
  cat "$RUN_TMP/pull.out"
  if [ "$prc" -ne 0 ]; then
    log "  git pull --rebase origin main failed — aborting the rebase, not pushing"
    git rebase --abort 2>/dev/null
    trip_breaker "git pull --rebase origin main failed (conflicting analysis artifacts?)"
    return 1
  fi
  if [ -z "$(git rev-list origin/main..HEAD 2>/dev/null)" ]; then log "  nothing to push"; return 0; fi
  local outside
  outside="$(git diff --name-only origin/main..HEAD | grep -Ev '^(\.claude/analysis/|\.claude/plans/|CHANGELOG\.md$)' || true)"
  if [ -n "$outside" ]; then
    log "  PUSH GUARD: commits ahead of origin/main touch paths outside .claude/analysis/, .claude/plans/, CHANGELOG.md — NOT pushing:"
    echo "$outside" | sed 's/^/    /'
    trip_breaker "push guard: local main touches $(echo "$outside" | head -n3 | paste -sd ' ' -)"
    return 1
  fi
  if git push --quiet origin main 2>"$RUN_TMP/push.err"; then
    log "  pushed main to origin ($(git rev-parse --short HEAD))"; record push pushed=1
  else
    log "  git push origin main failed"; cat "$RUN_TMP/push.err"; record push pushed=0; return 1
  fi
}

# commit_artifacts <message>: commit analysis artifacts on main, then push_main.
commit_artifacts() {
  [ "$DO_COMMIT" = "1" ] || return 0
  if [ "$BRANCH" != "main" ]; then log "not on main (on '$BRANCH') — leaving analysis artifacts uncommitted"; return 0; fi
  if ! git diff --quiet -- .claude/analysis .claude/plans 2>/dev/null \
     || [ -n "$(git ls-files --others --exclude-standard .claude/analysis .claude/plans)" ]; then
    # The tracker's shape is what Stage C/D and CI depend on. An agent-written
    # line that breaks it (an `Auto-fixable: yes (<free text>)` that names no
    # allowlist pattern turned main red on 2026-09-04) must never reach origin:
    # leave the artifacts uncommitted for a human, and pause the pipeline.
    if ! "$BUN" test tests/tracker-shape.test.ts >"$RUN_TMP/tracker-shape.out" 2>&1; then
      log "  tracker shape test FAILED — analysis artifacts left uncommitted:"
      grep -E '^\(fail\)|error:' "$RUN_TMP/tracker-shape.out" | head -n 5 | sed 's/^/    /' | tee -a "$LOG" >/dev/null
      trip_breaker "tracker shape test failed after analysis (fix the offending line, then pipeline-resume)"
      return 1
    fi
    log "committing analysis artifacts to main"
    git add .claude/analysis .claude/plans
    git -c commit.gpgsign=false commit -q -m "$1" \
      || log "  nothing to commit / commit failed (continuing)"
  fi
  push_main
}

commit_artifacts "auto-improve: session analyses $(date +%F)"

# ---- Stage C: sync tracker → GitHub issues ----------------------------------
log "Stage C — sync improvement tracker → GitHub issues"
"$BUN" scripts/sync-tracker-issues.ts 2>&1 | tee "$RUN_TMP/sync.out"
SUMMARY="$(grep -E '[0-9]+ create, [0-9]+ close' "$RUN_TMP/sync.out" | tail -n1)"
record sync "created=$(nth create "$SUMMARY")" "closed=$(nth close "$SUMMARY")" \
  "reopened=$(nth reopen "$SUMMARY")" "drift=$(nth drift "$SUMMARY")" \
  "in_sync=$(nth in-sync "$SUMMARY")" "resolved_unfiled=$(nth resolved-unfiled "$SUMMARY")" \
  "dangling=$(nth DANGLING "$SUMMARY")" "sync_deferred=$(nth DEFERRED "$SUMMARY")"

# ---- Stage D: open draft PRs for safe auto-fixable issues -------------------
if [ "$DO_DISPATCH" != "1" ]; then
  log "Stage D — skipped (AUTO_IMPROVE_DISPATCH=0)"
elif [ "$BRANCH" != "main" ]; then
  log "Stage D — skipped (not on main, on '$BRANCH')"
elif breaker_tripped; then
  log "Stage D — skipped (breaker tripped)"
else
  log "Stage D — dispatch draft fix PRs ($MAX_TURNS_DISPATCH turns)"
  run_stage dispatch "/dispatch-fixes" || log "  /dispatch-fixes exited non-zero (continuing)"
  # Counts come from the stage's end-of-turn summary: unique PR URLs opened,
  # bullet lines that say aborted / deferred. Heuristic — the only signal that
  # does not depend on another script's output format — good enough for the
  # status table and for the >2-aborts breaker below.
  D_OPENED="$(grep -Eo 'pull/[0-9]+' "$STAGE_OUT" 2>/dev/null | sort -u | wc -l | tr -d ' ')"
  D_ABORTED="$(bullets 'aborted' "$STAGE_OUT")"
  D_DEFERRED="$(bullets 'deferred' "$STAGE_OUT")"
  record dispatch "opened=${D_OPENED:-0}" "aborted=$D_ABORTED" "deferred=$D_DEFERRED"
  log "  Stage D: $D_OPENED opened, $D_ABORTED aborted, $D_DEFERRED deferred"
  # More than two aborts in one run means the plans or the checks are broken,
  # not one bad plan — stop merging and releasing until someone looks.
  [ "$D_ABORTED" -gt 2 ] && trip_breaker "Stage D aborted $D_ABORTED candidates in one run"
fi

# ---- Stage E: review-and-merge eligible PRs --------------------------------
if [ "$MERGE_MODE" = "0" ]; then
  log "Stage E — skipped (AUTO_IMPROVE_MERGE=0)"
elif [ "$BRANCH" != "main" ]; then
  log "Stage E — skipped (not on main, on '$BRANCH')"
elif breaker_tripped; then
  log "Stage E — skipped (breaker tripped)"
else
  log "Stage E — review-and-merge (AUTO_IMPROVE_MERGE=$MERGE_MODE, $MAX_TURNS_MERGE turns)"
  # merge-queue.ts honors AUTO_IMPROVE_MERGE itself: dry-run posts reviews and
  # logs would-merge without merging; only 1 merges. The agent never merges.
  run_stage merge "/merge-queue" || log "  /merge-queue exited non-zero (continuing)"
  E_MERGED="$(grep -Ei '^[[:space:]]*[-*].*(^|[^a-z])merged([^a-z]|$)' "$STAGE_OUT" 2>/dev/null | grep -Evic 'would|not merged|no prs merged' || true)"
  E_REVIEWED="$(bullets 'request(ed)? changes|sent back|needs-human' "$STAGE_OUT")"
  E_HUMAN="$(bullets 'human-only' "$STAGE_OUT")"
  record merge "merged=${E_MERGED:-0}" "reviewed=$E_REVIEWED" "human_only=$E_HUMAN" "mode=$MERGE_MODE"
  log "  Stage E: ${E_MERGED:-0} merged, $E_REVIEWED sent back, $E_HUMAN human-only"
  "$BUN" scripts/merge-queue.ts cleanup 2>&1 || log "  merge-queue cleanup exited non-zero (continuing)"
fi

# ---- Stage F: release ---------------------------------------------------------
if [ "$DO_RELEASE" != "1" ]; then
  log "Stage F — skipped (AUTO_IMPROVE_RELEASE=0)"
elif [ "$BRANCH" != "main" ]; then
  log "Stage F — skipped (not on main, on '$BRANCH')"
elif breaker_tripped; then
  log "Stage F — skipped (breaker tripped)"
else
  log "Stage F — release"
  # release.ts gates itself (CI green on main, something outside the analysis
  # paths since the last tag) and prints `released vX.Y.Z` or
  # `nothing to release: <reason>`; non-zero means it failed part-way.
  "$BUN" scripts/release.ts >"$RUN_TMP/release.out" 2>&1
  F_RC=$?
  exec >>"$LOG" 2>&1   # release.ts commits and pushes; reopen the log in case the tree was rewritten
  cat "$RUN_TMP/release.out"
  TAG="$(grep -Eo 'released v[0-9]+\.[0-9]+\.[0-9]+' "$RUN_TMP/release.out" | tail -n1 | awk '{print $2}')"
  if [ "$F_RC" -ne 0 ]; then
    record release "exit=$F_RC"
    trip_breaker "release.ts exited $F_RC"
  elif [ -n "$TAG" ]; then
    record release "tag=$TAG"; log "  released $TAG"
  else
    REASON="$(grep -Eo 'nothing to release: .*' "$RUN_TMP/release.out" | tail -n1 | cut -d: -f2- | sed 's/^ *//')"
    record release "reason=${REASON:-unknown}"; log "  nothing to release: ${REASON:-unknown}"
  fi
fi

# ---- morning summary ---------------------------------------------------------
check_guard
DENIALS="$(guard_denials)"
record run "seconds=$(( $(date +%s) - RUN_START ))" "denials_total=$DENIALS"
log "run complete in $(( ($(date +%s) - RUN_START) / 60 ))m"
echo "----- morning summary (this run) -----"
"$BUN" scripts/pipeline-record.ts status --run "$RUN_ID" 2>&1
if breaker_tripped; then
  echo "denied: $DENIALS command(s)$([ "$DENIALS" -gt 0 ] && echo " (see $GUARD_LOG)"); PAUSED: $(paused_reason) — resume with: bun scripts/pipeline-record.ts resume"
else
  echo "denied: $DENIALS command(s)$([ "$DENIALS" -gt 0 ] && echo " (see $GUARD_LOG)"); paused: no"
fi
# The run record and this log are analysis artifacts too — commit and push them
# under the same path guard so the morning table is on origin, not just here.
commit_artifacts "auto-improve: run record $RUN_ID"
} >> "$LOG" 2>&1
