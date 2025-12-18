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

  private defaultConfig = {
    timeoutMs: 30 * 60 * 1000, // 30 minutes
    maxEvents: 10000,
    priority: 0,
  };

  constructor() {
  }

  /**
   * Create and start a new event stream
   */
  async createStream(
    eventStream: AsyncIterable<Event>,
    config: StreamConfig
  ): Promise<string> {
    if (this.activeStreams.has(config.id)) {
      throw new Error(`Stream with ID '${config.id}' already exists`);
    }

    // Create a dedicated processor for this stream
    const streamProcessor = new EventProcessor();

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
   * Process an event stream
   */
  private async processStream(activeStream: ActiveStream, eventStream: AsyncIterable<Event>): Promise<void> {
    const { id, config } = activeStream;

    // Create a counting wrapper around the event stream
    const countingEventStream = {
      async *[Symbol.asyncIterator]() {
        for await (const event of eventStream) {
          activeStream.eventCount++;
          yield event;
        }
      }
    };

    try {
      await activeStream.processor.processEventStream(countingEventStream);
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
    };
  }

  /**
   * Shutdown the manager and clean up all resources
   */
  async shutdown(): Promise<void> {
    await this.stopAllStreams();

    logger.info('EventStreamManager shutdown complete');
  }
}