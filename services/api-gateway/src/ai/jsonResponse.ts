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

