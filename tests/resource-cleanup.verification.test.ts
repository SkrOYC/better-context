import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { ConfigService } from '../src/services/config.ts';
import { OcService, SessionCoordinator, ResourcePool } from '../src/services/oc.ts';

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

// Mock logger
mock.module('../src/lib/utils/logger.ts', () => ({
  logger: {
    resource: () => Promise.resolve(),
    metrics: () => Promise.resolve(),
    info: () => Promise.resolve(),
    error: () => Promise.resolve(),
    warn: () => Promise.resolve(),
    debug: () => Promise.resolve()
  }
}));

describe('Resource Cleanup Verification', () => {
  let ocService: OcService;
  let config: ConfigService;

  beforeEach(() => {
    config = new ConfigService();
    (config as any).config = {
      reposDirectory: '/tmp/test',
      repos: [{ name: 'test-tech', url: 'http://example.com', branch: 'main' }],
      model: 'test',
      provider: 'test',
      sessionTimeoutMinutes: 0.01, // Very short timeout for testing
      maxRetries: 3,
      baseBackoffMs: 1000,
      maxBackoffMs: 30000,
      maxInstancesPerTech: 3,
      maxTotalInstances: 5,
      maxConcurrentSessionsPerTech: 2,
      maxTotalSessions: 4
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
    // Create mock sessions using the coordinator
    const coordinator = (ocService as any).sessionCoordinator;
    const mockSessionId1 = 'mock-session-1';
    const mockSessionId2 = 'mock-session-2';

    // Register sessions with coordinator
    coordinator.registerSession({
      sessionId: mockSessionId1,
      tech: 'test-tech',
      client: { session: { create: () => {} }, event: { subscribe: () => ({ stream: [] }) } },
      server: { close: () => {} },
      createdAt: new Date(),
      lastActivity: new Date()
    });

    coordinator.registerSession({
      sessionId: mockSessionId2,
      tech: 'test-tech',
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
    // Create mock session using the coordinator
    const coordinator = (ocService as any).sessionCoordinator;
    const mockSessionId = 'mock-session';

    coordinator.registerSession({
      sessionId: mockSessionId,
      tech: 'test-tech',
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

  it('should provide resource pool metrics', () => {
    const metrics = ocService.getMetrics();
    expect(metrics).toHaveProperty('resourcePool');
    expect(metrics.resourcePool).toHaveProperty('totalInstances');
    expect(metrics.resourcePool).toHaveProperty('activeInstances');
    expect(metrics.resourcePool).toHaveProperty('availableInstances');
    expect(metrics.resourcePool).toHaveProperty('instancesByTech');
  });

  it('should provide session coordinator metrics', () => {
    const metrics = ocService.getMetrics();
    expect(metrics).toHaveProperty('sessionCoordinator');
    expect(metrics.sessionCoordinator).toHaveProperty('totalSessions');
    expect(metrics.sessionCoordinator).toHaveProperty('activeSessions');
    expect(metrics.sessionCoordinator).toHaveProperty('sessionsByTech');
    expect(metrics.sessionCoordinator).toHaveProperty('maxConcurrentSessionsPerTech');
    expect(metrics.sessionCoordinator).toHaveProperty('maxTotalSessions');
  });

  it('should enforce session limits', async () => {
    // Create a fresh coordinator and pool instance for this test to avoid interference
    const freshPool = new ResourcePool(3, 10);
    const freshCoordinator = new SessionCoordinator(freshPool, 4, 4); // Allow 4 concurrent per tech, 4 total

    // Debug: Check initial state
    expect(freshCoordinator.getCoordinatorMetrics().totalSessions).toBe(0);

    // Test total session limit
    for (let i = 0; i < 4; i++) {
      const canCreate = freshCoordinator.canCreateSession('test-tech');
      expect(canCreate.allowed).toBe(true);
      // Simulate session creation
      freshCoordinator.registerSession({
        sessionId: `session-${i}`,
        tech: 'test-tech',
        client: {} as any,
        server: {} as any,
        createdAt: new Date(),
        lastActivity: new Date()
      });
    }

    // Should not allow 5th session
    const canCreate5th = freshCoordinator.canCreateSession('test-tech');
    expect(canCreate5th.allowed).toBe(false);
    expect(canCreate5th.reason).toContain('Maximum total sessions');
  });

  it('should enforce per-tech session limits', () => {
    // Create a fresh coordinator instance for this test
    const freshPool = new ResourcePool(3, 10);
    const freshCoordinator = new SessionCoordinator(freshPool, 2, 10);

    // Create 2 sessions for test-tech (should be allowed)
    for (let i = 0; i < 2; i++) {
      freshCoordinator.registerSession({
        sessionId: `session-test-${i}`,
        tech: 'test-tech',
        client: {} as any,
        server: {} as any,
        createdAt: new Date(),
        lastActivity: new Date()
      });
    }

    // 3rd session for same tech should not be allowed
    const canCreate3rd = freshCoordinator.canCreateSession('test-tech');
    expect(canCreate3rd.allowed).toBe(false);
    expect(canCreate3rd.reason).toContain('Maximum concurrent sessions');
  });

  it('should handle resource pool instance sharing', () => {
    const pool = (ocService as any).resourcePool;

    // Initially pool should be empty
    expect(pool.getPoolMetrics().totalInstances).toBe(0);

    // Simulate acquiring instances
    const mockInstance = {
      client: { test: 'client' },
      server: { close: () => {}, url: 'http://localhost:3420' },
      tech: 'test-tech',
      createdAt: new Date(),
      lastUsed: new Date(),
      inUse: true,
      sessionCount: 1
    };

    pool.pool.set('test-tech', [mockInstance]);

    const metrics = pool.getPoolMetrics();
    expect(metrics.totalInstances).toBe(1);
    expect(metrics.activeInstances).toBe(1);
    expect(metrics.availableInstances).toBe(0);
    expect(metrics.instancesByTech['test-tech']).toBe(1);

    // Release instance
    pool.releaseInstance('test-tech', mockInstance.client);
    expect(pool.getPoolMetrics().activeInstances).toBe(0);
    expect(pool.getPoolMetrics().availableInstances).toBe(1);
  });

  it('should handle stale session cleanup', () => {
    const coordinator = (ocService as any).sessionCoordinator;

    // Add a stale session (last activity 2 hours ago)
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    coordinator.registerSession({
      sessionId: 'stale-session',
      tech: 'test-tech',
      client: {} as any,
      server: {} as any,
      createdAt: twoHoursAgo,
      lastActivity: twoHoursAgo
    });

    // Should find stale sessions
    const staleSessions = coordinator.getStaleSessions(60 * 60 * 1000); // 1 hour timeout
    expect(staleSessions).toContain('stale-session');
  });

  it('should properly shutdown resources', async () => {
    // Add some mock sessions
    const coordinator = (ocService as any).sessionCoordinator;
    coordinator.registerSession({
      sessionId: 'shutdown-test',
      tech: 'test-tech',
      client: { test: 'client' }, // Give it a proper client object
      server: { close: () => {} },
      createdAt: new Date(),
      lastActivity: new Date()
    });

    // Shutdown should succeed without errors
    try {
      await ocService.shutdown();
      expect(true).toBe(true); // If we get here, shutdown succeeded
    } catch (error) {
      console.log('Shutdown error:', error);
      throw error;
    }
  });

  describe('Performance Benchmarks', () => {
    it('should demonstrate resource pooling efficiency', async () => {
      const pool = (ocService as any).resourcePool;
      const startTime = Date.now();

      // Initially pool should be empty
      expect(pool.getPoolMetrics().totalInstances).toBe(0);

      // Acquire instances up to the limit (3 per tech)
      const instance1 = await pool.acquireInstance('benchmark-tech', { test: 'config' } as any);
      const instance2 = await pool.acquireInstance('benchmark-tech', { test: 'config' } as any);
      const instance3 = await pool.acquireInstance('benchmark-tech', { test: 'config' } as any);

      // Should have created 3 instances
      expect(pool.getPoolMetrics().totalInstances).toBe(3);
      expect(pool.getPoolMetrics().activeInstances).toBe(3);

      // Release one instance
      pool.releaseInstance('benchmark-tech', instance1.client);
      expect(pool.getPoolMetrics().activeInstances).toBe(2);
      expect(pool.getPoolMetrics().availableInstances).toBe(1);

      // Acquire another instance - should reuse the released one
      const instance4 = await pool.acquireInstance('benchmark-tech', { test: 'config' } as any);

      // Should still have only 3 total instances (reused)
      expect(pool.getPoolMetrics().totalInstances).toBe(3);
      expect(pool.getPoolMetrics().activeInstances).toBe(3);
      expect(pool.getPoolMetrics().availableInstances).toBe(0);

      // Try to acquire a 4th instance - should fail due to limit
      await expect(pool.acquireInstance('benchmark-tech', { test: 'config' } as any))
        .rejects.toThrow('RESOURCE EXHAUSTION');

      // Clean up all instances
      pool.releaseInstance('benchmark-tech', instance2.client);
      pool.releaseInstance('benchmark-tech', instance3.client);
      pool.releaseInstance('benchmark-tech', instance4.client);

      const endTime = Date.now();
      console.log(`Resource pooling benchmark completed in ${endTime - startTime}ms`);
    });

    it('should demonstrate session coordination performance', () => {
      const coordinator = (ocService as any).sessionCoordinator;
      const startTime = Date.now();

      // Simulate rapid session registration and cleanup
      for (let i = 0; i < 10; i++) {
        coordinator.registerSession({
          sessionId: `bench-session-${i}`,
          tech: 'bench-tech',
          client: {} as any,
          server: {} as any,
          createdAt: new Date(),
          lastActivity: new Date()
        });
      }

      const endTime = Date.now();
      const metrics = coordinator.getCoordinatorMetrics();

      expect(metrics.totalSessions).toBe(10);
      expect(metrics.sessionsByTech['bench-tech']).toBe(10);

      console.log(`Session coordination benchmark completed in ${endTime - startTime}ms`);
    });

    it('should handle concurrent session limits efficiently', () => {
      const coordinator = (ocService as any).sessionCoordinator;
      const startTime = Date.now();

      // Test limit enforcement performance
      let allowedCount = 0;
      let deniedCount = 0;

      for (let i = 0; i < 10; i++) {
        const result = coordinator.canCreateSession('limit-test-tech');
        if (result.allowed) {
          allowedCount++;
          // Simulate session creation
          coordinator.registerSession({
            sessionId: `limit-session-${i}`,
            tech: 'limit-test-tech',
            client: {} as any,
            server: {} as any,
            createdAt: new Date(),
            lastActivity: new Date()
          });
        } else {
          deniedCount++;
        }
      }

      const endTime = Date.now();

      // Should allow exactly the configured limit per tech (2)
      expect(allowedCount).toBe(2);
      expect(deniedCount).toBe(8);

      console.log(`Session limit enforcement benchmark completed in ${endTime - startTime}ms`);
    });
  });
});