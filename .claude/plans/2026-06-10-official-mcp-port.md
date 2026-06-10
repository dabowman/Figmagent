# Plan: Port to Figma's Official MCP + Claude Code-Shaped Tool Surface

Date: 2026-06-10
Status: **Plan** — next step is validation, then a development spec.
Companion doc: `.claude/analysis/figma-official-mcp-assessment.md` (assessment of
Figma's official MCP, empirical probe log, Phase 0 spike results).

---

## 1. Goal

Make an agent as efficient and effective inside a Figma file as it is inside the
codebase that file corresponds to. In a codebase, an agent has cheap deterministic
reads, a small set of write primitives that fail loudly, a universal escape hatch
(Bash), and externalized verification (tests, linters, type checkers) it can invoke at
will. Today's Figma work is slower and more error-prone than code work — mostly not
because of transport latency, but because of round-trip granularity, partial-failure
recovery loops, and verification that costs extra reads and visual reasoning.

This plan closes that gap by combining:

- **Figma's official MCP** (`mcp.figma.com`) as the primary transport — headless,
  OAuth-authenticated, atomic per-script execution, no relay/plugin/websocket.
- **Figmagent's deterministic tool surface** as the agent-facing interface — typed,
  validated, gotcha-encoding tools that *compile* to battle-tested Plugin API scripts.
- **A tool architecture that mirrors Claude Code's** — small verb primitives matching
  the agent's trained priors, plus an escape hatch, plus lint as the test suite.

One sentence: **their backend, our interface, Claude Code's shape.**

---

## 2. Decisions

### D1. Dual transport — remote primary, plugin retained as local fallback

The websocket relay + Figma plugin path is **kept, not deleted**. Rationale: Figma may
gate the MCP behind a higher paywall or meter usage; the plugin is the hedge that keeps
Figmagent functional locally regardless of Figma's pricing decisions.

- Transport selected via `FIGMA_TRANSPORT=remote|plugin` (auto-detect: remote when
  OAuth is available, plugin otherwise).
- Both transports implement the same command interface behind `connection.ts` /
  `remote.ts`; tool code above the transport line is transport-agnostic.
- **Shared command modules stay lowest-common-denominator**: no object spread, no
  optional chaining/nullish coalescing (desktop VM rejects them; remote VM accepts
  both — conservative style costs nothing and keeps one codebase). The `prop()` strict-
  property-guard helper (spike §6) is desktop-safe.
- Plugin path stays green in CI for the life of the project, but stops being the
  default once Phase 6 A/B confirms remote parity.

### D2. Tools compile to scripts — the agent never writes Plugin API code by default

Each tool call generates canned, parameterized JS (our existing command modules,
bundled per-domain, 5–16KB minified — verified in the spike) executed via `use_figma`.
Every gotcha currently encoded in the plugin (font load→await→mutate, append-then-FILL,
two-pass sizing, scope validation, mixed-symbol sanitization) ships in the compiled
script. Atomicity comes free: an uncaught error rolls back the whole script, so a
failed 40-node `create` leaves the file untouched and retry is one call, not a
forensic cleanup session.

### D3. Claude Code-shaped core surface

Mirror the *semantics and call shapes* of Claude Code's primitives — not just names —
to tap the agent's trained behavioral loops (grep → read → edit → verify; read before
write; lint after batches). Core tier:

| New name | Today | Claude Code analog | Notes |
|---|---|---|---|
| `read` | `get` | Read | FSGN output, detail levels = offset/limit-style escalation; short IDs are our line numbers |
| `grep` | `find` | Grep | `pattern` params, regex semantics, grouped results |
| `edit` | `apply` | Edit | Mutates existing nodes only; adopts Edit's loud-failure semantics (see D5) |
| `write` | `create` | Write | Creates new nodes/trees only |
| `run_script` | — (new) | Bash | Escape hatch; see D4 |
| `lint` | `lint_design` | tests/linter | The externalized verifier; unchanged in role, grows in importance |
| `screenshot` | `export_node_as_image` | — | Final visual check, not per-step verifier |

**Do not force everything into the metaphor.** Claude Code itself keeps domain tools
where the file metaphor breaks (NotebookEdit). Our domain tier: variable/style CRUD
(`create_variables`, `update_variables`, `create_styles`, `update_styles`,
`prepare_figma_variables`), component ops (`component_properties`,
`combine_as_variants`, instance/library tools), comments. Nodes aren't text; the
design system is a parallel "project"; component semantics don't map to file ops.

Deferred (consciously, see §7): the maximal version where FSGN becomes a literal text
substrate and `edit` is string replacement compiled to mutations. Attractive v3;
blocked today by FSGN's deliberate lossiness and tree-diff identity hazards.

### D4. `run_script` ships with the stdlib injected from day one

The escape hatch covers the long tail (reparenting, exotic ops, anything we haven't
shipped a tool for) — but model-written scripts get our helper bundle preloaded, not
the raw Plugin API: font-safe text setters, two-pass FILL sizing, `prop()` compat,
FSGN serializer, scope-validated variable binding. The agent writes 10 lines against
high-level helpers instead of 60 gotcha-laden lines. Figma's harness supplies rollback
and fix-stating error messages underneath.

Guardrails against Bash-style overuse:
- Tool description frames it as last resort ("use only when no tool covers the
  operation").
- Every script is session-logged; **recurring scripts are the tool roadmap** — each
  one is a missing first-class tool or stdlib function.
- Post-run structural assertions (D5) apply to script output too.

### D5. Validation moves into the write response (Edit semantics)

Figma's doctrine — write, then call `get_metadata`, then screenshot and eyeball — costs
two round trips plus vision tokens per step. We return the verdict in the write
response, computed in the same script execution:

- **Loud failures at the boundary** (Edit's `old_string` principle): reject/warn when a
  property can't apply — FILL on a non-auto-layout parent, text props on a FRAME,
  unknown variable scope — instead of silently absorbing.
- **Structural assertions post-write, same script**: zero-width text, 100px-balloon
  frames, FILL requested but not applied, font fallbacks, overlaps in non-auto-layout
  parents. Emitted as `warnings` with node IDs and suggested fixes.
- **Inline mini-lint**: when a write sets a raw value with an exact-match scoped
  variable available, say so (`fill #F5F5FA matches color/bg/subtle (v1)`). Full
  `lint` remains the sweep tool.
- **Optional `screenshot: true`** on writes, riding `await node.screenshot()` — one
  flag replaces an export round trip.

### D6. Head/tail split decided empirically

~50 tools is context and decision tax. Target core ≤15 (D3 core + domain tier). The
tail (annotations, connector tools, legacy `scan_*` / `get_node_info` / `read_my_design`,
single-purpose modify ops) demotes to stdlib functions callable from `run_script`,
documented in one short skill. The split is decided from **session-log call
frequencies** (we already have the data and `analyze-session`), not taste — and the
feedback loop runs in reverse forever: frequent escape-hatch scripts get promoted,
unused tools get demoted.

### D7. Knowledge relocation — correctness into code, workflow into skills

Figma's mistake isn't skills; it's putting *correctness* knowledge (font loading,
sizing order) in 5,000 lines of mandatory reading where it taxes every session and
fails probabilistically. Their canned-script templates are the good part of their
skills story (deterministic cores invoked flexibly) — that's what our compiled tools
already are.

- Audit every entry in CLAUDE.md's "Figma Design Patterns" section: move it into tool
  behavior, an error message that states the fix, or the validation layer — prose is
  the last resort. **CLAUDE.md should shrink as this lands.**
- Error-message audit: every error names its fix, with the offending value and node ID
  (their voice: "Cannot use unloaded font X. Call Y and await it first."). Source the
  top failure modes from the improvement tracker.
- Workflow knowledge (build order for design systems, variant conventions) stays in
  skills — that's its legitimate home.

### D8. What we explicitly do NOT adopt from Figma's approach

- The skills corpus as correctness layer (4,700 lines of mandatory reading).
- React+Tailwind as the canonical read (`get_design_context`) — FSGN with defs dedup
  and budgets is strictly better for design operations.
- Self-validation doctrine ("screenshot and look carefully") as the per-step verifier.
- `get_variable_defs`'s lossy shape (resolved values without IDs/scopes/modes).

What we DO adopt: atomic script execution, harness-extended API (their `node.set()`
ordering fixes → our stdlib), fix-stating error messages, inline screenshots,
selector-style targeting (P2, with mandatory quoting to kill their silent-empty-match
footgun), and possibly proxying `search_design_system` for published-library text
search (a real gap in our library story).

---

## 3. Target architecture

```
Agent (Claude Code / Cursor)
  │ stdio (MCP)
  ▼
Figmagent MCP server
  ├── Core primitives: read · grep · edit · write · run_script · lint · screenshot
  ├── Domain tier: variables/styles CRUD · component ops · comments · library
  ├── Validation layer: boundary checks · post-write assertions · mini-lint ·
  │     error rewriter (fix-stating messages)
  ├── Session logging (unchanged) → analyze-session → head/tail + roadmap decisions
  └── Transport interface (command in → result out)
        ├── remote.ts  (PRIMARY)
        │     per-domain bundle cache → script assembly (bundle + handler call +
        │     JSON params) → MCP client → mcp.figma.com `use_figma` → result
        │     passthrough to existing formatters
        └── connection.ts + relay + plugin  (FALLBACK — paywall/pricing hedge)
```

Shared layer: `src/figma_plugin/src/commands/*` remains the single implementation of
command logic, running in either VM (verified in spike). FSGN/YAML/budget formatting
stays in TypeScript on the server, where it's testable.

---

## 4. Phases

**Phase 0 — spike. DONE** (assessment doc §6). Verdict: transport swap + bounded
compat layer. Command modules run in `use_figma` largely unmodified; two
incompatibilities, both with verified fixes (`JSON_REST_V1` export → live-property
serialization or retirement; strict property guard → `prop()` helper at serializer
boundaries).

**Phase 1 — remote transport, reads.**
`remote.ts` (bundle cache, script assembly, MCP client + OAuth), `prop()` compat
codemod on serializers, `read`/`grep`/`get_design_system`/`screenshot` on remote.
`scope: "DOCUMENT"` grep fans out one call per page server-side (their page-context
constraint), merged invisibly. Client-side rate-limit queue replacing the 6-way
plugin concurrency cap, sized to measured limits.
*Acceptance: all read tools pass against a scratch file on remote; plugin transport
still green; latency + rate limits measured and recorded.*

**Phase 2 — remote writes.**
`write`/`edit`, text tools, variable/style CRUD, component ops — atomic by default.
Retire or reimplement the three `JSON_REST_V1` legacy reads.
*Acceptance: full existing test suite passes on both transports; a representative
component-set build (8 variants, bindings) completes on remote with fewer calls than
the plugin-transport baseline.*

**Phase 3 — surface reshape.**
Head/tail split from session-log frequencies; renames (`get`→`read`, `find`→`grep`,
`apply`→`edit`, `create`→`write`); parameter-shape alignment (e.g. `pattern` params);
domain tier consolidation; tail tools demoted to stdlib.
*Acceptance: core tool count ≤15; old names gone; CLAUDE.md + skills updated in the
same pass.*

**Phase 4 — validation layer + escape hatch.**
D5 boundary checks and post-write assertions; inline mini-lint; `run_script` with
injected stdlib (remote-only initially); error-message audit (top failure modes from
the improvement tracker rewritten as fix-stating strings).
*Acceptance: the assertions catch the known failure classes (width-collapse,
100px balloon, FILL-not-applied) in tests; every audited error names its fix;
`run_script` usage is session-logged with script text.*

**Phase 5 — knowledge migration.**
CLAUDE.md "Figma Design Patterns" audit per D7; per-workflow skills updated;
tool descriptions carry the moved knowledge.
*Acceptance: CLAUDE.md measurably shorter; no pattern entry that merely restates
what a tool/error now enforces.*

**Phase 6 — measure and switch.**
A/B remote vs plugin via session logs on real tasks. Make remote the default;
plugin stays as maintained fallback per D1.
*Acceptance: metrics (§6) hit targets; `FIGMA_TRANSPORT` defaults to remote.*

Sequencing notes: Phases 1–2 are mechanical (spike de-risked them) and come first so
everything after runs on the real backend. Phase 3 before Phase 4 so validation
messages are written once, against final names. Phases can overlap where independent
(error audit can start any time).

---

## 5. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Figma gates/meters the MCP (the motivating fear) | D1: plugin transport stays alive and CI-green permanently; transport interface keeps swap cost near zero |
| Rate limits unknown; our 6-way parallel patterns may throttle | Measure in Phase 1 (server publishes `rate-limits-access.md`); client-side queue; chunk sizes tunable |
| OAuth lifecycle for long headless sessions | Validate token lifetime/refresh in Phase 1; document setup; fall back to plugin on auth failure |
| 50KB script limit | Per-domain bundles are 5–16KB (verified); chunk large trees at existing UI-freeze seams |
| Strict property guard regressions on remote | `prop()` helper applied mechanically at serializer boundaries; tests run on both VMs |
| `use_figma` is new and may churn | Plugin fallback stays green; compiled scripts are centrally generated, so API changes patch in one place |
| Escape-hatch overuse erodes guardrails (no-default-fills, lint cleanliness) | D4 guardrails: description framing, logging + review loop, post-run assertions |
| Dual-transport maintenance cost | Shared command modules are the bulk; transport-specific code is thin (assembly vs websocket); cost is bounded and the hedge justifies it |
| Renames break muscle memory / existing docs | One atomic pass in Phase 3 (no external users — cheapest moment it will ever be) |

---

## 6. Success metrics

Baseline from existing session logs (`analyze-session` + improvement tracker), then
A/B in Phase 6 on comparable tasks. Provisional targets:

- **Tool calls per task**: −30% (composite scripts + no recovery loops + validation
  in response replacing read-after-write).
- **Error-recovery sequences per task**: −50% (atomicity + loud boundary failures).
- **Wall-clock per task**: meaningful reduction (fewer calls × inference time between
  calls is the dominant term).
- **Context overhead**: smaller tool-schema footprint (≤15 core tools) and shorter
  CLAUDE.md.
- **Escape-hatch share**: `run_script` <10% of write calls once steady-state; every
  recurring script triaged into the roadmap.
- **Infra incidents**: the INFRA-001 class (relay down, plugin not running, channel
  drops) goes to zero on remote transport.

---

## 7. Out of scope / deferred

- **FSGN as literal text substrate** (read returns FSGN, edit is string replacement,
  server diffs and compiles mutations). v3 candidate for bounded cases (text content,
  scalar props). Blocked by FSGN lossiness and tree-diff identity hazards. Keeping
  FSGN as the read format keeps the door open.
- **Code Connect integration** — different product surface; revisit after Phase 6.
- **`search_design_system` proxy** — P2 nice-to-have in the domain tier; fills the
  published-library text-search gap.
- **Selector targeting in `grep`/`edit`** (their `query` grammar, with mandatory
  quoting) — P2, after the core surface settles.

## 8. Open questions for the validation step

1. Rate limits and concurrency ceilings (read `rate-limits-access.md`; measure
   parallel fan-out).
2. OAuth token lifetime and refresh path for headless sessions.
3. Remote per-call latency vs plugin transport (informs chunk sizing and whether any
   hot read paths should stay local when the plugin happens to be running).
4. `exportAsync` parity on remote for all `screenshot` formats/scales (PNG verified).
5. Comments tools: keep on REST with `FIGMA_API_TOKEN`, or check official MCP
   coverage.
6. Confirm no tool-name confusion when a user runs Figmagent and Figma's official MCP
   in the same session (namespacing should handle it; verify agent behavior).
