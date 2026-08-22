// Video Renderer - Cloudflare Worker for video generation
// Consumes render jobs from queue and processes them

import { Hono } from 'hono';
import type { Env } from './worker-configuration';
import { RenderQueueConsumer } from './queue/consumer';
import { AppError, handleError } from '@otonom/shared-utils';

// Health check endpoint
const app = new Hono<{ Bindings: Env }>();

app.get('/health', (c) => {
  return c.json({
    success: true,
    data: {
      status: 'healthy',
      service: 'otonom-video-renderer',
      version: '3.14.17',
      timestamp: Date.now(),
    },
  });
});

// Manual job trigger is restricted to authenticated non-production environments.
app.post('/render', async (c) => {
  const env = c.env;
  if (env.ENVIRONMENT === 'production') {
    throw new AppError('NOT_FOUND', 'Route bulunamadı', 404);
  }

  const authorization = c.req.header('Authorization') || '';
  if (!env.JWT_SECRET || authorization !== `Bearer ${env.JWT_SECRET}`) {
    throw new AppError('UNAUTHORIZED', 'Geçerli geliştirme erişim anahtarı gerekli', 401);
  }

  const body = await c.req.json();

  const { jobId, userId, ...jobData } = body;
  if (!jobId || !userId) {
    throw new AppError('VALIDATION_ERROR', 'jobId ve userId gerekli', 400);
  }

  await env.RENDER_QUEUE.send({
    type: 'render.start',
    payload: { jobId, userId, ...jobData },
    timestamp: Date.now(),
    retries: 0,
    maxRetries: 2,
  });

  return c.json({ success: true, message: 'Render kuyruğa alındı', jobId });
});

// Error handler
app.onError((err, c) => {
  const { error, statusCode } = handleError(err);
  return c.json({ success: false, error }, statusCode);
});

// Export the queue consumer for Wrangler
export default {
  fetch: app.fetch,
  async queue(batch: any, env: Env, ctx: any) {
    const consumer = new RenderQueueConsumer(env);
    await consumer.processBatch(batch);
  },
};

// For local development
export { RenderQueueConsumer };
