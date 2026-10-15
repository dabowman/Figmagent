# Figma MCP Session 37 Analysis

## Session Overview

- **Transcript**: `6fceb24e-bcb9-4c0c-af54-3c35ff7cb747.json`
- **Duration**: ~66 minutes (2026-06-17 17:56 → 19:01 UTC)
- **Total tool calls**: 77
- **Total errors**: 5 hard failures (all returned `is_error: false`), 0 timeouts
- **Reconnections**: 0 (remote transport — no `join_channel`)
- **Context restarts**: 0
- **Repo**: **external — WordPress-Admin-Environment** (remote transport)
- **Task**: Opened by invoking the `reauthenticate` skill (re-auth Figmagent's remote transport to an **editor** Figma account), then created the WPDS 6.9 design-token variable set in the WP-Admin Figma file — light values + a server-side-derived **Dark** mode (135 variables created, 83 updated) — and evaluated re-linking the file's old `@wordpress/components` Button/IconButton instances to the WPDS 22.3 `@wordpress/ui` variants (Variant+Tone). Ended on a clarifying question; actual re-link deferred.

This session is the **direct sequel to Session 33** (same external project, same day, remote): Session 33's `read` calls were blocked by the remote edit-access wall ([BUG-015]). Here the agent re-authenticated as an editor first (call 2) and then both **reads and writes succeeded** — strong corroboration that editor scope is the sole blocker for remote, matching Session 34.

## Metrics

| Metric | Session 36 | This Session (37) | Change |
|---|---|---|---|
| Total tool calls | 149 | 77 | −72 |
| Figmagent tool calls | 14 | 41 | +27 |
| Official figma MCP calls | (read-only ref) | 5 | — |
| ToolSearch calls | 2 (1.3%) | 9 (11.7%) | +7 |
| Hard errors | 8 (2 figma) | 5 (all figma) | −3 |
| Estimated waste % | ~8% | ~16% | +8pp |

Waste is higher than Session 36 because this was a write-heavy session with three distinct cross-file/cross-MCP key-format confusions and a small batch of duplicate reads. It is not regression in any shipped tool — it's agent-side key/scope confusion in a published-library + remote context.

## Tool Call Distribution

| Tool | Calls | Notes |
|---|---|---|
| `mcp__Figmagent__read` | 17 | 3 redundant (52≡54, 53≡55, 64≡67); 2 failed (cross-file library node IDs) |
| ToolSearch | 9 | external repo — Figmagent/official-figma/design-system tools all deferred ([TOOL-005]) |
| Bash | 9 | DTCG→`create_variables` gen + dark-mode hex derivation from `@wordpress/theme` color-ramps |
| Read | 5 | reading generated payloads + `@wordpress/theme` source |
| AskUserQuestion | 5 | all for genuinely ambiguous design decisions (good) |
| `create_variables` | 4 | **135 vars created, 0 failed** (batched: 32+32+24+47) |
| `mcp__plugin_figma_figma__search_design_system` | 4 | exploring WPDS library via official MCP |
| `import_library_component` | 4 | 2 failed (component-SET keys), 2 succeeded (variant keys) |
| `update_variables` | 3 | **83 vars updated for Dark mode, 0 failed** (batched: 27+32+24) |
| `search_library_components` | 3 | WPDS variant lookup |
| Write | 2 | token-gen scripts to `/tmp` |
| `grep` | 2 | locating Button/IconButton sets |
| `get_library_components` | 2 | 1 failed (404 — passed a `lk-` library key as fileKey) |
| `reauthenticate` | 1 | **the session's enabling move** — editor account |
| `use_file` | 1 | selected file by figma.com URL |
| `get_local_components` / `get_selection` / `get_component_variants` | 1 each | — |
| `mcp__plugin_figma_figma__get_libraries` | 1 | returned the `lk-` library keys later misused |
| `mcp__design-system__get_design_tokens` | 1 | WPDS token reference |
| `edit` | 1 | cleanup — deleted 2 prototype button instances (good hygiene) |

**Total: 77** (41 Figmagent + 5 official-figma + 1 design-system + 9 ToolSearch + 9 Bash + 5 Read + 2 Write + 5 AskUserQuestion).

## Efficiency Issues

### 1. Official-MCP `libraryKey` (`lk-...`) passed to Figmagent's `get_library_components` → 404 (saves ~2 calls)

After `mcp__plugin_figma_figma__get_libraries` (call 39) returned WPDS library entries with `libraryKey: "lk-9c51b469…"` (a 130-char official-MCP team-library handle), the agent passed one of those `lk-…` strings to Figmagent's `get_library_components` as its `fileKey` (call 63) → `Figma API returned 404 Not Found`. Figmagent's REST tools want a **Figma fileKey** (the short `jMgzw8IhsMC4gpMbMko4lv` form), not an official-MCP library handle.

**Pattern observed:** call 39 (official `get_libraries` → `lk-…`) → call 63 (`get_library_components(fileKey="lk-619fa586…")`) → 404 → calls 64–69 recover with the real fileKey `jMgzw8IhsMC4gpMbMko4lv`.

**Root cause:** Two MCPs with two different key namespaces (official `libraryKey` vs Figma `fileKey`); nothing flags the mismatch and the agent assumed they were interchangeable.

**Proposed fix:** Agent-behavior — never feed an official-figma `libraryKey` (`lk-…`) into a Figmagent REST tool; resolve the real fileKey first. Tool-side, `get_library_components` could detect an `lk-`-prefixed value and return "that's an official-MCP library key, not a Figma fileKey" instead of a bare 404.

### 2. Reading published-library variant node IDs in the working file → "Node not found" (saves ~2 calls)

`get_component_variants(fileKey=jMgzw8…)` (call 70) returned WPDS variant node IDs (`16507:33913`, `16507:33977`). The agent then `read` those IDs against the **connected WP-Admin file** (calls 71, 72) → `Node not found: 16507:33913`. Those node IDs live in the **WPDS library file**, not the working file — they can't be read by ID in the working context; they must be imported (`import_library_component`) first.

**Root cause:** Recurrence of the documented hazard already in CLAUDE.md ("a URL-derived node ID … may belong to a different file than the connected one — e.g. a library file vs the working file"). The guidance exists but wasn't applied in the remote + library flow.

**Proposed fix:** Reinforce in the libraries/remote guidance: variant node IDs from `get_component_variants` belong to the library file — import them, don't `read` them in the working file. (No code change; agent-behavior reinforcement.)

### 3. Duplicate reads of nested instance nodes (saves ~3 calls)

Calls 52≡54 (`I1:1135;43:128;38:117`) and 53≡55 (`I1:1135;43:128;38:127`) re-read the same nested prototype-instance nodes back-to-back; call 64≡67 re-read `1:289`. ~3 calls of pure re-inspection — the [AGENT-016]/[AGENT-017] family. Minor; the response from the first read already carried the structure.

## Error Analysis

### 1. `import_library_component` with a component-SET key (2 failures — recovered)

Calls 49/50 passed WPDS component-**set** keys to `import_library_component` → `Component with key "f165991d…" not found. This may be a component set key — use get_component_variants to find individual variant keys, then import those instead.` The agent followed the embedded fix and calls 57/58 succeeded with variant keys (`Variant=Outline, Tone=Brand, …`). **This is well-handled UX** — the error states the exact fix and the agent recovered in one hop. No new issue; the import error message is doing its job.

### 2. `get_library_components` 404 on a `lk-` key — Efficiency Issue 1 above.

### 3. `read` "Node not found" on library node IDs — Efficiency Issue 2 above.

### Cross-cutting: all 5 hard failures returned `is_error: false`

Three distinct failure shapes — import "not found", REST 404, and `read` "Node not found" — every one came back with `is_error: false` and an `"Error …"` content string the agent had to parse. This is the **strongest single-session evidence yet** for [BUG-008] (Figmagent never sets `is_error: true` on the remote path): import-not-found, REST-404, and node-not-found in one session, all unflagged.

## What Worked Well

1. **Re-auth as the enabling first move.** The `reauthenticate` skill (call 2) flipped the remote identity to an editor account; every subsequent read and write succeeded. Direct fix for Session 33's [BUG-015] edit-access wall, and corroboration of Session 34's "editor scope unblocks remote reads+writes."
2. **Batched variable CRUD, zero failures.** 135 variables created across 4 `create_variables` calls and 83 updated across 3 `update_variables` calls — 0 failed. Exactly the batch-first pattern [TOOL-001]/[AGENT-019] intend.
3. **Server-side dark-mode derivation.** The agent read `@wordpress/theme` color-ramp exports and computed light→dark hex flips in a `/tmp` Node script, then fed the results to `update_variables` — deriving a whole Dark mode the 6.9 snapshot doesn't ship. Cleaned up the `/tmp` scripts afterward (calls 19, 32).
4. **AskUserQuestion for real ambiguity.** All 5 asks were genuine design decisions (dark-mode thoroughness, brand-accent handling, Tertiary→Variant+Tone mapping, old-vs-new `@wordpress/ui` generation) — not confirmation boilerplate.
5. **Cleanup hygiene.** Ended by deleting the 2 prototype button instances it had imported for inspection (call 76) — matches the user's standing "clean up after retried operations" preference.

## Priority Improvements

### Tool Changes (ranked by call savings)

1. **[BUG-008] Flag remote failures as `is_error: true`** — this session adds import-not-found + REST-404 + node-not-found, all unflagged. Highest-leverage remaining reliability fix for the remote path.
2. **`get_library_components` should reject `lk-` keys with a clear message** — detect an official-MCP `libraryKey` passed as `fileKey` and say so, instead of a bare 404.

### Agent Skill Updates

1. **Don't cross MCP key namespaces** — an official-figma `libraryKey` (`lk-…`) is not a Figma `fileKey`; resolve the real fileKey before calling Figmagent REST tools. (New [AGENT-021].)
2. **Library variant node IDs aren't readable in the working file** — IDs from `get_component_variants` live in the library file; import them, don't `read` them in the connected file. (New [AGENT-022]; reinforces the existing CLAUDE.md cross-file note.)
3. **Batch contiguous library reads** — the duplicate nested-instance reads (52≡54, 53≡55) were avoidable; pass sibling node IDs as one `read({nodeIds})`. (Existing [AGENT-017].)
