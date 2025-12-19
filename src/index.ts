import { CliService } from './services/cli.ts';
import { OcService } from './services/oc.ts';
import { ConfigService } from './services/config.ts';
import { logger } from './lib/utils/logger.ts';
import { createOpencode } from '@opencode-ai/sdk';

// Check if no arguments provided (just "btca" or "bunx btca")
const hasNoArgs = process.argv.length <= 2;

let oc: OcService | null = null;
let globalOpenCodeInstance: { client: any; server: { close: () => void; url: string } } | null = null;

const shutdown = async (signal: string, exitCode: number = 0): Promise<void> => {
  try {
    await logger.info(`Received ${signal}, shutting down gracefully...`);

    // Close global OpenCode instance
    if (globalOpenCodeInstance) {
      globalOpenCodeInstance.server.close();
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
    // Initialize ConfigService first
    const config = new ConfigService();
    await config.init();

    // Create single global OpenCode instance
    const originalConfigDir = process.env.OPENCODE_CONFIG_DIR;
    process.env.OPENCODE_CONFIG_DIR = config.getOpenCodeConfigDir();

    try {
      await logger.info('Creating global OpenCode instance');
      globalOpenCodeInstance = await createOpencode({
        port: config.getOpenCodeBasePort()
      });
      await logger.info(`Global OpenCode instance created on port ${config.getOpenCodeBasePort()}`);
    } finally {
      // Restore environment
      if (originalConfigDir !== undefined) {
        process.env.OPENCODE_CONFIG_DIR = originalConfigDir;
      } else {
        delete process.env.OPENCODE_CONFIG_DIR;
      }
    }

    // Initialize OcService with global instance
    oc = new OcService(config, globalOpenCodeInstance);

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