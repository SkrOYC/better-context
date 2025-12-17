import type { Event } from '@opencode-ai/sdk';
import type { EventHandler } from '../EventProcessor.ts';
import type { SessionErrorEvent, SessionIdleEvent, EventWithSessionId } from '../../types/events.ts';
import { isSessionErrorEvent, isSessionIdleEvent, hasSessionId } from '../../utils/type-guards.ts';
import { logger } from '../../utils/logger.ts';
import { OcError } from '../../errors.ts';

export interface SessionEventHandlerOptions {
  onSessionError?: (sessionId: string, error: Error) => void;
  onSessionComplete?: (sessionId: string) => void;
  onSessionIdle?: (sessionId: string) => void;
}

export class SessionEventHandler implements EventHandler<SessionErrorEvent | SessionIdleEvent> {
  private options: SessionEventHandlerOptions;

  constructor(options: SessionEventHandlerOptions = {}) {
    this.options = options;
  }

  canHandle(event: Event): event is SessionErrorEvent | SessionIdleEvent {
    return isSessionErrorEvent(event) || isSessionIdleEvent(event);
  }

  async handle(event: SessionErrorEvent | SessionIdleEvent): Promise<void> {
    try {
      // Type-safe session ID extraction
      if (!hasSessionId(event)) {
        logger.warn(`Session event missing sessionID: ${event.type}`);
        return;
      }

      const sessionId = event.properties.sessionID;

      // Discriminated union handling
      if (isSessionErrorEvent(event)) {
        await this.handleSessionError(event, sessionId);
      } else if (isSessionIdleEvent(event)) {
        await this.handleSessionIdle(event, sessionId);
      } else {
        // This should never happen due to type guards, but handle gracefully
        logger.warn(`Unhandled session event type: ${(event as any).type || 'unknown'}`);
      }
    } catch (error) {
      logger.error(`Error handling session event: ${error}`);
      throw error;
    }
  }

  private async handleSessionError(event: SessionErrorEvent, sessionId: string): Promise<void> {
    // Type-safe access to error properties
    const errorDetails = event.properties.error;
    const errorName = errorDetails?.name ?? 'Unknown session error';
    const errorMessage = errorDetails?.message ?? 'No error message provided';

    const sessionError = new OcError(`SESSION ERROR [${sessionId}]: ${errorName} - ${errorMessage}`, errorDetails);

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

  private async handleSessionIdle(event: SessionIdleEvent, sessionId: string): Promise<void> {
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