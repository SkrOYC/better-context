/**
 * SDK-compliant response type definitions
 * Based on OpenCode SDK error handling patterns
 */

// Standard SDK response structure
export interface SdkResponse<T = unknown> {
  data?: T;
  error?: SdkError;
}

// SDK error structure
export interface SdkError {
  name?: string;
  message?: string;
  code?: string;
  details?: unknown;
}

// Session creation response
export interface SessionResponse {
  id: string;
  status: 'active' | 'idle' | 'error';
  createdAt?: string;
}

// Provider validation response
export interface ProviderListResponse {
  all: Array<{
    id: string;
    name: string;
    models: Record<string, unknown>;
  }>;
  connected: string[];
}

// Utility type for responses that may throw
export type SdkResponseOrThrow<T> = SdkResponse<T> & {
  data: T; // When using ThrowOnError pattern, data is guaranteed
};