import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { prettyJSON } from 'hono/pretty-json';
import { aiRoutes } from './routes/ai';
import { socialRoutes } from './routes/social';
import type { AiProviderEnv } from './ai/providerRouter';

interface Env extends AiProviderEnv {
  ENVIRONMENT: string;
  AI_ACCESS_TOKEN?: string;
  BUFFER_API_KEY?: string;
  SOCIAL_MEDIA_BUCKET: R2Bucket;
}

const app = new Hono<{ Bindings: Env }>();

app.use('*', logger());
app.use('*', prettyJSON());
app.use('*', cors({
  origin: (origin, c) => {
    const allowedOrigins = c.env.ENVIRONMENT === 'production'
      ? ['https://serefkeser.github.io']
      : ['https://serefkeser.github.io', 'http://localhost:3000', 'http://127.0.0.1:3000'];
    return origin && allowedOrigins.includes(origin) ? origin : '';
  },
  allowMethods: ['GET', 'HEAD', 'POST', 'OPTIONS'],
  allowHeaders: [
    'Content-Type',
    'Authorization',
    'X-Hermes-Access',
    'X-OTONOM-Filename',
    'X-OTONOM-Caption',
  ],
  credentials: false,
  maxAge: 86400,
}));

const healthPayload = (c: { env: Env }) => ({
  success: true,
  data: {
    status: 'healthy',
    service: 'otonom-api-gateway',
    version: '3.14.25',
    renderMode: 'browser-local',
    persistentMediaStorage: true,
    bufferConfigured: Boolean(c.env.BUFFER_API_KEY),
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
      persistentMediaStorage: 'r2',
      buffer: c.env.BUFFER_API_KEY ? 'configured' : 'secret-required',
    },
    timestamp: Date.now(),
  },
}));

app.route('/api/ai', aiRoutes);
app.route('/ai', aiRoutes);
app.route('/api/social', socialRoutes);
app.route('/social', socialRoutes);

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
