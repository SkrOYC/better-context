
import { describe, it, expect, mock, spyOn, afterEach } from 'bun:test';
import { OcService } from '../src/services/oc.ts';
import { ConfigService } from '../src/services/config.ts';
import { OcError } from '../src/lib/errors.ts';
import { MockOpencodeClient } from './utils/timeout-test-utils.ts';

// Mock logger
const mockLogger = {
  info: mock(() => Promise.resolve()),
  error: mock(() => Promise.resolve()),
  warn: mock(() => Promise.resolve()),
  debug: mock(() => Promise.resolve())
};

mock.module('../src/lib/utils/logger.ts', () => ({
  logger: mockLogger
}));

describe('Timeout Logic', () => {
// Setup mocks
  const mockConfigService = new ConfigService();
  
  // Manually set config to avoid crashes (Bun spyOn might let original method run if not fully mocked or on failure)
  (mockConfigService as any).config = {
    repos: [{ name: 'test-tech', path: '/tmp/test' }],
    reposDirectory: '/tmp/repos',
    opencodeConfigDir: '/tmp/config',
    provider: 'test-provider',
    model: 'test-model',
    opencodeBasePort: 3000,
    requestTimeoutMs: 100, // Short timeout for test
    sessionInactivityTimeoutMs: 100, // Short timeout for test
    repoCacheTtlMs: 1000
  };

  // Manual mocks on instance because spyOn seems to be failing integration sometimes
  mockConfigService.getOpenCodeConfig = mock(async () => undefined);
  mockConfigService.getRepos = mock(() => [{ name: 'test-tech', path: '/tmp/test', url: 'http://test', branch: 'main' }]);
  mockConfigService.getOpenCodeBasePort = mock(() => 3000);
  mockConfigService.getOpenCodeConfigDir = mock(() => '/tmp/config');
  mockConfigService.getReposDirectory = mock(() => '/tmp/repos');
  // @ts-ignore
  mockConfigService.rawConfig = mock(() => ({ provider: 'test-provider', model: 'test-model' }));
  mockConfigService.cloneOrUpdateOneRepoLocally = mock(async () => ({ name: 'test-tech', url: 'http://test', branch: 'main' } as any));
  
  // Timeout settings - SHORT TIMEOUT for testing
  mockConfigService.getRequestTimeoutMs = mock(() => 100);
  mockConfigService.getSessionInactivityTimeoutMs = mock(() => 100);

  // Mock global OpenCode instance
  const mockOpenCodeInstance = { 
    client: new MockOpencodeClient(null as any) as any,
    server: { 
      url: 'http://localhost:3000', 
      close: mock(() => {}) 
    } 
  };

  // Create service with single instance
  const ocService = new OcService(mockConfigService as any, mockOpenCodeInstance);

  // Helper to replace the getOpencodeInstanceWithKey method (private)
  const setupMockClient = (events: AsyncGenerator<any, void, unknown>) => {
    const mockClient = new MockOpencodeClient(events);
    // @ts-ignore - overriding private method
    ocService.createDirectoryClient = mock(async () => mockClient as any);
    return mockClient;
  };

  afterEach(() => {
    mock.restore();
  });

  it('should timeout if no events are received within timeout period', async () => {
    const TEST_TIMEOUT_MS = 100;
    //Generator that never yields but waits forever (or until closed)
    async function* silentGenerator() {
      await new Promise(resolve => setTimeout(resolve, TEST_TIMEOUT_MS * 2));
    }

    setupMockClient(silentGenerator());

    try {
      await ocService.askQuestion({ question: 'test', tech: 'test-tech' });
      throw new Error('Should have timed out');
    } catch (error: any) {
      expect(error).toBeInstanceOf(OcError);
      expect(error.message).toContain('Session timed out');
      expect(error.message).toContain('inactivity');
    }
  });

  it('should NOT timeout if events arrive frequently enough', async () => {
    const TEST_TIMEOUT_MS = 100;
    // Generator that yields events faster than timeout
    async function* activeGenerator() {
      // Send 3 events, each arriving before timeout
      for (let i = 0; i < 3; i++) {
        await new Promise(resolve => setTimeout(resolve, TEST_TIMEOUT_MS * 0.5));
        yield { 
          type: 'aa_session_event_user_message', 
          properties: { sessionID: 'mock-session-id', info: { id: `msg-${i}` } } 
        };
      }
      // Send completion event
      yield { 
        type: 'aa_session_event_status_change', 
        properties: { sessionID: 'mock-session-id', status: 'idle' } 
      };
    }

    setupMockClient(activeGenerator());

    await ocService.askQuestion({ question: 'test', tech: 'test-tech' });
    // Should complete successfully without error
  });

  it('should NOT timeout if heartbeats (onSseEvent) are received', async () => {
    const TEST_TIMEOUT_MS = 100;
    // Generator that waits long but we'll simulate heartbeats manually via the client callback
    async function* slowGenerator() {
       // Wait slightly longer than timeout, but we expect heartbeats to keep it alive
       await new Promise(resolve => setTimeout(resolve, TEST_TIMEOUT_MS * 1.5));
       yield { 
         type: 'aa_session_event_status_change', 
         properties: { sessionID: 'mock-session-id', status: 'idle' } 
       };
    }

    const client = setupMockClient(slowGenerator());

    // Start background heartbeats
    const heartbeatInterval = setInterval(() => {
      client.simulateHeartbeat();
    }, TEST_TIMEOUT_MS * 0.5);

    try {
      await ocService.askQuestion({ question: 'test', tech: 'test-tech' });
    } finally {
      clearInterval(heartbeatInterval);
    }
    // Should complete successfully because heartbeats kept it alive
  });
});
