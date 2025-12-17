import type { Event } from '@opencode-ai/sdk';
import { logger } from '../utils/logger.ts';

export interface BackpressureConfig {
  maxEventRate?: number; // events per second
  monitoringWindowMs?: number; // time window for rate calculation
  throttleThreshold?: number; // rate threshold to trigger throttling
  uiResponsivenessCheck?: boolean;
  uiResponsivenessThreshold?: number; // max acceptable response time in ms
  gracefulDegradationSteps?: number; // number of degradation steps
}

export interface BackpressureMetrics {
  currentEventRate: number;
  isThrottling: boolean;
  throttlingLevel: number;
  uiResponsivenessMs?: number;
  totalEventsProcessed: number;
  eventsDropped: number;
  lastThrottleTime?: Date;
}

export class BackpressureController {
  private eventTimestamps: number[] = [];
  private totalEventsProcessed = 0;
  private eventsDropped = 0;
  private isThrottling = false;
  private throttlingLevel = 0;
  private lastThrottleTime?: Date;

  private config: Required<BackpressureConfig>;
  private uiCheckInterval?: NodeJS.Timeout;
  private lastUiResponsivenessCheck = 0;

  constructor(config: BackpressureConfig = {}) {
    this.config = {
      maxEventRate: config.maxEventRate ?? 100,
      monitoringWindowMs: config.monitoringWindowMs ?? 10000, // 10 seconds
      throttleThreshold: config.throttleThreshold ?? 80, // 80% of max rate
      uiResponsivenessCheck: config.uiResponsivenessCheck ?? true,
      uiResponsivenessThreshold: config.uiResponsivenessThreshold ?? 100, // 100ms
      gracefulDegradationSteps: config.gracefulDegradationSteps ?? 3,
    };

    if (this.config.uiResponsivenessCheck) {
      this.startUiResponsivenessMonitoring();
    }
  }

  /**
   * Process an event through the backpressure controller
   */
  async processEvent(event: Event): Promise<boolean> {
    this.recordEvent();

    // Check if we should throttle
    if (this.shouldThrottle()) {
      this.applyThrottling();
      this.eventsDropped++;
      logger.debug(`Event dropped due to backpressure: ${event.type}`);
      return false; // Event was dropped
    }

    this.totalEventsProcessed++;
    return true; // Event can proceed
  }

  /**
   * Record an event for rate monitoring
   */
  private recordEvent(): void {
    const now = Date.now();
    this.eventTimestamps.push(now);

    // Clean old timestamps outside the monitoring window
    const cutoffTime = now - this.config.monitoringWindowMs;
    const firstValidIndex = this.eventTimestamps.findIndex(ts => ts >= cutoffTime);

    if (firstValidIndex > 0) {
      // Remove all timestamps before the cutoff
      this.eventTimestamps.splice(0, firstValidIndex);
    } else if (firstValidIndex === -1 && this.eventTimestamps.length > 0) {
      // All timestamps are old, clear the array
      this.eventTimestamps.length = 0;
    }
  }

  /**
   * Calculate current event rate
   */
  getCurrentEventRate(): number {
    const now = Date.now();
    const windowStart = now - this.config.monitoringWindowMs;

    // Count events in the current window
    const eventsInWindow = this.eventTimestamps.filter(ts => ts >= windowStart).length;

    // Calculate rate (events per second)
    const windowSeconds = this.config.monitoringWindowMs / 1000;
    return eventsInWindow / windowSeconds;
  }

  /**
   * Check if throttling should be applied
   */
  private shouldThrottle(): boolean {
    const currentRate = this.getCurrentEventRate();
    const rateThreshold = (this.config.throttleThreshold / 100) * this.config.maxEventRate;

    // Check event rate
    if (currentRate > rateThreshold) {
      return true;
    }

    // Check UI responsiveness if enabled
    if (this.config.uiResponsivenessCheck) {
      const uiResponsiveness = this.checkUiResponsiveness();
      if (uiResponsiveness > this.config.uiResponsivenessThreshold) {
        logger.warn(`UI responsiveness degraded: ${uiResponsiveness}ms`);
        return true;
      }
    }

    return false;
  }

  /**
   * Apply throttling measures
   */
  private applyThrottling(): void {
    if (!this.isThrottling) {
      this.isThrottling = true;
      this.lastThrottleTime = new Date();
      logger.warn('Backpressure throttling activated');
    }

    // Increase throttling level (graceful degradation)
    this.throttlingLevel = Math.min(
      this.throttlingLevel + 1,
      this.config.gracefulDegradationSteps
    );

    // Apply throttling delay based on level
    const delayMs = Math.pow(2, this.throttlingLevel) * 10; // Exponential backoff
    // Note: In a real implementation, this delay would be applied to the processing pipeline
    logger.debug(`Throttling level ${this.throttlingLevel}, delay ${delayMs}ms`);
  }

  /**
   * Release throttling when conditions improve
   */
  private releaseThrottling(): void {
    if (this.isThrottling) {
      const currentRate = this.getCurrentEventRate();
      const rateThreshold = (this.config.throttleThreshold / 100) * this.config.maxEventRate;

      // Check if we can release throttling
      let canRelease = currentRate < rateThreshold * 0.7; // 70% of threshold

      if (this.config.uiResponsivenessCheck) {
        const uiResponsiveness = this.checkUiResponsiveness();
        canRelease = canRelease && uiResponsiveness < this.config.uiResponsivenessThreshold * 0.8;
      }

      if (canRelease) {
        this.isThrottling = false;
        this.throttlingLevel = 0;
        logger.info('Backpressure throttling released');
      }
    }
  }

  /**
   * Check UI responsiveness (simplified implementation)
   */
  private checkUiResponsiveness(): number {
    const startTime = Date.now();

    // Simple responsiveness check - measure how long a simple operation takes
    // In a real application, this might involve checking event loop lag,
    // measuring time to process UI events, etc.
    for (let i = 0; i < 1000; i++) {
      // Simple computation to simulate UI work
      Math.sin(i) * Math.cos(i);
    }

    const endTime = Date.now();
    this.lastUiResponsivenessCheck = endTime - startTime;

    return this.lastUiResponsivenessCheck;
  }

  /**
   * Start UI responsiveness monitoring
   */
  private startUiResponsivenessMonitoring(): void {
    // Check UI responsiveness every 5 seconds
    this.uiCheckInterval = setInterval(() => {
      this.checkUiResponsiveness();
      this.releaseThrottling(); // Check if we can release throttling
    }, 5000);
  }

  /**
   * Get current backpressure metrics
   */
  getMetrics(): BackpressureMetrics {
    return {
      currentEventRate: this.getCurrentEventRate(),
      isThrottling: this.isThrottling,
      throttlingLevel: this.throttlingLevel,
      uiResponsivenessMs: this.config.uiResponsivenessCheck ? this.lastUiResponsivenessCheck : undefined,
      totalEventsProcessed: this.totalEventsProcessed,
      eventsDropped: this.eventsDropped,
      lastThrottleTime: this.lastThrottleTime,
    };
  }

  /**
   * Get throttling delay for the current level
   */
  getThrottlingDelay(): number {
    if (!this.isThrottling) return 0;
    return Math.pow(2, this.throttlingLevel) * 10; // milliseconds
  }

  /**
   * Manually trigger throttling (for testing)
   */
  triggerThrottling(): void {
    this.applyThrottling();
  }

  /**
   * Manually release throttling (for testing)
   */
  releaseThrottlingManually(): void {
    this.isThrottling = false;
    this.throttlingLevel = 0;
    logger.info('Backpressure throttling manually released');
  }

  /**
   * Reset metrics and state
   */
  reset(): void {
    this.eventTimestamps.length = 0;
    this.totalEventsProcessed = 0;
    this.eventsDropped = 0;
    this.isThrottling = false;
    this.throttlingLevel = 0;
    this.lastThrottleTime = undefined;
    logger.info('BackpressureController metrics reset');
  }

  /**
   * Shutdown the controller
   */
  shutdown(): void {
    if (this.uiCheckInterval) {
      clearInterval(this.uiCheckInterval);
      this.uiCheckInterval = undefined;
    }

    this.reset();
    logger.info('BackpressureController shutdown complete');
  }
}