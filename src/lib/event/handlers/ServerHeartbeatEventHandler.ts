import type { EventHandler } from '../EventProcessor.ts';
import type { Event as SdkEvent } from '@opencode-ai/sdk';
import { logger } from '../../utils/logger.ts';

export interface ServerHeartbeatEventHandlerOptions {
  enableHeartbeatLogging?: boolean;
  heartbeatInterval?: number; // Log every N heartbeats
  outputStream?: NodeJS.WritableStream;
}

// Extend EventHandler with any since server.heartbeat may not be in main Event union
export class ServerHeartbeatEventHandler implements EventHandler<any> {
  private options: Required<Omit<ServerHeartbeatEventHandlerOptions, 'heartbeatInterval'>> & { heartbeatInterval: number };
  private heartbeatCount = 0;

  constructor(options: ServerHeartbeatEventHandlerOptions = {}) {
    this.options = {
      enableHeartbeatLogging: options.enableHeartbeatLogging ?? false,
      heartbeatInterval: options.heartbeatInterval ?? 10, // Log every 10 heartbeats
      outputStream: options.outputStream ?? process.stdout,
    };
  }

  canHandle(event: SdkEvent): event is any {
    return (event as any).type === 'server.heartbeat';
  }

  async handle(event: SdkEvent): Promise<void> {
    try {
      this.heartbeatCount++;

      // Only log based on interval to avoid spam
      if (this.options.enableHeartbeatLogging && this.heartbeatCount % this.options.heartbeatInterval === 0) {
        const message = `💓 Server heartbeat #${this.heartbeatCount}`;
        this.writeToOutput(`${message}\n`);

        await logger.debug(`Server heartbeat received (count: ${this.heartbeatCount})`);
      }

      // Always log at debug level for monitoring
      await logger.debug(`Server heartbeat received (count: ${this.heartbeatCount}, timestamp: ${new Date().toISOString()})`);

    } catch (error) {
      await logger.error(`Error handling server heartbeat event: ${error}`);
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

  getHeartbeatCount(): number {
    return this.heartbeatCount;
  }

  reset(): void {
    this.heartbeatCount = 0;
  }
}