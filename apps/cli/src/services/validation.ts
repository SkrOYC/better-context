import { createOpencode } from '@opencode-ai/sdk';
import { ConfigService } from './config.ts';
import { validateProviderAndModel } from '../lib/utils/validation.ts';
import { ValidationCache, validationCache, type ValidationKey } from '../lib/utils/validation-cache.ts';
import { logger } from '../lib/utils/logger.ts';
import { StartupValidationError, ConfigurationChangeError } from '../lib/errors.ts';

export interface ValidationConfig {
  failOnStartupValidation?: boolean;
  skipNetworkValidation?: boolean;
}

export class ValidationService {
  private configService: ConfigService;
  private cache: ValidationCache;
  private isInitialized = false;

  constructor(configService: ConfigService, cache: ValidationCache = validationCache) {
    this.configService = configService;
    this.cache = cache;
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
      // Create temporary OpenCode instance for validation
      const { client, server } = await createOpencode({
        port: 0, // Use random available port
        timeout: 10000 // 10 second timeout
      });

      try {
        // Validate the configured provider/model combination
        await this.validateProviderAndModelCached(client, { provider, model });
        await logger.info('Startup validation completed successfully');
      } finally {
        // Always clean up the temporary server
        server.close();
      }
    } catch (error) {
      await logger.error(`Startup validation failed: ${error}`);
      throw error;
    }
  }

  async validateProviderAndModelCached(
    client: any,
    key: ValidationKey,
    forceRefresh = false
  ): Promise<void> {
    // Check cache first unless force refresh is requested
    if (!forceRefresh) {
      const cached = this.cache.get(key);
      if (cached) {
        if (cached.isValid) {
          await logger.debug(`Using cached valid result for ${key.provider}/${key.model}`);
          return;
        } else {
          // Cached invalid result - rethrow the error
          throw new Error(cached.error || 'Cached validation failed');
        }
      }
    }

    // Perform fresh validation
    try {
      await validateProviderAndModel(client, key.provider, key.model);

      // Cache successful validation
      this.cache.set(key, { isValid: true });
      await logger.debug(`Validation successful and cached for ${key.provider}/${key.model}`);

    } catch (error) {
      // Cache failed validation (with shorter TTL for failed validations)
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.cache.set(key, { isValid: false, error: errorMessage });

      await logger.debug(`Validation failed and cached for ${key.provider}/${key.model}: ${errorMessage}`);
      throw error;
    }
  }

  async validateCurrentConfig(): Promise<void> {
    const { provider, model } = this.configService.getModel();

    try {
      // Create temporary OpenCode instance for validation
      const { client, server } = await createOpencode({
        port: 0,
        timeout: 10000
      });

      try {
        await this.validateProviderAndModelCached(client, { provider, model }, true); // Force refresh
      } finally {
        server.close();
      }
    } catch (error) {
      throw new ConfigurationChangeError(
        `Configuration validation failed for ${provider}/${model}`,
        error
      );
    }
  }

  invalidateCache(key?: ValidationKey): void {
    this.cache.invalidate(key);
    const scope = key ? `${key.provider}/${key.model}` : 'all entries';
    logger.resource(`Validation cache invalidated for ${scope}`);
  }

  invalidateProviderCache(provider: string): void {
    this.cache.invalidateProvider(provider);
    logger.resource(`Validation cache invalidated for provider ${provider}`);
  }

  getCacheStats() {
    return this.cache.getStats();
  }

  async shutdown(): Promise<void> {
    // No special cleanup needed for validation service
    await logger.debug('ValidationService shutdown complete');
  }
}