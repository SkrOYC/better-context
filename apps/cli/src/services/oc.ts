import {
  createOpencode,
  OpencodeClient,
  type Event,
  type Config as OpenCodeConfig
} from '@opencode-ai/sdk';
import { ConfigService } from './config.ts';
import { OcError, InvalidTechError, RetryableError, NonRetryableError } from '../lib/errors.ts';
import { findSimilarStrings } from '../lib/utils/fuzzy-matcher.ts';
import { logger } from '../lib/utils/logger.ts';
import { EventProcessor } from '../lib/event/EventProcessor.ts';
import { EventStreamManager } from '../lib/event/EventStreamManager.ts';
import { MessageEventHandler } from '../lib/event/handlers/MessageEventHandler.ts';
import { SessionEventHandler } from '../lib/event/handlers/SessionEventHandler.ts';
import { hasSessionId, isSessionIdleEvent } from '../lib/utils/type-guards.ts';
import type { SdkEvent } from '../lib/types/events.ts';

export type { Event as OcEvent };

// Response caching interfaces
export interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number; // Time to live in milliseconds
  hits: number;
  lastAccessed: number;
}

export interface CacheMetrics {
  totalEntries: number;
  hits: number;
  misses: number;
  evictions: number;
  hitRate: number;
}

// Session reuse interfaces
export interface PooledSession {
  sessionId: string;
  tech: string;
  client: OpencodeClient;
  server: { close: () => void; url: string };
  createdAt: Date;
  lastUsed: Date;
  isActive: boolean;
}

export class SessionPool {
  private sessions = new Map<string, PooledSession[]>(); // tech -> sessions
  private sessionIdToTech = new Map<string, string>(); // sessionId -> tech (secondary index)
  private sessionTimeoutMs: number = 10 * 60 * 1000; // 10 minutes default

  constructor(sessionTimeoutMs?: number) {
    if (sessionTimeoutMs) {
      this.sessionTimeoutMs = sessionTimeoutMs;
    }
  }

  addSession(session: PooledSession): void {
    const tech = session.tech;
    if (!this.sessions.has(tech)) {
      this.sessions.set(tech, []);
    }
    this.sessions.get(tech)!.push(session);
    this.sessionIdToTech.set(session.sessionId, tech); // Maintain index
  }

  getAvailableSession(tech: string): PooledSession | null {
    const techSessions = this.sessions.get(tech) || [];
    const now = Date.now();

    // Find an available session that's not expired
    for (const session of techSessions) {
      if (session.isActive && (now - session.lastUsed.getTime()) < this.sessionTimeoutMs) {
        session.lastUsed = new Date();
        return session;
      }
    }

    return null;
  }

  markSessionInactive(sessionId: string): void {
    const tech = this.sessionIdToTech.get(sessionId);
    if (!tech) return;

    const techSessions = this.sessions.get(tech) || [];
    const session = techSessions.find(s => s.sessionId === sessionId);
    if (session) {
      session.isActive = false;
    }
  }

  cleanupExpiredSessions(): number {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [tech, techSessions] of this.sessions.entries()) {
      const activeSessions = techSessions.filter(session =>
        session.isActive && (now - session.lastUsed.getTime()) < this.sessionTimeoutMs
      );

      const removedCount = techSessions.length - activeSessions.length;
      cleanedCount += removedCount;

      if (activeSessions.length > 0) {
        this.sessions.set(tech, activeSessions);
      } else {
        this.sessions.delete(tech);
        // Remove from index when tech is deleted
        for (const session of techSessions) {
          this.sessionIdToTech.delete(session.sessionId);
        }
      }
    }

    return cleanedCount;
  }

  getStats() {
    const allSessions = Array.from(this.sessions.values()).flat();
    const now = Date.now();

    return {
      totalSessions: allSessions.length,
      activeSessions: allSessions.filter(s => s.isActive).length,
      sessionsByTech: Object.fromEntries(
        Array.from(this.sessions.entries()).map(([tech, sessions]) => [
          tech,
          sessions.filter(s => s.isActive).length
        ])
      ),
      averageSessionAge: allSessions.length > 0
        ? allSessions.reduce((sum, s) => sum + (now - s.createdAt.getTime()), 0) / allSessions.length
        : 0,
    };
  }

  clear(): void {
    this.sessions.clear();
    this.sessionIdToTech.clear();
  }
}

export class ResponseCache {
  private cache = new Map<string, CacheEntry<any>>();
  private metrics = {
    totalEntries: 0,
    hits: 0,
    misses: 0,
    evictions: 0,
  };

  constructor(private defaultTtlMs: number = 5 * 60 * 1000) {} // 5 minutes default

  private generateKey(query: string, tech: string, additionalParams?: Record<string, any>): string {
    const params = additionalParams ? JSON.stringify(additionalParams) : '';
    return `${tech}:${query}:${params}`;
  }

  async get<T>(query: string, tech: string, additionalParams?: Record<string, any>): Promise<T | null> {
    const key = this.generateKey(query, tech, additionalParams);
    const entry = this.cache.get(key);

    if (!entry) {
      this.metrics.misses++;
      return null;
    }

    // Check if expired
    const now = Date.now();
    if (now - entry.timestamp > entry.ttl) {
      this.cache.delete(key);
      this.metrics.evictions++;
      this.metrics.totalEntries--;
      this.metrics.misses++;
      return null;
    }

    // Update access statistics
    entry.hits++;
    entry.lastAccessed = now;
    this.metrics.hits++;

    return entry.data;
  }

  async set<T>(
    query: string,
    tech: string,
    data: T,
    ttlMs?: number,
    additionalParams?: Record<string, any>
  ): Promise<void> {
    const key = this.generateKey(query, tech, additionalParams);
    const now = Date.now();

    const entry: CacheEntry<T> = {
      data,
      timestamp: now,
      ttl: ttlMs ?? this.defaultTtlMs,
      hits: 0,
      lastAccessed: now,
    };

    this.cache.set(key, entry);
    this.metrics.totalEntries++;

    // Periodic cleanup to prevent memory leaks
    if (this.metrics.totalEntries % 100 === 0) {
      this.cleanup();
    }
  }

  private cleanup(): void {
    const now = Date.now();
    const keysToDelete: string[] = [];

    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > entry.ttl) {
        keysToDelete.push(key);
      }
    }

    keysToDelete.forEach(key => {
      this.cache.delete(key);
      this.metrics.evictions++;
      this.metrics.totalEntries--;
    });

    if (keysToDelete.length > 0) {
      logger.resource(`Cache cleanup: removed ${keysToDelete.length} expired entries`);
    }
  }

  getMetrics(): CacheMetrics {
    const totalRequests = this.metrics.hits + this.metrics.misses;
    return {
      ...this.metrics,
      hitRate: totalRequests > 0 ? this.metrics.hits / totalRequests : 0,
    };
  }

  clear(): void {
    this.cache.clear();
    this.metrics.totalEntries = 0;
    this.metrics.hits = 0;
    this.metrics.misses = 0;
    this.metrics.evictions = 0;
    logger.resource('Response cache cleared');
  }

  // Get cache statistics for monitoring
  getStats() {
    const entries = Array.from(this.cache.values());
    const now = Date.now();

    return {
      totalEntries: this.metrics.totalEntries,
      averageAge: entries.length > 0
        ? entries.reduce((sum, entry) => sum + (now - entry.timestamp), 0) / entries.length
        : 0,
      averageHits: entries.length > 0
        ? entries.reduce((sum, entry) => sum + entry.hits, 0) / entries.length
        : 0,
      oldestEntry: entries.length > 0
        ? Math.min(...entries.map(entry => now - entry.timestamp))
        : 0,
      newestEntry: entries.length > 0
        ? Math.max(...entries.map(entry => now - entry.timestamp))
        : 0,
    };
  }
}

// Utility function for retry with exponential backoff
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  isRetryable: (error: Error) => boolean,
  maxRetries: number,
  baseDelay: number,
  maxDelay: number
): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt < maxRetries && error instanceof Error && isRetryable(error)) {
        const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        throw error;
      }
    }
  }
  throw new Error('Unreachable code');
}

// Helper to determine if an error is retryable
export function isRetryableError(error: Error): boolean {
  // Non-retryable errors
  if (error instanceof InvalidTechError ||
      error instanceof NonRetryableError) {
    return false;
  }

  // Retryable: port exhaustion, network issues, timeouts, session creation failures
  if (error instanceof OcError) {
    const message = error.message.toLowerCase();
    if (
      message.includes('port') ||
      message.includes('timeout') ||
      message.includes('network') ||
      message.includes('connection') ||
      message.includes('failed to create') ||
      message.includes('session')
    ) {
      return true;
    }
  }

  // Default to retryable for unknown errors
  return true;
}

interface PooledInstance {
  client: OpencodeClient;
  server: { close: () => void; url: string };
  tech: string;
  createdAt: Date;
  lastUsed: Date;
  inUse: boolean;
  sessionCount: number;
}

interface QueuedRequest {
  tech: string;
  configObject: OpenCodeConfig;
  resolve: (value: { client: OpencodeClient; server: { close: () => void; url: string } }) => void;
  reject: (error: Error) => void;
  timeoutId: NodeJS.Timeout;
}

export class ResourcePool {
  private pool = new Map<string, PooledInstance[]>();
  private maxInstancesPerTech: number;
  private maxTotalInstances: number;
  private instanceTimeoutMs: number;
  private cleanupInterval: NodeJS.Timeout | null = null;
  private requestQueue: QueuedRequest[] = [];
  private maxQueueSize: number = 50; // Maximum queued requests
  private queueTimeoutMs: number = 30000; // 30 second queue timeout
  private configService: ConfigService;

  constructor(
    configService: ConfigService,
    maxInstancesPerTech: number = 3,
    maxTotalInstances: number = 10,
    instanceTimeoutMs: number = 30 * 60 * 1000 // 30 minutes
  ) {
    this.configService = configService;
    this.maxInstancesPerTech = maxInstancesPerTech;
    this.maxTotalInstances = maxTotalInstances;
    this.instanceTimeoutMs = instanceTimeoutMs;

    // Start cleanup interval to remove unused instances
    this.startCleanupInterval();
  }

  private startCleanupInterval(): void {
    // Clean up every 5 minutes
    this.cleanupInterval = setInterval(() => {
      this.performCleanup();
    }, 5 * 60 * 1000);
  }

  private performCleanup(): void {
    const now = Date.now();
    for (const [tech, instances] of this.pool.entries()) {
      const instancesToKeep = instances.filter(instance =>
        instance.inUse ||
        (now - instance.lastUsed.getTime()) < this.instanceTimeoutMs
      );

      if (instancesToKeep.length !== instances.length) {
        // Some instances were cleaned up
        this.pool.set(tech, instancesToKeep);

        const cleanedCount = instances.length - instancesToKeep.length;
        logger.resource(`Cleaned up ${cleanedCount} unused instances for ${tech}`);
      }
    }
  }

  private getTotalInstances(): number {
    let total = 0;
    for (const instances of this.pool.values()) {
      total += instances.length;
    }
    return total;
  }

  private getAvailableInstance(tech: string): PooledInstance | null {
    const instances = this.pool.get(tech) || [];
    return instances.find(instance => !instance.inUse) || null;
  }

  async acquireInstance(tech: string, configObject: OpenCodeConfig): Promise<{ client: OpencodeClient; server: { close: () => void; url: string } }> {
    // First try to get an existing available instance for this tech
    let instance = this.getAvailableInstance(tech);

    if (instance) {
      instance.inUse = true;
      instance.lastUsed = new Date();
      instance.sessionCount++;
      return { client: instance.client, server: instance.server };
    }

    // Check if we can create a new instance for this tech
    const techInstances = this.pool.get(tech) || [];
    const canCreateNewInstance = techInstances.length < this.maxInstancesPerTech && this.getTotalInstances() < this.maxTotalInstances;

    if (canCreateNewInstance) {
      // Create new instance
      const result = await this.createNewInstance(tech, configObject);

      // Add to pool
      if (!this.pool.has(tech)) {
        this.pool.set(tech, []);
      }
      this.pool.get(tech)!.push(result);

      await logger.resource(`Created new pooled instance for ${tech}. Total instances: ${this.getTotalInstances()}`);
      return { client: result.client, server: result.server };
    }

    // Instance limits reached, add to queue
    if (this.requestQueue.length >= this.maxQueueSize) {
      throw new OcError(`RESOURCE EXHAUSTION: Request queue full (${this.maxQueueSize}). Maximum instances (${this.maxInstancesPerTech}) reached for technology ${tech} and total instances (${this.maxTotalInstances}) reached across all technologies`, null);
    }

    // Queue the request and wait for an instance to become available
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        // Remove from queue on timeout
        const index = this.requestQueue.findIndex(req => req.timeoutId === timeoutId);
        if (index !== -1) {
          this.requestQueue.splice(index, 1);
        }
        reject(new OcError(`RESOURCE EXHAUSTION: Request timed out after ${this.queueTimeoutMs}ms waiting for instance of ${tech}`, null));
      }, this.queueTimeoutMs);

      this.requestQueue.push({
        tech,
        configObject,
        resolve,
        reject,
        timeoutId,
      });

      logger.resource(`Request queued for ${tech}. Queue size: ${this.requestQueue.length}`);
    });
  }

  private async createNewInstance(tech: string, configObject: OpenCodeConfig): Promise<PooledInstance> {
    // Use a more sophisticated port allocation strategy
    const usedPorts = new Set<number>();
    for (const instances of this.pool.values()) {
      for (const instance of instances) {
        const url = new URL(instance.server.url);
        usedPorts.add(parseInt(url.port));
      }
    }

    let port = 3420;
    while (usedPorts.has(port)) {
      port++;
      if (port > 4000) { // Reasonable upper limit
        throw new OcError('RESOURCE EXHAUSTION: No available ports for new instance', null);
      }
    }

    try {
      // Set btca-specific OpenCode config directory
      const originalConfigDir = process.env.OPENCODE_CONFIG_DIR;
      process.env.OPENCODE_CONFIG_DIR = this.configService.getOpenCodeConfigDir();

      try {
        const result = await createOpencode({
          port,
          config: configObject
        });

        return {
          client: result.client,
          server: result.server,
          tech,
          createdAt: new Date(),
          lastUsed: new Date(),
          inUse: true,
          sessionCount: 1
        };
      } finally {
        // Restore original config dir
        if (originalConfigDir !== undefined) {
          process.env.OPENCODE_CONFIG_DIR = originalConfigDir;
        } else {
          delete process.env.OPENCODE_CONFIG_DIR;
        }
      }

      return {
        client: result.client,
        server: result.server,
        tech,
        createdAt: new Date(),
        lastUsed: new Date(),
        inUse: true,
        sessionCount: 1
      };
    } catch (err) {
      throw new OcError('FAILED TO CREATE POOLED OPENCODE INSTANCE', err);
    }
  }

  releaseInstance(tech: string, client: OpencodeClient): void {
    const instances = this.pool.get(tech) || [];
    const instance = instances.find(inst => inst.client === client);

    if (instance) {
      instance.inUse = false;
      instance.lastUsed = new Date();
      instance.sessionCount = Math.max(0, instance.sessionCount - 1);

      // Process queued requests for this tech
      this.processQueuedRequests(tech);
    }
  }

  private async processQueuedRequests(tech: string): void {
    // Find the first queued request for this tech
    const queuedIndex = this.requestQueue.findIndex(req => req.tech === tech);

    if (queuedIndex !== -1) {
      const queuedRequest = this.requestQueue.splice(queuedIndex, 1)[0];
      clearTimeout(queuedRequest.timeoutId);

      try {
        // Try to acquire instance for the queued request
        const result = await this.acquireInstance(queuedRequest.tech, queuedRequest.configObject);
        queuedRequest.resolve(result);
        logger.resource(`Processed queued request for ${tech}. Remaining queue size: ${this.requestQueue.length}`);
      } catch (error) {
        queuedRequest.reject(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }

  getPoolMetrics() {
    const metrics = {
      totalInstances: this.getTotalInstances(),
      instancesByTech: {} as Record<string, number>,
      activeInstances: 0,
      availableInstances: 0,
      queuedRequests: this.requestQueue.length,
      queueSize: this.maxQueueSize,
    };

    for (const [tech, instances] of this.pool.entries()) {
      metrics.instancesByTech[tech] = instances.length;
      for (const instance of instances) {
        if (instance.inUse) {
          metrics.activeInstances++;
        } else {
          metrics.availableInstances++;
        }
      }
    }

    return metrics;
  }

  async shutdown(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    // Reject all queued requests
    for (const queuedRequest of this.requestQueue) {
      clearTimeout(queuedRequest.timeoutId);
      queuedRequest.reject(new Error('Resource pool shutting down'));
    }
    this.requestQueue.length = 0;

    // Close all instances
    for (const [tech, instances] of this.pool.entries()) {
      for (const instance of instances) {
        try {
          if (instance.server && typeof instance.server.close === 'function') {
            instance.server.close();
          }
        } catch (error) {
          // Ignore errors during shutdown
          await logger.warn(`Error closing pooled instance for ${tech}: ${error}`);
        }
      }
    }

    this.pool.clear();
    await logger.resource('Resource pool shutdown complete');
  }
}

interface SessionInfo {
  sessionId: string;
  tech: string;
  client: OpencodeClient;
  server: { close: () => void; url: string };
  createdAt: Date;
  lastActivity: Date;
  timeoutId?: NodeJS.Timeout;
  isActive: boolean;
}

export class SessionCoordinator {
  private sessions = new Map<string, SessionInfo>();
  private techSessionCounts = new Map<string, number>();
  private resourcePool: ResourcePool;
  private maxConcurrentSessionsPerTech: number;
  private maxTotalSessions: number;

  constructor(
    resourcePool: ResourcePool,
    maxConcurrentSessionsPerTech: number = 5,
    maxTotalSessions: number = 20
  ) {
    this.resourcePool = resourcePool;
    this.maxConcurrentSessionsPerTech = maxConcurrentSessionsPerTech;
    this.maxTotalSessions = maxTotalSessions;
  }

  canCreateSession(tech: string): { allowed: boolean; reason?: string } {
    // Check total session limit
    if (this.sessions.size >= this.maxTotalSessions) {
      return {
        allowed: false,
        reason: `Maximum total sessions (${this.maxTotalSessions}) reached`
      };
    }

    // Check per-tech limit
    const techSessions = this.techSessionCounts.get(tech) || 0;
    if (techSessions >= this.maxConcurrentSessionsPerTech) {
      return {
        allowed: false,
        reason: `Maximum concurrent sessions (${this.maxConcurrentSessionsPerTech}) reached for ${tech}`
      };
    }

    return { allowed: true };
  }

  registerSession(sessionInfo: Omit<SessionInfo, 'isActive'>): void {
    const fullSessionInfo: SessionInfo = {
      ...sessionInfo,
      isActive: true
    };

    this.sessions.set(sessionInfo.sessionId, fullSessionInfo);

    // Update tech session count
    const currentCount = this.techSessionCounts.get(sessionInfo.tech) || 0;
    this.techSessionCounts.set(sessionInfo.tech, currentCount + 1);

    logger.resource(`Session ${sessionInfo.sessionId} registered for ${sessionInfo.tech}. Active sessions: ${this.sessions.size}`);
  }

  getSession(sessionId: string): SessionInfo | undefined {
    return this.sessions.get(sessionId);
  }

  updateSessionActivity(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastActivity = new Date();
    }
  }

  async cleanupSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    // Mark as inactive
    session.isActive = false;

    // Clear timeout if exists
    if (session.timeoutId) {
      clearTimeout(session.timeoutId);
    }

    // Release instance back to pool
    this.resourcePool.releaseInstance(session.tech, session.client);

    // Update tech session count
    const currentCount = this.techSessionCounts.get(session.tech) || 0;
    this.techSessionCounts.set(session.tech, Math.max(0, currentCount - 1));

    // Remove from tracking
    this.sessions.delete(sessionId);

    logger.resource(`Session ${sessionId} cleaned up. Remaining active sessions: ${this.sessions.size}`);
  }

  setSessionTimeout(sessionId: string, timeoutMs: number, cleanupCallback: () => Promise<void>): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    // Clear existing timeout
    if (session.timeoutId) {
      clearTimeout(session.timeoutId);
    }

    // Set new timeout
    session.timeoutId = setTimeout(async () => {
      await cleanupCallback();
    }, timeoutMs);

    session.lastActivity = new Date();
  }

  async cleanupAllSessions(): Promise<void> {
    const sessionIds = Array.from(this.sessions.keys());
    logger.resource(`Cleaning up ${sessionIds.length} active sessions via coordinator`);

    for (const sessionId of sessionIds) {
      await this.cleanupSession(sessionId);
    }

    // Reset counters
    this.techSessionCounts.clear();

    logger.resource('All sessions cleaned up via coordinator');
  }

  getCoordinatorMetrics() {
    return {
      totalSessions: this.sessions.size,
      activeSessions: Array.from(this.sessions.values()).filter(s => s.isActive).length,
      sessionsByTech: Object.fromEntries(this.techSessionCounts.entries()),
      maxConcurrentSessionsPerTech: this.maxConcurrentSessionsPerTech,
      maxTotalSessions: this.maxTotalSessions
    };
  }

  getStaleSessions(timeoutMs: number): string[] {
    const now = Date.now();
    const staleSessionIds: string[] = [];

    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.isActive && (now - session.lastActivity.getTime()) > timeoutMs) {
        staleSessionIds.push(sessionId);
      }
    }

    return staleSessionIds;
  }

  async cleanupStaleSessions(timeoutMs: number): Promise<number> {
    const staleSessionIds = this.getStaleSessions(timeoutMs);
    let cleanedCount = 0;

    for (const sessionId of staleSessionIds) {
      await this.cleanupSession(sessionId);
      cleanedCount++;
    }

    if (cleanedCount > 0) {
      logger.resource(`Cleaned up ${cleanedCount} stale sessions`);
    }

    return cleanedCount;
  }
}

export class OcService {
  private configService: ConfigService;
  private resourcePool: ResourcePool;
  private sessionCoordinator: SessionCoordinator;
  private eventProcessor: EventProcessor;
  private eventStreamManager: EventStreamManager;
  private responseCache: ResponseCache;
  private sessionPool: SessionPool;
  private metrics = {
    sessionsCreated: 0,
    sessionsCleanedUp: 0,
    orphanedProcessesCleaned: 0,
    currentSessionCount: 0
  };

  constructor(configService: ConfigService) {
    this.configService = configService;

    // Initialize response cache with 10-minute TTL
    this.responseCache = new ResponseCache(10 * 60 * 1000);

    // Initialize session pool for reusing sessions across same-tech queries
    this.sessionPool = new SessionPool(15 * 60 * 1000); // 15 minute session reuse timeout

    // Initialize resource pool with configurable limits
    const maxInstancesPerTech = this.configService.getMaxInstancesPerTech();
    const maxTotalInstances = this.configService.getMaxTotalInstances();
    this.resourcePool = new ResourcePool(this.configService, maxInstancesPerTech, maxTotalInstances);

    // Initialize session coordinator
    const maxConcurrentSessionsPerTech = this.configService.getMaxConcurrentSessionsPerTech();
    const maxTotalSessions = this.configService.getMaxTotalSessions();
    this.sessionCoordinator = new SessionCoordinator(
      this.resourcePool,
      maxConcurrentSessionsPerTech,
      maxTotalSessions
    );

    // Initialize event processing system with optimized performance settings
    this.eventProcessor = new EventProcessor({
      maxConcurrentHandlers: 20, // Increased from 5 to allow more parallel processing
      processingRateLimit: 1000, // Increased from 100 to reduce artificial throttling
    });

    this.eventStreamManager = new EventStreamManager();

    // Register default event handlers
    this.registerDefaultEventHandlers();
  }

  private registerDefaultEventHandlers(): void {
    // Register message event handler for text output
    const messageHandler = new MessageEventHandler({
      outputStream: process.stdout,
      enableFormatting: true,
    });

    // Register session event handler for session lifecycle
    const sessionHandler = new SessionEventHandler({
      onSessionComplete: async (sessionId) => {
        await logger.info(`Session ${sessionId} completed, releasing resources`);
        // Find and release the instance for this session
        // Note: This is a simplified approach - in production you'd track the instance per session
        try {
          // The instance release is handled in the askQuestion method when session.idle is detected
          await logger.resource(`Instance for session ${sessionId} released back to pool`);
        } catch (error) {
          await logger.error(`Error releasing instance for session ${sessionId}: ${error}`);
        }
      },
      onSessionError: async (sessionId, error) => {
        await logger.error(`Session ${sessionId} encountered error: ${error.message}`);
        // Handle error cleanup if needed
      },
    });

    // Register handlers with the processor
    this.eventProcessor.registerHandler('message-handler', messageHandler);
    this.eventProcessor.registerHandler('session-handler', sessionHandler);

    logger.info('Default event handlers registered');
  }

  private resetSessionTimeout(sessionId: string): void {
    const timeoutMs = this.configService.getSessionTimeout() * 60 * 1000;
    this.sessionCoordinator.setSessionTimeout(sessionId, timeoutMs, async () => {
      await this.sessionCoordinator.cleanupSession(sessionId);
      await logger.resource(`Session ${sessionId} timed out after ${this.configService.getSessionTimeout()} minutes`);
    });
  }

  private async cleanupSession(sessionId: string): Promise<void> {
    await this.sessionCoordinator.cleanupSession(sessionId);
    this.metrics.sessionsCleanedUp++;
    this.metrics.currentSessionCount = this.sessionCoordinator.getCoordinatorMetrics().totalSessions;
  }

  private async getOpencodeInstance(tech: string): Promise<{ client: OpencodeClient; server: { close: () => void; url: string } }> {
    const configObject = await this.configService.getOpenCodeConfig({ repoName: tech });

    if (!configObject) {
      // Get available techs and suggest similar ones if tech is not found
      const allRepos = this.configService.getRepos();
      const availableTechs = allRepos.map(repo => repo.name);
      const suggestedTechs = findSimilarStrings(tech, availableTechs, 3); // Increase threshold to allow more suggestions

      throw new InvalidTechError(tech, availableTechs, suggestedTechs);
    }

    // Use resource pool to acquire instance
    return await this.resourcePool.acquireInstance(tech, configObject);
  }

  async initSession(tech: string): Promise<string> {
    // Check if we can create a session for this tech
    const sessionCheck = this.sessionCoordinator.canCreateSession(tech);
    if (!sessionCheck.allowed) {
      throw new OcError(`SESSION LIMIT EXCEEDED: ${sessionCheck.reason}`, null);
    }

    const result = await this.getOpencodeInstance(tech);
    const session = await result.client.session.create();

    if (session.error) {
      // Release instance back to pool on failure
      this.resourcePool.releaseInstance(tech, result.client);
      throw new OcError('FAILED TO START OPENCODE SESSION', session.error);
    }

    const sessionID = session.data.id;
    const now = new Date();

    // Register session with coordinator
    this.sessionCoordinator.registerSession({
      sessionId: sessionID,
      tech,
      client: result.client,
      server: result.server,
      createdAt: now,
      lastActivity: now
    });

    // Set initial timeout
    this.resetSessionTimeout(sessionID);

    // Update metrics
    this.metrics.sessionsCreated++;
    this.metrics.currentSessionCount = this.sessionCoordinator.getCoordinatorMetrics().totalSessions;

    await logger.resource(`Session ${sessionID} created for ${tech} with timeout`);
    await logger.metrics(`Sessions created: ${this.metrics.sessionsCreated}, Active: ${this.metrics.currentSessionCount}`);

    return sessionID;
  }

  async sendPrompt(sessionId: string, text: string): Promise<AsyncIterable<Event>> {
    const sessionData = this.sessionCoordinator.getSession(sessionId);
    if (!sessionData) {
      throw new OcError('OpenCode SDK not configured', null);
    }
    const { client } = sessionData;

    // Reset timeout on activity
    this.resetSessionTimeout(sessionId);

    const events = await client.event.subscribe();
    let promptError: Error | null = null;

    const filteredEvents = {
      async *[Symbol.asyncIterator]() {
        if (promptError) {
          throw promptError;
        }
        for await (const event of events.stream) {
          if (promptError) {
            throw promptError;
          }

          // Type-safe event filtering
          if (!hasSessionId(event) || event.properties.sessionID === sessionId) {
            if (event.type === 'session.error') {
              // Type-safe error handling - session errors have error properties
              const errorEvent = event as SdkEvent;
              if ('properties' in errorEvent && errorEvent.properties.error) {
                const errorDetails = errorEvent.properties.error;
                throw new OcError((errorDetails as any).name ?? 'Unknown session error', errorDetails);
              } else {
                throw new OcError('Unknown session error', undefined);
              }
            }
            yield event;
          }
        }
      }
    };

    // Fire the prompt
    client.session.prompt({
      path: { id: sessionId },
      body: {
        agent: 'docs',
        model: {
          providerID: this.configService.rawConfig().provider,
          modelID: this.configService.rawConfig().model
        },
        parts: [{ type: 'text', text }]
      }
    }).catch((err) => {
      promptError = new OcError(String(err), err);
    });

    return filteredEvents;
  }

  async closeSession(sessionId: string): Promise<void> {
    await this.cleanupSession(sessionId);
  }

  async cleanupAllSessions(): Promise<void> {
    const sessionsBeforeCleanup = this.sessionCoordinator.getCoordinatorMetrics().totalSessions;
    await this.sessionCoordinator.cleanupAllSessions();

    // Update metrics
    this.metrics.sessionsCleanedUp += sessionsBeforeCleanup;
    this.metrics.currentSessionCount = 0;

    await logger.resource('All sessions cleaned up');
  }

  async cleanupOrphanedProcesses(): Promise<void> {
    // Skip orphaned process cleanup on Windows (Unix-only feature)
    if (process.platform === 'win32') {
      await logger.debug('Skipping orphaned process cleanup on Windows platform');
      return;
    }

    const basePort = 3420;
    const maxInstances = 5;
    const processesToClean: number[] = [];

    // Check for OpenCode processes on ports 3420-3424
    for (let port = basePort; port < basePort + maxInstances; port++) {
      try {
        // Use lsof to find processes using the port
        const { stdout } = await Bun.spawn(['lsof', '-ti', `:${port}`], {
          stdout: 'pipe',
          stderr: 'ignore'
        });

        if (stdout) {
          const output = await new Response(stdout).text();
          const pid = parseInt(output.trim());
          if (!isNaN(pid)) {
            // Check if it's an OpenCode process
            const cmdResult = await Bun.spawn(['ps', '-p', pid.toString(), '-o', 'comm='], {
              stdout: 'pipe',
              stderr: 'ignore'
            });

            const command = cmdResult?.stdout ? (await new Response(cmdResult.stdout).text()).trim() : '';
            if (command.includes('node') || command.includes('bun') || command.includes('opencode')) {
              processesToClean.push(pid);
            }
          }
        }
      } catch (error) {
        // Port is likely not in use, which is fine
      }
    }

    // Clean up orphaned processes
    for (const pid of processesToClean) {
      try {
        await Bun.spawn(['kill', pid.toString()], {
          stdout: 'ignore',
          stderr: 'ignore'
        });
        await logger.resource(`Cleaned up orphaned OpenCode process ${pid}`);
        this.metrics.orphanedProcessesCleaned++;
      } catch (error) {
        await logger.error(`Failed to kill process ${pid}: ${error}`);
      }
    }

    if (processesToClean.length > 0) {
      await logger.resource(`Cleaned up ${processesToClean.length} orphaned processes`);
      await logger.metrics(`Orphaned processes cleaned: ${this.metrics.orphanedProcessesCleaned}`);
    }
  }

  getMetrics() {
    return {
      ...this.metrics,
      currentSessionCount: this.sessionCoordinator.getCoordinatorMetrics().totalSessions,
      resourcePool: this.resourcePool.getPoolMetrics(),
      sessionCoordinator: this.sessionCoordinator.getCoordinatorMetrics(),
      responseCache: this.responseCache.getMetrics(),
      cacheStats: this.responseCache.getStats(),
      repositoryCache: this.configService.getRepositoryCacheStats(),
      sessionPool: this.sessionPool.getStats()
    };
  }

  async shutdown(): Promise<void> {
    try {
      await this.sessionCoordinator.cleanupAllSessions();
      await this.eventStreamManager.shutdown();
      await this.eventProcessor.shutdown();
      await this.resourcePool.shutdown();
      await logger.resource('OcService shutdown complete');
    } catch (error) {
      await logger.error(`Error during OcService shutdown: ${error}`);
      throw error;
    }
  }

  async askQuestion(args: { question: string; tech: string }): Promise<AsyncIterable<Event>> {
    const { question, tech } = args;
    let result: { client: OpencodeClient; server: { close: () => void; url: string } } | null = null;
    let sessionID: string | null = null;
    let streamId: string | null = null;

    await logger.info(`Asking question about ${tech}: "${question}"`);

    // Check cache for similar recent questions to avoid redundant processing
    const cacheKey = question.toLowerCase().trim();
    const cachedResponse = await this.responseCache.get<Event[]>(cacheKey, tech);
    if (cachedResponse) {
      await logger.resource(`Cache hit for question about ${tech}: "${question.substring(0, 50)}..."`);
      // Return cached events as an async iterable
      return {
        async *[Symbol.asyncIterator]() {
          for (const event of cachedResponse) {
            yield event;
          }
        }
      };
    }

    // Validate tech name first and provide suggestions if not found
    // This prevents attempting to clone a non-existent repo
    const allRepos = this.configService.getRepos();
    const availableTechs = allRepos.map(repo => repo.name);
    if (!availableTechs.includes(tech)) {
      const suggestedTechs = findSimilarStrings(tech, availableTechs, 3); // Increase threshold to allow more suggestions
      throw new InvalidTechError(tech, availableTechs, suggestedTechs);
    }

    await this.configService.cloneOrUpdateOneRepoLocally(tech, { suppressLogs: true });

    // Wrap the retryable operations
    const maxRetries = this.configService.getMaxRetries();
    const baseDelay = this.configService.getBaseBackoffMs();
    const maxDelay = this.configService.getMaxBackoffMs();

    return await retryWithBackoff(async () => {
      try {
        result = await this.getOpencodeInstance(tech);

        // Try to reuse an existing session from the pool first
        let pooledSession = this.sessionPool.getAvailableSession(tech);
        let sessionCreated = false;

        if (pooledSession) {
          sessionID = pooledSession.sessionId;
          await logger.resource(`Reusing pooled session ${sessionID} for ${tech}`);
        } else {
          // Create new session if none available in pool
          const session = await result.client.session.create();

          if (session.error) {
            this.resourcePool.releaseInstance(tech, result.client); // Release back to pool
            await logger.resource(`Session creation failed for ${tech}, instance released to pool`);
            await logger.error(`Failed to start OpenCode session for ${tech}: ${session.error}`);
            throw new OcError('FAILED TO START OPENCODE SESSION', session.error);
          }

          sessionID = session.data.id;
          sessionCreated = true;
          await logger.info(`Session created for ${tech} with ID: ${sessionID}`);

          // Add new session to pool for future reuse
          const now = new Date();
          this.sessionPool.addSession({
            sessionId: sessionID,
            tech,
            client: result.client,
            server: result.server,
            createdAt: now,
            lastUsed: now,
            isActive: true,
          });
        }

        // Get the raw event stream from the client
        const events = await result.client.event.subscribe();

        // Create a filtered event stream that only includes events for this session
        const self = this; // Capture this for use in generator
        const sessionFilteredEvents = {
          async *[Symbol.asyncIterator]() {
            let sessionCompleted = false;
            for await (const event of events.stream) {
              if (sessionCompleted) {
                break; // Stop yielding events after session completion
              }

              // Type-safe event filtering and session completion handling
              if (!hasSessionId(event) || event.properties.sessionID === sessionID) {
                // Handle session completion with type-safe idle event checking
                if (isSessionIdleEvent(event) && event.properties.sessionID === sessionID) {
                  sessionCompleted = true;
                  await logger.info(`Session ${sessionID} completed for ${tech}`);
                  // Mark session as inactive in pool and release instance back to pool
                  self.sessionPool.markSessionInactive(sessionID);
                  self.resourcePool.releaseInstance(tech, result!.client);
                  await logger.resource(`Session ${sessionID} marked inactive and instance released back to pool`);
                }

                yield event;
              }
            }
          }
        };

        // Create a stream processor for this session
        streamId = await this.eventStreamManager.createStream(
          sessionFilteredEvents,
          {
            id: `session-${sessionID}`,
            description: `Event stream for session ${sessionID} (${tech})`,
            timeoutMs: this.configService.getSessionTimeout() * 60 * 1000,
          }
        );

        // Fire the prompt asynchronously
        result.client.session.prompt({
          path: { id: sessionID },
          body: {
            agent: 'docs',
            model: {
              providerID: this.configService.rawConfig().provider,
              modelID: this.configService.rawConfig().model
            },
            parts: [{ type: 'text', text: question }]
          }
        }).catch(async (err) => {
          const promptError = new OcError(String(err), err);
          await logger.error(`Prompt error for ${tech} (session ${sessionID}): ${err}`);

          // Stop the stream on prompt error
          if (streamId) {
            await this.eventStreamManager.stopStream(streamId);
          }

          throw promptError;
        });

        // Return the processed events through our event processing system
        // Collect events for caching while yielding them
        const allEvents: Event[] = [];
        const processedEvents = {
          async *[Symbol.asyncIterator]() {
            // The EventProcessor handles the actual event processing and output
            // This iterator just yields events that pass through the system
            // The real processing happens in the handlers registered with the processor
            for await (const event of sessionFilteredEvents) {
              allEvents.push(event);
              yield event;
            }

            // Cache the collected events after streaming is complete
            if (allEvents.length > 0) {
              await self.responseCache.set(cacheKey, tech, allEvents, 10 * 60 * 1000); // 10 minute TTL
              await logger.resource(`Cached ${allEvents.length} events for question about ${tech}`);
            }
          }
        };

        return processedEvents;
      } catch (error) {
        // Ensure cleanup even if error occurs after creation
        if (streamId) {
          try {
            await this.eventStreamManager.stopStream(streamId);
          } catch (streamError) {
            await logger.error(`Error stopping stream ${streamId}: ${streamError}`);
          }
        }

        if (result?.client) {
          try {
            this.resourcePool.releaseInstance(tech, result.client);
            await logger.resource(`Instance released to pool due to error in askQuestion for ${tech}`);
          } catch (releaseError) {
            await logger.error(`Error releasing instance to pool during cleanup: ${releaseError}`);
          }
        }

        await logger.error(`Error in askQuestion for ${tech}: ${error instanceof Error ? error.message : String(error)}`);
        throw error;
      }
    }, isRetryableError, maxRetries, baseDelay, maxDelay);
  }
}