import { describe, expect, it } from 'vitest';
import {
  collapseSpatialDuplicateNewspaperHeadlines,
  buildVerifiedCoverHook,
  filterIndependentNewspaperHeadlines,
  groundedNewspaperHook,
  hasStrictOcrConsensus,
  isLikelyCompleteNewspaperHeadline,
  isNewspaperHeadlineContinuationLine,
  isProminentSingleWordLine,
  isReliableNewspaperDetail,
  newspaperHeadlineRejectionReason,
  joinVerifiedNewspaperDetailLines,
  selectReliableNewspaperDetailText,
  selectVerifiedOcrReading,
  selectVerifiedNewspaperDetailBlock,
  selectStrictDetailLines,
  selectStrictDetailLineGroups,
  shouldMergeRegionalOcrLine,
  shouldGroupNewspaperHeadlineLines,
} from './newspaperVerification';

describe('collapseSpatialDuplicateNewspaperHeadlines', () => {
  it('aynı basılı bölgedeki sayı eksilten OCR kopyasını atar', () => {
    const candidates = collapseSpatialDuplicateNewspaperHeadlines([
      {
        text: "Hyundai'de bin işçi grevde", detail: 'Güney Kore’de yaklaşık 40 bin Hyundai işçisi greve çıktı.',
        confidence: 94, score: 1642, x0: 41, y0: 2051, x1: 624, y1: 2119, width: 583, height: 68,
      },
      {
        text: "Hyundai'de 40 bin işçi grevde", detail: 'Güney Kore’de yaklaşık 40 bin Hyundai işçisi greve çıktı.',
        confidence: 94, score: 1038, x0: 41, y0: 2072, x1: 624, y1: 2115, width: 583, height: 43,
      },
    ]);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].text).toBe("Hyundai'de 40 bin işçi grevde");
  });

  it('farklı fiziksel bölgelerdeki benzer haberleri birleştirmez', () => {
    const candidates = collapseSpatialDuplicateNewspaperHeadlines([
      {
        text: 'İşçiler greve çıktı', detail: 'Birinci fabrikadaki işçiler greve çıktı.',
        confidence: 90, score: 900, x0: 20, y0: 100, x1: 300, y1: 160, width: 280, height: 60,
      },
      {
        text: 'İşçiler greve çıktı', detail: 'İkinci fabrikadaki işçiler greve çıktı.',
        confidence: 91, score: 800, x0: 600, y0: 900, x1: 900, y1: 960, width: 300, height: 60,
      },
    ]);

    expect(candidates).toHaveLength(2);
  });
});

describe('strict newspaper evidence verification', () => {
  it('Trabzonspor skorunu yalnız iki OCR okuması birebir doğrularsa kabul eder', () => {
    const source = 'Trabzonspor Kasımpaşa ile 1-1 berabere kaldı';
    expect(hasStrictOcrConsensus(source, source, 91, 88)).toBe(true);
    expect(hasStrictOcrConsensus(source, 'Trabzonspor Kasımpaşa karşısında 2-1 mağlup oldu', 91, 90)).toBe(false);
    expect(hasStrictOcrConsensus(source, 'Talisca 58. dakikada galibiyeti getirdi', 91, 90)).toBe(false);
  });

  it('büyük ana manşeti ikinci kırpma düşük güven verse bile aynı kelimelerle kurtarır', () => {
    const headline = 'İşsizin fonu da patrona akıyor';
    expect(hasStrictOcrConsensus(headline, headline, 96, 58)).toBe(true);
    expect(hasStrictOcrConsensus(headline, 'İşşizin fonu da patrona akıyor', 96, 84)).toBe(true);
    expect(hasStrictOcrConsensus(headline, 'İşçinin fonu halka aktarılıyor', 96, 58)).toBe(false);
  });

  it('tam sayfa okuması çelişirse ancak iki kırpma aynı başlığı verince düzeltir', () => {
    expect(selectVerifiedOcrReading(
      'İşsizin fonu da patrona akıyor',
      96,
      [
        { text: 'İşçinin fonu da patrona akıyor', confidence: 84 },
        { text: 'İşsizin fonu da patrona akıyor', confidence: 90 },
      ],
    )).toBe('İşsizin fonu da patrona akıyor');
    expect(selectVerifiedOcrReading(
      "Hyundai'de 40 bini işçi grevde",
      93,
      [
        { text: "Hyundai'de 40 bin işçi grevde", confidence: 79 },
        { text: "Hyundai'de 40 bin işçi grevde", confidence: 88 },
      ],
    )).toBe("Hyundai'de 40 bin işçi grevde");
    expect(selectVerifiedOcrReading(
      'Trabzonspor Kasımpaşa ile 1-1 berabere kaldı',
      91,
      [
        { text: 'Trabzonspor Kasımpaşa karşısında 2-1 mağlup oldu', confidence: 90 },
        { text: 'Talisca 58. dakikada galibiyeti getirdi', confidence: 92 },
      ],
    )).toBe('');
  });

  it('küçük puntolu düşük güvenli tam sayfa metnini güçlü bağımsız kırpma doğrularsa kabul eder', () => {
    const primary = 'Sayaç arttı işçi aynı kaldı';
    expect(selectVerifiedOcrReading(primary, 58, [
      { text: primary, confidence: 88 },
      { text: primary, confidence: 91 },
    ])).toBe(primary);
    expect(selectVerifiedOcrReading(primary, 58, [
      { text: primary, confidence: 91 },
    ])).toBe(primary);
  });

  it('Gazete Pencere kırpmasındaki çevre gürültüsünü okumadan basılı başlığı doğrular', () => {
    expect(selectVerifiedOcrReading('İTİRAF DEĞİLSE İSPİYON', 58, [
      { text: '- İTİRAF DEĞİLSE İSPİYON', confidence: 83 },
    ])).toBe('İTİRAF DEĞİLSE İSPİYON');
    expect(selectVerifiedOcrReading('BÖYLE HUKUK DOSTLAR BAŞINA', 59, [
      {
        text: 'BÖYLE HUKUK DOSTLAR BAŞINA Yasadışı bahis ve kara para aklama soruşturmasında',
        confidence: 76,
      },
    ])).toBe('BÖYLE HUKUK DOSTLAR BAŞINA');
    expect(selectVerifiedOcrReading('TRANSFERLE SEÇİM KAZANILMAZ', 65, [
      { text: 'TRANSFERLE SEÇİM KAZANILMAZ', confidence: 72 },
    ])).toBe('TRANSFERLE SEÇİM KAZANILMAZ');
  });

  it('güçlü kırpma çevre metni taşısa da eksik veya değişmiş sayıyı doğrulamaz', () => {
    expect(selectVerifiedOcrReading('Fenerbahçe 4-2 kazandı', 61, [
      { text: 'Fenerbahçe 4-1 kazandı ve taraftar sevindi', confidence: 94 },
    ])).toBe('');
  });

  it('Gazete Pencere dar sütunundaki parçalı açıklamayı bütün paragraf kırpmasıyla doğrular', () => {
    const primaryLines = [
      { text: 'Butlan kararının ardından partiyi kayyıma terk edemem', confidence: 88 },
      { text: 'diyerek Genel Başkanlık koltuğuna oturan Kemal Kılıçdaroğlu', confidence: 87 },
      { text: 'siyaset sahnesine hızlı bir dönüş yaptı.', confidence: 94 },
    ];
    const paragraph = 'Butlan kararının ardından partiyi kayyıma terk edemem diyerek Genel Başkanlık koltuğuna oturan Kemal Kılıçdaroğlu siyaset sahnesine hızlı bir dönüş yaptı.';
    expect(selectVerifiedNewspaperDetailBlock(primaryLines, [
      { text: `${paragraph} Mersin'de açıklamalarda bulundu.`, confidence: 91 },
    ])).toBe(paragraph);
  });

  it('bütün paragraf doğrulaması basılı sayıyı değiştiren kırpmayı reddeder', () => {
    expect(selectVerifiedNewspaperDetailBlock([
      { text: '46 milyon liralık para trafiği tespit edildi.', confidence: 68 },
    ], [
      { text: '48 milyon liralık para trafiği tespit edildi.', confidence: 96 },
    ])).toBe('');
  });

  it('düşük güvenli başlığı bir güçlü ve bir ek uyumlu kırpma birlikte doğrularsa kabul eder', () => {
    expect(selectVerifiedOcrReading('İsrail hamaseti Kudüse uzandı', 64, [
      { text: 'İsrail hamaseti Kudüse uzandı', confidence: 92 },
      { text: 'İsrail hamaset Kudüse uzandı', confidence: 59 },
    ])).toBe('İsrail hamaseti Kudüse uzandı');
  });

  it('iki kırpma uyuşsa bile tam sayfadaki sayıyı değiştirmez', () => {
    expect(selectVerifiedOcrReading('Trabzonspor 1-1 berabere kaldı', 68, [
      { text: 'Trabzonspor 2-1 berabere kaldı', confidence: 91 },
      { text: 'Trabzonspor 2-1 berabere kaldı', confidence: 90 },
    ])).toBe('');
  });

  it('daha yüksek güvenli kırpmanın doğrulanmış yazımını korur', () => {
    expect(selectVerifiedOcrReading('YENİ Parti Genel Başkanı Öz:', 87, [
      { text: 'YENİ Parti Genel Başkanı Öz-', confidence: 94 },
    ])).toBe('YENİ Parti Genel Başkanı Öz-');
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
    expect(groundedNewspaperHook('Yoksulluk kader mi?', 'Yoksulluk kader oldu')).toBe('Yoksulluk kader mi');
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

  it('BirGün örneğindeki masthead, yazar künyesi ve grafik etiketlerini haber saymaz', () => {
    expect(newspaperHeadlineRejectionReason('HALKIN GAZETESİ')).toBe('gazete künyesi veya bölüm etiketi');
    expect(newspaperHeadlineRejectionReason('TUĞÇE MADAYANTİ YAZDI')).toBe('yazar/köşe yazısı künyesi');
    expect(newspaperHeadlineRejectionReason('SELİN NAKIPOĞLU YAZDI')).toBe('yazar/köşe yazısı künyesi');
    expect(newspaperHeadlineRejectionReason('ZAFER TAŞKIN YAZDI')).toBe('yazar/köşe yazısı künyesi');
    expect(newspaperHeadlineRejectionReason('GÜNDE 25 BİN ADIM')).toBe('grafik veya istatistik etiketi');
    expect(isLikelyCompleteNewspaperHeadline('İşsizin fonu da patrona akıyor')).toBe(true);
    expect(isLikelyCompleteNewspaperHeadline('CEZASIZLIK ZIRHI')).toBe(true);
    expect(isLikelyCompleteNewspaperHeadline('Beş yıldızlı Tokyo gezisi')).toBe(true);
    expect(isLikelyCompleteNewspaperHeadline('Muhalefet hat çizmeli')).toBe(true);
    expect(isLikelyCompleteNewspaperHeadline('biri. Eski bir burjuva ilişki komedi-')).toBe(false);
    expect(isLikelyCompleteNewspaperHeadline("Maden emekçilerinin direnişi sürüyor. 7'de")).toBe(false);
  });

  it('büyük manşetin hemen altındaki küçük alt etiketi bağımsız haber listesinden çıkarır', () => {
    const main = {
      text: 'İşsizin fonu da patrona akıyor', score: 2400,
      x0: 80, y0: 100, x1: 620, y1: 260, width: 540, height: 160,
    };
    const caption = {
      text: 'İşçi üretirken payı küçülüyor', score: 900,
      x0: 180, y0: 300, x1: 560, y1: 340, width: 380, height: 40,
    };
    const separate = {
      text: "İsrail hamaseti Kudüs'e uzandı", score: 1500,
      x0: 60, y0: 540, x1: 500, y1: 640, width: 440, height: 100,
    };
    expect(filterIndependentNewspaperHeadlines([main, caption, separate]))
      .toEqual([main, separate]);
  });

  it('yalnız tamamlanmış ve dil yapısı güvenilir detay cümlesini okur', () => {
    expect(isReliableNewspaperDetail(
      "Milat Gazetesi Genel Yayın Koordinatörü Serdar Arseven, Dijital Vatan kavramının yeni oluşuma vesile olduğunu açıkladı.",
    )).toBe(true);
    expect(isReliableNewspaperDetail('Burhanettin Duran ile Sanayi ve hocalar ar Tabiiletişim Başkanı Protr')).toBe(false);
    expect(isReliableNewspaperDetail('Başkan Recep Tayyip')).toBe(false);
    expect(isReliableNewspaperDetail('İşçi üretirken payı küçülüyor')).toBe(true);
    expect(isReliableNewspaperDetail('2023-2026 dönemi fon')).toBe(false);
    expect(isReliableNewspaperDetail('Güney Kore Tik yaşı talej')).toBe(false);
    expect(isReliableNewspaperDetail('YENİ Parti Genel Başkanı Öz:')).toBe(false);
    expect(isReliableNewspaperDetail('yaşayan on milyonlarca yoksul yurttaşın serveti arttı.')).toBe(false);
  });

  it('büyük başlığın küçük harfli tek kelimelik son satırını kaybetmez', () => {
    expect(isNewspaperHeadlineContinuationLine('kaybetti', 96, 26, 141)).toBe(true);
    expect(isNewspaperHeadlineContinuationLine('ve', 96, 26, 141)).toBe(false);
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

  it('geniş manşetin altındaki iki sütunu birbirine karıştırmaz', () => {
    const headline = { x0: 40, y0: 20, x1: 1040, y1: 300, width: 1000, height: 280 };
    const groups = selectStrictDetailLineGroups(headline, [
      { text: 'Rejimin emek düşmanı düzeninde her şey', confidence: 96, x0: 65, y0: 312, x1: 530, y1: 338, width: 465, height: 26 },
      { text: 'İşgücü girdi endeksine göre çalışma saatleri', confidence: 96, x0: 570, y0: 313, x1: 1034, y1: 338, width: 464, height: 25 },
      { text: 'patronların kazanmasına ayarlı.', confidence: 96, x0: 65, y0: 345, x1: 517, y1: 370, width: 452, height: 25 },
      { text: 'artarken patron daha çok kazandı.', confidence: 96, x0: 570, y0: 346, x1: 1034, y1: 370, width: 464, height: 24 },
    ]);
    expect(groups[0]?.map(line => line.text)).toEqual([
      'Rejimin emek düşmanı düzeninde her şey',
      'patronların kazanmasına ayarlı.',
    ]);
    expect(selectReliableNewspaperDetailText(groups[0]!.map(line => line.text)))
      .toBe('Rejimin emek düşmanı düzeninde her şey patronların kazanmasına ayarlı.');
  });

  it('satır sonu tirelerini tahmin eklemeden birleştirip ilk tam cümlede durur', () => {
    expect(joinVerifiedNewspaperDetailLines([
      'YENİ Parti Genel Başkanı Öz-',
      'gür Özel, Karadeniz ziyaretle-',
      "rine Trabzon'dan başladı. Halk",
    ])).toBe("YENİ Parti Genel Başkanı Özgür Özel, Karadeniz ziyaretlerine Trabzon'dan başladı. Halk");
    expect(selectReliableNewspaperDetailText([
      'YENİ Parti Genel Başkanı Öz-',
      'gür Özel, Karadeniz ziyaretle-',
      "rine Trabzon'dan başladı. Halk",
    ])).toBe("YENİ Parti Genel Başkanı Özgür Özel, Karadeniz ziyaretlerine Trabzon'dan başladı.");
    expect(joinVerifiedNewspaperDetailLines([
      'başında gelen DEM Par',
      "ti'de dikkat çekici geliş",
      'meler yaşanıyor.',
    ])).toBe("başında gelen DEM Parti'de dikkat çekici gelişmeler yaşanıyor.");
    expect(joinVerifiedNewspaperDetailLines([
      'YENİ Parti Genel Başkanı Öz:',
      'gür Özel açıkladı.',
    ])).toBe('YENİ Parti Genel Başkanı Özgür Özel açıkladı.');
  });

  it('başlık grubuna dar açıklama satırını eklemez', () => {
    const headlineLine = { text: 'BAŞKANLIK DAVASINDA', x0: 866, y0: 1877, x1: 1227, y1: 1917, width: 361, height: 40 };
    const detailLine = { text: 'Yargıtay kararını açıkladı', x0: 1074, y0: 1951, x1: 1205, y1: 1977, width: 131, height: 26 };
    expect(shouldGroupNewspaperHeadlineLines(headlineLine, detailLine)).toBe(false);
  });

  it('Cumhuriyet düzeninde aynı genişlikteki küçük spotu manşet devamı saymaz', () => {
    const headlineLine = { text: 'DEVLET İBADET', x0: 350, y0: 270, x1: 970, y1: 350, width: 620, height: 80 };
    const detailLine = { text: 'Uygulamanın yöneticiler eliyle yapılacağı açıklandı', x0: 352, y0: 358, x1: 958, y1: 402, width: 606, height: 44 };
    const wrappedHeadlineLine = { text: 'DAYATAMAZ', x0: 352, y0: 358, x1: 965, y1: 433, width: 613, height: 75 };

    expect(shouldGroupNewspaperHeadlineLines(headlineLine, detailLine)).toBe(false);
    expect(shouldGroupNewspaperHeadlineLines(headlineLine, wrappedHeadlineLine)).toBe(true);
  });

  it('Gazete Pencere farklı boydaki büyük harfli manşet satırlarını birleştirir', () => {
    const first = { text: 'TRANSFERLE SEÇİM', x0: 360, y0: 1234, x1: 782, y1: 1317, width: 422, height: 83 };
    const second = { text: 'KAZANILMAZ', x0: 428, y0: 1321, x1: 714, y1: 1357, width: 286, height: 36 };
    const spot = { text: 'YENİ Parti lideri Özgür Özel açıkladı', x0: 370, y0: 1369, x1: 620, y1: 1381, width: 250, height: 12 };

    expect(shouldGroupNewspaperHeadlineLines(first, second)).toBe(true);
    expect(shouldGroupNewspaperHeadlineLines(second, spot)).toBe(false);
  });

  it('Cumhuriyet sütunlarında yalnız aynı basılı OCR satırını bölgesel kopya sayar', () => {
    const fullPage = {
      text: 'Netanyahu Türkleri kışkırtmaya çalışıyor', confidence: 88,
      x0: 8, y0: 1380, x1: 322, y1: 1450, width: 314, height: 70,
    };
    const sameRegionalLine = {
      ...fullPage, confidence: 94, x0: 10, y0: 1382, x1: 320, y1: 1448, width: 310, height: 66,
    };
    const overlappingDifferentLine = {
      ...sameRegionalLine, text: 'ABD’nin Türkiye büyükelçisi Tom Barrack açıkladı', confidence: 93,
    };

    expect(shouldMergeRegionalOcrLine(fullPage, sameRegionalLine)).toBe(true);
    expect(shouldMergeRegionalOcrLine(fullPage, overlappingDifferentLine)).toBe(false);
  });

  it('düşük güvenli detay satırını aday yapar ama bağımsız doğrulamayı atlamaz', () => {
    const headline = { x0: 100, y0: 20, x1: 400, y1: 70, width: 300, height: 50 };
    const selected = selectStrictDetailLines(headline, [
      { text: 'İşçiler çalışma koşullarını protesto etti.', confidence: 58, x0: 110, y0: 76, x1: 390, y1: 92, width: 280, height: 16 },
    ]);
    expect(selected.map(line => line.text)).toEqual(['İşçiler çalışma koşullarını protesto etti.']);
  });

  it('Gazete Pencere dar sütununda ilk tam cümleyi altı satırda kesmez', () => {
    const headline = { x0: 40, y0: 100, x1: 300, y1: 160, width: 260, height: 60 };
    const texts = [
      'Gazeteci Fatih Altaylı bir süre',
      'önce Cem Küçük ve Tahir Sarıkaya’nın',
      'tutuklandığı soruşturmaya ilişkin',
      'Kütahyalı’nın itirafçı olduğunu',
      'yazmıştı ve anlatılan bilgilerin',
      'iki ismin tutuklanmadığı bilgisini',
      'doğruladığını açıkladı.',
    ];
    const lines = texts.map((text, index) => ({
      text, confidence: 92,
      x0: 45, y0: 168 + index * 22, x1: 295, y1: 186 + index * 22,
      width: 250, height: 18,
    }));
    const selected = selectStrictDetailLines(headline, lines);

    expect(selected).toHaveLength(7);
    expect(selectReliableNewspaperDetailText(selected.map(line => line.text)))
      .toBe('Gazeteci Fatih Altaylı bir süre önce Cem Küçük ve Tahir Sarıkaya’nın tutuklandığı soruşturmaya ilişkin Kütahyalı’nın itirafçı olduğunu yazmıştı ve anlatılan bilgilerin iki ismin tutuklanmadığı bilgisini doğruladığını açıkladı.');
  });
});
