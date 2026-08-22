import { describe, expect, it } from 'vitest';
import {
  buildVerifiedCoverHook,
  groundedNewspaperHook,
  hasStrictOcrConsensus,
  isLikelyCompleteNewspaperHeadline,
  isProminentSingleWordLine,
  isReliableNewspaperDetail,
  selectStrictDetailLines,
} from './newspaperVerification';

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

  it('Milat örneğindeki gerçek çok satırlı manşeti korur, yarım isim satırlarını haber saymaz', () => {
    expect(isProminentSingleWordLine('AKADEMİ', 94, 88, 130)).toBe(true);
    expect(isLikelyCompleteNewspaperHeadline("DİJİTAL VATAN'A AKADEMİ")).toBe(true);
    expect(isLikelyCompleteNewspaperHeadline('ŞAM ZİYARETİ İÇİN GERİ SAYIM')).toBe(true);
    expect(isLikelyCompleteNewspaperHeadline('Bakanı Prof. Dr. Yusuf Tekin')).toBe(false);
    expect(isLikelyCompleteNewspaperHeadline("Al Jazeera'ye değerlendirdi")).toBe(false);
    expect(isLikelyCompleteNewspaperHeadline('Başkan Recep Tayyip')).toBe(false);
    expect(isLikelyCompleteNewspaperHeadline('ARAÇ KİRALAMADA')).toBe(false);
  });

  it('yalnız tamamlanmış ve dil yapısı güvenilir detay cümlesini okur', () => {
    expect(isReliableNewspaperDetail(
      "Milat Gazetesi Genel Yayın Koordinatörü Serdar Arseven, Dijital Vatan kavramının yeni oluşuma vesile olduğunu açıkladı.",
    )).toBe(true);
    expect(isReliableNewspaperDetail('Burhanettin Duran ile Sanayi ve hocalar ar Tabiiletişim Başkanı Protr')).toBe(false);
    expect(isReliableNewspaperDetail('Başkan Recep Tayyip')).toBe(false);
  });

  it('başlığın altındaki ilk paragraf bittikten sonra başka habere sıçramaz', () => {
    const headline = { x0: 100, y0: 20, x1: 400, y1: 70, width: 300, height: 50 };
    const selected = selectStrictDetailLines(headline, [
      { text: 'İlk doğrulanmış açıklama burada yer alıyor.', confidence: 91, x0: 110, y0: 76, x1: 390, y1: 92, width: 280, height: 16 },
      { text: 'Aynı paragrafın ikinci satırı devam ediyor.', confidence: 90, x0: 110, y0: 95, x1: 390, y1: 111, width: 280, height: 16 },
      { text: 'Başka sütundaki ilgisiz haber burada başlıyor.', confidence: 94, x0: 110, y0: 145, x1: 390, y1: 161, width: 280, height: 16 },
    ]);
    expect(selected.map(line => line.text)).toEqual([
      'İlk doğrulanmış açıklama burada yer alıyor.',
      'Aynı paragrafın ikinci satırı devam ediyor.',
    ]);
  });
});
