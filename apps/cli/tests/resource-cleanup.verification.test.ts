import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { ConfigService } from '../src/services/config.ts';
import { OcService } from '../src/services/oc.ts';

// Mock the @opencode-ai/sdk module
mock.module('@opencode-ai/sdk', () => ({
  createOpencode: () => ({
    client: {
      session: {
        create: () => ({ data: { id: 'mock-session-id' } }),
        prompt: () => Promise.resolve()
      },
      event: {
        subscribe: () => ({ stream: [] })
      }
    },
    server: {
      close: () => {},
      url: 'http://localhost:3420'
    }
  })
}));

describe('Resource Cleanup Verification', () => {
  let ocService: OcService;
  let config: ConfigService;

  beforeEach(() => {
    config = new ConfigService();
    (config as any).config = {
      reposDirectory: '/tmp/test',
      repos: [{ name: 'test-tech', remoteUrl: 'http://example.com' }],
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

  it('should handle graceful shutdown', async () => {
    // Mock session creation by directly manipulating the sessions map
    const mockSessionId1 = 'mock-session-1';
    const mockSessionId2 = 'mock-session-2';

    // Simulate session creation without calling initSession (to avoid SDK calls)
    (ocService as any).sessions.set(mockSessionId1, {
      client: { session: { create: () => {} }, event: { subscribe: () => ({ stream: [] }) } },
      server: { close: () => {} },
      createdAt: new Date(),
      lastActivity: new Date()
    });

    (ocService as any).sessions.set(mockSessionId2, {
      client: { session: { create: () => {} }, event: { subscribe: () => ({ stream: [] }) } },
      server: { close: () => {} },
      createdAt: new Date(),
      lastActivity: new Date()
    });

    expect(ocService.getMetrics().currentSessionCount).toBe(2);

    // Simulate cleanup (this would happen in graceful shutdown)
    await ocService.cleanupAllSessions();

    const metrics = ocService.getMetrics();
    expect(metrics.currentSessionCount).toBe(0);
    expect(metrics.sessionsCleanedUp).toBe(2);
  });

  it('should handle manual session cleanup', async () => {
    // Mock a session by directly manipulating the sessions map
    const mockSessionId = 'mock-session';

    (ocService as any).sessions.set(mockSessionId, {
      client: { session: { create: () => {} }, event: { subscribe: () => ({ stream: [] }) } },
      server: { close: () => {} },
      createdAt: new Date(),
      lastActivity: new Date()
    });

    // Manually close session
    await ocService.closeSession(mockSessionId);

    const metrics = ocService.getMetrics();
    expect(metrics.sessionsCleanedUp).toBeGreaterThan(0);
    expect(metrics.currentSessionCount).toBe(0);
  });
});