import { describe, expect, it } from 'vitest';
import type { MediaFile } from '@otonom/shared-types';
import { selectAnalysisMedia, settleLocalOcr, shouldRetryWithLocalOcr } from './aiInputPolicy';

function image(id: string, name: string, url: string): MediaFile {
  return { id, name, url, type: 'image', mimeType: 'image/jpeg', size: 0 };
}

describe('AI input policy', () => {
  it('3.14.35 logundaki aynı Fanatik sayfasının data-url ve remote-url kopyasını tek görsele indirir', () => {
    const selected = selectAnalysisMedia([
      image('data-copy', 'Fanatik.jpg', 'data:image/jpeg;base64,AA=='),
      image('remote-copy', 'Fanatik.jpg', 'https://example.test/fanatik.jpg'),
    ], 'gazete');

    expect(selected.map(item => item.id)).toEqual(['data-copy']);
  });

  it('görsel sağlayıcılar düşse bile hazır yerel OCR metnini text-only analizde yeniden dener', () => {
    expect(shouldRetryWithLocalOcr('local-fallback', 1, 'OCR TAM METİN:\nFanatik başlıkları')).toBe(true);
    expect(shouldRetryWithLocalOcr('gemini', 1, 'OCR metni')).toBe(false);
  });

  it('3.14.36 logundaki OCR Failed to fetch hatası hazır vision görselini engellemez', async () => {
    await expect(settleLocalOcr(Promise.reject(new TypeError('Failed to fetch')))).resolves.toEqual({
      text: '',
      error: 'Failed to fetch',
    });
  });
});
