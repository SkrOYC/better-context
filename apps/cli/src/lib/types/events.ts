import type { Event } from '@opencode-ai/sdk';

/**
 * SDK-compliant event type definitions with discriminated unions
 * Based on OpenCode SDK event structure and observed usage patterns
 */

// Base event properties that all events share
export interface BaseEventProperties {
  sessionID?: string;
  [key: string]: unknown;
}

// Message event properties
export interface MessagePart {
  messageID: string;
  text?: string;
  delta?: string;
  type: 'text' | 'image' | 'file';
}

export interface MessageEventProperties extends BaseEventProperties {
  part: MessagePart;
}

// Session error event properties
export interface SessionErrorProperties extends BaseEventProperties {
  error?: {
    name?: string;
    message?: string;
    code?: string;
  };
}

// Session idle event properties
export interface SessionIdleProperties extends BaseEventProperties {
  // Session idle events typically have minimal properties
}

// Discriminated union types for type-safe event handling
export type MessagePartUpdatedEvent = Event & {
  type: 'message.part.updated';
  properties: MessageEventProperties;
};

export type SessionErrorEvent = Event & {
  type: 'session.error';
  properties: SessionErrorProperties;
};

export type SessionIdleEvent = Event & {
  type: 'session.idle';
  properties: SessionIdleProperties;
};

// Union type for all handled SDK events
export type SdkEvent = MessagePartUpdatedEvent | SessionErrorEvent | SessionIdleEvent;

// Type guard helper for events with session IDs
export type EventWithSessionId = Event & {
  properties: BaseEventProperties & { sessionID: string };
};