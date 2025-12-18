import type { Event } from '@opencode-ai/sdk';
import type {
  MessagePartUpdatedEvent,
  MessageUpdatedEvent,
  SessionErrorEvent,
  SessionIdleEvent,
  SessionStatusEvent,
  ServerConnectedEvent,
  ToolPartUpdatedEvent,
  ToolPart,
  EventWithSessionId,
  MessageEventProperties,
  MessageUpdatedProperties,
  SessionErrorProperties,
  SessionIdleProperties,
  SessionStatusProperties,
  ServerConnectedProperties
} from '../types/events.ts';

/**
 * Type guards for runtime type safety with SDK events
 */

// Check if event has required properties structure
function hasProperties(event: Event): event is Event & { properties: Record<string, unknown> } {
  return event && typeof event === 'object' && 'properties' in event && event.properties !== null;
}

// Check if event has session ID
export function hasSessionId(event: Event): event is EventWithSessionId {
  return hasProperties(event) && typeof event.properties.sessionID === 'string';
}

// Type guard for message part updated events
export function isMessageEvent(event: Event): event is MessagePartUpdatedEvent {
  if (!hasProperties(event) || event.type !== 'message.part.updated') {
    return false;
  }

  const props = event.properties as Partial<MessageEventProperties>;
  return props.part !== undefined &&
         typeof props.part === 'object' &&
         props.part !== null &&
         typeof props.part.messageID === 'string' &&
         typeof props.part.type === 'string';
}

// Type guard for message updated events
export function isMessageUpdatedEvent(event: Event): event is MessageUpdatedEvent {
  if (!hasProperties(event) || event.type !== 'message.updated') {
    return false;
  }

  const props = event.properties as Partial<MessageUpdatedProperties>;
  return props.info !== undefined &&
         typeof props.info === 'object' &&
         props.info !== null &&
         typeof props.info.id === 'string' &&
         typeof props.info.role === 'string';
}

// Type guard for session error events
export function isSessionErrorEvent(event: Event): event is SessionErrorEvent {
  if (!hasProperties(event) || event.type !== 'session.error') {
    return false;
  }

  // Session error events may or may not have error details
  return true;
}

// Type guard for session idle events
export function isSessionIdleEvent(event: Event): event is SessionIdleEvent {
  return hasProperties(event) && event.type === 'session.idle';
}

// Type guard for session status events
export function isSessionStatusEvent(event: Event): event is SessionStatusEvent {
  if (!hasProperties(event) || event.type !== 'session.status') {
    return false;
  }

  const props = event.properties as Partial<SessionStatusProperties>;
  return props.status !== undefined &&
         typeof props.status === 'object' &&
         props.status !== null &&
         typeof props.status.type === 'string';
}

// Type guard for server connected events
export function isServerConnectedEvent(event: Event): event is ServerConnectedEvent {
  return hasProperties(event) && event.type === 'server.connected';
}

// Type guard for tool events
export function isToolEvent(event: Event): event is ToolPartUpdatedEvent {
  if (!hasProperties(event) || event.type !== 'message.part.updated') {
    return false;
  }

  const props = event.properties as Partial<{ part: unknown }>;
  if (!props.part || typeof props.part !== 'object') {
    return false;
  }

  const part = props.part as Partial<ToolPart>;
  return part.type === 'tool' &&
         typeof part.callID === 'string' &&
         typeof part.tool === 'string' &&
         typeof part.state === 'object';
}

// Type guard for tool call start
export function isToolCallStart(event: Event): boolean {
  return isToolEvent(event) && event.properties.part.state.status === 'running';
}

// Type guard for text message parts
export function isTextMessagePart(part: unknown): part is Extract<MessageEventProperties['part'], { type: 'text' }> {
  return typeof part === 'object' &&
         part !== null &&
         'type' in part &&
         part.type === 'text' &&
         'messageID' in part &&
         typeof part.messageID === 'string';
}

// Type guard for error objects
export function isSdkError(error: unknown): error is { name?: string; message?: string; code?: string } {
  return typeof error === 'object' &&
         error !== null &&
         (('name' in error && typeof error.name === 'string') ||
          ('message' in error && typeof error.message === 'string') ||
          ('code' in error && typeof error.code === 'string'));
}



// Type guard for session response validation
export function isValidSessionResponse(response: unknown): response is { data: { id: string } } {
  return typeof response === 'object' &&
         response !== null &&
         'data' in response &&
         typeof response.data === 'object' &&
         response.data !== null &&
         'id' in response.data &&
         typeof response.data.id === 'string';
}