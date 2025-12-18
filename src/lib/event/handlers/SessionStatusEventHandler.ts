import type { EventHandler } from '../EventProcessor.ts';
import type { Event as SdkEvent } from '@opencode-ai/sdk';
import type { SessionStatusEvent } from '../../types/events.ts';
import { isSessionStatusEvent } from '../../utils/type-guards.ts';
import { logger } from '../../utils/logger.ts';

export interface SessionStatusEventHandlerOptions {
  enableStatusLogging?: boolean;
  outputStream?: NodeJS.WritableStream;
}

export class SessionStatusEventHandler implements EventHandler<SessionStatusEvent> {
  private options: Required<SessionStatusEventHandlerOptions>;

  constructor(options: SessionStatusEventHandlerOptions = {}) {
    this.options = {
      enableStatusLogging: options.enableStatusLogging ?? true,
      outputStream: options.outputStream ?? process.stdout,
    };
  }

  canHandle(event: SdkEvent): event is SessionStatusEvent {
    return isSessionStatusEvent(event);
  }

  async handle(event: SessionStatusEvent): Promise<void> {
    try {
      const statusInfo = event.properties.status;
      const sessionID = event.properties.sessionID;

      if (!this.options.enableStatusLogging) {
        return;
      }

      let statusMessage = '';

      switch (statusInfo.type) {
        case 'idle':
          statusMessage = '🟢 Session idle';
          break;
        case 'busy':
          statusMessage = '🟡 Session busy';
          break;
        case 'retry':
          statusMessage = `🔄 Session retry (attempt ${statusInfo.attempt || 1})`;
          if (statusInfo.message) {
            statusMessage += `: ${statusInfo.message}`;
          }
          if (statusInfo.next) {
            const nextRetry = new Date(statusInfo.next).toLocaleTimeString();
            statusMessage += ` (next retry at ${nextRetry})`;
          }
          break;
        default:
          statusMessage = `❓ Unknown status: ${(statusInfo as any).type}`;
      }

      if (sessionID) {
        statusMessage += ` [${sessionID}]`;
      }

      this.writeToOutput(`${statusMessage}\n`);

      // Log detailed status information
      await logger.info(`Session status changed: ${JSON.stringify({
        sessionID,
        status: statusInfo.type,
        timestamp: new Date().toISOString()
      })}`);

    } catch (error) {
      await logger.error(`Error handling session status event: ${error}`);
    }
  }

  private writeToOutput(text: string): void {
    if (!text) return;

    try {
      this.options.outputStream.write(text);
    } catch (error) {
      logger.error(`Error writing to output stream: ${error}`);
      // Fallback to console if output stream fails
      console.log(text);
    }
  }
}