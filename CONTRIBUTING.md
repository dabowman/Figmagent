# Contributing to Figmagent

Thanks for your interest in contributing! This guide will help you get set up and submit changes.

## Prerequisites

- [Bun](https://bun.sh) runtime
- Figma desktop app (for testing plugin changes)

## Setup

```bash
git clone https://github.com/dabowman/Figmagent.git
cd Figmagent
bun install
```

To test against Figma:

1. `bun socket` — start the WebSocket relay
2. In Figma: Plugins > Development > Link existing plugin > select `src/figma_plugin/manifest.json`
3. Run the plugin in Figma and click Connect

## Development Workflow

1. Create a branch from `main`:
   ```bash
   git checkout -b feat/your-feature
   ```

2. Make your changes. The codebase has three main areas:
   - **MCP server** (`src/figmagent_mcp/`) — TypeScript, runs directly via bun
   - **Figma plugin** (`src/figma_plugin/src/`) — ES modules, must be bundled
   - **WebSocket relay** (`src/socket.ts`) — Bun WebSocket server

3. If you edited plugin source files (`src/figma_plugin/src/`), rebuild:
   ```bash
   bun run build:plugin
   ```

4. Run checks before committing:
   ```bash
   bun run lint        # Biome linter
   bun run test        # bun:test
   bun run build:plugin  # Plugin bundle (if plugin files changed)
   ```

5. Open a PR against `main`.

## Code Style

- **Formatter**: Biome — 2-space indent, double quotes, semicolons, 120 char line width
- **Linting**: Biome with recommended rules. Run `bun run lint:fix` to auto-fix.
- **Plugin JS constraints**: No optional chaining (`?.`) or nullish coalescing (`??`) in `src/figma_plugin/src/` files — Biome enforces this. The plugin runs in Figma's sandboxed VM.
- **Colors**: Always RGBA 0-1 range (not 0-255).
- **Logging**: All logs go to stderr. Stdout is reserved for MCP protocol messages.

## Architecture Overview

```
AI Agent <-(stdio)-> MCP Server <-(WebSocket)-> Relay <-(WebSocket)-> Figma Plugin
```

Each MCP tool call gets a UUID, is sent over WebSocket to the plugin, and the response is correlated back by ID. The plugin processes commands via a dispatcher in `src/figma_plugin/src/main.js`.

Key patterns:
- **Tools are domain-grouped** in `src/figmagent_mcp/tools/` (document, create, apply, modify, text, components, find, tokens, lint, etc.)
- **Plugin commands mirror tool layout** in `src/figma_plugin/src/commands/`
- **Zod schemas** validate all tool parameters on the MCP side
- **Output budget** (30K chars default) prevents large responses from overwhelming agent context

See [CLAUDE.md](CLAUDE.md) for detailed patterns and gotchas.

## Adding a New Tool

The project has a skill file at `skills/add-mcp-tool/` (bundled in the Figmagent plugin) that walks through the full process. In short:

1. Add the command handler in the plugin (`src/figma_plugin/src/commands/`)
2. Register the command in the dispatcher (`src/figma_plugin/src/main.js`)
3. Add the MCP tool definition in `src/figmagent_mcp/tools/`
4. Add the command type to `src/figmagent_mcp/types.ts`
5. Rebuild the plugin: `bun run build:plugin`
6. Update CLAUDE.md if the tool introduces new patterns

## Pull Request Guidelines

- Keep PRs focused — one feature or fix per PR
- Include a clear description of what changed and why
- Make sure CI passes (lint, test, plugin build)
- Update CLAUDE.md if you change tool behavior or add patterns that agents need to know about
- Test plugin changes in Figma before submitting

## Automated merges

An overnight merge queue (`scripts/merge-queue.ts`, driven by the `/merge-queue` command as
Stage E of the auto-improve pipeline) reviews and squash-merges small, green PRs against `main`
without a human in the loop. What it means for your PR:

- **`auto-merge` label opts a human PR in.** Add it when you want the queue to review and merge
  your PR overnight; it gets a full adversarial review, must be green on CI at its head SHA,
  mergeable, at most 400 changed lines and 10 files, and not a draft.
- **`hold` or `needs-human` excludes a PR.** Either label takes it out of the queue until removed;
  the queue itself adds `needs-human` when it requests changes or escalates.
- **Protected paths are never auto-merged.** A PR touching `.github/**`, the pipeline scripts
  (`scripts/auto-improve.sh`, `dispatch-fix.ts`, `merge-queue.ts`, `merge-eligibility.ts`,
  `protected-paths.ts`, `release.ts`, `sync-tracker-issues.ts`, `scripts/pipeline/**`,
  `pipeline-record.ts`, `refresh-manifest.ts`), `.claude/commands/**`,
  `.claude/skills/analyze-session/**`, `.claude/hooks/**`, `.claude/settings.json`,
  `.claude-plugin/**`, `package.json`, `bun.lock`, `src/figma_plugin/manifest.json` or `.mcp.json`
  is listed as human-only whatever labels it carries. The list lives in
  `scripts/protected-paths.ts`.
- **Draft PRs from `auto-fix/*` are promoted by the queue** when its review approves them: the
  pipeline opens fixes as drafts, and the queue marks them ready and merges in one step.
- Merges are squashes that keep the `Closes #n` lines from the PR body, delete the branch, and
  leave a comment with the review summary. At most six PRs merge per night.

## Reporting Issues

Use GitHub Issues. Include:
- What you were trying to do
- What happened instead
- Steps to reproduce
- Figma plugin console output if relevant (Plugins > Development > Open console)
