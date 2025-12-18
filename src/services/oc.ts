import {
  createOpencode,
  OpencodeClient,
  type Event,
  type Config as OpenCodeConfig
} from '@opencode-ai/sdk';
import { ConfigService } from './config.ts';
import path from 'node:path';
import { OcError, InvalidTechError } from '../lib/errors.ts';
import { findSimilarStrings } from '../lib/utils/fuzzy-matcher.ts';
import { logger } from '../lib/utils/logger.ts';
import { EventProcessor } from '../lib/event/EventProcessor.ts';
import { EventStreamManager } from '../lib/event/EventStreamManager.ts';
import { MessageEventHandler } from '../lib/event/handlers/MessageEventHandler.ts';
import { SessionEventHandler } from '../lib/event/handlers/SessionEventHandler.ts';
import { ToolEventHandler } from '../lib/event/handlers/ToolEventHandler.ts';
import { hasSessionId, isSessionIdleEvent } from '../lib/utils/type-guards.ts';
import type { SdkEvent } from '../lib/types/events.ts';

export type { Event as OcEvent };

// Response caching interfaces




// Session reuse interfaces

















export class OcService {
  private configService: ConfigService;
  private eventProcessor: EventProcessor;
  private eventStreamManager: EventStreamManager;



  constructor(configService: ConfigService) {
    this.configService = configService;

    // Initialize event processing system
    this.eventProcessor = new EventProcessor();

    this.eventStreamManager = new EventStreamManager();

    // Register default event handlers
    this.registerDefaultEventHandlers();
  }

  private registerDefaultEventHandlers(): void {
    // Register message event handler for text output
    const messageHandler = new MessageEventHandler({
      outputStream: process.stdout,
      enableFormatting: true,
    });

    // Register session event handler for session lifecycle
    const sessionHandler = new SessionEventHandler({
      onSessionComplete: async (sessionId) => {
        await logger.info(`Session ${sessionId} completed`);
      }
    });

    this.eventProcessor.registerHandler('message-handler', messageHandler);
    this.eventProcessor.registerHandler('session-handler', sessionHandler);
  }





  getMetrics() {
    return {
      repositoryCache: this.configService.getRepositoryCacheStats()
    };
  }

  async shutdown(): Promise<void> {
    try {
      await this.eventStreamManager.shutdown();
      await this.eventProcessor.shutdown();
      await logger.resource('OcService shutdown complete');
    } catch (error) {
      await logger.error(`Error during OcService shutdown: ${error}`);
      throw error;
    }
  }

  private async getOpencodeInstance(tech: string): Promise<{ client: OpencodeClient; server: { close: () => void; url: string } }> {
    const configObject = await this.configService.getOpenCodeConfig({ repoName: tech });

    if (!configObject) {
      // Get available techs and suggest similar ones if tech is not found
      const allRepos = this.configService.getRepos();
      const availableTechs = allRepos.map(repo => repo.name);
      const suggestedTechs = findSimilarStrings(tech, availableTechs, 3); // Increase threshold to allow more suggestions

      throw new InvalidTechError(tech, availableTechs, suggestedTechs);
    }

    // Create OpenCode instance directly
    let port = this.configService.getOpenCodeBasePort();
    const maxPort = port + this.configService.getOpenCodePortRange() - 1;
    while (true) {
      try {
        const originalConfigDir = process.env.OPENCODE_CONFIG_DIR;
        process.env.OPENCODE_CONFIG_DIR = this.configService.getOpenCodeConfigDir();

        try {
          await logger.info(`Creating OpenCode instance for ${tech} on port ${port}`);
          const result = await createOpencode({
            port,
            config: configObject
          });
          return { client: result.client, server: result.server };
        } finally {
          if (originalConfigDir !== undefined) {
            process.env.OPENCODE_CONFIG_DIR = originalConfigDir;
          } else {
            delete process.env.OPENCODE_CONFIG_DIR;
          }
        }
      } catch (err) {
        port++;
        if (port > maxPort) {
          throw new OcError('RESOURCE EXHAUSTION: No available ports for new instance', err);
        }
      }
    }
  }

  async askQuestion(args: { question: string; tech: string }): Promise<AsyncIterable<Event>> {
    const { question, tech } = args;
    let result!: { client: OpencodeClient; server: { close: () => void; url: string } };
    let sessionID: string | null = null;
    let streamId: string | null = null;

    await logger.info(`Asking question about ${tech}: "${question}"`);



    // Validate tech name first and provide suggestions if not found
    // This prevents attempting to clone a non-existent repo
    const allRepos = this.configService.getRepos();
    const availableTechs = allRepos.map(repo => repo.name);
    if (!availableTechs.includes(tech)) {
      const suggestedTechs = findSimilarStrings(tech, availableTechs, 3); // Increase threshold to allow more suggestions
      throw new InvalidTechError(tech, availableTechs, suggestedTechs);
    }

    await this.configService.cloneOrUpdateOneRepoLocally(tech, { suppressLogs: true });


    return await (async () => {
      try {
        result = await this.getOpencodeInstance(tech);

        // Check if the provider is authenticated
        const providerList = await result.client.provider.list();
        if (providerList.error) {
          throw new OcError('Failed to list providers', providerList.error);
        }
        const { connected } = providerList.data;
        if (!connected.includes(this.configService.rawConfig().provider)) {
          throw new OcError(`Provider "${this.configService.rawConfig().provider}" is not authenticated. Run "btca auth login --provider ${this.configService.rawConfig().provider}" to authenticate.`);
        }

        // Create new session
        const repoPath = path.join(this.configService.getReposDirectory(), tech);
        await logger.info(`Creating session for ${tech} with working directory: ${repoPath}`);

        const session = await result.client.session.create({
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

        // Get the raw event stream from the client
        const events = await result!.client.event.subscribe();

        // Create a filtered event stream that only includes events for this session
        const self = this; // Capture this for use in generator
        const sessionFilteredEvents = {
          async *[Symbol.asyncIterator]() {
            let sessionCompleted = false;
            let eventCount = 0;
            for await (const event of events.stream) {
              eventCount++;
              const sessionIdProp = hasSessionId(event) ? event.properties.sessionID : 'none';
              await logger.debug(`Received event ${eventCount} for session ${sessionID}: type=${event.type}, eventSessionID=${sessionIdProp}`);

              if (sessionCompleted) {
                break; // Stop yielding events after session completion
              }

              // Type-safe event filtering and session completion handling
              if (!hasSessionId(event) || event.properties.sessionID === sessionID) {
                // Handle session completion with type-safe idle event checking
                if (isSessionIdleEvent(event) && event.properties.sessionID === sessionID) {
                  sessionCompleted = true;
                  await logger.info(`Session ${sessionID} completed for ${tech} after ${eventCount} events`);
                }

                yield event;
              }
            }
            await logger.info(`Event stream finished for session ${sessionID} with ${eventCount} total events`);
          }
        };

        // Create a stream processor for this session
        streamId = await this.eventStreamManager.createStream(
          sessionFilteredEvents,
          {
            id: `session-${sessionID}`,
            description: `Event stream for session ${sessionID} (${tech})`,
            timeoutMs: this.configService.getSessionTimeout() * 60 * 1000,
          }
        );

        // Register handlers on the stream's processor
        const streamInfo = this.eventStreamManager.getStreamInfo(streamId);
        if (streamInfo) {
          const messageHandler = new MessageEventHandler({
            outputStream: process.stdout,
            enableFormatting: true,
          });
          const sessionHandler = new SessionEventHandler({
            onSessionComplete: async (sessionId) => {
              await logger.info(`Session ${sessionId} completed`);
            }
          });
          streamInfo.processor.registerHandler('message-handler', messageHandler);
          streamInfo.processor.registerHandler('session-handler', sessionHandler);
        }

        // Fire the prompt asynchronously
        await logger.info(`Sending prompt to OpenCode for session ${sessionID} with provider ${this.configService.rawConfig().provider} and model ${this.configService.rawConfig().model}`);
        try {
          await result.client.session.prompt({
            path: { id: sessionID },
            body: {
              agent: 'docs',
              model: {
                providerID: this.configService.rawConfig().provider,
                modelID: this.configService.rawConfig().model
              },
              parts: [{ type: 'text', text: question }]
            }
          });
          await logger.info(`Prompt sent successfully for session ${sessionID}`);
        } catch (err) {
          const promptError = new OcError(String(err), err);
          await logger.error(`Prompt error for ${tech} (session ${sessionID}): ${err}`);
          await logger.error(`Prompt error stack: ${err instanceof Error ? err.stack : String(err)}`);

          // Stop the stream on prompt error
          if (streamId) {
            await this.eventStreamManager.stopStream(streamId);
          }

          throw promptError;
        }

        // Return the processed events through our event processing system
        // Collect events for caching while yielding them
        const allEvents: Event[] = [];
        const processedEvents = {
          async *[Symbol.asyncIterator]() {
            // The EventProcessor handles the actual event processing and output
            // This iterator just yields events that pass through the system
            // The real processing happens in the handlers registered with the processor
            for await (const event of sessionFilteredEvents) {
              allEvents.push(event);
              yield event;
            }


          }
        };

        return processedEvents;
      } catch (error) {
        // Ensure cleanup even if error occurs after creation
        if (streamId) {
          try {
            await this.eventStreamManager.stopStream(streamId);
          } catch (streamError) {
            await logger.error(`Error stopping stream ${streamId}: ${streamError}`);
          }
        }



        await logger.error(`Error in askQuestion for ${tech}: ${error instanceof Error ? error.message : String(error)}`);
        throw error;
      }
    })();
  }
}