import {
  createOpencode,
  OpencodeClient,
  type Event,
  type Config as OpenCodeConfig
} from '@opencode-ai/sdk';
import { ConfigService } from './config.ts';
import { OcError, InvalidTechError } from '../lib/errors.ts';
import { validateProviderAndModel } from '../lib/utils/validation.ts';
import { findSimilarStrings } from '../lib/utils/fuzzy-matcher.ts';
import { logger } from '../lib/utils/logger.ts';

export type { Event as OcEvent };

export class OcService {
  private configService: ConfigService;
  private sessions = new Map<string, {
    client: OpencodeClient;
    server: { close: () => void; url: string };
    createdAt: Date;
    lastActivity: Date;
    timeoutId?: NodeJS.Timeout;
  }>();
  private metrics = {
    sessionsCreated: 0,
    sessionsCleanedUp: 0,
    orphanedProcessesCleaned: 0,
    currentSessionCount: 0
  };

  constructor(configService: ConfigService) {
    this.configService = configService;
  }

  private resetSessionTimeout(sessionId: string): void {
    const sessionData = this.sessions.get(sessionId);
    if (!sessionData) return;

    // Clear existing timeout
    if (sessionData.timeoutId) {
      clearTimeout(sessionData.timeoutId);
    }

    // Set new timeout
    const timeoutMs = this.configService.getSessionTimeout() * 60 * 1000;
    sessionData.timeoutId = setTimeout(async () => {
      await this.cleanupSession(sessionId);
      await logger.resource(`Session ${sessionId} timed out after ${this.configService.getSessionTimeout()} minutes`);
    }, timeoutMs);

    sessionData.lastActivity = new Date();
  }

  private async cleanupSession(sessionId: string): Promise<void> {
    const sessionData = this.sessions.get(sessionId);
    if (sessionData) {
      // Clear timeout if exists
      if (sessionData.timeoutId) {
        clearTimeout(sessionData.timeoutId);
      }

      // Close server and clean up
      try {
        sessionData.server.close();
        await logger.resource(`Server closed for session ${sessionId}`);
      } catch (error) {
        await logger.error(`Error closing server for session ${sessionId}: ${error}`);
      }

      // Remove from tracking
      this.sessions.delete(sessionId);
      this.metrics.sessionsCleanedUp++;
      this.metrics.currentSessionCount = this.sessions.size;

      await logger.resource(`Session ${sessionId} cleaned up`);
    }
  }

  private async getOpencodeInstance(tech: string): Promise<{ client: OpencodeClient; server: { close: () => void; url: string } }> {
    let portOffset = 0;
    const maxInstances = 5;
    const configObject = await this.configService.getOpenCodeConfig({ repoName: tech });

    if (!configObject) {
      // Get available techs and suggest similar ones if tech is not found
      const allRepos = this.configService.getRepos();
      const availableTechs = allRepos.map(repo => repo.name);
      const suggestedTechs = findSimilarStrings(tech, availableTechs, 3); // Increase threshold to allow more suggestions
      
      throw new InvalidTechError(tech, availableTechs, suggestedTechs);
    }

    while (portOffset < maxInstances) {
      try {
        const result = await createOpencode({
          port: 3420 + portOffset,
          config: configObject
        });
        return result;
      } catch (err) {
        if (err instanceof Error && err.message.includes('port')) {
          portOffset++;
        } else {
          throw new OcError('FAILED TO CREATE OPENCODE CLIENT', err);
        }
      }
    }
    throw new OcError('FAILED TO CREATE OPENCODE CLIENT - all ports exhausted', null);
  }

  async initSession(tech: string): Promise<string> {
    const result = await this.getOpencodeInstance(tech);
    const session = await result.client.session.create();

    if (session.error) {
      throw new OcError('FAILED TO START OPENCODE SESSION', session.error);
    }

    const sessionID = session.data.id;
    const now = new Date();
    this.sessions.set(sessionID, {
      client: result.client,
      server: result.server,
      createdAt: now,
      lastActivity: now
    });

    // Set initial timeout
    this.resetSessionTimeout(sessionID);

    // Update metrics
    this.metrics.sessionsCreated++;
    this.metrics.currentSessionCount = this.sessions.size;

    await logger.resource(`Session ${sessionID} created for ${tech} with timeout`);
    await logger.metrics(`Sessions created: ${this.metrics.sessionsCreated}, Active: ${this.metrics.currentSessionCount}`);

    return sessionID;
  }

  async sendPrompt(sessionId: string, text: string): Promise<AsyncIterable<Event>> {
    const sessionData = this.sessions.get(sessionId);
    if (!sessionData) {
      throw new OcError('OpenCode SDK not configured', null);
    }
    const { client } = sessionData;

    // Reset timeout on activity
    this.resetSessionTimeout(sessionId);

    const events = await client.event.subscribe();
    let promptError: Error | null = null;

    const filteredEvents = {
      async *[Symbol.asyncIterator]() {
        if (promptError) {
          throw promptError;
        }
        for await (const event of events.stream) {
          if (promptError) {
            throw promptError;
          }
          const props = event.properties;
          if (!('sessionID' in props) || props.sessionID === sessionId) {
            if (event.type === 'session.error') {
              const props = event.properties as { error?: { name?: string } };
              throw new OcError(props.error?.name ?? 'Unknown session error', props.error);
            }
            yield event;
          }
        }
      }
    };

    // Fire the prompt
    client.session.prompt({
      path: { id: sessionId },
      body: {
        agent: 'docs',
        model: {
          providerID: this.configService.rawConfig().provider,
          modelID: this.configService.rawConfig().model
        },
        parts: [{ type: 'text', text }]
      }
    }).catch((err) => {
      promptError = new OcError(String(err), err);
    });

    return filteredEvents;
  }

  async closeSession(sessionId: string): Promise<void> {
    await this.cleanupSession(sessionId);
  }

  async cleanupAllSessions(): Promise<void> {
    const sessionIds = Array.from(this.sessions.keys());
    await logger.resource(`Cleaning up ${sessionIds.length} active sessions`);

    for (const sessionId of sessionIds) {
      await this.cleanupSession(sessionId);
    }

    await logger.resource('All sessions cleaned up');
  }

  async cleanupOrphanedProcesses(): Promise<void> {
    // Skip orphaned process cleanup on Windows (Unix-only feature)
    if (process.platform === 'win32') {
      await logger.debug('Skipping orphaned process cleanup on Windows platform');
      return;
    }

    const basePort = 3420;
    const maxInstances = 5;
    const processesToClean: number[] = [];

    // Check for OpenCode processes on ports 3420-3424
    for (let port = basePort; port < basePort + maxInstances; port++) {
      try {
        // Use lsof to find processes using the port
        const { stdout } = await Bun.spawn(['lsof', '-ti', `:${port}`], {
          stdout: 'pipe',
          stderr: 'ignore'
        });

        if (stdout) {
          const output = await new Response(stdout).text();
          const pid = parseInt(output.trim());
          if (!isNaN(pid)) {
            // Check if it's an OpenCode process
            const cmdResult = await Bun.spawn(['ps', '-p', pid.toString(), '-o', 'comm='], {
              stdout: 'pipe',
              stderr: 'ignore'
            });

            const command = cmdResult?.stdout ? (await new Response(cmdResult.stdout).text()).trim() : '';
            if (command.includes('node') || command.includes('bun') || command.includes('opencode')) {
              processesToClean.push(pid);
            }
          }
        }
      } catch (error) {
        // Port is likely not in use, which is fine
      }
    }

    // Clean up orphaned processes
    for (const pid of processesToClean) {
      try {
        await Bun.spawn(['kill', pid.toString()], {
          stdout: 'ignore',
          stderr: 'ignore'
        });
        await logger.resource(`Cleaned up orphaned OpenCode process ${pid}`);
        this.metrics.orphanedProcessesCleaned++;
      } catch (error) {
        await logger.error(`Failed to kill process ${pid}: ${error}`);
      }
    }

    if (processesToClean.length > 0) {
      await logger.resource(`Cleaned up ${processesToClean.length} orphaned processes`);
      await logger.metrics(`Orphaned processes cleaned: ${this.metrics.orphanedProcessesCleaned}`);
    }
  }

  getMetrics() {
    return {
      ...this.metrics,
      currentSessionCount: this.sessions.size
    };
  }

  async askQuestion(args: { question: string; tech: string }): Promise<AsyncIterable<Event>> {
    const { question, tech } = args;
    let result: { client: OpencodeClient; server: { close: () => void; url: string } } | null = null;
    let sessionID: string | null = null;

    try {
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

      result = await this.getOpencodeInstance(tech);

      const session = await result.client.session.create();

      if (session.error) {
        result.server.close(); // Cleanup immediately
        await logger.resource(`Session creation failed for ${tech}, server cleaned up`);
        await logger.error(`Failed to start OpenCode session for ${tech}: ${session.error}`);
        throw new OcError('FAILED TO START OPENCODE SESSION', session.error);
      }

      sessionID = session.data.id;
      await logger.info(`Session created for ${tech} with ID: ${sessionID}`);

      const events = await result.client.event.subscribe();
      let promptError: Error | null = null;

      const filteredEvents = {
        async *[Symbol.asyncIterator]() {
          if (promptError) {
            throw promptError;
          }
          for await (const event of events.stream) {
            if (promptError) {
              throw promptError;
            }
            if (event.type === 'session.idle' && event.properties.sessionID === sessionID) {
              await logger.info(`Session ${sessionID} completed for ${tech}`);
              break;
            }
            const props = event.properties;
            if (!('sessionID' in props) || props.sessionID === sessionID) {
              if (event.type === 'session.error') {
                const props = event.properties as { error?: { name?: string } };
                await logger.error(`Session error for ${tech} (session ${sessionID}): ${props.error?.name ?? 'Unknown session error'}`);
                throw new OcError(props.error?.name ?? 'Unknown session error', props.error);
              }
              yield event;
            }
          }
        }
      };

      // Fire the prompt
      result.client.session.prompt({
        path: { id: sessionID },
        body: {
          agent: 'docs',
          model: {
            providerID: this.configService.rawConfig().provider,
            modelID: this.configService.rawConfig().model
          },
          parts: [{ type: 'text', text: question }]
        }
      }).catch(async (err) => {
        promptError = new OcError(String(err), err);
        await logger.error(`Prompt error for ${tech}: ${err}`);
      });

      return filteredEvents;
    } catch (error) {
      // Ensure cleanup even if error occurs after creation
      if (result?.server) {
        try {
          result.server.close();
          await logger.resource(`Server closed due to error in askQuestion for ${tech}`);
        } catch (closeError) {
          await logger.error(`Error closing server during cleanup: ${closeError}`);
        }
      }

      await logger.error(`Error in askQuestion for ${tech}: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }
}