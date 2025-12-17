// Mock logger to avoid console output during tests
vi.mock('../src/lib/utils/logger.ts', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    resource: vi.fn(),
    metrics: vi.fn(),
  },
}));

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Event } from '@opencode-ai/sdk';
import { MessageEventHandler } from '../src/lib/event/handlers/MessageEventHandler.ts';
import { SessionEventHandler } from '../src/lib/event/handlers/SessionEventHandler.ts';
import {
  isMessageEvent,
  isSessionErrorEvent,
  isSessionIdleEvent,
  hasSessionId,
  isTextMessagePart,
  isSdkError,
  isValidSessionResponse
} from '../src/lib/utils/type-guards.ts';
import type {
  MessagePartUpdatedEvent,
  SessionErrorEvent,
  SessionIdleEvent,
  SdkEvent
} from '../src/lib/types/events.ts';
import type { SdkResponse, SdkError } from '../src/lib/types/sdk-responses.ts';

describe('Type Safety System', () => {
  describe('Type Guards', () => {
    describe('Event Type Guards', () => {
      it('should correctly identify message events', () => {
        const validMessageEvent: MessagePartUpdatedEvent = {
          type: 'message.part.updated',
          properties: {
            part: {
              messageID: 'msg-123',
              type: 'text',
              text: 'Hello world',
              delta: 'Hello'
            }
          }
        };

        const invalidEvent: Event = {
          type: 'unknown.event',
          properties: {}
        };

        const incompleteMessageEvent: Event = {
          type: 'message.part.updated',
          properties: {}
        };

        expect(isMessageEvent(validMessageEvent)).toBe(true);
        expect(isMessageEvent(invalidEvent)).toBe(false);
        expect(isMessageEvent(incompleteMessageEvent)).toBe(false);
      });

      it('should correctly identify session error events', () => {
        const errorEvent: SessionErrorEvent = {
          type: 'session.error',
          properties: {
            sessionID: 'session-123',
            error: {
              name: 'TestError',
              message: 'Something went wrong'
            }
          }
        };

        const idleEvent: Event = {
          type: 'session.idle',
          properties: { sessionID: 'session-123' }
        };

        expect(isSessionErrorEvent(errorEvent)).toBe(true);
        expect(isSessionErrorEvent(idleEvent)).toBe(false);
      });

      it('should correctly identify session idle events', () => {
        const idleEvent: SessionIdleEvent = {
          type: 'session.idle',
          properties: {
            sessionID: 'session-123'
          }
        };

        const errorEvent: Event = {
          type: 'session.error',
          properties: { sessionID: 'session-123' }
        };

        expect(isSessionIdleEvent(idleEvent)).toBe(true);
        expect(isSessionIdleEvent(errorEvent)).toBe(false);
      });

      it('should correctly identify events with session IDs', () => {
        const eventWithSessionId: Event = {
          type: 'message.part.updated',
          properties: { sessionID: 'session-123' }
        };

        const eventWithoutSessionId: Event = {
          type: 'global.event',
          properties: {}
        };

        expect(hasSessionId(eventWithSessionId)).toBe(true);
        expect(hasSessionId(eventWithoutSessionId)).toBe(false);
      });
    });

    describe('Message Part Guards', () => {
      it('should correctly identify text message parts', () => {
        const textPart = {
          messageID: 'msg-123',
          type: 'text' as const,
          text: 'Hello world',
          delta: 'Hello'
        };

        const imagePart = {
          messageID: 'msg-456',
          type: 'image' as const,
          // image data would go here
        };

        expect(isTextMessagePart(textPart)).toBe(true);
        expect(isTextMessagePart(imagePart)).toBe(false);
        expect(isTextMessagePart({})).toBe(false);
      });
    });

    describe('SDK Error Guards', () => {
      it('should correctly identify SDK error objects', () => {
        const validError: SdkError = {
          name: 'ValidationError',
          message: 'Invalid input',
          code: 'VALIDATION_FAILED'
        };

        const partialError = { message: 'Something happened' };
        const invalidError = { type: 'not-an-error' };

        expect(isSdkError(validError)).toBe(true);
        expect(isSdkError(partialError)).toBe(true); // Has message
        expect(isSdkError(invalidError)).toBe(false);
        expect(isSdkError(null)).toBe(false);
        expect(isSdkError({})).toBe(false);
      });
    });

    describe('Session Response Guards', () => {
      it('should correctly validate session responses', () => {
        const validResponse = {
          data: { id: 'session-123' }
        };

        const invalidResponse = {
          data: { name: 'not-a-session' }
        };

        const errorResponse = {
          error: { message: 'Failed to create session' }
        };

        expect(isValidSessionResponse(validResponse)).toBe(true);
        expect(isValidSessionResponse(invalidResponse)).toBe(false);
        expect(isValidSessionResponse(errorResponse)).toBe(false);
      });
    });
  });

  describe('Event Handlers Type Safety', () => {
    describe('MessageEventHandler', () => {
      let mockStdout: any;

      beforeEach(() => {
        mockStdout = {
          write: vi.fn(),
        };
      });

      it('should handle message events with proper typing', async () => {
        const handler = new MessageEventHandler({
          outputStream: mockStdout,
          enableFormatting: true,
        });

        const messageEvent = {
          type: 'message.part.updated',
          properties: {
            part: {
              messageID: 'msg-123',
              type: 'text',
              text: 'Hello world',
              delta: 'Hello'
            }
          }
        } as MessagePartUpdatedEvent;

        const invalidEvent: Event = {
          type: 'unknown.event',
          properties: {}
        };

        expect(handler.canHandle(messageEvent)).toBe(true);
        expect(handler.canHandle(invalidEvent)).toBe(false);

        // Should not throw when handling valid message event
        try {
          await handler.handle(messageEvent);
          expect(true).toBe(true); // Success case
        } catch (error) {
          console.log('Unexpected error:', error);
          throw error;
        }
      });

      it('should reject non-text message parts', async () => {
        const handler = new MessageEventHandler({
          outputStream: mockStdout,
          enableFormatting: true,
        });

        const imageMessageEvent: MessagePartUpdatedEvent = {
          type: 'message.part.updated',
          properties: {
            part: {
              messageID: 'msg-123',
              type: 'image',
              // No text content - this will be filtered out by type guard
            } as any
          }
        };

        // Should handle the event but not write anything (early return for non-text)
        try {
          await handler.handle(imageMessageEvent);
          expect(true).toBe(true); // Success case - no text to write
        } catch (error) {
          console.log('Unexpected error in image handler:', error);
          throw error;
        }
      });
    });

    describe('SessionEventHandler', () => {
      it('should handle session events with proper discriminated unions', async () => {
        const handler = new SessionEventHandler();

        const errorEvent: SessionErrorEvent = {
          type: 'session.error',
          properties: {
            sessionID: 'session-123',
            error: {
              name: 'TestError',
              message: 'Session failed'
            }
          }
        };

        const idleEvent: SessionIdleEvent = {
          type: 'session.idle',
          properties: {
            sessionID: 'session-456'
          }
        };

        const unknownEvent: Event = {
          type: 'unknown.event',
          properties: {}
        };

        expect(handler.canHandle(errorEvent)).toBe(true);
        expect(handler.canHandle(idleEvent)).toBe(true);
        expect(handler.canHandle(unknownEvent)).toBe(false);
      });

      it('should handle session error events safely', async () => {
        const onError = vi.fn();
        const handler = new SessionEventHandler({
          onSessionError: onError
        });

        const errorEvent: SessionErrorEvent = {
          type: 'session.error',
          properties: {
            sessionID: 'session-123',
            error: {
              name: 'TestError',
              message: 'Something broke'
            }
          }
        };

        // Should call error callback and throw
        await expect(handler.handle(errorEvent)).rejects.toThrow('SESSION ERROR');
        expect(onError).toHaveBeenCalledWith('session-123', expect.any(Error));
      });

      it('should handle session idle events safely', async () => {
        const onComplete = vi.fn();
        const handler = new SessionEventHandler({
          onSessionComplete: onComplete
        });

        const idleEvent: SessionIdleEvent = {
          type: 'session.idle',
          properties: {
            sessionID: 'session-456'
          }
        };

        try {
          await handler.handle(idleEvent);
          expect(true).toBe(true); // Success case
        } catch (error) {
          console.log('Unexpected error in idle handler:', error);
          throw error;
        }
        expect(onComplete).toHaveBeenCalledWith('session-456');
      });
    });
  });

  describe('SDK Response Type Safety', () => {
    it('should handle SDK response structures correctly', () => {
      const successResponse: SdkResponse<string> = {
        data: 'session-123'
      };

      const errorResponse: SdkResponse<string> = {
        error: {
          name: 'ValidationError',
          message: 'Invalid input'
        }
      };

      const emptyResponse: SdkResponse<string> = {};

      // Type checks should work correctly
      expect(successResponse.data).toBe('session-123');
      expect(errorResponse.error?.name).toBe('ValidationError');
      expect(emptyResponse.data).toBeUndefined();
      expect(emptyResponse.error).toBeUndefined();
    });

    it('should maintain type safety with discriminated unions', () => {
      // Test that discriminated unions work correctly
      const events: SdkEvent[] = [];

      const messageEvent: MessagePartUpdatedEvent = {
        type: 'message.part.updated',
        properties: {
          part: {
            messageID: 'msg-1',
            type: 'text',
            text: 'test'
          }
        }
      };

      const errorEvent: SessionErrorEvent = {
        type: 'session.error',
        properties: {
          sessionID: 'session-1',
          error: { message: 'error' }
        }
      };

      const idleEvent: SessionIdleEvent = {
        type: 'session.idle',
        properties: {
          sessionID: 'session-1'
        }
      };

      events.push(messageEvent, errorEvent, idleEvent);

      // Type narrowing should work
      events.forEach(event => {
        switch (event.type) {
          case 'message.part.updated':
            expect(event.properties.part.messageID).toBeDefined();
            break;
          case 'session.error':
            expect(event.properties.error).toBeDefined();
            break;
          case 'session.idle':
            expect(event.properties.sessionID).toBeDefined();
            break;
        }
      });
    });
  });
});