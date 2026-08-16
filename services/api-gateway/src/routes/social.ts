import { Hono, type Context } from 'hono';
import {
  getBufferChannels,
  publishToBufferChannels,
  type BufferPostResult,
} from '../social/buffer';

interface SocialRouteEnv {
  ENVIRONMENT: string;
  AI_ACCESS_TOKEN?: string;
  BUFFER_API_KEY?: string;
  BUFFER_CHANNEL_IDS?: string;
  BUFFER_SHARE_MODE?: string;
  BUFFER_YOUTUBE_CATEGORY_ID?: string;
  SOCIAL_MEDIA_BUCKET: R2Bucket;
}

const MAX_MEDIA_BYTES = 95 * 1024 * 1024;
const MAX_CAPTION_CHARS = 8_000;
const ALLOWED_MEDIA_TYPES = new Map([
  ['video/mp4', { kind: 'video' as const, extension: 'mp4' }],
  ['image/png', { kind: 'image' as const, extension: 'png' }],
  ['image/jpeg', { kind: 'image' as const, extension: 'jpg' }],
]);

export const socialRoutes = new Hono<{ Bindings: SocialRouteEnv }>();

type SocialContext = Context<{ Bindings: SocialRouteEnv }>;

function isAuthorized(c: SocialContext) {
  if (!c.env.AI_ACCESS_TOKEN) return true;
  const bearer = c.req.header('Authorization')?.replace(/^Bearer\s+/i, '').trim();
  const accessHeader = c.req.header('X-Hermes-Access')?.trim();
  return bearer === c.env.AI_ACCESS_TOKEN || accessHeader === c.env.AI_ACCESS_TOKEN;
}

function unauthorized(c: SocialContext) {
  return c.json({
    success: false,
    error: { code: 'UNAUTHORIZED', message: 'OTONOM erişim anahtarı gerekli.' },
  }, 401);
}

function decodeHeader(value: string | undefined) {
  if (!value) return '';
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function safeFilename(value: string, extension: string) {
  const base = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^\.+/, '')
    .slice(0, 100)
    .replace(/\.[a-z0-9]+$/i, '');
  return `${base || `otonom_${Date.now()}`}.${extension}`;
}

function selectedChannels<T extends { id: string }>(channels: T[], configuredIds?: string) {
  const ids = (configuredIds || '').split(',').map(id => id.trim()).filter(Boolean);
  return ids.length ? channels.filter(channel => ids.includes(channel.id)) : channels;
}

function publicMediaUrl(requestUrl: string, date: string, filename: string) {
  const url = new URL(requestUrl);
  return `${url.origin}/social/media/${date}/${encodeURIComponent(filename)}`;
}

function publicObjectHeaders(object: R2Object, contentLength: number) {
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('Content-Length', String(contentLength));
  headers.set('ETag', object.httpEtag);
  headers.set('Cache-Control', 'public, max-age=3600');
  headers.set('X-Content-Type-Options', 'nosniff');
  return headers;
}

socialRoutes.get('/status', c => c.json({
  success: true,
  data: {
    storageConfigured: Boolean(c.env.SOCIAL_MEDIA_BUCKET),
    bufferConfigured: Boolean(c.env.BUFFER_API_KEY),
    mode: c.env.BUFFER_SHARE_MODE === 'shareNow' ? 'shareNow' : 'addToQueue',
  },
}));

socialRoutes.get('/channels', async c => {
  if (!isAuthorized(c)) return unauthorized(c);
  if (!c.env.BUFFER_API_KEY) {
    return c.json({
      success: false,
      error: { code: 'BUFFER_NOT_CONFIGURED', message: 'Cloudflare Worker BUFFER_API_KEY secret ayarı eksik.' },
    }, 503);
  }
  try {
    const channels = selectedChannels(await getBufferChannels(c.env.BUFFER_API_KEY), c.env.BUFFER_CHANNEL_IDS);
    return c.json({ success: true, data: { channels } });
  } catch (error) {
    return c.json({
      success: false,
      error: { code: 'BUFFER_CHANNELS_FAILED', message: error instanceof Error ? error.message : String(error) },
    }, 502);
  }
});

socialRoutes.post('/publish', async c => {
  if (!isAuthorized(c)) return unauthorized(c);
  if (!c.env.SOCIAL_MEDIA_BUCKET) {
    return c.json({
      success: false,
      error: { code: 'R2_NOT_CONFIGURED', message: 'SOCIAL_MEDIA_BUCKET R2 bağlantısı bulunamadı.' },
    }, 503);
  }
  if (!c.env.BUFFER_API_KEY) {
    return c.json({
      success: false,
      error: { code: 'BUFFER_NOT_CONFIGURED', message: 'Cloudflare Worker BUFFER_API_KEY secret ayarı eksik.' },
    }, 503);
  }

  const contentType = (c.req.header('Content-Type') || '').split(';')[0].trim().toLowerCase();
  const media = ALLOWED_MEDIA_TYPES.get(contentType);
  if (!media) {
    return c.json({
      success: false,
      error: { code: 'UNSUPPORTED_MEDIA', message: 'Buffer otomasyonu yalnızca MP4, PNG veya JPEG kabul ediyor.' },
    }, 415);
  }
  const contentLength = Number(c.req.header('Content-Length') || 0);
  if (contentLength > MAX_MEDIA_BYTES) {
    return c.json({
      success: false,
      error: { code: 'MEDIA_TOO_LARGE', message: 'Dosya 95 MB sınırını aşıyor.' },
    }, 413);
  }
  const caption = decodeHeader(c.req.header('X-OTONOM-Caption')).trim();
  if (!caption || caption.length > MAX_CAPTION_CHARS) {
    return c.json({
      success: false,
      error: { code: 'INVALID_CAPTION', message: `Açıklama 1-${MAX_CAPTION_CHARS} karakter olmalı.` },
    }, 400);
  }
  if (!c.req.raw.body) {
    return c.json({
      success: false,
      error: { code: 'EMPTY_MEDIA', message: 'Yüklenecek medya bulunamadı.' },
    }, 400);
  }

  let channels;
  try {
    channels = selectedChannels(await getBufferChannels(c.env.BUFFER_API_KEY), c.env.BUFFER_CHANNEL_IDS);
  } catch (error) {
    return c.json({
      success: false,
      error: { code: 'BUFFER_CHANNELS_FAILED', message: error instanceof Error ? error.message : String(error) },
    }, 502);
  }
  if (!channels.length) {
    return c.json({
      success: false,
      error: { code: 'NO_BUFFER_CHANNELS', message: 'Buffer hesabında kullanılabilir bağlı kanal bulunamadı.' },
    }, 409);
  }

  const date = new Date().toISOString().slice(0, 10);
  const originalName = decodeHeader(c.req.header('X-OTONOM-Filename'));
  const filename = safeFilename(originalName, media.extension);
  const objectName = `${crypto.randomUUID()}_${filename}`;
  const objectKey = `social/${date}/${objectName}`;
  const mediaUrl = publicMediaUrl(c.req.url, date, objectName);
  const uploadedAt = new Date().toISOString();

  try {
    await c.env.SOCIAL_MEDIA_BUCKET.put(objectKey, c.req.raw.body, {
      httpMetadata: {
        contentType,
        contentDisposition: `inline; filename="${filename}"`,
        cacheControl: 'public, max-age=3600',
      },
      customMetadata: {
        source: 'otonom',
        uploadedAt,
      },
    });
  } catch (error) {
    return c.json({
      success: false,
      error: {
        code: 'R2_UPLOAD_FAILED',
        message: `Video R2'ye yüklenemedi: ${error instanceof Error ? error.message : String(error)}`,
      },
    }, 502);
  }

  const shareMode = c.env.BUFFER_SHARE_MODE === 'shareNow' ? 'shareNow' : 'addToQueue';
  let results: BufferPostResult[];
  try {
    results = await publishToBufferChannels({
      apiKey: c.env.BUFFER_API_KEY,
      channels,
      caption,
      mediaUrl,
      mediaType: media.kind,
      shareMode,
      youtubeCategoryId: c.env.BUFFER_YOUTUBE_CATEGORY_ID || '25',
    });
  } catch (error) {
    results = channels.map(channel => ({
      channelId: channel.id,
      channelName: channel.name,
      service: channel.service,
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    }));
  }

  const queuedCount = results.filter(result => result.ok).length;
  const failedCount = results.length - queuedCount;
  const receipt = {
    id: objectName.replace(/\.[a-z0-9]+$/i, ''),
    createdAt: uploadedAt,
    shareMode,
    objectKey,
    mediaUrl,
    filename,
    contentType,
    size: contentLength || null,
    results,
  };
  await c.env.SOCIAL_MEDIA_BUCKET.put(`${objectKey}.receipt.json`, JSON.stringify(receipt), {
    httpMetadata: { contentType: 'application/json;charset=utf-8' },
    customMetadata: { source: 'otonom', uploadedAt },
  }).catch((error: unknown) => console.warn('[SOCIAL] Receipt could not be persisted:', error));

  if (!queuedCount) {
    return c.json({
      success: false,
      data: { mediaUrl, filename, queuedCount, failedCount, results },
      error: { code: 'BUFFER_PUBLISH_FAILED', message: 'Video R2’ye yüklendi ancak hiçbir Buffer kanalı kuyruğa alınamadı.' },
    }, 502);
  }

  return c.json({
    success: true,
    data: { mediaUrl, filename, queuedCount, failedCount, results },
  });
});

socialRoutes.on(['GET', 'HEAD'], '/media/:date/:filename', async c => {
  const date = c.req.param('date');
  const filename = c.req.param('filename');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^[a-zA-Z0-9._-]+\.(?:mp4|png|jpg)$/.test(filename)) {
    return c.json({ success: false, error: { code: 'INVALID_MEDIA_PATH', message: 'Geçersiz medya adresi.' } }, 400);
  }
  const key = `social/${date}/${filename}`;
  if (c.req.method === 'HEAD') {
    const object = await c.env.SOCIAL_MEDIA_BUCKET.head(key);
    if (!object) return c.body(null, 404);
    return new Response(null, { status: 200, headers: publicObjectHeaders(object, object.size) });
  }
  const object = await c.env.SOCIAL_MEDIA_BUCKET.get(key);
  if (!object) return c.body(null, 404);
  return new Response(object.body, {
    status: 200,
    headers: publicObjectHeaders(object, object.size),
  });
});
