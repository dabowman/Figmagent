---
description: Open draft PRs for safe, auto-fixable Figmagent improvement issues that already have a fix plan
allowed-tools: Bash, Read, Edit, Write, Glob, Grep
---

# Dispatch Fix PRs (Stage D of auto-improve)

Open **draft** pull requests for a small, safe batch of auto-fixable issues from
the improvement tracker. This runs unattended. **Be conservative: skipping an
issue is always better than opening a bad PR.**

## Hard constraints (do not violate)

The **mechanical, irreversible git/gh steps are enforced by `scripts/dispatch-fix.ts`**,
not by this prose — that script is the source of truth for *draft-only*, *base `main`*,
*never push to `main`*, *always clean up the worktree*, and *which repo* (always
`AUTO_IMPROVE_REPO`, default `dabowman/Figmagent` — never hardcode it here). Your job
is the **judgement**: pick the right issue and decide whether the plan applies cleanly.

- **Draft PRs only / max 2 issues per run.** (`dispatch-fix.ts publish` always passes `--draft`.)
- Act on an issue only if **all** of these hold:
  1. The tracker entry has `Auto-fixable: yes`, and
  2. Priority is **P0 or P1**, and
  3. A plan file exists at `.claude/plans/*<ISSUE-ID>*.md`, and
  4. Status is `identified` or `planned` (never implemented/verified/resolved), and
  5. `dispatch-fix.ts preflight` succeeds (an **open** issue exists; no branch/PR in flight).
- The plan must be a `type-coercion` or `sync-to-async` pattern (small, mechanical).
  **Skip `missing-batch-tool` / `missing-tool` plans** — new tools need human design
  via the `/add-mcp-tool` skill; comment on the issue saying so and move on.
- If lint/test/build fail after applying the plan, run `dispatch-fix.ts abort` and open **no** PR.

> **Lockstep with the analyzer.** Constraints 1 and 4 depend on the `analyze-session`
> skill reliably emitting `- **Auto-fixable**: yes/no` (Phase 5) and setting `Status: planned`
> after it writes a plan (Phase 6). The plan file (constraint 3) is the load-bearing artifact.
> If the skill stops emitting those fields this stage goes inert — keep the two docs aligned.

## Steps

1. **Pick candidates.** Read `.claude/analysis/improvement-tracker.md`. Collect entries
   meeting constraints 1–4 above. For each, `ls .claude/plans/` to confirm a plan file
   exists. Cap the list at 2 (lowest issue numbers / highest priority first).

2. **Preflight each candidate** (open issue + nothing in flight):
   ```bash
   bun scripts/dispatch-fix.ts preflight <ID>
   ```
   Exit `0` prints `{"issueNumber": N}` — capture N. Exit `3` (no open issue) or `4`
   (branch/PR already in flight): **skip this candidate** and move on.

3. **Set up an isolated worktree off `origin/main`:**
   ```bash
   WT=$(bun scripts/dispatch-fix.ts setup <ID>)
   ```
   `$WT` is `.claude/worktrees/auto-fix-<ID>`. Do all file edits with absolute paths under it.

4. **Apply the plan exactly.** Open `.claude/plans/*<ID>*.md` and make precisely the
   file/line changes it specifies. Do not improvise beyond the plan's scope.

5. **Verify (run inside `$WT`).** `cd "$WT"` and run:
   - `bun run lint`
   - `bun run test`
   - `bun run build:plugin` (only if plugin source under `src/figma_plugin/` changed)
   If any fail and the fix isn't a trivial, in-scope correction, **abort this issue** and
   continue to the next candidate:
   ```bash
   bun scripts/dispatch-fix.ts abort <ID> --issue <N> --reason "lint/test failed after applying plan"
   ```

6. **Commit, push, open the draft PR, clean up, and comment — one command:**
   ```bash
   bun scripts/dispatch-fix.ts publish <ID> --issue <N> \
     --title "<short title>" \
     --summary "<one-paragraph summary of the change>"
   ```
   This commits everything in the worktree, pushes `auto-fix/<ID>`, opens a **draft** PR
   based on `main`, removes the worktree, and comments the PR link on issue N. It prints
   the PR URL.

## End of turn

State the work is complete with a one-line result per candidate (PR opened #N /
skipped: reason / aborted: reason). No PRs left in non-draft state; no leftover worktrees.
