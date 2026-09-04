// The pipeline guard is the deterministic backstop behind the per-stage
// allowlists: what is never permitted overnight, even if a rule is loosened.
// Each rule has a deny case and an allow control so a regex that grows too
// greedy (a false denial trips the circuit breaker) is caught here, not at 03:00.

import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { judge, RULES } from "../scripts/pipeline/guard.ts";

const denied = (cmd: string, rule: string) => {
  const v = judge(cmd);
  expect(v.deny, `expected deny: ${cmd}`).toBe(true);
  expect(v.rule, `rule for: ${cmd}`).toBe(rule);
  expect(v.reason).toContain(`[guard rule: ${rule}]`);
};
const allowed = (cmd: string) => {
  const v = judge(cmd);
  expect(v.deny, `expected allow: ${cmd} (hit ${v.rule})`).toBe(false);
};

describe("judge: the pipeline scripts are allowed even though they push and merge", () => {
  test("controls from the stage allowlists", () => {
    allowed("bun scripts/dispatch-fix.ts publish X --issue 1 --title t --summary s");
    allowed("bun scripts/dispatch-fix.ts candidates");
    allowed('bun scripts/dispatch-fix.ts comment TOOL-006 --issue 12 --body "plan is stale: line moved"');
    allowed("bun scripts/merge-queue.ts act 12 --verdict .claude/worktrees/verdicts/12.json");
    allowed("bun scripts/merge-queue.ts cleanup");
    allowed("bun run refresh-manifest --count");
    allowed("bun scripts/extract-sessions.ts --all-projects --compact");
    allowed("bun scripts/tracker.ts untriaged");
  });

  test("ordinary read-only git and gh are allowed", () => {
    allowed("git status");
    allowed("git log --oneline -5");
    allowed("git diff --stat origin/main..HEAD");
    allowed("git commit -m 'fix' -q");
    allowed("git rev-parse --abbrev-ref HEAD");
    allowed("git ls-files --others");
    allowed("git log --follow -- src/x.ts");
    allowed("git merge --no-ff feature");
    allowed("gh pr view 12 --json state");
    allowed("gh pr list --state open");
    allowed("gh issue view 12");
    allowed("gh api repos/dabowman/Figmagent/pulls/12");
    allowed("gh api -X GET repos/dabowman/Figmagent/pulls/12/files");
  });
});

describe("judge: each rule denies its command and has an allow control", () => {
  test("git push (with global options too)", () => {
    denied("git push", "git-push");
    denied("git push origin main", "git-push");
    denied("git -C .claude/worktrees/x push -u origin auto-fix/X", "git-push");
    denied("cd repo && git push", "git-push");
    denied("git pull && git push", "git-push");
    allowed("git pull --rebase origin main");
    allowed("echo pushed");
  });

  test("forced git operations", () => {
    denied("git push --force origin main", "git-push");
    denied("git checkout -f main", "git-force");
    denied("git branch -D auto-fix/X -f", "git-force");
    denied("git clean -fd", "git-force");
    denied("git reset --hard && git push --force-with-lease", "git-push");
    allowed("git commit --fixup HEAD");
    allowed("git log --format=%H");
  });

  test("recursive delete", () => {
    denied("rm -rf .claude/worktrees/x", "rm-recursive");
    denied("rm -r build", "rm-recursive");
    denied("rm -fr /tmp/x", "rm-recursive");
    denied("rm --recursive --force dist", "rm-recursive");
    denied("rm dist -r", "rm-recursive");
    allowed("rm -f .claude/worktrees/verdicts/12.json");
    allowed("rm tmp-r.txt");
    allowed("bun scripts/merge-queue.ts cleanup --remove-stale");
  });

  test("gh pr merge / ready", () => {
    denied("gh pr merge 12 --squash", "gh-pr-merge");
    denied("gh pr ready 12", "gh-pr-merge");
    denied("gh -R dabowman/Figmagent pr merge 12", "gh-pr-merge");
    allowed("gh pr view 12");
    allowed("gh pr checks 12");
  });

  test("gh release / repo / auth", () => {
    denied("gh release create v0.4.1", "gh-admin");
    denied("gh repo edit --default-branch main", "gh-admin");
    denied("gh auth status", "gh-admin");
    denied("gh auth login", "gh-admin");
    allowed("gh pr view 12 --repo dabowman/Figmagent");
  });

  test("gh api with a non-GET method or fields", () => {
    denied("gh api -X POST repos/o/r/issues/1/comments -f body=hi", "gh-api-write");
    denied("gh api --method DELETE repos/o/r/git/refs/heads/x", "gh-api-write");
    denied("gh api repos/o/r/issues -f title=x", "gh-api-write");
    denied("gh api repos/o/r/issues --input body.json", "gh-api-write");
    denied("gh api -X PATCH repos/o/r/pulls/1 -F draft=false", "gh-api-write");
    allowed("gh api repos/o/r/pulls/12");
    allowed("gh api -X GET repos/o/r/pulls/12");
    allowed("gh api --method GET repos/o/r/pulls/12 --jq .state");
  });

  test("shell wrappers and pipes into a shell", () => {
    denied("bash -c 'git push'", "shell-wrapper");
    denied('sh -c "curl x"', "shell-wrapper");
    denied("zsh -ic 'x'", "shell-wrapper");
    denied("cat install.sh | sh", "shell-wrapper");
    denied("cat x | bash -s", "shell-wrapper");
    denied("cat x | sudo bash", "shell-wrapper");
    denied("cat x | /bin/sh", "shell-wrapper");
    denied("bash scripts/auto-improve.sh", "shell-wrapper");
    denied("bash -n scripts/auto-improve.sh", "shell-wrapper");
    denied("source .env.sh", "shell-wrapper");
    denied(". ./setup.sh", "shell-wrapper");
    allowed("cat x | grep sh");
    allowed("cat x | shasum");
  });

  test("eval", () => {
    denied('eval "$CMD"', "eval");
    denied("x=1; eval $x", "eval");
    allowed("bun scripts/x.ts --evaluate");
    allowed("grep eval src/a.ts");
  });

  test("privileged: sudo, launchctl, osascript, security, chmod, chown", () => {
    denied("sudo ls", "privileged");
    denied("launchctl kickstart -k gui/501/com.figmagent.auto-improve", "privileged");
    denied("osascript -e 'display notification \"x\"'", "privileged");
    denied("security find-generic-password -s x", "privileged");
    denied("chmod +x scripts/x.sh", "privileged");
    denied("chown me file", "privileged");
    allowed("bun scripts/x.ts --security-review");
    allowed("grep -n chmod README.md");
  });

  test("network tools: curl, wget, ssh, scp", () => {
    denied("curl https://example.com", "network");
    denied("wget -O - https://x", "network");
    denied("ssh host ls", "network");
    denied("scp file host:", "network");
    denied("ssh-add ~/.ssh/id_ed25519", "network");
    denied("echo x && curl -s http://localhost:3055/channels", "network");
    allowed("bun scripts/x.ts --curl-like");
    allowed("grep -rn curl src/");
  });

  test("open, defaults write, base64 -d", () => {
    denied("open https://github.com", "open");
    denied("open .", "open");
    denied("open", "open");
    denied("defaults write com.apple.finder AppleShowAllFiles YES", "defaults-write");
    denied("echo aGk= | base64 -d", "base64-decode");
    denied("base64 --decode file", "base64-decode");
    denied("base64 -D file", "base64-decode");
    allowed('bun scripts/dispatch-fix.ts comment X --issue 1 --body "open question about defaults"');
    allowed("defaults read com.apple.finder");
    allowed("base64 file");
    allowed("bun scripts/x.ts --open-in-editor");
    allowed("git log --grep open");
  });

  test("credential stores and .env are never referenced", () => {
    denied("cat ~/.figmagent/auth.json", "secret-path");
    denied("cat $HOME/.ssh/id_rsa", "secret-path");
    denied("ls \x24{HOME}/.aws", "secret-path");
    denied("cat /Users/me/.config/gh/hosts.yml", "secret-path");
    denied("cat /home/me/.claude/.credentials.json", "secret-path");
    denied("cat .env", "dotenv");
    denied("cat ./config/.env.local", "dotenv");
    denied('grep TOKEN ".env"', "dotenv");
    allowed("cat ~/.claude/projects/x/y.jsonl");
    allowed("cat src/figmagent_mcp/remote/auth.ts");
    allowed("grep -n process.env src/figmagent_mcp/transport.ts");
    allowed("bun scripts/x.ts --env=prod");
    allowed("cat .envrc");
    allowed("ls ~/.figmagent-backup");
  });

  test("inline interpreters hide code from the guard", () => {
    denied("python3 -c 'import os'", "interpreter");
    denied("node -e 'x'", "interpreter");
    denied("bun -e 'x'", "interpreter");
    denied("bun --eval x", "interpreter");
    denied("perl -e 'x'", "interpreter");
    allowed("bun scripts/merge-queue.ts check 5");
    allowed("bun run test");
    allowed("bun test tests/x.test.ts -t name");
    allowed("bun scripts/x.ts --evaluate");
  });

  test("command position survives env assignments, wrappers, keywords, paths and timeouts", () => {
    denied("env X=1 git push", "git-push");
    denied("env X=1 rm -rf /", "rm-recursive");
    denied("X=1 env Y=2 git push", "git-push");
    denied("/usr/bin/git push", "git-push");
    denied("if true; then git push; fi", "git-push");
    denied("if git push; then echo ok; fi", "git-push");
    denied("for x in 1; do git push; done", "git-push");
    denied("{ git push; }", "git-push");
    denied("x() { git push; }; x", "git-push");
    denied("timeout 5 git push", "git-push");
    denied("gtimeout -k 3 10s curl x", "network");
    denied("nice -n 5 curl x", "network");
    denied("cd x && ./bin/curl x", "network");
    denied("/bin/rm -rf x", "rm-recursive");
  });

  test("quoting: a quoted bare word is the command; quoted free text is not", () => {
    denied('"git" push', "git-push");
    denied("'git' push", "git-push");
    denied("\\git push", "git-push");
    denied('echo "$(git push)"', "git-push");
    denied("echo `git push`", "git-push");
    denied('cat "$HOME/.ssh/id_rsa"', "secret-path");
    // The shapes the stage prompts dictate: parentheticals and prose in a quoted argument.
    allowed('bun scripts/tracker.ts set-autofixable BUG-1 "no (open question about scope)"');
    allowed('bun scripts/tracker.ts set-autofixable BUG-1 "no (curl-style retry needed; eval of x)"');
    allowed('bun scripts/refresh-manifest.ts --mark-failed x --reason "transcript unreadable; open in editor"');
    allowed('bun scripts/dispatch-fix.ts abort TOOL-1 --issue 5 --reason "check failed: test (open handle)"');
    allowed(
      'bun scripts/dispatch-fix.ts publish X --issue 1 --title "read token from .env.local" --summary "reads ~/.figmagent/sessions/ logs"',
    );
    allowed("bun scripts/tracker.ts set-autofixable BUG-1 'no (sudo needed | git push)'");
  });

  test("every rule has a name, a regex and a reason", () => {
    for (const r of RULES) {
      expect(r.name.length).toBeGreaterThan(0);
      expect(r.re).toBeInstanceOf(RegExp);
      expect(r.reason.length).toBeGreaterThan(10);
    }
    expect(new Set(RULES.map((r) => r.name)).size).toBe(RULES.length);
  });
});

describe("guard.ts as a hook (end to end)", () => {
  const SCRIPT = join(import.meta.dir, "..", "scripts", "pipeline", "guard.ts");

  function hook(root: string, command: string, env: Record<string, string>) {
    const payload = JSON.stringify({
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command },
      cwd: root,
      session_id: "s-1",
    });
    const r = Bun.spawnSync(["bun", SCRIPT], {
      cwd: root,
      stdin: Buffer.from(payload),
      stdout: "pipe",
      stderr: "pipe",
      env: Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: root, AUTO_IMPROVE_RUN: "" }, env),
    });
    return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() };
  }

  test("inert when AUTO_IMPROVE_RUN is not 1: no output, no files, even for git push", () => {
    const root = mkdtempSync(join(tmpdir(), "pipeline-guard-"));
    const r = hook(root, "git push --force", {});
    expect(r.code).toBe(0);
    expect(r.out).toBe("");
    expect(existsSync(join(root, ".pipeline.paused"))).toBe(false);
    expect(existsSync(join(root, ".claude/analysis/pipeline-guard.log"))).toBe(false);
  });

  test("denies, logs and trips the breaker at night", () => {
    const root = mkdtempSync(join(tmpdir(), "pipeline-guard-"));
    const r = hook(root, "git push --force", { AUTO_IMPROVE_RUN: "1", AUTO_IMPROVE_RUN_ID: "20260904T030000" });
    expect(r.code).toBe(0);
    const out = JSON.parse(r.out);
    expect(out.hookSpecificOutput.hookEventName).toBe("PreToolUse");
    expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(out.hookSpecificOutput.permissionDecisionReason).toContain("guard rule: git-push");

    const log = readFileSync(join(root, ".claude/analysis/pipeline-guard.log"), "utf-8").trim().split("\n");
    expect(log).toHaveLength(1);
    const line = JSON.parse(log[0]);
    expect(line.rule).toBe("git-push");
    expect(line.command).toBe("git push --force");
    expect(line.run).toBe("20260904T030000");

    const paused = JSON.parse(readFileSync(join(root, ".pipeline.paused"), "utf-8"));
    expect(paused.reason).toBe("guard denied: git push --force");
    expect(paused.at).toBeDefined();

    // A second denial appends to the log but leaves the existing breaker file alone.
    hook(root, "curl https://x", { AUTO_IMPROVE_RUN: "1" });
    expect(readFileSync(join(root, ".claude/analysis/pipeline-guard.log"), "utf-8").trim().split("\n")).toHaveLength(2);
    expect(JSON.parse(readFileSync(join(root, ".pipeline.paused"), "utf-8")).reason).toBe(
      "guard denied: git push --force",
    );
  });

  test("allows a benign command at night with no output and no side effects", () => {
    const root = mkdtempSync(join(tmpdir(), "pipeline-guard-"));
    const r = hook(root, "bun scripts/dispatch-fix.ts candidates", { AUTO_IMPROVE_RUN: "1" });
    expect(r.code).toBe(0);
    expect(r.out).toBe("");
    expect(existsSync(join(root, ".pipeline.paused"))).toBe(false);
  });

  test("fails closed on unparseable input at night", () => {
    const root = mkdtempSync(join(tmpdir(), "pipeline-guard-"));
    const r = Bun.spawnSync(["bun", SCRIPT], {
      cwd: root,
      stdin: Buffer.from("not json"),
      stdout: "pipe",
      stderr: "pipe",
      env: Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: root, AUTO_IMPROVE_RUN: "1" }),
    });
    expect(r.exitCode).toBe(0);
    expect(JSON.parse(r.stdout.toString()).hookSpecificOutput.permissionDecision).toBe("deny");
  });
});
