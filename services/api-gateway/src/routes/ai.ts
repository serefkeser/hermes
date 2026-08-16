import { Hono } from 'hono';
import {
  generateWithFallback,
  getConfiguredProviders,
  synthesizeSpeech,
  type AiProviderAttempt,
  type AiProviderEnv,
} from '../ai/providerRouter';
import { buildAnalyzeMessages, type AnalyzeInput } from '../ai/promptBuilder';
import { parseAiJsonObject, validateHermesNewspaperResponse, validateHermesScriptResponse } from '../ai/jsonResponse';

interface AiRouteEnv extends AiProviderEnv {
  AI_ACCESS_TOKEN?: string;
}

const MAX_IMAGES = 3;
const MAX_BASE64_CHARS = 16_000_000;
const MAX_TEXT_CHARS = 40_000;
const MAX_TTS_CHARS = 5_000;

interface OcrHeadlineCandidate {
  id: string;
  text: string;
  detail: string;
  confidence: number;
  score: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

function parseOcrHeadlineCandidates(sourceText: string): OcrHeadlineCandidate[] {
  return sourceText
    .split(/\n+/)
    .map(line => line.match(/^(H\d+)\|score=(\d+)\|confidence=(\d+)\|x=(-?\d+)\|y=(-?\d+)\|w=(\d+)\|h=(\d+)\|text=(.*?)\|detail=(.*)$/i))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map(match => ({
      id: match[1].toUpperCase(), score: Number(match[2]), confidence: Number(match[3]),
      x: Number(match[4]), y: Number(match[5]), w: Number(match[6]), h: Number(match[7]),
      text: match[8].replace(/\s+/g, ' ').trim(), detail: match[9].replace(/\s+/g, ' ').trim(),
    }))
    .filter((candidate, index, all) => candidate.text && all.findIndex(item => item.id === candidate.id) === index)
    .sort((left, right) => Number(left.id.slice(1)) - Number(right.id.slice(1)))
    .slice(0, 8);
}

function buildEmergencyScript(body: AnalyzeInput) {
  const sourceName = body.config?.sourceName?.trim() || body.images?.[0]?.name?.trim() || 'OTONOM';
  const sourceText = body.text?.trim() || '';
  const ocrCandidates = parseOcrHeadlineCandidates(sourceText);
  const rankedOcrLines = sourceText
    .split(/\n+/)
    .map(line => line.match(/^\d+\.\s+\[boyut=[^\]]+\]\s+(.+)$/)?.[1]?.replace(/\s+/g, ' ').trim() || '')
    .filter(line => line.split(/\s+/).length >= 3 && !/^(cumhuriyet|\d{1,2}\s+\p{L}+\s+\d{4})/iu.test(line));
  const sourceLines = (ocrCandidates.length ? ocrCandidates.map(candidate => candidate.text) : rankedOcrLines.length >= 5 ? rankedOcrLines : sourceText
    .split(/(?<=[.!?])\s+|\n+/)
    .map(sentence => sentence.replace(/\s+/g, ' ').trim())
    .filter(sentence => sentence.split(/\s+/).length >= 3)
  )
    .map(sentence => sentence.split(/\s+/).slice(0, 55).join(' '))
    .slice(0, 6);
  const fallbackLines = [
    'Kaynak görsel video akışına alındı. Otomatik içerik çözümleme hizmeti geçici olarak yanıt vermedi.',
    'Gazete sayfası ekranda korunuyor. Okunamayan ayrıntılar hakkında doğrulanmamış bilgi üretilmedi.',
    'Başlıklar özgün sayfa üzerinden incelenebilir. Video, kaynak görünümünü değiştirmeden sunuyor.',
    'Bu geçici akış yalnızca güvenle doğrulanabilen bilgileri kullanıyor. Varsayım veya uydurma ayrıntı eklenmedi.',
    'Ayrıntılı yapay zekâ çözümlemesi sonraki çalıştırmada yeniden denenecek. Üretim işlemi tamamen durdurulmadı.',
    'Kaynak sayfa kapanıştan önce yeniden gösteriliyor. Oluşturma kaydı tanılama dosyasına işlendi.',
  ];
  const lines = Array.from({ length: 6 }, (_, index) => sourceLines[index] || fallbackLines[index]);
  return {
    isContentUnreadable: sourceLines.length === 0,
    videoSlides: lines.map((spokenText, index) => ({
      sourceHeadlineId: ocrCandidates[index]?.id || '',
      sourceHeadline: sourceLines[index] || '',
      topText: sourceLines[index]
        ? sourceLines[index].split(/\s+/).slice(0, 3).join(' ').replace(/[^\p{L}\p{N}\s]/gu, '').toLocaleUpperCase('tr-TR')
        : ['KAYNAK GÖRSEL', 'SAYFA GÜNDEMİ', 'ÖNEMLİ BAŞLIKLAR', 'DOĞRULAMA NOTU', 'ANALİZ DURUMU', 'KAYNAK ÖZETİ'][index],
      spokenText: /[.!?]$/.test(spokenText) ? spokenText : `${spokenText}.`,
      imagePrompts: [],
    })),
    thumbnailText: `${Math.min(8, Math.max(1, sourceLines.length))} HABER ÖZETİ`,
    sonSoz: 'Doğru söz, yemin istemez.',
    gununSorusu: '',
    lastQuote: 'Kaynağı izlemeye devam ediyoruz.',
    sourceName,
    gazeteBasliklari: [],
  };
}

function normalizeHeadline(value: unknown) {
  return String(value || '').toLocaleLowerCase('tr-TR').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function normalizeNewspaperScript(script: Record<string, unknown>, ocrCandidates: OcrHeadlineCandidate[]) {
  const rawHeadlines = Array.isArray(script.gazeteBasliklari)
    ? script.gazeteBasliklari.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    : [];
  const headlines = rawHeadlines
    .filter((headline, index, all) => {
      const key = normalizeHeadline(headline.baslik);
      return key && all.findIndex(candidate => normalizeHeadline(candidate.baslik) === key) === index;
    })
    .sort((left, right) => {
      const importance = Number(right.onem || 0) - Number(left.onem || 0);
      if (importance) return importance;
      return Number(right.w || 0) * Number(right.h || 0) - Number(left.w || 0) * Number(left.h || 0);
    })
    .slice(0, 8);
  const rawSlides = Array.isArray(script.videoSlides)
    ? script.videoSlides.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    : [];
  if (ocrCandidates.length) {
    const candidates = ocrCandidates.slice(0, 8);
    const videoSlides = candidates.map(candidate => {
      const spokenText = [candidate.text, candidate.detail].filter(Boolean).join('. ');
      return {
        sourceHeadlineId: candidate.id,
        sourceHeadline: candidate.text,
        topText: candidate.text.split(/\s+/).slice(0, 4).join(' '),
        spokenText: /[.!?]$/.test(spokenText) ? spokenText : `${spokenText}.`,
        imagePrompts: [],
      };
    });
    return {
      ...script,
      videoSlides,
      thumbnailText: `${videoSlides.length} HABER ÖZETİ`,
      gazeteBasliklari: candidates.map((candidate, index) => ({
        sourceHeadlineId: candidate.id,
        baslik: candidate.text,
        aciklama: candidate.detail,
        onem: Math.max(1, 100 - index * 10),
        x: candidate.x, y: candidate.y, w: candidate.w, h: candidate.h,
      })),
    };
  }

  if (headlines.length < 5) return script;

  const usedSlides = new Set<number>();
  const videoSlides = headlines.map(headline => {
    const headlineKey = normalizeHeadline(headline.baslik);
    const slideIndex = rawSlides.findIndex((slide, index) => {
      if (usedSlides.has(index)) return false;
      const sourceKey = normalizeHeadline(slide.sourceHeadline);
      return sourceKey && (sourceKey.includes(headlineKey) || headlineKey.includes(sourceKey));
    });
    if (slideIndex >= 0) usedSlides.add(slideIndex);
    const slide = slideIndex >= 0 ? rawSlides[slideIndex] : {};
    const sourceHeadline = String(headline.baslik || '').trim();
    const description = String(headline.aciklama || '').trim();
    return {
      sourceHeadlineId: String(slide.sourceHeadlineId || headline.sourceHeadlineId || '').trim(),
      sourceHeadline,
      topText: String(slide.topText || sourceHeadline.split(/\s+/).slice(0, 3).join(' ')).trim(),
      spokenText: String(slide.spokenText || `${sourceHeadline}. ${description}`).trim(),
      imagePrompts: [],
    };
  });
  return {
    ...script,
    videoSlides,
    thumbnailText: `${videoSlides.length} HABER ÖZETİ`,
    gazeteBasliklari: headlines,
  };
}

export const aiRoutes = new Hono<{ Bindings: AiRouteEnv }>();

function isAuthorized(authorization: string | undefined, accessHeader: string | undefined, env: AiRouteEnv) {
  if (!env.AI_ACCESS_TOKEN) return true;
  const bearer = authorization?.replace(/^Bearer\s+/i, '').trim();
  return bearer === env.AI_ACCESS_TOKEN || accessHeader === env.AI_ACCESS_TOKEN;
}

aiRoutes.use('*', async (c, next) => {
  if (!isAuthorized(c.req.header('Authorization'), c.req.header('X-Hermes-Access'), c.env)) {
    return c.json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'AI servisi erişim anahtarı geçersiz.' },
    }, 401);
  }
  await next();
});

aiRoutes.get('/health', c => c.json({
  success: true,
  data: {
    configured: getConfiguredProviders(c.env),
    textOrder: c.env.AI_TEXT_PROVIDER_ORDER || 'gemini,openrouter,groq,opencode,nvidia',
    visionOrder: c.env.AI_VISION_PROVIDER_ORDER || 'gemini,openrouter,groq,nvidia',
    persistentMediaStorage: false,
  },
}));

aiRoutes.post('/analyze', async c => {
  let body: AnalyzeInput;
  try {
    body = await c.req.json<AnalyzeInput>();
  } catch {
    return c.json({
      success: false,
      error: { code: 'INVALID_JSON', message: 'İstek gövdesi geçerli JSON değil.' },
    }, 400);
  }

  const allowedInputTypes = new Set(['text', 'url', 'prompt', 'media', 'gazete']);
  if (!body || !allowedInputTypes.has(body.inputType)) {
    return c.json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Geçerli inputType gerekli.' },
    }, 400);
  }

  const images = Array.isArray(body.images) ? body.images : [];
  if (!body.text?.trim() && images.length === 0) {
    return c.json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Metin veya en az bir görsel gerekli.' },
    }, 400);
  }
  if ((body.text?.length || 0) > MAX_TEXT_CHARS || images.length > MAX_IMAGES) {
    return c.json({
      success: false,
      error: { code: 'PAYLOAD_TOO_LARGE', message: 'Metin veya görsel sayısı sınırı aşıldı.' },
    }, 413);
  }
  const totalBase64Chars = images.reduce((total, image) => total + (image.data?.length || 0), 0);
  const hasInvalidImage = images.some(image => !image.mimeType?.startsWith('image/') || !image.data);
  if (hasInvalidImage || totalBase64Chars > MAX_BASE64_CHARS) {
    return c.json({
      success: false,
      error: { code: 'PAYLOAD_TOO_LARGE', message: 'Görsel verisi geçersiz veya fazla büyük.' },
    }, 413);
  }

  try {
    const ocrCandidates = parseOcrHeadlineCandidates(body.text || '');
    const generated = await generateWithFallback(c.env, {
      task: images.length ? 'vision' : 'text',
      messages: buildAnalyzeMessages({ ...body, images }),
      temperature: 0.2,
      maxTokens: 6144,
      responseFormat: 'json',
      validateResponse: body.inputType === 'gazete'
        ? text => validateHermesNewspaperResponse(text, ocrCandidates.map(candidate => candidate.id))
        : validateHermesScriptResponse,
    });
    const parsedScript = parseAiJsonObject(generated.text);
    const script = body.inputType === 'gazete'
      ? normalizeNewspaperScript(parsedScript, ocrCandidates)
      : parsedScript;

    return c.json({
      success: true,
      data: {
        provider: generated.provider,
        model: generated.model,
        attempts: generated.attempts,
        script,
      },
    });
  } catch (error) {
    const attempts = (error as { attempts?: AiProviderAttempt[] })?.attempts || [];
    return c.json({
      success: true,
      data: {
        provider: 'local-fallback',
        model: 'deterministic-safe-script',
        attempts,
        script: buildEmergencyScript(body),
        fallbackReason: error instanceof Error ? error.message : 'AI analizi başarısız.',
      },
    });
  }
});

aiRoutes.post('/tts', async c => {
  let body: { text?: string; voice?: string };
  try {
    body = await c.req.json<{ text?: string; voice?: string }>();
  } catch {
    return c.json({
      success: false,
      error: { code: 'INVALID_JSON', message: 'İstek gövdesi geçerli JSON değil.' },
    }, 400);
  }

  const text = body.text?.trim() || '';
  if (!text || text.length > MAX_TTS_CHARS) {
    return c.json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: `TTS metni 1-${MAX_TTS_CHARS} karakter olmalı.` },
    }, 400);
  }

  try {
    const speech = await synthesizeSpeech(c.env, text, body.voice || 'Aoede');
    return c.json({ success: true, data: speech });
  } catch (error) {
    return c.json({
      success: false,
      error: {
        code: 'TTS_FAILED',
        message: error instanceof Error ? error.message : 'TTS oluşturulamadı.',
      },
    }, 503);
  }
});
