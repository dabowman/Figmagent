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
1. **`import_library_component(s)` is broken on remote** — fails with `set_selection: selection of a page can only include nodes in that page` (reproduced 3× across batch + single, into both a component and a page). This blocked the only task Figmagent lost. **P1.**
2. **`screenshot` export fails on large nodes on remote** — returns a malformed MCP result (Zod union error) / empty; small-to-mid nodes export fine. Prevents visual self-verification of full screens. **P1–P2.**

## Caveats
- This run covered 14 of ~40 prompts (selection-free + library); selection-dependent and fixture-mutating prompts were out of scope.
- Figmagent ran on the **remote** transport — both bugs above are remote-transport-specific and may not reproduce on the plugin transport (which would also be ~100× faster per command).
- The reset methodology means only the Figma MCP run remains in the file; Figmagent's outputs were captured via screenshot before reset (see conversation). For side-by-side inspection in Figma in future runs, use two separate copies.
