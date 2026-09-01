# Open Issue Triage — Agent Dispatch Readiness

Date: 2026-09-01 · Scope: all 56 open issues on `dabowman/Figmagent` · Tracker: 117 entries, 59 active

Every recommendation below was checked against the code at `e0ab8ad`, not just read off the issue.
Anchors (`file:line`) are verified-present unless marked otherwise.

---

## Headline: the nightly dispatcher currently has zero eligible candidates

`/dispatch-fixes` (Stage D) gates on **`Auto-fixable: yes` + P0/P1 + a plan file + status
identified/planned + preflight clean**, and additionally skips `missing-tool` /
`missing-batch-tool` patterns. Against today's tracker:

| Gate | Result |
|---|---|
| Entries carrying an `Auto-fixable` field at all | **5 of 117** (2 of 59 active) |
| Active + `Auto-fixable: yes` | `TOOL-006`, `BUG-021` |
| `TOOL-006` (P1, plan exists) | **Blocked** — draft PR [#108](https://github.com/dabowman/Figmagent/pull/108) in flight since 2026-06-22, preflight exits 4 |
| `BUG-021` (plan exists) | **Blocked** — P2, fails the P0/P1 gate |

Net: **the nightly stage opens nothing, and will keep opening nothing.** This is precisely the
lockstep failure `.claude/commands/dispatch-fixes.md` warns about — `analyze-session/SKILL.md:287`
still instructs the analyzer to *"always add an explicit `Auto-fixable` line"*, but **all 18 entries
added since 2026-08-19** (`BUG-027`…`BUG-033`, `TOOL-031`…`TOOL-036`, `AGENT-027`…`AGENT-031`) lack it.

Two cheap unblocks, independent of everything else in this document:
1. Backfill `Auto-fixable` on the active entries (Tier 1 below is the answer for ~8 of them).
2. Finish or close stale draft PR [#108](https://github.com/dabowman/Figmagent/pull/108) — it has
   held `TOOL-006` hostage for 10 weeks.

---

## Tier 1 — Dispatch now, unsupervised

Single-site, mechanical, exact fix already stated in the issue, and I confirmed the defect is still
live in the code. Each is a self-contained PR an agent can finish and validate with
`bun run lint && bun run test`.

| # | ID | P | Change | Verified anchor |
|---|---|---|---|---|
| [#128](https://github.com/dabowman/Figmagent/issues/128) | BUG-027 | **P0** | Treat a `raw` with no `rootId` as transport failure → `isError: true`, not an empty document | `tools/document.ts:88` uses `raw.rootId` unguarded. Copy the `hasImageData` pattern already at `tools/export.ts:23`. |
| [#115](https://github.com/dabowman/Figmagent/issues/115) | BUG-022 | P1 | Resolve effective parent as `parentNode \|\| node.parent` | Bare `parentNode` at `create.js:351` and `create.js:388` — both sites confirmed |
| [#144](https://github.com/dabowman/Figmagent/issues/144) | BUG-032 | P1 | Record the caught reason instead of asserting a wrong cause | `apply.js:201` and `:227` throw `"…not found or not cached"` regardless of actual error |
| [#126](https://github.com/dabowman/Figmagent/issues/126) | BUG-026 | P2 | Add `isError: true` to the mode-mismatch return | `tools/script.ts:190-199`. Confirmed the text (`"This script calls … but mode is 'read'"`) does **not** match `ERROR_TEXT_PREFIX` at `instance.ts:85`, so it really does ship as `is_error: false`. Audit the sibling catch at `:216` in the same pass. |
| [#124](https://github.com/dabowman/Figmagent/issues/124) | BUG-024 | P2 | Prefer `typedResult.note`; guard undefined `name`/`id` | `tools/scan.ts:144-150` and `:176-182` format the fields blind |
| [#125](https://github.com/dabowman/Figmagent/issues/125) | BUG-025 | P2 | Wrap in try/catch → `fail()` with the stated message | `create.js:161` `importComponentByKeyAsync` is unwrapped |
| [#106](https://github.com/dabowman/Figmagent/issues/106) | TOOL-022 | P2 | Normalize `^(\d+)-(\d+)$` → `$1:$2` at the tool boundary | No normalizer exists anywhere in `src/figmagent_mcp/`. **116-line plan ready**: `.claude/plans/2026-08-27-TOOL-022.md` |
| [#112](https://github.com/dabowman/Figmagent/issues/112) | BUG-021 | P2 | `.or(z.string().transform(…))` on array criteria; name unknown keys | `find.ts:34` is bare `z.array(z.string())`. **Plan ready**: `.claude/plans/2026-08-19-BUG-021.md`. Ship with [#134](https://github.com/dabowman/Figmagent/issues/134) (same raw-Zod-dump family) |

**Recommended first batch: #128, #115, #144** — the P0/P1s, all three in the "a failure shipped as a
success" family, which is the most damaging class in this tracker.

---

## Tier 2 — One bundled PR (the issues themselves say ship together)

[#111](https://github.com/dabowman/Figmagent/issues/111) `TOOL-025` +
[#117](https://github.com/dabowman/Figmagent/issues/117) `TOOL-027` +
[#139](https://github.com/dabowman/Figmagent/issues/139) `TOOL-035` — all P1, all the same edit to
`nodeOpSchema` in `tools/apply.ts` plus one-line setters in `apply.js`.

I checked all 15 requested fields against `tools/apply.ts`:

- **Absent (14):** `letterSpacing`, `textCase`, `minWidth`, `maxWidth`, `minHeight`, `maxHeight`,
  `lineHeight`, `textDecoration`, `visible`, `layoutPositioning`, `strokeTopWeight`,
  `strokeBottomWeight`, `strokeLeftWeight`, `strokeRightWeight`
- **Already landed (1):** `clipsContent` (`apply.ts:84`, setter `apply.js:554`) — so **TOOL-027 is
  half-done**; only `layoutPositioning` remains. Worth noting on #117.

Caveat worth stating in the PR: several of these names (`minWidth`, `maxWidth`, `lineHeight`,
`letterSpacing`) already exist in `variableFieldEnum` (`apply.ts:32-45`) as *bindable* fields. Adding
them as direct-value fields makes the same name mean two things depending on where it appears — the
exact asymmetry [#134](https://github.com/dabowman/Figmagent/issues/134) (BUG-030) complains about.
Document it in the field descriptions rather than leaving it implicit.

The setter pattern is one line each (`if (op.X !== undefined && "X" in node) node.X = …`, cf.
`apply.js:550-554`), so this is mechanical despite touching 14 fields. Requires
`bun run build:plugin`.

---

## Tier 3 — Dispatch with a spec; larger but fully determined

Each has an unambiguous target and an existing pattern to copy. Give the agent the issue body as spec.

| # | ID | P | Note |
|---|---|---|---|
| [#98](https://github.com/dabowman/Figmagent/issues/98) + [#116](https://github.com/dabowman/Figmagent/issues/116) | TOOL-021 + TOOL-026 | P1/P2 | **106-line plan already covers both**: `.claude/plans/2026-08-27-TOOL-021.md`. Confirmed both still take a single scalar `query` (`libraries.ts:159`, `:609`). Additive — singular keeps working. Note: the repo's own dispatch gate skips `missing-batch-tool`, so this needs manual dispatch. |
| [#119](https://github.com/dabowman/Figmagent/issues/119) | INFRA-005 | P1 | `refresh-manifest.ts:130` — `else if (figmaTools.length > 0)` is the whole bug. Self-contained script, unit-testable, no Figma needed. **Best pure-CI candidate in the list.** |
| [#133](https://github.com/dabowman/Figmagent/issues/133) | TOOL-032 | P1 | `variables` absent from `tools/create.ts` node spec (confirmed). Plugin-side binder + `FIELD_MAP` already exist — schema + wiring only. |
| [#138](https://github.com/dabowman/Figmagent/issues/138) | TOOL-034 | P1 | Mutual exclusion is explicit at `create.ts:194`. The `Promise.all` fan-out already exists on the create path — mirror it for clone. |
| [#118](https://github.com/dabowman/Figmagent/issues/118) | TOOL-028 | P2 | `export.ts:85` pushes `type: "image"` regardless of format; add the SVG→text branch. |
| [#142](https://github.com/dabowman/Figmagent/issues/142) | TOOL-036 | P1 | **Part (1) only.** `lint.js:601-627` returns `totalNodesScanned: 0, totalIssues: 0` on a library-only short-circuit — indistinguishable from a clean pass. Add `skipped: true`. Part (2) (matching library variables) is Tier 5. |
| [#134](https://github.com/dabowman/Figmagent/issues/134) | BUG-030 | P2 | Error-message quality + collapse the 10K Zod dump. Ship with [#112](https://github.com/dabowman/Figmagent/issues/112). |
| [#121](https://github.com/dabowman/Figmagent/issues/121) | BUG-023 | P1 | Append VM parser constraints to `SyntaxError` in `remote/executor.ts`. Text-only, but needs care re: bundle-relative offsets. |
| [#129](https://github.com/dabowman/Figmagent/issues/129) | BUG-028 | P1 | Parts (a) description fix + (b) `fig.localPoint()` stdlib helper are both bounded. Skip part (c) — it's a wire-format change. |

---

## Tier 4 — Fix is known, but an agent cannot verify it

Dispatch only if a human will verify against a live Figma file. CI cannot prove these.

- [#101](https://github.com/dabowman/Figmagent/issues/101) **BUG-018 (P0)** — highest-value item in
  this bucket. Tracker status is *"root-caused — exact fix verified in-session (3/3 A/B pairs)"*;
  the change (set `currentPage` first, or drop the selection step) is small. It blocks **all**
  published-library component import on remote and was the only benchmark task Figmagent lost. The
  code change is dispatchable today; the *verification* needs a real file.
- [#96](https://github.com/dabowman/Figmagent/issues/96) **BUG-016 (P0)** — needs live repro of a
  malformed remote export result.
- [#59](https://github.com/dabowman/Figmagent/issues/59) **BUG-011 (P1)** — performance profiling of
  the instance-override write path; profiling can't happen in CI.
- [#70](https://github.com/dabowman/Figmagent/issues/70) BUG-015, [#64](https://github.com/dabowman/Figmagent/issues/64) BUG-014, [#99](https://github.com/dabowman/Figmagent/issues/99) BUG-017 — all remote-transport semantics. The *error-message* halves of #70 and #64 are Tier 1-shaped if split out.

---

## Tier 5 — Not dispatchable without human design

New capability or open investigation. The repo's own rule routes these through `/add-mcp-tool`.

`missing-tool` / capability design: [#110](https://github.com/dabowman/Figmagent/issues/110) TOOL-024 (P0),
[#123](https://github.com/dabowman/Figmagent/issues/123) TOOL-030, [#137](https://github.com/dabowman/Figmagent/issues/137) TOOL-033,
[#131](https://github.com/dabowman/Figmagent/issues/131) TOOL-031, [#107](https://github.com/dabowman/Figmagent/issues/107) TOOL-023,
[#97](https://github.com/dabowman/Figmagent/issues/97) TOOL-020, [#142](https://github.com/dabowman/Figmagent/issues/142) part 2.

Open investigation: [#132](https://github.com/dabowman/Figmagent/issues/132) BUG-029 (P0 — Figma API
returns 2 then 14 collections for the same file; needs root-causing before any fix),
[#145](https://github.com/dabowman/Figmagent/issues/145) BUG-033, [#136](https://github.com/dabowman/Figmagent/issues/136) BUG-031.

Out of scope for an agent: [#89](https://github.com/dabowman/Figmagent/issues/89) TOOL-005 (harness-level),
[#91](https://github.com/dabowman/Figmagent/issues/91) INFRA-001 (environment),
[#122](https://github.com/dabowman/Figmagent/issues/122) AGENT-025 (explicitly *"no single fix"* — an
aggregate symptom of six other issues; it closes when they do),
[#88](https://github.com/dabowman/Figmagent/issues/88) (multi-week packaging project).

---

## Tier 6 — Prose-only, batchable into one guidance PR

Fourteen `agent-behavior` issues resolve to edits in CLAUDE.md, `figma-guidelines`, or tool
descriptions. No code, no build. An agent can draft them in a single PR in one pass:

[#143](https://github.com/dabowman/Figmagent/issues/143) AGENT-031 ·
[#141](https://github.com/dabowman/Figmagent/issues/141) AGENT-030 ·
[#140](https://github.com/dabowman/Figmagent/issues/140) AGENT-029 ·
[#135](https://github.com/dabowman/Figmagent/issues/135) AGENT-028 ·
[#130](https://github.com/dabowman/Figmagent/issues/130) AGENT-027 ·
[#127](https://github.com/dabowman/Figmagent/issues/127) AGENT-026 ·
[#114](https://github.com/dabowman/Figmagent/issues/114) AGENT-024 ·
[#113](https://github.com/dabowman/Figmagent/issues/113) AGENT-023 ·
[#105](https://github.com/dabowman/Figmagent/issues/105) AGENT-022 ·
[#104](https://github.com/dabowman/Figmagent/issues/104) AGENT-021 ·
[#103](https://github.com/dabowman/Figmagent/issues/103) AGENT-020 ·
[#95](https://github.com/dabowman/Figmagent/issues/95) AGENT-015 ·
[#93](https://github.com/dabowman/Figmagent/issues/93) AGENT-008 ·
[#92](https://github.com/dabowman/Figmagent/issues/92) AGENT-004

**Caveat:** tool descriptions are the load-bearing spec in this project — they are how behavior
reaches every agent. Cheap to write, but a human should review the wording. Two of these
(#113 AGENT-023, #104 AGENT-021) also have an optional tool-side half worth splitting into Tier 3.

---

## Stale — verify and close, don't dispatch

- [#57](https://github.com/dabowman/Figmagent/issues/57) — *"paginate within budget"* is **already
  shipped**: `find.ts:67-73` exposes `page`, `meta.pagination` reports `pageCount`, groups split
  whole, and `:237` handles the beyond-`pageCount` clamp. Only the second half (splitting overflow
  dumps into Read-openable chunks) may remain. Re-scope or close.
- [#90](https://github.com/dabowman/Figmagent/issues/90) TOOL-006 — draft PR
  [#108](https://github.com/dabowman/Figmagent/pull/108) has been open and untouched since
  2026-06-22. Finish it or close it; it is blocking the only auto-fixable P1 in the tracker.

---

## Suggested dispatch order

1. **#128, #115, #144** — three P0/P1 "failure reported as success" bugs, Tier 1, unsupervised.
2. **#119** — pure-CI pipeline fix; also improves the quality of every future analysis.
3. **#111 + #117 + #139** as one bundled `nodeOpSchema` PR.
4. **#126, #124, #125, #106, #112 + #134** — remaining Tier 1, batchable two or three per PR.
5. **#98 + #116** from the existing plan.
6. Backfill `Auto-fixable` + close out PR #108 so the nightly stage stops running dry.
