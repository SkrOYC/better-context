import { CliService } from './services/cli.ts';
import { OcService } from './services/oc.ts';
import { ConfigService } from './services/config.ts';
import { logger } from './lib/utils/logger.ts';

// Check if no arguments provided (just "btca" or "bunx btca")
const hasNoArgs = process.argv.length <= 2;

let oc: OcService | null = null;

const shutdown = async (signal: string, exitCode: number = 0): Promise<void> => {
  try {
    await logger.info(`Received ${signal}, shutting down gracefully...`);
    if (oc) {
      await oc.cleanupAllSessions();
      await oc.cleanupOrphanedProcesses();
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

async function main(): Promise<never> {
  try {
    const config = new ConfigService();
    await config.init();
    oc = new OcService(config);

    // Setup graceful shutdown handlers
    setupGracefulShutdown();

    // Cleanup orphaned processes on startup
    await oc.cleanupOrphanedProcesses();

    const cli = new CliService(oc, config);
    const args = hasNoArgs ? ['--help'] : process.argv.slice(2);
    await cli.run(args);

    await shutdown('normal', 0);
    process.exit(0);
  } catch (error) {
    await logger.error(`Application error: ${error}`);
    await shutdown('error', 1);
    process.exit(1);
  }
}

main();