import type { EventHandler } from '../EventProcessor.ts';
import type { Event as SdkEvent } from '@opencode-ai/sdk';
import type { MessagePartUpdatedEvent } from '../../types/events.ts';
import { isMessageEvent, isTextMessagePart } from '../../utils/type-guards.ts';
import { logger } from '../../utils/logger.ts';

export interface MessageEventHandlerOptions {
  outputStream?: NodeJS.WritableStream;
  enableFormatting?: boolean;
}

export class MessageEventHandler implements EventHandler<MessagePartUpdatedEvent> {
  private options: Required<MessageEventHandlerOptions>;

  constructor(options: MessageEventHandlerOptions = {}) {
    this.options = {
      outputStream: options.outputStream ?? process.stdout,
      enableFormatting: options.enableFormatting ?? true,
    };
  }

  canHandle(event: SdkEvent): event is MessagePartUpdatedEvent {
    return isMessageEvent(event);
  }

  async handle(event: MessagePartUpdatedEvent): Promise<void> {
    try {
      // Type-safe access to event properties
      const part = event.properties.part;

      // Only handle text message parts
      if (!isTextMessagePart(part)) {
        return;
      }

      const delta = (part as any).delta ?? '';
      const fullText = (part as any).text;

      if (fullText) {
        // Full text available
        if (this.options.enableFormatting) {
          this.writeToOutput('\n\n');
        }
        this.writeToOutput(fullText);
      } else if (delta) {
        // Incremental update
        this.writeToOutput(delta);
      }

    } catch (error) {
      logger.error(`Error handling message event: ${error}`);
      throw error;
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