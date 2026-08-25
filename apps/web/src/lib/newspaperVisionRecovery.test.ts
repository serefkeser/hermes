import { describe, expect, it } from 'vitest';
import type { VerifiedNewspaperCandidate } from './newspaperPipeline';
import {
  recoverNewspaperCandidatesFromVision,
  type VisionNewspaperCandidate,
} from './newspaperVisionRecovery';

const fullOcrText = `OCR_HEADLINE_CANDIDATES (kimlikler ve sıralama sabittir):
H1|score=9000|confidence=94|x=10|y=20|w=800|h=120|text=Devlet ibadet dayatamaz|detail=Danıştay uygulamanın yöneticiler eliyle yapılacağı için zorlayıcı olacağını belirtti.

OCR TAM METİN:
Devlet ibadet DAYATAMAZ
Danıştay uygulamanın yöneticiler eliyle yapılacağı için zorlayıcı olacağını belirtti.
Baskın seçim planı
Ortak liste için yeni kurallar getirilmesi beklendiği belirtildi.
Transferle kazanamazsın
Belediyelerin rekabetle kazanılır transferle seçim kazanılmaz dedi.
Tarihin yönü Sakarya'da değişti
Mustafa Kemal hattı müdafaa yoktur sathı müdafaa vardır emrini yayımladı.
Netanyahu Türkleri kışkırtmaya çalışıyor
Barrack saldırı Türkiye'yi kışkırtma veya seçim hamlesiydi dedi.
Fenerbahçe 4-2 ile gol oldu yağdı
Sarı lacivertli ekip karşılaşmada dört golle galip geldi.`;

const visionCandidates: VisionNewspaperCandidate[] = [
  {
    sourceHeadlineId: 'V1', baslik: 'Devlet ibadet dayatamaz',
    aciklama: 'Danıştay uygulamanın yöneticiler eliyle yapılacağı için zorlayıcı olacağını belirtti.',
    onem: 100, x: 20, y: 10, w: 75, h: 25,
  },
  {
    sourceHeadlineId: 'V2', baslik: 'Baskın seçim planı',
    aciklama: 'Ortak liste için yeni kurallar getirilmesi beklendiği belirtildi.',
    onem: 90, x: 25, y: 40, w: 70, h: 20,
  },
  {
    sourceHeadlineId: 'V3', baslik: 'Transferle kazanamazsın',
    aciklama: 'Belediyelerin rekabetle kazanılır transferle seçim kazanılmaz dedi.',
    onem: 80, x: 25, y: 60, w: 60, h: 15,
  },
  {
    sourceHeadlineId: 'V4', baslik: "Tarihin yönü Sakarya'da değişti",
    aciklama: 'Mustafa Kemal hattı müdafaa yoktur sathı müdafaa vardır emrini yayımladı.',
    onem: 70, x: 0, y: 20, w: 24, h: 20,
  },
  {
    sourceHeadlineId: 'V5', baslik: 'Netanyahu Türkleri kışkırtmaya çalışıyor',
    aciklama: "Barrack saldırı Türkiye'yi kışkırtma veya seçim hamlesiydi dedi.",
    onem: 60, x: 0, y: 70, w: 24, h: 16,
  },
];

function localCandidate(): VerifiedNewspaperCandidate {
  return {
    id: 'H1', text: 'Devlet ibadet dayatamaz',
    detail: 'Danıştay uygulamanın yöneticiler eliyle yapılacağı için zorlayıcı olacağını belirtti.',
    confidence: 94, score: 9000, x: 10, y: 20, w: 800, h: 120,
  };
}

describe('newspaper full-vision recovery', () => {
  it('yerel OCR tek haber bulsa da tam görsel önerilerini OCR metniyle çapraz doğrulayıp beşe tamamlar', () => {
    const result = recoverNewspaperCandidatesFromVision({
      localCandidates: [localCandidate()],
      visionCandidates,
      localOcrText: fullOcrText,
      maximumStories: 9,
    });

    expect(result.candidates).toHaveLength(5);
    expect(result.recoveredCount).toBe(4);
    expect(result.candidates.map(candidate => candidate.id)).toEqual(['H1', 'H2', 'H3', 'H4', 'H5']);
    expect(result.candidates.map(candidate => candidate.text)).toEqual(visionCandidates.map(candidate => candidate.baslik));
    expect(result.candidates[0]).toMatchObject(localCandidate());
  });

  it('görsel modelin değiştirdiği skoru yerel OCR kanıtıyla uyuşmadığı için reddeder', () => {
    const result = recoverNewspaperCandidatesFromVision({
      localCandidates: [],
      visionCandidates: [{
        sourceHeadlineId: 'V1',
        baslik: 'Fenerbahçe 4-1 ile gol oldu yağdı',
        aciklama: 'Sarı lacivertli ekip karşılaşmada dört golle galip geldi.',
        onem: 90,
      }],
      localOcrText: fullOcrText,
      maximumStories: 9,
    });

    expect(result.candidates).toHaveLength(0);
    expect(result.rejected[0]?.reason).toBe('başlık yerel OCR metniyle eşleşmedi');
  });

  it('OCR metninde bulunmayan AI özetini veya uydurma açıklamayı sahneye almaz', () => {
    const result = recoverNewspaperCandidatesFromVision({
      localCandidates: [],
      visionCandidates: [{
        sourceHeadlineId: 'V1',
        baslik: 'Baskın seçim planı',
        aciklama: 'Muhalefet erken seçim için kesin olarak anlaşmaya vardı.',
        onem: 90,
      }],
      localOcrText: fullOcrText,
      maximumStories: 9,
    });

    expect(result.candidates).toHaveLength(0);
    expect(result.rejected[0]?.reason).toBe('açıklama yerel OCR metniyle eşleşmedi');
  });

  it('aynı haberi yerel OCR ve görsel analizden iki kez eklemez; güçlü yerel metni korur', () => {
    const local = localCandidate();
    const result = recoverNewspaperCandidatesFromVision({
      localCandidates: [local],
      visionCandidates: [visionCandidates[0], visionCandidates[0]],
      localOcrText: fullOcrText,
      maximumStories: 9,
    });

    expect(result.candidates).toHaveLength(1);
    expect(result.recoveredCount).toBe(0);
    expect(result.candidates[0]).toMatchObject({ text: local.text, detail: local.detail, confidence: 94 });
  });

  it('tam sayfa OCR sütunu parçalasa bile aynı haber kutusunun yerel yakın okumasıyla doğrular', () => {
    const result = recoverNewspaperCandidatesFromVision({
      localCandidates: [],
      visionCandidates: [{
        sourceHeadlineId: 'V1',
        baslik: 'Devlet ibadet dayatamaz',
        aciklama: 'Danıştay uygulamanın yöneticiler eliyle yapılacağı için zorlayıcı olacağını belirtti.',
        onem: 100,
        localCropEvidence: 'Devlet ibadet DAYATAMAZ Danıştay uygulamanın yöneticiler eliyle yapılacağı için zorlayıcı olacağını belirtti.',
      }],
      localOcrText: 'OCR TAM METİN: Devlet ibadet DAYATAMAZ nıştay in yön eliyle yapı in zor ıcı olacaj belirtildi.',
      maximumStories: 9,
    });

    expect(result.candidates).toHaveLength(1);
    expect(result.recoveredCount).toBe(1);
  });
});
