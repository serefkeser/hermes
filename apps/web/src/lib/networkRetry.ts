const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

export const NETWORK_RETRY_DELAYS_MS = [800, 2_000, 4_000] as const;

export function isRetryableHttpStatus(status: number) {
  return RETRYABLE_STATUS.has(status);
}

export function describeNetworkFailure(error: unknown, endpoint: string) {
  const detail = error instanceof Error ? error.message : String(error || 'bilinmeyen ağ hatası');
  return `OTONOM API bağlantısı kurulamadı (${endpoint}). İnternet/Worker/CORS bağlantısını kontrol edin. Teknik ayrıntı: ${detail}`;
}

export async function fetchWithNetworkRetry(
  input: RequestInfo | URL,
  init: RequestInit,
  options: {
    endpoint: string;
    onRetry?: (attempt: number, delayMs: number, reason: string) => void;
    delaysMs?: readonly number[];
  },
) {
  const delays = options.delaysMs ?? NETWORK_RETRY_DELAYS_MS;
  let lastError: unknown;

  for (let attempt = 0; attempt <= delays.length; attempt += 1) {
    try {
      const response = await fetch(input, init);
      if (!isRetryableHttpStatus(response.status) || attempt === delays.length) return response;
      const delayMs = delays[attempt];
      options.onRetry?.(attempt + 1, delayMs, `HTTP ${response.status}`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    } catch (error) {
      lastError = error;
      if (attempt === delays.length) break;
      const delayMs = delays[attempt];
      options.onRetry?.(
        attempt + 1,
        delayMs,
        error instanceof Error ? error.message : String(error),
      );
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  throw new Error(describeNetworkFailure(lastError, options.endpoint));
}
