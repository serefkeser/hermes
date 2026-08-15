// Auth routes - Register, Login, Refresh, Logout, Me
import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../worker-configuration';
import { createAccessToken, createRefreshToken, verifyRefreshToken, hashPassword, verifyPassword, generateId } from '@otonom/shared-utils';
import { AppError } from '@otonom/shared-utils';

export const authRoutes = new Hono<{ Bindings: Env }>();

// Validation schemas
const registerSchema = z.object({
  email: z.string().email('Geçersiz e-posta'),
  password: z.string().min(8, 'En az 8 karakter').max(128, 'En fazla 128 karakter'),
  name: z.string().min(1, 'İsim gerekli').max(100, 'İsim çok uzun'),
});

const loginSchema = z.object({
  email: z.string().email('Geçersiz e-posta'),
  password: z.string().min(1, 'Şifre gerekli'),
  rememberMe: z.boolean().optional(),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token gerekli'),
});

// Register
authRoutes.post('/register', async (c) => {
  const env = c.env;
  const body = await c.req.json();

  const result = registerSchema.safeParse(body);
  if (!result.success) {
    throw new AppError('VALIDATION_ERROR', 'Geçersiz veri', 400, { issues: result.error.errors }, true);
  }

  const { email, password, name } = result.data;

  // Check if user exists (in KV or D1)
  // For now, we'll use a simple KV check
  const existingUser = await env.RATE_LIMIT_KV.get(`user:email:${email.toLowerCase()}`);
  if (existingUser) {
    throw new AppError('CONFLICT', 'Bu e-posta zaten kayıtlı', 409, undefined, true);
  }

  // Hash password
  const passwordHash = await hashPassword(password);

  // Create user
  const userId = generateId('usr');
  const user = {
    id: userId,
    email: email.toLowerCase(),
    name,
    passwordHash,
    plan: 'free' as const,
    emailVerified: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    settings: {
      language: 'tr',
      defaultVideoFormat: 'mp4',
      defaultAspectRatio: '9:16',
      narratorVoice: 'Aoede',
      backgroundMusicVolume: 0.29,
      notifications: {
        email: true,
        push: false,
        jobComplete: true,
        jobFailed: true,
        weeklyDigest: false,
      },
    },
  };

  // Store user (in production, use D1 or KV with proper indexing)
  await env.RATE_LIMIT_KV.put(`user:id:${userId}`, JSON.stringify(user));
  await env.RATE_LIMIT_KV.put(`user:email:${email.toLowerCase()}`, userId);

  // Generate tokens
  const accessToken = await createAccessToken({
    sub: userId,
    email: user.email,
    plan: user.plan,
  });

  const refreshToken = await createRefreshToken({
    sub: userId,
    email: user.email,
    plan: user.plan,
  });

  // Store refresh token (with expiry)
  await env.RATE_LIMIT_KV.put(`refresh:${refreshToken}`, userId, { expirationTtl: 604800 }); // 7 days

  // Return user without password
  const { passwordHash: _, ...userWithoutPassword } = user;

  return c.json({
    success: true,
    data: {
      user: userWithoutPassword,
      accessToken,
      refreshToken,
      expiresIn: 900,
      tokenType: 'Bearer',
    },
  }, 201);
});

// Login
authRoutes.post('/login', async (c) => {
  const env = c.env;
  const body = await c.req.json();

  const result = loginSchema.safeParse(body);
  if (!result.success) {
    throw new AppError('VALIDATION_ERROR', 'Geçersiz veri', 400, { issues: result.error.errors }, true);
  }

  const { email, password, rememberMe } = result.data;

  // Find user by email
  const userId = await env.RATE_LIMIT_KV.get(`user:email:${email.toLowerCase()}`);
  if (!userId) {
    throw new AppError('UNAUTHORIZED', 'E-posta veya şifre hatalı', 401, undefined, true);
  }

  const userData = await env.RATE_LIMIT_KV.get(`user:id:${userId}`);
  if (!userData) {
    throw new AppError('INTERNAL_ERROR', 'Kullanıcı verisi bulunamadı', 500);
  }

  const user = JSON.parse(userData);

  // Verify password
  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    throw new AppError('UNAUTHORIZED', 'E-posta veya şifre hatalı', 401, undefined, true);
  }

  // Generate tokens
  const accessTokenExpiry = rememberMe ? 2592000 : 900; // 30 days : 15 minutes
  const refreshTokenExpiry = rememberMe ? 2592000 : 604800; // 30 days : 7 days

  const accessToken = await createAccessToken({
    sub: user.id,
    email: user.email,
    plan: user.plan,
  }, accessTokenExpiry);

  const refreshToken = await createRefreshToken({
    sub: user.id,
    email: user.email,
    plan: user.plan,
  }, refreshTokenExpiry);

  // Store refresh token
  await env.RATE_LIMIT_KV.put(`refresh:${refreshToken}`, user.id, { expirationTtl: refreshTokenExpiry });

  // Update last login
  user.lastLoginAt = Date.now();
  await env.RATE_LIMIT_KV.put(`user:id:${user.id}`, JSON.stringify(user));

  // Return user without password
  const { passwordHash: _, ...userWithoutPassword } = user;

  return c.json({
    success: true,
    data: {
      user: userWithoutPassword,
      accessToken,
      refreshToken,
      expiresIn: accessTokenExpiry,
      tokenType: 'Bearer',
    },
  });
});

// Refresh token
authRoutes.post('/refresh', async (c) => {
  const env = c.env;
  const body = await c.req.json();

  const result = refreshSchema.safeParse(body);
  if (!result.success) {
    throw new AppError('VALIDATION_ERROR', 'Geçersiz veri', 400, { issues: result.error.errors }, true);
  }

  const { refreshToken } = result.data;

  // Verify refresh token
  const payload = await verifyRefreshToken(refreshToken);
  if (!payload) {
    throw new AppError('TOKEN_EXPIRED', 'Refresh token geçersiz veya süresi dolmuş', 401, undefined, true);
  }

  // Check if refresh token exists in KV
  const storedUserId = await env.RATE_LIMIT_KV.get(`refresh:${refreshToken}`);
  if (!storedUserId || storedUserId !== payload.sub) {
    throw new AppError('TOKEN_EXPIRED', 'Refresh token geçersiz', 401, undefined, true);
  }

  // Generate new tokens
  const accessToken = await createAccessToken({
    sub: payload.sub,
    email: payload.email,
    plan: payload.plan,
  });

  const newRefreshToken = await createRefreshToken({
    sub: payload.sub,
    email: payload.email,
    plan: payload.plan,
  });

  // Rotate refresh token (delete old, store new)
  await env.RATE_LIMIT_KV.delete(`refresh:${refreshToken}`);
  await env.RATE_LIMIT_KV.put(`refresh:${newRefreshToken}`, payload.sub, { expirationTtl: 604800 });

  return c.json({
    success: true,
    data: {
      accessToken,
      refreshToken: newRefreshToken,
      expiresIn: 900,
      tokenType: 'Bearer',
    },
  });
});

// Logout
authRoutes.post('/logout', async (c) => {
  const env = c.env;
  const authHeader = c.req.header('Authorization');

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    // We could blacklist the access token here if needed
    // For now, just remove refresh token if provided in body
    const body = await c.req.json().catch(() => ({}));
    if (body.refreshToken) {
      await env.RATE_LIMIT_KV.delete(`refresh:${body.refreshToken}`);
    }
  }

  return c.json({
    success: true,
    data: { message: 'Başarıyla çıkış yapıldı' },
  });
});

// Get current user
authRoutes.get('/me', async (c) => {
  const env = c.env;
  const userId = c.get('userId');

  if (!userId) {
    throw new AppError('UNAUTHORIZED', 'Yetkilendirme gerekli', 401);
  }

  const userData = await env.RATE_LIMIT_KV.get(`user:id:${userId}`);
  if (!userData) {
    throw new AppError('NOT_FOUND', 'Kullanıcı bulunamadı', 404);
  }

  const user = JSON.parse(userData);
  const { passwordHash: _, ...userWithoutPassword } = user;

  return c.json({
    success: true,
    data: { user: userWithoutPassword },
  });
});