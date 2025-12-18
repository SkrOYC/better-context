import { createOpencode, type OpencodeClient } from '@opencode-ai/sdk';
import { ConfigService } from './config.ts';
import { validateProviderAndModel } from '../lib/utils/validation.ts';

import { logger } from '../lib/utils/logger.ts';
import { StartupValidationError, ConfigurationChangeError } from '../lib/errors.ts';

export interface ValidationConfig {
  failOnStartupValidation?: boolean;
  skipNetworkValidation?: boolean;
}

export class ValidationService {
  private configService: ConfigService;
  private isInitialized = false;

  constructor(configService: ConfigService) {
    this.configService = configService;
  }

  async initialize(options: ValidationConfig = {}): Promise<void> {
    if (this.isInitialized) return;

    await logger.info('Initializing ValidationService');

    try {
      await this.performStartupValidation(options);
      this.isInitialized = true;
      await logger.info('ValidationService initialized successfully');
    } catch (error) {
      await logger.error(`ValidationService initialization failed: ${error}`);

      if (options.failOnStartupValidation) {
        throw new StartupValidationError('Configuration validation failed during startup', error);
      } else {
        await logger.warn('Continuing with invalid configuration due to fail-open policy');
      }
    }
  }

  private async performStartupValidation(options: ValidationConfig): Promise<void> {
    if (options.skipNetworkValidation) {
      await logger.info('Skipping network validation during startup');
      return;
    }

    const { provider, model } = this.configService.getModel();

    await logger.info(`Performing startup validation for ${provider}/${model}`);

    try {
      // Set btca-specific OpenCode config directory for validation
      const originalConfigDir = process.env.OPENCODE_CONFIG_DIR;
      process.env.OPENCODE_CONFIG_DIR = this.configService.getOpenCodeConfigDir();

      try {
        // Create temporary OpenCode instance for validation
        const { client, server } = await createOpencode({
          port: 0, // Use random available port
          timeout: this.configService.getRequestTimeoutMs() // Configurable timeout
        });

        try {
          // Validate the configured provider/model combination
          await this.validateProviderAndModel(client, provider, model);
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
      throw error;
    }
  }

  async validateProviderAndModel(
    client: OpencodeClient,
    provider: string,
    model: string
  ): Promise<void> {
    // Perform validation without caching
    await validateProviderAndModel(client, provider, model);
    await logger.debug(`Validation successful for ${provider}/${model}`);
  }

  async validateCurrentConfig(): Promise<void> {
    const { provider, model } = this.configService.getModel();

    try {
      // Set btca-specific OpenCode config directory for validation
      const originalConfigDir = process.env.OPENCODE_CONFIG_DIR;
      process.env.OPENCODE_CONFIG_DIR = this.configService.getOpenCodeConfigDir();

      try {
        // Create temporary OpenCode instance for validation
        const { client, server } = await createOpencode({
          port: 0,
          timeout: 10000
        });

        try {
          await this.validateProviderAndModel(client, provider, model);
        } finally {
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
      throw new ConfigurationChangeError(
        `Configuration validation failed for ${provider}/${model}`,
        error
      );
    }
  }



  async shutdown(): Promise<void> {
    // No special cleanup needed for validation service
    await logger.debug('ValidationService shutdown complete');
  }
}
