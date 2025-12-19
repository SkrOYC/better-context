import { describe, it, expect, mock } from 'bun:test';
import { OcService } from '../src/services/oc.ts';
import { ConfigService } from '../src/services/config.ts';
import { OcError } from '../src/lib/errors.ts';

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

describe('OcService Basic Functionality', () => {
  const mockConfigService = new ConfigService();
  
  // Manually set config to avoid crashes
  (mockConfigService as any).config = {
    repos: [{ name: 'test-tech', path: '/tmp/test' }],
    reposDirectory: '/tmp/repos',
    opencodeConfigDir: '/tmp/config',
    provider: 'test-provider',
    model: 'test-model',
    opencodeBasePort: 3000
  };

  // Manual mocks on instance
  mockConfigService.getOpenCodeConfig = mock(async () => undefined);
  mockConfigService.getRepos = mock(() => [{ name: 'test-tech', path: '/tmp/test', url: 'http://test', branch: 'main' }]);
  mockConfigService.getOpenCodeBasePort = mock(() => 3000);
  mockConfigService.getOpenCodeConfigDir = mock(() => '/tmp/config');
  mockConfigService.getReposDirectory = mock(() => '/tmp/repos');
  mockConfigService.rawConfig = mock(() => ({ provider: 'test-provider', model: 'test-model' }));
  mockConfigService.cloneOrUpdateOneRepoLocally = mock(async () => ({ name: 'test-tech', url: 'http://test', branch: 'main' } as any));

  it('should initialize OcService correctly', () => {
    const mockOpenCodeInstance = {
      client: { session: {}, event: {} },
      server: { close: mock(), url: 'http://localhost:3000' }
    };

    const ocService = new OcService(mockConfigService, mockOpenCodeInstance);
    expect(ocService).toBeDefined();
  });

  it('should handle OcError creation', () => {
    const error = new OcError('Test error', { cause: 'test cause' });
    expect(error.message).toBe('Test error');
    expect(error._tag).toBe('OcError');
  });

  
});
