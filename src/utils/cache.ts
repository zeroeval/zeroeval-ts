/**
 * TTL (Time-To-Live) cache with LRU eviction.
 * Ports the logic from zeroeval-sdk/src/zeroeval/cache.py
 */

export interface TTLCacheOptions {
  /** Time-to-live in milliseconds (default: 60000ms = 60s) */
  ttlMs?: number;
  /** Maximum number of entries (default: 512) */
  maxSize?: number;
}

interface CacheEntry<V> {
  value: V;
  timestamp: number;
}

/**
 * A simple TTL cache with LRU eviction policy.
 * Items expire after ttlMs milliseconds and the cache evicts
 * the oldest items when maxSize is exceeded.
 */
export class TTLCache<K, V> {
  private data: Map<K, CacheEntry<V>>;
  private ttlMs: number;
  private maxSize: number;

  constructor(options: TTLCacheOptions = {}) {
    this.ttlMs = options.ttlMs ?? 60000; // 60s default
    this.maxSize = options.maxSize ?? 512;
    this.data = new Map();
  }

  /**
   * Get a value from the cache.
   * Returns undefined if the key doesn't exist or has expired.
   */
  get(key: K): V | undefined {
    const now = Date.now();
    const entry = this.data.get(key);

    if (!entry) {
      return undefined;
    }

    // Check if expired
    if (now - entry.timestamp > this.ttlMs) {
      this.data.delete(key);
      return undefined;
    }

    // Move to end (LRU - delete and re-add)
    this.data.delete(key);
    this.data.set(key, entry);

    return entry.value;
  }

  /**
   * Set a value in the cache.
   * Evicts the oldest entry if the cache exceeds maxSize.
   */
  set(key: K, value: V): void {
    // Delete existing entry first to update position
    this.data.delete(key);

    // Add new entry
    this.data.set(key, {
      value,
      timestamp: Date.now(),
    });

    // Evict oldest if over capacity
    if (this.data.size > this.maxSize) {
      // Get first key (oldest)
      const firstKey = this.data.keys().next().value;
      if (firstKey !== undefined) {
        this.data.delete(firstKey);
      }
    }
  }

  /**
   * Check if a key exists and is not expired.
   */
  has(key: K): boolean {
    return this.get(key) !== undefined;
  }

  /**
   * Delete a key from the cache.
   */
  delete(key: K): boolean {
    return this.data.delete(key);
  }

  /**
   * Clear all entries from the cache.
   */
  clear(): void {
    this.data.clear();
  }

  /**
   * Get the current number of entries (may include expired entries).
   */
  get size(): number {
    return this.data.size;
  }
}
