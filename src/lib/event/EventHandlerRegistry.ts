import type { Event } from '@opencode-ai/sdk';
import type { EventHandler } from './EventProcessor.ts';
import { logger } from '../utils/logger.ts';

export interface HandlerRegistration {
  name: string;
  handler: EventHandler;
  eventTypes?: string[]; // Optional: restrict to specific event types
  priority?: number;
}

export interface HandlerExecutionResult {
  handlerName: string;
  eventType: string;
  success: boolean;
  error?: Error;
  executionTime: number;
}

export class EventHandlerRegistry {
  private handlers = new Map<string, EventHandler>();
  private handlerMetadata = new Map<string, {
    eventTypes?: string[];
    priority: number;
    registrationTime: Date;
    executionCount: number;
    errorCount: number;
    totalExecutionTime: number;
  }>();
  private handlerToNameMap = new Map<EventHandler, string>();

  /**
   * Register a new event handler
   */
  registerHandler(registration: HandlerRegistration): void {
    const { name, handler, eventTypes, priority = 0 } = registration;

    if (this.handlers.has(name)) {
      throw new Error(`Handler with name '${name}' is already registered`);
    }

    this.handlers.set(name, handler);
    this.handlerToNameMap.set(handler, name);
    this.handlerMetadata.set(name, {
      eventTypes,
      priority,
      registrationTime: new Date(),
      executionCount: 0,
      errorCount: 0,
      totalExecutionTime: 0,
    });

    logger.info(`Registered event handler: ${name} (priority: ${priority})`);
  }

  /**
   * Unregister an event handler
   */
  unregisterHandler(name: string): void {
    if (!this.handlers.has(name)) {
      logger.warn(`Attempted to unregister non-existent handler: ${name}`);
      return;
    }

    const handler = this.handlers.get(name);
    if (handler) {
      this.handlerToNameMap.delete(handler);
    }
    this.handlers.delete(name);
    this.handlerMetadata.delete(name);
    logger.info(`Unregistered event handler: ${name}`);
  }

  /**
   * Get all handlers that can handle the given event
   */
  getHandlersForEvent(event: Event): EventHandler[] {
    const applicableHandlers: Array<{ handler: EventHandler; metadata: any }> = [];

    for (const [name, handler] of this.handlers.entries()) {
      const metadata = this.handlerMetadata.get(name)!;

      // Check if handler can handle this event
      if (!handler.canHandle(event)) {
        continue;
      }

      // Check event type restrictions
      if (metadata.eventTypes && !metadata.eventTypes.includes(event.type)) {
        continue;
      }

      applicableHandlers.push({ handler, metadata });
    }

    // Sort by priority (lower number = higher priority)
    return applicableHandlers
      .sort((a, b) => a.metadata.priority - b.metadata.priority)
      .map(item => item.handler);
  }

  /**
   * Execute handlers for an event with error isolation
   */
  async executeHandlersForEvent(event: Event): Promise<HandlerExecutionResult[]> {
    const handlers = this.getHandlersForEvent(event);
    const results: HandlerExecutionResult[] = [];

    logger.debug(`Executing ${handlers.length} handlers for event type: ${event.type}`);

    for (const handler of handlers) {
      // Find handler name for metadata tracking
      const handlerName = this.getHandlerName(handler);

      if (!handlerName) {
        logger.warn('Handler without registered name found, skipping metadata tracking');
        continue;
      }

      const metadata = this.handlerMetadata.get(handlerName)!;
      const startTime = Date.now();

      try {
        const result = handler.handle(event as any);
        if (result instanceof Promise) {
          await result;
        }

        const executionTime = Date.now() - startTime;
        metadata.executionCount++;
        metadata.totalExecutionTime += executionTime;

        results.push({
          handlerName,
          eventType: event.type,
          success: true,
          executionTime,
        });

        logger.debug(`Handler ${handlerName} executed successfully (${executionTime}ms)`);
      } catch (error) {
        const executionTime = Date.now() - startTime;
        metadata.executionCount++;
        metadata.errorCount++;
        metadata.totalExecutionTime += executionTime;

        const errorResult: HandlerExecutionResult = {
          handlerName,
          eventType: event.type,
          success: false,
          error: error instanceof Error ? error : new Error(String(error)),
          executionTime,
        };

        results.push(errorResult);

        logger.error(`Handler ${handlerName} failed: ${error} (${executionTime}ms)`);
      }
    }

    return results;
  }

  /**
   * Get the registered name for a handler instance
   */
  private getHandlerName(handler: EventHandler): string | null {
    return this.handlerToNameMap.get(handler) || null;
  }

  /**
   * Get handler statistics
   */
  getHandlerStats(handlerName?: string) {
    if (handlerName) {
      const metadata = this.handlerMetadata.get(handlerName);
      if (!metadata) {
        return null;
      }

      return {
        name: handlerName,
        ...metadata,
        averageExecutionTime: metadata.executionCount > 0
          ? metadata.totalExecutionTime / metadata.executionCount
          : 0,
        errorRate: metadata.executionCount > 0
          ? metadata.errorCount / metadata.executionCount
          : 0,
      };
    }

    // Return stats for all handlers
    const stats: any[] = [];
    for (const [name, metadata] of this.handlerMetadata.entries()) {
      stats.push({
        name,
        ...metadata,
        averageExecutionTime: metadata.executionCount > 0
          ? metadata.totalExecutionTime / metadata.executionCount
          : 0,
        errorRate: metadata.executionCount > 0
          ? metadata.errorCount / metadata.executionCount
          : 0,
      });
    }

    return stats;
  }

  /**
   * Get registry metrics
   */
  getMetrics() {
    const stats = this.getHandlerStats() as any[];
    const totalHandlers = stats.length;
    const totalExecutions = stats.reduce((sum: number, stat: any) => sum + stat.executionCount, 0);
    const totalErrors = stats.reduce((sum: number, stat: any) => sum + stat.errorCount, 0);

    return {
      totalHandlers,
      totalExecutions,
      totalErrors,
      errorRate: totalExecutions > 0 ? totalErrors / totalExecutions : 0,
      handlerStats: stats,
    };
  }

  /**
   * Reset execution statistics for all handlers
   */
  resetStats(): void {
    for (const metadata of this.handlerMetadata.values()) {
      metadata.executionCount = 0;
      metadata.errorCount = 0;
      metadata.totalExecutionTime = 0;
    }

    logger.info('Handler execution statistics reset');
  }

  /**
   * Clear all handlers and reset the registry
   */
  clear(): void {
    this.handlers.clear();
    this.handlerMetadata.clear();
    logger.info('EventHandlerRegistry cleared');
  }

  /**
   * Check if a handler is registered
   */
  hasHandler(name: string): boolean {
    return this.handlers.has(name);
  }

  /**
   * Get the number of registered handlers
   */
  getHandlerCount(): number {
    return this.handlers.size;
  }
}