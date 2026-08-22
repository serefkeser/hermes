import type { AiContentPart, AiMessage } from './providerRouter';

export interface AnalyzeImageInput {
  mimeType: string;
  data: string;
  name?: string;
}

export interface AnalyzeConfig {
  duration?: string;
  language?: string;
  analysisMode?: string;
  videoStyle?: string;
  imageStyle?: string;
  tip?: string;
  sourceName?: string;
  yorum?: string;
}

export interface AnalyzeInput {
  inputType: 'text' | 'url' | 'prompt' | 'media' | 'gazete';
  text?: string;
  images?: AnalyzeImageInput[];
  config?: AnalyzeConfig;
}

function durationInstruction(duration = '30') {
  if (duration === '15') return '15-30 saniye, yaklaşık 4 sahne';
  if (duration === '60') return '60-90 saniye, yaklaşık 9 sahne';
  if (duration === '90') return '90-120 saniye, yaklaşık 13 sahne';
  if (duration === 'unlimited') return 'içerik bitene kadar, en az 10 sahne';
  return '30-60 saniye, yaklaşık 6 sahne';
}

function analysisInstruction(mode = 'yorumsuz') {
  if (mode === 'deep_analysis') {
    return '5N1K yanında toplumsal ve ekonomik etkileri açıkça analiz et; doğrulanmayan bilgiyi kesin hüküm gibi yazma.';
  }
  if (mode === 'visibility') {
    return 'İçeriğin görünürlük ve haber değeri tarafını değerlendir; doğrulanmayan bilgiyi kesin hüküm gibi yazma.';
  }
  return 'Yalnız haberi tarafsız ve yorumsuz anlat; 5N1K kurallarını uygula.';
}

export function buildAnalyzeMessages(input: AnalyzeInput): AiMessage[] {
  const config = input.config || {};
  const isGazete = input.inputType === 'gazete';
  const language = config.language || 'tr';
  const system = `Sen Hermes için dikey kısa haber videosu editörüsün.
Çıktının tamamı geçerli JSON olmalı; Markdown kod bloğu kullanma.
Dil: ${language}.
Hedef: ${durationInstruction(config.duration)}.
Editoryal kural: ${analysisInstruction(config.analysisMode)}
Ekran üstü topText ve thumbnailText en fazla 3 kelime olmalı.
Her spokenText doğal seslendirmeye uygun ve noktalama işaretiyle bitmeli. Gazete modunda her sahne 2-3 kısa, olgusal cümleden ve 35-55 Türkçe kelimeden; diğer modlarda 1-2 cümleden oluşmalı.
Okuyamadığın veya doğrulayamadığın içeriği uydurma; isContentUnreadable=true yap.
Yayın güvenliği zorunludur: Tehdit veya şiddete çağrı, nefret/ayrımcılık, hedef gösterme, hakaret, kişisel veri, çocukların cinsel istismarı, kendine zarar vermeyi teşvik, suç işlemeyi kolaylaştıran talimat, mucize tedavi ya da garantili kazanç vaadi üretme ve alıntı olarak bile tekrar etme.
Bir kişiyi kesinleşmiş mahkeme kararı olmadan suçlu ilan etme. Haber kaynağında yalnız iddia, soruşturma, gözaltı, tutuklama, şüpheli veya sanık bilgisi varsa tam olarak o hukuki statüyü ve açık kaynak atfını koru; daha kesin bir kelimeye dönüştürme. Kaynakta doğrulanamayan suçlama veya kamu güvenliği/genel sağlık iddiasını atla.
Telefon, e-posta, T.C. kimlik numarası, IBAN veya özel adresi topText, spokenText, kapanış ve sosyal medya metnine taşıma.
sonSoz alanı, konuyla doğrudan ilgili kısa ve vurucu bir atasözü veya özlü söz olmalı; son haber cümlesini tekrarlamamalı.
gununSorusu alanı, izleyiciyi tartışmaya davet eden tarafsız ve tek cümlelik bir soru olmalı.
lastQuote alanı kısa bir kapanış cümlesi olmalı; abone ol/beğen/paylaş çağrısını burada tekrarlama, uygulama bunu otomatik ekler.
${isGazete ? `Gazete modu zorunlu kuralları:
1. Yalnız doğrulanmış 5-6 FARKLI HABERİ seç. Beşten az haberin başlığı ve detayı doğrulanabiliyorsa isContentUnreadable=true yap; eksik video üretme. Sayıyı tamamlamak için şüpheli veya okunamayan haber eklemek yasak. Aynı haberi farklı açı, taraf, etki veya yorumlara bölerek birden fazla sahne üretmek kesinlikle yasak.
2. OCR_HEADLINE_CANDIDATES verildiyse her videoSlides öğesi farklı bir H kimliğine bağlanmalı. sourceHeadlineId yalnız H1, H2... kimliklerinden biri ve sourceHeadline o kimliğin text değeriyle aynı olmalı. Aynı H kimliğini ikinci kez kullanmak yasaktır.
3. Sıralama sabittir: önce H1, sonra H2, H3... Büyük ana manşetten küçük başlıklara bu sırayla git; tek bir H kimliğini alt konulara bölme.
4. gazeteBasliklari içinde aynı sourceHeadlineId alanlarını kullan. Her kimlik yalnız bir kez yer almalı; onem alanı H1 için en yüksek olacak biçimde 1-100 arasında olsun.
5. Kapakta tek bir clickbait kullan. Sonraki her haber yalnız bir sahnede, yalnız “özgün başlık + doğrulanmış detail” sırasıyla anlatılmalı. Kaynak adını veya “gazetesinin haberine göre” kalıbını haber sahnelerinde tekrarlama. spokenText içindeki her özel isim, sayı, skor, tarih, yüzde, para ve olgu bağlı H satırının text veya detail alanında birebir bulunmalı. Bulunmayan tek kelimeyi bile tahmin etme; şüpheli haberi atla.
6. Reklam, ilan, bulmaca, tarih, fiyat, gazete logosu/masthead sloganı, “... YAZDI” biçimindeki yazar künyesi, fotoğraf altyazısı ve grafik/istatistik etiketini bağımsız haber sayma. Gazete ilk sayfası devam sahnelerinde sabit kalacağı için imagePrompts boş dizi olmalı.` : ''}

JSON şeması:
{
  "isContentUnreadable": boolean,
  "videoSlides": [{"sourceHeadlineId": string, "sourceHeadline": string, "topText": string, "spokenText": string, "imagePrompts": string[]}],
  "thumbnailText": string,
  "sonSoz": string,
  "gununSorusu": string,
  "lastQuote": string,
  "sourceName": string,
  "gazeteBasliklari": [{"sourceHeadlineId": string, "baslik": string, "aciklama": string, "onem": number, "x": number, "y": number, "w": number, "h": number}]
}`;

  const parts: AiContentPart[] = [];
  const sourceText = input.text?.trim();
  if (sourceText) {
    const prefix = input.inputType === 'url'
      ? 'Haber bağlantısı:'
      : input.inputType === 'prompt'
        ? 'Kullanıcı talimatı:'
        : 'İçerik:';
    parts.push({ type: 'text', text: `${prefix}\n${sourceText}` });
  }
  for (const image of input.images || []) {
    if (image.name) parts.push({ type: 'text', text: `Görsel adı: ${image.name}` });
    parts.push({ type: 'image', mimeType: image.mimeType, data: image.data });
  }
  parts.push({
    type: 'text',
    text: `Kaynak adı: ${config.sourceName || 'belirtilmedi'}\nİçerik türü: ${config.tip || 'haber'}\nVideo stili: ${config.videoStyle || 'cinematic'}\nEk kullanıcı yorumu: ${config.yorum || 'yok'}\nİçeriği analiz et ve yalnız şemaya uyan JSON döndür.`,
  });

  return [
    { role: 'system', content: system },
    { role: 'user', content: parts },
  ];
}
