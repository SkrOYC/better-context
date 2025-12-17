# Better Context (`btca`)

https://btca.dev

`btca` is a CLI for asking questions about libraries/frameworks by cloning their repos locally and searching the source directly.

Dev docs are in the `apps/cli` directory.

## Install

```bash
bun add -g btca
btca --help
```

## Quick commands

Ask a question:

```bash
btca ask -t svelte -q "How do stores work in Svelte 5?"
```

## Config

On first run, `btca` creates a default config at `~/.config/btca/btca.json`. That's where the repo list + model/provider live.

## Error Handling and Resilience

`btca` includes robust error handling to improve reliability:

- **Retry Logic**: Transient failures (network issues, timeouts, port conflicts) are automatically retried with exponential backoff.
- **Configuration**: Retry attempts, base delay, and max delay can be configured in `btca.json`:
  - `maxRetries`: Number of retry attempts (default: 3)
  - `baseBackoffMs`: Initial delay in milliseconds (default: 1000)
  - `maxBackoffMs`: Maximum delay cap (default: 30000)
- **Error Classification**: Errors are classified as retryable or non-retryable to avoid wasting time on permanent failures.
- **Port Management**: Increased port exhaustion handling (up to 10 attempts) for better resource allocation.
- **Session Consistency**: Proper cleanup ensures sessions don't leave inconsistent states.

If you encounter persistent errors, check your network connection, provider credentials, or configuration.
