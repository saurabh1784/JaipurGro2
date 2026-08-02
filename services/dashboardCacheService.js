/**
 * In-memory Cache Service for heavy Dashboard & Live Status queries
 * Default TTL: 300 seconds (5 minutes)
 */

class DashboardCacheService {
  constructor(defaultTtlSeconds = 300) {
    this.cache = new Map();
    this.defaultTtl = defaultTtlSeconds * 1000;
  }

  get(key) {
    if (!this.cache.has(key)) return null;
    const entry = this.cache.get(key);
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    return entry.value;
  }

  set(key, value, ttlSeconds) {
    const ttl = ttlSeconds ? ttlSeconds * 1000 : this.defaultTtl;
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + ttl,
    });
  }

  clear() {
    this.cache.clear();
  }

  invalidateUser(userId) {
    for (const key of this.cache.keys()) {
      if (key.includes(`:${userId}:`)) {
        this.cache.delete(key);
      }
    }
  }
}

const dashboardCache = new DashboardCacheService(300);

module.exports = dashboardCache;
