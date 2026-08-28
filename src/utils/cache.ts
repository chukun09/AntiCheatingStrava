/**
 * In-Memory TTL Cache with Single-Flight (Stampede / Thundering Herd Prevention)
 */

interface CacheEntry<T> {
  data: T;
  cachedAt: number;
  expiresAt: number;
}

export class MemoryCache {
  private cache = new Map<string, CacheEntry<any>>();
  private inFlight = new Map<string, Promise<any>>();
  private hits = 0;
  private misses = 0;

  /**
   * Fetch from cache or execute fetcher with single-flight mutex protection
   */
  async getOrSet<T>(
    key: string,
    fetcher: () => Promise<T>,
    ttlMs: number = 5000
  ): Promise<{ data: T; isCached: boolean; ageMs: number }> {
    const now = Date.now();
    const entry = this.cache.get(key);

    // Cache HIT
    if (entry && entry.expiresAt > now) {
      this.hits++;
      return {
        data: entry.data as T,
        isCached: true,
        ageMs: now - entry.cachedAt
      };
    }

    // Single-Flight Mutex: If a fetcher is already running for this key, join it!
    if (this.inFlight.has(key)) {
      this.hits++;
      const data = await this.inFlight.get(key)!;
      return {
        data,
        isCached: true,
        ageMs: 0
      };
    }

    // Cache MISS: Start single fetcher
    this.misses++;
    const promise = (async () => {
      try {
        const result = await fetcher();
        const cachedAt = Date.now();
        this.cache.set(key, {
          data: result,
          cachedAt,
          expiresAt: cachedAt + ttlMs
        });
        return result;
      } finally {
        this.inFlight.delete(key);
      }
    })();

    this.inFlight.set(key, promise);
    const data = await promise;

    return {
      data,
      isCached: false,
      ageMs: 0
    };
  }

  /**
   * Invalidate a specific key or all keys
   */
  invalidate(key?: string): void {
    if (key) {
      this.cache.delete(key);
    } else {
      this.cache.clear();
    }
  }

  /**
   * Get cache performance metrics
   */
  getStats() {
    return {
      size: this.cache.size,
      inFlightCount: this.inFlight.size,
      hits: this.hits,
      misses: this.misses,
      hitRatio: this.hits + this.misses > 0 ? (this.hits / (this.hits + this.misses)) * 100 : 0
    };
  }
}

export const appCache = new MemoryCache();
