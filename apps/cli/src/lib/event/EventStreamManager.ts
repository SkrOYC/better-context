import type { Event } from '@opencode-ai/sdk';
import { EventProcessor } from './EventProcessor.ts';
import { logger } from '../utils/logger.ts';

export interface StreamConfig {
  id: string;
  description?: string;
  timeoutMs?: number;
  maxEvents?: number;
  priority?: number; // Lower number = higher priority
}

export interface ActiveStream {
  id: string;
  config: StreamConfig;
  processor: EventProcessor;
  startTime: Date;
  lastActivity: Date;
  eventCount: number;
  status: 'active' | 'completed' | 'error' | 'timeout';
  error?: Error;
}

export class EventStreamManager {
  private activeStreams = new Map<string, ActiveStream>();
  private streamPool = new Map<string, EventProcessor>();
  private cleanupInterval?: NodeJS.Timeout;

  private defaultConfig = {
    timeoutMs: 30 * 60 * 1000, // 30 minutes
    maxEvents: 10000,
    priority: 0,
  };

  constructor() {
    this.startCleanupInterval();
  }

  /**
   * Create and start a new event stream
   */
  async createStream(
    eventStream: AsyncIterable<Event>,
    config: StreamConfig,
    processor?: EventProcessor
  ): Promise<string> {
    if (this.activeStreams.has(config.id)) {
      throw new Error(`Stream with ID '${config.id}' already exists`);
    }

    // Use provided processor or get one from pool
    const streamProcessor = processor || this.getPooledProcessor(config.id);

    const activeStream: ActiveStream = {
      id: config.id,
      config: { ...this.defaultConfig, ...config },
      processor: streamProcessor,
      startTime: new Date(),
      lastActivity: new Date(),
      eventCount: 0,
      status: 'active',
    };

    this.activeStreams.set(config.id, activeStream);

    logger.info(`Created event stream: ${config.id} (${config.description || 'no description'})`);

    // Start processing in background
    this.processStream(activeStream, eventStream).catch(error => {
      logger.error(`Error processing stream ${config.id}: ${error}`);
      this.markStreamError(config.id, error);
    });

    return config.id;
  }

  /**
   * Get a processor from the pool or create a new one
   */
  private getPooledProcessor(streamId: string): EventProcessor {
    // Try to reuse an existing processor
    const availableProcessor = this.findAvailableProcessor();
    if (availableProcessor) {
      logger.debug(`Reusing pooled processor for stream: ${streamId}`);
      return availableProcessor;
    }

    // Create a new processor
    const processor = new EventProcessor({
      bufferSize: 500,
      maxConcurrentHandlers: 5,
      processingRateLimit: 50,
      enableBackpressure: true,
      backpressureThreshold: 200,
    });

    this.streamPool.set(streamId, processor);
    logger.debug(`Created new processor for stream: ${streamId}`);

    return processor;
  }

  /**
   * Find an available processor from the pool
   */
  private findAvailableProcessor(): EventProcessor | null {
    // Simple strategy: return the first available processor
    // In a more sophisticated implementation, this could consider load balancing
    for (const processor of this.streamPool.values()) {
      const metrics = processor.getMetrics();
      if (metrics.bufferSize === 0 && metrics.activeHandlers === 0) {
        return processor;
      }
    }
    return null;
  }

  /**
   * Process an event stream
   */
  private async processStream(activeStream: ActiveStream, eventStream: AsyncIterable<Event>): Promise<void> {
    const { id, config } = activeStream;

    try {
      await activeStream.processor.processEventStream(eventStream);
      this.markStreamCompleted(id);
    } catch (error) {
      this.markStreamError(id, error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /**
   * Mark a stream as completed
   */
  private markStreamCompleted(streamId: string): void {
    const stream = this.activeStreams.get(streamId);
    if (!stream) return;

    stream.status = 'completed';
    stream.lastActivity = new Date();
    logger.info(`Stream completed: ${streamId} (processed ${stream.eventCount} events)`);
  }

  /**
   * Mark a stream as having an error
   */
  private markStreamError(streamId: string, error: Error): void {
    const stream = this.activeStreams.get(streamId);
    if (!stream) return;

    stream.status = 'error';
    stream.error = error;
    stream.lastActivity = new Date();
    logger.error(`Stream error: ${streamId} - ${error.message}`);
  }

  /**
   * Mark a stream as timed out
   */
  private markStreamTimeout(streamId: string): void {
    const stream = this.activeStreams.get(streamId);
    if (!stream) return;

    stream.status = 'timeout';
    stream.lastActivity = new Date();
    logger.warn(`Stream timeout: ${streamId} (inactive for ${stream.config.timeoutMs}ms)`);
  }

  /**
   * Update activity timestamp for a stream
   */
  updateStreamActivity(streamId: string): void {
    const stream = this.activeStreams.get(streamId);
    if (stream) {
      stream.lastActivity = new Date();
    }
  }

  /**
   * Get information about an active stream
   */
  getStreamInfo(streamId: string): ActiveStream | null {
    return this.activeStreams.get(streamId) || null;
  }

  /**
   * Get all active streams
   */
  getAllStreams(): ActiveStream[] {
    return Array.from(this.activeStreams.values());
  }

  /**
   * Stop and remove a stream
   */
  async stopStream(streamId: string): Promise<void> {
    const stream = this.activeStreams.get(streamId);
    if (!stream) {
      logger.warn(`Attempted to stop non-existent stream: ${streamId}`);
      return;
    }

    try {
      await stream.processor.shutdown();
      this.activeStreams.delete(streamId);

      // Return processor to pool for reuse
      this.streamPool.set(streamId, stream.processor);

      logger.info(`Stream stopped: ${streamId}`);
    } catch (error) {
      logger.error(`Error stopping stream ${streamId}: ${error}`);
    }
  }

  /**
   * Stop all active streams
   */
  async stopAllStreams(): Promise<void> {
    const streamIds = Array.from(this.activeStreams.keys());
    logger.info(`Stopping ${streamIds.length} active streams`);

    const stopPromises = streamIds.map(id => this.stopStream(id));
    await Promise.all(stopPromises);

    logger.info('All streams stopped');
  }

  /**
   * Clean up stale streams (timed out or completed)
   */
  async cleanupStaleStreams(): Promise<number> {
    const now = Date.now();
    const streamsToRemove: string[] = [];

    for (const [id, stream] of this.activeStreams.entries()) {
      // Check for timeout
      const timeSinceActivity = now - stream.lastActivity.getTime();
      if (stream.status === 'active' && timeSinceActivity > stream.config.timeoutMs!) {
        this.markStreamTimeout(id);
        streamsToRemove.push(id);
      }

      // Check for completed/error streams that can be cleaned up
      if (stream.status !== 'active') {
        // Keep completed/error streams for a short time for debugging
        const timeSinceCompletion = now - stream.lastActivity.getTime();
        if (timeSinceCompletion > 60000) { // 1 minute
          streamsToRemove.push(id);
        }
      }
    }

    // Remove stale streams
    for (const id of streamsToRemove) {
      await this.stopStream(id);
    }

    if (streamsToRemove.length > 0) {
      logger.info(`Cleaned up ${streamsToRemove.length} stale streams`);
    }

    return streamsToRemove.length;
  }

  /**
   * Start the cleanup interval
   */
  private startCleanupInterval(): void {
    // Clean up every 5 minutes
    this.cleanupInterval = setInterval(() => {
      this.cleanupStaleStreams().catch(error => {
        logger.error(`Error in cleanup interval: ${error}`);
      });
    }, 5 * 60 * 1000);
  }

  /**
   * Get manager metrics
   */
  getMetrics() {
    const streams = this.getAllStreams();
    const activeStreams = streams.filter(s => s.status === 'active');
    const completedStreams = streams.filter(s => s.status === 'completed');
    const errorStreams = streams.filter(s => s.status === 'error');
    const timeoutStreams = streams.filter(s => s.status === 'timeout');

    const totalEvents = streams.reduce((sum, s) => sum + s.eventCount, 0);

    return {
      totalStreams: streams.length,
      activeStreams: activeStreams.length,
      completedStreams: completedStreams.length,
      errorStreams: errorStreams.length,
      timeoutStreams: timeoutStreams.length,
      totalEventsProcessed: totalEvents,
      pooledProcessors: this.streamPool.size,
    };
  }

  /**
   * Shutdown the manager and clean up all resources
   */
  async shutdown(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }

    await this.stopAllStreams();

    // Clean up processor pool
    for (const processor of this.streamPool.values()) {
      await processor.shutdown();
    }
    this.streamPool.clear();

    logger.info('EventStreamManager shutdown complete');
  }
}