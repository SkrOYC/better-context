AGENTS.md

This file provides guidance to AI Agents when working with code in this repository.
These instructions guide you to focus on project-specific architecture and commands rather than generic development advice, and to base the content on actual analysis of the codebase rather than assumptions.

<!-- effect-solutions:start -->

## Effect Solutions Usage

The Effect Solutions CLI provides curated best practices and patterns for Effect TypeScript. Before working on Effect code, check if there's a relevant topic that covers your use case.

- `effect-solutions list` - List all available topics
- `effect-solutions show <slug...>` - Read one or more topics
- `effect-solutions search <term>` - Search topics by keyword

**Local Effect Source:** The Effect repository is cloned to `~/.local/share/effect-solutions/effect` for reference. Use this to explore APIs, find usage examples, and understand implementation details when the documentation isn't enough.

<!-- effect-solutions:end -->

## Code Style

- **Runtime**: Bun only. No Node.js, npm, pnpm, vite, dotenv.
- **TypeScript**: Strict mode enabled. ESNext target.
- **Effect**: Use `Effect.gen` for async code, `BunRuntime.runMain` for entry points. (Note: Actual codebase uses minimal Effect; prefer plain TypeScript patterns unless Effect is explicitly needed.)
- **Imports**: External packages first, then local. Use `.ts` extensions for local imports.
- **Bun APIs**: Prefer `Bun.file`, `Bun.serve`, `bun:sqlite`, `Bun.$` over Node equivalents.
- **Testing**: Use `bun:test` with `import { test, expect } from "bun:test"`.

## Error Handling

- Use Effect's error channel for typed errors.
- Use `Effect.tryPromise` for async operations, `Effect.try` for sync.
- Pipe errors through Effect combinators, don't throw.

## btca

Trigger: user says "use btca" (for codebase/docs questions).

Run:

- btca ask -t <tech> -q "<question>"

Available <tech>: svelte, tailwindcss, opentui, runed

## Development Commands

### Build and Check
- `bun run build` - Build CLI using Bun (outputs to `dist/`).
- `bun run check` - Run type checking and linting for CLI.

### Development
- `bun run cli` - Run the CLI directly from source.

### Testing
- `bun test` - Run all tests (in `tests/`, uses `bun:test`).
- `bun test <file>` - Run a single test file (e.g., `bun test tests/basic.test.ts`).

### Other
- `btca config repos clear` - Clear downloaded repositories (useful for testing).

## Architecture

### Project Structure
- `src/`: Core CLI app (TypeScript + Bun), handles btca commands via services (ConfigService for settings, OcService for OpenCode SDK integration, ValidationService for config checks).

### Data Flow for btca Commands
1. CLI validates tech/repo, checks response cache (10-min TTL).
2. Lazily clones/updates GitHub repos locally (30-min cache).
3. Reuses pooled OpenCode sessions (15-min window) or creates new ones.
4. Streams AI responses through event-driven pipeline (EventProcessor with backpressure, 1000 events/sec rate limit).
5. Outputs via MessageEventHandler; caches responses.

### Key Patterns
- **Event-Driven**: Streaming with handlers (MessageEventHandler for output, SessionEventHandler for lifecycle).
- **Resource Pooling**: Sessions/instances pooled with timeouts; async queuing for limits.
- **Caching**: Multi-level (responses, repos, validation) with auto-cleanup.
- **Type Safety**: Extensive guards for SDK events; fail-open for network issues.

### Performance Features
- Session reuse, parallel event handling (up to 20 concurrent), response caching.
- Repository smart updates, resource pool queuing (30-sec timeout).
- Metrics for cache hit rates, pool utilization.

## Install

```bash
bun add -g btca
btca --help
```

## Quick Commands

Ask a question:

```bash
btca ask -t svelte -q "How do stores work in Svelte 5?"
```

## Config

On first run, btca creates `~/.config/btca/btca.json` for repo list + model/provider.

### Managing Configuration

```bash
# View current model configuration
btca config model

# Update model and provider
btca config model --provider openai --model gpt-4

# List configured repositories
btca config repos list

# Add a new repository
btca config repos add --name react --url https://github.com/facebook/react

# Remove a repository
btca config repos remove --name react

# Clear all downloaded repositories
btca config repos clear
```

### Configuration Validation
- Startup validation with 5-min caching.
- Fail-open for network issues; dynamic updates without restart.