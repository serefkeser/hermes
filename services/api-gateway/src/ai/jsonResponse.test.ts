import { describe, expect, it } from 'vitest';
import { parseAiJsonObject, validateHermesNewspaperResponse, validateHermesScriptResponse } from './jsonResponse';

describe('AI JSON response parser', () => {
  it('Markdown ve think metni içindeki dengeli JSON nesnesini çıkarır', () => {
    const result = parseAiJsonObject(`<think>uzun analiz {geçersiz}</think>
      İşte sonuç:
      \`\`\`json
      {"videoSlides":[{"topText":"GÜNDEM","spokenText":"Haber hazır.","imagePrompts":[]}],"sonSoz":"Söz."}
      \`\`\`
      Ek açıklama.`);
    expect(result.videoSlides).toHaveLength(1);
    expect(result.sonSoz).toBe('Söz.');
  });

  it('birden fazla JSON bloğunda tam video senaryosunu seçer', () => {
    const result = parseAiJsonObject(`{"status":"ok"}
      {"videoSlides":[{"topText":"SONUÇ","spokenText":"Gerçek sonuç.","imagePrompts":[]}],"thumbnailText":"MANŞET"}`);
    expect(result.thumbnailText).toBe('MANŞET');
  });

  it('string içeriğini bozmadan sondaki virgülleri temizler', () => {
    const result = parseAiJsonObject('{"videoSlides":[{"topText":"A,}","spokenText":"Haber.","imagePrompts":[],},],}');
    expect((result.videoSlides as Array<{ topText: string }>)[0].topText).toBe('A,}');
  });

  it('videoSlides içermeyen nesneyi geçerli Hermes yanıtı saymaz', () => {
    expect(() => validateHermesScriptResponse('{"message":"tamam"}')).toThrow('videoSlides');
  });

  it('yarıda kesilmiş dış JSON içindeki tamamlanmış sahneleri kurtarır', () => {
    const result = parseAiJsonObject(`{"isContentUnreadable":false,"videoSlides":[
      {"topText":"BİRİNCİ HABER","spokenText":"Birinci haber doğrulandı.","imagePrompts":[]},
      {"topText":"İKİNCİ HABER","spokenText":"İkinci haber doğrulandı.","imagePrompts":[]},
      {"topText":"YARIM","spokenText":"Yanıt burada kesildi`);
    expect(result.videoSlides).toHaveLength(2);
    expect((result.videoSlides as Array<{ topText: string }>)[1].topText).toBe('İKİNCİ HABER');
  });

  it('gazete yanıtında en az 5 farklı kaynak başlığı ister', () => {
    const repeatedStory = JSON.stringify({
      videoSlides: Array.from({ length: 6 }, (_, index) => ({
        sourceHeadline: 'Kuzey Ormanları demir yolu projesi',
        topText: `AÇI ${index + 1}`,
        spokenText: 'Aynı haber farklı açıdan anlatılıyor.',
        imagePrompts: [],
      })),
      gazeteBasliklari: [{ baslik: 'Kuzey Ormanları demir yolu projesi' }],
    });
    expect(() => validateHermesNewspaperResponse(repeatedStory)).toThrow('5 farklı haberi');
  });

  it('birbirinden farklı 5 gazete haberini kabul eder', () => {
    const headlines = ['Adli yargıda alarm', 'Yarımız borçlu', 'Ağaç kesimi', 'Dolum tesisi patladı', 'Transfer mutabakatı'];
    const response = JSON.stringify({
      videoSlides: headlines.map(sourceHeadline => ({ sourceHeadline, topText: sourceHeadline, spokenText: `${sourceHeadline}.`, imagePrompts: [] })),
      gazeteBasliklari: headlines.map((baslik, index) => ({ baslik, aciklama: 'Açıklama', onem: 100 - index * 10, x: 0, y: 0, w: 1, h: 1 })),
    });
    expect(() => validateHermesNewspaperResponse(response)).not.toThrow();
  });

  it('sahneleri beş farklı sabit OCR başlık kimliğine bağlar', () => {
    const ids = ['H1', 'H2', 'H3', 'H4', 'H5'];
    const response = JSON.stringify({
      videoSlides: ids.map(sourceHeadlineId => ({ sourceHeadlineId, sourceHeadline: `${sourceHeadlineId} bağımsız başlık`, topText: sourceHeadlineId, spokenText: 'Haber.', imagePrompts: [] })),
      gazeteBasliklari: ids.map(sourceHeadlineId => ({ sourceHeadlineId, baslik: `${sourceHeadlineId} bağımsız başlık`, aciklama: 'Açıklama' })),
    });
    expect(() => validateHermesNewspaperResponse(response, ids)).not.toThrow();
  });

  it('kesin OCR yalnız üç haber doğrularsa tam görselden iki ayrı haber bölgesi daha ister', () => {
    const ids = ['H1', 'H2', 'H3'];
    const response = JSON.stringify({
      videoSlides: ids.map(sourceHeadlineId => ({ sourceHeadlineId, sourceHeadline: sourceHeadlineId, topText: sourceHeadlineId, spokenText: `${sourceHeadlineId}.`, imagePrompts: [] })),
      gazeteBasliklari: ids.map(sourceHeadlineId => ({ sourceHeadlineId, baslik: sourceHeadlineId, aciklama: '' })),
    });
    expect(() => validateHermesNewspaperResponse(response, ids)).toThrow('toplam 5 farklı haberi');
  });

  it('üç yerel OCR haberi ile iki tam-görsel haber bölgesini birlikte kabul eder', () => {
    const ids = ['H1', 'H2', 'H3'];
    const combinedIds = [...ids, 'V1', 'V2'];
    const response = JSON.stringify({
      videoSlides: combinedIds.map(sourceHeadlineId => ({
        sourceHeadlineId,
        sourceHeadline: `${sourceHeadlineId} bağımsız haber`,
        topText: sourceHeadlineId,
        spokenText: `${sourceHeadlineId} bağımsız haber.`,
        imagePrompts: [],
      })),
      gazeteBasliklari: combinedIds.map(sourceHeadlineId => ({
        sourceHeadlineId,
        baslik: `${sourceHeadlineId} bağımsız haber`,
        aciklama: 'Görselde basılı açıklama.',
      })),
    });
    expect(() => validateHermesNewspaperResponse(response, ids)).not.toThrow();
  });

  it('aynı OCR bölgesine bağlı tekrar sahnelerini reddeder', () => {
    const ids = ['H1', 'H2', 'H3', 'H4', 'H5'];
    const response = JSON.stringify({
      videoSlides: Array.from({ length: 6 }, () => ({ sourceHeadlineId: 'H1', sourceHeadline: 'Aynı haber', topText: 'AÇI', spokenText: 'Aynı haber.', imagePrompts: [] })),
      gazeteBasliklari: [{ sourceHeadlineId: 'H1', baslik: 'Aynı haber', aciklama: 'Açıklama' }],
    });
    expect(() => validateHermesNewspaperResponse(response, ids)).toThrow('OCR başlık bölgesine');
  });
});
