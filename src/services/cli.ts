import * as readline from 'readline';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Command } from 'commander';
import { OcService, type OcEvent } from './oc.ts';
import { ConfigService } from './config.ts';
import { createOpencode } from '@opencode-ai/sdk';
import { InvalidTechError, InvalidProviderError, InvalidModelError } from '../lib/errors.ts';
import { directoryExists } from '../lib/utils/files.ts';
import { logger } from '../lib/utils/logger.ts';

declare const __VERSION__: string;
const VERSION: string = typeof __VERSION__ !== 'undefined' ? __VERSION__ : '0.0.0-dev';

export type { OcEvent };

const askConfirmation = (question: string): Promise<boolean> => {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    rl.question(question, (answer) => {
      rl.close();
      const normalized = answer.toLowerCase().trim();
      resolve(normalized === 'y' || normalized === 'yes');
    });
  });
};

const askText = (question: string): Promise<string> => {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
};

export class CliService {
  private program: Command;
  private oc: OcService;
  private config: ConfigService;
  private isInitialized = false;

  constructor(oc: OcService, config: ConfigService) {
    this.oc = oc;
    this.config = config;
    this.program = new Command();
    this.setupProgram();
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;
    await this.setupCommands();
    this.isInitialized = true;
  }

  private setupProgram(): void {
    this.program
      .name('btca')
      .description('CLI tool for asking questions about technologies using OpenCode')
      .version(VERSION)
      .addHelpText('after', `

EXAMPLES:
  $ btca ask --question "How do I use React hooks?" --tech react
  $ btca ask -q "What are TypeScript generics?" -t typescript
  $ btca config model --provider openai --model gpt-4
  $ btca config repos add --name my-repo --url https://github.com/user/repo
  $ btca config repos list

For more detailed help, use: btca <command> --help`)
      .configureHelp({
        sortSubcommands: true,
        sortOptions: true,
        showGlobalOptions: false
      });
  }

  private async setupCommands(): Promise<void> {
    const repos = await this.config.getRepos();
    const availableTechnologies = repos.map(repo => repo.name).sort().join(', ');

    // Ask command
    this.program
      .command('ask')
      .description('Ask questions about technologies using AI')
      .requiredOption('-q, --question <question>', 'question to ask about the technology')
      .requiredOption('-t, --tech <technology>', 'technology to ask about')
      .addHelpText('after', `
EXAMPLES:
  $ btca ask --question "How do I create a React component?" --tech react
  $ btca ask -q "What are TypeScript interfaces?" -t typescript
  $ btca ask --question "How to set up Express middleware?" --tech express

Available technologies: ${availableTechnologies}`)
      .action(async (options) => {
        await this.handleAskCommand(options.question, options.tech);
      });

    // Config command and subcommands
    const configCommand = this.program
      .command('config')
      .description('Manage btca configuration settings')
      .addHelpText('after', `
EXAMPLES:
  $ btca config show                     # Show current configuration
  $ btca config model                    # View current model settings
  $ btca config model --provider openai --model gpt-4  # Set model
  $ btca config repos list               # List configured repos
  $ btca config repos add --name docs --url https://github.com/user/docs
  $ btca config repos remove --name docs # Remove a repo`);

    // Config model subcommand
    configCommand
      .command('model')
      .description('View or set the AI model and provider configuration')
      .option('-p, --provider <provider>', 'AI provider (e.g., openai, anthropic)')
      .option('-m, --model <model>', 'AI model name (e.g., gpt-4, claude-3)')
      .addHelpText('after', `
EXAMPLES:
  $ btca config model                           # Show current settings
  $ btca config model --provider openai --model gpt-4
  $ btca config model -p anthropic -m claude-3-sonnet`)
      .action(async (options) => {
        await this.handleConfigModelCommand(options.provider, options.model);
      });

    // Config repos subcommand
    const reposCommand = configCommand
      .command('repos')
      .description('Manage configured repositories for documentation')
      .addHelpText('after', `
EXAMPLES:
  $ btca config repos list
  $ btca config repos add --name react-docs --url https://github.com/facebook/react
  $ btca config repos remove --name react-docs
  $ btca config repos clear`);

    reposCommand
      .command('list')
      .description('List all configured repositories')
      .action(async () => {
        await this.handleConfigReposListCommand();
      });

    reposCommand
      .command('add')
      .description('Add a new repository to the configuration')
      .requiredOption('-n, --name <name>', 'repository name (used as identifier)')
      .requiredOption('-u, --url <url>', 'repository URL')
      .option('-b, --branch <branch>', 'branch to use', 'main')
      .option('--notes <notes>', 'special notes about this repository')
      .addHelpText('after', `
EXAMPLES:
  $ btca config repos add --name react --url https://github.com/facebook/react
  $ btca config repos add -n typescript -u https://github.com/microsoft/TypeScript -b main
  $ btca config repos add -n vue --url https://github.com/vuejs/core --notes "Vue.js framework"`)
      .action(async (options) => {
        await this.handleConfigReposAddCommand(options.name, options.url, options.branch, options.notes);
      });

    reposCommand
      .command('remove')
      .description('Remove a repository from the configuration')
      .requiredOption('-n, --name <name>', 'repository name to remove')
      .addHelpText('after', `
EXAMPLES:
  $ btca config repos remove --name react
  $ btca config repos remove -n typescript`)
      .action(async (options) => {
        await this.handleConfigReposRemoveCommand(options.name);
      });

    // Config show command
    configCommand
      .command('show')
      .description('Show current configuration')
      .action(async () => {
        await this.handleConfigShowCommand();
      });
  }

  async run(args: string[]): Promise<void> {
    await this.initialize();
    await this.program.parseAsync(args);
  }

  private async handleAskCommand(question: string, tech: string): Promise<void> {
    try {
      await this.oc.askQuestion({ question, tech });
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  }

  private async handleConfigModelCommand(provider?: string, model?: string): Promise<void> {
    try {
      if (!provider && !model) {
        // Show current model settings
        const currentModel = this.config.getModel();
        console.log(`Current configuration:`);
        console.log(`  Provider: ${currentModel.provider}`);
        console.log(`  Model: ${currentModel.model}`);
        return;
      }

      if (!provider || !model) {
        console.error(`Error: Both --provider and --model must be provided together.`);
        process.exit(1);
      }

      // Set new model
      const updatedModel = await this.config.updateModel({ provider, model });
      console.log(`Model configuration updated:`);
      console.log(`  Provider: ${updatedModel.provider}`);
      console.log(`  Model: ${updatedModel.model}`);
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  }

  private async handleConfigReposListCommand(): Promise<void> {
    try {
      const repos = this.config.getRepos();
      if (repos.length === 0) {
        console.log('No repositories configured.');
        return;
      }

      console.log('Configured repositories:');
      repos.forEach((repo, index) => {
        console.log(`  ${index + 1}. ${repo.name}`);
        console.log(`     URL: ${repo.url}`);
        console.log(`     Branch: ${repo.branch}`);
        if (repo.specialNotes) {
          console.log(`     Notes: ${repo.specialNotes}`);
        }
        console.log();
      });
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  }

  private async handleConfigReposAddCommand(name: string, url: string, branch: string, notes?: string): Promise<void> {
    try {
      const repo = {
        name,
        url,
        branch: branch || 'main',
        ...(notes && { specialNotes: notes })
      };

      await this.config.addRepo(repo);
      console.log(`Repository "${name}" added successfully.`);
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  }

  private async handleConfigReposRemoveCommand(name: string): Promise<void> {
    try {
      const confirmed = await askConfirmation(`Are you sure you want to remove repo "${name}" from config? (y/N): `);
      if (!confirmed) {
        console.log('Aborted.');
        return;
      }
      await this.config.removeRepo(name);
      console.log(`Repository "${name}" removed successfully.`);
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  }

  private async handleConfigShowCommand(): Promise<void> {
    try {
      const config = this.config.rawConfig();
      const model = this.config.getModel();

      console.log('Current configuration:');
      console.log(`  Repos directory: ${config.reposDirectory}`);
      console.log(`  OpenCode config directory: ${config.opencodeConfigDir}`);
      console.log(`  OpenCode base port: ${config.opencodeBasePort}`);
      console.log(`  Provider: ${model.provider}`);
      console.log(`  Model: ${model.model}`);
      console.log(`  Repositories: ${config.repos.length}`);
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  }
}
