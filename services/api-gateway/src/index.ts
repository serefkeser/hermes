import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { prettyJSON } from 'hono/pretty-json';
import { aiRoutes } from './routes/ai';
import type { AiProviderEnv } from './ai/providerRouter';

interface Env extends AiProviderEnv {
  ENVIRONMENT: string;
  CORS_ORIGIN: string;
  AI_ACCESS_TOKEN?: string;
}

const app = new Hono<{ Bindings: Env }>();

app.use('*', logger());
app.use('*', prettyJSON());
app.use('*', cors({
  origin: (origin, c) => {
    const allowedOrigins = [
      c.env.CORS_ORIGIN,
      'http://localhost:3000',
      'http://127.0.0.1:3000',
    ];
    if (!origin || allowedOrigins.includes(origin)) {
      return origin || allowedOrigins[0];
    }
    return allowedOrigins[0];
  },
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Hermes-Access'],
  exposeHeaders: ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset'],
  credentials: true,
  maxAge: 86400,
}));

const healthPayload = (c: { env: Env }) => ({
  success: true,
  data: {
    status: 'healthy',
    service: 'otonom-api-gateway',
    version: '3.14.3',
    renderMode: 'browser-local',
    persistentMediaStorage: false,
    timestamp: Date.now(),
    environment: c.env.ENVIRONMENT,
  },
});

app.get('/', c => c.json(healthPayload(c)));
app.get('/health', c => c.json(healthPayload(c)));
app.get('/api/health', c => c.json(healthPayload(c)));
app.get('/health/ready', c => c.json({
  success: true,
  data: {
    ready: true,
    checks: {
      api: true,
      renderMode: 'browser-local',
      persistentMediaStorage: 'disabled',
    },
    timestamp: Date.now(),
  },
}));

app.route('/api/ai', aiRoutes);
app.route('/ai', aiRoutes);

app.notFound((c) => {
  return c.json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `Route ${c.req.method} ${c.req.path} not found`,
    },
  }, 404);
});

export default app;
export type AppType = typeof app;
