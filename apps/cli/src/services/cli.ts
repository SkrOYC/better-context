import * as readline from 'readline';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Command } from 'commander';
import { OcService, type OcEvent } from './oc.ts';
import { ConfigService } from './config.ts';
import { InvalidTechError, RetryableError, NonRetryableError, StartupValidationError, ConfigurationChangeError } from '../lib/errors.ts';
import { directoryExists } from '../lib/utils/files.ts';
import { logger } from '../lib/utils/logger.ts';

// Shared error handling function to avoid duplication
const handleCommandError = (e: any): void => {
  if (e.name === 'InvalidTechError') {
    console.error(`Error: ${e.message}`);
    throw e;
  } else if (e.name === 'InvalidProviderError') {
    console.error(`Error: Unknown provider "${e.providerId}"`);
    console.error(`Available providers: ${e.availableProviders.join(', ')}`);
    throw e;
  } else if (e.name === 'InvalidModelError') {
    console.error(`Error: Unknown model "${e.modelId}" for provider "${e.providerId}"`);
    console.error(`Available models: ${e.availableModels.join(', ')}`);
    throw e;
  } else if (e.name === 'ProviderNotConnectedError') {
    console.error(`Error: Provider "${e.providerId}" is not connected`);
    console.error(`Connected providers: ${e.connectedProviders.join(', ')}`);
    console.error(`Run "opencode auth" to configure provider credentials.`);
    throw e;
  } else if (e instanceof RetryableError) {
    console.error(`Transient error: ${e.message}`);
    console.error(`This may be due to temporary network issues. Please try again.`);
    throw e;
  } else if (e instanceof NonRetryableError) {
    console.error(`Configuration error: ${e.message}`);
    console.error(`Please check your settings and try again.`);
    throw e;
  } else if (e.name === 'StartupValidationError') {
    console.error(`Configuration validation failed: ${e.message}`);
    console.error(`Please check your provider/model configuration and network connectivity.`);
    throw e;
  } else if (e.name === 'ConfigurationChangeError') {
    console.error(`Configuration update failed: ${e.message}`);
    console.error(`The new configuration could not be validated. Please check your settings.`);
    throw e;
  } else {
    throw e;
  }
};

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



const handleConfigModelCommand = async (args: string[], config: ConfigService): Promise<void> => {
  let provider: string | undefined;
  let model: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--provider' || args[i] === '-p') {
      provider = args[i + 1];
      i++;
    } else if (args[i] === '--model' || args[i] === '-m') {
      model = args[i + 1];
      i++;
    }
  }

  if (provider && model) {
    const result = await config.updateModel({ provider, model });
    console.log(`Updated model configuration:`);
    console.log(`  Provider: ${result.provider}`);
    console.log(`  Model: ${result.model}`);
  } else if (provider || model) {
    console.error('Error: Both --provider and --model must be specified together');
    process.exit(1);
  } else {
    const current = await config.getModel();
    console.log(`Current model configuration:`);
    console.log(`  Provider: ${current.provider}`);
    console.log(`  Model: ${current.model}`);
  }
};

const handleConfigReposListCommand = async (config: ConfigService): Promise<void> => {
  const repos = await config.getRepos();

  if (repos.length === 0) {
    console.log('No repos configured.');
    return;
  }

  console.log('Configured repos:\n');
  for (const repo of repos) {
    console.log(`  ${repo.name}`);
    console.log(`    URL: ${repo.url}`);
    console.log(`    Branch: ${repo.branch}`);
    if (repo.specialNotes) {
      console.log(`    Notes: ${repo.specialNotes}`);
    }
    console.log();
  }
};

const handleConfigReposAddCommand = async (args: string[], config: ConfigService): Promise<void> => {
  let name = '';
  let url = '';
  let branch = 'main';
  let notes = '';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--name' || args[i] === '-n') {
      const value = args[i + 1];
      if (!value || value.startsWith('--')) {
        console.error('Error: --name requires a value');
        process.exit(1);
      }
      name = value;
      i++;
    } else if (args[i] === '--url' || args[i] === '-u') {
      const value = args[i + 1];
      if (!value || value.startsWith('--')) {
        console.error('Error: --url requires a value');
        process.exit(1);
      }
      url = value;
      i++;
    } else if (args[i] === '--branch' || args[i] === '-b') {
      const value = args[i + 1];
      if (!value || value.startsWith('--')) {
        console.error('Error: --branch requires a value');
        process.exit(1);
      }
      branch = value;
      i++;
    } else if (args[i] === '--notes') {
      const value = args[i + 1];
      if (!value || value.startsWith('--')) {
        console.error('Error: --notes requires a value');
        process.exit(1);
      }
      notes = value;
      i++;
    }
  }

  let repoName: string;
  if (name) {
    repoName = name;
  } else {
    repoName = await askText('Enter repo name: ');
  }

  if (!repoName) {
    console.log('No repo name provided.');
    return;
  }

  let repoUrl: string;
  if (url) {
    repoUrl = url;
  } else {
    repoUrl = await askText('Enter repo URL: ');
  }

  if (!repoUrl) {
    console.log('No repo URL provided.');
    return;
  }

  const repo = {
    name: repoName,
    url: repoUrl,
    branch,
    ...(notes ? { specialNotes: notes } : {})
  };

  try {
    await config.addRepo(repo);
    console.log(`Added repo "${repoName}":`);
    console.log(`  URL: ${repoUrl}`);
    console.log(`  Branch: ${branch}`);
    if (notes) {
      console.log(`  Notes: ${notes}`);
    }
  } catch (e: any) {
    console.error(`Error: ${e.message}`);
    process.exit(1);
  }
};

const handleConfigReposRemoveCommand = async (args: string[], config: ConfigService): Promise<void> => {
  let name = '';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--name' || args[i] === '-n') {
      const value = args[i + 1];
      if (!value || value.startsWith('--')) {
        console.error('Error: --name requires a value');
        process.exit(1);
      }
      name = value;
      i++;
    }
  }

  let repoName: string;
  if (name) {
    repoName = name;
  } else {
    repoName = await askText('Enter repo name to remove: ');
  }

  if (!repoName) {
    console.log('No repo name provided.');
    return;
  }

  const repos = await config.getRepos();
  const exists = repos.find((r) => r.name === repoName);
  if (!exists) {
    console.error(`Error: Repo "${repoName}" not found.`);
    process.exit(1);
  }

  const confirmed = await askConfirmation(`Are you sure you want to remove repo "${repoName}" from config? (y/N): `);

  if (!confirmed) {
    console.log('Aborted.');
    return;
  }

  try {
    await config.removeRepo(repoName);
    console.log(`Removed repo "${repoName}".`);
  } catch (e: any) {
    console.error(`Error: ${e.message}`);
    process.exit(1);
  }
};

const handleConfigReposClearCommand = async (config: ConfigService): Promise<void> => {
  const reposDir = await config.getReposDirectory();

  // Check if repos directory exists
  const exists = await directoryExists(reposDir);

  if (!exists) {
    console.log('Repos directory does not exist. Nothing to clear.');
    return;
  }

  // List all directories in the repos directory
  const entries = await fs.readdir(reposDir);
  const repoPaths: string[] = [];

  for (const entry of entries) {
    const fullPath = `${reposDir}/${entry}`;
    const stat = await fs.stat(fullPath);
    if (stat.isDirectory()) {
      repoPaths.push(fullPath);
    }
  }

  if (repoPaths.length === 0) {
    console.log('No repos found in the repos directory. Nothing to clear.');
    return;
  }

  console.log('The following repos will be deleted:\n');
  for (const repoPath of repoPaths) {
    console.log(`  ${repoPath}`);
  }
  console.log();

  const confirmed = await askConfirmation('Are you sure you want to delete these repos? (y/N): ');

  if (!confirmed) {
    console.log('Aborted.');
    return;
  }

  for (const repoPath of repoPaths) {
    await fs.rm(repoPath, { recursive: true });
    console.log(`Deleted: ${repoPath}`);
  }

  console.log('\nAll repos have been cleared.');
};

const handleConfigCommand = async (args: string[], config: ConfigService): Promise<void> => {
  if (args.length === 0) {
    const configPath = config.getConfigPath();
    console.log(`Config file: ${configPath}`);
    console.log('');
    console.log('Usage: btca config <command>');
    console.log('');
    console.log('Commands:');
    console.log('  model   View or set the model and provider');
    console.log('  repos   Manage configured repos');
    return;
  }

  const subcommand = args[0];
  const subArgs = args.slice(1);

  switch (subcommand) {
    case 'model':
      await handleConfigModelCommand(subArgs, config);
      break;
    case 'repos':
      if (subArgs.length === 0) {
        console.log('Usage: btca config repos <command>');
        console.log('');
        console.log('Commands:');
        console.log('  list    List all configured repos');
        console.log('  add     Add a new repo');
        console.log('  remove  Remove a configured repo');
        console.log('  clear   Clear all downloaded repos');
        return;
      }
      const reposSubcommand = subArgs[0];
      const reposSubArgs = subArgs.slice(1);
      switch (reposSubcommand) {
        case 'list':
          await handleConfigReposListCommand(config);
          break;
        case 'add':
          await handleConfigReposAddCommand(reposSubArgs, config);
          break;
        case 'remove':
          await handleConfigReposRemoveCommand(reposSubArgs, config);
          break;
        case 'clear':
          await handleConfigReposClearCommand(config);
          break;
        default:
          console.error(`Unknown repos subcommand: ${reposSubcommand}`);
          process.exit(1);
      }
      break;
    default:
      console.error(`Unknown config subcommand: ${subcommand}`);
      process.exit(1);
  }
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
  $ btca config repos add --name my-docs --url https://github.com/user/docs --notes "Internal docs"`)
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

    reposCommand
      .command('clear')
      .description('Clear all downloaded repositories from disk')
      .addHelpText('after', `
 WARNING: This will delete all downloaded repository data from your local machine.

 EXAMPLE:
   $ btca config repos clear`)
      .action(async () => {
        await this.handleConfigReposClearCommand();
      });
    
    // List command
    this.program
      .command('list')
      .description('List all configured technologies')
      .action(async () => {
        await this.handleListCommand();
      });
  }

  private async handleAskCommand(question: string, tech: string): Promise<void> {
    try {
      await logger.info(`CLI: Executing ask command for ${tech} with question: "${question}"`);
      const eventStream = await this.oc.askQuestion({ tech, question });

      // Event processing is now handled internally by the OcService through registered handlers
      // The MessageEventHandler writes directly to stdout, so we just need to consume the stream
      // to ensure all events are processed
      for await (const event of eventStream) {
        // Events are processed by the registered handlers in the background
        // No manual processing needed here anymore
      }

      // Add a final newline for clean output formatting
      console.log('\n');
      await logger.info(`CLI: Ask command completed for ${tech}`);
    } catch (e: any) {
      await logger.error(`CLI: Error in ask command for ${tech}: ${e instanceof Error ? e.message : String(e)}`);
      handleCommandError(e);
    }
  }

  private async handleConfigModelCommand(provider?: string, model?: string): Promise<void> {
    if (provider && model) {
      await logger.info(`CLI: Updating model configuration - provider: ${provider}, model: ${model}`);
      const result = await this.config.updateModel({ provider, model });
      console.log(`Updated model configuration:`);
      console.log(`  Provider: ${result.provider}`);
      console.log(`  Model: ${result.model}`);
      await logger.info(`CLI: Model configuration updated successfully`);
    } else if (provider || model) {
      await logger.warn(`CLI: Invalid model command - both provider and model must be specified together`);
      console.error('Error: Both --provider and --model must be specified together');
      process.exit(1);
    } else {
      const current = await this.config.getModel();
      console.log(`Current model configuration:`);
      console.log(`  Provider: ${current.provider}`);
      console.log(`  Model: ${current.model}`);
      await logger.info(`CLI: Viewed current model configuration`);
    }
  }

  private async handleConfigReposListCommand(): Promise<void> {
    await logger.info(`CLI: Listing configured repos`);
    const repos = await this.config.getRepos();

    if (repos.length === 0) {
      console.log('No repos configured.');
      await logger.info(`CLI: No repos configured`);
      return;
    }

    console.log('Configured repos:\n');
    for (const repo of repos) {
      console.log(`  ${repo.name}`);
      console.log(`    URL: ${repo.url}`);
      console.log(`    Branch: ${repo.branch}`);
      if (repo.specialNotes) {
        console.log(`    Notes: ${repo.specialNotes}`);
      }
      console.log();
    }
    await logger.info(`CLI: Listed ${repos.length} configured repos`);
  }

  private async handleConfigReposAddCommand(name: string, url: string, branch: string, notes?: string): Promise<void> {
    const repo = {
      name,
      url,
      branch,
      ...(notes ? { specialNotes: notes } : {})
    };

    try {
      await logger.info(`CLI: Adding repo ${name} with URL: ${url}, branch: ${branch}`);
      await this.config.addRepo(repo);
      console.log(`Added repo "${name}":`);
      console.log(`  URL: ${url}`);
      console.log(`  Branch: ${repo.branch}`);
      if (notes) {
        console.log(`  Notes: ${notes}`);
      }
      await logger.info(`CLI: Successfully added repo ${name}`);
    } catch (e: any) {
      await logger.error(`CLI: Failed to add repo ${name}: ${e.message}`);
      console.error(`Error: ${e.message}`);
      process.exit(1);
    }
  }

  private async handleConfigReposRemoveCommand(name: string): Promise<void> {
    const repos = await this.config.getRepos();
    const exists = repos.find((r) => r.name === name);
    if (!exists) {
      await logger.warn(`CLI: Attempted to remove non-existent repo ${name}`);
      console.error(`Error: Repo "${name}" not found.`);
      process.exit(1);
    }

    const confirmed = await askConfirmation(`Are you sure you want to remove repo "${name}" from config? (y/N): `);

    if (!confirmed) {
      await logger.info(`CLI: Repo removal for ${name} cancelled by user`);
      console.log('Aborted.');
      return;
    }

    try {
      await logger.info(`CLI: Removing repo ${name}`);
      await this.config.removeRepo(name);
      console.log(`Removed repo "${name}".`);
      await logger.info(`CLI: Successfully removed repo ${name}`);
    } catch (e: any) {
      await logger.error(`CLI: Failed to remove repo ${name}: ${e.message}`);
      console.error(`Error: ${e.message}`);
      process.exit(1);
    }
  }

  private async handleConfigReposClearCommand(): Promise<void> {
    await logger.info(`CLI: Clearing all downloaded repos`);
    const reposDir = await this.config.getReposDirectory();

    // Check if repos directory exists
    const exists = await directoryExists(reposDir);

    if (!exists) {
      console.log('Repos directory does not exist. Nothing to clear.');
      await logger.info(`CLI: Repos directory does not exist, nothing to clear`);
      return;
    }

    // List all directories in the repos directory
    const entries = await fs.readdir(reposDir);
    const repoPaths: string[] = [];

    for (const entry of entries) {
      const fullPath = path.join(reposDir, entry);
      const stat = await fs.stat(fullPath);
      if (stat.isDirectory()) {
        repoPaths.push(fullPath);
      }
    }

    if (repoPaths.length === 0) {
      console.log('No repos found in the repos directory. Nothing to clear.');
      await logger.info(`CLI: No repos found in directory, nothing to clear`);
      return;
    }

    console.log('The following repos will be deleted:\n');
    for (const repoPath of repoPaths) {
      console.log(`  ${repoPath}`);
    }
    console.log();

    const confirmed = await askConfirmation('Are you sure you want to delete these repos? (y/N): ');

    if (!confirmed) {
      await logger.info(`CLI: Repo clearing cancelled by user`);
      console.log('Aborted.');
      return;
    }

    for (const repoPath of repoPaths) {
      await fs.rm(repoPath, { recursive: true });
      console.log(`Deleted: ${repoPath}`);
      await logger.info(`CLI: Deleted repo at ${repoPath}`);
    }

    console.log('\nAll repos have been cleared.');
    await logger.info(`CLI: All repos have been cleared successfully`);
  }

  private async handleListCommand(): Promise<void> {
    const repos = await this.config.getRepos();
    
    if (repos.length === 0) {
      console.log('No technologies configured.');
      return;
    }
    
    // Output each technology name on a separate line (clean and parseable format)
    for (const repo of repos) {
      console.log(repo.name);
    }
  }

  async run(args: string[]): Promise<void> {
    await this.initialize();
    await this.program.parseAsync(args, { from: 'user' });
  }
}