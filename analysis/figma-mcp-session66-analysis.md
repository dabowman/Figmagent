# Figma MCP Session 66 Analysis

## Session Overview

- **Transcript**: `.claude/sessions-json/5bbcf3de-b865-4cf0-b397-3702205754ac.json`
- **Duration**: ~66 active minutes over a 4,169-minute wall clock — 61 min on 2026-09-11 (17:55:30Z → 18:56:46Z), then a 5-minute follow-up on 2026-09-14 (15:16:30Z → 15:21:04Z) in the same session
- **Total tool calls**: 145 (77 Figmagent, 68 other: Bash, Read, Edit, 1 ToolSearch, 1 AskUserQuestion)
- **Total errors**: 9 — 8 Figmagent (10.4% of Figma calls: 3 `run_script`, 5 `screenshot`) + 1 Bash (exit 1 on a scratch `cat`)
- **Reconnections**: 0 (remote transport, one `use_file` by fileKey)
- **Context restarts**: 0
- **Official-Figma-MCP calls**: 0
- **Transport**: remote (`use_file` `C4zLeQJs8qkAhFSLwMKP9J`)
- **Repo**: external — `~/Github/storybook` ("Archer" design system); model `claude-opus-5`
- **Task**: sync the Archer Figma file with a week of code changes. (1) Variables: diff all 763 Figma variables against the regenerated `tokens/figma/` output, then create 80, rename 7 in place, re-alias 6, delete 1, and write every new ID back to `config/*.tokens.json`. (2) Text styles: step heading/1–6 down a size and to semibold, restore `ui/overline`'s weight binding, add five `(cap-trim)` sibling styles carrying vertical trim and move ~160 label layers onto them. (3) Components: bind `minHeight` to the new size scale on 16 sets, add `Checkbox Label`, a Switch checked-hover variant and a Tabs disabled variant, re-spell 29 instance labels off an Inter face name, rewrite stale Dev-mode annotations. (4) Three days later: rewrite the repo's component-build workflow prompt and mint 5 more variables a concurrent commit had added.

This is the **14th analysed session on the "Archer" file**, and the first on it since session 65 (2026-09-04).

## Metrics

| Metric | Session 65 | This Session | Change |
|---|---|---|---|
| Total tool calls | 149 | 145 | −3% |
| Figmagent tool calls | 84 | 77 | −8% |
| `run_script` share of Figma calls | 6 of 84 (7.1%) | **60 of 77 (77.9%)** | +70.8 pts — second-highest on record after session 62's 80.0% |
| `run_script` share of write ops | 5 of 29 (17%) | **29 of 29 (100%)** | 0 `write`, 0 `edit`, 0 `create_variables`, 0 `update_variables` |
| Errors (Figma) | 9 (10.7%) | 8 (10.4%) | −0.3 pts |
| Unflagged soft failures | 1 | 0 | −1 |
| Estimated waste | ~23% of Figma calls (19 of 84) | **~22% of Figma calls (17 of 77)** | −1 pt |
| ToolSearch calls | 5 (3.4%) | 1 (0.7%) | −4 |

Waste breakdown (17): 5 failed screenshots; 3 font-wall script failures plus the check and revert they forced (5); a re-pass over nested instance labels the first move missed (2); a respell retry on 7 nested labels (2); a re-apply of semibold overrides `setTextStyleIdAsync` dropped (2); one over-budget `read` (1).

## Tool Call Distribution

| Tool | Calls | Notes |
|---|---|---|
| `run_script` | 60 | 29 `mode: "write"` (3 failed — all the custom-font wall), 31 read-only. ~13 of the write scripts park one or more text styles on Inter around the work ([BUG-037]'s style-level park) |
| Bash | ~44 | token pipeline (`npm run tokens:*`), Python flatten/hash of `tokens/figma/`, `git log`/`git show` archaeology, two commits |
| `screenshot` | 10 | 5 failed ([BUG-016]): 1 batch `Exported 0 node(s): none`, 4 single "~4MB cap" |
| Edit | ~9 | storybook memory files, the repo's build-workflow prompt |
| Read | ~8 | memory files, CHANGELOG, workflow |
| `read` | 3 | 1 over budget at `maxOutputChars: 9000` (17,368 chars) |
| `grep` | 2 | one `variableId` search over 5 ids, paginated 2 pages, 2,043 nodes |
| `lint` | 1 | 4 roots, 29 issues (24 `near_match` padding, 5 `exact_match` opacity — [BUG-038] debt) |
| `use_file` | 1 | |
| ToolSearch | 1 | 11 Figmagent tools selected up front; `create_styles`/`update_styles` not among them |
| AskUserQuestion | 1 | cap-trim representation + whether to build 15 new pages |
| **Total** | **145** | 77 Figmagent + 68 other |

## Efficiency Issues

### 1. Every write went through `run_script` while the first-class tools sat loaded (100% of 29 write ops)

The opening ToolSearch (`toolu_01MwxiS8aRKVdhCh6bbLQkFZ`, 17:57:41Z) loaded `edit`, `write`, `get_design_system`, `create_variables` and `update_variables`. None was called once.

**Pattern observed:**
- **Variables** — `toolu_01H2ugLe32f4eKqTBcg1jxip` (18:13:54Z) renamed 7, re-aliased 6, deleted 1 and created/scoped 80 variables across three collections in one atomic script. `create_variables` covers the creates (aliases and scopes inline) and `update_variables` the renames, re-aliases and delete, but `create_variables` takes one collection per call, so that would have been 4–5 calls instead of 1. Same shape as [TOOL-052] (session 62).
- **Text styles** — heading/1–6 re-pointed to a smaller `font/size/*` and to `font/weight/semibold` (`toolu_01XfoEtM69w1dYp9NnDEpeRL`, `toolu_012o26zT4GVRaW1caVHuid1H`) and `ui/overline`'s weight re-bound (`toolu_01Uj9BeoaQXgGd2gN9HKMmQd`). `update_styles` takes `variables: { fontSize, fontWeight }` and `lineHeight` directly. `update_styles` and `create_styles` were never loaded ([AGENT-036], 2nd session).
- **Bindings** — `minHeight` bound to `size/sm|md|lg` on every variant of 16 sets (`toolu_01EX6B1DJ6ztqMZf2MJ9hDss`), `height` + `paddingTop/Bottom` on Number Field (`toolu_01Ek8jfpXqdDQdP4ANUxNW29`), `topLeftRadius`/`topRightRadius` on Tabs Tab. `edit({variables})` accepts every one of these fields (`minHeight`, `height`, `topLeftRadius`, …: `src/figmagent_mcp/tools/apply.ts:7-38`, `FIELD_MAP` in `src/figma_plugin/src/commands/styles.js:1150-1181`), but the `variables` description at `apply.ts:207` lists only `fill, stroke, cornerRadius, padding*, itemSpacing, width, height, opacity, visible, characters` and the text fields. It leaves out `minWidth`/`maxWidth`/`minHeight`/`maxHeight`, the four per-corner radii and `counterAxisSpacing`. An agent reading the description has no reason to think `minHeight` is bindable. Filed as [TOOL-062].

**Root cause:** three separate things. Discovery ([AGENT-036]): the styles tools were not loaded. Payload shape ([TOOL-052]): one atomic multi-collection script against several per-collection calls. Description ([TOOL-062]): a binding field list that undersells what `edit` does. The custom-font wall ([BUG-033]) explains the ~13 scripts that had to park a style around a structural write, but not the variable CRUD or the min-height bindings, which load no font.

**Proposed fix:** [TOOL-062] (description-only, planned). [TOOL-052] and [AGENT-036] are unchanged.

**Estimated savings:** ~3 scripts → `edit`/`update_styles` batches here. The larger cost is that 29 writes ran without the pre-checks and post-write assertions ([TOOL-033]).

### 2. Vertical trim has no first-class path (5-style build plus a failed probe)

The code cap-trims control labels (`text-box: trim-both cap alphabetic`). The agent established that Figma's equivalent, `leadingTrim: 'CAP_HEIGHT'`, detaches the text style when set on a layer, and on remote it throws for a custom-font node. The user chose "trimmed style siblings" (18:51:25Z). The five `(cap-trim)` styles were then created in `run_script` (`toolu_01WH7oYsvmBqKGBLhKa4MwNx`), because `leadingTrim` is not a field on `create_styles`, `update_styles` or `edit` (`src/figmagent_mcp/tools/tokens.ts:680-737`, `apply.ts:63-246`). Everything else the script did is `create_styles` today: an Inter-authored face with `fontSize`/`fontFamily`/`fontWeight` bound through `variables`, and copied `lineHeight`/`letterSpacing`/`textCase`. Filed as [TOOL-063].

**Pattern observed:** `toolu_01Wj3DBytc1GDSDP86jM7ZsZ` (18:24:47Z) set `t.leadingTrim = 'CAP_HEIGHT'` on a label and failed with `in set_leadingTrim: Cannot write to node with unloaded font "PP Neue Montreal Regular"`. `toolu_01DuD1ckaq3zoeHts6dsLe3a` parked the style and succeeded, and read back `style: false`: the trim detached the node from `ui/control`. `toolu_019i3wfd77dsEM8yGbC4zdtP` reverted it.

**Estimated savings:** ~2 calls (the probe and the revert) plus the `create_styles` validation the style build forfeited.

### 3. Fixing a style change missed nested instance overrides, twice

After the labels moved onto the trimmed styles (`toolu_01EaFzdtDzfygCtwAspqbh4m`: 80 main-component layers and 57 instance sublayers), a file-wide height audit (`toolu_01PBdxsrtq1L4EXpvaFCvnDd`) still found popup scenes at the old heights. The nested item labels inside instance-in-instance scenes carried their own `textStyleId` override of the **untrimmed** style. They kept 21px labels while their mains measured 10px. A style-park re-measure (`toolu_0174JP8We93WbpLBNxSUS23A`) changed nothing. `toolu_01ENPZGhioHZckU1rWVcdUvf` found the override and `toolu_01JVAwhCsBYXneNHXMcdu3yH` re-pointed 24 more. Separately, `setTextStyleIdAsync` dropped the node-level semibold override on active tabs, active nav links and selected options (`toolu_01ESavL7gc9Fx2tLojACXLfJ` found `w=[font/weight/medium]` where `medium+semibold` had been), which cost a re-apply (`toolu_01LW9pe2vY7FzmJr4SN7Aepz`).

**Root cause:** both are Figma semantics that a whole-document script has to handle itself. The audit that caught the misses was a field projection over 360+ instances that no `read` call can produce ([TOOL-057]). The stale nested heights are the same propagation gap as [BUG-051].

**Estimated savings:** ~4 calls. Recorded as recurrences, not a new entry.

## Error Analysis

### 1. Remote `screenshot` (5 failures, ~1 minute)

- `toolu_01G4iLGYYw882bYGffRRs2ox` (18:41:04Z): `screenshot({nodeIds:["397:9","42:42","392:2","393:2"], scale:2})` returned `Exported 0 node(s): none`, with `is_error: true`, no `Errors:` block and no fix.
- `toolu_01FiZeJgdRHRqNgBR9vwoZQA`: `42:42` at scale 2 failed with the "~4MB return cap" text. The same node succeeded at scale 1 (`toolu_014HLF1EVcrzPKpt4tdFyhUD`).
- `toolu_013k6YZqE5W7q5fWY4gJY4uv`: `63:274` at 1.5, "~4MB cap".
- `toolu_01EmhRFPXT31sz3WarfeBPeX`: `11:59` (`Accordion`) at **scale 1**, "~4MB cap". This is the node session 53's in-VM `exportAsync` measured at a 20,113-byte PNG after it had failed four times there.
- `toolu_01BvEFxqELEMy7ZhaU912MXc`: `143:64` at 1.0, "~4MB cap".

**Agent recovery:** good. It took one scale step on `42:42`, and after `11:59` and `63:274` failed it exported children (`63:277`, `11:74`) at scale 1. All succeeded. It made no `format: "SVG"` attempt and no official-MCP call. On 2026-09-14 it wrote the rule into the storybook repo's build-workflow prompt (`toolu_01MVhmoAc4QnCJjGkRDpvZQ9`): *"A whole COMPONENT_SET usually fails with a bogus 4MB-cap error, and so does a batch of `nodeIds`; export single nodes at `scale: 1`."* The guard text is now being encoded downstream as "bogus". That routes agents away from batch screenshots in that repo for good.

**Fix needed:** [BUG-016] v5 (the `remote/client.ts` JSON-parse line). Recorded as its 24th recurrence.

### 2. Custom-font wall in `run_script` (3 failures, ~2 minutes)

- `toolu_01Csvn1ixGnFkQdhpV4pN1fr` (18:18:17Z): re-binding heading/6 **weight before family** threw `in setBoundVariable: unloaded font "PP Neue Montreal Semi Bold"`. The weight lookup rewrote the parked Inter face to Inter's `Semi Bold` spelling, then the family bind needed `PP Neue Montreal Semi Bold`, which does not exist. Binding family first, then weight, worked (`toolu_01XfoEtM69w1dYp9NnDEpeRL`). This ordering constraint is not yet in [BUG-044]'s restore recipe.
- `toolu_01Wj3DBytc1GDSDP86jM7ZsZ` (18:24:47Z): `set_leadingTrim` needs the node's font, a new operation for [BUG-033]'s list.
- `toolu_01X6opMNe2wWJ8MvhW39qNig` (18:35:02Z): `appendChild` of a cloned Tabs variant, which is [BUG-033] as known. Recovered in one call by parking `ui/control` around the clone (`toolu_016dFUR43kcZWfgua7Yhm9Fv`).

**Agent recovery:** best-in-class. Each failure got one changed hypothesis and no identical retry ([AGENT-029] executed correctly). The style-level park ([BUG-037]) ran in ~13 scripts with zero style corruption. It restored family first, then weight, and checked `Object.keys(style.boundVariables)` each time.

### 3. Over-budget `read` (1, not flagged as an error)

`toolu_019GdrsWv3F79LJPtU2rv8Hu` `read("42:42", full, depth 3, maxOutputChars: 9000)` returned the meta block and narrowing hints for 17,368 chars. The agent wrote a 9-field projection script instead (`toolu_01BsvDYMnMVhDLjg6Zfkrsdh`), which is [TOOL-057]'s shape.

## What Worked Well

1. **The per-group hash diff.** 763 variables were checked against 140 per-group FNV hashes built locally from `tokens/figma/` and embedded in one `run_script` (`toolu_01LAzFTsAj6MrvmwaJ2GpdfY`), so only differing groups came back. The post-write re-verification (`toolu_011dRfhDJ4dK7oXzvzuhdabk`) returned `missing: [], bad: {}` on Color 501 / Static 60 / Viewport 202. The variable sync got an exact, cheap proof of done.
2. **`grep` pagination.** One `variableId` search over 5 ids paged cleanly (`page: 2`) across 2,043 nodes and showed exactly which components consumed the size tokens before they were renamed.
3. **Style-level park ([BUG-037]) at scale.** ~13 scripts parked 1–10 shared styles on Inter around clones, trims and style swaps. Every restore was verified, and no style lost a binding. [BUG-044]'s restore lesson has held since session 61.
4. **Asking before building.** The `AskUserQuestion` put two expensive choices to the user: how to represent cap trim, and whether to run a 15–45-agent build workflow. The user skipped the second, which saved the largest cost the session could have incurred.
5. **Screenshot recovery.** Five failures cost five calls and no detour ([AGENT-031] executed correctly).
6. **IDs written back to the repo.** Every new variable ID went into `config/component.tokens.json` / `config/figma-variables.json`, and token validation and the repo's 432 tests ran clean before the commit.

## Priority Improvements

### Tool Changes (ranked by call savings)

1. **[TOOL-062] `edit` `variables` description** — list every bindable field (`minWidth`/`maxWidth`/`minHeight`/`maxHeight`, per-corner radii, `counterAxisSpacing`). ~3 scripts here. Description-only, planned.
2. **[TOOL-063] `leadingTrim`** on `create_styles`/`update_styles` (and `edit` for TEXT nodes, with the style-detach caveat). ~2 calls plus a validated style build.
3. **[BUG-016] v5** — still the transport line. The guard text is now being encoded downstream as "bogus".

### Agent Skill Updates

1. **When a task crosses into styles, ToolSearch `create_styles`/`update_styles` before writing a style script** — [AGENT-036], unchanged.
2. **After a `setTextStyleIdAsync` sweep, re-apply node-level `fontWeight` overrides and walk nested instance sublayers** — a `run_script` gotcha the agent wrote to its own memory. It belongs in the remote-VM notes [INFRA-008] is promoting into the skill, not in a new entry.

## Additional observations (not filed)

- **Weight-then-family throws; family-then-weight works.** When restoring a parked text style, binding `fontWeight` while the style sits on Inter rewrites the face to Inter's `Semi Bold`, and the subsequent `fontFamily` bind then looks for `PP Neue Montreal Semi Bold`. It belongs as one line in [BUG-044]'s restore recipe; it is recorded there as a recurrence note.
- **29 instance labels on an Inter-spelled face (`Semi Bold`).** `toolu_01RaEB9vfuSnqVDCCK6StVYR` found 29 instance sublayers on `PP Neue Montreal / Semi Bold`, a face the real family lacks, so the real client shows a missing font. Respelling took two passes (`toolu_015LbGqxn9eZuZTTA7NGEVHD`, `toolu_01AsxW9Yy2K27uwv72owpFDi`). This is [BUG-034]/[BUG-035]'s residue from earlier sessions' writes.
- **Concurrent commit during the sync.** Another session committed 5 new tokens to the same worktree while this sync ran. The agent noticed after its own commit and closed the gap (`toolu_017RbNrazA5eaYXCuxxGXhGT`). This was repo-side concurrency, not a Figmagent defect.
- **The skill was injected as a user message and the agent never named a Figma action before reading memory.** That is a normal start for this file, and nothing in the transcript asked the analyzer to change its process.

## Outcome

- **Result**: analyzed
- **Reason**: every phase completed. 2 new tracker entries ([TOOL-062], [TOOL-063]); 10 existing entries updated with recurrences ([BUG-016], [BUG-033], [BUG-037], [BUG-044], [BUG-051], [BUG-034], [AGENT-025], [AGENT-036], [TOOL-052], [TOOL-057]); 1 fix plan (`plans/2026-10-15-TOOL-062.md`).
