// Type definitions for Cloudflare Workers bindings
interface Env {
  // KV Namespaces
  RATE_LIMIT_KV: KVNamespace;

  // Queues
  JOB_QUEUE: Queue;

  // R2 Bucket
  MEDIA_BUCKET: R2Bucket;

  // Secrets (set via wrangler secret put)
  JWT_SECRET: string;
  GEMINI_API_KEY: string;
  BUFFER_API_KEY: string;

  // Variables
  ENVIRONMENT: string;
  CORS_ORIGIN: string;
  RATE_LIMIT_WINDOW_MS: string;
  RATE_LIMIT_MAX_REQUESTS: string;
}

declare module 'hono' {
  interface Env {
    Variables: {
      userId?: string;
      requestId: string;
      startTime: number;
    };
  }
}

export { };