// Media Storage Service - R2 proxy for file operations
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from './worker-configuration';

interface Env {
  MEDIA_BUCKET: R2Bucket;
  RATE_LIMIT_KV: KVNamespace;
  JWT_SECRET: string;
  ENVIRONMENT: string;
  CORS_ORIGIN: string;
}

const app = new Hono<{ Bindings: Env }>();

app.use('*', cors({
  origin: (origin, c) => {
    const allowed = [c.env.CORS_ORIGIN, 'http://localhost:3000', 'http://127.0.0.1:3000'];
    return allowed.includes(origin || '') ? origin || allowed[0] : allowed[0];
  },
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  credentials: true,
}));

app.use('*', async (c, next) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Token gerekli' } }, 401);
  }
  // Verify token would go here
  await next();
});

// Direct upload (for small files)
app.post('/upload', async (c) => {
  const env = c.env;
  const body = await c.req.parseBody();
  const file = body.file as File;

  if (!file) {
    return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Dosya gerekli' } }, 400);
  }

  const maxSize = 100 * 1024 * 1024;
  if (file.size > maxSize) {
    return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Dosya çok büyük' } }, 400);
  }

  const key = `uploads/${Date.now()}_${file.name}`;
  await env.MEDIA_BUCKET.put(key, file.stream(), {
    httpMetadata: { contentType: file.type },
    customMetadata: { originalName: file.name },
  });

  return c.json({
    success: true,
    data: { key, url: `https://${env.MEDIA_BUCKET.name}.r2.dev/${key}` },
  });
});

// Get file
app.get('/:key', async (c) => {
  const env = c.env;
  const key = c.req.param('key');

  const object = await env.MEDIA_BUCKET.get(key);
  if (!object) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Dosya bulunamadı' } }, 404);
  }

  return new Response(object.body, {
    headers: {
      'Content-Type': object.httpMetadata?.contentType || 'application/octet-stream',
      'Cache-Control': 'public, max-age=31536000',
    },
  });
});

// Delete file
app.delete('/:key', async (c) => {
  const env = c.env;
  const key = c.req.param('key');

  await env.MEDIA_BUCKET.delete(key);

  return c.json({ success: true, data: { message: 'Silindi' } });
});

// List files
app.get('/', async (c) => {
  const env = c.env;
  const prefix = c.req.query('prefix') || 'uploads/';
  const limit = parseInt(c.req.query('limit') || '100', 10);

  const objects = await env.MEDIA_BUCKET.list({ prefix, limit });

  return c.json({
    success: true,
    data: objects.objects.map(obj => ({
      key: obj.key,
      size: obj.size,
      uploaded: obj.uploaded,
      url: `https://${env.MEDIA_BUCKET.name}.r2.dev/${obj.key}`,
    })),
  });
});

export default app;