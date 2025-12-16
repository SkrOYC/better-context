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

  async initSession(tech: string): Promise<string> {
    let portOffset = 0;
    const maxInstances = 5;
    const configObject = await this.configService.getOpenCodeConfig({ repoName: tech });

    if (!configObject) {
      throw new OcError({
        message: 'Config not found for tech',
        cause: null
      });
    }

    while (portOffset < maxInstances) {
      try {
        const result = await createOpencode({
          port: 3420 + portOffset,
          config: configObject
        });
        const session = await result.client.session.create();

        if (session.error) {
          throw new OcError({
            message: 'FAILED TO START OPENCODE SESSION',
            cause: session.error
          });
        }

        const sessionID = session.data.id;
        this.sessions.set(sessionID, { client: result.client, server: result.server });

        return sessionID;
      } catch (err) {
        if (err instanceof Error && err.message.includes('port')) {
          portOffset++;
        } else {
          throw new OcError({
            message: 'FAILED TO CREATE OPENCODE CLIENT',
            cause: err
          });
        }
      }
    }
    throw new OcError({
      message: 'FAILED TO CREATE OPENCODE CLIENT - all ports exhausted',
      cause: null
    });
  }

  async sendPrompt(sessionId: string, text: string): Promise<AsyncIterable<Event>> {
    const sessionData = this.sessions.get(sessionId);
    if (!sessionData) {
      throw new OcError({
        message: 'Session not found',
        cause: null
      });
    }
    const { client } = sessionData;

    const events = await client.event.subscribe();
    const filteredEvents = {
      async *[Symbol.asyncIterator]() {
        for await (const event of events.stream) {
          const props = event.properties;
          if (!('sessionID' in props) || props.sessionID === sessionId) {
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
      // Handle error
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

    await this.configService.cloneOrUpdateOneRepoLocally(tech, { suppressLogs });

    let portOffset = 0;
    const maxInstances = 5;
    const configObject = await this.configService.getOpenCodeConfig({ repoName: tech });

    if (!configObject) {
      throw new OcError({
        message: 'Config not found for tech',
        cause: null
      });
    }

    while (portOffset < maxInstances) {
      try {
        const result = await createOpencode({
          port: 3420 + portOffset,
          config: configObject
        });

        await validateProviderAndModel(result.client, this.configService.rawConfig().provider, this.configService.rawConfig().model);

        const session = await result.client.session.create();

        if (session.error) {
          throw new OcError({
            message: 'FAILED TO START OPENCODE SESSION',
            cause: session.error
          });
        }

        const sessionID = session.data.id;

        const events = await result.client.event.subscribe();
        const filteredEvents = {
          async *[Symbol.asyncIterator]() {
            for await (const event of events.stream) {
              if (event.type === 'session.idle' && event.properties.sessionID === sessionID) {
                break;
              }
              const props = event.properties;
              if (!('sessionID' in props) || props.sessionID === sessionID) {
                if (event.type === 'session.error') {
                  const props = event.properties as { error?: { name?: string } };
                  throw new OcError({
                    message: props.error?.name ?? 'Unknown session error',
                    cause: props.error
                  });
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
          // Handle error
        });

        return filteredEvents;
      } catch (err) {
        if (err instanceof Error && err.message.includes('port')) {
          portOffset++;
        } else {
          throw err;
        }
      }
    }
    throw new OcError({
      message: 'FAILED TO CREATE OPENCODE CLIENT - all ports exhausted',
      cause: null
    });
  }
}