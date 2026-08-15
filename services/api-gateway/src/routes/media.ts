// Media routes - Upload, Get, Delete, Multipart
import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../worker-configuration';
import { generateMediaId } from '@otonom/shared-utils';
import { AppError } from '@otonom/shared-utils';
import type { MediaAsset, PresignedUploadResponse, MultipartUploadInitResponse, CompletedPart } from '@otonom/shared-types';

export const mediaRoutes = new Hono<{ Bindings: Env }>();

// Validation schemas
const uploadInitSchema = z.object({
  filename: z.string().min(1, 'Dosya adı gerekli').max(255, 'Dosya adı çok uzun'),
  mimeType: z.string().min(1, 'MIME type gerekli'),
  size: z.number().positive('Boyut pozitif olmalı'),
  jobId: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

const multipartInitSchema = z.object({
  filename: z.string().min(1, 'Dosya adı gerekli').max(255, 'Dosya adı çok uzun'),
  mimeType: z.string().min(1, 'MIME type gerekli'),
  size: z.number().positive('Boyut pozitif olmalı'),
  partSize: z.number().int().positive().optional().default(5 * 1024 * 1024), // 5MB default
  jobId: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

const multipartCompleteSchema = z.object({
  uploadId: z.string().min(1, 'Upload ID gerekli'),
  mediaId: z.string().min(1, 'Media ID gerekli'),
  parts: z.array(z.object({
    partNumber: z.number().int().positive(),
    etag: z.string().min(1, 'ETag gerekli'),
  })).min(1, 'En az bir parça gerekli'),
});

const deleteMediaSchema = z.object({
  mediaIds: z.array(z.string()).min(1, 'En az bir media ID gerekli').max(100, 'En fazla 100 media'),
});

// Allowed MIME types
const ALLOWED_MIME_TYPES = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif',
  'video/mp4', 'video/webm', 'video/quicktime',
  'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/flac', 'audio/mp4',
];

const MAX_UPLOAD_SIZE = 100 * 1024 * 1024; // 100MB
const PRESIGNED_URL_EXPIRY = 3600; // 1 hour

// Initiate single-part upload (presigned PUT URL)
mediaRoutes.post('/upload', async (c) => {
  const env = c.env;
  const userId = c.get('userId')!;
  const body = await c.req.json();

  const result = uploadInitSchema.safeParse(body);
  if (!result.success) {
    throw new AppError('VALIDATION_ERROR', 'Geçersiz veri', 400, { issues: result.error.errors }, true);
  }

  const { filename, mimeType, size, jobId, tags } = result.data;

  // Validate file type
  if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
    throw new AppError('VALIDATION_ERROR', 'Desteklenmeyen dosya türü', 400, { allowedTypes: ALLOWED_MIME_TYPES }, true);
  }

  // Validate size
  if (size > MAX_UPLOAD_SIZE) {
    throw new AppError('VALIDATION_ERROR', `Dosya çok büyük. Maksimum: ${formatBytes(MAX_UPLOAD_SIZE)}`, 400, { maxSize: MAX_UPLOAD_SIZE }, true);
  }

  // Generate media ID and R2 key
  const mediaId = generateMediaId();
  const ext = filename.split('.').pop()?.toLowerCase() || 'bin';
  const r2Key = `uploads/${userId}/${mediaId}.${ext}`;

  // Create presigned PUT URL for R2
  const uploadUrl = await createPresignedPutUrl(env.MEDIA_BUCKET, r2Key, mimeType, PRESIGNED_URL_EXPIRY);

  // Create media record (pending upload)
  const now = Date.now();
  const media: MediaAsset = {
    id: mediaId,
    userId,
    jobId,
    type: getMediaType(mimeType),
    mimeType,
    size,
    r2Key,
    presignedUrl: uploadUrl,
    presignedUrlExpiresAt: now + PRESIGNED_URL_EXPIRY * 1000,
    tags: tags || [],
    createdAt: now,
    updatedAt: now,
  };

  await env.RATE_LIMIT_KV.put(`media:${mediaId}`, JSON.stringify(media));

  // Add to user's media list
  const userMediaKey = `user:media:${userId}`;
  let userMedia = await env.RATE_LIMIT_KV.get(userMediaKey, { type: 'json' }) as string[] || [];
  userMedia.unshift(mediaId);
  userMedia = userMedia.slice(0, 1000);
  await env.RATE_LIMIT_KV.put(userMediaKey, JSON.stringify(userMedia));

  const response: PresignedUploadResponse = {
    uploadUrl,
    mediaId,
    expiresAt: now + PRESIGNED_URL_EXPIRY * 1000,
  };

  return c.json({
    success: true,
    data: response,
  });
});

// Initiate multipart upload (for large files)
mediaRoutes.post('/upload/multipart', async (c) => {
  const env = c.env;
  const userId = c.get('userId')!;
  const body = await c.req.json();

  const result = multipartInitSchema.safeParse(body);
  if (!result.success) {
    throw new AppError('VALIDATION_ERROR', 'Geçersiz veri', 400, { issues: result.error.errors }, true);
  }

  const { filename, mimeType, size, partSize, jobId, tags } = result.data;

  // Validate
  if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
    throw new AppError('VALIDATION_ERROR', 'Desteklenmeyen dosya türü', 400, { allowedTypes: ALLOWED_MIME_TYPES }, true);
  }

  if (size > MAX_UPLOAD_SIZE) {
    throw new AppError('VALIDATION_ERROR', `Dosya çok büyük. Maksimum: ${formatBytes(MAX_UPLOAD_SIZE)}`, 400, { maxSize: MAX_UPLOAD_SIZE }, true);
  }

  const mediaId = generateMediaId();
  const ext = filename.split('.').pop()?.toLowerCase() || 'bin';
  const r2Key = `uploads/${userId}/${mediaId}.${ext}`;

  // Calculate parts
  const totalParts = Math.ceil(size / partSize);
  if (totalParts > 10000) {
    throw new AppError('VALIDATION_ERROR', 'Çok fazla parça. Parça boyutunu artırın.', 400, undefined, true);
  }

  // Generate presigned URLs for each part
  const partUrls: string[] = [];
  for (let i = 1; i <= totalParts; i++) {
    const partKey = `${r2Key}.part${i}`;
    const url = await createPresignedPutUrl(env.MEDIA_BUCKET, partKey, mimeType, PRESIGNED_URL_EXPIRY);
    partUrls.push(url);
  }

  const uploadId = `mup_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  // Store multipart upload info
  const multipartInfo = {
    uploadId,
    mediaId,
    userId,
    r2Key,
    mimeType,
    size,
    partSize,
    totalParts,
    uploadedParts: [] as number[],
    jobId,
    tags: tags || [],
    createdAt: Date.now(),
    expiresAt: Date.now() + PRESIGNED_URL_EXPIRY * 1000,
  };

  await env.RATE_LIMIT_KV.put(`multipart:${uploadId}`, JSON.stringify(multipartInfo), { expirationTtl: PRESIGNED_URL_EXPIRY + 60 });

  const response: MultipartUploadInitResponse = {
    uploadId,
    mediaId,
    partUrls,
    partSize,
    expiresAt: multipartInfo.expiresAt,
  };

  return c.json({
    success: true,
    data: response,
  });
});

// Complete multipart upload
mediaRoutes.post('/upload/complete', async (c) => {
  const env = c.env;
  const userId = c.get('userId')!;
  const body = await c.req.json();

  const result = multipartCompleteSchema.safeParse(body);
  if (!result.success) {
    throw new AppError('VALIDATION_ERROR', 'Geçersiz veri', 400, { issues: result.error.errors }, true);
  }

  const { uploadId, mediaId, parts } = result.data;

  // Get multipart info
  const multipartData = await env.RATE_LIMIT_KV.get(`multipart:${uploadId}`);
  if (!multipartData) {
    throw new AppError('NOT_FOUND', 'Multipart yükleme bulunamadı veya süresi doldu', 404);
  }

  const multipartInfo = JSON.parse(multipartData);

  // Verify ownership
  if (multipartInfo.userId !== userId) {
    throw new AppError('FORBIDDEN', 'Bu yüklemeye erişim yetkiniz yok', 403);
  }

  if (multipartInfo.mediaId !== mediaId) {
    throw new AppError('CONFLICT', 'Media ID uyuşmuyor', 409, undefined, true);
  }

  // Verify all parts present
  const uploadedPartNumbers = parts.map(p => p.partNumber).sort((a, b) => a - b);
  const expectedParts = Array.from({ length: multipartInfo.totalParts }, (_, i) => i + 1);
  if (JSON.stringify(uploadedPartNumbers) !== JSON.stringify(expectedParts)) {
    throw new AppError('VALIDATION_ERROR', 'Eksik veya fazladan parça', 400, { expected: expectedParts, received: uploadedPartNumbers }, true);
  }

  // Complete multipart upload in R2
  await completeMultipartUpload(env.MEDIA_BUCKET, multipartInfo.r2Key, uploadId, parts);

  // Update media record
  const mediaData = await env.RATE_LIMIT_KV.get(`media:${mediaId}`);
  if (!mediaData) {
    throw new AppError('NOT_FOUND', 'Media kaydı bulunamadı', 404);
  }

  const media = JSON.parse(mediaData) as MediaAsset;
  media.size = multipartInfo.size;
  media.r2Key = multipartInfo.r2Key;
  media.publicUrl = `https://${env.MEDIA_BUCKET.name}.r2.dev/${multipartInfo.r2Key}`; // If public bucket
  media.updatedAt = Date.now();
  delete media.presignedUrl;
  delete media.presignedUrlExpiresAt;

  await env.RATE_LIMIT_KV.put(`media:${mediaId}`, JSON.stringify(media));

  // Clean up multipart info
  await env.RATE_LIMIT_KV.delete(`multipart:${uploadId}`);

  return c.json({
    success: true,
    data: {
      mediaId,
      publicUrl: media.publicUrl,
      message: 'Yükleme tamamlandı',
    },
  });
});

// Get media by ID
mediaRoutes.get('/:id', async (c) => {
  const env = c.env;
  const userId = c.get('userId')!;
  const mediaId = c.req.param('id');

  const mediaData = await env.RATE_LIMIT_KV.get(`media:${mediaId}`);
  if (!mediaData) {
    throw new AppError('NOT_FOUND', 'Medya bulunamadı', 404);
  }

  const media = JSON.parse(mediaData) as MediaAsset;

  // Check ownership (unless public)
  if (media.userId !== userId) {
    throw new AppError('FORBIDDEN', 'Bu medyaya erişim yetkiniz yok', 403);
  }

  // Generate fresh presigned URL if expired
  let publicUrl = media.publicUrl;
  if (!publicUrl && media.r2Key) {
    publicUrl = await createPresignedGetUrl(env.MEDIA_BUCKET, media.r2Key, 3600);
  }

  return c.json({
    success: true,
    data: {
      ...media,
      publicUrl,
    },
  });
});

// List user's media
mediaRoutes.get('/', async (c) => {
  const env = c.env;
  const userId = c.get('userId')!;

  const query = c.req.query();
  const page = parseInt(query.page || '1', 10);
  const pageSize = Math.min(parseInt(query.pageSize || '20', 10), 100);
  const type = query.type as MediaAsset['type'] | undefined;

  const userMediaKey = `user:media:${userId}`;
  const mediaIds = await env.RATE_LIMIT_KV.get(userMediaKey, { type: 'json' }) as string[] || [];

  const mediaList: MediaAsset[] = [];
  for (const mediaId of mediaIds) {
    const mediaData = await env.RATE_LIMIT_KV.get(`media:${mediaId}`);
    if (mediaData) {
      const media = JSON.parse(mediaData) as MediaAsset;
      if (type && media.type !== type) continue;
      mediaList.push(media);
    }
  }

  // Sort by createdAt desc
  mediaList.sort((a, b) => b.createdAt - a.createdAt);

  // Paginate
  const start = (page - 1) * pageSize;
  const end = start + pageSize;

  return c.json({
    success: true,
    data: {
      items: mediaList.slice(start, end),
      total: mediaList.length,
      page,
      pageSize,
      hasMore: end < mediaList.length,
    },
  });
});

// Delete media
mediaRoutes.delete('/', async (c) => {
  const env = c.env;
  const userId = c.get('userId')!;
  const body = await c.req.json();

  const result = deleteMediaSchema.safeParse(body);
  if (!result.success) {
    throw new AppError('VALIDATION_ERROR', 'Geçersiz veri', 400, { issues: result.error.errors }, true);
  }

  const { mediaIds } = result.data;
  let deleted = 0;
  let failed = 0;

  for (const mediaId of mediaIds) {
    const mediaData = await env.RATE_LIMIT_KV.get(`media:${mediaId}`);
    if (!mediaData) {
      failed++;
      continue;
    }

    const media = JSON.parse(mediaData) as MediaAsset;
    if (media.userId !== userId) {
      failed++;
      continue;
    }

    // Delete from R2
    if (media.r2Key) {
      try {
        await env.MEDIA_BUCKET.delete(media.r2Key);
      } catch (e) {
        console.error('[MEDIA] R2 delete failed:', e);
      }
    }

    // Delete multipart parts if any
    // (Would need to track multipart upload IDs)

    // Delete from KV
    await env.RATE_LIMIT_KV.delete(`media:${mediaId}`);
    deleted++;
  }

  // Update user's media list
  const userMediaKey = `user:media:${userId}`;
  const userMedia = await env.RATE_LIMIT_KV.get(userMediaKey, { type: 'json' }) as string[] || [];
  const updatedMedia = userMedia.filter(id => !mediaIds.includes(id));
  await env.RATE_LIMIT_KV.put(userMediaKey, JSON.stringify(updatedMedia));

  return c.json({
    success: true,
    data: { deleted, failed },
  });
});

// Helper functions
function getMediaType(mimeType: string): MediaAsset['type'] {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  return 'image'; // default
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

async function createPresignedPutUrl(bucket: R2Bucket, key: string, contentType: string, expirySeconds: number): Promise<string> {
  // R2 presigned PUT URL
  // Note: In production, use @aws-sdk/s3-request-presigner or similar
  // For Cloudflare Workers, we can use the built-in R2 presigned URL generation
  // This is a simplified version - actual implementation needs proper signing

  const url = new URL(`https://${bucket.name}.r2.cloudflarestorage.com/${key}`);
  url.searchParams.set('X-Amz-Algorithm', 'AWS4-HMAC-SHA256');
  url.searchParams.set('X-Amz-Credential', `${env.R2_ACCESS_KEY_ID}/${getDateString()}/auto/s3/aws4_request`);
  url.searchParams.set('X-Amz-Date', getAmzDate());
  url.searchParams.set('X-Amz-Expires', expirySeconds.toString());
  url.searchParams.set('X-Amz-SignedHeaders', 'host;x-amz-content-sha256');
  // Signature would be computed here

  // For now, return a direct upload URL pattern (would need proper implementation)
  return `https://${bucket.name}.r2.cloudflarestorage.com/${key}?upload=true`;
}

async function createPresignedGetUrl(bucket: R2Bucket, key: string, expirySeconds: number): Promise<string> {
  // Similar to PUT but for GET
  return `https://${bucket.name}.r2.cloudflarestorage.com/${key}?download=true`;
}

async function completeMultipartUpload(bucket: R2Bucket, key: string, uploadId: string, parts: CompletedPart[]): Promise<void> {
  // R2 multipart complete - would use AWS SDK
  // This is a placeholder
  console.log('[MEDIA] Complete multipart:', { key, uploadId, parts: parts.length });
}

function getDateString(): string {
  return new Date().toISOString().slice(0, 10).replace(/-/g, '');
}

function getAmzDate(): string {
  return new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
}

// Need to import CompletedPart
interface CompletedPart {
  partNumber: number;
  etag: string;
}

// Need to import env for R2_ACCESS_KEY_ID
declare const env: Env;