import type { Event } from '@opencode-ai/sdk';
import { logger } from '../utils/logger.ts';

export interface EventProcessingOptions {
  bufferSize?: number;
  maxConcurrentHandlers?: number;
  processingRateLimit?: number; // events per second
  enableBackpressure?: boolean;
  backpressureThreshold?: number; // buffer size threshold to trigger backpressure
}

export interface EventHandler<T extends Event = Event> {
  canHandle(event: Event): boolean;
  handle(event: T): Promise<void> | void;
  priority?: number; // Lower number = higher priority
}

export class EventProcessor {
  private eventBuffer: Event[] = [];
  private processing = false;
  private handlers = new Map<string, EventHandler>();
  private activeHandlers = new Set<Promise<any>>();
  private eventQueue = new Set<Promise<any>>();

  private options: Required<EventProcessingOptions>;
  private processingTimer?: NodeJS.Timeout;
  private backpressureActive = false;

  constructor(options: EventProcessingOptions = {}) {
    this.options = {
      bufferSize: options.bufferSize ?? 1000,
      maxConcurrentHandlers: options.maxConcurrentHandlers ?? 10,
      processingRateLimit: options.processingRateLimit ?? 100,
      enableBackpressure: options.enableBackpressure ?? true,
      backpressureThreshold: options.backpressureThreshold ?? 500,
    };
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
  async processEventStream(eventStream: AsyncIterable<Event>): Promise<void> {
    if (this.processing) {
      throw new Error('EventProcessor is already processing a stream');
    }

    this.processing = true;
    this.backpressureActive = false;

    try {
      logger.info('Starting event stream processing');

      // Start the processing loop
      this.startProcessingLoop();

      // Consume events from the stream
      for await (const event of eventStream) {
        await this.addEvent(event);

        // Check for backpressure
        if (this.options.enableBackpressure && this.shouldApplyBackpressure()) {
          await this.applyBackpressure();
        }
      }

      // Wait for all queued events to be processed
      await this.waitForCompletion();

      logger.info('Event stream processing completed');
    } catch (error) {
      logger.error(`Error in event stream processing: ${error}`);
      throw error;
    } finally {
      this.processing = false;
      this.clearProcessingTimer();
    }
  }

  /**
   * Add an event to the processing buffer
   */
  private async addEvent(event: Event): Promise<void> {
    // Check buffer size limits
    if (this.eventBuffer.length >= this.options.bufferSize) {
      logger.warn(`Event buffer full (${this.eventBuffer.length}), dropping oldest event`);
      this.eventBuffer.shift(); // Remove oldest event
    }

    this.eventBuffer.push(event);
  }

  /**
   * Start the processing loop that handles events at a controlled rate
   */
  private startProcessingLoop(): void {
    const intervalMs = 1000 / this.options.processingRateLimit;

    this.processingTimer = setInterval(() => {
      this.processBatch().catch(error => {
        logger.error(`Error in processing batch: ${error}`);
      });
    }, intervalMs);
  }

  /**
   * Process a batch of events from the buffer
   */
  private async processBatch(): Promise<void> {
    if (this.eventBuffer.length === 0) {
      return;
    }

    // Limit concurrent handlers
    if (this.activeHandlers.size >= this.options.maxConcurrentHandlers) {
      return;
    }

    // Get next event (prioritize by event type)
    const event = this.getNextEvent();
    if (!event) {
      return;
    }

    // Find and execute handlers
    const handlerPromises = this.executeHandlers(event);
    if (handlerPromises.length > 0) {
      const processingPromise = Promise.all(handlerPromises).finally(() => {
        this.activeHandlers.delete(processingPromise);
      });

      this.activeHandlers.add(processingPromise);
      this.eventQueue.add(processingPromise);

      processingPromise.finally(() => {
        this.eventQueue.delete(processingPromise);
      });
    }
  }

  /**
   * Get the next event to process, prioritizing by handler priority
   */
  private getNextEvent(): Event | null {
    if (this.eventBuffer.length === 0) {
      return null;
    }

    // Find the highest priority event (one that has handlers with highest priority)
    let bestEvent: Event | null = null;
    let bestPriority = Number.MAX_SAFE_INTEGER;

    for (const event of this.eventBuffer) {
      const handlers = this.getHandlersForEvent(event);
      if (handlers.length === 0) {
        continue; // Skip events with no handlers
      }

      // Find the highest priority among handlers for this event
      const eventPriority = Math.min(...handlers.map(h => h.priority ?? 0));
      if (eventPriority < bestPriority) {
        bestPriority = eventPriority;
        bestEvent = event;
      }
    }

    if (bestEvent) {
      // Remove the event from buffer
      const index = this.eventBuffer.indexOf(bestEvent);
      this.eventBuffer.splice(index, 1);
    }

    return bestEvent;
  }

  /**
   * Execute all applicable handlers for an event
   */
  private executeHandlers(event: Event): Promise<void>[] {
    const handlers = this.getHandlersForEvent(event);
    const promises: Promise<void>[] = [];

    for (const handler of handlers) {
      try {
        const result = handler.handle(event as any);
        if (result instanceof Promise) {
          // Wrap the promise to catch rejections
          const wrappedPromise = result.catch(error => {
            logger.error(`Error in async event handler: ${error}`);
            // Don't re-throw - we want error isolation
          });
          promises.push(wrappedPromise);
        } else {
          promises.push(Promise.resolve());
        }
      } catch (error) {
        logger.error(`Error in event handler: ${error}`);
        // Continue with other handlers even if one fails
      }
    }

    return promises;
  }

  /**
   * Get all handlers that can handle the given event
   */
  private getHandlersForEvent(event: Event): EventHandler[] {
    const applicableHandlers: EventHandler[] = [];

    for (const handler of this.handlers.values()) {
      if (handler.canHandle(event)) {
        applicableHandlers.push(handler);
      }
    }

    // Sort by priority (lower number = higher priority)
    return applicableHandlers.sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
  }

  /**
   * Check if backpressure should be applied
   */
  private shouldApplyBackpressure(): boolean {
    return this.eventBuffer.length >= this.options.backpressureThreshold;
  }

  /**
   * Apply backpressure by temporarily pausing event consumption
   */
  private async applyBackpressure(): Promise<void> {
    if (this.backpressureActive) {
      return;
    }

    this.backpressureActive = true;
    logger.warn(`Applying backpressure: buffer size ${this.eventBuffer.length}`);

    // Wait for buffer to reduce, but with a timeout to prevent infinite waiting
    const startTime = Date.now();
    const maxWaitTime = 5000; // 5 seconds max wait
    const targetBufferSize = this.options.backpressureThreshold * 0.8;

    while (this.eventBuffer.length >= targetBufferSize && (Date.now() - startTime) < maxWaitTime) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // If buffer is still high after timeout, start dropping events
    if (this.eventBuffer.length >= targetBufferSize) {
      const eventsToDrop = Math.min(this.eventBuffer.length - Math.floor(targetBufferSize), 100);
      for (let i = 0; i < eventsToDrop; i++) {
        this.eventBuffer.shift();
      }
      logger.warn(`Backpressure timeout: dropped ${eventsToDrop} events`);
    }

    this.backpressureActive = false;
    logger.info('Backpressure released');
  }

  /**
   * Wait for all queued events to be processed
   */
  private async waitForCompletion(): Promise<void> {
    while (this.eventBuffer.length > 0 || this.eventQueue.size > 0) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }

  /**
   * Clear the processing timer
   */
  private clearProcessingTimer(): void {
    if (this.processingTimer) {
      clearInterval(this.processingTimer);
      this.processingTimer = undefined;
    }
  }

  /**
   * Get current processing metrics
   */
  getMetrics() {
    return {
      bufferSize: this.eventBuffer.length,
      activeHandlers: this.activeHandlers.size,
      queuedEvents: this.eventQueue.size,
      backpressureActive: this.backpressureActive,
      totalHandlers: this.handlers.size,
      isProcessing: this.processing,
    };
  }

  /**
   * Stop processing and clean up resources
   */
  async shutdown(): Promise<void> {
    this.processing = false;
    this.clearProcessingTimer();

    // Wait for active handlers to complete
    await Promise.all(Array.from(this.eventQueue));

    this.eventBuffer.length = 0;
    this.handlers.clear();
    this.activeHandlers.clear();
    this.eventQueue.clear();

    logger.info('EventProcessor shutdown complete');
  }
}