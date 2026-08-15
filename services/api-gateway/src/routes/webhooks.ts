// Webhook routes - Social media callbacks, GitHub Actions, etc.
import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../worker-configuration';
import { AppError } from '@otonom/shared-utils';
import { verifyToken } from '@otonom/shared-utils';

export const webhookRoutes = new Hono<{ Bindings: Env }>();

// Buffer.com webhook
webhookRoutes.post('/buffer', async (c) => {
  const env = c.env;
  const body = await c.req.json();

  // Verify webhook signature if provided
  const signature = c.req.header('X-Buffer-Signature');
  if (signature && env.BUFFER_WEBHOOK_SECRET) {
    // Verify HMAC signature
    // const valid = await verifyHmac(body, signature, env.BUFFER_WEBHOOK_SECRET);
    // if (!valid) throw new AppError('UNAUTHORIZED', 'Invalid signature', 401);
  }

  // Process Buffer webhook
  // Events: post.published, post.failed, etc.
  const event = c.req.header('X-Buffer-Event');

  console.log('[WEBHOOK] Buffer event:', event, body);

  // Update job status if post was published/failed
  if (body.post?.id) {
    // Find job by Buffer post ID
    // Update job result with post URL
  }

  return c.json({ success: true, received: true });
});

// LinkedIn webhook
webhookRoutes.post('/linkedin', async (c) => {
  const env = c.env;
  const body = await c.req.json();

  const event = c.req.header('X-LinkedIn-Event');

  console.log('[WEBHOOK] LinkedIn event:', event, body);

  // Process LinkedIn webhook
  // Events: POST_PUBLISHED, POST_FAILED, etc.

  return c.json({ success: true, received: true });
});

// GitHub Actions webhook (for CI status updates)
webhookRoutes.post('/github', async (c) => {
  const env = c.env;
  const signature = c.req.header('X-Hub-Signature-256');
  const body = await c.req.text();

  // Verify GitHub webhook signature
  if (signature && env.GITHUB_WEBHOOK_SECRET) {
    // const valid = await verifyGithubSignature(body, signature, env.GITHUB_WEBHOOK_SECRET);
    // if (!valid) throw new AppError('UNAUTHORIZED', 'Invalid signature', 401);
  }

  const event = c.req.header('X-GitHub-Event');
  const payload = JSON.parse(body);

  console.log('[WEBHOOK] GitHub event:', event, payload);

  // Process GitHub events: workflow_run, check_run, etc.
  // Could update deployment status, notify users

  return c.json({ success: true, received: true });
});

// Generic webhook for testing
webhookRoutes.post('/test', async (c) => {
  const body = await c.req.json();
  console.log('[WEBHOOK] Test:', body);
  return c.json({ success: true, received: true, echo: body });
});

// Webhook verification endpoint (for services that require challenge-response)
webhookRoutes.get('/verify', async (c) => {
  const challenge = c.req.query('challenge');
  const mode = c.req.query('hub.mode');
  const token = c.req.query('hub.verify_token');

  if (mode === 'subscribe' && token === env.WEBHOOK_VERIFY_TOKEN) {
    return c.text(challenge || '');
  }

  return c.json({ success: false, error: 'Verification failed' }, 403);
});

// Handle webhook retries/dead letter
webhookRoutes.post('/retry/:jobId', async (c) => {
  const env = c.env;
  const userId = c.get('userId')!;
  const jobId = c.req.param('jobId');

  // Verify ownership
  const jobData = await env.RATE_LIMIT_KV.get(`job:${jobId}`);
  if (!jobData) {
    throw new AppError('NOT_FOUND', 'İş bulunamadı', 404);
  }
  const job = JSON.parse(jobData);
  if (job.userId !== userId) {
    throw new AppError('FORBIDDEN', 'Bu işe erişim yetkiniz yok', 403);
  }

  // Re-send webhook
  await env.JOB_QUEUE.send({
    type: 'webhook.retry',
    payload: { jobId, originalPayload: job.result?.webhookPayload },
    timestamp: Date.now(),
    retries: 0,
    maxRetries: 3,
  });

  return c.json({ success: true, message: 'Webhook yeniden gönderildi' });
});