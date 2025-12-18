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
  private outputtedMessages = new Set<string>();

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
       const messageID = (part as any).messageID;

       // Output incremental deltas for streaming
       if (delta) {
         this.writeToOutput(delta);
       }

       // Output full text only once per message to prevent duplication
       if (fullText && !this.outputtedMessages.has(messageID)) {
         this.outputtedMessages.add(messageID);
         this.writeToOutput(fullText);
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