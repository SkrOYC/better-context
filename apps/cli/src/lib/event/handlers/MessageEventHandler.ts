import type { Event } from '@opencode-ai/sdk';
import type { EventHandler } from '../EventProcessor.ts';
import { logger } from '../../utils/logger.ts';

export interface MessageEventHandlerOptions {
  outputStream?: NodeJS.WritableStream;
  enableFormatting?: boolean;
  chunkSize?: number;
}

export class MessageEventHandler implements EventHandler<Event> {
  private currentMessageId: string | null = null;
  private messageBuffer = new Map<string, string>();
  private options: Required<MessageEventHandlerOptions>;

  constructor(options: MessageEventHandlerOptions = {}) {
    this.options = {
      outputStream: options.outputStream ?? process.stdout,
      enableFormatting: options.enableFormatting ?? true,
      chunkSize: options.chunkSize ?? 8192, // 8KB chunks
    };
  }

  canHandle(event: Event): boolean {
    return event.type === 'message.part.updated';
  }

  async handle(event: Event): Promise<void> {
    try {
      const part = (event.properties as any).part;
      if (!part || part.type !== 'text') {
        return; // Only handle text parts
      }

      const messageId = part.messageID;
      const delta = part.delta ?? '';
      const fullText = part.text;

      // Handle incremental updates
      if (messageId === this.currentMessageId) {
        // Continuation of current message
        this.writeToOutput(delta);
      } else {
        // New message
        if (this.currentMessageId !== null) {
          // End previous message
          this.endMessage(this.currentMessageId);
        }

        // Start new message
        this.startMessage(messageId, fullText);
      }

      // Update buffer
      this.updateMessageBuffer(messageId, delta, fullText);

    } catch (error) {
      logger.error(`Error handling message event: ${error}`);
      throw error;
    }
  }

  private startMessage(messageId: string, initialText?: string): void {
    this.currentMessageId = messageId;

    if (this.options.enableFormatting) {
      // Add formatting for new messages
      this.writeToOutput('\n\n');
    }

    if (initialText) {
      this.writeToOutput(initialText);
      this.messageBuffer.set(messageId, initialText);
    } else {
      this.messageBuffer.set(messageId, '');
    }

    logger.debug(`Started message: ${messageId}`);
  }

  private endMessage(messageId: string): void {
    const finalText = this.messageBuffer.get(messageId);
    if (finalText) {
      logger.debug(`Completed message: ${messageId} (${finalText.length} chars)`);
    }

    // Clean up buffer for completed messages after a delay
    // This allows for potential retries or corrections
    setTimeout(() => {
      this.messageBuffer.delete(messageId);
    }, 5000); // Keep for 5 seconds
  }

  private updateMessageBuffer(messageId: string, delta: string, fullText?: string): void {
    if (fullText) {
      // Full text provided, replace buffer
      this.messageBuffer.set(messageId, fullText);
    } else if (delta) {
      // Incremental update
      const currentText = this.messageBuffer.get(messageId) || '';
      const newText = currentText + delta;
      this.messageBuffer.set(messageId, newText);
    }
  }

  private writeToOutput(text: string): void {
    if (!text) return;

    try {
      // Handle chunking for large outputs
      if (text.length > this.options.chunkSize) {
        const chunks = this.chunkString(text, this.options.chunkSize);
        for (const chunk of chunks) {
          this.options.outputStream.write(chunk);
        }
      } else {
        this.options.outputStream.write(text);
      }
    } catch (error) {
      logger.error(`Error writing to output stream: ${error}`);
      // Fallback to console if output stream fails
      console.log(text);
    }
  }

  private chunkString(str: string, size: number): string[] {
    const chunks: string[] = [];
    for (let i = 0; i < str.length; i += size) {
      chunks.push(str.slice(i, i + size));
    }
    return chunks;
  }

  /**
   * Get current message information
   */
  getCurrentMessageInfo() {
    return {
      currentMessageId: this.currentMessageId,
      bufferedMessages: this.messageBuffer.size,
      messageIds: Array.from(this.messageBuffer.keys()),
    };
  }

  /**
   * Clear all message buffers
   */
  clearBuffers(): void {
    this.messageBuffer.clear();
    this.currentMessageId = null;
    logger.debug('Message buffers cleared');
  }

  /**
   * Get buffered content for a specific message
   */
  getBufferedContent(messageId: string): string | null {
    return this.messageBuffer.get(messageId) || null;
  }
}