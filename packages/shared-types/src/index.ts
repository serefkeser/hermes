// Shared TypeScript types for OTONOM microservices
// This package is imported by all services and the frontend

// ============================================================================
// COMMON / BASE TYPES
// ============================================================================

export interface BaseEntity {
  id: string;
  createdAt: number;
  updatedAt: number;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: ApiError;
  meta?: Record<string, unknown>;
}

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS';

export interface RequestContext {
  userId?: string;
  requestId: string;
  timestamp: number;
  ip?: string;
  userAgent?: string;
}

// ============================================================================
// USER / AUTH TYPES
// ============================================================================

export type UserPlan = 'free' | 'pro' | 'enterprise';

export interface User extends BaseEntity {
  email: string;
  name: string;
  avatarUrl?: string;
  plan: UserPlan;
  emailVerified: boolean;
  lastLoginAt?: number;
  settings: UserSettings;
}

export interface UserSettings {
  language: SupportedLanguage;
  defaultVideoFormat: VideoFormat;
  defaultAspectRatio: AspectRatio;
  narratorVoice: string;
  backgroundMusicVolume: number;
  notifications: NotificationSettings;
}

export interface NotificationSettings {
  email: boolean;
  push: boolean;
  jobComplete: boolean;
  jobFailed: boolean;
  weeklyDigest: boolean;
}

export type SupportedLanguage =
  | 'tr'
  | 'en'
  | 'fr'
  | 'de'
  | 'es'
  | 'ar'
  | 'ru';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number; // seconds
  tokenType: 'Bearer';
}

export interface JwtPayload {
  sub: string; // userId
  email: string;
  plan: UserPlan;
  iat: number;
  exp: number;
  type: 'access' | 'refresh';
}

export interface RegisterRequest {
  email: string;
  password: string;
  name: string;
}

export interface LoginRequest {
  email: string;
  password: string;
  rememberMe?: boolean;
}

export interface RefreshRequest {
  refreshToken: string;
}

// ============================================================================
// JOB / WORKFLOW TYPES
// ============================================================================

export type JobType = 'video' | 'image' | 'analysis' | 'guzel-soz' | 'iddia-analizi';

export type JobStatus =
  | 'queued'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type JobPriority = 'low' | 'normal' | 'high';

export interface Job extends BaseEntity {
  userId: string;
  type: JobType;
  status: JobStatus;
  priority: JobPriority;
  input: JobInput;
  config: RenderConfig;
  progress: number; // 0-100
  currentStep?: string;
  result?: JobResult;
  error?: JobError;
  logs: JobLogEntry[];
  startedAt?: number;
  completedAt?: number;
  estimatedDuration?: number; // seconds
  actualDuration?: number; // seconds
}

export interface JobInput {
  type: 'text' | 'url' | 'media' | 'prompt';
  data: string | MediaFile[];
  metadata?: Record<string, unknown>;
}

export interface MediaFile {
  id: string;
  name: string;
  type: 'image' | 'video' | 'audio';
  mimeType: string;
  size: number;
  url?: string; // presigned or public URL
  r2Key?: string;
  thumbnailUrl?: string;
  duration?: number; // for video/audio
  width?: number;
  height?: number;
}

export interface RenderConfig {
  duration: DurationOption;
  aspectRatio: AspectRatio;
  videoStyle: VideoStyle;
  fontStyle: FontStyle;
  imageStyle: ImageStyle;
  language: SupportedLanguage;
  subtitles: SubtitleOption;
  resolution: Resolution;
  transition: TransitionType;
  videoFormat: VideoFormat;
  analysisMode: AnalysisMode;
  tip: ContentType;
  sourceName?: string;
  yorum?: string;
  customSceneImages?: string[];
}

export type DurationOption = '15' | '30' | '60' | '90' | 'unlimited';
export type AspectRatio = '9:16' | '16:9' | '1:1';
export type VideoStyle = 'news_flash' | 'cinematic' | 'explainer' | 'weekly_roundup' | 'prompt_output';
export type FontStyle = 'modern' | 'classic' | 'typewriter';
export type ImageStyle = 'cinematic' | 'watercolor' | 'sketch' | 'oil_painting' | 'minimalist' | 'cyberpunk' | 'retro' | '3d_render' | 'anime';
export type Resolution = '1K' | '2K' | '4K';
export type TransitionType = 'none' | 'crossfade' | 'fadeIn' | 'fadeOut' | 'slideIn' | 'slideOut';
export type VideoFormat = 'webm' | 'mp4';
export type SubtitleOption = 'on' | 'off';
export type AnalysisMode = 'yorumsuz' | 'visibility' | 'deep_analysis';
export type ContentType = 'haber' | 'guzel_soz' | 'iddia_analizi';

export interface JobResult {
  videoUrl?: string;
  thumbnailUrl?: string;
  imageUrl?: string;
  script?: VideoScript;
  logs: JobLogEntry[];
  metadata?: Record<string, unknown>;
}

export interface JobError {
  code: string;
  message: string;
  step?: string;
  recoverable: boolean;
  details?: Record<string, unknown>;
}

export interface JobLogEntry {
  timestamp: number;
  level: 'info' | 'warn' | 'error' | 'success' | 'debug';
  message: string;
  step?: string;
  duration?: number;
}

export interface CreateJobRequest {
  type: JobType;
  input: JobInput;
  config: RenderConfig;
  priority?: JobPriority;
}

export interface JobProgressUpdate {
  jobId: string;
  progress: number;
  step?: string;
  message?: string;
  partialResult?: Partial<JobResult>;
}

// ============================================================================
// VIDEO SCRIPT / CONTENT TYPES
// ============================================================================

export interface VideoScript {
  thumbnailText: string;
  thumbnailImagePrompt: string;
  sonSoz: string;
  lastQuote: string;
  videoSlides: VideoSlide[];
  tiktokTitle?: string;
  tiktokDescription?: string;
  tiktokHashtags?: string[];
  kaynaklar?: SourceReference[];
  mediaBlackout?: MediaBlackoutInfo;
  gazeteBasliklari?: GazeteBaslik[];
  chartData?: ChartData;
  _isGuzelSoz?: boolean;
  _isMultilang?: boolean;
  _multilangTexts?: string[];
  _multilangLabels?: string[];
  _emotion?: string;
  _sceneCount?: number;
  _isGazeteOkuma?: boolean;
  _allBasliklar?: GazeteBaslik[];
  _kaynaklar?: SourceReference[];
  _originalMedia?: MediaFile[];
  _originalMediaType?: 'video' | 'audio';
  _bgmId?: string;
  _bgmName?: string;
}

export interface VideoSlide {
  topText: string;
  spokenText: string;
  imagePrompts: string[];
  _lang?: string;
  _isRawMedia?: boolean;
  _rawMediaIndex?: number;
  _isBasliklarList?: boolean;
  _basliklar?: GazeteBaslik[];
  _isKaynaklar?: boolean;
  _kaynaklar?: SourceReference[];
  _zoomCoords?: ZoomCoords;
}

export interface ZoomCoords {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SourceReference {
  baslik: string;
  url: string;
  tarih?: string;
  veri?: string;
}

export interface MediaBlackoutInfo {
  show: boolean;
  percentageCovered: number;
  percentageIgnored: number;
  mediaNames: string[];
  explanation: string;
}

export interface GazeteBaslik {
  baslik: string;
  aciklama: string;
  x: number;
  y: number;
  w: number;
  h: number;
  _imgIdx?: number;
}

export interface ChartData {
  show: boolean;
  type: 'bar' | 'line' | 'pie';
  title: string;
  note?: string;
  items: ChartItem[];
}

export interface ChartItem {
  label: string;
  value: number;
  color?: string;
}

// ============================================================================
// MEDIA / STORAGE TYPES
// ============================================================================

export interface MediaAsset extends BaseEntity {
  userId: string;
  jobId?: string;
  type: 'image' | 'video' | 'audio' | 'thumbnail' | 'outro';
  mimeType: string;
  size: number;
  r2Key: string;
  publicUrl?: string;
  presignedUrl?: string;
  presignedUrlExpiresAt?: number;
  metadata?: MediaMetadata;
  tags?: string[];
}

export interface MediaMetadata {
  width?: number;
  height?: number;
  duration?: number;
  bitrate?: number;
  codec?: string;
  fps?: number;
  sampleRate?: number;
  channels?: number;
  generatedBy?: 'ai' | 'user' | 'system';
  prompt?: string;
  model?: string;
}

export interface PresignedUploadResponse {
  uploadUrl: string;
  mediaId: string;
  expiresAt: number;
  fields?: Record<string, string>; // For multipart/form-data
}

export interface MultipartUploadInitResponse {
  uploadId: string;
  mediaId: string;
  partUrls: string[]; // One per part
  partSize: number;
  expiresAt: number;
}

export interface MultipartUploadCompleteRequest {
  uploadId: string;
  mediaId: string;
  parts: CompletedPart[];
}

export interface CompletedPart {
  partNumber: number;
  etag: string;
}

export interface MediaListQuery {
  userId?: string;
  jobId?: string;
  type?: MediaAsset['type'];
  page?: number;
  pageSize?: number;
  sortBy?: 'createdAt' | 'size' | 'type';
  sortOrder?: 'asc' | 'desc';
}

// ============================================================================
// QUEUE / ASYNC TYPES
// ============================================================================

export interface QueueMessage<T = unknown> {
  id: string;
  type: string;
  payload: T;
  timestamp: number;
  retries: number;
  maxRetries: number;
  delay?: number; // milliseconds
  priority?: JobPriority;
}

export interface JobQueueMessage extends QueueMessage<CreateJobRequest> {
  type: 'job.create';
}

export interface JobCancelMessage extends QueueMessage<{ jobId: string; reason?: string }> {
  type: 'job.cancel';
}

export interface MediaCleanupMessage extends QueueMessage<{ mediaIds: string[]; olderThan?: number }> {
  type: 'media.cleanup';
}

export interface WebhookMessage extends QueueMessage<{ url: string; payload: unknown; headers?: Record<string, string> }> {
  type: 'webhook.deliver';
}

// ============================================================================
// ECONOMIC DATA TYPES (for İddia Analizi)
// ============================================================================

export interface EconomicDataPoint {
  label: string;
  value: string;
  baseline2002?: string;
  note?: string;
  dataAsOf?: string;
}

export interface EconomicDataSet {
  aclikSiniri: EconomicDataPoint;
  yoksullukSiniri: EconomicDataPoint;
  asgariUcret: EconomicDataPoint;
  enDusukEmekliMaasi: EconomicDataPoint;
  tufeYillik: EconomicDataPoint;
  tufeAylik: EconomicDataPoint;
  tcmbYilSonuBeklenti: EconomicDataPoint;
  tcmbPolitikaFaizi: EconomicDataPoint;
  dolarTl: EconomicDataPoint;
  euroTl: EconomicDataPoint;
  gramAltin: EconomicDataPoint;
  ceyrekAltin: EconomicDataPoint;
  issizlik: EconomicDataPoint;
}

// ============================================================================
// EXTERNAL API TYPES
// ============================================================================

export interface GeminiRequest {
  contents: GeminiContent[];
  systemInstruction?: GeminiContent;
  generationConfig?: GeminiGenerationConfig;
  tools?: GeminiTool[];
}

export interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

export type GeminiPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } }
  | { functionCall: { name: string; args: Record<string, unknown> } }
  | { functionResponse: { name: string; response: Record<string, unknown> } };

export interface GeminiGenerationConfig {
  temperature?: number;
  maxOutputTokens?: number;
  topP?: number;
  topK?: number;
  responseMimeType?: string;
  responseSchema?: Record<string, unknown>;
}

export interface GeminiTool {
  googleSearch?: Record<string, never>;
  functionDeclarations?: FunctionDeclaration[];
}

export interface FunctionDeclaration {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface GeminiResponse {
  candidates: GeminiCandidate[];
  usageMetadata?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
}

export interface GeminiCandidate {
  content: GeminiContent;
  finishReason: 'STOP' | 'MAX_TOKENS' | 'SAFETY' | 'RECITATION' | 'OTHER';
  index: number;
  safetyRatings?: SafetyRating[];
}

export interface SafetyRating {
  category: string;
  probability: 'NEGLIGIBLE' | 'LOW' | 'MEDIUM' | 'HIGH';
  blocked: boolean;
}

// ============================================================================
// SOCIAL MEDIA TYPES
// ============================================================================

export type SocialPlatform =
  | 'x'
  | 'linkedin'
  | 'facebook'
  | 'instagram'
  | 'tiktok'
  | 'pinterest'
  | 'bluesky'
  | 'buffer';

export interface SocialAccount {
  id: string;
  userId: string;
  platform: SocialPlatform;
  platformUserId: string;
  platformUsername: string;
  accessToken: string; // Encrypted
  refreshToken?: string; // Encrypted
  expiresAt?: number;
  scopes: string[];
  isActive: boolean;
  metadata?: Record<string, unknown>;
}

export interface ShareRequest {
  jobId: string;
  platforms: SocialPlatform[];
  customText?: string;
  mediaUrl?: string;
}

export interface ShareResult {
  platform: SocialPlatform;
  success: boolean;
  postId?: string;
  postUrl?: string;
  error?: string;
}

// ============================================================================
// GAZETE (NEWSPAPER) TYPES
// ============================================================================

export interface GazeteItem {
  name: string;
  fullSrc: string;
  thumbSrc: string;
  resolvedFull?: string;
  resolvedThumb?: string;
  placeholder: string;
  sources: string[];
  loaded: boolean;
  revision: number;
  rawCandidates?: string[];
  fullCandidates?: string[];
  thumbCandidates?: string[];
}

export interface GazeteCacheEntry {
  full?: string;
  thumb?: string;
  updatedAt: number;
}

// ============================================================================
// WEBSOCKET / REALTIME TYPES
// ============================================================================

export type WsMessageType =
  | 'job.progress'
  | 'job.completed'
  | 'job.failed'
  | 'job.cancelled'
  | 'auth.expired'
  | 'notification';

export interface WsMessage<T = unknown> {
  type: WsMessageType;
  payload: T;
  timestamp: number;
}

export interface WsJobProgressPayload {
  jobId: string;
  progress: number;
  step?: string;
  message?: string;
}

export interface WsJobCompletedPayload {
  jobId: string;
  result: JobResult;
}

export interface WsJobFailedPayload {
  jobId: string;
  error: JobError;
}

// ============================================================================
// RATE LIMIT / SECURITY TYPES
// ============================================================================

export interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  keyPrefix: string;
}

export interface RateLimitInfo {
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfter?: number;
}

// ============================================================================
// EXPORTS
// ============================================================================

export * from './api';
export * from './events';