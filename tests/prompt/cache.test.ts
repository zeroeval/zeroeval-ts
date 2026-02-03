import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { TTLCache } from '../../src/utils/cache';

describe('TTLCache', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('basic operations', () => {
    it('should set and get value', () => {
      const cache = new TTLCache<string, string>();
      cache.set('key', 'value');
      expect(cache.get('key')).toBe('value');
    });

    it('should return undefined for missing key', () => {
      const cache = new TTLCache<string, string>();
      expect(cache.get('missing')).toBeUndefined();
    });

    it('should overwrite existing value', () => {
      const cache = new TTLCache<string, string>();
      cache.set('key', 'value1');
      cache.set('key', 'value2');
      expect(cache.get('key')).toBe('value2');
    });

    it('should delete key', () => {
      const cache = new TTLCache<string, string>();
      cache.set('key', 'value');
      cache.delete('key');
      expect(cache.get('key')).toBeUndefined();
    });

    it('should clear all entries', () => {
      const cache = new TTLCache<string, string>();
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.clear();
      expect(cache.get('key1')).toBeUndefined();
      expect(cache.get('key2')).toBeUndefined();
    });

    it('should report size', () => {
      const cache = new TTLCache<string, string>();
      expect(cache.size).toBe(0);
      cache.set('key1', 'value1');
      expect(cache.size).toBe(1);
      cache.set('key2', 'value2');
      expect(cache.size).toBe(2);
    });
  });

  describe('TTL expiration', () => {
    it('should return value before TTL expires', () => {
      const cache = new TTLCache<string, string>({ ttlMs: 1000 });
      cache.set('key', 'value');

      vi.advanceTimersByTime(500);
      expect(cache.get('key')).toBe('value');
    });

    it('should return undefined after TTL expires', () => {
      const cache = new TTLCache<string, string>({ ttlMs: 1000 });
      cache.set('key', 'value');

      vi.advanceTimersByTime(1001);
      expect(cache.get('key')).toBeUndefined();
    });

    it('should use default 60s TTL', () => {
      const cache = new TTLCache<string, string>();
      cache.set('key', 'value');

      vi.advanceTimersByTime(59000);
      expect(cache.get('key')).toBe('value');

      vi.advanceTimersByTime(2000);
      expect(cache.get('key')).toBeUndefined();
    });
  });

  describe('LRU eviction', () => {
    it('should evict oldest entry when maxSize exceeded', () => {
      const cache = new TTLCache<string, string>({ maxSize: 2 });
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.set('key3', 'value3');

      expect(cache.get('key1')).toBeUndefined();
      expect(cache.get('key2')).toBe('value2');
      expect(cache.get('key3')).toBe('value3');
    });

    it('should update LRU order on get', () => {
      const cache = new TTLCache<string, string>({ maxSize: 2 });
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');

      // Access key1 to make it most recently used
      cache.get('key1');

      // Add key3, should evict key2 (least recently used)
      cache.set('key3', 'value3');

      expect(cache.get('key1')).toBe('value1');
      expect(cache.get('key2')).toBeUndefined();
      expect(cache.get('key3')).toBe('value3');
    });

    it('should use default maxSize of 512', () => {
      const cache = new TTLCache<number, string>();
      for (let i = 0; i < 600; i++) {
        cache.set(i, `value${i}`);
      }

      // First entries should be evicted
      expect(cache.get(0)).toBeUndefined();
      expect(cache.get(87)).toBeUndefined();

      // Later entries should still exist
      expect(cache.get(599)).toBe('value599');
    });
  });

  describe('has method', () => {
    it('should return true for existing non-expired key', () => {
      const cache = new TTLCache<string, string>();
      cache.set('key', 'value');
      expect(cache.has('key')).toBe(true);
    });

    it('should return false for missing key', () => {
      const cache = new TTLCache<string, string>();
      expect(cache.has('missing')).toBe(false);
    });

    it('should return false for expired key', () => {
      const cache = new TTLCache<string, string>({ ttlMs: 1000 });
      cache.set('key', 'value');
      vi.advanceTimersByTime(1001);
      expect(cache.has('key')).toBe(false);
    });
  });
});
