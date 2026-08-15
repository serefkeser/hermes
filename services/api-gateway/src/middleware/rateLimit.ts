// Rate limiting middleware using KV
import type { Env } from '../worker-configuration';

export function rateLimitMiddleware() {
  return async (c: any, next: any) => {
    const env = c.env;
    const kv = env.RATE_LIMIT_KV;
    const windowMs = parseInt(env.RATE_LIMIT_WINDOW_MS || '60000', 10);
    const maxRequests = parseInt(env.RATE_LIMIT_MAX_REQUESTS || '100', 10);

    // Get client identifier (IP or user ID)
    const userId = c.get('userId');
    const ip = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown';
    const key = `ratelimit:${userId || ip}`;

    const now = Date.now();
    const windowStart = now - windowMs;

    try {
      // Get current count from KV
      const data = await kv.get(key, { type: 'json' }) as { count: number; resetAt: number } | null;

      let count = 0;
      let resetAt = now + windowMs;

      if (data && data.resetAt > now) {
        count = data.count;
        resetAt = data.resetAt;
      } else {
        // New window
        resetAt = now + windowMs;
      }

      // Check limit
      if (count >= maxRequests) {
        const retryAfter = Math.ceil((resetAt - now) / 1000);
        c.res.headers.set('X-RateLimit-Limit', maxRequests.toString());
        c.res.headers.set('X-RateLimit-Remaining', '0');
        c.res.headers.set('X-RateLimit-Reset', Math.ceil(resetAt / 1000).toString());
        c.res.headers.set('Retry-After', retryAfter.toString());

        return c.json({
          success: false,
          error: {
            code: 'RATE_LIMITED',
            message: 'Çok fazla istek. Lütfen bekleyin.',
            details: { retryAfter },
          },
        }, 429);
      }

      // Increment and store
      count++;
      await kv.put(key, JSON.stringify({ count, resetAt }), { expirationTtl: Math.ceil(windowMs / 1000) + 10 });

      // Set rate limit headers
      c.res.headers.set('X-RateLimit-Limit', maxRequests.toString());
      c.res.headers.set('X-RateLimit-Remaining', (maxRequests - count).toString());
      c.res.headers.set('X-RateLimit-Reset', Math.ceil(resetAt / 1000).toString());

      await next();
    } catch (error) {
      console.error('[RATE_LIMIT] Error:', error);
      // Fail open - allow request through if rate limiting fails
      await next();
    }
  };
}