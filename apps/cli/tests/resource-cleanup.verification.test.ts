import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { ConfigService } from '../src/services/config.ts';
import { OcService } from '../src/services/oc.ts';

describe('Resource Cleanup Verification', () => {
  let ocService: OcService;
  let config: ConfigService;

  beforeEach(() => {
    config = new ConfigService();
    (config as any).config = {
      reposDirectory: '/tmp/test',
      repos: [],
      model: 'test',
      provider: 'test',
      sessionTimeoutMinutes: 0.01 // Very short timeout for testing
    };
    ocService = new OcService(config);
  });

  afterEach(async () => {
    if (ocService) {
      await ocService.cleanupAllSessions();
    }
  });

  it('should create and track sessions', async () => {
    // Create a session
    const sessionId = await ocService.initSession('test-tech');
    expect(sessionId).toBeDefined();

    // Check metrics
    let metrics = ocService.getMetrics();
    expect(metrics.sessionsCreated).toBe(1);
    expect(metrics.currentSessionCount).toBe(1);

    // Manually close session
    await ocService.closeSession(sessionId);

    // Check that session was cleaned up
    metrics = ocService.getMetrics();
    expect(metrics.sessionsCleanedUp).toBe(1);
    expect(metrics.currentSessionCount).toBe(0);
  });

  it('should provide metrics', () => {
    const metrics = ocService.getMetrics();
    expect(metrics).toHaveProperty('sessionsCreated');
    expect(metrics).toHaveProperty('sessionsCleanedUp');
    expect(metrics).toHaveProperty('orphanedProcessesCleaned');
    expect(metrics).toHaveProperty('currentSessionCount');
    expect(typeof metrics.sessionsCreated).toBe('number');
    expect(typeof metrics.sessionsCleanedUp).toBe('number');
    expect(typeof metrics.orphanedProcessesCleaned).toBe('number');
    expect(typeof metrics.currentSessionCount).toBe('number');
  });

  it('should handle manual session cleanup', async () => {
    const sessionId = await ocService.initSession('test-tech');
    expect(sessionId).toBeDefined();

    // Manually close session
    await ocService.closeSession(sessionId);

    const metrics = ocService.getMetrics();
    expect(metrics.sessionsCleanedUp).toBeGreaterThan(0);
    expect(metrics.currentSessionCount).toBe(0);
  });

  it('should handle graceful shutdown', async () => {
    const sessionId1 = await ocService.initSession('test-tech');
    const sessionId2 = await ocService.initSession('test-tech');

    expect(ocService.getMetrics().currentSessionCount).toBe(2);

    // Simulate cleanup (this would happen in graceful shutdown)
    await ocService.cleanupAllSessions();

    const metrics = ocService.getMetrics();
    expect(metrics.currentSessionCount).toBe(0);
    expect(metrics.sessionsCleanedUp).toBe(2);
  });
});