// Pins the pure half of the release step (scripts/release-lib.ts): version
// bumps, how merged PRs turn into CHANGELOG bullets, the analysis-only gate,
// and how a new section lands in an existing CHANGELOG. scripts/release.ts is
// the only place git/gh run, so none of this executes a release.
//
// Fixture subjects are real ones from this repo's history since 0.4.0, so the
// classifier is tested on the shapes it will actually see: GitHub merge commits
// carrying the PR title in the body, squash subjects with a `(#N)` suffix,
// slash-joined tracker scopes like `fix(BUG-021/030)`, and the analysis commits
// that must never show up.

import { describe, expect, test } from "bun:test";
import {
  bumpVersion,
  classifyCommit,
  classifyCommits,
  compareSemver,
  emptyGroups,
  expandScopeIds,
  formatChangeLine,
  isAnalysisOnlyPath,
  isReleaseCommit,
  latestVersionTag,
  parseSemver,
  prependChangelog,
  releaseWorthy,
  renderChangelogSection,
  replaceVersionField,
  sectionHeading,
  sortIds,
  versionOf,
} from "../scripts/release-lib.ts";

describe("bumpVersion", () => {
  test("patch, minor and major", () => {
    expect(bumpVersion("0.4.0", "patch")).toBe("0.4.1");
    expect(bumpVersion("0.4.9", "patch")).toBe("0.4.10");
    expect(bumpVersion("0.4.7", "minor")).toBe("0.5.0");
    expect(bumpVersion("0.4.7", "major")).toBe("1.0.0");
  });

  test("rejects anything that is not MAJOR.MINOR.PATCH, with the fix stated", () => {
    expect(() => bumpVersion("v0.4.0", "patch")).toThrow(/no "v" prefix/);
    expect(() => bumpVersion("0.4", "patch")).toThrow(/MAJOR\.MINOR\.PATCH/);
    expect(() => bumpVersion("0.4.0-beta.1", "patch")).toThrow(/Not a semver version/);
    expect(() => bumpVersion("", "patch")).toThrow();
  });

  test("rejects an unknown bump kind", () => {
    expect(() => bumpVersion("0.4.0", "huge" as never)).toThrow(/patch, minor or major/);
  });
});

describe("semver helpers", () => {
  test("parseSemver", () => {
    expect(parseSemver("1.2.3")).toEqual([1, 2, 3]);
    expect(parseSemver(" 0.4.0 ")).toEqual([0, 4, 0]);
    expect(parseSemver("1.2")).toBeNull();
    expect(parseSemver("v1.2.3")).toBeNull();
  });

  test("compareSemver orders numerically, not lexically", () => {
    expect(compareSemver("0.10.0", "0.9.9")).toBeGreaterThan(0);
    expect(compareSemver("0.4.1", "0.4.1")).toBe(0);
    expect(compareSemver("1.0.0", "0.99.99")).toBeGreaterThan(0);
  });

  test("latestVersionTag picks the highest v* tag by version order and ignores the rest", () => {
    expect(latestVersionTag(["v0.4.1", "v0.10.0", "v0.9.9", "release-candidate", "v1.0", "0.11.0"])).toBe("v0.10.0");
    expect(latestVersionTag(["v0.4.1\n"])).toBe("v0.4.1");
    expect(latestVersionTag([])).toBeNull();
    expect(latestVersionTag(["nightly", "v1.2"])).toBeNull();
  });

  test("versionOf reads the version field", () => {
    expect(versionOf('{ "name": "figmagent", "version": "0.4.0" }')).toBe("0.4.0");
    expect(() => versionOf('{ "name": "figmagent" }')).toThrow(/"version"/);
  });
});

describe("replaceVersionField: bump in place, never re-serialize", () => {
  test("only the version string changes; indentation, key order and trailing newline survive", () => {
    const before = '{\n  "name": "figmagent",\n  "version": "0.4.0",\n  "type": "module"\n}\n';
    const after = replaceVersionField(before, "0.4.0", "0.4.1");
    expect(after).toBe('{\n  "name": "figmagent",\n  "version": "0.4.1",\n  "type": "module"\n}\n');
  });

  test("a dependency pinned to the same version is not touched — the field must occur exactly once", () => {
    const text = '{ "version": "0.4.0", "dependencies": { "x": { "version": "0.4.0" } } }';
    expect(() => replaceVersionField(text, "0.4.0", "0.4.1")).toThrow(/found 2/);
  });

  test("refuses when the current version is not there", () => {
    expect(() => replaceVersionField('{ "version": "0.3.9" }', "0.4.0", "0.4.1")).toThrow(/found 0/);
  });

  test("the dot in the version is literal, not a regex wildcard", () => {
    expect(() => replaceVersionField('{ "version": "0x4x0" }', "0.4.0", "0.4.1")).toThrow(/found 0/);
  });
});

describe("expandScopeIds: slash-joined tracker scopes", () => {
  test("one ID, several numbers, several full IDs, non-ID scopes", () => {
    expect(expandScopeIds("AGENT-033")).toEqual(["AGENT-033"]);
    expect(expandScopeIds("BUG-021/030")).toEqual(["BUG-021", "BUG-030"]);
    expect(expandScopeIds("TOOL-025/027/035")).toEqual(["TOOL-025", "TOOL-027", "TOOL-035"]);
    expect(expandScopeIds("BUG-024/INFRA-007")).toEqual(["BUG-024", "INFRA-007"]);
    expect(expandScopeIds("dispatch")).toEqual([]);
    expect(expandScopeIds("sync")).toEqual([]);
  });

  test("a bare number with no category before it is not an ID", () => {
    expect(expandScopeIds("030/BUG-021")).toEqual(["BUG-021"]);
  });
});

describe("classifyCommit on real subjects", () => {
  test("a squash-merged pipeline fix: type, PR, closes, tracker ID, prefix stripped", () => {
    const change = classifyCommit({
      sha: "abc1234",
      subject: "fix(AGENT-033): name the sub-agent tools the skill can actually call (#199)",
      body: "Closes #165\n\nAuto-generated draft by the auto-improve pipeline.",
    });
    expect(change).toEqual({
      sha: "abc1234",
      type: "fix",
      subject: "name the sub-agent tools the skill can actually call",
      prs: [199],
      closes: [165],
      ids: ["AGENT-033"],
    });
  });

  test("a GitHub merge commit takes its title from the body and its PR number from the subject", () => {
    const change = classifyCommit({
      sha: "14b33c4",
      subject: "Merge pull request #194 from dabowman/fix/archer-tier1",
      body: "fix: Archer cohort tier-1 — lint noise, get_reactions, stdlib guards, fontWeight binding",
    });
    expect(change?.type).toBe("fix");
    expect(change?.subject).toBe("Archer cohort tier-1 — lint noise, get_reactions, stdlib guards, fontWeight binding");
    expect(change?.prs).toEqual([194]);
    expect(change?.ids).toEqual([]);
  });

  test("a merge commit whose PR title carries a scope yields the tracker ID", () => {
    const change = classifyCommit({
      sha: "f4d812c",
      subject: "Merge pull request #198 from dabowman/infra/006-allowlist",
      body: "feat(INFRA-006): widen the auto-fix allowlist and backfill seven plans",
    });
    expect(change?.type).toBe("feat");
    expect(change?.subject).toBe("widen the auto-fix allowlist and backfill seven plans");
    expect(change?.prs).toEqual([198]);
    expect(change?.ids).toEqual(["INFRA-006"]);
  });

  test("a merge commit with no body keeps its own subject and still records the PR", () => {
    const change = classifyCommit({ sha: "x", subject: "Merge pull request #7 from someone/branch" });
    expect(change?.type).toBe("other");
    expect(change?.subject).toBe("Merge pull request #7 from someone/branch");
    expect(change?.prs).toEqual([7]);
  });

  test("slash-joined scopes expand to every ID they name", () => {
    expect(classifyCommit({ sha: "a", subject: "feat(TOOL-025/027/035): add 14 direct-value fields" })?.ids).toEqual([
      "TOOL-025",
      "TOOL-027",
      "TOOL-035",
    ]);
    expect(classifyCommit({ sha: "b", subject: "fix(BUG-021/030): stop rejecting natural shapes" })?.ids).toEqual([
      "BUG-021",
      "BUG-030",
    ]);
  });

  test("a scope that is not a tracker ID is stripped but yields no ID", () => {
    const change = classifyCommit({
      sha: "b07329a",
      subject: "fix(dispatch): close the gaps that would have broken tonight's auto-fix run",
    });
    expect(change?.type).toBe("fix");
    expect(change?.subject).toBe("close the gaps that would have broken tonight's auto-fix run");
    expect(change?.ids).toEqual([]);
  });

  test("bracketed IDs and Closes refs are read from the body, including the merged branch's messages", () => {
    const change = classifyCommit({
      sha: "m",
      subject: "Merge pull request #201 from dabowman/auto-fix/BUG-047",
      body: [
        "fix(BUG-047): serialize channel joins",
        "",
        "fix(BUG-047): serialize channel joins",
        "Closes #171",
        "See also [INFRA-008] for the relay side.",
        "review(BUG-047/048): tighten the join test",
      ].join("\n"),
    });
    expect(change?.ids).toEqual(["BUG-047", "BUG-048", "INFRA-008"]);
    expect(change?.closes).toEqual([171]);
    expect(change?.prs).toEqual([201]);
  });

  test("GitHub's closing keywords all count, case-insensitively, and never the PR's own number", () => {
    const change = classifyCommit({
      sha: "k",
      subject: "fix: three things (#50)",
      body: "Fixes #12\nresolves #13\nClosed #14\nfixed #15\nrefs #16\nCloses #50",
    });
    expect(change?.closes).toEqual([12, 13, 14, 15]);
  });

  test("the conventional types map to their groups; a breaking marker is stripped too", () => {
    const type = (subject: string) => classifyCommit({ sha: "s", subject })?.type;
    expect(type("docs: record design decisions for the open Archer cohort issues")).toBe("docs");
    expect(type("chore: biome format drift on main")).toBe("chore");
    expect(type("ci: cache bun installs")).toBe("chore");
    expect(type("build: pin bun")).toBe("chore");
    expect(type("refactor: split apply.js")).toBe("refactor");
    expect(type("perf: memoize the def table")).toBe("refactor");
    expect(type("test(BUG-027): prove an empty FRAME survives the guard end to end")).toBe("test");
    expect(classifyCommit({ sha: "s", subject: "feat!: drop the legacy find command" })).toMatchObject({
      type: "feat",
      subject: "drop the legacy find command",
    });
  });

  test("unrecognised prefixes and plain subjects land in other, untouched", () => {
    const ship = classifyCommit({ sha: "947e28b", subject: "Ship the repo as its own Claude Code plugin marketplace" });
    expect(ship).toMatchObject({ type: "other", subject: "Ship the repo as its own Claude Code plugin marketplace" });
    const plan = classifyCommit({
      sha: "p",
      subject: "plan: review the pipeline prompts and context for persistence traps",
    });
    expect(plan?.type).toBe("other");
    expect(plan?.subject).toBe("plan: review the pipeline prompts and context for persistence traps");
    const review = classifyCommit({
      sha: "r",
      subject: "review(BUG-021/030): stop the widened schema from failing silently",
    });
    expect(review?.type).toBe("other");
    expect(review?.ids).toEqual(["BUG-021", "BUG-030"]);
  });

  test("the release's own commit is never an entry", () => {
    expect(isReleaseCommit("chore(release): v0.4.1")).toBe(true);
    expect(isReleaseCommit("chore: bump version to 0.4.0")).toBe(true);
    expect(isReleaseCommit("chore: 0.4.2")).toBe(true);
    expect(isReleaseCommit("chore: biome format drift on main")).toBe(false);
    expect(isReleaseCommit("fix(release): tag before pushing")).toBe(false);
    expect(
      classifyCommit({
        sha: "3996553",
        subject: "Merge pull request #156 from dabowman/claude/x",
        body: "chore: bump version to 0.4.0",
      }),
    ).toBeNull();
    expect(classifyCommit({ sha: "z", subject: "chore(release): v0.4.1" })).toBeNull();
  });
});

describe("classifyCommits groups and preserves order", () => {
  test("the post-0.4.0 history, as the CLI would hand it over", () => {
    const groups = classifyCommits([
      { sha: "947e28b", subject: "Ship the repo as its own Claude Code plugin marketplace" },
      {
        sha: "14b33c4",
        subject: "Merge pull request #194 from dabowman/fix/archer-tier1",
        body: "fix: Archer cohort tier-1 — lint noise, get_reactions, stdlib guards, fontWeight binding",
      },
      {
        sha: "f4d812c",
        subject: "Merge pull request #198 from dabowman/infra/006-allowlist",
        body: "feat(INFRA-006): widen the auto-fix allowlist and backfill seven plans",
      },
      {
        sha: "3996553",
        subject: "Merge pull request #156 from dabowman/claude/x",
        body: "chore: bump version to 0.4.0",
      },
    ]);
    expect(groups.fix.map((c) => c.prs)).toEqual([[194]]);
    expect(groups.feat.map((c) => c.prs)).toEqual([[198]]);
    expect(groups.other.map((c) => c.sha)).toEqual(["947e28b"]);
    expect(groups.chore).toEqual([]);
    expect(groups.docs).toEqual([]);
  });

  test("an empty history yields empty groups of every type", () => {
    expect(classifyCommits([])).toEqual(emptyGroups());
  });
});

describe("sortIds", () => {
  test("by category then number, deduplicated", () => {
    expect(sortIds(["TOOL-006", "BUG-036", "AGENT-033", "BUG-021", "BUG-036"])).toEqual([
      "AGENT-033",
      "BUG-021",
      "BUG-036",
      "TOOL-006",
    ]);
  });
});

describe("renderChangelogSection", () => {
  const groups = emptyGroups();
  groups.fix.push(
    { sha: "a", type: "fix", subject: "name the sub-agent tools", prs: [199], closes: [165], ids: ["AGENT-033"] },
    {
      sha: "b",
      type: "fix",
      subject: "two issues at once",
      prs: [201],
      closes: [170, 171],
      ids: ["BUG-036", "BUG-021"],
    },
  );
  groups.feat.push({ sha: "c", type: "feat", subject: "batch the thing", prs: [], closes: [], ids: [] });
  groups.other.push({
    sha: "d",
    type: "other",
    subject: "Ship the repo as its own marketplace",
    prs: [],
    closes: [],
    ids: [],
  });

  test("heading, only the non-empty groups in order, bullets with refs, and the findings line", () => {
    expect(renderChangelogSection("0.4.1", "2026-09-04", groups)).toBe(
      [
        "## v0.4.1 — 2026-09-04",
        "",
        "### Fixes",
        "",
        "- name the sub-agent tools (#199, closes #165)",
        "- two issues at once (#201, closes #170, #171)",
        "",
        "### Features",
        "",
        "- batch the thing",
        "",
        "### Other",
        "",
        "- Ship the repo as its own marketplace",
        "",
        "Findings this release: [AGENT-033], [BUG-021], [BUG-036]",
        "",
      ].join("\n"),
    );
  });

  test("no findings line when no tracker ID was seen", () => {
    const g = emptyGroups();
    g.docs.push({ sha: "x", type: "docs", subject: "explain releases", prs: [202], closes: [], ids: [] });
    expect(renderChangelogSection("0.4.2", "2026-09-05", g)).toBe(
      "## v0.4.2 — 2026-09-05\n\n### Docs\n\n- explain releases (#202)\n",
    );
  });

  test("an empty release says so instead of rendering a bare heading", () => {
    expect(renderChangelogSection("0.4.2", "2026-09-05", emptyGroups())).toBe(
      "## v0.4.2 — 2026-09-05\n\n_No changes listed._\n",
    );
  });

  test("a non-version label renders verbatim, so the same renderer seeds an Unreleased section", () => {
    expect(sectionHeading("Unreleased", "2026-09-04")).toBe("## Unreleased");
    expect(sectionHeading("0.4.1", "2026-09-04")).toBe("## v0.4.1 — 2026-09-04");
    expect(renderChangelogSection("Unreleased", "", emptyGroups()).startsWith("## Unreleased\n\n")).toBe(true);
  });

  test("formatChangeLine with every ref combination", () => {
    const base = { sha: "s", type: "fix" as const, subject: "s", ids: [] };
    expect(formatChangeLine({ ...base, prs: [], closes: [] })).toBe("- s");
    expect(formatChangeLine({ ...base, prs: [9], closes: [] })).toBe("- s (#9)");
    expect(formatChangeLine({ ...base, prs: [], closes: [3] })).toBe("- s (closes #3)");
    expect(formatChangeLine({ ...base, prs: [9, 10], closes: [3, 4] })).toBe("- s (#9, #10, closes #3, #4)");
  });
});

describe("releaseWorthy: analysis-only nights do not release", () => {
  test("nothing changed", () => {
    expect(releaseWorthy([])).toBe(false);
  });

  test("only analysis, plans and the changelog", () => {
    expect(
      releaseWorthy([
        ".claude/analysis/improvement-tracker.md",
        ".claude/analysis/figma-mcp-session63-analysis.md",
        ".claude/plans/2026-09-04-BUG-050.md",
        "CHANGELOG.md",
        "./CHANGELOG.md",
      ]),
    ).toBe(false);
  });

  test("one real path among them is enough", () => {
    expect(releaseWorthy([".claude/analysis/improvement-tracker.md", "src/figmagent_mcp/tools/apply.ts"])).toBe(true);
    expect(releaseWorthy(["README.md"])).toBe(true);
  });

  test("the rest of .claude/ is released code, not analysis", () => {
    expect(isAnalysisOnlyPath(".claude/commands/dispatch-fixes.md")).toBe(false);
    expect(isAnalysisOnlyPath(".claude/skills/analyze-session/SKILL.md")).toBe(false);
    expect(isAnalysisOnlyPath(".claude-plugin/plugin.json")).toBe(false);
    expect(isAnalysisOnlyPath("docs/CHANGELOG.md")).toBe(false);
    expect(isAnalysisOnlyPath(".claude/analysis/sessions.json")).toBe(true);
    expect(isAnalysisOnlyPath(".claude/plans/x.md")).toBe(true);
  });
});

describe("prependChangelog", () => {
  const section = "## v0.4.1 — 2026-09-04\n\n### Fixes\n\n- a fix (#199)\n";

  test("an absent or empty changelog becomes a fresh one", () => {
    expect(prependChangelog("", section)).toBe(
      "# Changelog\n\n## v0.4.1 — 2026-09-04\n\n### Fixes\n\n- a fix (#199)\n",
    );
    expect(prependChangelog("\n\n", section)).toBe(prependChangelog("", section));
  });

  test("the new section goes above the previous release and below the preamble", () => {
    const existing = "# Changelog\n\nIntro paragraph.\n\n## v0.4.0 — 2026-09-02\n\n### Fixes\n\n- old (#108)\n";
    expect(prependChangelog(existing, section)).toBe(
      "# Changelog\n\nIntro paragraph.\n\n## v0.4.1 — 2026-09-04\n\n### Fixes\n\n- a fix (#199)\n\n## v0.4.0 — 2026-09-02\n\n### Fixes\n\n- old (#108)\n",
    );
  });

  test("an Unreleased section is replaced — it is what the new section releases", () => {
    const existing = [
      "# Changelog",
      "",
      "Intro.",
      "",
      "## Unreleased",
      "",
      "### Fixes",
      "",
      "- pending (#194)",
      "",
      "## v0.4.0 — 2026-09-02",
      "",
      "- old (#108)",
      "",
    ].join("\n");
    const out = prependChangelog(existing, section);
    expect(out).toBe(
      "# Changelog\n\nIntro.\n\n## v0.4.1 — 2026-09-04\n\n### Fixes\n\n- a fix (#199)\n\n## v0.4.0 — 2026-09-02\n\n- old (#108)\n",
    );
    expect(out).not.toContain("Unreleased");
    expect(out).not.toContain("#194");
  });

  test("a changelog with a preamble but no sections yet gets the section appended", () => {
    expect(prependChangelog("# Changelog\n\nIntro.\n", section)).toBe(
      "# Changelog\n\nIntro.\n\n## v0.4.1 — 2026-09-04\n\n### Fixes\n\n- a fix (#199)\n",
    );
  });

  test("CRLF input is normalised and the result ends with exactly one newline", () => {
    const out = prependChangelog("# Changelog\r\n\r\n## v0.4.0 — 2026-09-02\r\n\r\n- old\r\n", section);
    expect(out).not.toContain("\r");
    expect(out.endsWith("- old\n")).toBe(true);
    expect(out.endsWith("- old\n\n")).toBe(false);
  });

  test("prepending twice keeps newest first", () => {
    const once = prependChangelog("# Changelog\n", "## v0.4.1 — 2026-09-04\n\n- one\n");
    const twice = prependChangelog(once, "## v0.4.2 — 2026-09-05\n\n- two\n");
    expect(twice).toBe("# Changelog\n\n## v0.4.2 — 2026-09-05\n\n- two\n\n## v0.4.1 — 2026-09-04\n\n- one\n");
  });
});
