import type { EventHandler } from '../EventProcessor.ts';
import type { Event as SdkEvent } from '@opencode-ai/sdk';
import type { PermissionRequestEvent } from '../../types/events.ts';
import { isPermissionRequestEvent } from '../../utils/type-guards.ts';
import { logger } from '../../utils/logger.ts';

export interface PermissionUpdatedEventHandlerOptions {
  enableStatusLogging?: boolean;
  outputStream?: NodeJS.WritableStream;
}

export class PermissionUpdatedEventHandler implements EventHandler<PermissionRequestEvent> {
  private options: Required<PermissionUpdatedEventHandlerOptions>;

  constructor(options: PermissionUpdatedEventHandlerOptions = {}) {
    this.options = {
      enableStatusLogging: options.enableStatusLogging ?? true,
      outputStream: options.outputStream ?? process.stdout,
    };
  }

  canHandle(event: SdkEvent): event is PermissionRequestEvent {
    return isPermissionRequestEvent(event);
  }

  async handle(event: PermissionRequestEvent): Promise<void> {
    try {
      const permissionID = event.properties.permissionID;
      const sessionID = event.properties.sessionID;
      const title = (event.properties as any).title || 'Permission request';
      const metadata = (event.properties as any).metadata || {};

      if (!this.options.enableStatusLogging) {
        return;
      }

      // Log permission update for tracking
      await logger.info(`Permission updated: ${JSON.stringify({
        permissionID,
        sessionID,
        title,
        metadata,
        timestamp: new Date().toISOString()
      })}`);

      // Provide user-friendly output
      const message = `🔐 Permission updated: ${title} [${permissionID}]`;
      this.writeToOutput(`${message}\n`);

    } catch (error) {
      await logger.error(`Error handling permission updated event: ${error}`);
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