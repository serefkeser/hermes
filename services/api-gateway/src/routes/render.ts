// Render routes - Video generation job management
import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../worker-configuration';
import { AppError } from '@otonom/shared-utils';
import type { Job, JobResult } from '@otonom/shared-types';

export const renderRoutes = new Hono<{ Bindings: Env }>();

// Start render job (async, returns job ID immediately)
renderRoutes.post('/', async (c) => {
  const env = c.env;
  const userId = c.get('userId')!;

  // Get job ID from query or body
  const jobId = c.req.query('jobId') || (await c.req.json().catch(() => ({})))?.jobId;

  if (!jobId) {
    throw new AppError('VALIDATION_ERROR', 'Job ID gerekli', 400, undefined, true);
  }

  // Verify job exists and belongs to user
  const jobData = await env.RATE_LIMIT_KV.get(`job:${jobId}`);
  if (!jobData) {
    throw new AppError('NOT_FOUND', 'İş bulunamadı', 404);
  }

  const job = JSON.parse(jobData) as Job;
  if (job.userId !== userId) {
    throw new AppError('FORBIDDEN', 'Bu işe erişim yetkiniz yok', 403);
  }

  // Check if already processing or completed
  if (job.status === 'processing') {
    throw new AppError('CONFLICT', 'İş zaten işleniyor', 409, undefined, true);
  }
  if (job.status === 'completed') {
    throw new AppError('CONFLICT', 'İş zaten tamamlandı', 409, undefined, true);
  }

  // Update job status
  job.status = 'processing';
  job.startedAt = Date.now();
  job.logs.push({
    timestamp: Date.now(),
    level: 'info',
    message: 'Video render başlatıldı',
    step: 'render_start',
  });
  await env.RATE_LIMIT_KV.put(`job:${jobId}`, JSON.stringify(job));

  // Send to video renderer queue
  await env.JOB_QUEUE.send({
    type: 'render.start',
    payload: { jobId, userId, ...job },
    timestamp: Date.now(),
    retries: 0,
    maxRetries: 2,
  });

  return c.json({
    success: true,
    data: {
      jobId,
      status: 'processing',
      message: 'Render işlemi kuyruğa alındı',
    },
  });
});

// Get render status
renderRoutes.get('/:jobId', async (c) => {
  const env = c.env;
  const userId = c.get('userId')!;
  const jobId = c.req.param('jobId');

  const jobData = await env.RATE_LIMIT_KV.get(`job:${jobId}`);
  if (!jobData) {
    throw new AppError('NOT_FOUND', 'İş bulunamadı', 404);
  }

  const job = JSON.parse(jobData) as Job;
  if (job.userId !== userId) {
    throw new AppError('FORBIDDEN', 'Bu işe erişim yetkiniz yok', 403);
  }

  return c.json({
    success: true,
    data: { job },
  });
});

// Cancel render
renderRoutes.post('/:jobId/cancel', async (c) => {
  const env = c.env;
  const userId = c.get('userId')!;
  const jobId = c.req.param('jobId');

  const jobData = await env.RATE_LIMIT_KV.get(`job:${jobId}`);
  if (!jobData) {
    throw new AppError('NOT_FOUND', 'İş bulunamadı', 404);
  }

  const job = JSON.parse(jobData) as Job;
  if (job.userId !== userId) {
    throw new AppError('FORBIDDEN', 'Bu işe erişim yetkiniz yok', 403);
  }

  if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
    throw new AppError('CONFLICT', `İş zaten ${job.status} durumunda`, 409, undefined, true);
  }

  // Update job status
  job.status = 'cancelled';
  job.logs.push({
    timestamp: Date.now(),
    level: 'info',
    message: 'Render kullanıcı tarafından iptal edildi',
    step: 'render_cancel',
  });
  await env.RATE_LIMIT_KV.put(`job:${jobId}`, JSON.stringify(job));

  // Send cancel to renderer queue
  await env.JOB_QUEUE.send({
    type: 'render.cancel',
    payload: { jobId, reason: 'User cancelled' },
    timestamp: Date.now(),
    retries: 0,
    maxRetries: 1,
  });

  return c.json({
    success: true,
    data: { message: 'Render iptal edildi' },
  });
});

// Get render result (video URL, thumbnail, etc.)
renderRoutes.get('/:jobId/result', async (c) => {
  const env = c.env;
  const userId = c.get('userId')!;
  const jobId = c.req.param('jobId');

  const jobData = await env.RATE_LIMIT_KV.get(`job:${jobId}`);
  if (!jobData) {
    throw new AppError('NOT_FOUND', 'İş bulunamadı', 404);
  }

  const job = JSON.parse(jobData) as Job;
  if (job.userId !== userId) {
    throw new AppError('FORBIDDEN', 'Bu işe erişim yetkiniz yok', 403);
  }

  if (job.status !== 'completed') {
    throw new AppError('CONFLICT', 'İş henüz tamamlanmadı', 409, { status: job.status }, true);
  }

  return c.json({
    success: true,
    data: {
      jobId,
      videoUrl: job.result?.videoUrl,
      thumbnailUrl: job.result?.thumbnailUrl,
      imageUrl: job.result?.imageUrl,
      script: job.result?.script,
      logs: job.result?.logs,
      metadata: job.result?.metadata,
      duration: job.actualDuration,
    },
  });
});

// Download video (redirects to R2 presigned URL)
renderRoutes.get('/:jobId/download', async (c) => {
  const env = c.env;
  const userId = c.get('userId')!;
  const jobId = c.req.param('jobId');

  const jobData = await env.RATE_LIMIT_KV.get(`job:${jobId}`);
  if (!jobData) {
    throw new AppError('NOT_FOUND', 'İş bulunamadı', 404);
  }

  const job = JSON.parse(jobData) as Job;
  if (job.userId !== userId) {
    throw new AppError('FORBIDDEN', 'Bu işe erişim yetkiniz yok', 403);
  }

  if (!job.result?.videoUrl) {
    throw new AppError('NOT_FOUND', 'Video bulunamadı', 404);
  }

  // Generate presigned URL for download
  const videoUrl = job.result.videoUrl;
  // If it's an R2 URL, generate presigned GET
  // For now, just redirect
  return c.redirect(videoUrl);
});