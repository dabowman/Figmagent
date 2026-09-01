# Figma Design-Agent Benchmark

A **tool-agnostic** benchmark of real design tasks — the kind of work a human designer
actually does in Figma. It exists to:

1. **Measure Figmagent's progress over time** on a stable task set.
2. **Compare against other agents/MCPs** (e.g. the official Figma MCP) on equal footing.
3. **Surface where other tools have an edge** so we can decide what's worth adopting.

The prompts below are phrased the way a designer would request the work. They name **no
tools and no APIs**. Pass criteria describe the **resulting design**, never the path taken
to get there — any agent that produces the correct artifact passes, regardless of how many
calls it made or which primitives it used.

## How to Use

Run each prompt from the **benchmark seed file** — a known, reproducible Figma file based on
the WordPress Design System. Build it once per [`tests/seed/README.md`](seed/README.md), then
**duplicate it before each run** so both agents under test start from an identical state (many
prompts mutate or delete nodes). The seed supplies the design system, the WPDS published
libraries, and the work-in-progress fixtures that the styling / token / library / prototype /
audit prompts operate on. Token, style, and component names used below resolve against the seed.

For each run, with each agent under test, record:

| What to record | Notes |
|---|---|
| **Correctness** | Does the resulting design match the prompt? (primary) |
| **First-try correct** | Did the agent reach the correct result on its *first* completion, without the user pointing out an error or re-asking? |
| **Wall-clock time** | From sending the prompt to the agent declaring done. (primary efficiency axis) |
| **Errors / recoveries** | How many operations errored; did it recover unaided? |
| **Tool calls** | Informational only — see note below. |
| **Notes** | Anything the agent did unusually well or badly; capability gaps. |

**On tool-call count:** different architectures are not comparable on raw call count. Some
agents issue many small typed calls; others funnel an entire task into one code-execution
call with the real work (and any retries) hidden inside the script. Log it for color, but
**score efficiency on wall-clock time and first-try correctness**, not call count.

**Neutral verification:** confirm pass criteria by inspecting the resulting file directly —
a screenshot plus a property read-back — not by trusting the agent's own summary. Neither
tool should grade its own homework. The Figma REST API or a fresh read in a *different*
agent are good neutral checks.

**Complexity tags:** `L1` atomic action · `L2` short sequence · `L3` multi-step workflow ·
`L4` full task a designer would hand off · `G` generative/reference-driven · `E` design
edge case.

---

## L1 — Atomic Operations

Single micro-actions a designer performs constantly. Used as fast unit checks.

### 1.1 Create a frame
> Create a frame called "Card" that is 320×240px on the current page.

**Category:** Node creation
**Outcome:** A frame named "Card", 320×240, exists on the current page.

### 1.2 Create text
> Add a text node inside the "Card" frame that says "Hello World" in 16px font.

**Category:** Text creation
**Outcome:** A text node, child of Card, content "Hello World", size 16px.

### 1.3 Set fill color
> Set the Card frame's background to #2563EB with 100% opacity.

**Category:** Styling
**Outcome:** Card fill is #2563EB with alpha = 1.

### 1.4 Set corner radius
> Round the corners of the Card frame to 12px.

**Category:** Styling
**Outcome:** All four corners = 12.

### 1.5 Get node info
> Inspect the Card frame and tell me its current properties — dimensions, fill, corner radius, and children.

**Category:** Inspection
**Outcome:** Reported dimensions, fill, corner radius, and child list all match the actual node.

### 1.6 Clone a node
> Duplicate the Card frame. Name the copy "Card Copy".

**Category:** Node manipulation
**Outcome:** A sibling named "Card Copy" exists with the same dimensions and properties as Card.

### 1.7 Delete nodes
> Delete both the Card and Card Copy frames.

**Category:** Node manipulation
**Outcome:** Both nodes are removed from the file.

### 1.8 Export a node
> Export the Card frame as a PNG at 2x scale.

**Category:** Export
**Outcome:** A PNG at 2× scale is produced (image data or file path returned), no error.

### 1.9 Search by name
> Find all nodes named "Card" on the current page.

**Category:** Search
**Outcome:** Returns exactly the Card node(s) present — no false positives or misses.

### 1.10 Focus viewport
> Focus the viewport on the Card frame so I can see it.

**Category:** Navigation
**Outcome:** The viewport scrolls to and zooms on the Card frame.

---

## L2 — Short Sequences

### 2.1 Frame with auto-layout
> Create a vertical auto-layout frame called "Stack" with 16px gap, 24px padding on all sides, and hug contents on both axes.

**Category:** Layout
**Outcome:** Vertical auto-layout, item spacing 16, padding 24 on all sides, hug on both axes.

### 2.2 Text with style
> Create a text node that says "Section Title" and apply the text style "Heading/md" to it.

**Category:** Text + styling
**Outcome:** Text "Section Title" exists with the existing "Heading/md" style applied (resolved by name, not re-created).

### 2.3 Fill + stroke + radius
> Create a 48×48 frame called "Avatar". Give it a circular shape (corner radius 24), a #E5E7EB fill, and a 2px #D1D5DB stroke.

**Category:** Styling composition
**Outcome:** Avatar is 48×48, radius 24, fill #E5E7EB, stroke #D1D5DB at 2px. No type errors.

### 2.4 Bind a variable
> Bind the fill color of the Avatar frame to the design token variable `color/background/surface/neutral-weak`.

**Category:** Variables
**Outcome:** Avatar's fill is a live binding to the `color/background/surface/neutral-weak` variable (a real binding, not a hardcoded hex that happens to match).

### 2.5 Swap component variant
> I have a Button component set with variants Size=SM, MD, LG. Change the selected instance from MD to LG.

**Category:** Components
**Outcome:** The selected instance now renders the LG variant; the main component is untouched.

### 2.6 Annotate a node
> Add a development annotation with the label "Ready for review" and category "development" to the Card frame. Then read the annotation back to confirm it was set.

**Category:** Annotations
**Outcome:** Card carries a development annotation labeled "Ready for review"; a read-back confirms it.

### 2.7 Create a component
> Create a "Badge" component (not just a frame) with a text child that says "New" in 12px bold white text, with a #2563EB background fill, 4px vertical and 8px horizontal padding, and 9999px corner radius (pill shape).

**Category:** Component creation
**Outcome:** Node type is COMPONENT (not FRAME); text child "New" is 12px bold white; fill #2563EB; padding 4/8; pill radius.

### 2.8 Discover the design system
> Tell me what design tokens and styles are available in this file — how many color variables, text styles, and effect styles exist? List the variable collections and their modes.

**Category:** Design system discovery
**Outcome:** Reported counts of color variables, text styles, and effect styles — plus collection names and their modes — match the file.

### 2.9 Reparent a node
> Move the "Title" text node from inside the "Card" frame into a different frame called "Header".

**Category:** Reparenting
**Outcome:** The "Title" text is now a child of Header (removed from Card) with its properties preserved.

### 2.10 Apply effect style
> Apply the "Elevation/md" effect style to the Card frame.

**Category:** Effect styles
**Outcome:** The existing "Elevation/md" effect style is bound to Card (a style reference, not a copied raw effect).

---

## L3 — Multi-Step Workflows

### 3.1 Build a card component
> Build a card component with:
> - Vertical auto-layout, 16px gap, 24px padding
> - A 320px-wide image placeholder (gray rectangle, 180px tall)
> - A "Title" text node (Heading/sm style)
> - A "Description" text node (Body/md style)
> - 8px corner radius on the outer frame
> Make it hug height, fixed 320px width.

**Category:** Component construction
**Outcome:** A COMPONENT with the specified layout, placeholder, both styled text nodes, 8px radius, hug height / fixed 320px width.

### 3.2 Create variant set
> Take the Card component and create a variant set with two variants: Default and Hover. The Hover variant should have a subtle drop shadow and a slightly darker background (#F9FAFB → #F3F4F6).

**Category:** Components + variants
**Outcome:** A component set with two named variants; Hover has the drop shadow and #F3F4F6 fill.

### 3.3 Batch text content update
> I have a table component with 6 rows. Update all the "Cell 1" text nodes to show: "Alice", "Bob", "Carol", "Dave", "Eve", "Frank".

**Category:** Batch text
**Outcome:** The six target text nodes read Alice, Bob, Carol, Dave, Eve, Frank in order.

### 3.4 Bind variables across a component
> I have a "ListItem" component with a title text, subtitle text, icon frame, and divider line. Bind these design tokens:
> - Title fill → `color/foreground/content/neutral`
> - Subtitle fill → `color/foreground/content/neutral-weak`
> - Icon frame fill → `color/foreground/content/neutral`
> - Divider stroke → `color/stroke/surface/neutral`
> - Outer frame padding → `dimension/padding/md`

**Category:** Variable binding (batch)
**Outcome:** All five bindings are live on the ListItem **component** (not on instances).

### 3.5 Clone-and-modify workflow
> I have a "Row/Default" variant. Create three new variants: "Row/Hover", "Row/Selected", and "Row/Disabled".
> - Hover: change background fill to `color/background/interactive/neutral-weak-active`
> - Selected: change background fill to `color/background/interactive/brand-weak`, add a 2px left border in `color/stroke/interactive/brand`
> - Disabled: set opacity to 0.5 on the outer frame

**Category:** Variant creation via cloning
**Outcome:** Three new correctly-named variants with the specified fills, border, and opacity.

### 3.6 Create design tokens
> Create a variable collection called "Spacing" with two modes: "Desktop" and "Mobile". Add these variables:
> - `spacing/sm`: Desktop=8, Mobile=4
> - `spacing/md`: Desktop=16, Mobile=12
> - `spacing/lg`: Desktop=24, Mobile=16
> All variables should have scope CORNER_RADIUS, WIDTH_HEIGHT, GAP.

**Category:** Variable CRUD
**Outcome:** A "Spacing" collection with both modes; three variables with correct per-mode values and the three scopes.

### 3.7 Lint and auto-fix
> Run a design lint on the selected frame. Report which properties are hardcoded (not bound to design tokens). Then auto-fix any exact matches.

**Category:** Design linting
**Outcome:** A report distinguishing exact / near / no / ambiguous matches; exact matches are bound to tokens; ambiguous values are left alone.

### 3.8 Batch annotate
> Add annotations to 5 nodes in the selected component:
> - The outer frame: "spacing" category, label "Uses 16px gap"
> - The title text: "typography" category, label "Heading/sm"
> - The description text: "typography" category, label "Body/md"
> - The image placeholder: "dimension" category, label "320×180 aspect ratio"
> - The CTA button: "interaction" category, label "Primary action"

**Category:** Batch annotations
**Outcome:** All five annotations present on the correct nodes with the right categories and labels.

### 3.9 Component property definitions
> Add these property definitions to an existing "Button" component:
> - A BOOLEAN property "Show Icon" (default: true)
> - A TEXT property "Label" (default: "Button")
> - An INSTANCE_SWAP property "Icon" (default: the current icon instance)

**Category:** Component properties
**Outcome:** All three property definitions exist with correct types and defaults (BOOLEAN default is a real boolean, not the string "true").

### 3.10 Transfer instance overrides
> I have two Button instances. The first one has custom text, a swapped icon, and a different fill color. Copy all overrides from the first instance to the second.

**Category:** Instance overrides
**Outcome:** The second instance now shows the same custom text, swapped icon, and fill as the first.

---

## L4 — Full Tasks

### 4.1 Build a data table from scratch — north star
> Build a data table component with:
> - A header row with 4 columns: "Name", "Email", "Role", "Status"
> - 3 data rows with placeholder content
> - Header text should use Heading/sm style, data text should use Body/md
> - Columns should be evenly distributed (fill container width)
> - Add a 1px bottom border on each row
> - Bind all text colors to the appropriate design token variables

**Category:** Full construction + styling + variables
**Outcome:** Structurally correct table, both text styles applied, columns fill-distributed, 1px bottom border per row, text colors bound to tokens. This task exercises every major capability — treat its wall-clock time and first-try rate as the headline number.

### 4.2 Recreate a component from code
> Here is a React component. Build the Figma equivalent that matches its visual structure:
> ```jsx
> function Alert({ variant = "info", title, description }) {
>   return (
>     <div className="flex gap-3 p-4 rounded-lg border">
>       <Icon name={variant} className="w-5 h-5 mt-0.5 shrink-0" />
>       <div className="flex flex-col gap-1">
>         <span className="font-semibold text-sm">{title}</span>
>         <span className="text-sm text-gray-600">{description}</span>
>       </div>
>     </div>
>   );
> }
> ```
> Create variants for info, success, warning, and error — each with a different icon color and left border accent.

**Category:** Code-to-Figma translation
**Outcome:** Component structure matches the React tree (row, gap 12, padding 16, rounded, border; icon + a vertical text stack). Four variants exist with distinct icon color and left-border accent.

### 4.3 Refactor component structure
> The selected component has 12 direct children but should be reorganized into 3 groups:
> - "Header" group: first 2 children
> - "Content" group: children 3–9
> - "Footer" group: children 10–12
> Wrap each group in an auto-layout frame without changing the visual output.

**Category:** Restructuring
**Outcome:** Three new auto-layout wrapper frames hold the correct children, with no visible change to the rendered output.

### 4.4 Import and compose library components
> From the WPDS team library, import the Secondary/Medium and Primary/Medium Button components. Create a "FormActions" component that places the Secondary button on the left and the Primary button on the right, with 8px gap and centered vertical alignment (a Cancel / Save action row).

**Category:** Library + composition
**Outcome:** Both WPDS Button variants are imported as instances inside a "FormActions" component — Secondary left, Primary right, 8px gap, vertically centered. (The exact variant is `Type=Secondary/Primary, Size=Medium, State=Default, Destructive=False`; verified import keys are in the seed README.)

### 4.5 Responsive layout with constraints
> Build a responsive "Navbar" component that is 100% width (fill container). It should have:
> - A logo placeholder on the left (fixed 120px)
> - A navigation links area in the center (fill remaining space, horizontal layout, 24px gap)
> - A "Sign In" button on the right (hug contents)
> The overall frame should be horizontal auto-layout with space-between distribution.

**Category:** Advanced layout
**Outcome:** Outer frame fills width with horizontal auto-layout and space-between; logo fixed 120, nav fills remaining (horizontal, 24px gap), button hugs.

### 4.6 Style audit and fix
> Inspect all text nodes in the selected frame. Report which ones are missing a text style, and which are using a font size that doesn't match any defined text style. Then fix them by applying the closest matching text style.

**Category:** Inspection + analysis + batch fix
**Outcome:** Accurate report of unstyled / mismatched text nodes, followed by application of the closest matching text style to each.

### 4.7 Skeleton loading state
> Take the selected "Card" component and create a "Loading" variant. Replace all text nodes with skeleton placeholder rectangles (rounded, light gray fill, matching the approximate width and height of each text node). Replace the image placeholder with a skeleton rectangle too.

**Category:** State variant creation
**Outcome:** A "Loading" variant whose skeleton rectangles match the position and approximate size of the original text and image nodes.

### 4.8 Build a design token system
> Create a complete color token system:
> 1. Create a "Primitives" variable collection with colors: `blue/500` (#2563EB), `blue/600` (#1D4ED8), `gray/100` (#F3F4F6), `gray/200` (#E5E7EB), `gray/900` (#111827), `white` (#FFFFFF)
> 2. Create a "Semantic" variable collection with aliases: `color/primary` → blue/500, `color/primary-hover` → blue/600, `color/surface` → white, `color/surface-secondary` → gray/100, `color/border` → gray/200, `color/text` → gray/900
> 3. Create paint styles "Primary", "Primary Hover", "Surface", "Surface Secondary", "Border", "Text" — each bound to the corresponding semantic variable
> 4. Apply the "Primary" paint style to an existing button frame's fill

**Category:** Full token pipeline
**Outcome:** Two collections with the correct primitives and aliases; six paint styles each bound to their semantic token; "Primary" applied to the button.

### 4.9 Prototype flow visualization
> Read the prototype reactions from all frames on the current page. Then create connector lines between frames that have navigation actions, so I can see the flow visually.

**Category:** Prototyping + connections
**Outcome:** Connectors join exactly the frame pairs that have navigation reactions — matching the actual prototype wiring, not guesses.

### 4.10 Document-wide design audit
> Search the entire document (all pages) for all instances of the "Button" component. For each instance found, check whether its fill and text colors are bound to design token variables. Report a summary of which instances are fully tokenized vs. which have hardcoded values.

**Category:** Cross-page search + audit
**Outcome:** All Button instances across all pages are found and correctly classified as tokenized vs. hardcoded, summarized by page.

### 4.11 Component with full property system
> Build a "Button" component with the complete property system:
> - A VARIANT property "Size" with values SM, MD, LG (create 3 variant components with different padding/font sizes)
> - A VARIANT property "Style" with values Primary, Secondary (create filled vs. outlined variants, so 6 total)
> - A BOOLEAN property "Show Icon" (default: true) controlling visibility of an icon frame
> - A TEXT property "Label" (default: "Button")
> - Use auto-layout on all variants with appropriate sizing

**Category:** Full component authoring
**Outcome:** A component set with 6 variants (3 sizes × 2 styles), BOOLEAN and TEXT properties defined, auto-layout with appropriate sizing on every variant.

---

## G — Generative & Reference-Driven

Open-ended, "make me something" tasks — a large part of real design work and the area where
generative tools (e.g. Figma's `generate_figma_design` / Figma Make) are most likely to have
an edge. Judge these on visual quality and faithfulness, not exact pixels. These are the
prompts most likely to reveal capabilities worth adopting.

### G1 Recreate from a screenshot
> Here's a screenshot of a settings page. Recreate it as a Figma frame — match the layout, spacing, type hierarchy, and grouping as closely as you can.
> *(Attach a real screenshot when running.)*

**Category:** Reference-driven construction
**Outcome:** A frame that a designer would recognize as a faithful rebuild — correct sections, alignment, hierarchy, and spacing. Judge faithfulness side-by-side with the source.

### G2 Design from intent
> Design a mobile login screen for a fintech app: app logo, email and password fields, a primary "Sign in" button, a "Forgot password?" link, and a row of social-login buttons. Clean, modern style; sensible spacing and hierarchy.

**Category:** Generative design
**Outcome:** A coherent, plausibly-shippable login screen with all requested elements, sane layout, and consistent styling. Judge on visual quality, completeness, and whether it reads as intentional rather than templated.

---

## E — Design Edge Cases

Situations that test design correctness and judgment, not raw construction.

### E1 Instance vs. component gate
> (Select an instance, not a main component.)
> Add a new child frame to this component.

**Outcome:** Recognizes the selection is an instance; either edits the main component or explains why a child can't be added to an instance. Does not silently fail or corrupt the instance.

### E2 Type coercion resilience
> Set corner radius to 8 and fill opacity to 0.5.

**Outcome:** Corner radius = 8 and fill opacity = 0.5, applied cleanly with no type errors.

### E3 Wrong node type for layout
> Create a rectangle and then try to set it to vertical auto-layout.

**Outcome:** Ends up with auto-layout on an appropriate container (a frame), not a broken/failed rectangle. Doesn't silently delete-and-recreate without saying so.

### E4 Empty search results
> Find all instances of a component called "NonExistentComponent_XYZ" in this file.

**Outcome:** Reports clearly that none were found. Does not thrash through repeated alternative searches.

### E5 Variable binding on an instance
> (Select an instance.)
> Bind the fill to `color/background/interactive/brand-strong`.

**Outcome:** Recognizes the selection is an instance and explains that the binding belongs on the main component (where it propagates to all instances) — or navigates there — rather than binding only the one instance.

---

## Scoring Rubric

| Dimension | Weight | Measurement |
|---|---|---|
| **Correctness** | 35% | Does the final design match the prompt? Verified by neutral inspection. |
| **First-try correctness** | 25% | Reached the correct result on the first completion, with no user correction. |
| **Speed** | 20% | Wall-clock time from prompt to done. |
| **Error rate / recovery** | 10% | Fewer errored operations is better; unaided recovery counts in favor. |
| **Autonomy** | 10% | Completed without unnecessary questions or stalls. |

### Baselines (record per agent, update as tools improve)

Capture these for each agent under test so progress and gaps are visible over time. Leave
tool-call count as an informational note, not a score.

| Prompt | Median wall-clock | First-try correct? | Errors | Tool calls (info) |
|---|---|---|---|---|
| 3.1 Card component | — | — | — | — |
| 3.4 Bind 5 variables | — | — | — | — |
| 3.6 Token collection | — | — | — | — |
| 3.7 Lint and fix | — | — | — | — |
| 3.8 Batch annotate | — | — | — | — |
| 4.1 Data table (north star) | — | — | — | — |
| 4.2 Alert from code | — | — | — | — |
| 4.7 Skeleton state | — | — | — | — |
| 4.8 Token system | — | — | — | — |
| 4.10 Document audit | — | — | — | — |
| G1 Recreate from screenshot | — | — | — | — |
| G2 Design from intent | — | — | — | — |

When an agent **can't** do a task at all, record that as a capability gap (not just a slow
time) — those gaps, in either direction, are the most useful output of the benchmark.

---

## Appendix — Figmagent-Internal Robustness (not part of the cross-tool benchmark)

These exercise Figmagent's specific transport and harness behavior. They are **not**
tool-agnostic design tasks and should not be scored against other agents — keep them here so
the cross-tool numbers stay clean, but run them when validating Figmagent itself.

- **Connection-drop recovery** — disconnect the plugin mid-task; the agent should detect the
  timeout within ~2 failed calls, reconnect, and retry rather than hammering a dead channel.
- **Oversized design-system response** — discovery on a file with 500+ variables should
  degrade gracefully (narrow/paginate) rather than re-issuing the same over-broad call.
- **Stale tool schema** — after a server restart adds a tool, the agent should re-discover it
  rather than repeatedly failing on a cached schema.
- **Multi-file channel selection** — with the plugin live in two open files, the agent should
  confirm which file to act on rather than blindly using whichever channel auto-joined.
- **`read` output-budget overflow** — a deep, full-detail inspection that overflows the output
  budget should be narrowed (lower depth / structure first), not repeated verbatim.
