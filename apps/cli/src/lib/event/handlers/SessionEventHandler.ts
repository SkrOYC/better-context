import type { Event } from '@opencode-ai/sdk';
import type { EventHandler } from '../EventProcessor.ts';
import { logger } from '../../utils/logger.ts';
import { OcError } from '../../errors.ts';

export interface SessionEventHandlerOptions {
  onSessionError?: (sessionId: string, error: Error) => void;
  onSessionComplete?: (sessionId: string) => void;
  onSessionIdle?: (sessionId: string) => void;
}

export class SessionEventHandler implements EventHandler<Event> {
  private options: SessionEventHandlerOptions;

  constructor(options: SessionEventHandlerOptions = {}) {
    this.options = options;
  }

  canHandle(event: Event): boolean {
    return event.type === 'session.error' || event.type === 'session.idle';
  }

  async handle(event: Event): Promise<void> {
    try {
      const sessionId = (event.properties as any).sessionID;
      if (!sessionId) {
        logger.warn(`Session event missing sessionID: ${event.type}`);
        return;
      }

      switch (event.type) {
        case 'session.error':
          await this.handleSessionError(event, sessionId);
          break;
        case 'session.idle':
          await this.handleSessionIdle(event, sessionId);
          break;
        default:
          logger.warn(`Unhandled session event type: ${event.type}`);
      }
    } catch (error) {
      logger.error(`Error handling session event: ${error}`);
      throw error;
    }
  }

  private async handleSessionError(event: Event, sessionId: string): Promise<void> {
    const props = event.properties as { error?: { name?: string; message?: string } };
    const errorName = props.error?.name ?? 'Unknown session error';
    const errorMessage = props.error?.message ?? 'No error message provided';

    const sessionError = new OcError(`SESSION ERROR [${sessionId}]: ${errorName} - ${errorMessage}`, props.error);

    logger.error(`Session error for ${sessionId}: ${errorName} - ${errorMessage}`);

    // Call error callback if provided
    if (this.options.onSessionError) {
      try {
        this.options.onSessionError(sessionId, sessionError);
      } catch (callbackError) {
        logger.error(`Error in session error callback: ${callbackError}`);
      }
    }

    // Re-throw to propagate the error up the chain
    throw sessionError;
  }

  private async handleSessionIdle(event: Event, sessionId: string): Promise<void> {
    logger.info(`Session ${sessionId} completed (idle state)`);

    // Call completion callback if provided
    if (this.options.onSessionComplete) {
      try {
        this.options.onSessionComplete(sessionId);
      } catch (callbackError) {
        logger.error(`Error in session complete callback: ${callbackError}`);
      }
    }

    // Call idle callback if provided
    if (this.options.onSessionIdle) {
      try {
        this.options.onSessionIdle(sessionId);
      } catch (callbackError) {
        logger.error(`Error in session idle callback: ${callbackError}`);
      }
    }
  }

  /**
   * Set callback for session errors
   */
  setErrorCallback(callback: (sessionId: string, error: Error) => void): void {
    this.options.onSessionError = callback;
  }

  /**
   * Set callback for session completion
   */
  setCompleteCallback(callback: (sessionId: string) => void): void {
    this.options.onSessionComplete = callback;
  }

  /**
   * Set callback for session idle events
   */
  setIdleCallback(callback: (sessionId: string) => void): void {
    this.options.onSessionIdle = callback;
  }

  /**
   * Create a session error handler with default behavior
   */
  static createDefaultHandler(): SessionEventHandler {
    return new SessionEventHandler({
      onSessionError: (sessionId, error) => {
        logger.error(`Session ${sessionId} encountered error: ${error.message}`);
        // Could add additional error handling logic here
        // e.g., retry logic, cleanup, notifications, etc.
      },
      onSessionComplete: (sessionId) => {
        logger.info(`Session ${sessionId} processing completed successfully`);
      },
      onSessionIdle: (sessionId) => {
        logger.debug(`Session ${sessionId} is now idle`);
      },
    });
  }
}