import { CliService } from './services/cli.ts';
import { OcService } from './services/oc.ts';
import { ConfigService } from './services/config.ts';
import { ServerManager } from './lib/utils/ServerManager.ts';
import { logger } from './lib/utils/logger.ts';
import { createOpencode } from '@opencode-ai/sdk';
import { validateProviderAndModel, withTempOpenCodeClient } from './lib/utils/validation.ts';
import { StartupValidationError } from './lib/errors.ts';

// Check if no arguments provided (just "btca" or "bunx btca")
const hasNoArgs = process.argv.length <= 2;

let oc: OcService | null = null;
let serverManagerInstance: ServerManager | null = null;

const shutdown = async (signal: string, exitCode: number = 0): Promise<void> => {
  try {
    await logger.info(`Received ${signal}, shutting down gracefully...`);

    // Close all servers managed by ServerManager
    if (serverManagerInstance) {
      await serverManagerInstance.closeAll();
    }

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

      await withTempOpenCodeClient(config, async (client) => {
        // Validate the configured provider/model combination
        await validateProviderAndModel(client, provider, model);
        await logger.info('Startup validation completed successfully');
      }, config.getRequestTimeoutMs());
    } catch (error) {
      await logger.error(`Startup validation failed: ${error}`);

      // Continue with invalid configuration due to fail-open policy
      await logger.warn('Continuing with invalid configuration due to fail-open policy');
    }

    // Initialize ServerManager and OcService
    serverManagerInstance = new ServerManager();
    oc = new OcService(config, serverManagerInstance);

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