import type { Config as OpenCodeConfig } from '@opencode-ai/sdk';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getDocsAgentPrompt } from '../lib/prompts.ts';
import { ConfigError } from '../lib/errors.ts';
import { cloneRepo, pullRepo } from '../lib/utils/git.ts';
import { directoryExists, expandHome } from '../lib/utils/files.ts';
import { logger } from '../lib/utils/logger.ts';
import { validateProviderAndModel, withTempOpenCodeClient } from '../lib/utils/validation.ts';
import { createOpencode } from '@opencode-ai/sdk';
import { StartupValidationError, ConfigurationChangeError } from '../lib/errors.ts';

const CONFIG_DIRECTORY = '~/.config/btca';
const CONFIG_FILENAME = 'btca.json';



type Repo = {
  name: string;
  url: string;
  branch: string;
  specialNotes?: string;
};

type Config = {
  reposDirectory: string;
  repos: Repo[];
  model: string;
  provider: string;
  sessionTimeoutMinutes: number;
  maxRetries: number;

  opencodeConfigDir: string;
  // Network and timing
  opencodeBasePort: number;
  opencodePortRange: number;
  requestTimeoutMs: number;
  sessionInactivityTimeoutMs: number;
  // Cache settings
  repoCacheTtlMs: number;
};

// Repository caching interfaces
export interface RepoCacheEntry {
  lastUpdated: number;
  lastChecked: number;
  ttl: number; // Time to live in milliseconds
}

export class RepositoryCache {
  private cache = new Map<string, RepoCacheEntry>();
  private defaultTtlMs: number = 15 * 60 * 1000; // 15 minutes default

  constructor(defaultTtlMs?: number) {
    if (defaultTtlMs !== undefined) {
      this.defaultTtlMs = defaultTtlMs;
    }
  }

  shouldUpdate(repoName: string): boolean {
    const entry = this.cache.get(repoName);
    if (!entry) {
      return true; // Never cached, need to update
    }

    const now = Date.now();
    const timeSinceLastCheck = now - entry.lastChecked;

    // Check if cache entry has expired (should re-check remote)
    // This covers both recent checks with expired content and stale entries
    return timeSinceLastCheck > entry.ttl;
  }

  markChecked(repoName: string): void {
    const now = Date.now();
    const entry = this.cache.get(repoName) || {
      lastUpdated: 0,
      lastChecked: now,
      ttl: this.defaultTtlMs,
    };

    entry.lastChecked = now;
    this.cache.set(repoName, entry);
  }

  markUpdated(repoName: string): void {
    const now = Date.now();
    const entry = this.cache.get(repoName) || {
      lastUpdated: now,
      lastChecked: now,
      ttl: this.defaultTtlMs,
    };

    entry.lastUpdated = now;
    entry.lastChecked = now;
    this.cache.set(repoName, entry);
  }



  clear(): void {
    this.cache.clear();
  }
}

const DEFAULT_CONFIG: Config = {
  reposDirectory: '~/.local/share/btca/repos',
  repos: [
    {
      name: 'tailwindcss',
      url: 'https://github.com/tailwindlabs/tailwindcss.com',
      branch: 'main',
      specialNotes:
        'This is the tailwindcss docs website repo, not the actual tailwindcss repo. Use the docs to answer questions about tailwindcss.'
    }
  ],
  model: 'big-pickle',
  provider: 'opencode',
  sessionTimeoutMinutes: 30,
  maxRetries: 3,

  opencodeConfigDir: '~/.config/btca/opencode',
  // Network and timing
  opencodeBasePort: 3420,
  opencodePortRange: 5, // 3420-3424
  requestTimeoutMs: 10000, // 10 seconds
  sessionInactivityTimeoutMs: 120000, // 2 minutes
   // Cache settings
   repoCacheTtlMs: 15 * 60 * 1000, // 15 minutes
};

const collapseHome = (pathStr: string): string => {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
  if (home && pathStr.startsWith(home)) {
    return '~' + pathStr.slice(home.length);
  }
  return pathStr;
};

const writeConfig = async (config: Config): Promise<void> => {
  const configDir = expandHome(CONFIG_DIRECTORY);
  const configPath = path.join(configDir, CONFIG_FILENAME);

  // Collapse expanded paths back to tilde for storage
  const configToWrite: Config = {
    ...config,
    reposDirectory: collapseHome(config.reposDirectory)
  };

  try {
    await fs.writeFile(configPath, JSON.stringify(configToWrite, null, 2));
   } catch (error) {
     throw new ConfigError("Invalid config file format", error);
   }
};

const OPENCODE_CONFIG = (args: {
  repoName: string;
  reposDirectory: string;
  specialNotes?: string;
}): OpenCodeConfig => {
  return {
    agent: {
      build: {
        disable: true
      },
      explore: {
        disable: true
      },
      general: {
        disable: true
      },
      plan: {
        disable: true
      },
      docs: {
        prompt: getDocsAgentPrompt({
          repoName: args.repoName,
          repoPath: path.join(args.reposDirectory, args.repoName),
          specialNotes: args.specialNotes ?? ''
        }),
        disable: false,
        description: 'Get answers about libraries and frameworks by searching their source code',
        permission: {
          webfetch: 'deny',
          edit: 'deny',
          bash: 'deny',
          external_directory: 'allow',
          doom_loop: 'deny'
        },
        mode: 'primary',
        tools: {
          write: false,
          bash: false,
          delete: false,
          read: true,
          grep: true,
          glob: true,
          list: true,
          path: false,
          todowrite: false,
          todoread: false,
          websearch: false
        }
      }
    }
  };
};

const onStartLoadConfig = async (): Promise<{ config: Config; configPath: string }> => {
  const configDir = expandHome(CONFIG_DIRECTORY);
  const configPath = path.join(configDir, CONFIG_FILENAME);

  try {
    const exists = await fs.stat(configPath).then(() => true).catch(() => false);

    let config: Config;
    if (!exists) {
      console.log(`Config file not found at ${configPath}, creating default config...`);
      // Ensure directory exists
      await fs.mkdir(configDir, { recursive: true });
      await fs.writeFile(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2));
      console.log(`Default config created at ${configPath}`);
      const reposDir = expandHome(DEFAULT_CONFIG.reposDirectory);
      config = {
        ...DEFAULT_CONFIG,
        reposDirectory: reposDir
      };
    } else {
      const content = await fs.readFile(configPath, 'utf-8');
      const parsed = JSON.parse(content);
      // Validate config structure
      const hasValidReposDirectory = typeof parsed.reposDirectory === 'string';
      const hasValidReposArray = Array.isArray(parsed.repos) && parsed.repos.every((r: any) =>
        r && typeof r.name === 'string' && typeof r.url === 'string' && typeof r.branch === 'string'
      );
      const hasValidModel = typeof parsed.model === 'string';
      const hasValidProvider = typeof parsed.provider === 'string';
       const hasValidSessionTimeout = parsed.sessionTimeoutMinutes === undefined ||
         (typeof parsed.sessionTimeoutMinutes === 'number' && parsed.sessionTimeoutMinutes > 0);
       const hasValidMaxRetries = parsed.maxRetries === undefined ||
         (typeof parsed.maxRetries === 'number' && parsed.maxRetries >= 0);


        const hasValidOpenCodeConfigDir = parsed.opencodeConfigDir === undefined ||
          typeof parsed.opencodeConfigDir === 'string';
        const hasValidOpenCodeBasePort = parsed.opencodeBasePort === undefined ||
          (typeof parsed.opencodeBasePort === 'number' && parsed.opencodeBasePort > 0);
        const hasValidOpenCodePortRange = parsed.opencodePortRange === undefined ||
          (typeof parsed.opencodePortRange === 'number' && parsed.opencodePortRange > 0);
        const hasValidRequestTimeout = parsed.requestTimeoutMs === undefined ||
          (typeof parsed.requestTimeoutMs === 'number' && parsed.requestTimeoutMs > 0);

        const hasValidInactivityTimeout = parsed.sessionInactivityTimeoutMs === undefined ||
          (typeof parsed.sessionInactivityTimeoutMs === 'number' && parsed.sessionInactivityTimeoutMs > 0);
        const hasValidRepoCacheTtl = parsed.repoCacheTtlMs === undefined ||
          (typeof parsed.repoCacheTtlMs === 'number' && parsed.repoCacheTtlMs > 0);


        const validationChecks = [
          hasValidReposDirectory,
          hasValidReposArray,
          hasValidModel,
          hasValidProvider,
          hasValidSessionTimeout,
          hasValidMaxRetries,

          hasValidOpenCodeConfigDir,
          hasValidOpenCodeBasePort,
          hasValidOpenCodePortRange,
          hasValidRequestTimeout,
          hasValidInactivityTimeout,
          hasValidRepoCacheTtl
        ];

        if (validationChecks.some(check => !check)) {
          throw new Error(`Config file is invalid. Ensure the following fields are correctly defined:
- \`reposDirectory\` (string)
- \`repos\` (array of objects with \`name\`, \`url\`, \`branch\`)
- \`model\` (string)
- \`provider\` (string)
- \`sessionTimeoutMinutes\` (positive number, optional)
- \`maxRetries\` (non-negative number, optional)

- \`opencodeConfigDir\` (string, optional)
- \`opencodeBasePort\` (positive number, optional)
- \`opencodePortRange\` (positive number, optional)
- \`requestTimeoutMs\` (positive number, optional)
- \`sessionInactivityTimeoutMs\` (positive number, optional)
- \`repoCacheTtlMs\` (positive number, optional)`);
        }
      const reposDir = expandHome(parsed.reposDirectory);
       config = {
         reposDirectory: reposDir,
         repos: parsed.repos,
         model: parsed.model,
         provider: parsed.provider,
         sessionTimeoutMinutes: parsed.sessionTimeoutMinutes || 30,
         maxRetries: parsed.maxRetries ?? 3,

          opencodeConfigDir: parsed.opencodeConfigDir ?? expandHome('~/.config/btca/opencode'),
          // Network and timing
          opencodeBasePort: parsed.opencodeBasePort ?? 3420,
          opencodePortRange: parsed.opencodePortRange ?? 5,
          requestTimeoutMs: parsed.requestTimeoutMs ?? 10000,
          sessionInactivityTimeoutMs: parsed.sessionInactivityTimeoutMs ?? 120000,
          // Cache settings
          repoCacheTtlMs: parsed.repoCacheTtlMs ?? (15 * 60 * 1000)
        };
    }
    // Apply environment variable overrides
    config.model = process.env.BTCA_MODEL || config.model;
    config.provider = process.env.BTCA_PROVIDER || config.provider;
    return {
      config,
      configPath
    };
   } catch (error) {
     throw new ConfigError('Failed to load config', error);
   }
};

export class ConfigService {
  private config!: Config;
  private configPath!: string;
  private repositoryCache!: RepositoryCache;

  constructor() {
  }

  async init(): Promise<void> {
    const loaded = await onStartLoadConfig();
    this.config = loaded.config;
    this.configPath = loaded.configPath;

    // Initialize repository cache with configurable TTL
    this.repositoryCache = new RepositoryCache(this.config.repoCacheTtlMs);
    await logger.info(`Config loaded from ${this.configPath}`);
  }

  getConfigPath(): string {
    return this.configPath;
  }

  async cloneOrUpdateOneRepoLocally(repoName: string, options: { suppressLogs: boolean }): Promise<Repo> {
    const repo = this.config.repos.find((repo) => repo.name === repoName);
    if (!repo) {
      throw new ConfigError('Repo not found');
    }
    const repoDir = path.join(this.config.reposDirectory, repo.name);
    const branch = repo.branch ?? 'main';
    const suppressLogs = options.suppressLogs;

    // Check if repository needs updating based on cache
    if (!this.getRepositoryCache().shouldUpdate(repoName)) {
      if (!suppressLogs) {
        console.log(`Using cached repository for ${repo.name} (recently updated)`);
      }
      await logger.info(`[CACHE] Repository cache hit for ${repo.name} - skipping update`);
      return repo;
    }

    // Mark as checked to prevent redundant checks
    this.getRepositoryCache().markChecked(repoName);

    try {
      const exists = await directoryExists(repoDir);
      if (exists) {
        if (!suppressLogs) console.log(`Pulling latest changes for ${repo.name}...`);
        await logger.info(`Pulling latest changes for ${repo.name} from ${repo.url} (branch: ${branch})`);
        await pullRepo({ repoDir, branch });
        // Mark as updated after successful pull
        this.getRepositoryCache().markUpdated(repoName);
      } else {
        if (!suppressLogs) console.log(`Cloning ${repo.name}...`);
        await logger.info(`Cloning ${repo.name} from ${repo.url} (branch: ${branch})`);
        await cloneRepo({ repoDir, url: repo.url, branch });
        // Mark as updated after successful clone
        this.getRepositoryCache().markUpdated(repoName);
      }
      if (!suppressLogs) console.log(`Done with ${repo.name}`);
      await logger.info(`${repo.name} operation completed successfully`);
    } catch (error) {
      await logger.error(`Failed to clone/update repo ${repo.name}: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
    return repo;
  }

  async getOpenCodeConfig(args: { repoName: string }): Promise<OpenCodeConfig | undefined> {
    const repo = this.config.repos.find((repo) => repo.name === args.repoName);
    return OPENCODE_CONFIG({
      repoName: args.repoName,
      reposDirectory: this.config.reposDirectory,
      ...(repo?.specialNotes && { specialNotes: repo.specialNotes })
    });
  }

  rawConfig(): Config {
    return this.config;
  }

  getRepos(): Repo[] {
    return this.config.repos;
  }

  getModel(): { provider: string; model: string } {
    return { provider: this.config.provider, model: this.config.model };
  }

  getOpenCodeConfigDir(): string {
    return expandHome(this.config.opencodeConfigDir);
  }

  async updateModel(args: { provider: string; model: string }): Promise<{ provider: string; model: string }> {
    const oldConfig = { ...this.config };
    this.config = { ...this.config, provider: args.provider, model: args.model };

    // Validate the new configuration before saving
    try {
      // Inline validation logic using helper function
      await withTempOpenCodeClient(this, async (client) => {
        await validateProviderAndModel(client, args.provider, args.model);
      });

      await writeConfig(this.config);
      await logger.info(`Model configuration updated to ${args.provider}/${args.model}`);
    } catch (error) {
      // Revert the config change on validation failure
      this.config = oldConfig;
      await logger.error(`Model configuration validation failed: ${error}`);
      throw new ConfigurationChangeError(
        `Configuration validation failed for ${args.provider}/${args.model}`,
        error
      );
    }

    return { provider: this.config.provider, model: this.config.model };
  }

  async addRepo(repo: Repo): Promise<Repo> {
    const existing = this.config.repos.find((r) => r.name === repo.name);
    if (existing) {
      throw new ConfigError(`Repo "${repo.name}" already exists`);
    }
    this.config = { ...this.config, repos: [...this.config.repos, repo] };
    await writeConfig(this.config);
    return repo;
  }

  async removeRepo(repoName: string): Promise<void> {
    const existing = this.config.repos.find((r) => r.name === repoName);
    if (!existing) {
      throw new ConfigError(`Repo "${repoName}" not found`);
    }
    this.config = { ...this.config, repos: this.config.repos.filter((r) => r.name !== repoName) };
    await writeConfig(this.config);
  }

  getReposDirectory(): string {
    return this.config.reposDirectory;
  }

  getSessionTimeout(): number {
    return this.config.sessionTimeoutMinutes;
  }

  getMaxRetries(): number {
    return this.config.maxRetries;
  }







  private getRepositoryCache(): RepositoryCache {
    if (!this.repositoryCache) {
      throw new ConfigError('ConfigService not initialized - call init() first');
    }
    return this.repositoryCache;
  }



  // Network and timing
  getOpenCodeBasePort(): number {
    return this.config.opencodeBasePort;
  }

  getOpenCodePortRange(): number {
    return this.config.opencodePortRange;
  }

  getRequestTimeoutMs(): number {
    return this.config.requestTimeoutMs;
  }

  getSessionInactivityTimeoutMs(): number {
    return this.config.sessionInactivityTimeoutMs;
  }

  // Cache settings
  getRepoCacheTtlMs(): number {
    return this.config.repoCacheTtlMs;
  }


}