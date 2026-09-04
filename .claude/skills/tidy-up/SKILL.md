# Skill: Tidy Up

Run lint, test, and build checks, then update any affected documentation. Use `/tidy-up` when you're done with work but weren't using tasks.

## Steps

1. Run the task completion checks once:
   ```bash
   "$CLAUDE_PROJECT_DIR"/.claude/hooks/task-completion-checks.sh
   ```
2. If a check fails, fix exactly what the output names, then run the checks **once more**.
   If they still fail, **stop**: report what fails, paste the relevant output, and end your
   turn with a line beginning `BLOCKED:` — do not keep iterating, and never edit a test or
   a check to make it pass.
3. Once checks pass, update any docs (CLAUDE.md, SKILL.md, prompts, README.md) and project memory files affected by your changes. Skip what's already accurate.
