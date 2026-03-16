# Figma MCP Agent — Benchmark Test Prompts

## How to Use

Each prompt is tagged with:
- **Category** — what capability area it exercises
- **Complexity** — `L1` (single tool), `L2` (multi-tool sequence), `L3` (multi-step workflow), `L4` (full agentic task)
- **Key tools** — which MCP tools should be invoked
- **Pass criteria** — what "correct" looks like

Run each prompt from a clean Figma file (or a designated test page). Record: tool call count, errors, whether the result matches the pass criteria.

---

## L1 — Single Operations

### 1.1 Create a frame
> Create a frame called "Card" that is 320×240px on the current page.

**Category:** Node creation
**Key tools:** `create`
**Pass criteria:** Frame exists with correct name and dimensions.

### 1.2 Create text
> Add a text node inside the "Card" frame that says "Hello World" in 16px font.

**Category:** Text creation
**Key tools:** `create`
**Pass criteria:** Text node is a child of Card, content and size correct.

### 1.3 Set fill color
> Set the Card frame's background to #2563EB with 100% opacity.

**Category:** Styling
**Key tools:** `apply`
**Pass criteria:** Fill color matches hex value. Verify alpha=1.

### 1.4 Set corner radius
> Round the corners of the Card frame to 12px.

**Category:** Styling
**Key tools:** `apply`
**Pass criteria:** All four corners = 12. Agent passes number, not string.

### 1.5 Get node info
> Inspect the Card frame and tell me its current properties — dimensions, fill, corner radius, and children.

**Category:** Inspection
**Key tools:** `get`
**Pass criteria:** Agent returns accurate properties in one call (detail="layout", depth ≥ 2). Does NOT make multiple escalating-detail calls.

### 1.6 Clone a node
> Duplicate the Card frame. Name the copy "Card Copy".

**Category:** Node manipulation
**Key tools:** `clone_node`, `rename_node`
**Pass criteria:** Clone exists as sibling with correct name.

### 1.7 Delete nodes
> Delete both the Card and Card Copy frames.

**Category:** Node manipulation
**Key tools:** `delete_multiple_nodes`
**Pass criteria:** Both nodes removed in a single batch call, not two individual deletes.

### 1.8 Export a node
> Export the Card frame as a PNG at 2x scale.

**Category:** Export
**Key tools:** `export_node_as_image`
**Pass criteria:** Export completes without error. Agent specifies format="PNG" and scale=2. Returns image data or file path.

### 1.9 Search by name
> Find all nodes named "Card" on the current page.

**Category:** Search
**Key tools:** `find`
**Pass criteria:** Agent uses `find` with `name: "Card"` criteria. Returns grouped results. Does NOT manually traverse the tree.

### 1.10 Focus viewport
> Focus the viewport on the Card frame so I can see it.

**Category:** Navigation
**Key tools:** `set_focus`
**Pass criteria:** Viewport scrolls to and zooms on the Card frame. Single tool call.

---

## L2 — Multi-Tool Sequences

### 2.1 Frame with auto-layout
> Create a vertical auto-layout frame called "Stack" with 16px gap, 24px padding on all sides, and hug contents on both axes.

**Category:** Layout
**Key tools:** `create` (with layout properties), optionally `apply` for sizing
**Pass criteria:** layoutMode=VERTICAL, itemSpacing=16, padding=24, sizing=HUG on both axes. Ideally ≤ 2 tool calls.

### 2.2 Text with style
> Create a text node that says "Section Title" and apply the text style "Heading MD" to it.

**Category:** Text + styling
**Key tools:** `create`, `get_design_system`, `apply` (with `textStyleId`)
**Pass criteria:** Text exists, style applied. Agent discovers styleId via `get_design_system` without excessive searching.

### 2.3 Fill + stroke + radius
> Create a 48×48 frame called "Avatar". Give it a circular shape (corner radius 24), a #E5E7EB fill, and a 2px #D1D5DB stroke.

**Category:** Styling composition
**Key tools:** `create`, `apply` (fillColor + strokeColor + strokeWeight + cornerRadius)
**Pass criteria:** All three visual properties applied. No type-mismatch errors (numbers not strings). Ideally `create` + one `apply` call.

### 2.4 Bind a variable
> Bind the fill color of the Avatar frame to the design token variable `colors/neutral/200`.

**Category:** Variables
**Key tools:** `get_design_system`, `apply` (with `variables` field)
**Pass criteria:** Variable resolved by name, bound to correct field via `apply`. Agent doesn't hardcode a VariableID.

### 2.5 Swap component variant
> I have a Button component set with variants Size=SM, MD, LG. Change the selected instance from MD to LG.

**Category:** Components
**Key tools:** `get_selection`, `apply` (with `swapVariantId`)
**Pass criteria:** Variant swapped correctly. Agent verifies it's an instance (not the main component) first.

### 2.6 Annotate a node
> Add a development annotation with the label "Ready for review" and category "development" to the Card frame. Then read the annotation back to confirm it was set.

**Category:** Annotations
**Key tools:** `set_annotation`, `get_annotations`
**Pass criteria:** Annotation created with correct label and category. Read-back confirms content. Two tool calls total.

### 2.7 Create a component
> Create a "Badge" component (not just a frame) with a text child that says "New" in 12px bold white text, with a #2563EB background fill, 4px vertical and 8px horizontal padding, and 9999px corner radius (pill shape).

**Category:** Component creation
**Key tools:** `create` (with `type: "COMPONENT"` and children)
**Pass criteria:** Node type is COMPONENT (not FRAME). Text child exists with correct content. Styling applied. Ideally a single `create` call with nested tree.

### 2.8 Discover the design system
> Tell me what design tokens and styles are available in this file — how many color variables, text styles, and effect styles exist? List the variable collections and their modes.

**Category:** Design system discovery
**Key tools:** `get_design_system`
**Pass criteria:** Agent calls `get_design_system` once and reports accurate counts. Does NOT call `get_styles` and `get_local_variables` separately.

### 2.9 Clone and reparent
> Move the "Title" text node from inside the "Card" frame into a different frame called "Header".

**Category:** Reparenting
**Key tools:** `clone_and_modify` (with `parentId`), `delete_node`
**Pass criteria:** Agent uses the clone-and-modify + delete pattern (since `move_node` only changes x/y, not hierarchy). Text node ends up as child of Header with properties preserved.

### 2.10 Apply effect style
> Apply the "Shadow/MD" effect style to the Card frame.

**Category:** Effect styles
**Key tools:** `get_design_system`, `apply` (with `effectStyleId`)
**Pass criteria:** Effect style discovered and applied. Agent uses `get_design_system` to find the style ID, not hardcoded.

---

## L3 — Multi-Step Workflows

### 3.1 Build a card component
> Build a card component with:
> - Vertical auto-layout, 16px gap, 24px padding
> - A 320px-wide image placeholder (gray rectangle, 180px tall)
> - A "Title" text node (Heading SM style)
> - A "Description" text node (Body MD style)
> - 8px corner radius on the outer frame
> Make it hug height, fixed 320px width.

**Category:** Component construction
**Key tools:** `create` (nested tree with `type: "COMPONENT"`), `get_design_system`, `apply` (textStyleId + cornerRadius)
**Pass criteria:** Structurally correct component. Measure: total tool calls (target: ≤ 5 with batch tools).

### 3.2 Create variant set
> Take the Card component and create a variant set with two variants: Default and Hover. The Hover variant should have a subtle drop shadow and a slightly darker background (#F9FAFB → #F3F4F6).

**Category:** Components + variants
**Key tools:** `clone_node`, `apply` (fillColor + effects), `combine_as_variants`
**Pass criteria:** ComponentSet created with two named variants. Hover has correct shadow + fill delta.

### 3.3 Batch text content update
> I have a table component with 6 rows. Update all the "Cell 1" text nodes to show: "Alice", "Bob", "Carol", "Dave", "Eve", "Frank".

**Category:** Batch text
**Key tools:** `find` (text criteria) or `scan_text_nodes`, `set_multiple_text_contents`
**Pass criteria:** All 6 updated in minimal calls. Agent uses find/scan to locate nodes, then batch-sets. Target: ≤ 3 tool calls.

### 3.4 Bind variables across a component
> I have a "ListItem" component with a title text, subtitle text, icon frame, and divider line. Bind these design tokens:
> - Title fill → `colors/text/primary`
> - Subtitle fill → `colors/text/secondary`
> - Icon frame fill → `colors/icon/default`
> - Divider stroke → `colors/border/default`
> - Outer frame padding → `spacing/md`

**Category:** Variable binding (batch)
**Key tools:** `get` (inspect component), `get_design_system`, `apply` (with `variables` on multiple nodes)
**Pass criteria:** All 5 bindings applied correctly. Agent binds on the COMPONENT, not instances. Measure call count — target: ≤ 4 tool calls.

### 3.5 Clone-and-modify workflow
> I have a "Row/Default" variant. Create three new variants: "Row/Hover", "Row/Selected", and "Row/Disabled".
> - Hover: change background fill to `colors/surface/hover`
> - Selected: change background fill to `colors/surface/selected`, add a 2px left border in `colors/accent/primary`
> - Disabled: set opacity to 0.5 on the outer frame

**Category:** Variant creation via cloning
**Key tools:** `clone_node`, `rename_node`, `apply` (fillColor, strokeColor, strokeWeight, opacity, variables)
**Pass criteria:** Three new variants with correct modifications. Agent clones rather than building from scratch.

### 3.6 Create design tokens
> Create a variable collection called "Spacing" with two modes: "Desktop" and "Mobile". Add these variables:
> - `spacing/sm`: Desktop=8, Mobile=4
> - `spacing/md`: Desktop=16, Mobile=12
> - `spacing/lg`: Desktop=24, Mobile=16
> All variables should have scope CORNER_RADIUS, WIDTH_HEIGHT, GAP.

**Category:** Variable CRUD
**Key tools:** `create_variables`
**Pass criteria:** Collection created with both modes. All 3 variables have correct per-mode values and scopes. Ideally a single `create_variables` call.

### 3.7 Lint and auto-fix
> Run a design lint on the selected frame. Report which properties are hardcoded (not bound to design tokens). Then auto-fix any exact matches.

**Category:** Design linting
**Key tools:** `lint_design` (first without autoFix to report), `lint_design` (with `autoFix: true`)
**Pass criteria:** Agent reports findings with severities (exact_match, near_match, no_match, ambiguous). Auto-fix binds exact matches only. Two calls total.

### 3.8 Batch annotate
> Add annotations to 5 nodes in the selected component:
> - The outer frame: "spacing" category, label "Uses 16px gap"
> - The title text: "typography" category, label "Heading SM"
> - The description text: "typography" category, label "Body MD"
> - The image placeholder: "dimension" category, label "320×180 aspect ratio"
> - The CTA button: "interaction" category, label "Primary action"

**Category:** Batch annotations
**Key tools:** `get` (inspect structure), `set_multiple_annotations`
**Pass criteria:** All 5 annotations set in a single batch call. Agent inspects the component first to get node IDs. Target: ≤ 3 tool calls.

### 3.9 Component property definitions
> Add these property definitions to an existing "Button" component:
> - A BOOLEAN property "Show Icon" (default: true)
> - A TEXT property "Label" (default: "Button")
> - An INSTANCE_SWAP property "Icon" (default: the current icon instance)

**Category:** Component properties
**Key tools:** `get` (inspect component), `component_properties` (batch add)
**Pass criteria:** All 3 properties added in a single `component_properties` call. Agent uses correct types (BOOLEAN default is `true` not `"true"`).

### 3.10 Transfer instance overrides
> I have two Button instances. The first one has custom text, a swapped icon, and a different fill color. Copy all overrides from the first instance to the second.

**Category:** Instance overrides
**Key tools:** `get_selection`, `get_instance_overrides`, `set_instance_overrides`
**Pass criteria:** Overrides transferred correctly. Text, component swap, and fill changes all appear on the target instance. Target: ≤ 4 tool calls.

---

## L4 — Full Agentic Tasks

### 4.1 Build a data table from scratch
> Build a data table component with:
> - A header row with 4 columns: "Name", "Email", "Role", "Status"
> - 3 data rows with placeholder content
> - Header text should use Heading SM style, data text should use Body MD
> - Columns should be evenly distributed (fill container width)
> - Add a 1px bottom border on each row
> - Bind all text colors to the appropriate design token variables

**Category:** Full construction + styling + variables
**Pass criteria:** Structurally correct table, styles applied, variables bound. Measure total call count and time. This is the "north star" benchmark — it exercises every major tool category.

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
**Pass criteria:** Component structure matches React tree. Four variants exist. Agent reads code FIRST, then builds. Does not guess at structure.

### 4.3 Refactor component structure
> The selected component has 12 direct children but should be reorganized into 3 groups:
> - "Header" group: first 2 children
> - "Content" group: children 3–9
> - "Footer" group: children 10–12
> Wrap each group in an auto-layout frame without changing the visual output.

**Category:** Restructuring
**Key tools:** `get` (inspect structure), `create`, `clone_and_modify` (reparent), `delete_multiple_nodes`, `reorder_children`
**Pass criteria:** Three new wrapper frames, children moved correctly, no visual regression. Tests agent's ability to inspect then restructure.

### 4.4 Import and compose library components
> From the team library, import the "Button/Primary/MD" and "Avatar" components. Create a "UserAction" component that places an Avatar on the left and a Button on the right, with 12px gap and centered vertical alignment.

**Category:** Remote library + composition
**Key tools:** `search_library_components`, `import_library_component`, `create` (type COMPONENT with INSTANCE children)
**Pass criteria:** Library components imported and instantiated. Composition frame has correct layout. Tests the full remote-library pipeline.

### 4.5 Responsive layout with constraints
> Build a responsive "Navbar" component that is 100% width (fill container). It should have:
> - A logo placeholder on the left (fixed 120px)
> - A navigation links area in the center (fill remaining space, horizontal layout, 24px gap)
> - A "Sign In" button on the right (hug contents)
> The overall frame should be horizontal auto-layout with space-between distribution.

**Category:** Advanced layout
**Pass criteria:** Correct layout modes and sizing on all children. Logo=FIXED, nav=FILL, button=HUG. Outer frame distributes space correctly.

### 4.6 Style audit and fix
> Inspect all text nodes in the selected frame. Report which ones are missing a text style, and which are using a font size that doesn't match any defined text style. Then fix them by applying the closest matching text style.

**Category:** Inspection + analysis + batch fix
**Key tools:** `find` (type: TEXT) or `scan_text_nodes`, `get_design_system`, `apply` (with `textStyleId`)
**Pass criteria:** Agent reports findings accurately, then applies fixes. Tests analytical reasoning + batch operations.

### 4.7 Skeleton loading state
> Take the selected "Card" component and create a "Loading" variant. Replace all text nodes with skeleton placeholder rectangles (rounded, light gray fill, matching the approximate width and height of each text node). Replace the image placeholder with a skeleton rectangle too.

**Category:** State variant creation
**Key tools:** `clone_node`, `get` (inspect structure at detail="layout"), `delete_multiple_nodes`, `create` (skeleton shapes), `apply`
**Pass criteria:** Loading variant has skeleton shapes matching the layout positions of the original content. Tests nested tree creation for repetitive skeleton shapes.

### 4.8 Build a design token system
> Create a complete color token system:
> 1. Create a "Primitives" variable collection with colors: `blue/500` (#2563EB), `blue/600` (#1D4ED8), `gray/100` (#F3F4F6), `gray/200` (#E5E7EB), `gray/900` (#111827), `white` (#FFFFFF)
> 2. Create a "Semantic" variable collection with aliases: `color/primary` → blue/500, `color/primary-hover` → blue/600, `color/surface` → white, `color/surface-secondary` → gray/100, `color/border` → gray/200, `color/text` → gray/900
> 3. Create paint styles "Primary", "Primary Hover", "Surface", "Surface Secondary", "Border", "Text" — each bound to the corresponding semantic variable
> 4. Apply the "Primary" paint style to an existing button frame's fill

**Category:** Full design token pipeline
**Key tools:** `create_variables` (×2), `create_styles` (with variable bindings), `apply`
**Pass criteria:** Two collections created with correct aliases. Paint styles created and bound to semantic tokens. Style applied to node. Tests the full token pipeline: primitives → semantics → styles → nodes.

### 4.9 Prototype flow visualization
> Read the prototype reactions from all frames on the current page. Then create connector lines between frames that have navigation actions, so I can see the flow visually.

**Category:** Prototyping + connections
**Key tools:** `get_document_info`, `get_reactions`, `set_default_connector`, `create_connections`
**Pass criteria:** Agent reads prototype reactions first, identifies navigation targets, then creates connectors. Does not guess at connections. Tests the reaction-to-connector workflow.

### 4.10 Document-wide design audit
> Search the entire document (all pages) for all instances of the "Button" component. For each instance found, check whether its fill and text colors are bound to design token variables. Report a summary of which instances are fully tokenized vs. which have hardcoded values.

**Category:** Cross-page search + lint
**Key tools:** `find` (with `componentId`, `scope: "DOCUMENT"`), `lint_design` (on found instances)
**Pass criteria:** Agent uses `find` with document scope to locate instances, then lints. Reports findings grouped by page. Does NOT manually traverse each page.

### 4.11 Component with full property system
> Build a "Button" component with the complete property system:
> - A VARIANT property "Size" with values SM, MD, LG (create 3 variant components with different padding/font sizes)
> - A VARIANT property "Style" with values Primary, Secondary (create filled vs. outlined variants, so 6 total)
> - A BOOLEAN property "Show Icon" (default: true) controlling visibility of an icon frame
> - A TEXT property "Label" (default: "Button")
> - Use auto-layout on all variants with appropriate sizing

**Category:** Full component property system
**Key tools:** `create` (COMPONENT type), `clone_node`, `combine_as_variants`, `component_properties`, `apply`
**Pass criteria:** Component set with 6 variants (3 sizes × 2 styles). BOOLEAN and TEXT properties defined. All variants have correct auto-layout. Tests the complete component authoring workflow.

---

## Error Recovery & Edge Case Prompts

### E1 — Instance vs. component gate
> (Select an instance, not a main component)
> Add a new child frame to this component.

**Pass criteria:** Agent detects it's an instance and either navigates to the main component or tells the user. Does NOT attempt to add children to an instance.

### E2 — Connection drop recovery
> (Disconnect the Figma plugin mid-task)
> Continue building the component.

**Pass criteria:** Agent detects timeout within 2 failed calls, calls `join_channel` to reconnect, then retries. Does not make 5+ timeout calls.

### E3 — Oversized response handling
> Run `get_design_system` on a file with 500+ variables.

**Pass criteria:** Agent handles output budget truncation gracefully. Uses `maxOutputChars` to get more data or narrows the query. Does not re-call without adjusting parameters.

### E4 — Stale tool schema
> (Restart MCP server with a new tool added)
> Use the new `batch_bind_variables` tool.

**Pass criteria:** Agent recognizes tool isn't in its cache, re-discovers tools, and uses the new tool. Does not make 4+ failed search attempts.

### E5 — Type coercion resilience
> Set corner radius to 8 and fill opacity to 0.5.

**Pass criteria:** No type-mismatch errors. Values passed as correct types (numbers, not strings).

### E6 — Wrong node type
> Create a rectangle and then try to set it to vertical auto-layout.

**Pass criteria:** Agent either avoids rectangles for layout (uses frame instead) or handles the error gracefully and switches to a frame. Does not delete-and-recreate silently.

### E7 — Multi-file channel selection
> (Open two Figma files with the plugin running in both)
> Create a frame in the "Design System" file.

**Pass criteria:** Agent detects multiple channels, asks user to confirm or calls `join_channel` with the correct file name. Does not blindly operate on whichever channel auto-joined.

### E8 — Empty search results
> Find all instances of a component called "NonExistentComponent_XYZ" in this file.

**Pass criteria:** Agent uses `find`, gets zero results, and reports "none found" clearly. Does NOT retry with different search strategies or make 3+ attempts to find something that doesn't exist.

### E9 — Output budget overflow on `get`
> Inspect the top-level page frame at detail="full" with depth=10.

**Pass criteria:** Agent either starts with `detail="structure"` + low depth (correct behavior), or if it gets a budget overflow error, narrows the query. Does NOT repeat the same over-broad call.

### E10 — Variable binding on instance (not component)
> (Select an instance)
> Bind the fill to `colors/primary`.

**Pass criteria:** Agent detects it's an instance and explains that variable bindings should be set on the main component (where they propagate to all instances). Either navigates to the component or warns the user.

---

## Scoring Rubric

| Dimension | Weight | Measurement |
|---|---|---|
| **Correctness** | 30% | Does the final Figma output match the prompt requirements? |
| **Efficiency** | 25% | Tool call count vs. theoretical minimum. Ratio > 2× = fail. |
| **Error rate** | 20% | % of tool calls that error. Target: < 5%. |
| **Recovery** | 15% | When errors occur, does the agent recover within 2 attempts? |
| **Autonomy** | 10% | Did the agent complete without unnecessary user intervention? |

### Efficiency Baselines (record and update as tools improve)

| Prompt | Current tool count | Target (with batch tools) |
|---|---|---|
| 3.1 Card component | — | ≤ 5 |
| 3.4 Bind 5 variables | — | ≤ 4 |
| 3.6 Create token collection | — | ≤ 2 |
| 3.7 Lint and fix | — | ≤ 3 |
| 3.8 Batch annotate | — | ≤ 3 |
| 4.1 Data table | — | ≤ 30 |
| 4.2 Alert from code | — | ≤ 20 |
| 4.7 Skeleton state | — | ≤ 10 |
| 4.8 Token system | — | ≤ 8 |
| 4.10 Document audit | — | ≤ 8 |

Fill in "Current tool count" after first benchmark run to establish baselines.
