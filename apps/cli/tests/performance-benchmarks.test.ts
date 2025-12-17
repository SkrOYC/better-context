import { describe, it, expect, beforeEach } from 'vitest';
import { Event } from '@opencode-ai/sdk';
import { EventProcessor } from '../src/lib/event/EventProcessor.ts';
import { EventStreamManager } from '../src/lib/event/EventStreamManager.ts';
import { MessageEventHandler } from '../src/lib/event/handlers/MessageEventHandler.ts';
import { BackpressureController } from '../src/lib/event/BackpressureController.ts';

describe('Event Processing Performance Benchmarks', () => {
  describe('EventProcessor Performance', () => {
    let processor: EventProcessor;

    beforeEach(() => {
      processor = new EventProcessor({
        bufferSize: 5000,
        maxConcurrentHandlers: 10,
        processingRateLimit: 1000,
        enableBackpressure: true,
        backpressureThreshold: 1000,
      });
    });

    afterEach(async () => {
      await processor.shutdown();
    });

    it('should handle high-volume event streams efficiently', async () => {
      const messageHandler = new MessageEventHandler({
        outputStream: { write: vi.fn() },
        enableFormatting: false, // Disable formatting for performance
      });

      processor.registerHandler('message-handler', messageHandler);

      // Generate a high volume of events
      const eventCount = 10000;
      const events: Event[] = Array.from({ length: eventCount }, (_, i) => ({
        type: 'message.part.updated',
        properties: {
          part: {
            type: 'text',
            messageID: `msg-${i}`,
            text: `Message content ${i}`,
          },
        },
      }));

      const eventStream = {
        async *[Symbol.asyncIterator]() {
          for (const event of events) {
            yield event;
          }
        },
      };

      const startTime = Date.now();
      const startMemory = process.memoryUsage().heapUsed;

      await processor.processEventStream(eventStream);

      const endTime = Date.now();
      const endMemory = process.memoryUsage().heapUsed;

      const duration = endTime - startTime;
      const memoryDelta = endMemory - startMemory;
      const eventsPerSecond = (eventCount / duration) * 1000;

      console.log(`High-volume test results:
        Events processed: ${eventCount}
        Duration: ${duration}ms
        Events/second: ${eventsPerSecond.toFixed(2)}
        Memory delta: ${(memoryDelta / 1024 / 1024).toFixed(2)}MB`);

      // Performance expectations
      expect(eventsPerSecond).toBeGreaterThan(500); // At least 500 events/second
      expect(memoryDelta).toBeLessThan(50 * 1024 * 1024); // Less than 50MB memory increase
      expect(duration).toBeLessThan(30000); // Complete within 30 seconds
    });

    it('should maintain performance under backpressure', async () => {
      const slowHandler = {
        canHandle: vi.fn().mockReturnValue(true),
        handle: vi.fn().mockImplementation(async () => {
          // Simulate variable processing time
          await new Promise(resolve => setTimeout(resolve, Math.random() * 10));
        }),
        priority: 0,
      };

      processor.registerHandler('slow-handler', slowHandler);

      const eventCount = 1000;
      const events: Event[] = Array.from({ length: eventCount }, () => ({
        type: 'test.event',
        properties: {},
      }));

      const eventStream = {
        async *[Symbol.asyncIterator]() {
          for (const event of events) {
            yield event;
            // Yield events at high frequency to trigger backpressure
            await new Promise(resolve => setTimeout(resolve, 1));
          }
        },
      };

      const startTime = Date.now();
      await processor.processEventStream(eventStream);
      const duration = endTime - startTime;

      const metrics = processor.getMetrics();

      console.log(`Backpressure test results:
        Events processed: ${eventCount}
        Duration: ${duration}ms
        Backpressure active: ${metrics.backpressureActive}
        Final buffer size: ${metrics.bufferSize}`);

      // Should complete without throwing
      expect(duration).toBeGreaterThan(1000); // Should take some time due to backpressure
      expect(metrics.bufferSize).toBe(0); // All events should be processed
    });
  });

  describe('EventStreamManager Performance', () => {
    let manager: EventStreamManager;

    beforeEach(() => {
      manager = new EventStreamManager();
    });

    afterEach(async () => {
      await manager.shutdown();
    });

    it('should handle multiple concurrent streams efficiently', async () => {
      const streamCount = 10;
      const eventsPerStream = 100;
      const streams: Promise<string>[] = [];

      for (let i = 0; i < streamCount; i++) {
        const eventStream = {
          async *[Symbol.asyncIterator]() {
            for (let j = 0; j < eventsPerStream; j++) {
              yield { type: 'test.event', properties: { streamId: i, eventId: j } };
              await new Promise(resolve => setTimeout(resolve, 1));
            }
          },
        };

        streams.push(manager.createStream(eventStream, {
          id: `stream-${i}`,
          description: `Test stream ${i}`,
        }));
      }

      const startTime = Date.now();
      await Promise.all(streams);
      const duration = Date.now() - startTime;

      // Wait for all streams to complete processing
      await new Promise(resolve => setTimeout(resolve, 200));

      const metrics = manager.getMetrics();

      console.log(`Concurrent streams test results:
        Streams created: ${streamCount}
        Events per stream: ${eventsPerStream}
        Total events: ${streamCount * eventsPerStream}
        Duration: ${duration}ms
        Active streams: ${metrics.activeStreams}
        Pooled processors: ${metrics.pooledProcessors}`);

      expect(metrics.totalStreams).toBe(streamCount);
      expect(metrics.totalEventsProcessed).toBe(streamCount * eventsPerStream);
    });

    it('should efficiently clean up stale streams', async () => {
      // Create several streams
      const streamPromises: Promise<string>[] = [];
      for (let i = 0; i < 5; i++) {
        const eventStream = {
          async *[Symbol.asyncIterator]() {
            yield { type: 'test.event', properties: {} };
          },
        };

        streamPromises.push(manager.createStream(eventStream, {
          id: `cleanup-test-${i}`,
          timeoutMs: 100, // Short timeout
        }));
      }

      await Promise.all(streamPromises);

      // Wait for streams to timeout
      await new Promise(resolve => setTimeout(resolve, 200));

      const cleanedCount = await manager.cleanupStaleStreams();
      const finalMetrics = manager.getMetrics();

      console.log(`Cleanup test results:
        Streams cleaned up: ${cleanedCount}
        Remaining streams: ${finalMetrics.totalStreams}`);

      expect(cleanedCount).toBe(5);
      expect(finalMetrics.totalStreams).toBe(0);
    });
  });

  describe('BackpressureController Performance', () => {
    let controller: BackpressureController;

    beforeEach(() => {
      controller = new BackpressureController({
        maxEventRate: 500,
        monitoringWindowMs: 1000,
        throttleThreshold: 80,
        uiResponsivenessCheck: false, // Disable UI checks for performance testing
      });
    });

    it('should throttle high-frequency events', async () => {
      const eventCount = 1000;
      let processedCount = 0;

      const startTime = Date.now();

      // Simulate high-frequency event processing
      for (let i = 0; i < eventCount; i++) {
        const event: Event = { type: 'test.event', properties: {} };
        const shouldProcess = await controller.processEvent(event);

        if (shouldProcess) {
          processedCount++;
          // Simulate processing time
          await new Promise(resolve => setTimeout(resolve, 2));
        }

        // Small delay to simulate event arrival timing
        await new Promise(resolve => setTimeout(resolve, 1));
      }

      const duration = Date.now() - startTime;
      const finalMetrics = controller.getMetrics();

      console.log(`Throttling test results:
        Total events: ${eventCount}
        Processed events: ${processedCount}
        Dropped events: ${finalMetrics.eventsDropped}
        Duration: ${duration}ms
        Throttling active: ${finalMetrics.isThrottling}
        Current rate: ${finalMetrics.currentEventRate.toFixed(2)} events/sec`);

      // Should have dropped some events due to throttling
      expect(finalMetrics.eventsDropped).toBeGreaterThan(0);
      expect(processedCount).toBeLessThan(eventCount);
      expect(finalMetrics.currentEventRate).toBeLessThanOrEqual(600); // Allow some margin
    });

    it('should recover from throttling when load decreases', async () => {
      // First, trigger throttling with high load
      for (let i = 0; i < 200; i++) {
        const event: Event = { type: 'test.event', properties: {} };
        await controller.processEvent(event);
      }

      const highLoadMetrics = controller.getMetrics();
      expect(highLoadMetrics.isThrottling).toBe(true);

      // Then reduce load and check recovery
      await new Promise(resolve => setTimeout(resolve, 1200)); // Wait for monitoring window

      // Process events at normal rate
      for (let i = 0; i < 100; i++) {
        const event: Event = { type: 'test.event', properties: {} };
        await controller.processEvent(event);
        await new Promise(resolve => setTimeout(resolve, 10)); // 100 events/sec
      }

      const recoveryMetrics = controller.getMetrics();

      console.log(`Throttling recovery test results:
        Initial throttling: ${highLoadMetrics.isThrottling}
        Final throttling: ${recoveryMetrics.isThrottling}
        Initial rate: ${highLoadMetrics.currentEventRate.toFixed(2)}
        Final rate: ${recoveryMetrics.currentEventRate.toFixed(2)}`);

      // Should have recovered from throttling
      expect(recoveryMetrics.isThrottling).toBe(false);
    });
  });

  describe('Memory Usage Benchmarks', () => {
    it('should maintain stable memory usage during prolonged operation', async () => {
      const processor = new EventProcessor({
        bufferSize: 1000,
        maxConcurrentHandlers: 5,
        processingRateLimit: 100,
        enableBackpressure: true,
      });

      const handler = {
        canHandle: vi.fn().mockReturnValue(true),
        handle: vi.fn().mockResolvedValue(undefined),
        priority: 0,
      };

      processor.registerHandler('memory-test-handler', handler);

      const memorySnapshots: number[] = [];
      const eventCount = 5000;

      // Take initial memory snapshot
      memorySnapshots.push(process.memoryUsage().heapUsed);

      // Process events in batches and monitor memory
      for (let batch = 0; batch < 5; batch++) {
        const events: Event[] = Array.from({ length: eventCount / 5 }, () => ({
          type: 'test.event',
          properties: {},
        }));

        const eventStream = {
          async *[Symbol.asyncIterator]() {
            for (const event of events) {
              yield event;
            }
          },
        };

        await processor.processEventStream(eventStream);

        // Force garbage collection if available (in Node.js with --expose-gc)
        if (global.gc) {
          global.gc();
        }

        memorySnapshots.push(process.memoryUsage().heapUsed);
      }

      await processor.shutdown();

      const initialMemory = memorySnapshots[0];
      const finalMemory = memorySnapshots[memorySnapshots.length - 1];
      const memoryDelta = finalMemory - initialMemory;
      const maxMemory = Math.max(...memorySnapshots);
      const memoryVariance = maxMemory - Math.min(...memorySnapshots);

      console.log(`Memory usage test results:
        Initial memory: ${(initialMemory / 1024 / 1024).toFixed(2)}MB
        Final memory: ${(finalMemory / 1024 / 1024).toFixed(2)}MB
        Memory delta: ${(memoryDelta / 1024 / 1024).toFixed(2)}MB
        Max memory: ${(maxMemory / 1024 / 1024).toFixed(2)}MB
        Memory variance: ${(memoryVariance / 1024 / 1024).toFixed(2)}MB`);

      // Memory should not grow excessively
      expect(Math.abs(memoryDelta)).toBeLessThan(20 * 1024 * 1024); // Less than 20MB change
      expect(memoryVariance).toBeLessThan(30 * 1024 * 1024); // Less than 30MB variance
    });
  });

  describe('UI Responsiveness Benchmarks', () => {
    it('should maintain UI responsiveness during event processing', async () => {
      const controller = new BackpressureController({
        maxEventRate: 200,
        uiResponsivenessCheck: true,
        uiResponsivenessThreshold: 50, // 50ms threshold
        monitoringWindowMs: 500,
      });

      const responsivenessMeasurements: number[] = [];
      const startTime = Date.now();

      // Process events while monitoring UI responsiveness
      const eventProcessing = async () => {
        for (let i = 0; i < 500; i++) {
          const event: Event = { type: 'test.event', properties: {} };
          await controller.processEvent(event);

          // Simulate UI work
          const uiStart = Date.now();
          for (let j = 0; j < 10000; j++) {
            Math.sin(j) * Math.cos(j); // Some computation
          }
          const uiEnd = Date.now();
          responsivenessMeasurements.push(uiEnd - uiStart);
        }
      };

      await eventProcessing;
      const totalDuration = Date.now() - startTime;

      const avgResponsiveness = responsivenessMeasurements.reduce((a, b) => a + b, 0) / responsivenessMeasurements.length;
      const maxResponsiveness = Math.max(...responsivenessMeasurements);
      const responsivenessViolations = responsivenessMeasurements.filter(r => r > 50).length;

      console.log(`UI responsiveness test results:
        Total events: 500
        Total duration: ${totalDuration}ms
        Average UI responsiveness: ${avgResponsiveness.toFixed(2)}ms
        Max UI responsiveness: ${maxResponsiveness}ms
        Responsiveness violations (>50ms): ${responsivenessViolations}
        Violation rate: ${((responsivenessViolations / responsivenessMeasurements.length) * 100).toFixed(2)}%`);

      // UI should remain reasonably responsive
      expect(avgResponsiveness).toBeLessThan(30); // Average under 30ms
      expect(maxResponsiveness).toBeLessThan(100); // Max under 100ms
      expect(responsivenessViolations / responsivenessMeasurements.length).toBeLessThan(0.1); // Less than 10% violations
    });
  });
});