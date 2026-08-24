import { afterEach, describe, expect, it, vi } from 'vitest';
import { musicRoutes, NEWS_MUSIC } from './music';

afterEach(() => vi.restoreAllMocks());

describe('Google Drive automatic news music', () => {
  it('returns only the verified news-music catalog', async () => {
    const response = await musicRoutes.request('/catalog');
    const payload = await response.json() as { data: { tracks: Array<{ id: string; mimeType: string }> } };
    expect(response.status).toBe(200);
    expect(payload.data.tracks).toHaveLength(12);
    expect(payload.data.tracks.every(track => track.mimeType === 'audio/mpeg')).toBe(true);
  });

  it('proxies an allow-listed Drive track and rejects arbitrary ids', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: { 'Content-Type': 'audio/mpeg' },
    }));
    const allowed = await musicRoutes.request(`/${NEWS_MUSIC[0][0]}`);
    const blocked = await musicRoutes.request('/not-allowed');
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get('Content-Type')).toBe('audio/mpeg');
    expect(blocked.status).toBe(404);
  });
});
