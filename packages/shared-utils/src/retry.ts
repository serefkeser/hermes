// Retry utilities

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitterMs?: number;
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
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
    shouldRetry = (error) => {
      // Don't retry on client errors (4xx)
      if (error instanceof Response) {
        return error.status >= 500 || error.status === 429;
      }
      if (error && typeof error === 'object' && 'status' in error) {
        const status = (error as { status: number }).status;
        return status >= 500 || status === 429;
      }
      return true; // Retry on network errors, unknown errors
    },
    onRetry,
  } = options;

  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt === maxAttempts - 1 || !shouldRetry(error, attempt)) {
        break;
      }

      const delay = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs);
      const jitter = Math.random() * jitterMs;
      const totalDelay = delay + jitter;

      if (onRetry) {
        onRetry(error, attempt + 1, totalDelay);
      }

      await new Promise(r => setTimeout(r, totalDelay));
    }
  }

  throw lastError;
}

export function createRetryWrapper<T extends (...args: unknown[]) => Promise<unknown>>(
  fn: T,
  options: RetryOptions = {}
): T {
  return (async (...args: unknown[]) => {
    return withRetry(() => fn(...args), options);
  }) as T;
}

// Specific retry strategies
export const retryStrategies = {
  // For external API calls (Gemini, etc.)
  api: {
    maxAttempts: 5,
    baseDelayMs: 1000,
    maxDelayMs: 30000,
    jitterMs: 500,
    shouldRetry: (error: unknown) => {
      if (error instanceof Response) {
        return error.status >= 500 || error.status === 429;
      }
      if (error && typeof error === 'object' && 'status' in error) {
        const status = (error as { status: number }).status;
        return status >= 500 || status === 429;
      }
      // Retry on network errors
      if (error instanceof TypeError && error.message.includes('fetch')) {
        return true;
      }
      return true;
    },
  },

  // For database operations
  database: {
    maxAttempts: 3,
    baseDelayMs: 500,
    maxDelayMs: 5000,
    jitterMs: 200,
    shouldRetry: (error: unknown) => {
      // Retry on connection errors, timeouts
      if (error instanceof Error) {
        return error.message.includes('connection') ||
               error.message.includes('timeout') ||
               error.message.includes('ECONNREFUSED');
      }
      return false;
    },
  },

  // For R2 storage operations
  storage: {
    maxAttempts: 3,
    baseDelayMs: 1000,
    maxDelayMs: 10000,
    jitterMs: 500,
    shouldRetry: (error: unknown) => {
      if (error instanceof Response) {
        return error.status >= 500 || error.status === 429;
      }
      if (error instanceof Error) {
        return error.message.includes('network') ||
               error.message.includes('timeout');
      }
      return true;
    },
  },

  // For video rendering (longer delays, fewer attempts)
  rendering: {
    maxAttempts: 2,
    baseDelayMs: 5000,
    maxDelayMs: 60000,
    jitterMs: 2000,
    shouldRetry: (error: unknown) => {
      if (error instanceof Error) {
        return error.message.includes('memory') ||
               error.message.includes('timeout') ||
               error.message.includes('FFmpeg');
      }
      return false;
    },
  },
} as const;

export type RetryStrategyKey = keyof typeof retryStrategies;