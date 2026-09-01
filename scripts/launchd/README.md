# Auto-improve pipeline

Turns every Figmagent session into captured GitHub findings — and draft fix PRs —
with no manual steps.

```
A. extract-sessions --all-projects   every Figmagent session, every repo  → .claude/sessions-json/
B. /analyze-session  (looped)         efficiency/error audit               → .claude/analysis/ + improvement-tracker.md + .claude/plans/
C. sync-tracker-issues                tracker → GitHub issues (deduped)    → github.com/dabowman/Figmagent/issues
D. /dispatch-fixes                    safe auto-fixable issues             → DRAFT PRs
```

Orchestrated by [`scripts/auto-improve.sh`](../auto-improve.sh), triggered nightly by launchd.

## Run it by hand

```bash
bun run auto-improve          # full pipeline (A→D)
# or individual stages:
bun run extract-sessions --all-projects --compact --no-thinking --include-agents
bun run refresh-manifest
bun run sync-issues --dry-run   # preview GitHub changes without writing
```

## Install the nightly job (launchd)

```bash
cp scripts/launchd/com.figmagent.auto-improve.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.figmagent.auto-improve.plist
```

Run it once right now to confirm it works end-to-end:

```bash
launchctl kickstart -k gui/$(id -u)/com.figmagent.auto-improve
tail -f .claude/analysis/auto-improve.log
```

Stop / remove:

```bash
launchctl bootout gui/$(id -u)/com.figmagent.auto-improve
rm ~/Library/LaunchAgents/com.figmagent.auto-improve.plist
```

## Knobs (env vars, settable in the plist's `EnvironmentVariables`)

| Var | Default | Effect |
|---|---|---|
| `AUTO_IMPROVE_DISPATCH` | `1` | `0` disables Stage D (draft PRs); pipeline stops after GitHub issues. |
| `AUTO_IMPROVE_MAX_ANALYZE` | `25` | Cap on sessions analyzed per run. |
| `AUTO_IMPROVE_COMMIT` | `1` | `0` leaves analysis artifacts uncommitted instead of committing to `main` locally. |
| `AUTO_IMPROVE_REPO` | `dabowman/Figmagent` | Target repo for `sync-tracker-issues`. |

## Safety properties

- **Nothing is pushed to `main`** and **no ready-for-review PR is opened** — only draft PRs for code.
- Stage C is keyed on stable issue numbers / `[ID]` title prefixes, so it **never duplicates** issues.
  Tracker entries that reference an `/issues/N` URL are reconciled against that exact issue.
- Stage C **never auto-reopens** a closed issue; tracker-vs-GitHub disagreements are reported as
  `DRIFT` for you to resolve (run `bun run sync-issues --reopen` if you want them reopened).
- Stage D is gated: draft-only, max 2/run, requires an existing fix plan, runs lint+test+build in an
  isolated git worktree, and aborts (no PR) on any failure.

## Notes

- Claude Code rotates old session transcripts out of `~/.claude/projects/`, so the nightly cadence
  must be shorter than that retention window to catch every session — already-analyzed sessions are
  preserved in `.claude/sessions-json/` and the manifest regardless.
- The job runs locally (not a cloud routine) because Stages A–B need your local `~/.claude/projects/`
  transcripts and `~/.figmagent/` logs, which cloud agents can't see.
- Paths in `auto-improve.sh` and the plist are absolute and machine-specific (this Mac). Update them
  if the repo moves or you run on another machine.
