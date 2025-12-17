AGENTS.md

This file provides guidance to AI Agents when working with code in this repository.
These instructions guide you to focus on project-specific architecture and commands rather than generic development advice, and to base the content on actual analysis of the codebase rather than assumptions.

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
- `bun run cli:ask` - Run CLI in ask mode (convenience script).
- `bun run cli:serve` - Run CLI in serve mode (convenience script).
- `bun run cli:open` - Run CLI in open mode (convenience script).

### Testing
- `bun test` - Run all tests (in `tests/`, uses `bun:test`).
- `bun test <file>` - Run a single test file (e.g., `bun test tests/basic.test.ts`).

### Build Artifacts
- `bun run build:targets` - Build cross-platform binaries using Bun.
- `bun run setup:platforms` - Install dependencies for all target platforms.
- `bun run build:artifacts` - Full build pipeline for all platforms.
- `bun run prepublishOnly` - Pre-publish build (runs `build:artifacts`).

### Other
- `btca config repos clear` - Clear downloaded repositories (useful for testing).

## Code Style

- **Runtime**: Bun only. No Node.js, npm, pnpm, vite, dotenv.
- **TypeScript**: Strict mode enabled. ESNext target.

- **Imports**: External packages first, then local. Use `.ts` extensions for local imports.
- **Bun APIs**: Prefer `Bun.file`, `Bun.serve`, `bun:sqlite`, `Bun.$` over Node equivalents.
- **Testing**: Use `bun:test` with `import { test, expect } from "bun:test"`.

## Error Handling

- Use typed error classes and custom error types defined in `src/lib/errors.ts`.
- Use try/catch with specific error types for recoverable errors.
- Use proper error propagation through service layers.

## Architecture

### Project Structure
- `src/`: Core CLI app (TypeScript + Bun), handles btca commands via services (ConfigService for settings, OcService for OpenCode SDK integration, ValidationService for config checks).
- `src/services/`: Main business logic layer with CLI, OpenCode SDK integration, and configuration management.
- `src/lib/event/`: Event-driven processing system with handlers, processors, and stream management.
- `src/lib/utils/`: Utility functions for file operations, fuzzy matching, git operations, logging, and type guards.
- `src/lib/types/`: TypeScript type definitions for SDK events and responses.
- `tests/`: Comprehensive test suite covering basic functionality, config validation, error handling, event processing, performance, resource cleanup, and type safety.

### Data Flow for btca Commands
1. CLI validates tech/repo, checks response cache (10-min TTL).
2. Lazily clones/updates GitHub repos locally (30-min cache).
3. Reuses pooled OpenCode sessions (15-min window) or creates new ones.
4. Streams AI responses through event-driven pipeline (EventProcessor with backpressure, 1000 events/sec rate limit).
5. Outputs via MessageEventHandler; caches responses.

### Key Patterns
- **Event-Driven**: Streaming with handlers (MessageEventHandler for output, SessionEventHandler for lifecycle, ToolEventHandler for tool calls).
- **Resource Pooling**: Sessions/instances pooled with timeouts; async queuing for limits (max 50 queued requests, 30-sec timeout).
- **Session Coordination**: Manages concurrent sessions per tech (max 5) and total sessions (max 20) with automatic cleanup.
- **Caching**: Multi-level (responses: 10-min TTL, repos: 30-min, validation: 5-min) with auto-cleanup and metrics.
- **Type Safety**: Extensive guards for SDK events; fail-open for network issues.
- **Retry Logic**: Exponential backoff for transient failures (network, timeouts, port exhaustion).

### Performance Features
- Session reuse with directory validation to ensure correct repo context.
- Parallel event handling (up to 20 concurrent handlers, 1000 events/sec rate limit).
- Response caching with hit rate metrics and automatic cleanup.
- Repository smart updates to avoid unnecessary git operations.
- Resource pool queuing with graceful degradation under load.
- Comprehensive metrics for cache hit rates, pool utilization, session counts, and event processing throughput.

### Session Management
- **Session Pool**: Reuses active sessions within 15-minute windows for same-tech queries.
- **Resource Pool**: Pools OpenCode instances with configurable limits (3 per tech, 10 total, 30-min timeout).
- **Session Coordinator**: Coordinates session lifecycle, enforces limits, and handles cleanup.
- **Automatic Cleanup**: Stale sessions, orphaned processes, and expired cache entries are cleaned up automatically.

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