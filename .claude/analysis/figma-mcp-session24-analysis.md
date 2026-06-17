# Figma MCP Session 24 Analysis

## Session Overview

- **Transcript**: `b0d01a59-301b-4e48-b6f0-4b6426d5e719.json`
- **Project**: cursor-talk-to-figma-mcp (`main` branch)
- **Duration**: 12 minutes (19:07–19:19)
- **Total tool calls**: 39
- **Figma tool calls**: 20
- **Non-Figma tool calls**: 19 (5 ToolSearch + 5 Read + 7 Bash + 1 Write + 1 Edit)
- **Total errors**: 6 (4 Read "exceeds max tokens" on the same file + 2 Bash python exit-1)
- **Reconnections**: 1 (`join_channel` #4 — multi-file disambiguation among 3 open files, not a drop)
- **Context restarts**: 0
- **Task**: Read-only research/documentation — connect to the `tempo-brand-identity` Figma slide deck (42 slides), extract all text content (`scan_text_nodes`), export key visual slides (`export_node_as_image`), then author `tempo-brand-visual-guidelines.md` into project memory and update the `MEMORY.md` index.

> Note: Still pre-rename (wire names `get`/`scan_text_nodes`/`export_node_as_image`). `scan_text_nodes` is now covered by `grep`; `export_node_as_image` by `screenshot`.

## Metrics

| Metric | Session 23 | This Session | Change |
|---|---|---|---|
| Total Figma tool calls | 60 | 20 | -67% (research/doc, not build) |
| Meta/overhead calls | 8 ToolSearch | 5 ToolSearch + 5 Read + 7 Bash | Heavy overflow-parsing overhead |
| ToolSearch calls | 8 (11.8%) | 5 (12.8%) | +1pp |
| Estimated waste % | ~20% | ~30% | +10pp |

Waste is dominated by the `scan_text_nodes` overflow handling: a 46K-token dump the agent couldn't `Read` (4 failed attempts) and had to parse with Bash (`wc`/`cat`/`python3`, 2 of which failed). For a 42-slide full-text extraction this friction is partly inherent, but the 4 identical Read retries were avoidable.

## Tool Call Distribution

| Tool | Calls | Notes |
|---|---|---|
| export_node_as_image | 15 | One per slide, all **sequential** (no parallelism) — batch candidate |
| Bash | 7 | `wc`/`cat`/`python3` chunked parsing of the scan dump (2 python attempts failed) |
| Read | 5 | 4 **failed** on the same 46K-token scan dump (exceeds 10K Read limit); 1 ok (MEMORY.md) |
| ToolSearch | 5 | 12.8% — incl. a re-search after the multi-file `join_channel` |
| get_document_info | 2 | Initial + post-reconnect |
| join_channel | 1 | Multi-file disambiguation (3 files open) |
| get | 1 | Deck structure |
| scan_text_nodes | 1 | Full-deck text — overflowed to `tool-results/…txt` (46811 tokens) |
| Write | 1 | `tempo-brand-visual-guidelines.md` |
| Edit | 1 | `MEMORY.md` index update |

Total: 39. ✓

## Efficiency Issues

### 1. `scan_text_nodes` overflow → Read can't open the dump → Bash parse (saves ~6 calls) — [TOOL-009]/[AGENT-007] family

`scan_text_nodes(0:3)` on the 42-slide deck returned a result too large for the MCP budget, so it was written to `tool-results/mcp-Figmagent-scan_text_nodes-1774465752924.txt` (46,811 tokens). The agent then could not `Read` that file — Read caps at 10,000 tokens — and fell back to Bash chunking.

**Pattern observed:** `scan_text_nodes` → overflow file → `Read(dump)` ×4 all fail "File content (46811 tokens) exceeds maximum allowed tokens (10000)" → `Bash wc` → `Bash cat` ×2 → `Bash python3` ×3 (2 fail) → parsed.

**Root cause:** Two compounding limits — the MCP output budget (dumps to disk) and the Read tool's own 10K-token cap. The overflow dump is then in a no-man's-land: too big for Read, requiring manual Bash parsing. Same output-budget family as [TOOL-009] and the scan-overflow in [AGENT-007].

**Proposed fix:** For full-deck/large text extraction, `scan_text_nodes` (now `grep`) should support pagination or a `maxOutputChars`/chunk parameter that returns slide-grouped text within budget, rather than dumping one 46K-token blob. Alternatively the MCP overflow writer could split into ≤10K-token chunks so Read can open them. Agent-side: read the dump with `offset`/`limit` or Bash from the first overflow notice.

**Estimated savings:** ~6 calls (4 failed Reads + 2 failed Bash python) per large-text-extraction session.

### 2. Fail-fast on Read "exceeds max tokens" (saves ~3 calls) — NEW [AGENT-018]

The agent issued `Read` on the same 46K-token file **four times**, getting the identical "exceeds maximum allowed tokens (10000). Use offset and limit…" error each time, before switching to Bash.

**Pattern observed:** `Read(dump)` → error → `Read(dump)` → same error → ×4.

**Root cause:** Agent-behavior — the error message states the fix ("use offset and limit") but the agent re-issued bare Reads. This is the [AGENT-001] fail-fast principle applied to Read: after one "exceeds max tokens," adapt (offset/limit or Bash) rather than retry identically.

**Proposed fix:** Add to CLAUDE.md: "On a Read 'exceeds maximum allowed tokens' error, immediately switch to offset/limit or Bash — do not re-Read the whole file." Generic Claude Code behavior, but worth a line given the MCP overflow files routinely exceed 10K tokens.

**Estimated savings:** ~3 calls.

### 3. 15 sequential `export_node_as_image` calls (saves ~10 round-trips) — NEW [TOOL-017]

The agent exported 15 slides one at a time (#22–36), each a separate sequential call. No batch export exists, and the calls weren't even parallelized.

**Pattern observed:** `export_node_as_image(1:64)` → `(2:159)` → `(57:271)` → … 15 sequential single-node exports.

**Root cause:** No batch variant of `export_node_as_image`/`screenshot`. Single-node, called repeatedly.

**Proposed fix:** Add a multi-node export accepting a `nodeIds` array, returning images keyed by nodeId (with a sensible cap to control payload). Below the strict 20-consecutive batch-tool threshold but a clear pattern. Interim agent-side: issue exports in parallel batches.

**Estimated savings:** ~10 round-trips per multi-slide review.

### 4. ToolSearch overhead + post-reconnect re-search (saves ~3 calls) — [TOOL-005]

5 ToolSearch (12.8%), including one re-fetch after the multi-file `join_channel`. Same recurring pattern as sessions 22–23.

## Error Analysis

### 1. Read over-token on overflow dump (4 failures, ~1 minute lost)

All 4 failures were the same file and the same message: `"File content (46811 tokens) exceeds maximum allowed tokens (10000)."` See efficiency issues 1 & 2.

**Agent recovery:** Slow — 4 identical retries before adapting to Bash. Once on Bash, it chunked the file (`wc`/`cat`/`python3`) and got the content.

**Fix needed:** [AGENT-018] fail-fast on this error class; [TOOL-009]-family pagination so the dump is openable.

### 2. Bash python3 exit-1 ×2 (2 failures, negligible)

Two `python3` one-liners parsing the dump failed (one traceback). The agent iterated to a working heredoc (`PYEOF`) form. Minor scripting iteration, recovered.

## What Worked Well

1. **Right tools for a research task.** `scan_text_nodes` for the full-deck narrative text + `export_node_as_image` for the visual treatment (texture, color, photography, logo slides) — the correct read-only combination for reverse-engineering a brand deck.

2. **Clean multi-file disambiguation.** Three Figma files were open; the agent identified the brand deck by name and `join_channel`'d to it — one reconnect, no thrashing.

3. **Adapted to Bash chunking.** Once it stopped retrying Read, it used `wc`/`cat`/`python3` to read the 46K-token dump in pieces and extracted the slide text.

4. **Followed the memory workflow.** Wrote `tempo-brand-visual-guidelines.md` to project memory and updated the `MEMORY.md` index with a one-line pointer — exactly the documented memory convention. (This is the reference file now listed in MEMORY.md.)

5. **Comprehensive output in 12 minutes** — a full brand visual guidelines document from a 42-slide deck.

## Priority Improvements

### Tool Changes (ranked by call savings)

1. **[TOOL-009]-family pagination for large text scans** — `grep`/`scan_text_nodes` should chunk or paginate full-deck text within budget rather than dumping a 46K-token blob that exceeds the Read limit. Saves ~6 calls per large extraction.

2. **[TOOL-017] batch `export_node_as_image`/`screenshot`** — accept a `nodeIds` array, return images keyed by node. Saves ~10 round-trips per multi-slide review.

### Agent Skill Updates

1. **[AGENT-018] Fail-fast on Read over-token** — On "exceeds maximum allowed tokens," switch to offset/limit or Bash immediately; never re-Read the whole file. Add to CLAUDE.md.

2. **Parallelize independent exports** — When exporting many slides/nodes, issue the calls in parallel batches rather than sequentially.
