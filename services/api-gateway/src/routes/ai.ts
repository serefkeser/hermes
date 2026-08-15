import { Hono } from 'hono';
import {
  generateWithFallback,
  getConfiguredProviders,
  synthesizeSpeech,
  type AiProviderAttempt,
  type AiProviderEnv,
} from '../ai/providerRouter';
import { buildAnalyzeMessages, type AnalyzeInput } from '../ai/promptBuilder';

interface AiRouteEnv extends AiProviderEnv {
  AI_ACCESS_TOKEN?: string;
}

const MAX_IMAGES = 3;
const MAX_BASE64_CHARS = 16_000_000;
const MAX_TEXT_CHARS = 40_000;
const MAX_TTS_CHARS = 5_000;

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
    textOrder: c.env.AI_TEXT_PROVIDER_ORDER || 'groq,opencode,openrouter,nvidia,gemini',
    visionOrder: c.env.AI_VISION_PROVIDER_ORDER || 'groq,openrouter,nvidia,gemini',
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
    const generated = await generateWithFallback(c.env, {
      task: images.length ? 'vision' : 'text',
      messages: buildAnalyzeMessages({ ...body, images }),
      temperature: 0.2,
      maxTokens: 6144,
      responseFormat: 'json',
    });
    const script = parseJsonObject(generated.text);

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
      success: false,
      error: {
        code: 'AI_PROVIDERS_FAILED',
        message: error instanceof Error ? error.message : 'AI analizi başarısız.',
        attempts,
      },
    }, 503);
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

function parseJsonObject(text: string) {
  const clean = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '');
  try {
    return JSON.parse(clean) as Record<string, unknown>;
  } catch {
    const start = clean.indexOf('{');
    const end = clean.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(clean.slice(start, end + 1)) as Record<string, unknown>;
    }
    throw new Error('AI yanıtı geçerli JSON değil.');
  }
}
