// Error handler middleware
import type { Env } from '../worker-configuration';
import { HTTPException } from 'hono/http-exception';
import { handleError, isAppError } from '@otonom/shared-utils';

export function errorHandler(err: Error, c: any) {
  const requestId = c.get('requestId') || 'unknown';
  const startTime = c.get('startTime') || Date.now();
  const duration = Date.now() - startTime;

  // Log error with context
  console.error(`[ERROR] [${requestId}] ${err.message}`, {
    path: c.req.path,
    method: c.req.method,
    duration: `${duration}ms`,
    stack: err.stack,
    userId: c.get('userId'),
  });

  // Handle Hono HTTP exceptions
  if (err instanceof HTTPException) {
    return c.json({
      success: false,
      error: {
        code: 'HTTP_ERROR',
        message: err.message,
        statusCode: err.status,
      },
    }, err.status);
  }

  // Handle custom AppErrors
  if (isAppError(err)) {
    return c.json({
      success: false,
      error: err.toApiError(),
    }, err.statusCode);
  }

  // Handle validation errors (Zod, etc.)
  if (err.name === 'ZodError') {
    return c.json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Geçersiz istek verisi',
        details: { issues: err.errors },
      },
    }, 400);
  }

  // Generic internal error
  const { error, statusCode } = handleError(err);

  return c.json({
    success: false,
    error: {
      ...error,
      requestId,
    },
  }, statusCode);
}