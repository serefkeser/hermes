import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateWithFallback, getConfiguredProviders, synthesizeSpeech } from './providerRouter';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('AI provider fallback', () => {
  it('HTTP 200 ama bozuk JSON döndüren sağlayıcıdan sonraki ücretsiz sağlayıcıya geçer', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: 'JSON hazırlıyorum, birazdan...' } }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: '{"videoSlides":[{"topText":"OK","spokenText":"Hazır.","imagePrompts":[]}]}' } }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await generateWithFallback({
      ENVIRONMENT: 'production',
      GROQ_API_KEY: 'groq-test',
      OPENCODE_API_KEY: 'opencode-test',
    }, {
      task: 'text',
      messages: [{ role: 'user', content: 'Haber oluştur.' }],
      responseFormat: 'json',
      validateResponse: text => {
        if (!text.includes('videoSlides')) throw new Error('geçersiz JSON');
      },
    });

    expect(result.provider).toBe('opencode');
    expect(result.attempts).toEqual([
      expect.objectContaining({ provider: 'groq', ok: false, reason: 'geçersiz JSON' }),
      expect.objectContaining({ provider: 'opencode', ok: true }),
    ]);
  });

  it('Groq hız sınırına takıldığında OpenCode yedeğine geçer', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('rate limited', { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: '{"videoSlides":[]}' } }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await generateWithFallback({
      ENVIRONMENT: 'production',
      GROQ_API_KEY: 'groq-test',
      OPENCODE_API_KEY: 'opencode-test',
    }, {
      task: 'text',
      messages: [{ role: 'user', content: 'Bir haber senaryosu oluştur.' }],
      responseFormat: 'json',
    });

    expect(result.provider).toBe('opencode');
    expect(result.attempts).toEqual([
      expect.objectContaining({ provider: 'groq', ok: false, status: 429 }),
      expect.objectContaining({ provider: 'opencode', ok: true }),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('görsel görevinde metin-only OpenCode sağlayıcısını çağırmaz', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: '{"videoSlides":[]}' } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await generateWithFallback({
      ENVIRONMENT: 'production',
      OPENCODE_API_KEY: 'opencode-test',
      GROQ_API_KEY: 'groq-test',
      AI_VISION_PROVIDER_ORDER: 'opencode,groq',
    }, {
      task: 'vision',
      messages: [{
        role: 'user',
        content: [{ type: 'image', mimeType: 'image/png', data: 'AA==' }],
      }],
    });

    expect(result.provider).toBe('groq');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('NVIDIA deneme uçlarını production ortamında varsayılan olarak kapatır', () => {
    expect(getConfiguredProviders({
      ENVIRONMENT: 'production',
      NVIDIA_API_KEY: 'nvidia-test',
    })).toEqual(expect.objectContaining({
      nvidia: false,
      nvidiaTrialAllowed: false,
    }));
  });

  it('OpenRouter free router ile görsel fallback yapar', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: '{"videoSlides":[]}' } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await generateWithFallback({
      ENVIRONMENT: 'production',
      OPENROUTER_API_KEY: 'openrouter-test',
    }, {
      task: 'vision',
      messages: [{
        role: 'user',
        content: [{ type: 'image', mimeType: 'image/png', data: 'AA==' }],
      }],
      responseFormat: 'json',
    });

    expect(result.provider).toBe('openrouter');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/chat/completions',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('gazete görsel analizine 20 saniye yerine 60 saniye çalışma süresi tanır', async () => {
    vi.useFakeTimers();
    let aborted = false;
    vi.stubGlobal('fetch', vi.fn((_input: unknown, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        aborted = true;
        reject(new DOMException('Aborted', 'AbortError'));
      });
    })));

    const pending = generateWithFallback({
      ENVIRONMENT: 'production',
      GEMINI_API_KEY: 'gemini-test',
      AI_VISION_PROVIDER_ORDER: 'gemini',
    }, {
      task: 'vision',
      messages: [{ role: 'user', content: [{ type: 'image', mimeType: 'image/jpeg', data: 'AA==' }] }],
    });
    const rejection = expect(pending).rejects.toThrow('60 saniyede yanıt vermedi');

    await vi.advanceTimersByTimeAsync(20_000);
    expect(aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(40_000);
    await rejection;
  });

  it('ZenMux ücretli fallbackini açık izin olmadan etkinleştirmez', () => {
    expect(getConfiguredProviders({
      ENVIRONMENT: 'production',
      ZENMUX_API_KEY: 'zenmux-test',
    })).toEqual(expect.objectContaining({
      zenmux: false,
      zenmuxPaidAllowed: false,
    }));
  });
});

describe('Gemini TTS', () => {
  it('Aoede PCM ses verisini döndürür', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ inlineData: {
        data: 'UENN',
        mimeType: 'audio/L16;codec=pcm;rate=24000',
      } }] } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));

    const result = await synthesizeSpeech({ GEMINI_API_KEY: 'gemini-test' }, 'Merhaba', 'Aoede');

    expect(result).toEqual(expect.objectContaining({
      provider: 'gemini',
      audioData: 'UENN',
      sampleRate: 24000,
    }));
  });
});
