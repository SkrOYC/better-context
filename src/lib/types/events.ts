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

// Message event properties - union type for different part types
export type MessagePart =
  | {
      messageID: string;
      text?: string;
      delta?: string;
      type: 'text' | 'image' | 'file';
    }
  | ToolPart;

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
  parts?: Array<any>;
}

export interface MessageEventProperties extends BaseEventProperties {
  part: MessagePart;
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

// Permission request event properties
export interface PermissionRequestProperties extends BaseEventProperties {
  permissionID: string;
}

// Tool event properties (matches SDK ToolPart)
export interface ToolPart {
  id: string;
  sessionID: string;
  messageID: string;
  type: "tool";
  callID: string;
  tool: string;
  state: {
    status: "pending" | "running" | "completed" | "error";
    input: { [key: string]: unknown };
    [key: string]: unknown;
  };
  metadata?: {
    [key: string]: unknown;
  };
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

export type PermissionRequestEvent = Event & {
  type: 'permission.updated';
  properties: PermissionRequestProperties;
};

export type ToolPartUpdatedEvent = Event & {
  type: 'message.part.updated';
  properties: {
    part: ToolPart;
  };
};

// Union type for all handled SDK events
export type SdkEvent = MessagePartUpdatedEvent | MessageUpdatedEvent | SessionErrorEvent | SessionIdleEvent | SessionStatusEvent | ToolPartUpdatedEvent | ServerConnectedEvent | PermissionRequestEvent;

// Type guard helper for events with session IDs
export type EventWithSessionId = Event & {
  properties: BaseEventProperties & { sessionID: string };
};