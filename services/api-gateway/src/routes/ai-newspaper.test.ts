import { describe, expect, it } from 'vitest';
import { normalizeNewspaperScript } from './ai';

describe('AI newspaper normalization', () => {
  it('yerel OCR adayları senaryoyu kilitlerken tam görsel haber önerilerini kurtarma için korur', () => {
    const visionHeadlines = Array.from({ length: 5 }, (_, index) => ({
      sourceHeadlineId: `V${index + 1}`,
      baslik: `Tam görsel başlığı ${index + 1}`,
      aciklama: `Tam görselde basılı açıklama cümlesi ${index + 1}.`,
      onem: 100 - index,
      x: index * 10, y: index * 10, w: 30, h: 10,
    }));
    const normalized = normalizeNewspaperScript({
      videoSlides: [],
      gazeteBasliklari: visionHeadlines,
    }, [{
      id: 'H1', text: 'Yerel OCR başlığı', detail: 'Yerel OCR açıklaması tamamlandı.',
      confidence: 95, score: 9000, x: 1, y: 2, w: 300, h: 80,
    }]);

    expect(normalized.gazeteBasliklari).toHaveLength(1);
    expect(normalized.visionGazeteBasliklari).toEqual(visionHeadlines);
  });

  it('yerel başlık kutusu yoksa da tam görsel önerilerini ayrı alanda korur', () => {
    const visionHeadlines = Array.from({ length: 5 }, (_, index) => ({
      sourceHeadlineId: `V${index + 1}`,
      baslik: `Bağımsız haber başlığı ${index + 1}`,
      aciklama: `Bağlı haber açıklaması burada tamamlandı ${index + 1}.`,
      onem: 100 - index,
      x: 0, y: index * 10, w: 50, h: 10,
    }));
    const normalized = normalizeNewspaperScript({
      videoSlides: [],
      gazeteBasliklari: visionHeadlines,
    }, []);

    expect(normalized.visionGazeteBasliklari).toEqual(visionHeadlines);
  });
});
