import type { 
  Event,
  Part,
  TextPart,
  ToolPart,
  ToolState,
  ToolStateCompleted,
  ToolStateError,
  Message
} from '@opencode-ai/sdk';

/**
 * SDK-compliant event type definitions with discriminated unions
 * Based on OpenCode SDK event structure
 * 
 * Note: We import Part, ToolPart, and related types directly from the SDK
 * to ensure type alignment and avoid duplication.
 */

// Re-export Part type from SDK for convenience
export type { Part, TextPart, ToolPart, ToolState, ToolStateCompleted, ToolStateError } from '@opencode-ai/sdk';

// Base event properties that all events share
export interface BaseEventProperties {
  sessionID?: string;
  [key: string]: unknown;
}


// Full message info from message.updated events
export interface MessageInfo {
  id: string;
  sessionID: string;
  role: "user" | "assistant";
  time: {
    created: number;
    completed?: number;
  };
  error?: any;
  parentID?: string;
  modelID?: string;
  providerID?: string;
  mode?: string;
  path?: {
    cwd: string;
    root: string;
  };
  summary?: boolean;
  cost?: number;
  tokens?: {
    input: number;
    output: number;
    reasoning: number;
    cache: {
      read: number;
      write: number;
    };
  };
  finish?: string;
  text?: string;
  parts?: Array<Part>;
}

export interface MessageEventProperties extends BaseEventProperties {
  part: Part;
  delta?: string;  // Delta is at event level per SDK, not on the part itself
}

// Message updated event properties
export interface MessageUpdatedProperties extends BaseEventProperties {
  info: MessageInfo;
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

// Session status event properties
export interface SessionStatusProperties extends BaseEventProperties {
  status: {
    type: "idle" | "busy" | "retry";
    attempt?: number;
    message?: string;
    next?: number;
  };
}

// Server connected event properties
export interface ServerConnectedProperties extends BaseEventProperties {
  // Server connected events typically have minimal properties
}



// Discriminated union types for type-safe event handling
export type MessagePartUpdatedEvent = Event & {
  type: 'message.part.updated';
  properties: MessageEventProperties;
};

export type MessageUpdatedEvent = Event & {
  type: 'message.updated';
  properties: MessageUpdatedProperties;
};

export type SessionErrorEvent = Event & {
  type: 'session.error';
  properties: SessionErrorProperties;
};

export type SessionIdleEvent = Event & {
  type: 'session.idle';
  properties: SessionIdleProperties;
};

export type SessionStatusEvent = Event & {
  type: 'session.status';
  properties: SessionStatusProperties;
};

export type ServerConnectedEvent = Event & {
  type: 'server.connected';
  properties: ServerConnectedProperties;
};



export type ToolPartUpdatedEvent = Event & {
  type: 'message.part.updated';
  properties: {
    part: ToolPart;
  };
};

// Union type for all handled SDK events
export type SdkEvent = MessagePartUpdatedEvent | MessageUpdatedEvent | SessionErrorEvent | SessionIdleEvent | SessionStatusEvent | ToolPartUpdatedEvent | ServerConnectedEvent;

// Type guard helper for events with session IDs
export type EventWithSessionId = Event & {
  properties: BaseEventProperties & { sessionID: string };
};