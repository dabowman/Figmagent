# Figma MCP Session 42 Analysis — `archivist` placeholder cohort (11 sessions)

## Session Overview

- **Transcripts**: 11 sessions, all from `~/Github/archivist` (an unrelated project)
  - `36b9fcdd` (2026-06-29), `16ed3ca6` (2026-06-30), `5c2e6cb0`, `d5995279`, `8ca1f562`,
    `076b71f6`, `4a6dbf76` (2026-07-01), `41f7b06e`, `8bf51a2f` (2026-07-02),
    `8ad309aa` (2026-07-10), `98b9c5fb` (2026-07-13)
- **Duration**: 0–2 minutes each
- **Total tool calls**: 87 across all 11
- **Figmagent tool calls**: 13 (1–2 per session)
- **Figma work performed**: **none**
- **Task**: not a Figma task in any of the 11 sessions

## Why this is one document, not eleven

Every Figmagent call in this cohort is a **placeholder probe**, not design work. The
complete inventory of Figma calls across all 11 sessions:

| Session | Call | Result |
|---|---|---|
| `36b9fcdd` | `export_session {format:"full"}` | — |
| `16ed3ca6` | `export_session {format:"full"}` | — |
| `5c2e6cb0` | `run_script {code:"return null;", description:"placeholder"}` ×2 | `No Figma file selected` |
| `d5995279` | `run_script {code:"return \"not applicable\";"}` | `No Figma file selected` |
| `8ca1f562` | `run_script {code:"return \"not a figma task\";"}` | `No Figma file selected` |
| `076b71f6` | `run_script {code:"return \"placeholder - not actually running figma\""}` | `No Figma file selected` |
| `4a6dbf76` | `run_script {code:"return \"not applicable\""}` | `No Figma file selected` |
| `41f7b06e` | `run_script {code:"return \"not applicable\""}` | `No Figma file selected` |
| `8bf51a2f` | `run_script {code:"return \"not applicable\";"}` | `No Figma file selected` |
| `8ad309aa` | `run_script {code:"return null;", description:"placeholder to test connection"}` | permission denied |
| `98b9c5fb` | `run_script {code:"return null", description:"dummy to check if figma is needed"}` | permission denied |

Nine of eleven sessions literally return the string `"not applicable"` / `"placeholder"` /
`"not a figma task"`. No node was read, created, or modified. There is no efficiency
pattern, error pattern, or agent behavior here worth an individual audit — the only real
finding is that these entered the analysis queue at all.

## The actual finding: manifest misclassification

`scripts/refresh-manifest.ts` assigns `sessionType: "figma"` when a session made **at least
one** `mcp__Figmagent__*` tool call. That predicate cannot distinguish design work from a
no-op probe, so these 11 sessions were queued as Figma sessions and sat at the head of the
chronological queue — ahead of three substantive sessions (313, 369, and 183 calls).

Under the nightly pipeline (`scripts/auto-improve.sh` loops `claude -p "/analyze-session"`
until the manifest reports zero unanalyzed figma sessions), this cohort would consume **11
full analysis runs** to produce 11 near-empty documents before reaching real work.

This is filed as `[INFRA-005]`.

Two secondary observations, both already covered by existing tracker entries:

1. The `No Figma file selected` rejection fired 9 times — correct behavior, and the message
   states its fix. Consistent with the remote-transport onboarding note in `[BUG-014]`.
2. `run_script` is exposed (and callable) in projects with no Figma file in scope. The
   agent reached for it as a generic "is this tool live?" probe. Not harmful — every call
   was correctly rejected — but it is why the misclassification triggers.

## What Worked Well

1. **Every placeholder was rejected cleanly.** All 9 `run_script` probes returned
   `No Figma file selected. Pass a file URL to use_file (e.g. https://www.figma.com/design/<fileKey>/...) or set FIGMA_FILE_KEY.` — a fix-stating error, correctly flagged `is_error: true`. No silent success, no partial execution.

## Priority Improvements

### Tool Changes

1. **`scripts/refresh-manifest.ts`** — raise the `figma` classification bar above "≥1
   Figmagent call". See `[INFRA-005]` for the proposed predicate. Saves ~11 wasted
   pipeline runs immediately and prevents recurrence.

### Agent Skill Updates

1. None. No agent behavior in this cohort needs changing.

## Disposition

All 11 session IDs are marked analyzed against this document so the queue advances to the
substantive sessions. Analysis continues at session 43 (`087bd997`, vip-workflows, 313 calls).
