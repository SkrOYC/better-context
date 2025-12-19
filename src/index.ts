import { CliService } from './services/cli.ts';
import { OcService } from './services/oc.ts';
import { ConfigService } from './services/config.ts';
import { logger } from './lib/utils/logger.ts';
import { createOpencode } from '@opencode-ai/sdk';

// Check if no arguments provided (just "btca" or "bunx btca")
const hasNoArgs = process.argv.length <= 2;

async function main(): Promise<void> {
  try {
    // Initialize ConfigService first
    const config = new ConfigService();
    await config.init();

    // Create OpenCode instance
    const originalConfigDir = process.env.OPENCODE_CONFIG_DIR;
    process.env.OPENCODE_CONFIG_DIR = config.getOpenCodeConfigDir();

    try {
      const openCodeInstance = await createOpencode({
        port: config.getOpenCodeBasePort()
      });
      await logger.info(`OpenCode instance created on port ${config.getOpenCodeBasePort()}`);

      // Initialize OcService
      const oc = new OcService(config, openCodeInstance);
      const cli = new CliService(oc, config);

      const args = hasNoArgs ? ['--help'] : process.argv.slice(2);
      await cli.run(args);

      openCodeInstance.server.close();
    } finally {
      // Restore environment
      if (originalConfigDir !== undefined) {
        process.env.OPENCODE_CONFIG_DIR = originalConfigDir;
      } else {
        delete process.env.OPENCODE_CONFIG_DIR;
      }
    }

    await logger.info('Application completed successfully');
  } catch (error) {
    await logger.error(`Application error: ${error}`);
    process.exit(1);
  }
}

main();
