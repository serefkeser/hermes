// Shared configuration constants for OTONOM microservices
// Single source of truth for all magic numbers, defaults, and config

// ============================================================================
// APP VERSION
// ============================================================================

export const APP_VERSION = {
  major: 3,
  minor: 14,
  patch: 0,
  toString(): string {
    return `OTONOM v${this.major}.${this.minor}.${this.patch}`;
  },
  toBadge(): string {
    return `${this.toString()} • SaaS`;
  },
} as const;

// ============================================================================
// RENDER CONFIGURATION
// ============================================================================

export const RENDER_CONFIG = {
  // Video rendering
  FPS: 30,
  TIMER_WORKER_INTERVAL_MS: 1000 / 30, // 33.33ms = 30fps exact
  WINDOW_SIZE: 5, // Sliding window for memory management

  // Audio mixing
  VOICE_VOLUME: 0.8,
  BGM_VOLUME: 0.29,
  SPEECH_RATE: 1.0,

  // Video encoding
  VIDEO_BITS_PER_SECOND: 4_000_000, // 4 Mbps
  AUDIO_BITS_PER_SECOND: 128_000, // 128 kbps

  // Image processing
  MIN_CROP_SIZE: 10,
  MAX_CUSTOM_SCENE_IMAGES: 5,
  MAX_SCENE_COUNT: 25,

  // Duration bounds (seconds)
  DURATION_BOUNDS: {
    '15': { min: 15, max: 30 },
    '30': { min: 30, max: 60 },
    '60': { min: 60, max: 90 },
    '90': { min: 90, max: 120 },
    unlimited: { min: 0, max: 9999 },
  } as const,

  // Subtitle timing
  WORDS_PER_SUBTITLE: 4,
  SUBTITLE_OVERLAP_SECONDS: 0.15,
  RAW_CUSHION_SECONDS: 0.5,
  OUTRO_FADE_SECONDS: 0.5,
  OUTRO_MIN_SECONDS: 7,

  // Ken Burns effect
  KEN_BURNS_ZOOM_MAX: 1.08,
  KEN_BURNS_PAN_MAX: 0.04,

  // Chart overlay
  CHART_WIDTH_RATIO: 0.7,
  CHART_HEIGHT_RATIO: 0.35,
  CHART_Y_POSITION_RATIO: 0.3,
} as const;

// ============================================================================
// AI CONFIGURATION
// ============================================================================

export const AI_CONFIG = {
  // Text generation
  TEMPERATURE: 0.8,
  MAX_OUTPUT_TOKENS: 150,
  SCENE_COUNT: 3,

  // Models
  GEMINI_MODEL: 'gemini-2.5-flash-preview-09-2025',
  GEMINI_TTS_MODEL: 'gemini-2.5-flash-preview-tts',
  IMAGEN_MODEL: 'imagen-4.0-generate-001',
  OCR_MODELS: [
    'gemini-2.5-flash-preview-09-2025',
    'gemini-1.5-flash',
    'gemini-1.5-pro',
  ] as const,

  // OCR settings
  OCR_STRIP_COUNTS: [3, 5, 0] as const, // 0 = full image
  OCR_MIN_TEXT_LENGTH: 15,
  OCR_STRIP_MIN_TEXT_LENGTH: 2,

  // Retry settings
  MAX_RETRIES: 5,
  BASE_RETRY_DELAY_MS: 1000,
  MAX_RETRY_DELAY_MS: 30_000,
  JITTER_MAX_MS: 500,

  // Content limits
  MAX_THUMBNAIL_WORDS: 3,
  MAX_TOP_TEXT_WORDS: 3,
  MAX_PROMPT_TOKENS: 2048,
} as const;

// ============================================================================
// ECONOMIC DATA (for İddia Analizi)
// ============================================================================

export const ECONOMIC_DATA = {
  aclikSiniri: { value: '35.759 TL', baseline2002: '1.522 TL', note: 'dört kişilik aile, TÜRK-İŞ', dataAsOf: 'Haziran 2026' },
  yoksullukSiniri: { value: '116.478 TL', baseline2002: '4.560 TL', note: 'dört kişilik aile, TÜRK-İŞ', dataAsOf: 'Haziran 2026' },
  asgariUcret: { value: '28.075 TL', baseline2002: '184 TL', note: 'net', dataAsOf: 'Ocak 2026' },
  enDusukEmekliMaasi: { value: '23.552 TL', baseline2002: '150 TL', note: '', dataAsOf: null },
  tufeYillik: { value: '%32.11', baseline2002: '%29.7', note: 'TÜİK', dataAsOf: 'Haziran 2026' },
  tufeAylik: { value: '%0.99', baseline2002: null, note: 'TÜİK', dataAsOf: 'Haziran 2026' },
  tcmbYilSonuBeklenti: { value: '%29', baseline2002: '%35', note: '', dataAsOf: null },
  tcmbPolitikaFaizi: { value: '%37', baseline2002: '%59', note: '', dataAsOf: null },
  dolarTl: { value: '47.05', baseline2002: '1.35', note: '', dataAsOf: '30 Temmuz 2026' },
  euroTl: { value: '54.07', baseline2002: '1.28', note: '', dataAsOf: '30 Temmuz 2026' },
  gramAltin: { value: '6.222 TL', baseline2002: '15.5 TL', note: '', dataAsOf: '30 Temmuz 2026' },
  ceyrekAltin: { value: '10.223 TL', baseline2002: '25 TL', note: '', dataAsOf: '30 Temmuz 2026' },
  issizlik: { value: '%8.2', baseline2002: '%10.3', note: '', dataAsOf: null },
} as const;

// ============================================================================
// ERROR PATTERNS (OCR)
// ============================================================================

export const ERROR_PATTERNS = [
  /görselde\s+(herhangi\s+)?bir\s+metin\s+bulunmamaktadır/i,
  /bu\s+görselde\s+metin\s+yok/i,
  /no\s+text\s+found\s+in\s+(the\s+)?image/i,
  /görselde\s+yazı\s+bulunamadı/i,
  /metin\s+bulunamadı/i,
  /cannot\s+(read|find|detect)\s+text/i,
  /ocr\s+(failed|error|başarısız)/i,
  /bu\s+resimde\s+yazı\s+yok/i,
] as const;

// ============================================================================
// PROXY AUTH
// ============================================================================

export const PROXY_AUTH_TOKEN = 'otonom_proxy_secret_key_883921';

// ============================================================================
// GAZETE (NEWSPAPER) CONFIG
// ============================================================================

export const ALLOWED_GAZETELER = [
  'Akşam', 'Analiz', 'Aydınlık', 'BirGün', 'Cumhuriyet', 'Diriliş Postası',
  'Dünya', 'Evrensel', 'Gazete Pencere', 'Fanatik', 'Fotomaç', 'Hürriyet', 'Karar', 'Korkusuz',
  'Milat', 'Milli Gazete', 'Milliyet', 'Nasıl Bir Ekonomi', 'Nefes', 'Posta',
  'Sabah', 'Sözcü', 'Takvim', 'Tavır Gazetesi', 'Türkiye', 'Yeniçağ',
  'Yeni Asya', 'Yeni Birlik', 'Yeni Mesaj', 'Yeni Şafak',
] as const;

export const GAZETE_META = {
  'Akşam': { ayd: 'aksam', go: 'aksam-gazetesi-manseti', gzt: 'aksam-gazetesi' },
  'Analiz': { ayd: 'analiz', gzt: 'analiz-gazetesi' },
  'Aydınlık': { ayd: 'aydinlik-gazetesi', go: 'aydinlik-gazetesi-manseti', gzt: 'aydinlik-gazetesi' },
  'BirGün': { ayd: 'birgun', go: 'birgun-gazetesi-manseti', gzt: 'birgun-gazetesi' },
  'Cumhuriyet': { ayd: 'cumhuriyet', go: 'cumhuriyet-gazetesi-manseti', gzt: 'cumhuriyet-gazetesi' },
  'Diriliş Postası': { ayd: 'dirilis-postasi', go: 'dirilis-postasi-gazetesi-manseti', gzt: 'dirilis-postasi-gazetesi' },
  'Dünya': { ayd: 'dunya', go: 'dunya-gazetesi-manseti', gzt: 'dunya-gazetesi' },
  'Evrensel': { ayd: 'evrensel', go: 'evrensel-gazetesi-manseti', gzt: 'evrensel-gazetesi' },
  'Gazete Pencere': { ayd: 'gazete-pencere-online-gazete', gzt: 'gazetepencere-gazetesi' },
  'Fanatik': { ayd: 'fanatik', go: 'fanatik-gazetesi-manseti', gzt: 'fanatik-gazetesi' },
  'Fotomaç': { ayd: 'fotomac', go: 'fotomac-gazetesi-manseti', gzt: 'fotomac-gazetesi' },
  'Hürriyet': { go: 'hurriyet-gazetesi-manseti', gzt: 'hurriyet-gazetesi' },
  'Karar': { ayd: 'karar', go: 'karar-gazetesi-manseti', gzt: 'karar-gazetesi' },
  'Korkusuz': { ayd: 'korkusuz', go: 'korkusuz-gazetesi-manseti', gzt: 'korkusuz-gazetesi' },
  'Milat': { ayd: 'milat', go: 'milat-gazetesi-manseti', gzt: 'milat-gazetesi' },
  'Milli Gazete': { ayd: 'milli-gazete', go: 'milli-gazete-gazetesi-manseti', gzt: 'milli-gazete' },
  'Milliyet': { go: 'milliyet-gazetesi-manseti', gzt: 'milliyet-gazetesi' },
  'Nasıl Bir Ekonomi': { ayd: 'nb-ekonomi', gzt: 'nasil-bir-ekonomi-gazetesi' },
  'Nefes': { ayd: 'nefes', go: 'nefes-gazetesi-manseti', gzt: 'nefes-gazetesi' },
  'Posta': { ayd: 'posta', go: 'posta-gazetesi-manseti', gzt: 'posta-gazetesi' },
  'Sabah': { ayd: 'sabah', go: 'sabah-gazetesi-manseti', gzt: 'sabah-gazetesi' },
  'Sözcü': { ayd: 'sozcu', go: 'sozcu-gazetesi-manseti', gzt: 'sozcu-gazetesi' },
  'Takvim': { ayd: 'takvim', go: 'takvim-gazetesi-manseti', gzt: 'takvim-gazetesi' },
  'Tavır Gazetesi': { ayd: 'tavir', go: 'tavir-gazetesi-manseti', gzt: 'tavir-gazetesi' },
  'Türkiye': { ayd: 'turkiye-gazetesi', go: 'turkiye-gazetesi-manseti', gzt: 'turkiye-gazetesi' },
  'Yeniçağ': { ayd: 'yenicag', go: 'yenicag-gazetesi-manseti', gzt: 'turkiyede-yenicag-gazetesi' },
  'Yeni Asya': { ayd: 'yeni-asya', go: 'yeni-asya-gazetesi-manseti', gzt: 'yeni-asya-gazetesi' },
  'Yeni Birlik': { ayd: 'yenibirlik', go: 'yenibirlik-gazetesi-manseti', gzt: 'yenibirlik-gazetesi' },
  'Yeni Mesaj': { gzt: 'yenimesaj-gazetesi' },
  'Yeni Şafak': { ayd: 'yeni-safak', go: 'yeni-safak-gazetesi-manseti', gzt: 'yenisafak-gazetesi' },
} as const;

export const GAZETE_PROXY_ENDPOINTS = {
  gazeteoku: 'http://localhost:3457/gazeteoku',
  aydinlik: 'http://localhost:3457/aydinlik',
  yenimesaj: 'http://localhost:3457/yenimesaj',
  gzt: 'http://localhost:3457/gzt',
} as const;

export const CORS_PROXIES = [
  { url: (u: string) => `https://www.whateverorigin.org/get?url=${encodeURIComponent(u)}`, json: true },
  { url: (u: string) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`, json: false },
  { url: (u: string) => `https://api.allorigins.win/get?url=${encodeURIComponent(u)}`, json: true },
  { url: (u: string) => `https://corsproxy.io/?${encodeURIComponent(u)}`, json: false },
  { url: (u: string) => `https://cors.eu.org/${encodeURIComponent(u)}`, json: false },
] as const;

// ============================================================================
// FREE TIER LIMITS
// ============================================================================

export const FREE_TIER_LIMITS = {
  // Cloudflare Workers
  WORKERS_REQUESTS_PER_DAY: 100_000,
  WORKERS_CPU_MS_PER_REQUEST: 10,
  WORKERS_CPU_MS_PER_DAY: 10_000_000,

  // Cloudflare R2
  R2_STORAGE_GB: 10,
  R2_CLASS_A_OPS_PER_MONTH: 1_000_000,
  R2_CLASS_B_OPS_PER_MONTH: 10_000_000,
  R2_EGRESS_GB_PER_MONTH: 10, // To Cloudflare network (free)

  // Cloudflare Queues
  QUEUE_MESSAGES_PER_MONTH: 1_000_000,

  // GitHub Pages
  PAGES_STORAGE_GB: 1,
  PAGES_BANDWIDTH_GB_PER_MONTH: 100,

  // GitHub Actions (public repo)
  ACTIONS_MINUTES_PER_MONTH: Infinity,

  // Application limits
  MAX_JOBS_PER_USER_PER_DAY: 50,
  MAX_CONCURRENT_JOBS: 1,
  MAX_VIDEO_DURATION_SECONDS: 600, // 10 minutes
  MAX_UPLOAD_SIZE_MB: 100,
  MAX_CUSTOM_IMAGES: 5,
  JOB_TTL_DAYS: 7,
  MEDIA_TEMP_TTL_HOURS: 24,
} as const;

// ============================================================================
// PLAN LIMITS
// ============================================================================

export const PLAN_LIMITS = {
  free: {
    jobsPerDay: 10,
    concurrentJobs: 1,
    maxVideoDuration: 120, // 2 minutes
    maxUploadSizeMB: 50,
    customImages: 2,
    prioritySupport: false,
    apiAccess: false,
  },
  pro: {
    jobsPerDay: 100,
    concurrentJobs: 3,
    maxVideoDuration: 600, // 10 minutes
    maxUploadSizeMB: 200,
    customImages: 10,
    prioritySupport: true,
    apiAccess: true,
  },
  enterprise: {
    jobsPerDay: 1000,
    concurrentJobs: 10,
    maxVideoDuration: 1800, // 30 minutes
    maxUploadSizeMB: 500,
    customImages: 50,
    prioritySupport: true,
    apiAccess: true,
    customDomain: true,
    sso: true,
  },
} as const;

// ============================================================================
// DEFAULT USER PREFERENCES
// ============================================================================

export const DEFAULT_PREFERENCES = {
  narratorVoice: 'Aoede',
  narratorVolume: 0.8,
  backgroundMusicVolume: 0.29,
  ambientSound: 'none' as const,
  language: 'tr' as const,
  defaultVideoFormat: 'mp4' as const,
  defaultAspectRatio: '9:16' as const,
  defaultDuration: '30' as const,
  defaultVideoStyle: 'cinematic' as const,
  defaultFontStyle: 'modern' as const,
  defaultImageStyle: 'cinematic' as const,
  defaultResolution: '4K' as const,
  defaultTransition: 'none' as const,
  defaultSubtitles: 'on' as const,
  defaultAnalysisMode: 'yorumsuz' as const,
} as const;

// ============================================================================
// VOICE OPTIONS
// ============================================================================

export const VOICE_OPTIONS = [
  { id: 'Aoede', label: 'Aoede', gender: 'Female', age: 'Young', category: 'Corporate & Narration' },
  { id: 'Puck', label: 'Puck', gender: 'Male', age: 'Child', category: 'Anime & Animation' },
  { id: 'Kore', label: 'Kore', gender: 'Female', age: 'Middle-aged', category: 'Documentary' },
  { id: 'Charon', label: 'Charon', gender: 'Male', age: 'Elderly', category: 'Audiobooks & Novels' },
  { id: 'Zephyr', label: 'Zephyr', gender: 'Male', age: 'Young', category: 'Commercials & Trailers' },
  { id: 'Fenrir', label: 'Fenrir', gender: 'Male', age: 'Middle-aged', category: 'Games & RPG' },
  { id: 'Leda', label: 'Leda', gender: 'Female', age: 'Middle-aged', category: 'Corporate & Narration' },
  { id: 'Orus', label: 'Orus (Erkek - Resmi)', gender: 'Male', age: 'Middle-aged', category: 'Documentary' },
] as const;

// ============================================================================
// AMBIENT SOUND OPTIONS
// ============================================================================

export const AMBIENT_SOUNDS = [
  { value: 'none', label: '🔇 Arka Ses Yok', color: 'text-slate-300', type: 'none' },
  { value: 'rain', label: '🌧️ Yağmur', color: 'text-blue-300', type: 'ambient' },
  { value: 'wind', label: '🌬️ Rüzgar', color: 'text-slate-300', type: 'ambient' },
  { value: 'waves', label: '🌊 Dalgalar', color: 'text-cyan-300', type: 'ambient' },
  { value: 'fire', label: '🔥 Şömine', color: 'text-orange-300', type: 'ambient' },
] as const;

// ============================================================================
// SOCIAL PLATFORMS
// ============================================================================

export const SOCIAL_PLATFORMS = [
  { id: 'x', name: 'X (Twitter)', color: '#1DA1F2', loginUrl: 'https://x.com/login', shareUrl: 'https://x.com/intent/post' },
  { id: 'linkedin', name: 'LinkedIn', color: '#0A66B2', loginUrl: 'https://www.linkedin.com/login', shareUrl: 'https://www.linkedin.com/feed/compose/' },
  { id: 'facebook', name: 'Facebook', color: '#1877F2', loginUrl: 'https://www.facebook.com/login', shareUrl: 'https://www.facebook.com/sharer/sharer.php' },
  { id: 'instagram', name: 'Instagram', color: '#E4405F', loginUrl: 'https://www.instagram.com/accounts/login/', shareUrl: 'https://www.instagram.com/' },
  { id: 'tiktok', name: 'TikTok', color: '#000000', loginUrl: 'https://www.tiktok.com/login', shareUrl: 'https://www.tiktok.com/' },
  { id: 'pinterest', name: 'Pinterest', color: '#BD081C', loginUrl: 'https://pinterest.com/login/', shareUrl: 'https://pinterest.com/pin/create/button/' },
  { id: 'bluesky', name: 'Bluesky', color: '#0085FF', loginUrl: 'https://bsky.app/', shareUrl: 'https://bsky.app/' },
  { id: 'buffer', name: 'Buffer', color: '#000000', loginUrl: 'https://buffer.com/login', shareUrl: 'https://buffer.com/' },
] as const;

// ============================================================================
// OUTRO TEXTS & CTA LABELS (7 languages)
// ============================================================================

export const OUTRO_TEXTS = {
  tr: ['Abone olmayı,', 'beğenmeyi ve', 'paylaşmayı', 'ihmal etmeyin.'],
  en: ['Don\'t forget to', 'subscribe, like', 'and share.'],
  fr: ['N\'oubliez pas de', 'vous abonner,', 'aimer et partager.'],
  de: ['Vergessen Sie nicht', 'zu abonnieren, liken', 'und zu teilen.'],
  es: ['No olvides', 'suscribirte, dar', 'me gusta y compartir.'],
  ar: ['لا تنسَ', 'الاشتراك والإعجاب', 'والمشاركة.'],
  ru: ['Не забудьте', 'подписаться, лайкнуть', 'и поделиться.'],
} as const;

export const CTA_LABELS = {
  tr: { sub: 'Abone Ol', like: 'Beğen', share: 'Paylaş' },
  en: { sub: 'Subscribe', like: 'Like', share: 'Share' },
  fr: { sub: "S'abonner", like: 'Aimer', share: 'Partager' },
  de: { sub: 'Abonnieren', like: 'Liken', share: 'Teilen' },
  es: { sub: 'Suscribir', like: 'Me gusta', share: 'Compartir' },
  ar: { sub: 'اشتراك', like: 'إعجاب', share: 'مشاركة' },
  ru: { sub: 'Подписка', like: 'Лайк', share: 'Поделиться' },
} as const;

// ============================================================================
// DISCLAIMER TEXTS (7 languages)
// ============================================================================

export const DISCLAIMER_TEXTS = {
  tr: 'Gemini bir yapay zeka modeli olduğu için kişiler de dahil olmak üzere farklı konular hakkında yanlış bilgi verebilir.',
  en: 'As an AI model, Gemini may provide inaccurate information about various topics, including people.',
  fr: "En tant que modèle d'IA, Gemini peut fournir des informations inexactes sur divers sujets, y compris les personnes.",
  de: 'Als KI-Modell kann Gemini ungenaue Informationen zu verschiedenen Themen liefern, einschließlich Personen.',
  es: 'Como modelo de IA, Gemini puede proporcionar información inexacta sobre diversos temas, incluidas las personas.',
  ar: 'كنموذج ذكاء اصطناعي، قد يوفر Gemini معلومات غير دقيقة حول مواضيع مختلفة، بما في ذلك الأشخاص.',
  ru: 'Как модель ИИ, Gemini может предоставить неточную информацию по различным темам, включая людей.',
} as const;

// ============================================================================
// WPS (Words Per Second) by language
// ============================================================================

export const WPS_BY_LANGUAGE = {
  tr: 2.2,
  en: 2.5,
  es: 2.6,
  fr: 2.4,
  ar: 2.2,
  de: 2.0,
  ru: 2.0,
} as const;

export function getWPS(lang: string): number {
  return WPS_BY_LANGUAGE[lang as keyof typeof WPS_BY_LANGUAGE] ?? 2.2;
}

// ============================================================================
// FONT FAMILIES
// ============================================================================

export const FONT_FAMILIES = {
  modern: "'Inter', 'Arial Black', Arial, sans-serif",
  classic: "Georgia, 'Times New Roman', serif",
  typewriter: "'Courier New', Courier, monospace",
} as const;

export function getFontFamily(style: string): string {
  return FONT_FAMILIES[style as keyof typeof FONT_FAMILIES] ?? FONT_FAMILIES.modern;
}

// ============================================================================
// EXPORTS
// ============================================================================

export * from './constants';