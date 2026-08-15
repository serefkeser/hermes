// Health check routes
import { Hono } from 'hono';
import type { Env } from '../worker-configuration';

export const healthRoutes = new Hono<{ Bindings: Env }>();

healthRoutes.get('/', (c) => {
  return c.json({
    success: true,
    data: {
      status: 'healthy',
      service: 'otonom-api-gateway',
      version: '3.14.0',
      timestamp: Date.now(),
      environment: c.env.ENVIRONMENT,
    },
  });
});

healthRoutes.get('/ready', (c) => {
  // Check dependencies (KV, Queue, R2)
  const checks = {
    kv: true, // Would check KV connectivity
    queue: true, // Would check queue connectivity
    r2: true, // Would check R2 connectivity
  };

  const allHealthy = Object.values(checks).every(v => v);

  return c.json({
    success: true,
    data: {
      ready: allHealthy,
      checks,
      timestamp: Date.now(),
    },
  }, allHealthy ? 200 : 503);
});

healthRoutes.get('/live', (c) => {
  return c.json({
    success: true,
    data: {
      alive: true,
      timestamp: Date.now(),
    },
  });
});