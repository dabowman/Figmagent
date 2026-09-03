# Plan: auto-improve v2 — from session to installed plugin, unattended

**Date**: 2026-09-03
**Scope**: evaluate the nightly self-improvement pipeline (Stages A–D), then add an
overnight review-and-merge stage and a daily plugin release so a finding made while
using Figmagent lands in the harness the next morning without manual steps.
**Status**: proposal, nothing implemented yet.

---

## 1. What exists today

```
03:00 local (launchd, this Mac)  scripts/auto-improve.sh
  A. extract-sessions --all-projects   ~/.claude/projects/*  →  .claude/sessions-json/  (gitignored)
     refresh-manifest                  →  .claude/analysis/sessions.json
  B. claude -p "/analyze-session"      one session per call, looped until the manifest reads 0
                                       →  figma-mcp-sessionN-analysis.md, improvement-tracker.md, .claude/plans/<date>-<ID>.md
     git commit (local only, main)     analysis artifacts; never pushed by the script
  C. sync-tracker-issues               tracker ### [ID] entries  ⇄  GitHub issues (create / close / DRIFT)
  D. claude -p "/dispatch-fixes"       plan + Auto-fixable + open issue  →  auto-fix/<ID> worktree  →  DRAFT PR
                                       (mechanics in scripts/dispatch-fix.ts; candidate selection is prose)
—— nothing after this point is automated ——
     you: mark PR ready, review, merge, bump version, push the analysis commits
     you: /plugin marketplace update figmagent && /plugin update figmagent
```

Design principle already in place and worth keeping: **judgement lives in prompts,
irreversible mechanics live in scripts** (`dispatch-fix.ts` is the model).

### 1.1 The funnel, measured

| Stage | Number | Source |
|---|---|---|
| Sessions extracted | 275 (56 figma · 183 dev · 36 empty) | `sessions.json` |
| Figma sessions analyzed | 56 of 56, backlog 0 | `sessions.json`, log 2026-09-03 |
| Tracker entries | 156 (68 identified · 10 planned · 29 implemented · 34 verified · 2 resolved · 1 mixed) | `improvement-tracker.md` |
| Entries with an `Auto-fixable` line | 42 (10 yes · 32 no); **114 have none** | tracker |
| Active `identified` entries with no `Auto-fixable` line | **36** | tracker |
| Plan files keyed to an ID | 11 | `.claude/plans/` |
| Open GitHub issues | 69 (64 `figmagent-improvement`) | GitHub |
| DRIFT rows reported every night | 12 (issue closed by a merged PR, tracker still `identified`/`planned`) | log |
| Stage D last night | 5 candidates → 3 preflighted → 1 draft PR (#199), 1 abort (bundle cap), 2 deferred (same-file rule) | log |
| PRs merged in the last 60 days | 24, of which 21 on one day (2026-09-02, by hand) | git |
| Tags / GitHub Releases | 0 / 0 | GitHub |
| Version bumps | one, by hand (`0.4.0`, PR #156, "covers eleven PRs") | git |
| Open PRs now | #199 (pipeline draft, marked ready by hand, CI green, unreviewed), #200 (yours, CI green) | GitHub |

### 1.2 What is working

- **Capture is trustworthy.** Sessions are discovered across every repo, classified on
  "made a Figmagent call that did something" (INFRA-005), and re-analysis is keyed on a
  content signature rather than mtime. Zero backlog three nights running.
- **Analysis quality is high.** Findings pin root causes to `file:line`, cross-reference
  concurrent sessions (BUG-047 proved a cross-session collision from two transcripts), and
  record Decision lines (34 so far) so a later stage does not re-ask.
- **Sync is safe.** Idempotent, deduped on the `[ID]` title key, never auto-reopens, warns on
  orphans and misplaced entries; `tests/tracker-shape.test.ts` pins the invariants.
- **Dispatch mechanics are non-negotiable in code.** Draft-only, base `main`, worktree
  cleanup, single repo. Last night's one PR (#199) was exactly the two-bullet description
  change its plan specified; lint and 618 tests passed.

### 1.3 Where the loop leaks, ranked by impact

1. **Updates are not reaching the harness.** Claude Code pins a plugin to its
   `plugin.json` `version`; if the version does not change, `/plugin update` keeps the cached
   copy ([plugin-marketplaces docs](https://code.claude.com/docs/en/plugin-marketplaces.md):
   "Bump the version on every release, or omit it"). `plugin.json` has been `0.4.0` since
   2026-09-02 04:02Z; #194, #198 and the marketplace commit all landed after that. Anything
   merged since is invisible to `/plugin update` until someone bumps the version by hand.
2. **Nothing merges without you.** Stage D stops at a draft. #199 was opened at 03:03,
   marked ready by hand later that day, and is still open with no review. The 21-merge burst
   on 2026-09-02 is what "catching up" looks like.
3. **Plan generation is the throughput bottleneck.** Every Stage B log line for a new finding
   ends "No fix plans generated, none match the allowlist". The allowlist was widened from
   three to seven patterns on 2026-09-02 (INFRA-006), but the analyzer only classifies at
   analysis time, so the 36 active entries with no `Auto-fixable` line (and the `no` verdicts
   written against the old allowlist) are never re-triaged. Stage D's candidate pool is
   whatever happened to be planned; last night that was 5 of 78 active entries.
4. **Tracker drift compounds nightly.** 12 issues are closed by merged `Closes #N` PRs but the
   tracker still says `identified`/`planned`, so Stage C prints 12 DRIFT rows every night and
   Stage D re-examines shipped work (TOOL-006 preflighted and skipped three nights running).
   INFRA-007 (#196) already names the fix.
5. **Analysis commits never leave the Mac.** Stage B commits to local `main` with no push;
   you push them by hand ("autoimprove log", 15:20 the next afternoon). Any stage that runs
   off the Mac cannot see the current tracker or the plan a PR claims to implement.
6. **The same-file rule defers a day per collision.** INFRA-008 and TOOL-040 were skipped
   only because another candidate's plan named the same file. With nothing merging in
   between, every collision costs a full day; with a merge stage it costs one pass.
7. **Stage D's gate is prose.** The 4/run cap, the ≤2 guards/assertions rule, the priority
   floor, and the same-file rule are enforced by the model reading
   `.claude/commands/dispatch-fixes.md`. Acceptable while a human merges every PR; not once
   merges are automatic.
8. **Smaller.** No structured record of what each run did (the log is prose; 1,300 lines and
   growing, committed). No measure of cycle time or of whether a shipped fix stopped
   recurring, beyond the analyzer's Phase 3 notes. `dispatch-fix.ts` hardcodes a co-author
   string for a model no longer in use. Absolute Mac paths in the script and plist. The
   `claude-issues.yml` label path (Sonnet implements an issue → PR) is a second, unmanaged
   producer of PRs. Cursor sessions are not captured (only `~/.claude/projects`; the server's
   own `~/.figmagent/sessions/` logs are unused).

### 1.4 Cycle time, today vs target

| Step | Today | Target |
|---|---|---|
| Session → analysis + issue | next 03:00 (same night) | same |
| Issue → plan | same night **if** the pattern was allowlisted at analysis time, else never | same night, or next night via triage |
| Plan → draft PR | same night | same |
| Draft PR → merged | manual, days to weeks | same night |
| Merged → released version | manual, weeks | same night |
| Released → in your harness | manual | one command each morning (or on your own schedule) |
| **Session → installed fix** | **weeks** | **≤ 30 hours** |

---

## 2. Target pipeline

```
03:00  A  extract + manifest                                   (unchanged)
       B  analyze each new session                             (unchanged)
       B2 triage: classify untriaged tracker entries against    NEW  /triage-tracker
          the current allowlist, write plans (cap N/night)
       C  sync tracker ⇄ issues, + reverse-sync closed-by-PR    CHANGED  INFRA-007
          push analysis/plan commits to origin/main             NEW
       D  dispatch draft PRs (candidates chosen by script)      CHANGED  gates into code
       E  review-and-merge: for each eligible PR, deterministic  NEW  /merge-queue + scripts/merge-queue.ts
          checks → agent review → structured verdict → squash-merge
       F  release: if main moved since the last tag, bump       NEW  scripts/release.ts
          version, CHANGELOG, tag vX.Y.Z, GitHub Release
       R  one JSON line per run: the funnel numbers             NEW  pipeline-runs.jsonl
morning   /plugin marketplace update figmagent && /plugin update figmagent
```

**Where E and F run (decision).** Append them to `auto-improve.sh` on the Mac, running
under your existing `gh` auth and `claude` subscription, right after Stage D. Reasons: one
log, one auth, no new secrets; merges and pushes made with your token trigger CI normally
(GitHub does not run workflows on pushes made with `GITHUB_TOKEN`, so a GitHub Actions
variant needs a PAT or the Claude GitHub App token); the Mac has run the 03:00 job three
nights in a row. The scripts are written runner-agnostic (plain `gh` + `bun`), so the same
`/merge-queue` and `release.ts` can later move to a scheduled `claude-code-action` workflow
or a Claude Code Routine if you want them independent of the Mac. That move is a scheduler
change, not a rewrite.

**Self-modification boundary (principle).** The pipeline may *propose* changes to its own
gates and never *merge* them: any PR touching a protected path is human-only, whatever else
it passes.

---

## 3. Workstreams

### WS1 — Capture, triage, sync (Stages A–D)

**1.1 Reverse-sync closed-by-PR issues** (`scripts/sync-tracker-issues.ts`, INFRA-007 / #196)
- For each tracker entry whose issue is `closed` with `state_reason: completed` and a merged
  PR in its timeline that `Closes #N`, rewrite the entry's `Status` line to
  `implemented — PR #M (YYYY-MM-DD)` and stop counting it as DRIFT. A manual close (no
  merged PR) stays DRIFT, as now.
- Effect: the 12 nightly DRIFT rows disappear, Stage D stops re-examining shipped work,
  the tracker becomes the truthful source it is documented to be.
- Test: extend `tests/tracker-shape.test.ts` or add `tests/sync-reverse.test.ts` on the
  pure "should this entry flip to implemented" function.

**1.2 Push analysis commits** (`scripts/auto-improve.sh`)
- After the existing local commit: `git pull --rebase origin main && git push origin main`,
  guarded so the push happens only when the commit touches nothing outside
  `.claude/analysis/`, `.claude/plans/`, `CHANGELOG.md`. Abort the push (and log loudly) on
  any other path.
- Prerequisite for E and F: the merge review needs the plan a PR claims to implement, and
  the release needs a clean, pushed `main`.

**1.3 Candidate selection in code** (`scripts/dispatch-fix.ts candidates`)
- New subcommand prints the ranked, capped JSON list Stage D may act on: parses the
  tracker (`Auto-fixable: yes (<pattern>)`, priority, status), reads each plan's
  `**Pattern**` first token and `### File:` lines, applies the P0/P1 floor (P2 for
  `description-only` / `lint-scope-filter`), skips `missing-batch-tool` and `**Partial**`,
  caps at 4 with ≤2 `boundary-guard`/`assertion`, and drops same-file collisions
  deterministically. `/dispatch-fixes` step 1 becomes "run `candidates`, act on the list".
- Test: `tests/dispatch-candidates.test.ts` on a fixture tracker + plans dir.

**1.4 Nightly triage** (`.claude/commands/triage-tracker.md`, `scripts/tracker.ts untriaged`)
- The script lists active entries that have no `Auto-fixable` line, or a `no (...)` written
  before 2026-09-02 that names only the old three patterns. The command takes up to N (start
  at 6) per night, reads the entry plus the analysis section it cites, and writes either
  `Auto-fixable: yes (<pattern>)` + a plan file + `Status: planned`, or
  `Auto-fixable: no (<reason>)` naming the current allowlist. Same rules as
  `analyze-session` Phase 5–6; factor the shared text into one place both prompts include.
- This is the throughput lever: 36 untriaged active entries today, and every future
  allowlist widening re-opens the question for old entries automatically.

**1.5 Run record** (`scripts/pipeline-record.ts`, `.claude/analysis/pipeline-runs.jsonl`)
- Each stage appends counters (sessions extracted/analyzed, entries created/closed/drift,
  plans written, PRs opened/aborted/deferred, PRs merged/reviewed/skipped with reasons,
  release tag) and duration to one JSON line per run. `bun run pipeline-status` prints the
  last 7 runs as a table. Keep `auto-improve.log` for prose but rotate it (last 30 runs).
- Later: a weekly `/pipeline-retro` that reads the jsonl and the tracker's recurrence notes
  and reports cycle time and "fixed issues that recurred anyway".

**1.6 Later: capture other clients.** Read `~/.figmagent/sessions/*.json` (every tool call,
any client) as a second source in Stage A so Cursor sessions enter the loop.

### WS2 — Overnight review-and-merge (Stage E)

**Files**: `scripts/merge-queue.ts` (mechanics), `.claude/commands/merge-queue.md` (judgement),
`auto-improve.sh` (call it after D), `tests/merge-queue.test.ts` (eligibility is a pure fn).

**Eligibility (script, deterministic, re-checked immediately before merging)**
- Open PR, base `main`, head `auto-fix/*` or `claude/issue-*`, **or** any head carrying the
  `auto-merge` label (opt-in for PRs you author; #200 would need the label).
- Not labeled `hold` / `needs-human`.
- Head SHA's CI check is `success` (poll up to 10 min for in-flight runs); `mergeable`.
- Diff size ≤ 400 changed lines and ≤ 10 files (pipeline PRs are small by construction).
- **Touches no protected path**: `.github/**`, `scripts/auto-improve.sh`,
  `scripts/dispatch-fix.ts`, `scripts/merge-queue.ts`, `scripts/release.ts`,
  `scripts/sync-tracker-issues.ts`, `.claude/commands/**`, `.claude/skills/analyze-session/**`,
  `.claude-plugin/**`, `package.json`, `bun.lock`, `src/figma_plugin/manifest.json`.
  Those PRs are listed as `human-only` in the run record and get a review comment, never a merge.
- Daily cap: 6 merges. Kill switch: `AUTO_IMPROVE_MERGE=0`.

**Review (prompt, one PR at a time, in priority order)**
1. `merge-queue.ts setup <N>` creates a worktree at the PR's merge result (`origin/main` +
   the PR head merged, no commit); the script runs `bun run lint`, `bun run test`,
   `bun run build:plugin` there and reports pass/fail. A failure short-circuits to
   `request_changes` without invoking the model.
2. The agent reads the diff, the linked issue, and (for `auto-fix/*`) the plan, and answers
   a fixed checklist: diff ⊆ plan's `### File:` scope; the named test exists and fails
   without the change; no wire-command rename (`tests/registry.test.ts` already pins this);
   descriptions match the code path they describe; nothing outside the issue's scope; for
   labeled human PRs, a full adversarial `/code-review`-style pass.
3. It writes `{ pr, verdict: "approve" | "request_changes" | "escalate", findings: [...],
   summary }` to a file. Only the script acts on it.

**Act (script)**
- `approve` → re-run eligibility on the current head, `gh pr ready` if draft,
  `gh pr merge --squash --delete-branch` keeping `Closes #N` in the squash message, post the
  review summary as a comment, append to the run record.
- `request_changes` → `gh pr review --request-changes` with the findings, label
  `needs-human`. (v2: let the agent push a fix to `auto-fix/*` heads and re-queue once.)
- `escalate` → comment + label, no merge.
- After each merge, the next PR's mergeability is re-evaluated; if `mergeable` flipped,
  `gh pr update-branch` and wait for CI again. This is what turns the same-file deferral
  from a day into one pass. Optional: re-run Stage D once after E when D reported
  same-file deferrals and E merged something.

### WS3 — Daily release (Stage F)

**Files**: `scripts/release.ts`, `CHANGELOG.md` (seeded from git history since 0.4.0),
`tests/version-lockstep.test.ts`, `auto-improve.sh` (call after E), `README.md` (release
section), `.claude/settings.json` untouched.

**Gate**
- `main` HEAD's CI run is `success`. (Squash merges and analysis pushes are made with your
  token, so CI runs on them.)
- Commits since the last `v*` tag touch something outside `.claude/analysis/**`,
  `.claude/plans/**`, `CHANGELOG.md`. Analysis-only nights produce no release.
- Kill switch: `AUTO_IMPROVE_RELEASE=0`. Manual: `bun run release [--minor|--major|--dry-run]`.

**Cut**
1. Bump `package.json` and `.claude-plugin/plugin.json` in lockstep (patch by default;
   `--minor` by hand when you want to mark a milestone, as 0.4.0 did).
2. Prepend a `## v0.4.1 — 2026-09-04` section to `CHANGELOG.md`: one bullet per merged PR
   since the last tag (`fix(AGENT-033): … (#199, closes #165)`), grouped fix / feat / docs /
   chore from the conventional-commit prefix, plus a "Findings this release" line with the
   tracker IDs.
3. Commit `chore(release): v0.4.1`, tag `v0.4.1`, push `main` and the tag, `gh release create`
   with the CHANGELOG section as notes. Optional: `osascript` notification on the Mac.

**Why the bump is the release.** The marketplace serves the repo's default branch and the
plugin is keyed on `plugin.json` `version`, so the bump is what makes `/plugin update` pick
the new code up. Keep `"source": "./"` in `marketplace.json` for now (it is what the
local-clone dev install relies on). Hardening option for later: have the release commit also
pin the marketplace entry to `{"source":"github","repo":"dabowman/Figmagent","ref":"v0.4.1"}`
so an install between releases gets exactly the tagged cut and a rollback is "point `ref`
at the previous tag and bump patch". The docs support `ref`/`sha` on github sources; do
not also set `version` in the marketplace entry (plugin.json wins silently).

**Morning**: `/plugin marketplace update figmagent` then `/plugin update figmagent`. The docs
describe no auto-update-on-startup setting, so this stays a two-command habit; the GitHub
Release is the signal that there is something to pull.

### WS4 — Guardrails and hygiene

- `tests/version-lockstep.test.ts`: `package.json` version == `plugin.json` version, semver.
- Protected-path list lives in one place (`scripts/protected-paths.ts`) and is used by both
  the merge queue and the analysis-push guard.
- Replace the hardcoded co-author line in `dispatch-fix.ts` with a neutral trailer; derive
  `REPO_DIR` from the script's own location (`$(cd "$(dirname "$0")/.." && pwd)`) so the
  plist is the only machine-specific file.
- Add three INFRA tracker entries so the pipeline tracks its own upgrade through the same
  loop: INFRA-009 merge queue, INFRA-010 daily release, INFRA-011 nightly triage
  (INFRA-007 already covers reverse-sync).
- Update `CLAUDE.md` "Automated Improvement Pipeline", `scripts/launchd/README.md`
  (stages E/F, knobs, safety properties), and `CONTRIBUTING.md` (what `auto-merge` means).

---

## 4. Sequencing

| Phase | Work | Why first | Effort |
|---|---|---|---|
| 0 | WS1.1 reverse-sync · WS1.2 push analysis commits · WS1.3 candidates in code · WS4 co-author/paths | Pure scripts, no new behavior on GitHub beyond truthful status; unblocks E and F | 1 session |
| 1 | WS3 release + CHANGELOG seed + lockstep test; run once by hand → `v0.4.1` | Fixes leak #1 immediately; low risk; you get a daily cut even before auto-merge exists | 1 session |
| 2 | WS2 merge queue, `AUTO_IMPROVE_MERGE=dry-run` for 2 nights (posts reviews, logs would-merge, merges nothing), then enable for `auto-fix/*`, then `auto-merge` label | Highest-consequence change; the dry run is the safety margin | 1–2 sessions |
| 3 | WS1.4 triage · WS1.5 run record + `pipeline-status` · optional second Stage D pass | Throughput and visibility once the pipe is closed end to end | 1 session |
| 4 | Retro after 7 nights: PRs opened/merged/released per night, cycle time, false approvals, anything the review sent to `needs-human`; adjust caps and protected paths | | — |

---

## 5. Decisions taken in this plan (change any of them)

- **Runner**: Stages E/F on the Mac inside `auto-improve.sh`, scripts portable to Actions or
  a Routine later. Cron for a cloud variant: Stage D finishes ~09:06Z, so `0 10 * * *` (merge)
  and `0 11 * * *` (release) would fit your UTC-6 clock.
- **Merge method**: squash, delete branch, `Closes #N` preserved.
- **Human PRs**: reviewed always, merged only with the `auto-merge` label. Flip to
  "merge unless labeled `hold`" by changing one predicate.
- **Version bump**: patch nightly; minor/major by hand.
- **Analysis-only nights**: no release.
- **Marketplace source**: stays `"./"`; tag pinning is a later hardening.

## 6. Open questions (none block Phase 0–1)

- Should the review agent be allowed to push a fix to a pipeline PR it would otherwise send
  back (`request_changes` → fix → re-queue), or is one-shot review enough for v1?
- Do you want a morning notification beyond the GitHub Release (for example a macOS
  notification from the release step)? The two `/plugin` commands are interactive, so the
  pull into the harness itself stays manual.
- Any additional paths that should be human-only?
