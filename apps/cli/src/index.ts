import { CliService } from './services/cli.ts';
import { OcService } from './services/oc.ts';
import { ConfigService } from './services/config.ts';

// Check if no arguments provided (just "btca" or "bunx btca")
const hasNoArgs = process.argv.length <= 2;

async function main() {
  try {
    const config = new ConfigService();
    await config.init();
    const oc = new OcService(config);
    const cli = new CliService(oc, config);
    const args = hasNoArgs ? ['--help'] : process.argv.slice(2);
    await cli.run(args);
    process.exit(0);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

main();