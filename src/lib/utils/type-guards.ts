import type { Event } from '@opencode-ai/sdk';

// Minimal type guards for the simplified system

export function hasSessionId(event: Event): event is Event & { properties: { sessionID: string } } {
  return event && 
         typeof event === 'object' && 
         'properties' in event && 
         event.properties !== null &&
         typeof event.properties === 'object' &&
         'sessionID' in event.properties &&
         typeof event.properties.sessionID === 'string';
}
