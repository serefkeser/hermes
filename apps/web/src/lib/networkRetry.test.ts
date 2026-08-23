import { afterEach, describe, expect, it, vi } from 'vitest';
import { describeNetworkFailure, fetchWithNetworkRetry, isRetryableHttpStatus } from './networkRetry';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fetchWithNetworkRetry', () => {
  it('geçici Failed to fetch sonrasında isteği yeniden dener', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));

    const response = await fetchWithNetworkRetry('https://api.example.test/ai/analyze', {}, {
      endpoint: '/ai/analyze',
      delaysMs: [0],
    });

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('401 yanıtını yeniden denemez', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 401 }));
    const response = await fetchWithNetworkRetry('https://api.example.test/ai/analyze', {}, {
      endpoint: '/ai/analyze',
      delaysMs: [0, 0],
    });
    expect(response.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('kalıcı bağlantı hatasını Türkçe ve uç noktalı tanıya çevirir', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(fetchWithNetworkRetry('https://api.example.test/ai/tts', {}, {
      endpoint: '/ai/tts',
      delaysMs: [0],
    })).rejects.toThrow('OTONOM API bağlantısı kurulamadı (/ai/tts)');
  });
});

describe('network helpers', () => {
  it('yalnız geçici HTTP durumlarını yeniden denenebilir sayar', () => {
    expect(isRetryableHttpStatus(502)).toBe(true);
    expect(isRetryableHttpStatus(429)).toBe(true);
    expect(isRetryableHttpStatus(400)).toBe(false);
    expect(isRetryableHttpStatus(401)).toBe(false);
  });

  it('Failed to fetch ayrıntısını kaybetmez', () => {
    expect(describeNetworkFailure(new TypeError('Failed to fetch'), '/ai/analyze'))
      .toContain('Teknik ayrıntı: Failed to fetch');
  });
});
