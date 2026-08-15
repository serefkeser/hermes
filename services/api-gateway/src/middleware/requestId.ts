// Request ID middleware
import type { Env } from '../worker-configuration';

export function requestIdMiddleware() {
  return async (c: any, next: any) => {
    const requestId = c.req.header('X-Request-ID') || `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    c.set('requestId', requestId);
    c.set('startTime', Date.now());
    c.res.headers.set('X-Request-ID', requestId);
    await next();
  };
}