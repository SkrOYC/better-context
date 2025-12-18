import type { Event } from '@opencode-ai/sdk';
import type { Event as SdkEvent } from '@opencode-ai/sdk';
import { logger } from '../utils/logger.ts';

export interface EventHandler<T extends SdkEvent = SdkEvent> {
  canHandle(event: SdkEvent): event is T;
  handle(event: T): Promise<void> | void;
  priority?: number; // Lower number = higher priority
}

export class EventProcessor {
  private handlers = new Map<string, EventHandler>();
  private sortedHandlers: Array<{ name: string; handler: EventHandler; priority: number }> = [];

  constructor() {
  }

  /**
   * Register an event handler
   */
  registerHandler(name: string, handler: EventHandler): void {
    this.handlers.set(name, handler);
    this.updateSortedHandlers();
    logger.debug(`Event handler registered: ${name}`);
  }

  /**
   * Unregister an event handler
   */
  unregisterHandler(name: string): void {
    this.handlers.delete(name);
    this.updateSortedHandlers();
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
    const applicableHandlers = this.sortedHandlers.filter(({ handler }) => handler.canHandle(event));

    if (applicableHandlers.length === 0) {
      logger.debug(`No handlers found for event type: ${event.type}`);
      return;
    }

    // Call handlers in priority order
    for (const { name, handler } of applicableHandlers) {
      try {
        await handler.handle(event as any);
      } catch (error) {
        logger.error(`Error in event handler ${name}: ${error}`);
        // Continue with other handlers
      }
    }
  }

  /**
   * Update the sorted handlers list based on priority
   */
  private updateSortedHandlers(): void {
    this.sortedHandlers = Array.from(this.handlers.entries())
      .map(([name, handler]) => ({
        name,
        handler,
        priority: handler.priority ?? 0,
      }))
      .sort((a, b) => a.priority - b.priority);
  }

  /**
   * Shutdown the processor
   */
  async shutdown(): Promise<void> {
    logger.info('EventProcessor shutdown');
  }
}