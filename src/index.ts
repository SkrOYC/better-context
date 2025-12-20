import { CliService } from './services/cli.ts';
import { OcService } from './services/oc.ts';
import { ConfigService } from './services/config.ts';
import { logger } from './lib/utils/logger.ts';
import { createOpencode, OpencodeClient } from '@opencode-ai/sdk';
import { CommanderError } from 'commander';

// Global variable to hold the OpenCode server instance for cleanup
let openCodeInstance: {
	client: OpencodeClient;
	server: { close: () => void; url: string };
} | null = null;
let originalConfigDir: string | undefined;
let configService: ConfigService | null = null;

// Flag to track if cleanup has already been initiated to prevent duplicate cleanup
let cleanupInitiated = false;

// Comprehensive cleanup function
async function cleanup(exitCode?: number): Promise<void> {
	if (cleanupInitiated) {
		// Prevent duplicate cleanup attempts
		return;
	}

	cleanupInitiated = true;

	try {
		await logger.info('Initiating cleanup...');

		// Close the OpenCode server if it exists
		if (openCodeInstance) {
			await logger.info('Closing OpenCode server...');
			try {
				openCodeInstance.server.close();
				await logger.info('OpenCode server closed successfully');
			} catch (error) {
				await logger.error(`Error closing OpenCode server: ${error}`);
			}
			openCodeInstance = null;
		}

		// Restore environment variables
		if (originalConfigDir !== undefined) {
			process.env.OPENCODE_CONFIG_DIR = originalConfigDir;
			await logger.info('Environment variables restored');
		} else {
			delete process.env.OPENCODE_CONFIG_DIR;
			await logger.info('Environment variables cleaned up');
		}

		await logger.info('Cleanup completed');
	} catch (error) {
		await logger.error(`Error during cleanup: ${error}`);
	} finally {
		if (exitCode !== undefined) {
			process.exit(exitCode);
		}
	}
}

// Register signal handlers early in the process
function setupSignalHandlers(): void {
	process.on('SIGINT', async () => {
		await logger.info('Received SIGINT, shutting down gracefully...');
		await cleanup(0);
	});

	process.on('SIGTERM', async () => {
		await logger.info('Received SIGTERM, shutting down gracefully...');
		await cleanup(0);
	});

	process.on('SIGHUP', async () => {
		await logger.info('Received SIGHUP, shutting down gracefully...');
		await cleanup(0);
	});

	// Handle uncaught exceptions
	process.on('uncaughtException', async (error) => {
		await logger.error(`Uncaught exception: ${error}`);
		await cleanup(1);
	});

	// Handle unhandled promise rejections
	process.on('unhandledRejection', async (reason, promise) => {
		await logger.error(`Unhandled rejection at ${promise}, reason: ${reason}`);
		await cleanup(1);
	});
}

// Check if no arguments provided (just "btca" or "bunx btca")
const hasNoArgs = process.argv.length <= 2;

async function main(): Promise<void> {
	const startTime = Date.now();
	await logger.info(`Starting btca with args: ${process.argv.slice(2).join(' ')}`);
	logger.startTimer('application-startup');

	// Setup signal handlers immediately to catch early termination signals
	setupSignalHandlers();

	try {
		// Initialize ConfigService first
		await logger.info('Initializing ConfigService...');
		logger.startTimer('config-init');
		configService = new ConfigService();
		await configService.init();
		await logger.endTimerWithMessage('config-init', 'ConfigService initialized');

		// Store original config dir and set new one
		originalConfigDir = process.env.OPENCODE_CONFIG_DIR;
		process.env.OPENCODE_CONFIG_DIR = configService.getOpenCodeConfigDir();

		// Create OpenCode instance
		await logger.info('Creating OpenCode instance...');
		logger.startTimer('opencode-create');
		openCodeInstance = await createOpencode({
			port: configService.getOpenCodeBasePort()
		});
		await logger.endTimerWithMessage('opencode-create', `OpenCode instance created on port ${configService.getOpenCodeBasePort()}`);

		// Initialize OcService
		await logger.info('Initializing services...');
		logger.startTimer('services-init');
		const oc = new OcService(configService, openCodeInstance);
		const cli = new CliService(oc, configService);
		await logger.endTimerWithMessage('services-init', 'Services initialized');

		const args = hasNoArgs ? ['--help'] : process.argv.slice(2);
		await logger.info(`Running CLI with args: ${args.join(' ')}`);
		logger.startTimer('cli-execution');
		await cli.run(args);
		await logger.endTimerWithMessage('cli-execution', 'CLI execution completed');

		// Explicitly call cleanup at the end of normal execution
		await logger.endTimerWithMessage('application-startup', `Application completed successfully in ${Date.now() - startTime}ms`);
		await cleanup();
	} catch (error: any) {
		// Handle Commander exit overrides (help, version, etc.)
		if (error instanceof CommanderError) {
			// Commander has already printed the error/help message
			await logger.info(`Commander exit with code: ${error.exitCode}`);
			await cleanup(error.exitCode);
			return;
		}

		await logger.error(`Application error: ${error}`);
		await logger.endTimerWithMessage('application-startup', `Application failed after ${Date.now() - startTime}ms`);
		await cleanup(1);
	}
}

main();
