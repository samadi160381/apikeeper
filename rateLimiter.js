import Redis from 'ioredis';
import 'dotenv/config';

export const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

redis.on('error', (err) => console.error('[redis] connection error', err));

/**
 * Sliding-window rate limiter using a Redis sorted set per key.
 * Each request adds a timestamped member; we count members inside the
 * trailing 60s window and evict anything older. Redis is used here (rather
 * than Postgres) because this runs on every single request and needs to be
 * fast and cheap -- durability doesn't matter for a 60s window.
 *
 * Returns { allowed, remaining, limit, retryAfterMs }
 */
export async function checkRateLimit(keyId, limitPerMinute) {
  const now = Date.now();
  const windowMs = 60_000;
  const windowStart = now - windowMs;
  const redisKey = `ratelimit:${keyId}`;

  const pipeline = redis.pipeline();
  pipeline.zremrangebyscore(redisKey, 0, windowStart); // drop expired entries
  pipeline.zcard(redisKey);                            // count requests in window
  const [, [, countBefore]] = await pipeline.exec();

  if (countBefore >= limitPerMinute) {
    // Find the oldest entry to compute when a slot frees up.
    const oldest = await redis.zrange(redisKey, 0, 0, 'WITHSCORES');
    const oldestTs = oldest.length ? Number(oldest[1]) : now;
    const retryAfterMs = Math.max(oldestTs + windowMs - now, 0);
    return { allowed: false, remaining: 0, limit: limitPerMinute, retryAfterMs };
  }

  // Use a unique member (timestamp + random) so concurrent requests at the
  // same millisecond don't collide and get silently dropped by the sorted set.
  const member = `${now}-${Math.random().toString(36).slice(2, 8)}`;
  await redis.zadd(redisKey, now, member);
  await redis.expire(redisKey, 60); // safety TTL so idle keys don't linger forever

  return {
    allowed: true,
    remaining: Math.max(limitPerMinute - countBefore - 1, 0),
    limit: limitPerMinute,
    retryAfterMs: 0,
  };
}
