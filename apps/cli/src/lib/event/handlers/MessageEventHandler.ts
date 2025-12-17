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
  private messageBuffer = new Map<string, { content: string; timestamp: number }>();
  private maxBufferSize = 100; // Maximum number of messages to keep in buffer
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

    const now = Date.now();
    if (initialText) {
      this.writeToOutput(initialText);
      this.messageBuffer.set(messageId, { content: initialText, timestamp: now });
    } else {
      this.messageBuffer.set(messageId, { content: '', timestamp: now });
    }

    logger.debug(`Started message: ${messageId}`);
  }

  private endMessage(messageId: string): void {
    const finalText = this.messageBuffer.get(messageId);
    if (finalText) {
      logger.debug(`Completed message: ${messageId} (${finalText.content.length} chars)`);
    }
    // Note: Buffer cleanup is now handled automatically by cleanupOldMessages()
  }

  private updateMessageBuffer(messageId: string, delta: string, fullText?: string): void {
    const now = Date.now();

    if (fullText) {
      // Full text provided, replace buffer
      this.messageBuffer.set(messageId, { content: fullText, timestamp: now });
    } else if (delta) {
      // Incremental update
      const existing = this.messageBuffer.get(messageId);
      const currentText = existing?.content || '';
      const newText = currentText + delta;
      this.messageBuffer.set(messageId, { content: newText, timestamp: now });
    }

    // Auto-cleanup old messages to prevent memory leaks
    this.cleanupOldMessages();
  }

  private cleanupOldMessages(): void {
    if (this.messageBuffer.size <= this.maxBufferSize) {
      return;
    }

    // Remove oldest messages when buffer gets too large
    const entries = Array.from(this.messageBuffer.entries());
    entries.sort((a, b) => a[1].timestamp - b[1].timestamp);

    const toRemove = entries.slice(0, entries.length - this.maxBufferSize + 10); // Keep some margin
    for (const [messageId] of toRemove) {
      this.messageBuffer.delete(messageId);
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
    const entry = this.messageBuffer.get(messageId);
    return entry ? entry.content : null;
  }
}