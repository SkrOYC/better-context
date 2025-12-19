import {
  createOpencodeClient,
  OpencodeClient,
  type Event,
  type Config as OpenCodeConfig
} from '@opencode-ai/sdk';
import { ConfigService } from './config.ts';
import path from 'node:path';
import { OcError, InvalidTechError } from '../lib/errors.ts';
import { findSimilarStrings } from '../lib/utils/fuzzy-matcher.ts';
import { logger } from '../lib/utils/logger.ts';

export type { Event as OcEvent };

export class OcService {
  private configService: ConfigService;
  private openCodeInstance: { client: OpencodeClient; server: { close: () => void; url: string } };

  constructor(configService: ConfigService, openCodeInstance: { client: OpencodeClient; server: { close: () => void; url: string } }) {
    this.configService = configService;
    this.openCodeInstance = openCodeInstance;
  }

  async shutdown(): Promise<void> {
    try {
      await logger.info('OcService shutdown complete');
    } catch (error) {
      await logger.error(`Error during OcService shutdown: ${error}`);
      throw error;
    }
  }

  private async createDirectoryClient(tech: string): Promise<OpencodeClient> {
    const repoPath = path.join(this.configService.getReposDirectory(), tech);
    const clientWithDirectory = createOpencodeClient({
      baseUrl: this.openCodeInstance.server.url,
      directory: repoPath
    });

    await logger.info(`Created directory client for ${tech} with directory: ${repoPath}`);
    return clientWithDirectory;
  }

  

  async askQuestion(args: { question: string; tech: string }): Promise<void> {
    const { question, tech } = args;
    let sessionID: string | null = null;

    await logger.info(`Asking question about ${tech}: "${question}"`);

    // Validate tech name first and provide suggestions if not found
    const allRepos = this.configService.getRepos();
    const availableTechs = allRepos.map(repo => repo.name);
    if (!availableTechs.includes(tech)) {
      const suggestedTechs = findSimilarStrings(tech, availableTechs, 3);
      throw new InvalidTechError(tech, availableTechs, suggestedTechs);
    }

    await this.configService.cloneOrUpdateOneRepoLocally(tech, { suppressLogs: true });

    try {
      // Create directory-specific client using global instance
      const clientWithDirectory = await this.createDirectoryClient(tech);

      // Create new session
      const repoPath = path.join(this.configService.getReposDirectory(), tech);
      await logger.info(`Creating session for ${tech} with working directory: ${repoPath}`);

      const session = await clientWithDirectory.session.create({
        query: {
          directory: repoPath
        }
      });

      if (session.error) {
        await logger.error(`Failed to start OpenCode session for ${tech}: ${session.error}`);
        throw new OcError('FAILED TO START OPENCODE SESSION', session.error);
      }

      sessionID = session.data.id;
      await logger.info(`Session created for ${tech} with ID: ${sessionID}`);

      // Get the event stream
      const eventsSubscription = await clientWithDirectory.event.subscribe({});

      // Send prompt, but don't await promise here. Process events concurrently.
      const promptPromise = clientWithDirectory.session.prompt({
        path: { id: sessionID },
        body: {
          model: {
            providerID: this.configService.rawConfig().provider,
            modelID: this.configService.rawConfig().model
          },
          parts: [{ type: 'text', text: question }]
        }
      });

      // Process events directly
      for await (const event of eventsSubscription.stream) {
        // Handle session completion (only break when status is idle, not any status update)
        if (event.type === 'session.status.updated' && 
            event.properties.sessionID === sessionID &&
            (event.properties as any).status?.type === 'idle') {
          await logger.info(`Session ${sessionID} completed for ${tech}`);
          break;
        }

        // Handle session errors
        if (event.type === 'session.error' && 
            event.properties.sessionID === sessionID) {
          const errorProps = event.properties as { error?: { message?: string } };
          const errorMsg = `Session ${sessionID} errored: ${errorProps.error?.message || 'Unknown error'}`;
          await logger.error(errorMsg);
          throw new OcError(errorMsg, errorProps.error);
        }

        // Output text parts in real-time
        if (event.type === 'message.part.updated' && 
            (event.properties.part as any).type === 'text' &&
            (event.properties.part as any).messageID) {
          process.stdout.write((event.properties.part as any).text);
        }
      }

      // Now, await prompt promise to catch any errors during its submission.
      const promptResponse = await promptPromise;
      if (promptResponse.error) {
        throw new OcError('Prompt failed', promptResponse.error);
      }

      // Ensure we end with a newline
      process.stdout.write('\n');

    } catch (error) {
      await logger.error(`Error in askQuestion for ${tech}: ${error instanceof Error ? error.message : String(error)}`);
      
      // Try to abort the session if it exists
      if (sessionID) {
        try {
          const clientWithDirectory = await this.createDirectoryClient(tech);
          await clientWithDirectory.session.abort({ path: { id: sessionID } });
          await logger.info(`Aborted session ${sessionID} due to error`);
        } catch (abortError) {
          await logger.warn(`Failed to abort session ${sessionID}: ${abortError}`);
        }
      }
      
      throw error;
    }
  }
}
