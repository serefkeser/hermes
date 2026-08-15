// Jobs routes - Create, List, Get, Cancel, Stream
import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../worker-configuration';
import { generateJobId } from '@otonom/shared-utils';
import { AppError } from '@otonom/shared-utils';
import type { CreateJobRequest, Job, JobStatus, PaginatedResponse } from '@otonom/shared-types';

export const jobRoutes = new Hono<{ Bindings: Env }>();

// Validation schemas
const createJobSchema = z.object({
  type: z.enum(['video', 'image', 'analysis', 'guzel-soz', 'iddia-analizi']),
  input: z.object({
    type: z.enum(['text', 'url', 'media', 'prompt']),
    data: z.union([z.string(), z.array(z.object({
      id: z.string(),
      name: z.string(),
      type: z.enum(['image', 'video', 'audio']),
      mimeType: z.string(),
      size: z.number(),
      url: z.string().optional(),
      r2Key: z.string().optional(),
      thumbnailUrl: z.string().optional(),
      duration: z.number().optional(),
      width: z.number().optional(),
      height: z.number().optional(),
    }))]),
    metadata: z.record(z.unknown()).optional(),
  }),
  config: z.object({
    duration: z.enum(['15', '30', '60', '90', 'unlimited']),
    aspectRatio: z.enum(['9:16', '16:9', '1:1']),
    videoStyle: z.enum(['news_flash', 'cinematic', 'explainer', 'weekly_roundup', 'prompt_output']),
    fontStyle: z.enum(['modern', 'classic', 'typewriter']),
    imageStyle: z.enum(['cinematic', 'watercolor', 'sketch', 'oil_painting', 'minimalist', 'cyberpunk', 'retro', '3d_render', 'anime']),
    language: z.enum(['tr', 'en', 'fr', 'de', 'es', 'ar', 'ru']),
    subtitles: z.enum(['on', 'off']),
    resolution: z.enum(['1K', '2K', '4K']),
    transition: z.enum(['none', 'crossfade', 'fadeIn', 'fadeOut', 'slideIn', 'slideOut']),
    videoFormat: z.enum(['webm', 'mp4']),
    analysisMode: z.enum(['yorumsuz', 'visibility', 'deep_analysis']),
    tip: z.enum(['haber', 'guzel_soz', 'iddia_analizi']),
    sourceName: z.string().optional(),
    yorum: z.string().optional(),
    customSceneImages: z.array(z.string()).optional(),
    backgroundMusic: z.object({
      id: z.string(),
      name: z.string(),
      type: z.literal('audio'),
      mimeType: z.string(),
      size: z.number(),
      url: z.string().optional(),
      r2Key: z.string().optional(),
      duration: z.number().optional(),
    }).nullable().optional(),
    backgroundMusicVolume: z.number().min(0).max(1).optional(),
  }),
  priority: z.enum(['low', 'normal', 'high']).optional(),
});

const listJobsSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  status: z.enum(['queued', 'processing', 'completed', 'failed', 'cancelled']).optional(),
  type: z.enum(['video', 'image', 'analysis', 'guzel-soz', 'iddia-analizi']).optional(),
  sortBy: z.enum(['createdAt', 'startedAt', 'completedAt']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

// Create job
jobRoutes.post('/', async (c) => {
  const env = c.env;
  const userId = c.get('userId')!;
  const body = await c.req.json();

  const result = createJobSchema.safeParse(body);
  if (!result.success) {
    throw new AppError('VALIDATION_ERROR', 'Geçersiz iş verisi', 400, { issues: result.error.errors }, true);
  }

  const { type, input, config, priority } = result.data;

  // Check user's plan limits
  // TODO: Implement plan limit checking
  // const limits = getPlanLimits(user.plan);
  // if (user.jobsToday >= limits.jobsPerDay) throw AppError.rateLimited(...)

  // Create job object
  const jobId = generateJobId();
  const now = Date.now();

  const job: Job = {
    id: jobId,
    userId,
    type,
    status: 'queued',
    priority: priority || 'normal',
    input,
    config,
    progress: 0,
    logs: [
      {
        timestamp: now,
        level: 'info',
        message: 'İş kuyruğa alındı',
        step: 'queue',
      },
    ],
    createdAt: now,
  };

  // Store job in KV (in production, use D1 or Queue)
  await env.RATE_LIMIT_KV.put(`job:${jobId}`, JSON.stringify(job));

  // Add to user's job list
  const userJobsKey = `user:jobs:${userId}`;
  let userJobs = await env.RATE_LIMIT_KV.get(userJobsKey, { type: 'json' }) as string[] || [];
  userJobs.unshift(jobId);
  userJobs = userJobs.slice(0, 1000); // Keep last 1000
  await env.RATE_LIMIT_KV.put(userJobsKey, JSON.stringify(userJobs));

  // Push to queue for processing
  await env.JOB_QUEUE.send({
    type: 'job.create',
    payload: { jobId, userId, type, input, config, priority: priority || 'normal' },
    timestamp: now,
    retries: 0,
    maxRetries: 3,
  });

  return c.json({
    success: true,
    data: {
      jobId,
      status: 'queued',
      message: 'İş başarıyla kuyruğa alındı',
    },
  }, 201);
});

// List jobs
jobRoutes.get('/', async (c) => {
  const env = c.env;
  const userId = c.get('userId')!;

  const query = c.req.query();
  const result = listJobsSchema.safeParse(query);
  if (!result.success) {
    throw new AppError('VALIDATION_ERROR', 'Geçersiz sorgu parametreleri', 400, { issues: result.error.errors }, true);
  }

  const { page, pageSize, status, type, sortBy, sortOrder } = result.data;

  // Get user's job IDs
  const userJobsKey = `user:jobs:${userId}`;
  const jobIds = await env.RATE_LIMIT_KV.get(userJobsKey, { type: 'json' }) as string[] || [];

  // Fetch job details
  const jobs: Job[] = [];
  for (const jobId of jobIds) {
    const jobData = await env.RATE_LIMIT_KV.get(`job:${jobId}`);
    if (jobData) {
      const job = JSON.parse(jobData) as Job;
      // Apply filters
      if (status && job.status !== status) continue;
      if (type && job.type !== type) continue;
      jobs.push(job);
    }
  }

  // Sort
  jobs.sort((a, b) => {
    const aVal = a[sortBy];
    const bVal = b[sortBy];
    if (aVal === undefined || bVal === undefined) return 0;
    const diff = aVal > bVal ? 1 : -1;
    return sortOrder === 'asc' ? diff : -diff;
  });

  // Paginate
  const start = (page - 1) * pageSize;
  const end = start + pageSize;
  const paginatedJobs = jobs.slice(start, end);

  const response: PaginatedResponse<Job> = {
    items: paginatedJobs,
    total: jobs.length,
    page,
    pageSize,
    hasMore: end < jobs.length,
  };

  return c.json({
    success: true,
    data: response,
  });
});

// Get job by ID
jobRoutes.get('/:id', async (c) => {
  const env = c.env;
  const userId = c.get('userId')!;
  const jobId = c.req.param('id');

  const jobData = await env.RATE_LIMIT_KV.get(`job:${jobId}`);
  if (!jobData) {
    throw new AppError('NOT_FOUND', 'İş bulunamadı', 404);
  }

  const job = JSON.parse(jobData) as Job;

  // Check ownership
  if (job.userId !== userId) {
    throw new AppError('FORBIDDEN', 'Bu işe erişim yetkiniz yok', 403);
  }

  return c.json({
    success: true,
    data: { job },
  });
});

// Cancel job
jobRoutes.delete('/:id', async (c) => {
  const env = c.env;
  const userId = c.get('userId')!;
  const jobId = c.req.param('id');

  const jobData = await env.RATE_LIMIT_KV.get(`job:${jobId}`);
  if (!jobData) {
    throw new AppError('NOT_FOUND', 'İş bulunamadı', 404);
  }

  const job = JSON.parse(jobData) as Job;

  // Check ownership
  if (job.userId !== userId) {
    throw new AppError('FORBIDDEN', 'Bu işe erişim yetkiniz yok', 403);
  }

  // Can only cancel queued or processing jobs
  if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
    throw new AppError('CONFLICT', `İş zaten ${job.status} durumunda`, 409, undefined, true);
  }

  // Update job status
  job.status = 'cancelled';
  job.logs.push({
    timestamp: Date.now(),
    level: 'info',
    message: 'İş kullanıcı tarafından iptal edildi',
    step: 'cancel',
  });
  await env.RATE_LIMIT_KV.put(`job:${jobId}`, JSON.stringify(job));

  // Send cancel message to queue
  await env.JOB_QUEUE.send({
    type: 'job.cancel',
    payload: { jobId, reason: 'User cancelled' },
    timestamp: Date.now(),
    retries: 0,
    maxRetries: 1,
  });

  return c.json({
    success: true,
    data: { message: 'İş iptal edildi' },
  });
});

// Stream job progress (Server-Sent Events)
jobRoutes.get('/:id/stream', async (c) => {
  const env = c.env;
  const userId = c.get('userId')!;
  const jobId = c.req.param('id');

  // Verify job exists and user owns it
  const jobData = await env.RATE_LIMIT_KV.get(`job:${jobId}`);
  if (!jobData) {
    throw new AppError('NOT_FOUND', 'İş bulunamadı', 404);
  }
  const job = JSON.parse(jobData) as Job;
  if (job.userId !== userId) {
    throw new AppError('FORBIDDEN', 'Bu işe erişim yetkiniz yok', 403);
  }

  // Create SSE stream
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      // Send initial state
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'state', job })}\n\n`));

      // Poll for updates
      const interval = setInterval(async () => {
        const currentJobData = await env.RATE_LIMIT_KV.get(`job:${jobId}`);
        if (currentJobData) {
          const currentJob = JSON.parse(currentJobData) as Job;
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'progress', job: currentJob })}\n\n`));

          // Stop if job is complete
          if (currentJob.status === 'completed' || currentJob.status === 'failed' || currentJob.status === 'cancelled') {
            clearInterval(interval);
            controller.close();
          }
        }
      }, 2000); // Poll every 2 seconds

      // Cleanup on close
      return () => clearInterval(interval);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
});
