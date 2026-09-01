# Benchmark Run — Figmagent vs. official Figma MCP

**Date:** 2026-06-19
**Benchmark:** [`tests/benchmark-test-prompts.md`](../benchmark-test-prompts.md)
**Seed:** WPDS copy file `UXWpHhc1xfPYAiVgWUSYFk` (4 WPDS libraries enabled), per [`tests/seed/`](../seed/).

## Methodology
- **14 prompts** spanning L1→L4 + generative, all selection-free / build-from-scratch + the library task. Excluded: 4.8 (its "create Primitives/Semantic collections" clashes with the seed's existing ones — needs a blank file) and G1 (no reference screenshot supplied). Fixture-mutating prompts (3.2–3.5, 3.9) were out of scope for this run.
- **Sequential with reset** (the file's variables/styles/components are document-level, so two agents can't share it live): Figmagent ran the full set on its own page → outputs captured → file reset to the pristine seed → Figma MCP ran the identical set on its own page. Both got an identical clean start.
- **Same inputs:** both agents were handed the identical design-system token-name list (so binding *skill*, not discovery luck, is compared; discovery is tested separately by prompt 6). Figma MCP was additionally given the two verified WPDS component keys (its natural import path is key-based).
- **Transports:** Figmagent = remote (relay down, OAuth). Figma MCP = official `use_figma`.
- **Scoring:** wall-clock + first-try correctness primary (per the benchmark rubric); tool-call count informational (not comparable across a typed-tool vs. JS-execution architecture). Correctness verified neutrally via screenshots/reads, not agent self-report.

## Headline metrics

| | Figmagent | Figma MCP |
|---|---|---|
| Prompts fully successful | **13 / 14** | **14 / 14** |
| Wall-clock | ~5:05 (305 s) | ~5:00 (300 s) |
| Tool calls (informational) | 38 | 21 |
| Output tokens | 98 k | 83 k |
| Self-verification (screenshot) | ✗ failed on large nodes | ✓ worked |

## Per-prompt outcomes

| # | Prompt | Figmagent | Figma MCP |
|---|---|---|---|
| 1 | Create 320×240 "Card" frame | ✅ | ✅ |
| 2 | Vertical auto-layout "Stack" | ✅ | ✅ |
| 3 | "Avatar" fill/stroke/radius + bind fill | ✅ | ✅ |
| 4 | Text + "Heading/md" style | ✅ | ✅ |
| 5 | "Badge" COMPONENT | ✅ | ✅ |
| 6 | Report design system (read) | ✅ | ✅ |
| 7 | Card COMPONENT (styled) | ✅ | ✅ |
| 8 | "Spacing" collection (2 modes) | ✅ | ✅ |
| 9 | **North-star data table** | ✅ (built as FRAME) | ✅ (built as COMPONENT) |
| 10 | Alert from React code (4 variants) | ✅ | ✅ |
| 11 | Responsive Navbar | ✅ | ✅ |
| 12 | Button full property system (6 variants) | ✅ | ✅ |
| 13 | **Import + compose WPDS Buttons** | ⚠️ partial — import failed, built placeholder | ✅ real WPDS instances composed |
| 14 | Generative mobile login screen | ✅ (not screenshot-verifiable) | ✅ screenshot-verified |

## Findings

**Near-parity on construction.** On all 12 non-library build/styling tasks both produced correct, clean output. Visually verified for both: the north-star DataTable (4 columns, header + 3 rows, bound colors, row borders), the 6-variant Button matrix, and the 4-variant Alert set. Wall-clock was effectively tied (~5 min each).

**Where Figma MCP had the edge:**
1. **Library import (prompt 13)** — decisive. `importComponentByKeyAsync` worked first-try and the WPDS team library was fully accessible; it composed real Secondary+Primary WPDS buttons. Figmagent could not (see bug below).
2. **Self-verification** — its `get_screenshot` worked, so it confirmed its own output. Figmagent's `screenshot` returned malformed/empty results on large nodes, so it built blind.
3. **Tool economy** — 21 vs 38 calls (it funnels work into fewer, larger `use_figma` scripts). Informational, not scored, but real.
4. **Type fidelity on #9** — built the data table as a COMPONENT (the prompt said "component"); Figmagent built a FRAME.

**Where Figmagent had the edge / what to adopt:**
1. **Post-write assertions caught a real bug automatically** — the Alert variants ballooned in height and Figmagent's assertions flagged it for an immediate self-fix. Figma MCP has no equivalent guardrail; it relies on the author sequencing FILL/HUG correctly.
2. **`unbound_value` mini-lint warnings doubled as a token cheat-sheet** during binding — a nice ergonomic the JS-execution model lacks.
3. **Granular typed tools** made intent explicit and validated per-op (vs. hand-written JS that must get sequencing right).

## Action items for Figmagent (remote transport)
1. **`import_library_component(s)` is broken on remote** — fails with `set_selection: selection of a page can only include nodes in that page` (reproduced 3× across batch + single, into both a component and a page). This blocked the only task Figmagent lost. **P1.** → filed as [BUG-018] (#101), new.
2. **`screenshot` export fails on large nodes on remote** — returns a malformed MCP result (`-32602 invalid_union`, `content[0]` missing `data`) / empty; small-to-mid nodes export fine. Prevents visual self-verification of full screens. → **recurrence of the existing [BUG-016] (#96)**; this run's repro was folded into that entry (not a new bug).

## Expansion round — differentiating tools (8 prompts)

A second round targeting the operations where Figmagent has *first-class tools* but the official Figma MCP must hand-roll Plugin-API JS: variant swap, annotations, batch token-binding, lint+autofix, batch annotate, instance-override transfer, text-style audit, component-property defs. Selection-dependent prompts were re-phrased to explicit node references; each agent **cloned the fixture to its own page** so the seed stayed pristine (verified: scopes the Figmagent agent widened were restored before Round 2B for fairness).

| | Figmagent | Figma MCP |
|---|---|---|
| Prompts successful | **8 / 8** | **8 / 8** |
| Wall-clock | **~2:19** | ~4:33 |
| Tool calls *(informational)* | 35 | 20 |
| Output tokens | 82 k | 87 k |
| Approach | first-class typed tools | all hand-written `use_figma` JS |

**Both reachable — the split is ergonomics, speed, and analysis quality:**
- **Figmagent ~2× faster wall-clock** here (2:19 vs 4:33) *despite more calls* — typed calls are quick, whereas the official MCP had to author ~30-line scripts (color-distance matchers, field-by-field override replication, a closest-text-style matcher).
- **Lint quality edge — Figmagent.** Its purpose-built `lint` surfaced **14** issues with full severity classification (6 exact, 1 near, 2 no-match *font sizes*, **5 ambiguous** — padding vs. gap sharing value 12) and auto-fixed all 6 exact. The official MCP's hand-rolled matcher found **6** issues (2 exact, 4 near), bound 2, and **missed both the padding/gap ambiguity and the unmatched font sizes** — its ad-hoc threshold also mislabeled exact fixture colors as "near."
- **Figma MCP fewer calls** (20 vs 35), consistent with its batch-JS model; the official-MCP agent itself concluded *"a dedicated lint/bind/override-transfer tool would have collapsed #3/#4/#6/#7 from ~30 lines each to single calls."*
- **Identical visual outcomes** verified for the headline tasks (override transfer → Button B shows "Save" + swapped icon; ListItem fully bound) in both runs.

**Net of both rounds:** near-parity on raw construction; the official MCP wins on **library import, self-verification, and call economy**; Figmagent wins on **speed and analysis quality for token/lint/override/annotation work**, and its **post-write assertions** auto-catch layout bugs the JS model doesn't guard. The clearest "adopt" idea for Figmagent is the official MCP's reliable `get_screenshot` (see BUG-016) and its first-try library import (BUG-018).

### Benchmark-design nit surfaced
Prompts 2.6 / 3.8 specify annotation categories `development` / `spacing` / `typography`, but Figma annotation categories are **file-specific GUIDs** and only `Development`/`Interaction`/`Accessibility`/`Content` exist in the seed. Both agents worked around it (mapped to the closest valid category). Fix: either define these annotation categories in the seed, or relax the prompts to use the categories Figma ships. Tracked as a follow-up to `tests/seed/`.

## Caveats
- This run covered 14 of ~40 prompts (selection-free + library); selection-dependent and fixture-mutating prompts were out of scope.
- Figmagent ran on the **remote** transport — both bugs above are remote-transport-specific and may not reproduce on the plugin transport (which would also be ~100× faster per command).
- The reset methodology means only the Figma MCP run remains in the file; Figmagent's outputs were captured via screenshot before reset (see conversation). For side-by-side inspection in Figma in future runs, use two separate copies.
