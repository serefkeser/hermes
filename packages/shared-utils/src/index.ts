// Shared utilities for OTONOM microservices
// Common helpers: crypto, validation, formatting, error handling, etc.

import { SignJWT, jwtVerify } from 'jose';
import { PLAN_LIMITS } from '@otonom/shared-config';
import type { JwtPayload, ApiError, RateLimitInfo, UserPlan } from '@otonom/shared-types';

// ============================================================================
// CRYPTO / JWT UTILITIES
// ============================================================================

let _jwtSecret: Uint8Array | null = null;

export function getJwtSecret(): Uint8Array {
  if (!_jwtSecret) {
    const secret = process.env.JWT_SECRET;
    if (!secret || secret.length < 32) {
      throw new Error('JWT_SECRET must be at least 32 characters');
    }
    _jwtSecret = new TextEncoder().encode(secret);
  }
  return _jwtSecret;
}

export async function createAccessToken(
  payload: Omit<JwtPayload, 'type' | 'iat' | 'exp'>,
  expiresInSeconds = 900 // 15 minutes
): Promise<string> {
  const secret = getJwtSecret();
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ ...payload, type: 'access' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt(now)
    .setExpirationTime(now + expiresInSeconds)
    .sign(secret);
}

export async function createRefreshToken(
  payload: Omit<JwtPayload, 'type' | 'iat' | 'exp'>,
  expiresInSeconds = 604800 // 7 days
): Promise<string> {
  const secret = getJwtSecret();
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ ...payload, type: 'refresh' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt(now)
    .setExpirationTime(now + expiresInSeconds)
    .sign(secret);
}

export async function verifyToken(token: string): Promise<JwtPayload | null> {
  try {
    const secret = getJwtSecret();
    const { payload } = await jwtVerify(token, secret);
    return payload as unknown as JwtPayload;
  } catch {
    return null;
  }
}

export async function verifyAccessToken(token: string): Promise<JwtPayload | null> {
  const payload = await verifyToken(token);
  if (!payload || payload.type !== 'access') return null;
  return payload;
}

export async function verifyRefreshToken(token: string): Promise<JwtPayload | null> {
  const payload = await verifyToken(token);
  if (!payload || payload.type !== 'refresh') return null;
  return payload;
}

export async function generateApiKey(): Promise<string> {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const base64 = btoa(String.fromCharCode(...bytes));
  return `otn_${base64.replace(/[+/=]/g, '').substring(0, 32)}`;
}

// ============================================================================
// PASSWORD HASHING (using Web Crypto API)
// ============================================================================

export async function hashPassword(password: string, rounds = 12): Promise<string> {
  const encoder = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  const hash = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations: 10000 * rounds,
      hash: 'SHA-256',
    },
    keyMaterial,
    256
  );
  const hashArray = new Uint8Array(hash);
  const combined = new Uint8Array(salt.length + hashArray.length);
  combined.set(salt);
  combined.set(hashArray, salt.length);
  return btoa(String.fromCharCode(...combined));
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  try {
    const combined = Uint8Array.from(atob(hash), c => c.charCodeAt(0));
    const salt = combined.slice(0, 16);
    const storedHash = combined.slice(16);

    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      encoder.encode(password),
      { name: 'PBKDF2' },
      false,
      ['deriveBits']
    );
    const hashBuffer = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt,
        iterations: 10000 * 12,
        hash: 'SHA-256',
      },
      keyMaterial,
      256
    );
    const computedHash = new Uint8Array(hashBuffer);
    return computedHash.length === storedHash.length &&
      computedHash.every((v, i) => v === storedHash[i]);
  } catch {
    return false;
  }
}

// ============================================================================
// VALIDATION UTILITIES
// ============================================================================

export function validateEmail(email: string): boolean {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email) && email.length <= 254;
}

export function validatePassword(password: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (password.length < 8) errors.push('En az 8 karakter');
  if (password.length > 128) errors.push('En fazla 128 karakter');
  if (!/[A-Z]/.test(password)) errors.push('En az 1 büyük harf');
  if (!/[a-z]/.test(password)) errors.push('En az 1 küçük harf');
  if (!/[0-9]/.test(password)) errors.push('En az 1 rakam');
  if (!/[^A-Za-z0-9]/.test(password)) errors.push('En az 1 özel karakter');
  return { valid: errors.length === 0, errors };
}

export function validateUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export function sanitizeFilename(filename: string): string {
  return filename
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove diacritics
    .replace(/[^a-zA-Z0-9\s._-]/g, '') // Keep only alphanumeric, space, dot, underscore, hyphen
    .replace(/\s+/g, '_') // Spaces to underscores
    .substring(0, 200);
}

export function sanitizeText(text: string): string {
  if (!text || typeof text !== 'string') return '';
  return text
    .replace(/<[^>]*>/g, '') // HTML tags
    .replace(/javascript:/gi, '')
    .replace(/on\w+\s*=/gi, '')
    .replace(/data:/gi, '')
    .replace(/vbscript:/gi, '')
    .replace(/&#\d+;/g, '')
    .replace(/&#x[0-9a-f]+;/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ============================================================================
// FORMATTING UTILITIES
// ============================================================================

export function formatBytes(bytes: number, decimals = 1): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(decimals))} ${sizes[i]}`;
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}sn`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}dk ${Math.round(seconds % 60)}sn`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}sa ${minutes}dk`;
}

export function formatDate(timestamp: number, locale = 'tr-TR'): string {
  return new Date(timestamp).toLocaleDateString(locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export function formatDateTime(timestamp: number, locale = 'tr-TR'): string {
  return new Date(timestamp).toLocaleString(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatRelativeTime(timestamp: number, locale = 'tr-TR'): string {
  const diff = Date.now() - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return 'az önce';
  if (minutes < 60) return `${minutes} dakika önce`;
  if (hours < 24) return `${hours} saat önce`;
  if (days < 7) return `${days} gün önce`;
  return formatDate(timestamp, locale);
}

export function formatNumber(num: number, locale = 'tr-TR'): string {
  return new Intl.NumberFormat(locale).format(num);
}

export function formatPercent(value: number, decimals = 1, locale = 'tr-TR'): string {
  return `${value.toFixed(decimals)}%`;
}

// ============================================================================
// RATE LIMITING
// ============================================================================

const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

export function checkRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number
): { allowed: boolean; info: RateLimitInfo } {
  const now = Date.now();
  const record = rateLimitStore.get(key);

  if (!record || now > record.resetAt) {
    rateLimitStore.set(key, { count: 1, resetAt: now + windowMs });
    return {
      allowed: true,
      info: { limit: maxRequests, remaining: maxRequests - 1, resetAt: now + windowMs },
    };
  }

  if (record.count >= maxRequests) {
    return {
      allowed: false,
      info: {
        limit: maxRequests,
        remaining: 0,
        resetAt: record.resetAt,
        retryAfter: Math.ceil((record.resetAt - now) / 1000),
      },
    };
  }

  record.count++;
  return {
    allowed: true,
    info: { limit: maxRequests, remaining: maxRequests - record.count, resetAt: record.resetAt },
  };
}

export function clearRateLimit(key: string): void {
  rateLimitStore.delete(key);
}

// Cleanup old entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of rateLimitStore.entries()) {
    if (now > record.resetAt) rateLimitStore.delete(key);
  }
}, 60_000);

// ============================================================================
// ERROR HANDLING
// ============================================================================

export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode = 400,
    public details?: Record<string, unknown>,
    public recoverable = false
  ) {
    super(message);
    this.name = 'AppError';
  }

  toApiError(): ApiError {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
    };
  }

  static validation(message: string, details?: Record<string, unknown>): AppError {
    return new AppError('VALIDATION_ERROR', message, 400, details, true);
  }

  static unauthorized(message = 'Yetkisiz erişim'): AppError {
    return new AppError('UNAUTHORIZED', message, 401, undefined, false);
  }

  static forbidden(message = 'Yasaklı erişim'): AppError {
    return new AppError('FORBIDDEN', message, 403, undefined, false);
  }

  static notFound(resource = 'Kaynak'): AppError {
    return new AppError('NOT_FOUND', `${resource} bulunamadı`, 404, undefined, false);
  }

  static conflict(message: string, details?: Record<string, unknown>): AppError {
    return new AppError('CONFLICT', message, 409, details, true);
  }

  static rateLimited(retryAfter: number): AppError {
    return new AppError('RATE_LIMITED', 'Çok fazla istek', 429, { retryAfter }, true);
  }

  static internal(message = 'Sunucu hatası', details?: Record<string, unknown>): AppError {
    return new AppError('INTERNAL_ERROR', message, 500, details, false);
  }

  static serviceUnavailable(message = 'Servis geçici olarak kullanılamıyor'): AppError {
    return new AppError('SERVICE_UNAVAILABLE', message, 503, undefined, true);
  }

  static timeout(message = 'İşlem zaman aşımına uğradı'): AppError {
    return new AppError('TIMEOUT', message, 504, undefined, true);
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

export function handleError(error: unknown): { error: ApiError; statusCode: number } {
  if (isAppError(error)) {
    return { error: error.toApiError(), statusCode: error.statusCode };
  }
  if (error instanceof Error) {
    console.error('[ERROR]', error.message, error.stack);
    return {
      error: { code: 'INTERNAL_ERROR', message: 'Beklenmeyen bir hata oluştu' },
      statusCode: 500,
    };
  }
  return {
    error: { code: 'UNKNOWN_ERROR', message: 'Bilinmeyen hata' },
    statusCode: 500,
  };
}

// ============================================================================
// UUID / ID GENERATION
// ============================================================================

export function generateId(prefix = ''): string {
  const uuid = crypto.randomUUID();
  return prefix ? `${prefix}_${uuid}` : uuid;
}

export function generateShortId(length = 8): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, b => chars[b % chars.length]).join('');
}

export function generateJobId(): string {
  return `job_${Date.now()}_${generateShortId(6)}`;
}

export function generateMediaId(): string {
  return `med_${Date.now()}_${generateShortId(8)}`;
}

// ============================================================================
// OBJECT URL MANAGEMENT (for frontend)
// ============================================================================

export class ObjectURLManager {
  private static _urls = new Set<string>();

  static create(blob: Blob): string {
    const url = URL.createObjectURL(blob);
    this._urls.add(url);
    return url;
  }

  static revoke(url: string): void {
    if (url && this._urls.has(url)) {
      URL.revokeObjectURL(url);
      this._urls.delete(url);
    } else if (url) {
      URL.revokeObjectURL(url);
    }
  }

  static revokeAll(): void {
    this._urls.forEach(u => URL.revokeObjectURL(u));
    this._urls.clear();
  }
}

// ============================================================================
// RETRY / BACKOFF
// ============================================================================

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitterMs?: number;
  shouldRetry?: (error: unknown) => boolean;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    baseDelayMs = 1000,
    maxDelayMs = 30000,
    jitterMs = 500,
    shouldRetry = () => true,
  } = options;

  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts - 1 || !shouldRetry(error)) break;

      const delay = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs);
      const jitter = Math.random() * jitterMs;
      await new Promise(r => setTimeout(r, delay + jitter));
    }
  }

  throw lastError;
}

// ============================================================================
// PLAN LIMIT HELPERS
// ============================================================================

export function getPlanLimits(plan: UserPlan) {
  return PLAN_LIMITS[plan] || PLAN_LIMITS.free;
}

export function checkPlanLimit(
  plan: UserPlan,
  limitType: keyof typeof import('@otonom/shared-config').PLAN_LIMITS.free,
  currentUsage: number
): { allowed: boolean; limit: number; remaining: number } {
  const limits = getPlanLimits(plan);
  const limit = limits[limitType] as number;
  return {
    allowed: currentUsage < limit,
    limit,
    remaining: Math.max(0, limit - currentUsage),
  };
}

// ============================================================================
// ENVIRONMENT HELPERS
// ============================================================================

export function getEnv(key: string, defaultValue?: string): string {
  const value = process.env[key];
  if (value === undefined) {
    if (defaultValue !== undefined) return defaultValue;
    throw new Error(`Environment variable ${key} is required`);
  }
  return value;
}

export function getEnvNumber(key: string, defaultValue?: number): number {
  const value = getEnv(key, defaultValue?.toString());
  const parsed = Number(value);
  if (isNaN(parsed)) {
    throw new Error(`Environment variable ${key} must be a number`);
  }
  return parsed;
}

export function getEnvBoolean(key: string, defaultValue = false): boolean {
  const value = getEnv(key, defaultValue.toString());
  return value === 'true' || value === '1';
}

export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

export function isDevelopment(): boolean {
  return process.env.NODE_ENV === 'development';
}

export interface SystemLogEntry {
  timestamp: string;
  type: 'info' | 'success' | 'warn' | 'error';
  text: string;
}

const systemLogListeners = new Set<(entry: SystemLogEntry) => void>();

export function addSystemLog(listener: (entry: SystemLogEntry) => void): () => void {
  systemLogListeners.add(listener);
  return () => systemLogListeners.delete(listener);
}

export function writeSystemLog(text: string, type: SystemLogEntry['type'] = 'info'): void {
  const entry = { timestamp: new Date().toLocaleTimeString('tr-TR'), type, text };
  systemLogListeners.forEach(listener => listener(entry));
}

export const SafeStorage = {
  getItem(key: string): string | null {
    try { return globalThis.localStorage?.getItem(key) ?? null; } catch { return null; }
  },
  setItem(key: string, value: string): void {
    try { globalThis.localStorage?.setItem(key, value); } catch { /* storage unavailable */ }
  },
  removeItem(key: string): void {
    try { globalThis.localStorage?.removeItem(key); } catch { /* storage unavailable */ }
  },
};

// ============================================================================
// EXPORTS
// ============================================================================

export * from './date';
export * from './media';
export * from './queue';
export * from './publicationSafety';
