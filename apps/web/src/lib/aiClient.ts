import type { MediaFile, RenderConfig } from '@otonom/shared-types';
import { writeSystemLog } from '@otonom/shared-utils';

const API_BASE = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '');
const MAX_ANALYSIS_IMAGES = 3;
const MAX_IMAGE_EDGE = 1600;
const MAX_OCR_IMAGE_EDGE = 2600;
const ACCESS_TOKEN_STORAGE_KEY = 'hermes_ai_access_token';

export interface HermesVideoSlide {
  topText: string;
  spokenText: string;
  imagePrompts: string[];
}

export interface HermesScript {
  isContentUnreadable?: boolean;
  videoSlides: HermesVideoSlide[];
  thumbnailText?: string;
  sonSoz?: string;
  gununSorusu?: string;
  lastQuote?: string;
  sourceName?: string;
  gazeteBasliklari?: Array<{
    baslik: string;
    aciklama: string;
    x: number;
    y: number;
    w: number;
    h: number;
  }>;
}

export interface AnalyzeResult {
  provider: string;
  model: string;
  attempts: Array<{
    provider: string;
    model: string;
    ok: boolean;
    status?: number;
    reason?: string;
  }>;
  script: HermesScript;
  fallbackReason?: string;
}

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: { message?: string };
}

function readBlobAsDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Görsel analiz için okunamadı.'));
    reader.readAsDataURL(blob);
  });
}

async function shrinkImage(blob: Blob, maxEdge = MAX_IMAGE_EDGE, quality = 0.82) {
  const bitmap = await createImageBitmap(blob);
  try {
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Görsel küçültme alanı oluşturulamadı.');
    context.drawImage(bitmap, 0, 0, width, height);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        result => result ? resolve(result) : reject(new Error('Görsel küçültülemedi.')),
        'image/jpeg',
        quality,
      );
    });
  } finally {
    bitmap.close();
  }
}

async function extractTextLocally(media: MediaFile) {
  const url = media.url || media.thumbnailUrl;
  if (!url) throw new Error('Yerel OCR için gazete görseli bulunamadı.');
  writeSystemLog('AI görsel analizi yedek moda geçti; tablet üzerinde Türkçe OCR başlatılıyor.', 'warn');
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Gazete görseli OCR için açılamadı (HTTP ${response.status}).`);
  const source = await response.blob();
  const image = media.type === 'video'
    ? await videoFrameToImage(source)
    : await shrinkImage(source, MAX_OCR_IMAGE_EDGE, 0.9).catch(() => source);
  const { createWorker, OEM } = await import('tesseract.js');
  let progressBucket = -1;
  const worker = await createWorker('tur', OEM.LSTM_ONLY, {
    logger: event => {
      if (event.status !== 'recognizing text' || typeof event.progress !== 'number') return;
      const bucket = Math.floor(event.progress * 10);
      if (bucket === progressBucket) return;
      progressBucket = bucket;
      writeSystemLog(`Yerel gazete OCR: %${Math.min(100, bucket * 10)}`);
    },
  });
  try {
    const result = await worker.recognize(image);
    const text = result.data.text.replace(/\s+\n/g, '\n').trim();
    const wordCount = text.split(/\s+/).filter(Boolean).length;
    if (wordCount < 20) throw new Error('Gazete görselinden yeterli okunabilir metin çıkarılamadı.');
    writeSystemLog(`Yerel OCR tamamlandı: ${wordCount} kelime · güven %${Math.round(result.data.confidence || 0)}.`, 'success');
    return text;
  } finally {
    await worker.terminate();
  }
}

async function videoFrameToImage(blob: Blob) {
  const url = URL.createObjectURL(blob);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = url;
  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(new Error('Videodan analiz karesi alınamadı.'));
      video.load();
    });
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Video analiz karesi hazırlanamadı.');
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        result => result ? resolve(result) : reject(new Error('Video analiz karesi kaydedilemedi.')),
        'image/jpeg',
        0.82,
      );
    });
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}

async function mediaToAnalysisImage(media: MediaFile) {
  const url = media.url || media.thumbnailUrl;
  if (!url || (media.type !== 'image' && media.type !== 'video')) return null;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${media.name} analiz için açılamadı.`);
  const source = await response.blob();
  const optimized = media.type === 'video'
    ? await videoFrameToImage(source)
    : await shrinkImage(source).catch(() => source);
  const dataUrl = await readBlobAsDataUrl(optimized);
  const comma = dataUrl.indexOf(',');
  if (comma < 0) throw new Error(`${media.name} görsel verisine çevrilemedi.`);
  return {
    name: media.name,
    mimeType: optimized.type || media.mimeType || 'image/jpeg',
    data: dataUrl.slice(comma + 1),
  };
}

async function request<T>(path: string, body: unknown, allowTokenPrompt = true): Promise<T> {
  const accessToken = localStorage.getItem(ACCESS_TOKEN_STORAGE_KEY)?.trim();
  const startedAt = performance.now();
  writeSystemLog(`AI API isteği gönderiliyor: ${path}`);
  const response = await fetch(`${API_BASE}/ai${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { 'X-Hermes-Access': accessToken } : {}),
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null) as ApiEnvelope<T> | null;
  const elapsedMs = Math.round(performance.now() - startedAt);
  writeSystemLog(
    `AI API yanıtı: ${path} · HTTP ${response.status} · ${elapsedMs} ms`,
    response.ok ? 'info' : 'warn',
  );

  if (response.status === 401 && allowTokenPrompt) {
    writeSystemLog('Hermes AI erişim anahtarı gerekli; kullanıcıdan güvenli giriş bekleniyor.', 'warn');
    localStorage.removeItem(ACCESS_TOKEN_STORAGE_KEY);
    const supplied = window.prompt('Hermes AI erişim anahtarını girin. Bu değer yalnızca bu tarayıcıda saklanır.');
    if (supplied?.trim()) {
      localStorage.setItem(ACCESS_TOKEN_STORAGE_KEY, supplied.trim());
      return request<T>(path, body, false);
    }
  }

  if (!response.ok || !payload?.success || !payload.data) {
    writeSystemLog(`AI API başarısız: ${path} · ${payload?.error?.message || `HTTP ${response.status}`}`, 'error');
    throw new Error(payload?.error?.message || `AI servisi yanıt vermedi (HTTP ${response.status}).`);
  }
  return payload.data;
}

function normalizeScript(script: HermesScript): HermesScript {
  const videoSlides = Array.isArray(script.videoSlides)
    ? script.videoSlides
      .filter(slide => slide && (slide.spokenText || slide.topText))
      .map(slide => ({
        topText: String(slide.topText || '').trim(),
        spokenText: String(slide.spokenText || slide.topText || '').trim(),
        imagePrompts: Array.isArray(slide.imagePrompts) ? slide.imagePrompts.map(String) : [],
      }))
    : [];
  if (!videoSlides.length) throw new Error('AI kullanılabilir video sahnesi üretmedi.');
  return { ...script, videoSlides };
}

export async function analyzeForVideo(options: {
  inputType: 'text' | 'url' | 'media' | 'prompt' | 'gazete';
  text: string;
  media: MediaFile[];
  config: RenderConfig;
}): Promise<AnalyzeResult> {
  const imageCandidates = options.media
    .filter(item => item.type === 'image' || item.type === 'video')
    .slice(0, MAX_ANALYSIS_IMAGES);
  const settled = await Promise.allSettled(imageCandidates.map(mediaToAnalysisImage));
  const images = settled
    .filter((item): item is PromiseFulfilledResult<NonNullable<Awaited<ReturnType<typeof mediaToAnalysisImage>>>> => item.status === 'fulfilled' && Boolean(item.value))
    .map(item => item.value);

  const requestConfig = {
    duration: options.config.duration,
    language: options.config.language,
    analysisMode: options.config.analysisMode,
    videoStyle: options.config.videoStyle,
    imageStyle: options.config.imageStyle,
    tip: options.config.tip,
    sourceName: options.config.sourceName,
    yorum: options.config.yorum,
  };
  let result = await request<AnalyzeResult>('/analyze', {
    inputType: options.inputType,
    text: options.text,
    images,
    config: requestConfig,
  });

  if (result.provider === 'local-fallback' && imageCandidates.length) {
    writeSystemLog(`Canlı görsel sağlayıcıları sonuç üretemedi: ${result.fallbackReason || 'sağlayıcı hatası'}`, 'warn');
    try {
      const ocrText = await extractTextLocally(imageCandidates[0]);
      result = await request<AnalyzeResult>('/analyze', {
        inputType: options.inputType === 'gazete' ? 'gazete' : 'text',
        text: ocrText,
        images: [],
        config: requestConfig,
      });
      writeSystemLog(
        result.provider === 'local-fallback'
          ? 'AI metin sağlayıcısı da kullanılamadı; gerçek OCR satırlarından güvenli senaryo oluşturuldu.'
          : `OCR metni başarıyla analiz edildi: ${result.provider} / ${result.model}.`,
        result.provider === 'local-fallback' ? 'warn' : 'success',
      );
    } catch (ocrError) {
      const reason = ocrError instanceof Error ? ocrError.message : String(ocrError);
      writeSystemLog(`Yerel OCR tamamlanamadı; ilk güvenli senaryo korunuyor: ${reason}`, 'warn');
    }
  }

  return { ...result, script: normalizeScript(result.script) };
}

function decodeBase64(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function writeAscii(view: DataView, offset: number, text: string) {
  for (let index = 0; index < text.length; index += 1) view.setUint8(offset + index, text.charCodeAt(index));
}

function pcmToWav(pcm: Uint8Array, sampleRate: number) {
  const headerSize = 44;
  const buffer = new ArrayBuffer(headerSize + pcm.byteLength);
  const view = new DataView(buffer);
  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + pcm.byteLength, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, pcm.byteLength, true);
  new Uint8Array(buffer, headerSize).set(pcm);
  return new Blob([buffer], { type: 'audio/wav' });
}

export async function createNarration(text: string, voice = 'Aoede') {
  const speech = await request<{
    audioData: string;
    mimeType: string;
    sampleRate: number;
  }>('/tts', { text, voice });
  return pcmToWav(decodeBase64(speech.audioData), speech.sampleRate || 24000);
}
