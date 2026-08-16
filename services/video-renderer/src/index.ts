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
      version: '3.14.5',
      timestamp: Date.now(),
    },
  });
});

// Manual job trigger (for testing)
app.post('/render', async (c) => {
  const env = c.env;
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
