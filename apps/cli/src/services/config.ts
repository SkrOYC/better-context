import type { Config as OpenCodeConfig } from '@opencode-ai/sdk';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getDocsAgentPrompt } from '../lib/prompts.ts';
import { ConfigError } from '../lib/errors.ts';
import { cloneRepo, pullRepo } from '../lib/utils/git.ts';
import { directoryExists, expandHome } from '../lib/utils/files.ts';

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
  port: number;
  maxInstances: number;
  repos: Repo[];
  model: string;
  provider: string;
};

const DEFAULT_CONFIG: Config = {
  reposDirectory: '~/.local/share/btca/repos',
  port: 3420,
  maxInstances: 5,
  repos: [
    {
      name: 'svelte',
      url: 'https://github.com/sveltejs/svelte.dev',
      branch: 'main',
      specialNotes:
        'This is the svelte docs website repo, not the actual svelte repo. Use the docs to answer questions about svelte.'
    },
    {
      name: 'tailwindcss',
      url: 'https://github.com/tailwindlabs/tailwindcss.com',
      branch: 'main',
      specialNotes:
        'This is the tailwindcss docs website repo, not the actual tailwindcss repo. Use the docs to answer questions about tailwindcss.'
    },
    {
      name: 'nextjs',
      url: 'https://github.com/vercel/next.js',
      branch: 'canary'
    }
  ],
  model: 'big-pickle',
  provider: 'opencode'
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
    throw new ConfigError({
      message: 'Failed to write config',
      cause: error
    });
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
          specialNotes: args.specialNotes
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

    if (!exists) {
      console.log(`Config file not found at ${configPath}, creating default config...`);
      // Ensure directory exists
      await fs.mkdir(configDir, { recursive: true });
      await fs.writeFile(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2));
      console.log(`Default config created at ${configPath}`);
      const reposDir = expandHome(DEFAULT_CONFIG.reposDirectory);
      const config = {
        ...DEFAULT_CONFIG,
        reposDirectory: reposDir
      };
      return {
        config,
        configPath
      };
    } else {
      const content = await fs.readFile(configPath, 'utf-8');
      const parsed = JSON.parse(content);
      // Simple validation, since we removed Schema
      if (!parsed.reposDirectory || !parsed.repos || !parsed.model || !parsed.provider) {
        throw new Error('Invalid config format');
      }
      const reposDir = expandHome(parsed.reposDirectory);
      const config = {
        ...parsed,
        reposDirectory: reposDir
      };
      return {
        config,
        configPath
      };
    }
  } catch (error) {
    throw new ConfigError({
      message: 'Failed to load config',
      cause: error
    });
  }
};

export class ConfigService {
  private config!: Config;
  private configPath!: string;

  constructor() {
    // Will be initialized async
  }

  async init(): Promise<void> {
    const loaded = await onStartLoadConfig();
    this.config = loaded.config;
    this.configPath = loaded.configPath;
  }

  getConfigPath(): string {
    return this.configPath;
  }

  async cloneOrUpdateOneRepoLocally(repoName: string, options: { suppressLogs: boolean }): Promise<Repo> {
    const repo = this.config.repos.find((repo) => repo.name === repoName);
    if (!repo) {
      throw new ConfigError({ message: 'Repo not found' });
    }
    const repoDir = path.join(this.config.reposDirectory, repo.name);
    const branch = repo.branch ?? 'main';
    const suppressLogs = options.suppressLogs;

    const exists = await directoryExists(repoDir);
    if (exists) {
      if (!suppressLogs) console.log(`Pulling latest changes for ${repo.name}...`);
      await pullRepo({ repoDir, branch, quiet: suppressLogs });
    } else {
      if (!suppressLogs) console.log(`Cloning ${repo.name}...`);
      await cloneRepo({ repoDir, url: repo.url, branch, quiet: suppressLogs });
    }
    if (!suppressLogs) console.log(`Done with ${repo.name}`);
    return repo;
  }

  async getOpenCodeConfig(args: { repoName: string }): Promise<OpenCodeConfig | undefined> {
    const repo = this.config.repos.find((repo) => repo.name === args.repoName);
    return OPENCODE_CONFIG({
      repoName: args.repoName,
      reposDirectory: this.config.reposDirectory,
      specialNotes: repo?.specialNotes
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

  async updateModel(args: { provider: string; model: string }): Promise<{ provider: string; model: string }> {
    this.config = { ...this.config, provider: args.provider, model: args.model };
    await writeConfig(this.config);
    return { provider: this.config.provider, model: this.config.model };
  }

  async addRepo(repo: Repo): Promise<Repo> {
    const existing = this.config.repos.find((r) => r.name === repo.name);
    if (existing) {
      throw new ConfigError({ message: `Repo "${repo.name}" already exists` });
    }
    this.config = { ...this.config, repos: [...this.config.repos, repo] };
    await writeConfig(this.config);
    return repo;
  }

  async removeRepo(repoName: string): Promise<void> {
    const existing = this.config.repos.find((r) => r.name === repoName);
    if (!existing) {
      throw new ConfigError({ message: `Repo "${repoName}" not found` });
    }
    this.config = { ...this.config, repos: this.config.repos.filter((r) => r.name !== repoName) };
    await writeConfig(this.config);
  }

  getReposDirectory(): string {
    return this.config.reposDirectory;
  }
}