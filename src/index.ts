import { CliService } from './services/cli.ts';
import { OcService } from './services/oc.ts';
import { ConfigService } from './services/config.ts';
import { logger } from './lib/utils/logger.ts';
import { createOpencode } from '@opencode-ai/sdk';
import { validateProviderAndModel } from './lib/utils/validation.ts';
import { StartupValidationError } from './lib/errors.ts';

// Check if no arguments provided (just "btca" or "bunx btca")
const hasNoArgs = process.argv.length <= 2;

let oc: OcService | null = null;

const shutdown = async (signal: string, exitCode: number = 0): Promise<void> => {
  try {
    await logger.info(`Received ${signal}, shutting down gracefully...`);

    await logger.info('Shutdown complete');
  } catch (error) {
    await logger.error(`Error during shutdown: ${error}`);
  }
  process.exit(exitCode);
};

function setupGracefulShutdown(): void {
  // Register shutdown handlers
  process.on('SIGINT', () => { shutdown('SIGINT'); });
  process.on('SIGTERM', () => { shutdown('SIGTERM'); });
  process.on('SIGUSR2', () => { shutdown('SIGUSR2'); }); // nodemon restart
}

async function main(): Promise<void> {
  try {
    // Initialize ConfigService first (without validation)
    const config = new ConfigService();
    await config.init();

    // Inline startup validation
    try {
      const { provider, model } = config.getModel();
      await logger.info(`Performing startup validation for ${provider}/${model}`);

      // Set btca-specific OpenCode config directory for validation
      const originalConfigDir = process.env.OPENCODE_CONFIG_DIR;
      process.env.OPENCODE_CONFIG_DIR = config.getOpenCodeConfigDir();

      try {
        // Create temporary OpenCode instance for validation
        const { client, server } = await createOpencode({
          port: 0, // Use random available port
          timeout: config.getRequestTimeoutMs() // Configurable timeout
        });

        try {
          // Validate the configured provider/model combination
          await validateProviderAndModel(client, provider, model);
          await logger.info('Startup validation completed successfully');
        } finally {
          // Always clean up the temporary server
          server.close();
        }
      } finally {
        // Restore original config dir
        if (originalConfigDir !== undefined) {
          process.env.OPENCODE_CONFIG_DIR = originalConfigDir;
        } else {
          delete process.env.OPENCODE_CONFIG_DIR;
        }
      }
    } catch (error) {
      await logger.error(`Startup validation failed: ${error}`);

      // Continue with invalid configuration due to fail-open policy
      await logger.warn('Continuing with invalid configuration due to fail-open policy');
    }

    // Initialize OcService
    oc = new OcService(config);

    // Setup graceful shutdown handlers
    setupGracefulShutdown();

    const cli = new CliService(oc, config);
    const args = hasNoArgs ? ['--help'] : process.argv.slice(2);
    await cli.run(args);

    await shutdown('normal', 0);
  } catch (error) {
    await logger.error(`Application error: ${error}`);
    await shutdown('error', 1);
  }
}

main();