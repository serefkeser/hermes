// Type definitions for Cloudflare Workers bindings
interface Env {
  // KV Namespaces
  RENDER_KV: KVNamespace;

  // Queues
  RENDER_QUEUE: Queue;

  // R2 Bucket
  MEDIA_BUCKET: R2Bucket;

  // Secrets
  JWT_SECRET: string;
  GEMINI_API_KEY: string;

  // Variables
  ENVIRONMENT: string;
  MAX_RENDER_TIME: string;
  FFMPEG_CORE_PATH: string;
}

export { };