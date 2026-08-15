// Authentication middleware
import type { Env } from '../worker-configuration';
import { verifyAccessToken } from '@otonom/shared-utils';

export function authMiddleware() {
  return async (c: any, next: any) => {
    const env = c.env;
    const authHeader = c.req.header('Authorization');

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return c.json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Yetkilendirme gerekli. Bearer token sağlayın.',
        },
      }, 401);
    }

    const token = authHeader.substring(7); // Remove 'Bearer '

    try {
      const payload = await verifyAccessToken(token);

      if (!payload) {
        return c.json({
          success: false,
          error: {
            code: 'TOKEN_EXPIRED',
            message: 'Token geçersiz veya süresi dolmuş.',
          },
        }, 401);
      }

      // Set user info in context
      c.set('userId', payload.sub);
      c.set('userEmail', payload.email);
      c.set('userPlan', payload.plan);

      await next();
    } catch (error) {
      console.error('[AUTH] Verification error:', error);
      return c.json({
        success: false,
        error: {
          code: 'AUTH_ERROR',
          message: 'Kimlik doğrulama hatası.',
        },
      }, 401);
    }
  };
}

// Optional auth - doesn't fail if no token
export function optionalAuthMiddleware() {
  return async (c: any, next: any) => {
    const env = c.env;
    const authHeader = c.req.header('Authorization');

    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      try {
        const payload = await verifyAccessToken(token);
        if (payload) {
          c.set('userId', payload.sub);
          c.set('userEmail', payload.email);
          c.set('userPlan', payload.plan);
        }
      } catch {
        // Ignore errors, continue without auth
      }
    }

    await next();
  };
}