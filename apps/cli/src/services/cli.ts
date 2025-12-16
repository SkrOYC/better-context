import * as readline from 'readline';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Command } from 'commander';
import { OcService, type OcEvent } from './oc.ts';
import { ConfigService } from './config.ts';
import { InvalidTechError } from '../lib/errors.ts';
import { directoryExists } from '../lib/utils/files.ts';

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

const handleAskCommand = async (args: string[], oc: OcService): Promise<void> => {
  let question: string | undefined;
  let tech: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--question' || args[i] === '-q') {
      question = args[i + 1];
      i++;
    } else if (args[i] === '--tech' || args[i] === '-t') {
      tech = args[i + 1];
      i++;
    }
  }

  if (!question || !tech) {
    console.error('Usage: btca ask --question <question> --tech <tech>');
    process.exit(1);
  }

  try {
    const eventStream = await oc.askQuestion({ tech, question });

    let currentMessageId: string | null = null;

    for await (const event of eventStream) {
      switch (event.type) {
        case 'message.part.updated':
          if (event.properties.part.type === 'text') {
            if (currentMessageId === event.properties.part.messageID) {
              process.stdout.write(event.properties.delta ?? '');
            } else {
              currentMessageId = event.properties.part.messageID;
              process.stdout.write('\n\n' + event.properties.part.text);
            }
          }
          break;
        default:
          break;
      }
    }

    console.log('\n');
  } catch (e: any) {
    if (e.name === 'InvalidTechError') {
      console.error(`Error: ${e.message}`);
      process.exit(1);
    } else if (e.name === 'InvalidProviderError') {
      console.error(`Error: Unknown provider "${e.providerId}"`);
      console.error(`Available providers: ${e.availableProviders.join(', ')}`);
      process.exit(1);
    } else if (e.name === 'InvalidModelError') {
      console.error(`Error: Unknown model "${e.modelId}" for provider "${e.providerId}"`);
      console.error(`Available models: ${e.availableModels.join(', ')}`);
      process.exit(1);
    } else if (e.name === 'ProviderNotConnectedError') {
      console.error(`Error: Provider "${e.providerId}" is not connected`);
      console.error(`Connected providers: ${e.connectedProviders.join(', ')}`);
      console.error(`Run "opencode auth" to configure provider credentials.`);
      process.exit(1);
    } else {
      throw e;
    }
  }
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
      const eventStream = await this.oc.askQuestion({ tech, question });

      let currentMessageId: string | null = null;

      for await (const event of eventStream) {
        switch (event.type) {
          case 'message.part.updated':
            if (event.properties.part.type === 'text') {
              if (currentMessageId === event.properties.part.messageID) {
                process.stdout.write(event.properties.delta ?? '');
              } else {
                currentMessageId = event.properties.part.messageID;
                process.stdout.write('\n\n' + event.properties.part.text);
              }
            }
            break;
          default:
            break;
        }
      }

      console.log('\n');
    } catch (e: any) {
      if (e.name === 'InvalidTechError') {
        console.error(`Error: ${e.message}`);
        process.exit(1);
      } else if (e.name === 'InvalidProviderError') {
        console.error(`Error: Unknown provider "${e.providerId}"`);
        console.error(`Available providers: ${e.availableProviders.join(', ')}`);
        process.exit(1);
      } else if (e.name === 'InvalidModelError') {
        console.error(`Error: Unknown model "${e.modelId}" for provider "${e.providerId}"`);
        console.error(`Available models: ${e.availableModels.join(', ')}`);
        process.exit(1);
      } else if (e.name === 'ProviderNotConnectedError') {
        console.error(`Error: Provider "${e.providerId}" is not connected`);
        console.error(`Connected providers: ${e.connectedProviders.join(', ')}`);
        console.error(`Run "opencode auth" to configure provider credentials.`);
        process.exit(1);
      } else {
        // For any other errors, we throw to let the top-level error handler manage them
        throw e;
      }
    }
  }

  private async handleConfigModelCommand(provider?: string, model?: string): Promise<void> {
    if (provider && model) {
      const result = await this.config.updateModel({ provider, model });
      console.log(`Updated model configuration:`);
      console.log(`  Provider: ${result.provider}`);
      console.log(`  Model: ${result.model}`);
    } else if (provider || model) {
      console.error('Error: Both --provider and --model must be specified together');
      process.exit(1);
    } else {
      const current = await this.config.getModel();
      console.log(`Current model configuration:`);
      console.log(`  Provider: ${current.provider}`);
      console.log(`  Model: ${current.model}`);
    }
  }

  private async handleConfigReposListCommand(): Promise<void> {
    const repos = await this.config.getRepos();

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
  }

  private async handleConfigReposAddCommand(name: string, url: string, branch: string, notes?: string): Promise<void> {
    const repo = {
      name,
      url,
      branch,
      ...(notes ? { specialNotes: notes } : {})
    };

    try {
      await this.config.addRepo(repo);
      console.log(`Added repo "${name}":`);
      console.log(`  URL: ${url}`);
      console.log(`  Branch: ${repo.branch}`);
      if (notes) {
        console.log(`  Notes: ${notes}`);
      }
    } catch (e: any) {
      console.error(`Error: ${e.message}`);
      process.exit(1);
    }
  }

  private async handleConfigReposRemoveCommand(name: string): Promise<void> {
    const repos = await this.config.getRepos();
    const exists = repos.find((r) => r.name === name);
    if (!exists) {
      console.error(`Error: Repo "${name}" not found.`);
      process.exit(1);
    }

    const confirmed = await askConfirmation(`Are you sure you want to remove repo "${name}" from config? (y/N): `);

    if (!confirmed) {
      console.log('Aborted.');
      return;
    }

    try {
      await this.config.removeRepo(name);
      console.log(`Removed repo "${name}".`);
    } catch (e: any) {
      console.error(`Error: ${e.message}`);
      process.exit(1);
    }
  }

  private async handleConfigReposClearCommand(): Promise<void> {
    const reposDir = await this.config.getReposDirectory();

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
      const fullPath = path.join(reposDir, entry);
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