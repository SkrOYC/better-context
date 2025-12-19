
import { mock } from 'bun:test';
import type { Event } from '@opencode-ai/sdk';

// Mock event types based on SDK
export interface MockEvent extends Event {
  type: string;
  properties: any;
}

// Mock OpenCode Client
export class MockOpencodeClient {
  public eventStream: AsyncGenerator<MockEvent, void, unknown>;
  public onSseEventCallback: ((event: any) => void) | undefined;
  
  constructor(events: MockEvent[] | AsyncGenerator<MockEvent, void, unknown>) {
    if (Array.isArray(events)) {
      this.eventStream = (async function* () {
        for (const event of events) {
          yield event;
        }
      })();
    } else {
      this.eventStream = events;
    }

    // Mock the nested client structure
    (this as any).event = {
      subscribe: mock(async (options?: { onSseEvent?: (event: any) => void }) => {
        if (options?.onSseEvent) {
          this.onSseEventCallback = options.onSseEvent;
        }
        return {
          stream: this.eventStream
        };
      })
    };

    (this as any).session = {
      create: mock(async () => ({ data: { id: 'mock-session-id' }, error: null })),
      prompt: mock(async () => ({ data: {}, error: null })),
      abort: mock(async () => ({ data: {}, error: null }))
    };
    
    (this as any).provider = {
      list: mock(async () => ({ data: { connected: ['test-provider'] }, error: null }))
    };
  }

  // Helper to simulate a heartbeat/ping (event with no data that doesn't yield but calls callback)
  async simulateHeartbeat() {
    if (this.onSseEventCallback) {
      this.onSseEventCallback({ type: 'ping' });
    }
  }
}

// Helper to create a delayed event generator
export async function* delayedEventGenerator(events: { event: MockEvent, delay: number }[]) {
  for (const item of events) {
    await new Promise(resolve => setTimeout(resolve, item.delay));
    yield item.event;
  }
}

// Helper to create an infinite event generator
export async function* infiniteEventGenerator(interval: number, eventCreator: () => MockEvent) {
  while (true) {
    await new Promise(resolve => setTimeout(resolve, interval));
    yield eventCreator();
  }
}
