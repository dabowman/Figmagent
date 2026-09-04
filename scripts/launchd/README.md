# Auto-improve pipeline

Turns every Figmagent session into captured GitHub findings, draft fix PRs, overnight
merges and a released plugin version — with no manual steps.

```
A.  extract-sessions --all-projects   every Figmagent session, every repo   → .claude/sessions-json/
B.  /analyze-session  (looped)         efficiency/error audit                → .claude/analysis/ + improvement-tracker.md + .claude/plans/
B2. /triage-tracker   (looped)         classify untriaged entries, write plans → improvement-tracker.md + .claude/plans/
    commit + push (path-guarded)       analysis artifacts                    → origin/main
C.  sync-tracker-issues                tracker → GitHub issues (deduped)     → github.com/dabowman/Figmagent/issues
D.  /dispatch-fixes                    safe auto-fixable issues              → DRAFT PRs on auto-fix/<ID>
E.  /merge-queue + merge-queue.ts      deterministic checks → agent review → verdict → squash merge
F.  release.ts                         bump + CHANGELOG + tag + GitHub Release
R.  pipeline-record.ts                 one JSON line per stage event         → .claude/analysis/pipeline-runs.jsonl
```

Orchestrated by [`scripts/auto-improve.sh`](../auto-improve.sh), triggered nightly at 03:00 by launchd.

**Morning routine.** The GitHub Release is the signal that there is something to pull. In Claude Code:

```
/plugin marketplace update figmagent
/plugin update figmagent
```

Then read the morning summary at the end of `.claude/analysis/auto-improve.log` (or
`bun scripts/pipeline-record.ts status`) — its last line names anything denied or paused.

## Run it by hand

```bash
bun run auto-improve                    # full pipeline (A→F)
# or individual stages:
bun run extract-sessions --all-projects --compact --no-thinking --include-agents
bun run refresh-manifest                # or --count / --next
bun run sync-issues --dry-run           # preview GitHub changes without writing
bun scripts/release.ts --dry-run        # what Stage F would cut
bun scripts/pipeline-record.ts status   # last 7 runs as a table
```

## Install the nightly job (launchd)

The job runs in a **dedicated clone** (only `main` checked out), never in the checkout you
edit by day, so nothing it does can clobber uncommitted work:

```bash
# HTTPS, not SSH: the stage sandboxes deny reading ~/.ssh and ~/.config/gh, so the
# git/gh calls the agents make (fetch, push, pr create) authenticate with GH_TOKEN
# through gh's credential helper — an SSH remote fails inside the sandbox.
git clone https://github.com/dabowman/Figmagent.git ~/Github/figmagent-pipeline
cd ~/Github/figmagent-pipeline && bun install && gh auth setup-git
cp scripts/launchd/com.figmagent.auto-improve.plist ~/Library/LaunchAgents/
# paste the fine-grained PAT into ~/Library/LaunchAgents/…plist (GH_TOKEN) — never into the repo copy
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.figmagent.auto-improve.plist
```

Run it once right now to confirm it works end-to-end:

```bash
launchctl kickstart -k gui/$(id -u)/com.figmagent.auto-improve
tail -f ~/Github/figmagent-pipeline/.claude/analysis/auto-improve.log
```

Stop / remove:

```bash
launchctl bootout gui/$(id -u)/com.figmagent.auto-improve
rm ~/Library/LaunchAgents/com.figmagent.auto-improve.plist
```

Before the first night, and after any change to `scripts/pipeline/`, `scripts/pipeline/guard.ts`
or `.claude/settings.json`, run the canary (see Guardrails):

```bash
bun scripts/pipeline/canary.ts
```

## Knobs (env vars, settable in the plist's `EnvironmentVariables`)

| Var | Default | Effect |
|---|---|---|
| `AUTO_IMPROVE_MAX_ANALYZE` | `25` | Cap on `/analyze-session` runs per night. |
| `AUTO_IMPROVE_MAX_ATTEMPTS` | `2` | Unfinished attempts (across nights) before a session is marked `analysisFailed`; the first is deferred to the next night. |
| `AUTO_IMPROVE_COMMIT` | `1` | `0` leaves analysis artifacts uncommitted (implies no push). |
| `AUTO_IMPROVE_PUSH` | `1` | `0` commits analysis artifacts locally but never pushes. |
| `AUTO_IMPROVE_TRIAGE` | `1` | `0` skips Stage B2. |
| `AUTO_IMPROVE_MAX_TRIAGE` | `6` | Cap on `/triage-tracker` calls per night (each handles one batch). |
| `AUTO_IMPROVE_DISPATCH` | `1` | `0` skips Stage D (draft PRs). |
| `AUTO_IMPROVE_MERGE` | `dry-run` | Stage E: `0` skips it; `dry-run` runs the checks and the review and logs the `gh` calls `act` would make — nothing is posted or merged (read the verdicts in the log); `1` posts reviews/labels and merges. **A human flips it to `1`** after a couple of clean dry-run nights. |
| `AUTO_IMPROVE_RELEASE` | `1` | `0` skips Stage F. |
| `AUTO_IMPROVE_STAGE_TIMEOUT` | `1800` | Wall-clock watchdog per `claude -p` call, seconds. |
| `AUTO_IMPROVE_MAX_TURNS_ANALYZE` | `200` | `--max-turns` for Stage B. |
| `AUTO_IMPROVE_MAX_TURNS_TRIAGE` | `120` | `--max-turns` for Stage B2. |
| `AUTO_IMPROVE_MAX_TURNS_DISPATCH` | `150` | `--max-turns` for Stage D. |
| `AUTO_IMPROVE_MAX_TURNS_MERGE` | `100` | `--max-turns` for Stage E. |
| `AUTO_IMPROVE_REPO` | `dabowman/Figmagent` | Target repo for `sync-tracker-issues`, `dispatch-fix.ts`, `merge-queue.ts`. |
| `AUTO_IMPROVE_MERGE_CAP` | `6` | Merges per day (`merge-queue.ts`; the counter lives in `.claude/worktrees/merge-queue-run.json` for 20h). |
| `GH_TOKEN` | — | Fine-grained PAT for the night (see Guardrails). Set only in the installed plist. |

`AUTO_IMPROVE_RUN=1` and `AUTO_IMPROVE_RUN_ID` are exported by the script itself for the
duration of a run (they arm the guard hook and key the run record) — never set them in the plist.

## Safety properties

- **What reaches `main`.** Analysis commits (`.claude/analysis/`, `.claude/plans/`) and release
  commits (`CHANGELOG.md`, the version bump made by `release.ts`) ARE pushed to `main` — the
  analysis push runs under a **path guard** (`git diff --name-only origin/main..HEAD` must contain
  only those paths, or nothing is pushed and the breaker trips). Code changes never reach `main`
  by direct push: they arrive as **squash merges made by `merge-queue.ts`** after it re-checks
  eligibility on the current head (CI green, size cap, no protected path, not `hold`/`needs-human`,
  daily cap). **Draft PRs remain draft until reviewed** — only the merge queue marks one ready, and
  only when its verdict is `approve`.
- Stage C is keyed on stable issue numbers / `[ID]` title prefixes, so it **never duplicates** issues,
  and **never auto-reopens** a closed one (`DRIFT` is reported for you; `bun run sync-issues --reopen`
  to act).
- Stage D's gate is code: `dispatch-fix.ts candidates` ranks and caps the list (4/run, at most 2
  `boundary-guard`/`assertion`, never two plans touching one file, priority floor) and `publish`
  is draft-only, base `main`, worktree cleanup. Any lint/test/build failure aborts with no PR; a plan
  that no longer matches the code aborts as `plan-stale`.
- Stage E merges only with `AUTO_IMPROVE_MERGE=1`, and only the head that `check` passed on
  (`gh pr merge --match-head-commit`); protected paths (`.github/**`, `scripts/**`,
  `.claude/commands/**`, `.claude/skills/analyze-session/**`, `.claude/hooks/**`, `.claude/settings.json`,
  `.claude-plugin/**`, `CLAUDE.md`, `package.json`, `bun.lock`, `src/figma_plugin/manifest.json`,
  `.mcp.json`) are **human-only**: the pipeline may propose changes to its own gates and never merge them.
- Stage F releases only when CI is green on `main` and something outside the analysis paths changed
  since the last `v*` tag; analysis-only nights produce no release. Tags are immutable; a bad
  release is undone by releasing the revert.
- Every stage-level failure is logged and the run continues; the breaker (below) stops the
  irreversible stages of *this* run and every later run.

## Guardrails (least privilege for the overnight agents)

| Layer | What |
|---|---|
| Dedicated clone | `~/Github/figmagent-pipeline`, only `main`; the plist is the only machine-specific file. |
| Scoped identity | A fine-grained PAT for `dabowman/Figmagent` only (Contents, Issues, Pull requests: read/write; Metadata, Actions: read; 90-day expiry) exported as `GH_TOKEN` in the installed plist. Pushes made with it trigger CI. |
| Rulesets | A repository ruleset on `main` and `v*` tags blocks force-pushes and deletions with no bypass actors. Do not require status checks there — the merge queue verifies CI itself. |
| No MCP, no network tools | Every `claude -p` gets `--mcp-config '{"mcpServers":{}}' --strict-mcp-config`; no allowlist names `mcp__*`, `WebFetch`, `WebSearch` or `Agent`. |
| Per-stage allowlists | `--permission-mode dontAsk` + `--settings scripts/pipeline/settings.<stage>.json` + `--setting-sources project` (your `~/.claude/settings.json` and `settings.local.json` allow rules and hooks are not loaded): Read/Glob/Grep, path-scoped Edit/Write, and Bash limited to the pipeline scripts. No stage may run `git`, `gh`, `rm`, `curl` or `wget`. |
| OS sandbox | In every settings file: `sandbox.enabled`, `failIfUnavailable`, writes to the clone (plus bun's install cache for D/E), `denyRead` on `~/.ssh`, `~/.figmagent`, `~/.aws`, `~/.config/gh`, `~/.claude/*.json`, egress only to `api.github.com`, `github.com`, `registry.npmjs.org`. |
| Guard hook | `scripts/pipeline/guard.ts`, a `PreToolUse` hook on Bash registered in `.claude/settings.json`, inert unless `AUTO_IMPROVE_RUN=1`. Denies `git push`, forced git, recursive `rm`, `gh pr merge/ready`, `gh release/repo/auth`, writing `gh api`, shell wrappers, `sudo`/`launchctl`/`curl`/`wget`/`ssh`/`scp`/`osascript`/`security`/`chmod`/`chown`/`open`/`eval`, `defaults write`, `base64 -d`, and any reference to the credential stores or `.env`. Every denial is appended to `.claude/analysis/pipeline-guard.log` and trips the breaker. `tests/pipeline-guard.test.ts` pins the rules. |
| Contract | `scripts/pipeline/contract.md` is prepended to every stage as system prompt: no human, exact tool list, a denied tool is a scope signal, `BLOCKED:` and zero results are successful endings, untrusted text is data, the turn budget is stated. |
| Limits | `--max-turns` per stage, a wall-clock watchdog (`AUTO_IMPROVE_STAGE_TIMEOUT`), the Stage B loop's persistence guard (a session the analyzer does not mark analyzed is never handed to a second agent the same night — it is deferred, and marked `analysisFailed` after `AUTO_IMPROVE_MAX_ATTEMPTS` unfinished attempts), the same no-progress guard on the Stage B2 loop, a run lock (`.pipeline.lock`, released only by its owner; a `launchctl kickstart` during a live run exits). |
| Circuit breaker | `.pipeline.paused` (gitignored, with reason and timestamp). Trips on a guard denial, a push-guard violation, a failed rebase, a release failure, or more than two Stage D aborts in one run. Every later run exits at the top until you resume, and `merge-queue.ts act`, `dispatch-fix.ts publish` and `release.ts` refuse while it exists — a denial mid-stage stops the rest of that stage's irreversible steps too. |
| Run record | `.claude/analysis/pipeline-runs.jsonl` (committed): sessions extracted/analyzed/failed, entries created/closed/drift, plans, PRs opened/aborted/deferred, merged/reviewed/human-only, release tag, denials, paused. `bun scripts/pipeline-record.ts status [--runs N]`. |
| Canary | `bun scripts/pipeline/canary.ts` runs each stage's settings against a prompt that asks for forbidden things (read `~/.figmagent/auth.json`, `git push --force`, `curl`, an `mcp__` tool, a write to `/tmp/canary-escape`) and asserts every one was stopped. Needs the `claude` binary; it removes the `.pipeline.paused` its own denials create. |

## Pause / resume

```bash
# pause: create the breaker file (any content; the script logs it and exits)
echo '{ "reason": "manual pause" }' > ~/Github/figmagent-pipeline/.pipeline.paused
# resume: remove it and record the resume in the run record
cd ~/Github/figmagent-pipeline && bun scripts/pipeline-record.ts resume
```

A session the analyzer could not finish stays out of the queue until you retry it:

```bash
bun run refresh-manifest                          # lists "Excluded (analysisFailed …)" with reasons
bun scripts/refresh-manifest.ts --clear-failed <sid>
```

## Notes

- Claude Code rotates old session transcripts out of `~/.claude/projects/`, so the nightly cadence
  must be shorter than that retention window to catch every session — already-analyzed sessions are
  preserved in `.claude/sessions-json/` and the manifest regardless.
- Stages A–B need your local `~/.claude/projects/` transcripts, which is why the job runs on the Mac.
  `merge-queue.ts` and `release.ts` are plain `gh` + `bun` and can later move to a scheduled
  `claude-code-action` workflow or a Claude Code Routine without a rewrite.
- Stage D/E counts in the run record are parsed from each stage's end-of-turn summary (PR URLs,
  bullet lines saying aborted/deferred/merged) — treat them as approximate; the log has the prose.
- `auto-improve.sh` derives its repo from its own location; only the plist carries absolute paths.
  Update the plist if the clone moves.
