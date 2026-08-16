// Type definitions for the active, storage-free Cloudflare Worker bindings.
interface Env {
  // Secrets (set via wrangler secret put)
  GEMINI_API_KEY?: string;
  GROQ_API_KEY?: string;
  NVIDIA_API_KEY?: string;
  OPENCODE_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  ZENMUX_API_KEY?: string;
  AI_ACCESS_TOKEN?: string;
  BUFFER_API_KEY?: string;
  BUFFER_CHANNEL_IDS?: string;
  SOCIAL_MEDIA_BUCKET: R2Bucket;

  // Variables
  ENVIRONMENT: string;
  CORS_ORIGIN: string;
  AI_TEXT_PROVIDER_ORDER?: string;
  AI_VISION_PROVIDER_ORDER?: string;
  GROQ_TEXT_MODEL?: string;
  GROQ_VISION_MODEL?: string;
  NVIDIA_TEXT_MODEL?: string;
  NVIDIA_VISION_MODEL?: string;
  OPENCODE_TEXT_MODEL?: string;
  OPENROUTER_TEXT_MODEL?: string;
  OPENROUTER_VISION_MODEL?: string;
  ZENMUX_TEXT_MODEL?: string;
  ZENMUX_VISION_MODEL?: string;
  GEMINI_ANALYSIS_MODEL?: string;
  GEMINI_TTS_MODEL?: string;
  ALLOW_NVIDIA_TRIAL?: string;
  ALLOW_ZENMUX_PAID?: string;
  BUFFER_SHARE_MODE?: string;
  BUFFER_YOUTUBE_CATEGORY_ID?: string;
}

export { };
