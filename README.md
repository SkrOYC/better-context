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

### Configuration Validation

`btca` includes a robust configuration validation system that ensures your settings are correct:

- **Startup Validation**: Configuration is validated when the application starts, catching issues early instead of at runtime
- **Validation Caching**: Successful validations are cached for 5 minutes to improve performance by avoiding repeated API calls
- **Dynamic Updates**: Configuration changes are validated before being applied, allowing updates without restarting the application
- **Fail-Open Policy**: Network issues during validation won't prevent startup, ensuring the application remains usable

### Managing Configuration

Use the `btca config` commands to manage your settings:

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

### Configuration Validation Errors

The validation system provides clear error messages for configuration issues:

- **StartupValidationError**: Occurs when configuration validation fails during application startup. The application will continue with a fail-open policy for network issues.
- **ConfigurationChangeError**: Occurs when attempting to apply invalid configuration changes. The configuration is reverted to the previous valid state.

If you encounter persistent errors, check your network connection, provider credentials, or configuration. For validation errors, ensure your provider and model settings are correct and that your provider credentials are properly configured.
