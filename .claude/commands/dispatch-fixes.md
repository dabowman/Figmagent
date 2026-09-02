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

- **Draft PRs only / max 4 issues per run, of which at most 2 may be `boundary-guard` or `assertion` plans.** (`dispatch-fix.ts publish` always passes `--draft`.)
- Act on an issue only if **all** of these hold:
  1. The tracker entry has `Auto-fixable: yes (<pattern>)` — the plan's `**Pattern**` line is the
     authoritative one if the two disagree; the tracker parenthetical only orders step 1's sort, and
  2. Priority is **P0 or P1** — or **P2** when the pattern is `description-only` or `lint-scope-filter`, and
  3. A plan file exists at `.claude/plans/*<ISSUE-ID>*.md`, and
  4. Status is `identified` or `planned` (never implemented/verified/resolved), and
  5. `dispatch-fix.ts preflight` succeeds (an **open** issue exists; no branch/PR in flight).
- The plan's `**Pattern**` must be one of `sync-to-async`, `type-coercion`,
  `description-only`, `lint-scope-filter`, `boundary-guard`, `assertion` (defined in the
  `analyze-session` skill, Phase 6). Read the **first token** in the field, stripping backticks
  and ignoring any trailing qualifier — `` `type-coercion` (string normalization at the Zod
  boundary)`` is a `type-coercion` plan. Same rule for the tracker's `Auto-fixable: yes (…)`
  parenthetical. **Skip `missing-batch-tool` plans** — new tools need human design via the
  `/add-mcp-tool` skill; comment on the issue saying so and move on. Skip any plan whose pattern
  line is missing or whose first token is not on this list. (`missing-tool` is a tracker
  **Category**, not a pattern — never gate on the `Category` field.)
- **Skip any plan carrying a `**Partial**: yes` line.** `dispatch-fix.ts publish` writes
  `Closes #N` into both the commit and the PR body unconditionally, so a plan that covers only
  part of its issue closes work that is still open. Comment on the issue and move on.
- If lint/test/build fail after applying the plan, run `dispatch-fix.ts abort` and open **no** PR.

> **Lockstep with the analyzer.** Constraints 1 and 4 depend on the `analyze-session`
> skill reliably emitting `- **Auto-fixable**: yes (<pattern>)` / `no (<reason>)` (Phase 5) and setting `Status: planned`
> after it writes a plan (Phase 6). The plan file (constraint 3) is the load-bearing artifact.
> If the skill stops emitting those fields this stage goes inert — keep the two docs aligned.

## Steps

1. **Pick candidates.** Read `.claude/analysis/improvement-tracker.md`. Collect entries
   meeting constraints 1–4 above. `ls .claude/plans/` **once** and match every candidate
   against that one listing. Open each candidate's plan now (not at step 4) and drop any whose
   `**Pattern**` is off the allowlist — a worktree you created for a plan you then discard is
   wasted. Cap the list at 4, with at most 2 `boundary-guard`/`assertion` plans (highest
   priority first, then lowest issue number).
   **Never take two candidates whose plans name the same file** under `### File:` — every
   worktree is cut from `origin/main` and cannot see the other's edits, so two plans that touch
   one file produce conflicting draft PRs that each claim `Closes #N`. Keep the higher-priority
   one and leave the other for the next run.

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
   `bun run lint` and `bun run test` run for **every** pattern — `bun run lint` is
   `biome lint src tests scripts`, so it reads none of a markdown-only plan's files, and the
   suite asserts on tool descriptions and `fail()` fix strings (`tests/error-messages.test.ts`,
   `tests/criteria-and-binding-errors.test.ts`), which is exactly what a `description-only`
   plan edits. What `description-only` is exempt from is the *named-test* requirement below.
   Every other pattern's plan names a test under `## Verification`; after applying the plan
   that test must exist in the worktree and pass. **If the plan names no test, abort** — an
   unverified guard or assertion is not a safe PR.
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
