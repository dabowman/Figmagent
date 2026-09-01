# Benchmark Seed File (WordPress Design System)

The [design-agent benchmark](../benchmark-test-prompts.md) must start from a **known,
reproducible Figma file** so runs are comparable across agents and over time. Several prompts
(`2.x` styling, `3.x` token binding, `4.4` library import, `4.9` prototype flow, `4.10` audit)
assume the file already contains a design system, library components, and work-in-progress to
operate on. This directory defines that file.

The seed is **WPDS-based**: its local design system mirrors the WordPress Design System token
structure, and the four published WPDS libraries are enabled for the import tasks.

## How the seed is used

1. **Build it once** (steps below) into a fresh Figma file named **`Benchmark Seed — WPDS`**.
2. Before each benchmark run, **duplicate that file** and run the agent under test against the
   copy. Never run against the master — many prompts mutate or delete nodes.
3. Both agents under test (e.g. Figmagent and the official Figma MCP) start from the **same**
   duplicate so the comparison is fair.

> The seed is a *Figma* file; it can't live in git. What lives here is the spec + token
> definitions to rebuild it deterministically. Treat `seed-tokens.json` as the source of truth
> for the design system and this README as the source of truth for fixtures and wiring.

## 1. Enable the WPDS published libraries

These provide the **components** imported in `4.4` (and are realistic context for the audit
tasks). Enable all four in the seed file (Assets panel → Libraries), and confirm the team has
access:

| Library | fileKey | URL |
|---|---|---|
| WPDS / Gutenberg 22.3 | `jMgzw8IhsMC4gpMbMko4lv` | https://www.figma.com/design/jMgzw8IhsMC4gpMbMko4lv/WPDS--Gutenberg-22.3- |
| wordpress-ui | `nm9D3Qm04vVkWndsVo9ERP` | https://www.figma.com/design/nm9D3Qm04vVkWndsVo9ERP/-wordpress-ui |
| wordpress-icons | `9u2MoMaIjQIur2sSiRtv8Q` | https://www.figma.com/design/9u2MoMaIjQIur2sSiRtv8Q/-wordpress-icons |
| wordpress-admin-ui | `IKyyNyvdFyPrrxuieujSx1` | https://www.figma.com/design/IKyyNyvdFyPrrxuieujSx1/-wordpress-admin-ui |

**Verified import keys** (WPDS / Gutenberg 22.3) used by the library task — see
`memory/wpds-figma-library-keys.md` for the full set and the IconButton-vs-Button pitfall:

- Button `Type=Primary, Size=Medium, State=Default, Destructive=False` → `dc38940eb321c4e8c922027e5ba7fd3ec26ad2dd`
- Button `Type=Secondary, Size=Medium, State=Default, Destructive=False` → `5fdba7a2367b86bd34f39b6429d4f25757ea212d`

> **Important:** WPDS published-library *variables* are **not** importable into a consuming file
> (REST returns 403 Enterprise-only, and no Plugin API tool wraps the library-variable import).
> That is exactly why the seed defines its own local, WPDS-aligned token system below — so the
> token-binding prompts have real variables to bind to.

## 2. Build the local design system

Drive these from `seed-tokens.json`:

- **Variables** — two collections: `Primitives` (mode `Value`) and `Semantic` (modes `Light`,
  `Dark`, with `Light` default). Create with `create_variables`; the JSON carries per-mode
  values, aliases (`{group/name}` → a Primitives variable), and scopes.
- **Text styles** — `Body/sm`, `Body/md`, `Heading/sm`, `Heading/md`, `Heading/lg`
  (`create_styles`). If the seed environment lacks Inter, fall back to the platform default and
  record the substitution in the run notes (font availability is not under test).
- **Effect styles** — `Elevation/xs … lg` drop shadows (`create_styles`).

After building, `get_design_system` should report **2 collections** (Primitives, 1 mode +
Semantic, 2 modes), **53 variables** (38 color + 15 dimension), **5 text styles**, **4 effect
styles** — these are the numbers prompt `2.8` expects, so re-verify them whenever the token
file changes.

## 3. Build the fixtures

Place all fixtures on a page named **`Fixtures`**, laid out in non-overlapping zone columns
(pass explicit `x`/`y` — top-level nodes auto-place and pile up otherwise). Each fixture below
notes the prompt(s) it serves. Components marked **unbound/hardcoded on purpose** must NOT be
pre-tokenized — the binding/lint/audit prompts need raw values to find.

| ID | Fixture | Spec | Serves |
|---|---|---|---|
| **F1** | `Card` component | Vertical auto-layout, gap 16, padding 24, radius 8, fixed 320w / hug height. Children: 320×180 gray (`color/gray/100`) image placeholder; `Title` text (`Heading/sm`); `Description` text (`Body/md`). | 3.2, 4.7 |
| **F2** | `ListItem` component | Horizontal auto-layout. Children: icon frame (24×24), a vertical text stack with `Title` + `Subtitle` text, a 1px divider FRAME. **All colors/padding hardcoded** (raw hex, raw px) — not bound. | 3.4 |
| **F3** | `Row/Default` component | Horizontal auto-layout row, ~`color/white` bg, one text + one trailing icon frame. | 3.5 |
| **F4** | `Button` component set | Variant axis `Size = SM, MD, LG` (3 variants), auto-layout, label text + a leading icon frame child (an instance, so 3.9's INSTANCE_SWAP default exists). Place **one MD instance**, selected by default. | 2.5, 3.9 |
| **F5** | `Table` component | 6 rows; each row has a `Cell 1` text node (content `—`). | 3.3 |
| **F6** | Two `Button` instances | Instance A overridden: custom label text, a swapped icon, a non-default fill. Instance B pristine. Place A selected first for override-copy tasks; reuse for instance-gate edge cases. | 3.10, E1, E5 |
| **F7** | `Type Sample` frame | ~6 text nodes: some with a text style applied, some with **no style and off-scale sizes** (e.g. 17px, 22px). | 4.6 |
| **F8** | `Toolbar` component | A single component with **exactly 12 direct children** (mix of icon frames + text), no nested grouping. | 4.3 |
| **F9** | Prototype flow | 3 frames `Screen A`, `Screen B`, `Screen C` with prototype **navigate** reactions A→B (on tap) and B→C (on tap). No connectors yet. | 4.9 |
| **F10** | Audit set | A second page `Patterns` with ~5 `Button` instances: ~3 fully tokenized (fill + text bound to `Semantic`), ~2 with hardcoded fill/text. (Together with F4/F6 on `Fixtures`, this spreads Button instances across **two pages** for the cross-page search.) | 4.10 |

Prompts not listed (`1.x`, `2.1–2.3`, `2.6–2.10`, `3.1`, `3.6–3.9`, `4.1–4.2`, `4.5`, `4.8`,
`4.11`, `G1–G2`) create their own content and need only the design system from step 2 (or
nothing). `2.5` and `2.6` operate on whatever is selected — select F4's instance / F1 before
running them.

## 4. Token-name mapping

The benchmark prompts reference these design-system names; all exist after step 2:

| Benchmark reference | Seed variable / style |
|---|---|
| neutral surface tint (avatar fill) | `color/background/surface/neutral-weak` |
| text primary | `color/foreground/content/neutral` |
| text secondary | `color/foreground/content/neutral-weak` |
| icon default | `color/foreground/content/neutral` |
| border default | `color/stroke/surface/neutral` |
| surface hover | `color/background/interactive/neutral-weak-active` |
| surface selected | `color/background/interactive/brand-weak` |
| accent / brand | `color/background/interactive/brand-strong` (#3858e9) |
| brand stroke (left border) | `color/stroke/interactive/brand` |
| md padding/gap | `dimension/padding/md` / `dimension/gap/md` |
| Heading MD / SM, Body MD | `Heading/md`, `Heading/sm`, `Body/md` |
| Shadow MD | `Elevation/md` |

## 5. Verification checklist

After building, confirm the seed is correct (neutral check — a fresh read, not the building
agent's self-report):

- [ ] 4 WPDS libraries enabled and their components appear in Assets.
- [ ] `get_design_system` reports the counts in step 2.
- [ ] All F2 / F10-hardcoded fixtures are genuinely unbound (a `lint` pass should find issues).
- [ ] F9 frames have navigate reactions but no connectors.
- [ ] Button instances exist on **two** pages (F4/F6 on `Fixtures`, F10 on `Patterns`).
- [ ] No stray/orphaned nodes at page level (`get_document_info`).
