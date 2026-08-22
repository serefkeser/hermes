import { describe, expect, it } from 'vitest';
import {
  assertLockedNewspaperScript,
  buildLockedNewspaperScript,
  type NewspaperScriptContract,
  type VerifiedNewspaperCandidate,
} from './newspaperPipeline';

function candidate(id: string, text: string, detail: string, score: number): VerifiedNewspaperCandidate {
  return { id, text, detail, confidence: 94, score, x: 10, y: 10, w: 500, h: 100 };
}

const stories = [
  candidate(
    'H1',
    'İşsizin fonu da patrona akıyor',
    'Rejimin emek düşmanı düzeninde her şey patronların kazanmasına ayarlı.',
    2400,
  ),
  candidate(
    'H2',
    "İsrail hamaseti Kudüs'e uzandı",
    'Kentte yaşanan gelişmelerin ardından taraflar açıklama yaptı.',
    1800,
  ),
];

function aiScript(): NewspaperScriptContract {
  return {
    sourceName: 'Yanlış kaynak',
    videoSlides: [
      { sourceHeadlineId: 'H1', sourceHeadline: 'Değiştirilmiş', topText: 'Fona Ne Oldu', spokenText: 'Uydurma.', imagePrompts: ['x'] },
      { sourceHeadlineId: 'H2', sourceHeadline: 'Değiştirilmiş', topText: 'KUDÜS GÜNDEMDE', spokenText: 'Uydurma.', imagePrompts: ['y'] },
    ],
  };
}

describe('locked newspaper pipeline', () => {
  it('AI yalnız hook önerebilir; kaynak, başlık ve açıklamayı değiştiremez', () => {
    const result = buildLockedNewspaperScript({
      script: aiScript(),
      candidates: stories,
      configuredSourceName: 'BirGün',
    });

    expect(result.videoSlides).toHaveLength(2);
    expect(result.videoSlides[0]).toEqual({
      sourceHeadlineId: 'H1',
      sourceHeadline: 'İşsizin fonu da patrona akıyor',
      topText: 'İşsizin fonu da patrona',
      spokenText: 'BirGün gazetesinin haberine göre. İşsizin fonu da patrona akıyor. Rejimin emek düşmanı düzeninde her şey patronların kazanmasına ayarlı.',
      imagePrompts: [],
    });
    expect(result.videoSlides[1]?.sourceHeadlineId).toBe('H2');
    expect(result.gazeteBasliklari?.map(item => item.baslik)).toEqual(stories.map(item => item.text));
    expect(() => assertLockedNewspaperScript(result, stories, 'BirGün')).not.toThrow();
  });

  it('açıklaması tamamlanmayan haber kırıntısını sahneye almaz', () => {
    const incomplete = candidate('H3', 'CEZASIZLIK ZIRHI', 'Eksik açıklama', 1000);
    const result = buildLockedNewspaperScript({ script: aiScript(), candidates: [...stories, incomplete] });
    expect(result.videoSlides.map(slide => slide.sourceHeadlineId)).toEqual(['H1', 'H2']);
  });

  it('iki tam haber doğrulanmadan eksik video başlatmaz', () => {
    expect(() => buildLockedNewspaperScript({ script: aiScript(), candidates: stories.slice(0, 1) }))
      .toThrow('En az 2 bağımsız haberin başlığı ve açıklaması doğrulanamadı');
  });

  it('sahne sonradan değiştirilirse sözleşme denetimi bunu yakalar', () => {
    const result = buildLockedNewspaperScript({ script: aiScript(), candidates: stories, configuredSourceName: 'BirGün' });
    result.videoSlides[0]!.spokenText = 'Tahmini bir anlatım.';
    expect(() => assertLockedNewspaperScript(result, stories, 'BirGün')).toThrow('başlığı veya açıklaması değiştirildi');
  });

  it('referans akışındaki altı manşeti büyükten küçüğe, birer kez ve kendi detayıyla okur', () => {
    const referenceStories = [
      candidate('H1', 'Yoksulluk kader oldu', 'Gelir dağılımındaki eşitsizliğin giderek daha fazla derinleştiği belirtiliyor.', 6000),
      candidate('H2', 'Kaybedecek tek gün yok', 'Uzmanlar kentsel dönüşüm için hızlı adım atılması gerektiğini söylüyor.', 5000),
      candidate('H3', 'Vergi yükü yollara taştı', 'Köprü ve otoyol ödemelerinin vatandaşın üzerindeki yükü artırdığı aktarılıyor.', 4000),
      candidate('H4', 'Muhalefet hat çizmeli', 'Siyasetin ilkeler üzerinden yürütülmesi gerektiği vurgulanıyor.', 3000),
      candidate('H5', 'Beş yıldızlı Tokyo gezisi', 'Heyetin konaklama ayrıntılarının kamuoyuna yansıdığı bildiriliyor.', 2000),
      candidate('H6', 'Şirket hemen kamulaştırılsın', 'İşçiler çalışma koşulları ve hakları için açıklama yaptı.', 1000),
    ];
    const script = {
      sourceName: 'BirGün',
      videoSlides: referenceStories.map(story => ({
        sourceHeadlineId: story.id,
        sourceHeadline: story.text,
        topText: story.id === 'H1' ? 'Yoksulluk kader mi?' : story.text,
        spokenText: 'AI bu alanı değiştiremez.',
        imagePrompts: [],
      })),
    };

    const result = buildLockedNewspaperScript({ script, candidates: referenceStories });
    expect(result.videoSlides.map(slide => slide.sourceHeadlineId)).toEqual(['H1', 'H2', 'H3', 'H4', 'H5', 'H6']);
    expect(result.videoSlides[0]?.topText).toBe('Yoksulluk kader mi');
    result.videoSlides.forEach((slide, index) => {
      expect(slide.spokenText).toContain(referenceStories[index].text);
      expect(slide.spokenText).toContain(referenceStories[index].detail);
    });
  });
});
