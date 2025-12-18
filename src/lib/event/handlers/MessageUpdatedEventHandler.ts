import type { EventHandler } from '../EventProcessor.ts';
import type { Event as SdkEvent } from '@opencode-ai/sdk';
import type { MessageUpdatedEvent } from '../../types/events.ts';
import { isMessageUpdatedEvent } from '../../utils/type-guards.ts';
import { logger } from '../../utils/logger.ts';

export interface MessageUpdatedEventHandlerOptions {
  outputStream?: NodeJS.WritableStream;
  enableFormatting?: boolean;
}

export class MessageUpdatedEventHandler implements EventHandler<MessageUpdatedEvent> {
  private options: Required<MessageUpdatedEventHandlerOptions>;
  private outputtedMessages = new Set<string>();

  constructor(options: MessageUpdatedEventHandlerOptions = {}) {
    this.options = {
      outputStream: options.outputStream ?? process.stdout,
      enableFormatting: options.enableFormatting ?? true,
    };
  }

  canHandle(event: SdkEvent): event is MessageUpdatedEvent {
    return isMessageUpdatedEvent(event);
  }

  async handle(event: MessageUpdatedEvent): Promise<void> {
    try {
      // Extract message info from the correct location in event structure
      const messageInfo = event.properties.info;

      // Only handle assistant messages (user messages are just echoing our input)
      if (messageInfo.role !== 'assistant') {
        return;
      }

      // Extract text content
      const messageText = messageInfo.text || '';
      
      // Check if message has parts for more detailed content
      const parts = messageInfo.parts || [];

      // Only output once per message to prevent duplication
      if (!this.outputtedMessages.has(messageInfo.id)) {
        this.outputtedMessages.add(messageInfo.id);

        // Output main text content
        if (messageText) {
          this.writeToOutput(messageText);
        }

        // Process parts for additional content (like reasoning, files, etc.)
        for (const part of parts) {
          if (part.type === 'text' && part.text && part.text !== messageText) {
            // Additional text parts (like reasoning)
            this.writeToOutput(part.text);
          } else if (part.type === 'reasoning' && part.text) {
            // Reasoning content
            if (this.options.enableFormatting) {
              this.writeToOutput(`\n🤔 Reasoning:\n${part.text}\n`);
            } else {
              this.writeToOutput(part.text);
            }
          }
        }
      }

    } catch (error) {
      logger.error(`Error handling message updated event: ${error}`);
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