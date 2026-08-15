// API Gateway - Main entry point for Cloudflare Workers
// Routes requests to appropriate services

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { prettyJSON } from 'hono/pretty-json';
import { HTTPException } from 'hono/http-exception';
import type { Env } from './worker-configuration';

// Import route modules
import { authRoutes } from './routes/auth';
import { jobRoutes } from './routes/jobs';
import { mediaRoutes } from './routes/media';
import { renderRoutes } from './routes/render';
import { webhookRoutes } from './routes/webhooks';
import { healthRoutes } from './routes/health';

// Import middleware
import { requestIdMiddleware } from './middleware/requestId';
import { rateLimitMiddleware } from './middleware/rateLimit';
import { authMiddleware } from './middleware/auth';
import { errorHandler } from './middleware/errorHandler';

const app = new Hono<{ Bindings: Env }>();

// Global middleware
app.use('*', logger());
app.use('*', prettyJSON());
app.use('*', requestIdMiddleware());
app.use('*', rateLimitMiddleware());

// CORS configuration
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
  allowHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposeHeaders: ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset'],
  credentials: true,
  maxAge: 86400,
}));

// Health check (no auth required)
app.route('/health', healthRoutes);
app.route('/api/health', healthRoutes);

// Public auth routes
app.route('/api/auth', authRoutes);

// Protected routes (require authentication)
const protectedRoutes = new Hono<{ Bindings: Env }>();
protectedRoutes.use('*', authMiddleware());

protectedRoutes.route('/jobs', jobRoutes);
protectedRoutes.route('/media', mediaRoutes);
protectedRoutes.route('/render', renderRoutes);
protectedRoutes.route('/webhooks', webhookRoutes);

app.route('/api', protectedRoutes);

// 404 handler
app.notFound((c) => {
  return c.json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `Route ${c.req.method} ${c.req.path} not found`,
    },
  }, 404);
});

// Error handler
app.onError(errorHandler);

// Export for Cloudflare Workers
export default app;

// Export types for testing
export type AppType = typeof app;