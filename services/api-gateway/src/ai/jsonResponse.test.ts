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

  it('gazete yanıtında videoSlides olmasa da beş gazeteBasliklari öğesini ana çıktı kabul eder', () => {
    const headlines = ['Adli yargıda alarm', 'Yarımız borçlu', 'Ağaç kesimi', 'Dolum tesisi patladı', 'Transfer mutabakatı'];
    const repeatedStory = JSON.stringify({
      videoSlides: [],
      gazeteBasliklari: headlines.map((baslik, index) => ({
        sourceHeadlineId: `V${index + 1}`,
        baslik,
        aciklama: `Görselde basılı açıklama cümlesi ${index + 1}.`,
      })),
    });
    expect(() => validateHermesNewspaperResponse(repeatedStory)).not.toThrow();
  });

  it('birbirinden farklı 5 gazete haberini kabul eder', () => {
    const headlines = ['Adli yargıda alarm', 'Yarımız borçlu', 'Ağaç kesimi', 'Dolum tesisi patladı', 'Transfer mutabakatı'];
    const response = JSON.stringify({
      videoSlides: headlines.map(sourceHeadline => ({ sourceHeadline, topText: sourceHeadline, spokenText: `${sourceHeadline}.`, imagePrompts: [] })),
      gazeteBasliklari: headlines.map((baslik, index) => ({ baslik, aciklama: 'Açıklama', onem: 100 - index * 10, x: 0, y: 0, w: 1, h: 1 })),
    });
    expect(() => validateHermesNewspaperResponse(response)).not.toThrow();
  });

  it('beş yerel OCR haberi varsa AI sahne eşleştirmesini zorunlu tutmaz', () => {
    const ids = ['H1', 'H2', 'H3', 'H4', 'H5'];
    const response = JSON.stringify({
      videoSlides: [{ topText: 'GAZETE', spokenText: 'Gazete görüntüsü incelendi.', imagePrompts: [] }],
      gazeteBasliklari: [],
    });
    expect(() => validateHermesNewspaperResponse(response, ids)).not.toThrow();
  });

  it('kesin OCR yalnız üç haber doğrularsa tam görselden iki ayrı haber bölgesi daha ister', () => {
    const ids = ['H1', 'H2', 'H3'];
    const response = JSON.stringify({
      videoSlides: [{ topText: 'GAZETE', spokenText: 'Gazete görüntüsü incelendi.', imagePrompts: [] }],
      gazeteBasliklari: ids.map(sourceHeadlineId => ({ sourceHeadlineId, baslik: sourceHeadlineId, aciklama: '' })),
    });
    expect(() => validateHermesNewspaperResponse(response, ids)).toThrow('2 yeni tam-görsel haber bölgesi');
  });

  it('üç yerel OCR haberi ile iki tam-görsel haber bölgesini birlikte kabul eder', () => {
    const ids = ['H1', 'H2', 'H3'];
    const combinedIds = [...ids, 'V1', 'V2'];
    const response = JSON.stringify({
      videoSlides: [{ topText: 'GAZETE', spokenText: 'Gazete görüntüsü incelendi.', imagePrompts: [] }],
      gazeteBasliklari: combinedIds.map(sourceHeadlineId => ({
        sourceHeadlineId,
        baslik: `${sourceHeadlineId} bağımsız haber`,
        aciklama: 'Görselde basılı açıklama.',
      })),
    });
    expect(() => validateHermesNewspaperResponse(response, ids)).not.toThrow();
  });

  it('yerel OCR tekrarlarını yeni tam-görsel haber saymaz', () => {
    const candidates = [
      { id: 'H1', text: 'Aynı haber' },
      { id: 'H2', text: 'İkinci yerel haber' },
      { id: 'H3', text: 'Üçüncü yerel haber' },
    ];
    const response = JSON.stringify({
      videoSlides: Array.from({ length: 6 }, () => ({ sourceHeadlineId: 'H1', sourceHeadline: 'Aynı haber', topText: 'AÇI', spokenText: 'Aynı haber.', imagePrompts: [] })),
      gazeteBasliklari: [{ sourceHeadlineId: 'V1', baslik: 'Aynı haber', aciklama: 'Açıklama' }],
    });
    expect(() => validateHermesNewspaperResponse(response, candidates)).toThrow('2 yeni tam-görsel haber bölgesi');
  });

  it('3.14.34 logundaki iki yerel haberi videoSlides olmadan üç tam-görsel haberle tamamlar', () => {
    const local = [
      { id: 'H1', text: "AKPOLAT'A 15 YIL AHMET ÖZER'E 8 AY" },
      { id: 'H2', text: 'İLK KEZ TOPLANDI' },
    ];
    const response = JSON.stringify({
      videoSlides: [],
      gazeteBasliklari: [
        { sourceHeadlineId: 'H1', baslik: local[0].text, aciklama: 'Yerel OCR açıklaması tamamlandı.' },
        { sourceHeadlineId: 'H2', baslik: local[1].text, aciklama: 'Yerel OCR açıklaması tamamlandı.' },
        { sourceHeadlineId: 'V1', baslik: 'Üçüncü bağımsız haber', aciklama: 'Görselde basılı üçüncü açıklama tamamlandı.' },
        { sourceHeadlineId: 'V2', baslik: 'Dördüncü bağımsız haber', aciklama: 'Görselde basılı dördüncü açıklama tamamlandı.' },
        { sourceHeadlineId: 'V3', baslik: 'Beşinci bağımsız haber', aciklama: 'Görselde basılı beşinci açıklama tamamlandı.' },
      ],
    });
    expect(() => validateHermesNewspaperResponse(response, local)).not.toThrow();
  });
});
