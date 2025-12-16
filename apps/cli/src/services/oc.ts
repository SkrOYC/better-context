import {
  createOpencode,
  OpencodeClient,
  type Event,
  type Config as OpenCodeConfig
} from '@opencode-ai/sdk';
import { ConfigService } from './config.ts';
import { OcError } from '../lib/errors.ts';
import { validateProviderAndModel } from '../lib/utils/validation.ts';

export type { Event as OcEvent };

export class OcService {
  private configService: ConfigService;
  private sessions = new Map<string, { client: OpencodeClient; server: { close: () => void; url: string } }>();

  constructor(configService: ConfigService) {
    this.configService = configService;
  }

  private async getOpencodeInstance(tech: string): Promise<{ client: OpencodeClient; server: { close: () => void; url: string } }> {
    let portOffset = 0;
    const maxInstances = 5;
    const configObject = await this.configService.getOpenCodeConfig({ repoName: tech });

    if (!configObject) {
      throw new OcError('Config not found for tech', null);
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
    this.sessions.set(sessionID, { client: result.client, server: result.server });

    return sessionID;
  }

  async sendPrompt(sessionId: string, text: string): Promise<AsyncIterable<Event>> {
    const sessionData = this.sessions.get(sessionId);
    if (!sessionData) {
      throw new OcError('OpenCode SDK not configured', null);
    }
    const { client } = sessionData;

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
    const sessionData = this.sessions.get(sessionId);
    if (sessionData) {
      sessionData.server.close();
      this.sessions.delete(sessionId);
    }
  }

  async askQuestion(args: { question: string; tech: string; suppressLogs: boolean }): Promise<AsyncIterable<Event>> {
    const { question, tech, suppressLogs } = args;

    await this.configService.cloneOrUpdateOneRepoLocally(tech, { suppressLogs: true });

    const result = await this.getOpencodeInstance(tech);

    const session = await result.client.session.create();

    if (session.error) {
      throw new OcError('FAILED TO START OPENCODE SESSION', session.error);
    }

    const sessionID = session.data.id;

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
            break;
          }
          const props = event.properties;
          if (!('sessionID' in props) || props.sessionID === sessionID) {
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
    }).catch((err) => {
      promptError = new OcError(String(err), err);
    });

    return filteredEvents;
  }
}