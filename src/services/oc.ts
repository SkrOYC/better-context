import {
  createOpencode,
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
import { EventProcessor } from '../lib/event/EventProcessor.ts';
import { EventStreamManager } from '../lib/event/EventStreamManager.ts';
import { MessageEventHandler } from '../lib/event/handlers/MessageEventHandler.ts';
import { MessageUpdatedEventHandler } from '../lib/event/handlers/MessageUpdatedEventHandler.ts';
import { SessionEventHandler } from '../lib/event/handlers/SessionEventHandler.ts';
import { SessionStatusEventHandler } from '../lib/event/handlers/SessionStatusEventHandler.ts';
import { PermissionUpdatedEventHandler } from '../lib/event/handlers/PermissionUpdatedEventHandler.ts';
import { ServerHeartbeatEventHandler } from '../lib/event/handlers/ServerHeartbeatEventHandler.ts';
import { ToolEventHandler } from '../lib/event/handlers/ToolEventHandler.ts';
import { hasSessionId, isSessionIdleEvent, isSessionErrorEvent } from '../lib/utils/type-guards.ts';
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
            port
          });

          // Create a new client with the directory header set
          const repoPath = path.join(this.configService.getReposDirectory(), tech);
          const clientWithDirectory = createOpencodeClient({
            baseUrl: result.server.url,
            directory: repoPath
          });

          await logger.info(`Created client with directory: ${repoPath}`);

          return { client: clientWithDirectory, server: result.server };
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

  async askQuestion(args: { question: string; tech: string }): Promise<void> {
    const { question, tech } = args;
    let result!: { client: OpencodeClient; server: { close: () => void; url: string } };
    let sessionID: string | null = null;

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
        if (providerList.error || !providerList.data) {
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

               // Type-safe event filtering and session completion handling
              if (!hasSessionId(event) || event.properties.sessionID === sessionID) {
                // Handle session completion with type-safe event checking
                if (isSessionIdleEvent(event) && event.properties.sessionID === sessionID) {
                  sessionCompleted = true;
                  await logger.info(`Session ${sessionID} completed for ${tech} after ${eventCount} events`);
                }

                if (isSessionErrorEvent(event) && event.properties.sessionID === sessionID) {
                  sessionCompleted = true;
                  const errorProps = event.properties as { error?: { message?: string } };
                  const errorMsg = `Session ${sessionID} errored: ${errorProps.error?.message || 'Unknown error'}`;
                  await logger.error(errorMsg);
                  throw new OcError(errorMsg, errorProps.error);
                }

                // Auto-approve permission requests
                if ((event as any).type === 'permission.request' && hasSessionId(event) && event.properties.sessionID === sessionID) {
                  const permissionId = (event.properties as any).permissionID;
                  if (permissionId) {
                    try {
                      await (result.client as any).permission.respond({
                        path: { sessionID, permissionID: permissionId },
                        body: { response: 'always' }
                      });
                      await logger.info(`Auto-approved permission ${permissionId} for session ${sessionID}`);
                    } catch (error) {
                      await logger.warn(`Failed to approve permission ${permissionId}: ${error}`);
                    }
                  }
                }

                // Log message.updated events for debugging
                if ((event as any).type === 'message.updated') {
                  const messageID = (event.properties as any)?.messageID;
                  logger.debug(`Received message.updated for messageID: ${messageID}`);
                }

                await logger.debug(`[${eventCount}] Received ${event.type} for session ${sessionID}`);
                yield event;
              }
            }
            await logger.info(`Event stream finished for session ${sessionID} with ${eventCount} total events`);
          }
        };

        // Create event handlers for processing
        const messageHandler = new MessageEventHandler({
          outputStream: process.stdout,
          enableFormatting: true,
        });
        const messageUpdatedHandler = new MessageUpdatedEventHandler({
          outputStream: process.stdout,
          enableFormatting: true,
        });
        const sessionStatusHandler = new SessionStatusEventHandler({
          enableStatusLogging: true,
          outputStream: process.stdout,
        });
        const permissionUpdatedHandler = new PermissionUpdatedEventHandler({
          enableStatusLogging: true,
          outputStream: process.stdout,
        });
        const serverHeartbeatHandler = new ServerHeartbeatEventHandler({
          enableHeartbeatLogging: false, // Keep disabled by default to reduce noise
          heartbeatInterval: 50, // Log every 50 heartbeats
          outputStream: process.stdout,
        });
        const sessionHandler = new SessionEventHandler({
          onSessionComplete: async (sessionId) => {
            await logger.info(`Session ${sessionId} completed`);
          }
        });
        const toolHandler = new ToolEventHandler({
          outputStream: process.stdout,
          enableVisibility: true,
        });

        // Create an event processor for this session
        const processor = new EventProcessor();
        processor.registerHandler('message-handler', messageHandler);
        processor.registerHandler('message-updated-handler', messageUpdatedHandler);
        processor.registerHandler('session-status-handler', sessionStatusHandler);
        processor.registerHandler('permission-updated-handler', permissionUpdatedHandler);
        processor.registerHandler('server-heartbeat-handler', serverHeartbeatHandler);
        processor.registerHandler('session-handler', sessionHandler);
        processor.registerHandler('tool-handler', toolHandler);

        // Fire the prompt asynchronously (don't await - let it process in background)
        await logger.info(`Sending prompt to OpenCode for session ${sessionID} with provider ${this.configService.rawConfig().provider} and model ${this.configService.rawConfig().model}`);
        result.client.session.prompt({
          path: { id: sessionID },
          body: {
            model: {
              providerID: this.configService.rawConfig().provider,
              modelID: this.configService.rawConfig().model
            },
            parts: [{ type: 'text', text: question }]
          }
        }).catch(async (err) => {
          const promptError = new OcError(String(err), err);
          await logger.error(`Prompt error for ${tech} (session ${sessionID}): ${err}`);
          await logger.error(`Prompt error stack: ${err instanceof Error ? err.stack : String(err)}`);
          throw promptError;
        });

        // Process events through our event processing system with timeout
        const timeoutMs = 2 * 60 * 1000; // 2 minutes
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => {
            reject(new OcError(`Session timed out after 2 minutes of no events`));
          }, timeoutMs);
        });

        try {
          await Promise.race([
            (async () => {
              for await (const event of sessionFilteredEvents) {
                await processor.processEvent(event);
              }
            })(),
            timeoutPromise
          ]);
        } catch (error) {
          // On timeout or session error, abort the session
          try {
            await result.client.session.abort({ path: { id: sessionID } });
            await logger.info(`Aborted session ${sessionID} due to timeout or error`);
          } catch (abortError) {
            await logger.warn(`Failed to abort session ${sessionID}: ${abortError}`);
          }
          throw error; // Re-throw the original error
        }
      } catch (error) {
        await logger.error(`Error in askQuestion for ${tech}: ${error instanceof Error ? error.message : String(error)}`);
        throw error;
      }
    })();
  }
}