import type { Event } from '@opencode-ai/sdk';
import type { EventHandler } from '../EventProcessor.ts';
import type { Event as SdkEvent } from '@opencode-ai/sdk';
import type { ToolPartUpdatedEvent, ToolPart } from '../../types/events.ts';
import { isToolEvent } from '../../utils/type-guards.ts';
import { logger } from '../../utils/logger.ts';

export interface ToolEventHandlerOptions {
  logLevel?: 'info' | 'debug' | 'tool';
  includeInputs?: boolean;
  redactSensitive?: boolean;
}

export class ToolEventHandler implements EventHandler<ToolPartUpdatedEvent> {
  private options: Required<ToolEventHandlerOptions>;

  constructor(options: ToolEventHandlerOptions = {}) {
    this.options = {
      logLevel: options.logLevel ?? 'tool',
      includeInputs: options.includeInputs ?? true,
      redactSensitive: options.redactSensitive ?? true,
    };
  }

  canHandle(event: SdkEvent): event is ToolPartUpdatedEvent {
    return isToolEvent(event);
  }

  async handle(event: ToolPartUpdatedEvent): Promise<void> {
    try {
      const toolPart = event.properties.part as ToolPart;

      // Only log when tool starts running (not pending/completed/error)
      if (toolPart.state.status !== 'running') {
        return;
      }

      const metadata = {
        callID: toolPart.callID,
        sessionID: toolPart.sessionID,
        messageID: toolPart.messageID,
        tool: toolPart.tool,
      };

      // Include input parameters if enabled
      if (this.options.includeInputs && toolPart.state.input) {
        let input = toolPart.state.input;

        // Redact sensitive information if enabled
        if (this.options.redactSensitive) {
          input = this.redactSensitiveData(input);
        }

        (metadata as any).input = input;
      }

      const message = `Tool called: ${toolPart.tool}`;

      // Log based on configured level
      switch (this.options.logLevel) {
        case 'debug':
          await logger.debug(`${message} ${JSON.stringify(metadata)}`);
          break;
        case 'info':
          await logger.info(`${message} ${JSON.stringify(metadata)}`);
          break;
        case 'tool':
        default:
          await logger.tool(message, metadata);
          break;
      }

    } catch (error) {
      await logger.error(`Error handling tool event: ${error}`);
    }
  }

  private redactSensitiveData(input: { [key: string]: unknown }): { [key: string]: unknown } {
    const redacted = { ...input };

    // Redact common sensitive patterns
    const sensitiveKeys = ['password', 'token', 'secret', 'key', 'auth'];

    for (const [key, value] of Object.entries(redacted)) {
      if (sensitiveKeys.some(sensitive => key.toLowerCase().includes(sensitive))) {
        redacted[key] = '[REDACTED]';
      } else if (typeof value === 'string' && value.length > 100) {
        // Truncate very long strings
        redacted[key] = value.substring(0, 100) + '...[TRUNCATED]';
      }
    }

    return redacted;
  }
}