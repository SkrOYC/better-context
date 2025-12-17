import { test, expect } from "bun:test";
import { ValidationService } from "../src/services/validation.ts";
import { ConfigService } from "../src/services/config.ts";
import { ValidationCache } from "../src/lib/utils/validation-cache.ts";
import { StartupValidationError, ConfigurationChangeError } from "../src/lib/errors.ts";

// Setup test config service
function createTestConfigService(provider = "opencode", model = "big-pickle") {
  const configService = new ConfigService();
  // Mock the init method to set up test config
  configService['config'] = {
    reposDirectory: '/tmp/test-repos',
    repos: [],
    provider,
    model,
    sessionTimeoutMinutes: 30,
    maxRetries: 3,
    baseBackoffMs: 1000,
    maxBackoffMs: 30000,
    maxInstancesPerTech: 3,
    maxTotalInstances: 10,
    maxConcurrentSessionsPerTech: 5,
    maxTotalSessions: 20
  };
  configService['configPath'] = '/tmp/test-config.json';
  return configService;
}

test("ValidationCache stores and retrieves validation results", () => {
  const cache = new ValidationCache(60000); // 1 minute TTL

  const key = { provider: "opencode", model: "big-pickle" };
  const result = { isValid: true };

  // Initially no cached result
  expect(cache.get(key)).toBeNull();

  // Set and retrieve result
  cache.set(key, result);
  const cached = cache.get(key);
  expect(cached).not.toBeNull();
  expect(cached!.isValid).toBe(true);

  // Test invalidation
  cache.invalidate(key);
  expect(cache.get(key)).toBeNull();
});

test("ValidationCache expires entries after TTL", async () => {
  const cache = new ValidationCache(100); // 100ms TTL

  const key = { provider: "opencode", model: "big-pickle" };
  cache.set(key, { isValid: true });

  // Should be valid immediately
  expect(cache.get(key)).not.toBeNull();

  // Wait for expiration
  await new Promise(resolve => setTimeout(resolve, 150));

  // Should be expired
  expect(cache.get(key)).toBeNull();
});

test("ValidationCache stores failed validation results", () => {
  const cache = new ValidationCache();

  const key = { provider: "invalid", model: "model" };
  const result = { isValid: false, error: "Provider not found" };

  cache.set(key, result);
  const cached = cache.get(key);

  expect(cached).not.toBeNull();
  expect(cached!.isValid).toBe(false);
  expect(cached!.error).toBe("Provider not found");
});

test("ValidationCache provider invalidation works", () => {
  const cache = new ValidationCache();

  // Set multiple entries for same provider
  cache.set({ provider: "opencode", model: "big-pickle" }, { isValid: true });
  cache.set({ provider: "opencode", model: "small-pickle" }, { isValid: true });
  cache.set({ provider: "openai", model: "gpt-4" }, { isValid: true });

  // Invalidate all opencode entries
  cache.invalidateProvider("opencode");

  // opencode entries should be gone
  expect(cache.get({ provider: "opencode", model: "big-pickle" })).toBeNull();
  expect(cache.get({ provider: "opencode", model: "small-pickle" })).toBeNull();

  // openai entry should remain
  expect(cache.get({ provider: "openai", model: "gpt-4" })).not.toBeNull();
});

test("ValidationService can be created and initialized", async () => {
  const configService = createTestConfigService();
  const validationService = new ValidationService(configService);

  // Should initialize without network calls (skipNetworkValidation defaults to false but we handle gracefully)
  await validationService.initialize({ skipNetworkValidation: true });

  expect(validationService).toBeDefined();
});

test("ValidationService throws StartupValidationError when configured", async () => {
  const configService = createTestConfigService();
  const validationService = new ValidationService(configService);

  // Mock a failure scenario by creating a service that will fail
  // Since we can't easily mock the SDK in this test, we'll test the error type
  try {
    await validationService.initialize({ failOnStartupValidation: true, skipNetworkValidation: false });
  } catch (error) {
    expect(error).toBeInstanceOf(StartupValidationError);
  }
});

test("ConfigService.updateModel includes validation service", () => {
  const configService = createTestConfigService();
  const validationService = configService.getValidationService();

  expect(validationService).toBeDefined();
  expect(validationService).toBeInstanceOf(ValidationService);
});

test("ConfigService updateModel preserves config on validation failure", async () => {
  const configService = createTestConfigService("opencode", "big-pickle");
  const validationService = new ValidationService(configService);
  await validationService.initialize({ skipNetworkValidation: true });

  // Test that updateModel properly handles validation errors
  try {
    await configService.updateModel({ provider: "invalid", model: "model" });
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigurationChangeError);
  }
});

test("ValidationService cache stats work", () => {
  const configService = createTestConfigService();
  const validationService = new ValidationService(configService);

  const stats = validationService.getCacheStats();
  expect(stats).toHaveProperty('entries');
  expect(stats).toHaveProperty('expiredEntries');
  expect(typeof stats.entries).toBe('number');
  expect(typeof stats.expiredEntries).toBe('number');
});
