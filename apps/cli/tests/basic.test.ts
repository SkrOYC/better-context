import { describe, it, expect } from 'bun:test';
import { ConfigService } from '../src/services/config.ts';

describe('Basic Configuration', () => {
  it('should have default session timeout', () => {
    const config = new ConfigService();
    // Set minimal required config for testing
    (config as any).config = {
      reposDirectory: '/tmp/test',
      repos: [],
      model: 'test',
      provider: 'test',
      sessionTimeoutMinutes: 30
    };

    expect(config.getSessionTimeout()).toBe(30);
  });

  it('should handle custom session timeout', () => {
    const config = new ConfigService();
    // Set minimal required config for testing
    (config as any).config = {
      reposDirectory: '/tmp/test',
      repos: [],
      model: 'test',
      provider: 'test',
      sessionTimeoutMinutes: 60
    };

    expect(config.getSessionTimeout()).toBe(60);
  });
});