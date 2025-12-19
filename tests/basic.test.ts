import { describe, it, expect } from 'bun:test';
import { ConfigService } from '../src/services/config.ts';

describe('Basic Configuration', () => {
	it('should initialize with default values', () => {
		const config = new ConfigService();
		// Set minimal required config for testing
		(config as any).config = {
			reposDirectory: '/tmp/test',
			repos: [],
			model: 'test',
			provider: 'test',
			opencodeConfigDir: '/tmp/opencode',
			opencodeBasePort: 3420
		};

		expect(config.getReposDirectory()).toBe('/tmp/test');
		expect(config.getModel()).toEqual({ provider: 'test', model: 'test' });
		expect(config.getOpenCodeBasePort()).toBe(3420);
	});

	it('should handle custom values', () => {
		const config = new ConfigService();
		// Set minimal required config for testing
		(config as any).config = {
			reposDirectory: '/custom/path',
			repos: [],
			model: 'gpt-4',
			provider: 'openai',
			opencodeConfigDir: '/custom/opencode',
			opencodeBasePort: 4000
		};

		expect(config.getReposDirectory()).toBe('/custom/path');
		expect(config.getModel()).toEqual({ provider: 'openai', model: 'gpt-4' });
		expect(config.getOpenCodeBasePort()).toBe(4000);
	});
});
