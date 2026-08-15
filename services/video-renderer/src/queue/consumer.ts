// Queue consumer for video rendering jobs
import type { Env } from '../worker-configuration';
import { AppError } from '@otonom/shared-utils';
import type { Job, JobStatus, JobResult, VideoScript, VideoSlide } from '@otonom/shared-types';
import { RENDER_CONFIG, AI_CONFIG, ERROR_PATTERNS, ECONOMIC_DATA } from '@otonom/shared-config';
import { getWPS, getFontFamily } from '@otonom/shared-config';

interface QueueMessage<T = unknown> {
  id: string;
  type: string;
  payload: T;
  timestamp: number;
  retries: number;
  maxRetries: number;
}

interface RenderJobPayload {
  jobId: string;
  userId: string;
  type: string;
  input: any;
  config: any;
  priority: string;
}

export class RenderQueueConsumer {
  private env: Env;
  private maxConcurrent = 1; // Free tier limit

  constructor(env: Env) {
    this.env = env;
  }

  async processBatch(batch: any): Promise<void> {
    for (const message of batch.messages) {
      try {
        await this.processMessage(message);
        message.ack();
      } catch (error) {
        console.error('[RENDER_QUEUE] Failed to process message:', error);
        if (message.retries < message.maxRetries) {
          message.retry({ delaySeconds: 60 * (message.retries + 1) });
        } else {
          // Mark job as failed
          await this.markJobFailed(message.payload.jobId, error instanceof Error ? error.message : 'Unknown error');
          message.ack(); // Don't retry further
        }
      }
    }
  }

  private async processMessage(message: QueueMessage<RenderJobPayload>): Promise<void> {
    const { jobId, userId, type, input, config } = message.payload;

    console.log(`[RENDER] Processing job ${jobId} (type: ${type})`);

    // Load job from KV
    const jobData = await this.env.RENDER_KV.get(`job:${jobId}`);
    if (!jobData) {
      throw new AppError('NOT_FOUND', `Job ${jobId} not found in KV`);
    }

    const job = JSON.parse(jobData) as Job;

    // Update status to processing
    job.status = 'processing';
    job.startedAt = Date.now();
    job.logs.push({
      timestamp: Date.now(),
      level: 'info',
      message: 'Video render worker başladı',
      step: 'worker_start',
    });
    await this.saveJob(job);

    try {
      // Route to appropriate renderer based on job type
      let result: JobResult;

      switch (type) {
        case 'video':
        case 'guzel-soz':
        case 'iddia-analizi':
          result = await this.renderVideo(job);
          break;
        case 'image':
          result = await this.renderImage(job);
          break;
        case 'analysis':
          result = await this.renderAnalysis(job);
          break;
        default:
          throw new AppError('VALIDATION_ERROR', `Unknown job type: ${type}`);
      }

      // Update job with result
      job.status = 'completed';
      job.completedAt = Date.now();
      job.actualDuration = (job.completedAt - (job.startedAt || job.completedAt)) / 1000;
      job.result = result;
      job.progress = 100;
      job.logs.push({
        timestamp: Date.now(),
        level: 'success',
        message: 'Video render tamamlandı',
        step: 'complete',
        duration: job.actualDuration,
      });
      await this.saveJob(job);

      // Trigger webhooks if needed
      await this.triggerWebhooks(job);

      console.log(`[RENDER] Job ${jobId} completed successfully`);
    } catch (error) {
      job.status = 'failed';
      job.completedAt = Date.now();
      job.error = {
        code: error instanceof AppError ? error.code : 'RENDER_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error',
        step: 'render',
        recoverable: error instanceof AppError ? error.recoverable : false,
      };
      job.logs.push({
        timestamp: Date.now(),
        level: 'error',
        message: `Render failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        step: 'error',
      });
      await this.saveJob(job);

      console.error(`[RENDER] Job ${jobId} failed:`, error);
      throw error;
    }
  }

  private async renderVideo(job: Job): Promise<JobResult> {
    // This is where the actual video rendering happens
    // For Cloudflare Workers, we need to use OffscreenCanvas + ffmpeg.wasm
    // Or delegate to a more powerful runtime

    // Update progress
    await this.updateProgress(job.id, 10, 'Assets loading...');

    // Load assets from R2
    const assets = await this.loadAssets(job);

    await this.updateProgress(job.id, 20, 'Script analysis...');

    // Analyze script and generate render plan
    const renderPlan = this.generateRenderPlan(job);

    await this.updateProgress(job.id, 30, 'Generating frames...');

    // Render frames using OffscreenCanvas
    const frames = await this.renderFrames(renderPlan, assets, job.config);

    await this.updateProgress(job.id, 70, 'Encoding video...');

    // Encode with ffmpeg.wasm
    const videoBlob = await this.encodeVideo(frames, job.config);

    await this.updateProgress(job.id, 90, 'Uploading to R2...');

    // Upload to R2
    const videoKey = `renders/${job.userId}/${job.id}.${job.config.videoFormat || 'webm'}`;
    await this.env.MEDIA_BUCKET.put(videoKey, videoBlob, {
      httpMetadata: { contentType: `video/${job.config.videoFormat || 'webm'}` },
    });

    // Generate thumbnail
    const thumbnailKey = `thumbnails/${job.userId}/${job.id}.jpg`;
    const thumbnailBlob = await this.generateThumbnail(frames[0]);
    await this.env.MEDIA_BUCKET.put(thumbnailKey, thumbnailBlob, {
      httpMetadata: { contentType: 'image/jpeg' },
    });

    await this.updateProgress(job.id, 100, 'Complete');

    return {
      videoUrl: `https://${this.env.MEDIA_BUCKET.name}.r2.dev/${videoKey}`,
      thumbnailUrl: `https://${this.env.MEDIA_BUCKET.name}.r2.dev/${thumbnailKey}`,
      script: job.script,
      logs: job.logs,
      metadata: {
        duration: job.actualDuration,
        resolution: this.getResolution(job.config),
        format: job.config.videoFormat,
        frameCount: frames.length,
      },
    };
  }

  private async renderImage(job: Job): Promise<JobResult> {
    // Single image generation
    await this.updateProgress(job.id, 50, 'Generating image...');

    // Use AI image generation (Imagen or Gemini)
    const imageUrl = await this.generateImage(job.script?.thumbnailImagePrompt || 'OTONOM video thumbnail');

    const imageKey = `renders/${job.userId}/${job.id}.jpg`;
    const imageBlob = await this.fetchBlob(imageUrl);
    await this.env.MEDIA_BUCKET.put(imageKey, imageBlob, {
      httpMetadata: { contentType: 'image/jpeg' },
    });

    return {
      imageUrl: `https://${this.env.MEDIA_BUCKET.name}.r2.dev/${imageKey}`,
      script: job.script,
      logs: job.logs,
    };
  }

  private async renderAnalysis(job: Job): Promise<JobResult> {
    // Text analysis only - no video rendering
    return {
      script: job.script,
      logs: job.logs,
    };
  }

  private generateRenderPlan(job: Job): any {
    const script = job.script;
    const config = job.config;
    const slides = script?.videoSlides || [];

    return {
      slides: slides.map((slide, index) => ({
        index,
        topText: slide.topText,
        spokenText: slide.spokenText,
        imagePrompts: slide.imagePrompts || [],
        duration: this.estimateSlideDuration(slide, config),
        isThumbnail: index === 0,
        isOutro: index === slides.length - 1,
      })),
      config: {
        width: this.getWidth(config.aspectRatio),
        height: this.getHeight(config.aspectRatio),
        fps: RENDER_CONFIG.FPS,
        fontFamily: getFontFamily(config.fontStyle),
        voiceVolume: RENDER_CONFIG.VOICE_VOLUME,
        bgmVolume: config.backgroundMusicVolume ?? RENDER_CONFIG.BGM_VOLUME,
        backgroundMusic: config.backgroundMusic ?? null,
        speechRate: RENDER_CONFIG.SPEECH_RATE,
      },
      sonSoz: script?.sonSoz,
      lastQuote: script?.lastQuote,
    };
  }

  private estimateSlideDuration(slide: VideoSlide, config: any): number {
    const words = slide.spokenText?.split(/\s+/).filter(Boolean).length || 0;
    const wps = getWPS(config.language);
    return Math.max(1, words / wps) + 0.3; // +0.3s buffer
  }

  private getWidth(aspectRatio: string): number {
    switch (aspectRatio) {
      case '16:9': return 1280;
      case '1:1': return 1080;
      default: return 720; // 9:16
    }
  }

  private getHeight(aspectRatio: string): number {
    switch (aspectRatio) {
      case '16:9': return 720;
      case '1:1': return 1080;
      default: return 1280; // 9:16
    }
  }

  private getResolution(config: any): string {
    const w = this.getWidth(config.aspectRatio);
    const h = this.getHeight(config.aspectRatio);
    return `${w}x${h}`;
  }

  private async loadAssets(job: Job): Promise<any> {
    // Load images, audio from R2
    // Return map of assetId -> Blob
    return {};
  }

  private async renderFrames(plan: any, assets: any, config: any): Promise<Blob[]> {
    // This would use OffscreenCanvas to render each frame
    // For now, return placeholder
    const frameCount = Math.ceil(plan.config.fps * 10); // 10 seconds
    return Array(frameCount).fill(new Blob(['frame'], { type: 'image/png' }));
  }

  private async encodeVideo(frames: Blob[], config: any): Promise<Blob> {
    // Use ffmpeg.wasm to encode frames to video
    // This is a placeholder - actual implementation would load ffmpeg.wasm
    // and feed frames to it
    return new Blob(frames, { type: `video/${config.videoFormat || 'webm'}` });
  }

  private async generateThumbnail(frame: Blob): Promise<Blob> {
    // Extract first frame as thumbnail
    return frame;
  }

  private async generateImage(prompt: string): Promise<string> {
    // Call AI image generation API
    // Return image URL
    return 'https://example.com/placeholder.jpg';
  }

  private async fetchBlob(url: string): Promise<Blob> {
    const response = await fetch(url);
    return response.blob();
  }

  private async updateProgress(jobId: string, progress: number, step?: string): Promise<void> {
    const jobData = await this.env.RENDER_KV.get(`job:${jobId}`);
    if (jobData) {
      const job = JSON.parse(jobData) as Job;
      job.progress = progress;
      if (step) job.currentStep = step;
      job.logs.push({
        timestamp: Date.now(),
        level: 'info',
        message: step || `Progress: ${progress}%`,
        step: step || 'progress',
      });
      await this.saveJob(job);
    }
  }

  private async saveJob(job: Job): Promise<void> {
    await this.env.RENDER_KV.put(`job:${job.id}`, JSON.stringify(job));
  }

  private async markJobFailed(jobId: string, error: string): Promise<void> {
    const jobData = await this.env.RENDER_KV.get(`job:${jobId}`);
    if (jobData) {
      const job = JSON.parse(jobData) as Job;
      job.status = 'failed';
      job.completedAt = Date.now();
      job.error = {
        code: 'RENDER_FAILED',
        message: error,
        step: 'worker',
        recoverable: false,
      };
      await this.saveJob(job);
    }
  }

  private async triggerWebhooks(job: Job): Promise<void> {
    // Send completion webhooks to social media, etc.
    if (job.result?.videoUrl) {
      await this.env.RENDER_QUEUE.send({
        type: 'webhook.deliver',
        payload: {
          url: `${new URL(this.env.CORS_ORIGIN).origin}/api/webhooks/job-complete`,
          payload: { jobId: job.id, videoUrl: job.result.videoUrl },
          headers: { 'Content-Type': 'application/json' },
        },
        timestamp: Date.now(),
        retries: 0,
        maxRetries: 3,
      });
    }
  }
}
