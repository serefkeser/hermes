import { describe, expect, it, vi } from 'vitest';
import { socialRoutes } from './social';

describe('social publish safety gate', () => {
  it('riskli açıklamayı R2 yüklemesinden ve Buffer çağrısından önce durdurur', async () => {
    const put = vi.fn();
    const response = await socialRoutes.request('https://api.example/publish', {
      method: 'POST',
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': '3',
        'X-OTONOM-Caption': encodeURIComponent('Onu öldürün.'),
        'X-OTONOM-Filename': encodeURIComponent('video.mp4'),
      },
      body: new Uint8Array([1, 2, 3]),
    }, {
      ENVIRONMENT: 'test',
      BUFFER_API_KEY: 'test-key',
      SOCIAL_MEDIA_BUCKET: { put } as unknown as R2Bucket,
    });

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: { code: 'PUBLICATION_SAFETY_BLOCKED' },
    });
    expect(put).not.toHaveBeenCalled();
  });
});
