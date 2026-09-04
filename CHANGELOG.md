# Changelog

Releases are cut nightly by the auto-improve pipeline (Stage F, `scripts/release.ts`): a patch bump by default, minor or major by hand with `bun run release --minor|--major`, and only when something outside `.claude/analysis/`, `.claude/plans/` and this file has changed since the last tag — analysis-only nights do not release. The bump is the release: Claude Code pins an installed plugin to its `plugin.json` version and `/plugin update` keeps the cached copy until that number changes (plan `2026-09-03-auto-improve-v2`, section 1.3), so anything merged after the newest version below is invisible to `/plugin update` until the next cut. `Unreleased` lists exactly that and is replaced by the next release section.

## Unreleased

### Fixes

- Archer cohort tier-1 — lint noise, get_reactions, stdlib guards, fontWeight binding (#194)

### Features

- widen the auto-fix allowlist and backfill seven plans (#198)

### Other

- Ship the repo as its own Claude Code plugin marketplace

Findings this release: [INFRA-006]

## v0.4.0 — 2026-09-02

### Fixes

- normalize URL-form node IDs at the tool boundary (#153, closes #106)
- stop rejecting natural shapes with a raw Zod dump (#154, closes #112, #134)
- make three responses say what actually happened (#152, closes #124, #125, #126)
- flag an empty transport result instead of rendering an empty document (#146, closes #128)
- set the instance's page before selecting it on import (#149, closes #101)
- require a Figmagent call that did something to classify a session (#150, closes #119)
- report why a text/effect style failed to load (#148, closes #144)
- apply parent-dependent sizing to the root of a write({parentId}) tree (#147, closes #115)
- accept numeric strings for numeric tool params (#108, closes #90)

### Features

- add 14 direct-value fields to edit's nodeOpSchema (#151, closes #111, #117, #139)
- batch queries for library component and variable lookup (#155, closes #98, #116)

Findings this release: [BUG-018], [BUG-021], [BUG-022], [BUG-024], [BUG-025], [BUG-026], [BUG-027], [BUG-030], [BUG-032], [INFRA-005], [TOOL-006], [TOOL-021], [TOOL-022], [TOOL-025], [TOOL-026], [TOOL-027], [TOOL-035]
