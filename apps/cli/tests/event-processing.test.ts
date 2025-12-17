import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { Event } from '@opencode-ai/sdk';
import { EventProcessor } from '../src/lib/event/EventProcessor.ts';
import { EventHandlerRegistry } from '../src/lib/event/EventHandlerRegistry.ts';
import { EventStreamManager } from '../src/lib/event/EventStreamManager.ts';
import { MessageEventHandler } from '../src/lib/event/handlers/MessageEventHandler.ts';
import { SessionEventHandler } from '../src/lib/event/handlers/SessionEventHandler.ts';

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

describe('Event Processing System', () => {
  describe('EventProcessor', () => {
    let processor: EventProcessor;

    beforeEach(() => {
      processor = new EventProcessor({
        bufferSize: 100,
        maxConcurrentHandlers: 5,
        processingRateLimit: 10,
        enableBackpressure: false,
      });
    });

    afterEach(async () => {
      await processor.shutdown();
    });

    it('should buffer events when handlers are registered', async () => {
      const mockHandler = {
        canHandle: vi.fn().mockReturnValue(true),
        handle: vi.fn().mockResolvedValue(undefined),
        priority: 0,
      };

      processor.registerHandler('test-handler', mockHandler);

      // Create a simple event stream
      const events: Event[] = [
        { type: 'test.event', properties: {} },
        { type: 'test.event', properties: {} },
      ];

      const eventStream = {
        async *[Symbol.asyncIterator]() {
          for (const event of events) {
            yield event;
          }
        },
      };

      await processor.processEventStream(eventStream);

      expect(mockHandler.canHandle).toHaveBeenCalled();
      expect(mockHandler.handle).toHaveBeenCalledTimes(2);
    });

    it('should apply backpressure when buffer is full', async () => {
      const processor = new EventProcessor({
        bufferSize: 10,
        maxConcurrentHandlers: 1,
        processingRateLimit: 2, // Very slow processing
        enableBackpressure: true,
        backpressureThreshold: 5,
      });

      let handlerCallCount = 0;
      const slowHandler = {
        canHandle: vi.fn().mockReturnValue(true),
        handle: vi.fn().mockImplementation(async () => {
          handlerCallCount++;
          // Simulate very slow processing
          await new Promise(resolve => setTimeout(resolve, 200));
        }),
        priority: 0,
      };

      processor.registerHandler('slow-handler', slowHandler);

      // Create events faster than they can be processed
      const events: Event[] = Array.from({ length: 8 }, () => ({
        type: 'test.event',
        properties: {},
      }));

      const eventStream = {
        async *[Symbol.asyncIterator]() {
          for (const event of events) {
            yield event;
            // Yield events much faster than processing rate
            await new Promise(resolve => setTimeout(resolve, 50));
          }
        },
      };

      const startTime = Date.now();
      await processor.processEventStream(eventStream);
      const duration = Date.now() - startTime;

      // Should have taken significant time due to backpressure
      expect(duration).toBeGreaterThan(1000);
      expect(handlerCallCount).toBe(8);
    }, 10000); // Increase timeout for this test

    it('should handle handler errors gracefully', async () => {
      const errorHandler = {
        canHandle: vi.fn().mockReturnValue(true),
        handle: vi.fn().mockRejectedValue(new Error('Handler error')),
        priority: 0,
      };

      processor.registerHandler('error-handler', errorHandler);

      const eventStream = {
        async *[Symbol.asyncIterator]() {
          yield { type: 'test.event', properties: {} };
        },
      };

      // Should complete successfully despite handler error
      await expect(processor.processEventStream(eventStream)).resolves.toBeUndefined();
      expect(errorHandler.handle).toHaveBeenCalled();
    });
  });

  describe('EventHandlerRegistry', () => {
    let registry: EventHandlerRegistry;

    beforeEach(() => {
      registry = new EventHandlerRegistry();
    });

    it('should register and retrieve handlers', () => {
      const handler = {
        canHandle: vi.fn().mockReturnValue(true),
        handle: vi.fn().mockResolvedValue(undefined),
      };

      registry.registerHandler({
        name: 'test-handler',
        handler,
        priority: 0,
      });

      expect(registry.hasHandler('test-handler')).toBe(true);
      expect(registry.getHandlerCount()).toBe(1);
    });

    it('should execute handlers with error isolation', async () => {
      const goodHandler = {
        canHandle: vi.fn().mockReturnValue(true),
        handle: vi.fn().mockResolvedValue(undefined),
      };

      const badHandler = {
        canHandle: vi.fn().mockReturnValue(true),
        handle: vi.fn().mockRejectedValue(new Error('Handler failed')),
      };

      registry.registerHandler({
        name: 'good-handler',
        handler: goodHandler,
        priority: 0,
      });

      registry.registerHandler({
        name: 'bad-handler',
        handler: badHandler,
        priority: 0,
      });

      const event: Event = { type: 'test.event', properties: {} };
      const results = await registry.executeHandlersForEvent(event);

      expect(results).toHaveLength(2);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(false);
      expect(results[1].error).toBeInstanceOf(Error);
    });

    it('should respect event type restrictions', async () => {
      const restrictedHandler = {
        canHandle: vi.fn().mockReturnValue(true),
        handle: vi.fn().mockResolvedValue(undefined),
      };

      registry.registerHandler({
        name: 'restricted-handler',
        handler: restrictedHandler,
        eventTypes: ['allowed.event'],
        priority: 0,
      });

      const allowedEvent: Event = { type: 'allowed.event', properties: {} };
      const restrictedEvent: Event = { type: 'restricted.event', properties: {} };

      const allowedResults = await registry.executeHandlersForEvent(allowedEvent);
      const restrictedResults = await registry.executeHandlersForEvent(restrictedEvent);

      expect(allowedResults).toHaveLength(1);
      expect(restrictedResults).toHaveLength(0);
    });

    it('should sort handlers by priority', () => {
      const handler1 = {
        canHandle: vi.fn().mockReturnValue(true),
        handle: vi.fn().mockResolvedValue(undefined),
        priority: 1,
      };

      const handler2 = {
        canHandle: vi.fn().mockReturnValue(true),
        handle: vi.fn().mockResolvedValue(undefined),
        priority: -1,
      };

      registry.registerHandler({
        name: 'handler1',
        handler: handler1,
        priority: 1,
      });

      registry.registerHandler({
        name: 'handler2',
        handler: handler2,
        priority: -1,
      });

      const event: Event = { type: 'test.event', properties: {} };
      const handlers = registry.getHandlersForEvent(event);

      // Handler with lower priority number should come first
      expect(handlers[0]).toBe(handler2);
      expect(handlers[1]).toBe(handler1);
    });
  });

  describe('EventStreamManager', () => {
    let manager: EventStreamManager;

    beforeEach(() => {
      manager = new EventStreamManager();
    });

    afterEach(async () => {
      await manager.shutdown();
    });

    it('should create and manage streams', async () => {
      const eventStream = {
        async *[Symbol.asyncIterator]() {
          yield { type: 'test.event', properties: {} };
        },
      };

      const streamId = await manager.createStream(eventStream, {
        id: 'test-stream',
        description: 'Test stream',
      });

      expect(streamId).toBe('test-stream');

      const streamInfo = manager.getStreamInfo('test-stream');
      expect(streamInfo).toBeTruthy();
      expect(streamInfo!.status).toBe('active');
    });

    it('should cleanup completed streams', async () => {
      const eventStream = {
        async *[Symbol.asyncIterator]() {
          yield { type: 'test.event', properties: {} };
        },
      };

      await manager.createStream(eventStream, {
        id: 'test-stream',
      });

      // Wait for stream to complete
      await new Promise(resolve => setTimeout(resolve, 100));

      const cleanedCount = await manager.cleanupStaleStreams();
      expect(cleanedCount).toBeGreaterThanOrEqual(0);
    });

    it('should handle stream timeouts', async () => {
      const eventStream = {
        async *[Symbol.asyncIterator]() {
          // Never yield any events, simulating a hanging stream
          await new Promise(() => {}); // Never resolves
        },
      };

      await manager.createStream(eventStream, {
        id: 'timeout-stream',
        timeoutMs: 100, // Very short timeout
      });

      // Wait for timeout
      await new Promise(resolve => setTimeout(resolve, 200));

      const cleanedCount = await manager.cleanupStaleStreams();
      expect(cleanedCount).toBe(1);

      const streamInfo = manager.getStreamInfo('timeout-stream');
      expect(streamInfo).toBeNull();
    });
  });

  describe('MessageEventHandler', () => {
    let handler: MessageEventHandler;
    let mockStdout: any;

    beforeEach(() => {
      mockStdout = {
        write: vi.fn(),
      };
      handler = new MessageEventHandler({
        outputStream: mockStdout,
        enableFormatting: true,
      });
    });

    it('should handle message part updated events', () => {
      const event: Event = {
        type: 'message.part.updated',
        properties: {
          part: {
            type: 'text',
            messageID: 'test-message',
            text: 'Hello world',
            delta: 'Hello',
          },
        },
      };

      expect(handler.canHandle(event)).toBe(true);
    });

    it('should write message text to output stream', async () => {
      const event: Event = {
        type: 'message.part.updated',
        properties: {
          part: {
            type: 'text',
            messageID: 'test-message',
            text: 'Hello world',
          },
        },
      };

      await handler.handle(event);

      expect(mockStdout.write).toHaveBeenCalledWith('\n\n');
      expect(mockStdout.write).toHaveBeenCalledWith('Hello world');
    });

    it('should handle incremental message updates', async () => {
      // First event with full text
      const event1: Event = {
        type: 'message.part.updated',
        properties: {
          part: {
            type: 'text',
            messageID: 'test-message',
            text: 'Hello',
          },
        },
      };

      // Second event with delta
      const event2: Event = {
        type: 'message.part.updated',
        properties: {
          part: {
            type: 'text',
            messageID: 'test-message',
            delta: ' world',
          },
        },
      };

      await handler.handle(event1);
      await handler.handle(event2);

      expect(mockStdout.write).toHaveBeenCalledWith('\n\n');
      expect(mockStdout.write).toHaveBeenCalledWith('Hello');
      expect(mockStdout.write).toHaveBeenCalledWith(' world');
    });

    it('should track message buffer state', async () => {
      const event: Event = {
        type: 'message.part.updated',
        properties: {
          part: {
            type: 'text',
            messageID: 'test-message',
            text: 'Test content',
          },
        },
      };

      await handler.handle(event);

      const info = handler.getCurrentMessageInfo();
      expect(info.currentMessageId).toBe('test-message');
      expect(info.bufferedMessages).toBe(1);
    });
  });

  describe('SessionEventHandler', () => {
    let handler: SessionEventHandler;

    beforeEach(() => {
      handler = new SessionEventHandler();
    });

    it('should handle session events', () => {
      const errorEvent: Event = {
        type: 'session.error',
        properties: { sessionID: 'test-session' },
      };

      const idleEvent: Event = {
        type: 'session.idle',
        properties: { sessionID: 'test-session' },
      };

      expect(handler.canHandle(errorEvent)).toBe(true);
      expect(handler.canHandle(idleEvent)).toBe(true);
    });

    it('should handle session error events', async () => {
      const onError = vi.fn();
      handler.setErrorCallback(onError);

      const errorEvent: Event = {
        type: 'session.error',
        properties: {
          sessionID: 'test-session',
          error: { name: 'TestError' },
        },
      };

      await expect(handler.handle(errorEvent)).rejects.toThrow();
      expect(onError).toHaveBeenCalledWith('test-session', expect.any(Error));
    });

    it('should handle session idle events', async () => {
      const onComplete = vi.fn();
      handler.setCompleteCallback(onComplete);

      const idleEvent: Event = {
        type: 'session.idle',
        properties: { sessionID: 'test-session' },
      };

      await handler.handle(idleEvent);
      expect(onComplete).toHaveBeenCalledWith('test-session');
    });
  });

  describe('Integration Tests', () => {
    it('should process events end-to-end', async () => {
      // Create a complete event processing pipeline
      const processor = new EventProcessor();
      const registry = new EventHandlerRegistry();
      const manager = new EventStreamManager();

      // Register handlers
      const messageHandler = new MessageEventHandler({
        outputStream: { write: vi.fn() },
      });

      const sessionHandler = SessionEventHandler.createDefaultHandler();

      registry.registerHandler({
        name: 'message-handler',
        handler: messageHandler,
        eventTypes: ['message.part.updated'],
      });

      registry.registerHandler({
        name: 'session-handler',
        handler: sessionHandler,
        eventTypes: ['session.error', 'session.idle'],
      });

      // Register with processor
      processor.registerHandler('message-handler', messageHandler);
      processor.registerHandler('session-handler', sessionHandler);

      // Create event stream with mixed event types
      const events: Event[] = [
        {
          type: 'message.part.updated',
          properties: {
            part: {
              type: 'text',
              messageID: 'msg-1',
              text: 'Processing request...',
            },
          },
        },
        {
          type: 'session.idle',
          properties: { sessionID: 'session-1' },
        },
      ];

      const eventStream = {
        async *[Symbol.asyncIterator]() {
          for (const event of events) {
            yield event;
          }
        },
      };

      // Create stream and process events
      await manager.createStream(eventStream, {
        id: 'integration-test-stream',
      }, processor);

      // Wait for processing to complete
      await new Promise(resolve => setTimeout(resolve, 100));

      // Cleanup
      await manager.shutdown();
      await processor.shutdown();

      // Verify handlers were called appropriately
      expect(messageHandler.getCurrentMessageInfo().bufferedMessages).toBe(1);
    });
  });
});