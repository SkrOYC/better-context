import * as readline from 'readline';
import { OcService, type OcEvent } from './oc.ts';
import { ConfigService } from './config.ts';

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
    const eventStream = await oc.askQuestion({ tech, question, suppressLogs: false });

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
    if (e.name === 'InvalidProviderError') {
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
    }
    throw e;
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
      name = args[i + 1] || '';
      i++;
    } else if (args[i] === '--url' || args[i] === '-u') {
      url = args[i + 1] || '';
      i++;
    } else if (args[i] === '--branch' || args[i] === '-b') {
      branch = args[i + 1] || 'main';
      i++;
    } else if (args[i] === '--notes') {
      notes = args[i + 1] || '';
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
      name = args[i + 1] || '';
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
  const exists = await import('node:fs/promises').then(fs => fs.stat(reposDir).then(() => true).catch(() => false));

  if (!exists) {
    console.log('Repos directory does not exist. Nothing to clear.');
    return;
  }

  // List all directories in the repos directory
  const fs = await import('node:fs/promises');
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
  private oc: OcService;
  private config: ConfigService;

  constructor(oc: OcService, config: ConfigService) {
    this.oc = oc;
    this.config = config;
  }

  async run(args: string[]): Promise<void> {
    if (args.length === 0) {
      console.log(`btca v${VERSION}. run btca --help for more information.`);
      return;
    }

    const command = args[0];
    const commandArgs = args.slice(1);

    switch (command) {
      case 'ask':
        await handleAskCommand(commandArgs, this.oc);
        break;
      case 'config':
        await handleConfigCommand(commandArgs, this.config);
        break;
      case '--help':
      case '-h':
        console.log(`btca v${VERSION}`);
        console.log('');
        console.log('Usage: btca <command> [options]');
        console.log('');
        console.log('Commands:');
        console.log('  ask     Ask questions about technologies');
        console.log('  config  Manage configuration');
        console.log('  --help  Show this help');
        break;
      default:
        console.error(`Unknown command: ${command}`);
        process.exit(1);
    }
  }
}