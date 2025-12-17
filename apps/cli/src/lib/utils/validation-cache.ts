/**
 * Validation cache for provider/model validation results
 * Implements TTL-based caching following OpenCode SDK patterns
 */
export interface ValidationResult {
  isValid: boolean;
  error?: string;
  timestamp: number;
}

export interface ValidationKey {
  provider: string;
  model: string;
}

export class ValidationCache {
  private cache = new Map<string, ValidationResult>();
  private readonly ttlMs: number;

  constructor(ttlMs: number = 5 * 60 * 1000) { // 5 minutes default TTL
    this.ttlMs = ttlMs;
  }

  private createKey(key: ValidationKey): string {
    return `${key.provider}:${key.model}`;
  }

  private isExpired(result: ValidationResult): boolean {
    return Date.now() - result.timestamp > this.ttlMs;
  }

  get(key: ValidationKey): ValidationResult | null {
    const cacheKey = this.createKey(key);
    const result = this.cache.get(cacheKey);

    if (!result) {
      return null;
    }

    if (this.isExpired(result)) {
      this.cache.delete(cacheKey);
      return null;
    }

    return result;
  }

  set(key: ValidationKey, result: Omit<ValidationResult, 'timestamp'>): void {
    const cacheKey = this.createKey(key);
    const cachedResult: ValidationResult = {
      ...result,
      timestamp: Date.now()
    };

    this.cache.set(cacheKey, cachedResult);
  }

  invalidate(key?: ValidationKey): void {
    if (key) {
      const cacheKey = this.createKey(key);
      this.cache.delete(cacheKey);
    } else {
      // Invalidate all entries
      this.cache.clear();
    }
  }

  invalidateProvider(provider: string): void {
    const keysToDelete: string[] = [];

    for (const cacheKey of this.cache.keys()) {
      if (cacheKey.startsWith(`${provider}:`)) {
        keysToDelete.push(cacheKey);
      }
    }

    keysToDelete.forEach(key => this.cache.delete(key));
  }

  getStats(): { entries: number; expiredEntries: number } {
    let expiredCount = 0;

    for (const result of this.cache.values()) {
      if (this.isExpired(result)) {
        expiredCount++;
      }
    }

    return {
      entries: this.cache.size,
      expiredEntries: expiredCount
    };
  }

  cleanup(): void {
    const keysToDelete: string[] = [];

    for (const [key, result] of this.cache.entries()) {
      if (this.isExpired(result)) {
        keysToDelete.push(key);
      }
    }

    keysToDelete.forEach(key => this.cache.delete(key));
  }
}

// Singleton instance for application-wide use
export const validationCache = new ValidationCache();

// Periodic cleanup to prevent memory leaks
setInterval(() => {
  validationCache.cleanup();
}, 60 * 1000); // Clean up every minute