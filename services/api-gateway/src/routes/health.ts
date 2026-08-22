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
      version: '3.14.18',
      timestamp: Date.now(),
      environment: c.env.ENVIRONMENT,
    },
  });
});

healthRoutes.get('/ready', (c) => {
  const checks = {
    api: true,
    renderMode: 'browser-local',
    persistentMediaStorage: 'disabled',
  };

  return c.json({
    success: true,
    data: {
      ready: true,
      checks,
      timestamp: Date.now(),
    },
  });
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
