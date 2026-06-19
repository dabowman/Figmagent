---
description: Open draft PRs for safe, auto-fixable Figmagent improvement issues that already have a fix plan
allowed-tools: Bash, Read, Edit, Write, Glob, Grep
---

# Dispatch Fix PRs (Stage D of auto-improve)

Open **draft** pull requests for a small, safe batch of auto-fixable issues from
the improvement tracker. This runs unattended. **Be conservative: skipping an
issue is always better than opening a bad PR.**

## Hard constraints (do not violate)

- **Draft PRs only.** Never open a ready-for-review PR. Never merge. Never push to `main`.
- **Max 2 issues per run.**
- Act on an issue only if **all** of these hold:
  1. The tracker entry has `Auto-fixable: yes`, and
  2. Priority is **P0 or P1**, and
  3. A plan file exists at `.claude/plans/*<ISSUE-ID>*.md`, and
  4. Status is `identified` or `planned` (never implemented/verified/resolved), and
  5. An **open** GitHub issue exists for it, and
  6. No branch `auto-fix/<ISSUE-ID>` and no open PR already reference it.
- The plan must be a `type-coercion` or `sync-to-async` pattern (small, mechanical).
  **Skip `missing-batch-tool` / `missing-tool` plans** — new tools need human design
  via the `/add-mcp-tool` skill; comment on the issue saying so and move on.
- If lint/test/build fail after applying the plan, **abort that issue**: remove the
  worktree, comment on the issue that auto-fix failed and needs manual work, open **no** PR.

> **Lockstep with the analyzer.** Constraints 1 and 4 depend on the `analyze-session`
> skill reliably emitting `- **Auto-fixable**: yes/no` (Phase 5) and setting `Status: planned`
> after it writes a plan (Phase 6). The plan file (constraint 3) is the load-bearing artifact.
> If the skill stops emitting those fields this stage goes inert — keep the two docs aligned.

## Steps

1. **Pick candidates.** Read `.claude/analysis/improvement-tracker.md`. Collect entries
   meeting constraints 1–4 above. For each, `ls .claude/plans/` to confirm a plan file
   exists. Cap the list at 2 (lowest issue numbers / highest priority first).

2. **Confirm the GitHub issue is open and unclaimed.** For each candidate ID:
   - `gh issue list --repo dabowman/Figmagent --state open --search "[<ID>]" --json number,title`
     — if no open issue, skip (Stage C will file it next run; act next time).
   - `git ls-remote --exit-code --heads origin auto-fix/<ID>` and
     `gh pr list --repo dabowman/Figmagent --head auto-fix/<ID> --json number` — if either
     exists, skip (already in flight).

3. **Isolate in a worktree** (keeps the main checkout untouched):
   ```bash
   git fetch -q origin
   git worktree add -b auto-fix/<ID> .claude/worktrees/auto-fix-<ID> origin/main
   ```
   Do all file edits with absolute paths under `.claude/worktrees/auto-fix-<ID>/`.

4. **Apply the plan exactly.** Open `.claude/plans/*<ID>*.md` and make precisely the
   file/line changes it specifies. Do not improvise beyond the plan's scope.

5. **Verify (run inside the worktree dir).** `cd` there and run:
   - `bun run lint`
   - `bun run test`
   - `bun run build:plugin` (only if plugin source under `src/figma_plugin/` changed)
   If any fail and the fix isn't a trivial, in-scope correction, **abort this issue**
   (see constraints): `git worktree remove --force .claude/worktrees/auto-fix-<ID>`,
   `git branch -D auto-fix/<ID>`, comment on the issue, continue to the next candidate.

6. **Commit, push, open the draft PR.**
   ```bash
   git -C .claude/worktrees/auto-fix-<ID> add -A
   git -C .claude/worktrees/auto-fix-<ID> commit -m "fix(<ID>): <short title>

   Closes #<issue-number>

   Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
   git -C .claude/worktrees/auto-fix-<ID> push -u origin auto-fix/<ID>
   gh pr create --draft --repo dabowman/Figmagent --base main --head auto-fix/<ID> \
     --title "fix(<ID>): <short title>" \
     --body "<one-paragraph summary of the change>

   Closes #<issue-number>

   Auto-generated **draft** by the auto-improve pipeline (Stage D) from \`.claude/plans/…\`.
   Review before marking ready / merging.

   🤖 Generated with [Claude Code](https://claude.com/claude-code)"
   ```

7. **Clean up the worktree** (the branch lives on origin now):
   `git worktree remove --force .claude/worktrees/auto-fix-<ID>`.

8. **Comment on the issue** linking the draft PR.

## End of turn

State the work is complete with a one-line result per candidate (PR opened #N /
skipped: reason / aborted: reason). No PRs left in non-draft state; no leftover worktrees.
