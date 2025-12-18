# Better Context (`btca`)

https://btca.dev

`btca` is a CLI for asking questions about libraries/frameworks by cloning their repos locally and searching the source directly.

Dev docs are in the `src/` directory.

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
- **Configuration Validation**: Settings are validated at startup to catch issues early
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

- **Port Management**: Automatic port allocation for OpenCode instances with conflict resolution.
- **Session Consistency**: Clean session lifecycle management to prevent resource leaks.

### Configuration Validation Errors

The validation system provides clear error messages for configuration issues:

- **StartupValidationError**: Occurs when configuration validation fails during application startup. The application will continue with a fail-open policy for network issues.
- **ConfigurationChangeError**: Occurs when attempting to apply invalid configuration changes. The configuration is reverted to the previous valid state.

If you encounter persistent errors, check your network connection, provider credentials, or configuration. For validation errors, ensure your provider and model settings are correct and that your provider credentials are properly configured.

## Repository Management

`btca` efficiently manages technology repositories for optimal performance:

### Repository Caching
- **Smart Update Detection**: Repository clone/pull operations are cached for 15 minutes
- **Reduced I/O**: Avoids unnecessary git operations when repositories are recently updated
- **Background Updates**: Repository updates happen only when needed, not on every question

This optimization provides faster response times and better resource utilization.
