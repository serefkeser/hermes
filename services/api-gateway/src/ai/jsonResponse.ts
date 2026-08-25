type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function removeTrailingCommas(text: string) {
  let result = '';
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      result += character;
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      result += character;
      continue;
    }
    if (character === ',') {
      let next = index + 1;
      while (next < text.length && /\s/.test(text[next])) next += 1;
      if (text[next] === '}' || text[next] === ']') continue;
    }
    result += character;
  }

  return result;
}

function extractBalancedObjects(text: string) {
  const objects: string[] = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (start < 0) {
      if (character === '{') {
        start = index;
        depth = 1;
      }
      continue;
    }

    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === '{') depth += 1;
    if (character === '}') depth -= 1;
    if (depth === 0) {
      objects.push(text.slice(start, index + 1));
      start = -1;
    }
  }

  return objects;
}

function unwrapKnownEnvelope(value: unknown): JsonObject | null {
  if (!isObject(value)) return null;
  if (Array.isArray(value.videoSlides)) return value;
  for (const key of ['script', 'data', 'result', 'output']) {
    const nested = value[key];
    if (isObject(nested) && Array.isArray(nested.videoSlides)) return nested;
  }
  return value;
}

function parseCandidate(candidate: string) {
  const attempts = [candidate, removeTrailingCommas(candidate)];
  for (const attempt of attempts) {
    try {
      let parsed: unknown = JSON.parse(attempt);
      if (typeof parsed === 'string' && parsed.trim().startsWith('{')) parsed = JSON.parse(parsed);
      const object = unwrapKnownEnvelope(parsed);
      if (object) return object;
    } catch {
      // Bir sonraki güvenli onarım biçimini dene.
    }
  }
  return null;
}

function scriptScore(value: JsonObject) {
  let score = Object.keys(value).length;
  if (Array.isArray(value.videoSlides)) score += 100 + value.videoSlides.length * 5;
  if (typeof value.thumbnailText === 'string') score += 10;
  if (typeof value.sonSoz === 'string') score += 10;
  if (typeof value.lastQuote === 'string') score += 5;
  return score;
}

function extractStringField(text: string, key: string) {
  const match = text.match(new RegExp(`"${key}"\\s*:\\s*("(?:\\\\.|[^"\\\\])*")`, 'i'));
  if (!match) return '';
  try {
    return JSON.parse(match[1]) as string;
  } catch {
    return '';
  }
}

function salvageTruncatedScript(text: string): JsonObject | null {
  const slidesKey = text.search(/"videoSlides"\s*:/i);
  if (slidesKey < 0) return null;
  const arrayStart = text.indexOf('[', slidesKey);
  if (arrayStart < 0) return null;

  const slides = extractBalancedObjects(text.slice(arrayStart + 1))
    .map(candidate => parseCandidate(candidate))
    .filter((candidate): candidate is JsonObject => Boolean(
      candidate
      && (typeof candidate.spokenText === 'string' || typeof candidate.topText === 'string'),
    ));
  if (!slides.length) return null;

  return {
    isContentUnreadable: /"isContentUnreadable"\s*:\s*true/i.test(text),
    videoSlides: slides,
    thumbnailText: extractStringField(text, 'thumbnailText') || String(slides[0].topText || 'GÜNDEM'),
    sonSoz: extractStringField(text, 'sonSoz') || 'Gerçekler er ya da geç ortaya çıkar.',
    gununSorusu: extractStringField(text, 'gununSorusu'),
    lastQuote: extractStringField(text, 'lastQuote') || 'Gelişmeleri izlemeye devam ediyoruz.',
    sourceName: extractStringField(text, 'sourceName'),
    gazeteBasliklari: [],
  };
}

export function parseAiJsonObject(text: string) {
  const clean = String(text || '')
    .replace(/^\uFEFF/, '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .trim();
  const withoutOuterFence = clean
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  const candidates = [withoutOuterFence, ...extractBalancedObjects(clean)]
    .filter((candidate, index, all) => candidate && all.indexOf(candidate) === index);

  let best: JsonObject | null = null;
  let bestScore = -1;
  for (const candidate of candidates) {
    const parsed = parseCandidate(candidate);
    if (!parsed) continue;
    const score = scriptScore(parsed);
    // Eşit puanda sondaki blok tercih edilir; modeller önce örnek, sonra sonuç yazabiliyor.
    if (score >= bestScore) {
      best = parsed;
      bestScore = score;
    }
  }

  const salvaged = salvageTruncatedScript(clean);
  const bestSlideCount = Array.isArray(best?.videoSlides) ? best.videoSlides.length : 0;
  const salvagedSlideCount = Array.isArray(salvaged?.videoSlides) ? salvaged.videoSlides.length : 0;
  // Kurtarma nesnesindeki varsayılan alanlar puanı yapay biçimde yükseltmemeli;
  // geçerli tam JSON varsa onun gazeteBasliklari gibi alanlarını koru.
  if (salvaged && (!best || salvagedSlideCount > bestSlideCount)) best = salvaged;

  if (!best) throw new Error('AI yanıtı geçerli JSON değil. Diğer ücretsiz sağlayıcı deneniyor.');
  return best;
}

export function validateHermesScriptResponse(text: string) {
  const script = parseAiJsonObject(text);
  const slides = script.videoSlides;
  if (!Array.isArray(slides) || !slides.some(slide => isObject(slide) && (slide.spokenText || slide.topText))) {
    throw new Error('AI JSON yanıtında kullanılabilir videoSlides alanı yok.');
  }
}

function normalizedHeadline(value: unknown) {
  return String(value || '')
    .toLocaleLowerCase('tr-TR')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function validateHermesNewspaperResponse(text: string, allowedCandidateIds: string[] = []) {
  validateHermesScriptResponse(text);
  const script = parseAiJsonObject(text);
  const slides = Array.isArray(script.videoSlides) ? script.videoSlides.filter(isObject) : [];
  const headlines = Array.isArray(script.gazeteBasliklari) ? script.gazeteBasliklari.filter(isObject) : [];
  if (allowedCandidateIds.length > 0) {
    const allowed = new Set(allowedCandidateIds.map(id => id.toUpperCase()));
    const slideIds = new Set(slides.map(slide => String(slide.sourceHeadlineId || '').toUpperCase()).filter(id => allowed.has(id)));
    const headlineIds = new Set(headlines.map(headline => String(headline.sourceHeadlineId || '').toUpperCase()).filter(id => allowed.has(id)));
    const requiredCount = Math.min(5, allowed.size);
    if (slideIds.size < requiredCount || headlineIds.size < requiredCount) {
      throw new Error(`Gazete analizi ${requiredCount} doğrulanmış OCR başlık bölgesine bağlanamadı; diğer sağlayıcı deneniyor.`);
    }
    const distinctSlideHeadlines = new Set(slides.map(slide => normalizedHeadline(slide.sourceHeadline)).filter(Boolean));
    const distinctHeadlines = new Set(headlines.map(headline => normalizedHeadline(headline.baslik)).filter(Boolean));
    if (distinctSlideHeadlines.size < 5 || distinctHeadlines.size < 5) {
      throw new Error('Gazete analizi yerel OCR adayları ve tam görsel bölgeleriyle toplam 5 farklı haberi ayıramadı; diğer sağlayıcı deneniyor.');
    }
    return;
  }
  const distinctSlideHeadlines = new Set(slides.map(slide => normalizedHeadline(slide.sourceHeadline)).filter(Boolean));
  const distinctHeadlines = new Set(headlines.map(headline => normalizedHeadline(headline.baslik)).filter(Boolean));
  if (distinctSlideHeadlines.size < 5 || distinctHeadlines.size < 5) {
    throw new Error('Gazete analizi en az 5 farklı haberi ayıramadı; diğer sağlayıcı deneniyor.');
  }
}
