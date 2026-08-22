export interface OcrEvidenceBox {
  text: string;
  confidence: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  width: number;
  height: number;
}

export interface HeadlineEvidenceBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  width: number;
  height: number;
}

export interface RankedHeadlineEvidenceBox extends HeadlineEvidenceBox {
  text: string;
  score: number;
}

export const MIN_OCR_CONFIDENCE = 72;

export interface OcrTextReading {
  text: string;
  confidence: number;
}

export function normalizeOcrEvidence(value: string) {
  return String(value || '')
    .toLocaleLowerCase('tr-TR')
    .replace(/[–—−]/g, '-')
    .replace(/[^a-z0-9çğıöşü%₺$€£-]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function evidenceTokens(value: string) {
  return normalizeOcrEvidence(value).split(/\s+/).filter(Boolean);
}

function uppercaseRatio(value: string) {
  const letters = String(value || '').match(/\p{L}/gu) || [];
  const uppercase = String(value || '').match(/\p{Lu}/gu) || [];
  return letters.length ? uppercase.length / letters.length : 0;
}

export function isProminentSingleWordLine(
  text: string,
  confidence: number,
  height: number,
  maximumLineHeight: number,
) {
  const tokens = evidenceTokens(text);
  return tokens.length === 1
    && tokens[0].replace(/\d/g, '').length >= 5
    && confidence >= MIN_OCR_CONFIDENCE
    && uppercaseRatio(text) >= 0.72
    && height >= Math.max(12, maximumLineHeight * 0.12);
}

function hasFiniteHeadlineVerb(tokens: string[]) {
  return tokens.some(token => /(?:dı|di|du|dü|tı|ti|tu|tü|yor|acak|ecek|mış|miş|muş|müş|landı|lendi|oldu|öldü|kaldı|başladı|bitti|açıkladı|söyledi|değerlendirdi|uyardı|arttı|azaldı|alım|elim|grevde)$/u.test(token));
}

export function newspaperHeadlineRejectionReason(value: string) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  const normalized = normalizeOcrEvidence(text);
  const tokens = evidenceTokens(text);
  if (!normalized) return 'boş metin';
  if (/\b(?:yazdı|yazıyor|kaleme aldı|yorumladı|değerlendirdi|hazırladı|çizdi)$/u.test(normalized)) {
    return 'yazar/köşe yazısı künyesi';
  }
  if (/^(?:halkın|ulusun|türkiyenin|bağımsız|özgür) gazetesi$/u.test(normalized)
    || /^(?:günlük|haftalık) (?:bağımsız )?gazete$/u.test(normalized)
    || /^(?:gazete|gazetesi|birgün tv|günün yazısı|köşe yazısı)$/u.test(normalized)) {
    return 'gazete künyesi veya bölüm etiketi';
  }
  if (/^(?:günde|haftada|ayda|yılda) (?:\d+|yüz|bin|milyon|milyar)\b/u.test(normalized)
    && !hasFiniteHeadlineVerb(tokens)) {
    return 'grafik veya istatistik etiketi';
  }
  return '';
}

export function isLikelyCompleteNewspaperHeadline(value: string) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  const tokens = evidenceTokens(text);
  if (newspaperHeadlineRejectionReason(text)) return false;
  if (tokens.length < 2 || tokens.length > 14) return false;
  const first = tokens[0];
  const last = tokens.at(-1) || '';
  if (['ve', 'ile', 'için', 'göre', 'olarak', 'ancak'].includes(last)) return false;
  if (/(?:mada|mede)$/u.test(last) || /-$/.test(text) || /\b(?:sayfa\s*)?\d+'?(?:de|da|te|ta)$/u.test(last)) return false;
  if (/[.!?…:]\s+\S/u.test(text)) return false;

  const hasVerb = hasFiniteHeadlineVerb(tokens);
  const startsAsNameFragment = ['bakanı', 'başkanı', 'başkan', 'prof', 'profdr', 'dr'].includes(first);
  if (startsAsNameFragment && !hasVerb) return false;
  if (uppercaseRatio(text) < 0.58 && tokens.length < 3 && !hasVerb) return false;
  return true;
}

export function filterIndependentNewspaperHeadlines<T extends RankedHeadlineEvidenceBox>(candidates: T[]) {
  return candidates.filter((candidate, candidateIndex) => !candidates.some((parent, parentIndex) => {
    if (candidateIndex === parentIndex || parent.score <= candidate.score * 1.65) return false;
    if (candidate.y0 < parent.y1) return false;
    const verticalGap = candidate.y0 - parent.y1;
    if (verticalGap > Math.max(100, parent.height * 1.25)) return false;
    const overlap = Math.max(0, Math.min(candidate.x1, parent.x1) - Math.max(candidate.x0, parent.x0));
    const containment = overlap / Math.max(1, candidate.width);
    return containment >= 0.68;
  }));
}

export function isReliableNewspaperDetail(value: string) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  const tokens = evidenceTokens(text);
  if (tokens.length < 4 || tokens.length > 48) return false;
  const hasTerminalPunctuation = /[.!?…]["'”’)]?$/.test(text);
  // Gazete spotları çoğu zaman noktasız, tek satırlık bir yüklemle biter. Böyle
  // bir satırı uydurarak tamamlamak yerine yalnız basılı ve çekimli yüklemi olan
  // doğrulanmış parçayı aynen kullanırız.
  if (!hasTerminalPunctuation && !hasFiniteHeadlineVerb(tokens)) return false;
  const last = tokens.at(-1) || '';
  if (['ve', 'ile', 'için', 'göre', 'olarak', 'ancak', 'çünkü'].includes(last)) return false;
  if (/(?:mada|mede)$/u.test(last) || /-$/.test(text) || /\b(?:sayfa\s*)?\d+'?(?:de|da|te|ta)$/u.test(last)) return false;
  const letters = (text.match(/\p{L}/gu) || []).length;
  if (letters / Math.max(1, text.length) < 0.62) return false;
  const wordTokens = tokens.filter(token => token.replace(/\d/g, '').length >= 3);
  const withVowel = wordTokens.filter(token => /[aeıioöuü]/u.test(token));
  if (wordTokens.length && withVowel.length / wordTokens.length < 0.82) return false;
  if (/(\p{L})\1{3,}/iu.test(text)) return false;
  return true;
}

function exactFactTokens(value: string) {
  return normalizeOcrEvidence(value)
    .match(/(?:%\s*)?\d+(?:[.,]\d+)?(?:-\d+(?:[.,]\d+)?)?|[₺$€£]/g) || [];
}

function editDistance(left: string, right: string) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    let diagonal = previous[0];
    previous[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const above = previous[rightIndex];
      previous[rightIndex] = Math.min(
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + 1,
        diagonal + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return previous[right.length];
}

function allTokensHaveIndependentConsensus(primaryTokens: string[], verificationTokens: string[]) {
  const remaining = [...verificationTokens];
  return primaryTokens.every(primaryToken => {
    const matchIndex = remaining.findIndex(verificationToken => {
      if (primaryToken === verificationToken) return true;
      if (/\d/u.test(primaryToken) || primaryToken.length < 5 || verificationToken.length < 5) return false;
      return editDistance(primaryToken, verificationToken) <= Math.max(1, Math.floor(primaryToken.length * 0.16));
    });
    if (matchIndex < 0) return false;
    remaining.splice(matchIndex, 1);
    return true;
  });
}

export function hasStrictOcrConsensus(
  primary: string,
  verification: string,
  primaryConfidence: number,
  verificationConfidence: number,
) {
  // The second pass reads only the cropped headline. Its aggregate confidence can
  // be lower on very large condensed fonts even when every word is the same.
  // Keep the primary pass strict, but let exact token evidence rescue that crop.
  if (primaryConfidence < MIN_OCR_CONFIDENCE || verificationConfidence < 45) return false;
  const primaryTokens = evidenceTokens(primary);
  const verificationTokens = evidenceTokens(verification);
  if (primaryTokens.length < 2 || !verificationTokens.length) return false;

  const exactFacts = exactFactTokens(primary);
  const verificationFacts = new Set(exactFactTokens(verification));
  if (exactFacts.some(token => !verificationFacts.has(token))) return false;

  return allTokensHaveIndependentConsensus(primaryTokens, verificationTokens);
}

function readingsMutuallyAgree(left: OcrTextReading, right: OcrTextReading) {
  if (left.confidence < MIN_OCR_CONFIDENCE || right.confidence < MIN_OCR_CONFIDENCE) return false;
  return hasStrictOcrConsensus(left.text, right.text, left.confidence, right.confidence)
    && hasStrictOcrConsensus(right.text, left.text, right.confidence, left.confidence);
}

/**
 * Bir metni ancak üç farklı sayfa-segmentasyonu içindeki en az iki okuma
 * destekliyorsa döndürür. İlk tam-sayfa okuması doğrulanırsa onun özgün yazımı
 * korunur; değilse iki yüksek güvenli kırpma aynı metinde birleşirse düzeltme
 * tahmin edilmeden o ortak kırpma kullanılır.
 */
export function selectVerifiedOcrReading(
  primaryText: string,
  primaryConfidence: number,
  verificationReadings: OcrTextReading[],
) {
  const primary = { text: String(primaryText || '').replace(/\s+/g, ' ').trim(), confidence: primaryConfidence };
  if (!primary.text || primary.confidence < MIN_OCR_CONFIDENCE) return '';
  const verifications = verificationReadings
    .map(reading => ({
      text: String(reading.text || '').replace(/\s+/g, ' ').trim(),
      confidence: reading.confidence,
    }))
    .filter(reading => reading.text && reading.confidence >= 45);

  const primaryCorroboration = verifications.find(reading => hasStrictOcrConsensus(
    primary.text,
    reading.text,
    primary.confidence,
    reading.confidence,
  ));
  if (primaryCorroboration) return primary.text;

  for (let leftIndex = 0; leftIndex < verifications.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < verifications.length; rightIndex += 1) {
      const left = verifications[leftIndex];
      const right = verifications[rightIndex];
      if (readingsMutuallyAgree(left, right)) {
        return left.confidence >= right.confidence ? left.text : right.text;
      }
    }
  }
  return '';
}

export function selectStrictDetailLines(headline: HeadlineEvidenceBox, lines: OcrEvidenceBox[]) {
  const maxHeight = Math.max(1, headline.height);
  const maxVerticalDistance = Math.max(48, maxHeight * 1.2);
  const eligible = lines
    .filter(line => {
      if (line.confidence < MIN_OCR_CONFIDENCE || line.y0 < headline.y1) return false;
      if (line.y0 - headline.y1 > maxVerticalDistance || line.height > maxHeight * 0.72) return false;
      const substantialWords = evidenceTokens(line.text).filter(token => token.replace(/\d/g, '').length >= 2);
      if (substantialWords.length < 3) return false;
      const overlap = Math.max(0, Math.min(headline.x1, line.x1) - Math.max(headline.x0, line.x0));
      const lineContainment = overlap / Math.max(1, line.width);
      const center = (line.x0 + line.x1) / 2;
      return lineContainment >= 0.88
        && center >= headline.x0
        && center <= headline.x1
        && line.width <= headline.width * 1.15;
    })
    .sort((left, right) => left.y0 - right.y0 || left.x0 - right.x0);

  const selected: OcrEvidenceBox[] = [];
  for (const line of eligible) {
    const previous = selected.at(-1);
    const gap = previous ? line.y0 - previous.y1 : line.y0 - headline.y1;
    const allowedGap = previous
      ? Math.max(10, previous.height * 0.9)
      : Math.max(24, maxHeight * 0.55);
    if (gap > allowedGap) break;
    selected.push(line);
    if (selected.length === 5) break;
  }
  return selected;
}

export function groundedNewspaperHook(aiHook: string, headline: string) {
  const headlineTokens = new Set(evidenceTokens(headline));
  const neutralQuestionParticles = new Set(['mi', 'mı', 'mu', 'mü']);
  const hookWords = String(aiHook || '').replace(/^['"“”‘’]+|['"“”‘’]+$/g, '').split(/\s+/).filter(Boolean).slice(0, 4);
  const hookTokens = evidenceTokens(hookWords.join(' '));
  const isGrounded = hookTokens.length > 0
    && hookTokens.every(token => headlineTokens.has(token) || neutralQuestionParticles.has(token));
  return (isGrounded ? hookWords : String(headline || '').split(/\s+/).filter(Boolean).slice(0, 4))
    .join(' ')
    .replace(/[,:;.!?]+$/, '')
    .trim();
}

export function buildVerifiedCoverHook(headline: string) {
  const hook = groundedNewspaperHook('', headline).toLocaleUpperCase('tr-TR');
  return hook && !/[!?]$/.test(hook) ? `${hook}!` : hook;
}
