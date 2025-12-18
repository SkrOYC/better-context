import type { Event } from '@opencode-ai/sdk';
import type { Event as SdkEvent } from '@opencode-ai/sdk';
import { logger } from '../utils/logger.ts';
import { isMessageUpdatedEvent } from '../utils/type-guards.ts';

export interface EventHandler<T extends SdkEvent = SdkEvent> {
  canHandle(event: SdkEvent): event is T;
  handle(event: T): Promise<void> | void;
}

export class EventProcessor {
  private handlers = new Map<string, EventHandler>();

  constructor() {
  }

  /**
   * Register an event handler
   */
  registerHandler(name: string, handler: EventHandler): void {
    this.handlers.set(name, handler);
    logger.debug(`Event handler registered: ${name}`);
  }

  /**
   * Unregister an event handler
   */
  unregisterHandler(name: string): void {
    this.handlers.delete(name);
    logger.debug(`Event handler unregistered: ${name}`);
  }

  /**
   * Process an async iterable of events
   */
  async processEventStream(eventStream: AsyncIterable<SdkEvent>): Promise<void> {
    try {
      logger.info('Starting event stream processing');

      // Process each event
      for await (const event of eventStream) {
        await this.processEvent(event);
      }

      logger.info('Event stream processing completed');
    } catch (error) {
      logger.error(`Error processing event stream: ${error}`);
      throw error;
    }
  }

  /**
   * Process a single event by calling all applicable handlers
   */
  async processEvent(event: SdkEvent): Promise<void> {
    const applicableHandlers: Array<{ name: string; handler: EventHandler }> = [];
    
    for (const [name, handler] of this.handlers.entries()) {
      if (handler.canHandle(event)) {
        applicableHandlers.push({ name, handler });
      }
    }

    if (applicableHandlers.length === 0) {
      logger.debug(`No handlers found for event type: ${event.type}`);

      // Add detailed logging for message.updated events
      if (isMessageUpdatedEvent(event)) {
        const messageInfo = event.properties.info;
        const details = {
          sessionID: messageInfo.sessionID,
          messageID: messageInfo.id,
          role: messageInfo.role,
          hasText: !!messageInfo.text,
          textLength: messageInfo.text?.length ?? 0,
          hasParts: !!messageInfo.parts,
          partsCount: messageInfo.parts?.length ?? 0,
        };
        logger.debug(`Unhandled message.updated details: ${JSON.stringify(details)}`);

        // Log first 10 chars of text if available
        if (messageInfo.text) {
          const preview = messageInfo.text.substring(0, 10);
          logger.debug(`Message text preview: "${preview}${messageInfo.text.length > 10 ? '...' : ''}"`);
        }
      }

      return;
    }

    // Call handlers in the order they were registered
    for (const { name, handler } of applicableHandlers) {
      try {
        // Safe cast: handler.canHandle() type guard ensures event matches handler's expected type
        await handler.handle(event as any);
      } catch (error) {
        logger.error(`Error in event handler ${name}: ${error}`);
        // Continue with other handlers
      }
    }
  }

  /**
   * Shutdown the processor
   */
  async shutdown(): Promise<void> {
    logger.info('EventProcessor shutdown');
  }
}