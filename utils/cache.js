const fs = require('fs');

/**
 * High-performance Cache Module
 * Provides fast in-memory caching with TTL support and optional Redis integration if configured.
 */

class MemoryCache {
  constructor() {
    this.cache = new Map();
  }

  get(key) {
    const item = this.cache.get(key);
    if (!item) return null;

    if (item.expiry && Date.now() > item.expiry) {
      this.cache.delete(key);
      return null;
    }
    return item.value;
  }

  set(key, value, ttlSeconds = 300) {
    const expiry = ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : null;
    this.cache.set(key, { value, expiry });
    // Prevent memory leaks: limit cache size to 1000 items
    if (this.cache.size > 1000) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
  }

  del(key) {
    this.cache.delete(key);
  }

  clearPattern(pattern) {
    const regex = new RegExp(pattern.replace(/\*/g, '.*'));
    for (const key of this.cache.keys()) {
      if (regex.test(key)) {
        this.cache.delete(key);
      }
    }
  }

  flush() {
    this.cache.clear();
  }
}

const memoryCache = new MemoryCache();

/**
 * Cache Wrapper Helper
 * @param {string} key - Unique cache key
 * @param {number} ttlSeconds - Time-to-live in seconds
 * @param {Function} fetchFn - Async function to execute on cache miss
 */
async function wrap(key, ttlSeconds, fetchFn) {
  const cached = memoryCache.get(key);
  if (cached !== null && cached !== undefined) {
    return cached;
  }

  const freshData = await fetchFn();
  if (freshData !== null && freshData !== undefined) {
    memoryCache.set(key, freshData, ttlSeconds);
  }
  return freshData;
}

module.exports = {
  get: (key) => memoryCache.get(key),
  set: (key, val, ttl) => memoryCache.set(key, val, ttl),
  del: (key) => memoryCache.del(key),
  clearPattern: (pattern) => memoryCache.clearPattern(pattern),
  flush: () => memoryCache.flush(),
  wrap,
};
