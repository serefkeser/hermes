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
  candidate(
    'H3',
    "Hyundai'de 40 bin işçi grevde",
    'İşçiler çalışma koşullarının iyileştirilmesi için greve çıktı.',
    1600,
  ),
  candidate(
    'H4',
    'Eskiyi hep birlikte geride bırakalım',
    'Yeni dönemde ortak hareket edilmesi gerektiği açıklandı.',
    1400,
  ),
  candidate(
    'H5',
    'Saray çevresindeki şanslı müteahhitler',
    'Kamu ihalelerinin dağılımına ilişkin veriler yayımlandı.',
    1200,
  ),
];

function aiScript(): NewspaperScriptContract {
  return {
    sourceName: 'Yanlış kaynak',
    videoSlides: [
      { sourceHeadlineId: 'H1', sourceHeadline: 'Değiştirilmiş', topText: 'Fonu patrona mı?', spokenText: 'Uydurma.', imagePrompts: ['x'] },
      { sourceHeadlineId: 'H2', sourceHeadline: 'Değiştirilmiş', topText: 'KUDÜS GÜNDEMDE', spokenText: 'Uydurma.', imagePrompts: ['y'] },
      { sourceHeadlineId: 'H3', sourceHeadline: 'Değiştirilmiş', topText: 'İŞÇİLER GREVDE', spokenText: 'Uydurma.', imagePrompts: ['z'] },
      { sourceHeadlineId: 'H4', sourceHeadline: 'Değiştirilmiş', topText: 'ESKİYİ GERİDE BIRAKALIM', spokenText: 'Uydurma.', imagePrompts: ['a'] },
      { sourceHeadlineId: 'H5', sourceHeadline: 'Değiştirilmiş', topText: 'ŞANSLI MÜTEAHHİTLER', spokenText: 'Uydurma.', imagePrompts: ['b'] },
    ],
  };
}

describe('locked newspaper pipeline', () => {
  it('AI yalnız kapak clickbaitini önerebilir; içerik başlığını ve açıklamayı değiştiremez', () => {
    const result = buildLockedNewspaperScript({
      script: aiScript(),
      candidates: stories,
      configuredSourceName: 'BirGün',
    });

    expect(result.videoSlides).toHaveLength(5);
    expect(result.videoSlides[0]).toEqual({
      sourceHeadlineId: 'H1',
      sourceHeadline: 'İşsizin fonu da patrona akıyor',
      topText: 'İşsizin fonu da patrona akıyor',
      spokenText: 'İşsizin fonu da patrona akıyor. Rejimin emek düşmanı düzeninde her şey patronların kazanmasına ayarlı.',
      imagePrompts: [],
    });
    expect(result.videoSlides[1]?.sourceHeadlineId).toBe('H2');
    expect(result.gazeteBasliklari?.map(item => item.baslik)).toEqual(stories.map(item => item.text));
    expect(result.thumbnailText).toBe('FONU PATRONA MI!');
    expect(result.videoSlides.every(slide => !slide.spokenText.includes('gazetesinin haberine göre'))).toBe(true);
    expect(() => assertLockedNewspaperScript(result, stories, 'BirGün')).not.toThrow();
  });

  it('açıklaması tamamlanmayan haber kırıntısını sahneye almaz', () => {
    const incomplete = candidate('H6', 'CEZASIZLIK ZIRHI', 'Eksik açıklama', 1000);
    const result = buildLockedNewspaperScript({ script: aiScript(), candidates: [...stories, incomplete] });
    expect(result.videoSlides.map(slide => slide.sourceHeadlineId)).toEqual(['H1', 'H2', 'H3', 'H4', 'H5']);
  });

  it('tek kapak clickbaitini içerik sahnesinden ayrı tutar ve başlık kanıtına bağlar', () => {
    const script = aiScript();
    script.thumbnailText = 'Fonu patrona mı?';
    script.videoSlides[0]!.topText = 'AI tarafından ezildi';
    const result = buildLockedNewspaperScript({ script, candidates: stories, configuredSourceName: 'BirGün' });

    expect(result.thumbnailText).toBe('FONU PATRONA MI!');
    expect(result.videoSlides[0]?.topText).toBe('İşsizin fonu da patrona akıyor');
    expect(result.videoSlides.slice(1).every(slide => slide.topText === slide.sourceHeadline)).toBe(true);
  });

  it('beş tam haber doğrulanmadan eksik video başlatmaz', () => {
    expect(() => buildLockedNewspaperScript({ script: aiScript(), candidates: stories.slice(0, 4) }))
      .toThrow('En az 5 bağımsız haberin başlığı ve açıklaması doğrulanamadı');
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
    const script: NewspaperScriptContract = {
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
    expect(result.thumbnailText).toBe('YOKSULLUK KADER Mİ!');
    result.videoSlides.forEach((slide, index) => {
      expect(slide.topText).toBe(referenceStories[index].text);
      expect(slide.spokenText).toBe(`${referenceStories[index].text}. ${referenceStories[index].detail}`);
      expect(slide.spokenText).not.toContain('gazetesinin haberine göre');
    });
  });
});
