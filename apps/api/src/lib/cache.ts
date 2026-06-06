import Redis from 'ioredis';

const redisUrl = process.env.REDIS_URL;
let redisClient: Redis | null = null;

if (redisUrl) {
  try {
    redisClient = new Redis(redisUrl, {
      maxRetriesPerRequest: 1,
      retryStrategy: () => null, // Do not keep retrying if connection fails
    });
    
    redisClient.on('error', (err) => {
      console.warn('[Cache] Redis client warning:', err.message);
    });

    redisClient.on('connect', () => {
      console.log('[Cache] Redis client connected successfully.');
    });
  } catch (err: any) {
    console.warn('[Cache] Redis initialization error:', err.message);
  }
}

// Local in-memory fallback cache
const localCache = new Map<string, { data: any; expiry: number }>();

export async function getCachedData(key: string): Promise<any | null> {
  // 1. Try Redis first
  if (redisClient && redisClient.status === 'ready') {
    try {
      const cached = await redisClient.get(key);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (e) {
      console.warn('[Cache] Redis get error:', e);
    }
  }

  // 2. Fall back to local memory cache
  const localItem = localCache.get(key);
  if (localItem) {
    if (Date.now() < localItem.expiry) {
      return localItem.data;
    } else {
      localCache.delete(key);
    }
  }

  return null;
}

export async function setCachedData(key: string, data: any, ttlSeconds: number): Promise<void> {
  // 1. Set in Redis
  if (redisClient && redisClient.status === 'ready') {
    try {
      await redisClient.set(key, JSON.stringify(data), 'EX', ttlSeconds);
    } catch (e) {
      console.warn('[Cache] Redis set error:', e);
    }
  }

  // 2. Always set in local memory cache as fallback/secondary cache
  localCache.set(key, {
    data,
    expiry: Date.now() + (ttlSeconds * 1000),
  });
}

export async function invalidateCachePattern(pattern: string): Promise<void> {
  // 1. Invalidate local memory keys
  for (const key of localCache.keys()) {
    if (key.includes(pattern)) {
      localCache.delete(key);
    }
  }

  // 2. Invalidate Redis keys
  if (redisClient && redisClient.status === 'ready') {
    try {
      // Find keys matching pattern
      const keys = await redisClient.keys(`*${pattern}*`);
      if (keys.length > 0) {
        await redisClient.del(...keys);
      }
    } catch (e) {
      console.warn('[Cache] Redis invalidation pattern error:', e);
    }
  }
}
