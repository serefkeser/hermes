import { describe, expect, it } from 'vitest';
import { buildVerifiedCoverHook, groundedNewspaperHook, hasStrictOcrConsensus, selectStrictDetailLines } from './newspaperVerification';

describe('strict newspaper evidence verification', () => {
  it('Trabzonspor skorunu yalnız iki OCR okuması birebir doğrularsa kabul eder', () => {
    const source = 'Trabzonspor Kasımpaşa ile 1-1 berabere kaldı';
    expect(hasStrictOcrConsensus(source, source, 91, 88)).toBe(true);
    expect(hasStrictOcrConsensus(source, 'Trabzonspor Kasımpaşa karşısında 2-1 mağlup oldu', 91, 90)).toBe(false);
    expect(hasStrictOcrConsensus(source, 'Talisca 58. dakikada galibiyeti getirdi', 91, 90)).toBe(false);
  });

  it('komşu sütundaki Talisca haberini Trabzonspor ayrıntısına karıştırmaz', () => {
    const headline = { x0: 100, y0: 20, x1: 260, y1: 60, width: 160, height: 40 };
    const selected = selectStrictDetailLines(headline, [
      { text: 'Trabzonspor Kasımpaşa ile 1-1 berabere kaldı', confidence: 88, x0: 105, y0: 65, x1: 255, y1: 82, width: 150, height: 17 },
      { text: 'Talisca 58. dakikada galibiyeti getirdi', confidence: 94, x0: 245, y0: 66, x1: 410, y1: 84, width: 165, height: 18 },
    ]);
    expect(selected.map(line => line.text)).toEqual(['Trabzonspor Kasımpaşa ile 1-1 berabere kaldı']);
  });

  it('kanıtta bulunmayan clickbait kelimelerini kullanmaz', () => {
    expect(groundedNewspaperHook('Şok yenilgi geldi', 'Tatsız başlangıç')).toBe('Tatsız başlangıç');
    expect(groundedNewspaperHook('Tatsız başlangıç', 'Tatsız başlangıç')).toBe('Tatsız başlangıç');
    expect(buildVerifiedCoverHook('Türkiye Take-Off')).toBe('TÜRKİYE TAKE-OFF!');
  });
});
