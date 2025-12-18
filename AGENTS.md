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

### High-Level Architecture
btca is an **event-driven CLI** that integrates with the OpenCode SDK to provide AI-powered code analysis. The system is designed around **resource pooling** and **efficient session management**.

### Core Components
- **CLI Service** (`src/services/cli.ts`): Entry point and command routing
- **ConfigService** (`src/services/config.ts`): Configuration and repository management
- **OcService** (`src/services/oc.ts`): OpenCode SDK integration and session management
- **Event System** (`src/lib/event/`): Event-driven processing pipeline with typed handlers

### Data Flow Architecture
1. **CLI Layer**: Validates input, delegates to OcService
2. **OcService Layer**: Manages OpenCode instances, creates sessions, streams events
3. **Event Processing Layer**: Routes events through typed handlers, handles AI responses and tool calls
4. **Handler Layer**: Specialized handlers for different event types (messages, tools, sessions, permissions)

### Key Architectural Patterns
- **Event-Driven Architecture**: All communication happens through typed event handlers
- **Resource Pooling**: OpenCode instances and sessions are pooled for efficiency
- **Multi-Level Caching**: Responses, repositories, and validation with different TTLs
- **Graceful Degradation**: Queue-based resource management under load

### Session Management System
btca implements sophisticated session management to optimize performance:

- **Session Pool**: 15-minute reuse windows for same-tech queries
- **Resource Pool**: OpenCode instance pooling (3 per tech, 10 total, 30-min timeout)
- **Session Coordinator**: Lifecycle management, limit enforcement, automatic cleanup
- **Queue System**: Graceful handling of concurrent request limits (max 50 queued)

### Event Processing Pipeline
The event system handles multiple event types through specialized handlers:

- **Message Events**: AI responses and streaming content
- **Tool Events**: Tool execution, completion, and errors
- **Session Events**: Lifecycle, status changes, errors
- **Permission Events**: Permission requests and approvals
- **Server Events**: Connection health and heartbeats

## Configuration Management

### Configuration File
- **Location**: `~/.config/btca/btca.json`
- **Content**: Repository list, model/provider settings, performance options
- **Validation**: Startup validation with fail-open for network issues

### Configuration Commands
```bash
# View current model
btca config model

# Update provider/model
btca config model --provider openai --model gpt-4

# Manage repositories
btca config repos list
btca config repos add --name react --url https://github.com/facebook/react
btca config repos remove --name react
btca config repos clear
```

### Repository Management
- **Smart Caching**: 15-minute validation cache, 30-minute repository cache
- **Lazy Operations**: Repositories cloned/updated only when needed
- **Conflict Resolution**: Automatic port allocation with retry logic
- **Git Integration**: Proper repository state management

## Performance and Reliability

### Multi-Level Caching System
- **Response Cache**: 10-minute TTL for identical questions
- **Repository Cache**: 30-minute TTL for cloned repositories
- **Validation Cache**: 5-minute TTL for configuration validation

### Error Handling Strategy
- **Typed Exceptions**: Custom error classes in `src/lib/errors.ts`
- **Specific Recovery**: Different strategies for different error types
- **Fail-Open Policy**: Network issues don't prevent startup
- **Exponential Backoff**: Retry logic for transient failures
- **Graceful Shutdown**: Cleanup of all resources on exit

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