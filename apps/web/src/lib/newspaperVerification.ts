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
// A low-confidence full-page candidate is never accepted on its own.  Starting
// at 45 lets condensed display fonts reach an independent crop pass;
// selectVerifiedOcrReading still requires that pass to contain every headline
// token and every printed numeric fact.
const MIN_OCR_CANDIDATE_CONFIDENCE = 45;

export interface OcrTextReading {
  text: string;
  confidence: number;
}

export function shouldMergeRegionalOcrLine(existing: OcrEvidenceBox, regional: OcrEvidenceBox) {
  const overlapWidth = Math.max(0, Math.min(existing.x1, regional.x1) - Math.max(existing.x0, regional.x0));
  const overlapHeight = Math.max(0, Math.min(existing.y1, regional.y1) - Math.max(existing.y0, regional.y0));
  const overlapArea = overlapWidth * overlapHeight;
  const smallerArea = Math.min(existing.width * existing.height, regional.width * regional.height);
  const widthRatio = Math.min(existing.width, regional.width) / Math.max(existing.width, regional.width);
  const heightRatio = Math.min(existing.height, regional.height) / Math.max(existing.height, regional.height);
  const existingText = normalizeOcrEvidence(existing.text);
  const regionalText = normalizeOcrEvidence(regional.text);
  const samePrintedLine = existingText === regionalText
    || (hasStrictOcrConsensus(existing.text, regional.text, existing.confidence, regional.confidence)
      && hasStrictOcrConsensus(regional.text, existing.text, regional.confidence, existing.confidence));
  return samePrintedLine
    && overlapArea / Math.max(1, smallerArea) >= 0.62
    && widthRatio >= 0.55
    && heightRatio >= 0.55;
}

export function shouldGroupNewspaperHeadlineLines(
  previous: Pick<OcrEvidenceBox, 'text' | 'x0' | 'x1' | 'y0' | 'y1' | 'width' | 'height'>,
  current: Pick<OcrEvidenceBox, 'text' | 'x0' | 'x1' | 'y0' | 'y1' | 'width' | 'height'>,
) {
  const verticalGap = current.y0 - previous.y1;
  const overlap = Math.max(0, Math.min(current.x1, previous.x1) - Math.max(current.x0, previous.x0))
    / Math.max(1, Math.min(current.width, previous.width));
  const heightRatio = Math.min(current.height, previous.height) / Math.max(current.height, previous.height);
  const widthRatio = Math.min(current.width, previous.width) / Math.max(current.width, previous.width);
  const bothDisplayHeadlineLines = uppercaseRatio(previous.text) >= 0.72
    && uppercaseRatio(current.text) >= 0.72
    && evidenceTokens(previous.text).length <= 6
    && evidenceTokens(current.text).length <= 6;
  // A newspaper detail/spot often starts immediately below its headline.  The
  // old 0.45 ratio therefore chained the first detail line into the headline
  // on dense front pages (for example Cumhuriyet), and the resulting 15+
  // token block was rejected as an invalid headline.  Wrapped headline lines
  // keep substantially similar glyph heights; body copy does not.
  return verticalGap >= -Math.min(current.height, previous.height) * 0.3
    && verticalGap <= Math.max(current.height, previous.height) * 0.9
    && overlap >= 0.3
    && heightRatio >= (bothDisplayHeadlineLines ? 0.35 : 0.62)
    && widthRatio >= 0.52;
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

export function isNewspaperHeadlineContinuationLine(
  text: string,
  confidence: number,
  height: number,
  maximumLineHeight: number,
) {
  const tokens = evidenceTokens(text);
  return tokens.length === 1
    && tokens[0].replace(/\d/g, '').length >= 5
    && confidence >= MIN_OCR_CONFIDENCE
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

interface VerifiedSpatialHeadline extends RankedHeadlineEvidenceBox {
  confidence: number;
  detail?: string;
}

function headlineFactCount(value: string) {
  return exactFactTokens(value).length;
}

function headlineTokenCount(value: string) {
  return evidenceTokens(value).length;
}

function preferMoreCompleteSpatialReading<T extends VerifiedSpatialHeadline>(left: T, right: T) {
  const leftFacts = headlineFactCount(left.text);
  const rightFacts = headlineFactCount(right.text);
  if (leftFacts !== rightFacts) return leftFacts > rightFacts ? left : right;
  const leftTokens = headlineTokenCount(left.text);
  const rightTokens = headlineTokenCount(right.text);
  if (leftTokens !== rightTokens) return leftTokens > rightTokens ? left : right;
  if (left.confidence !== right.confidence) return left.confidence > right.confidence ? left : right;
  return left.score >= right.score ? left : right;
}

/**
 * Örtüşmeli bölgesel OCR aynı basılı başlığı bir sayı veya kelime eksikliğiyle
 * ikinci kez döndürebilir. Yalnız aynı fiziksel alanı ve aynı açıklamayı işaret
 * eden kopyaları birleştirir; sayı içeren daha eksiksiz basılı okumayı korur.
 */
export function collapseSpatialDuplicateNewspaperHeadlines<T extends VerifiedSpatialHeadline>(candidates: T[]) {
  const collapsed: T[] = [];
  for (const candidate of candidates) {
    const duplicateIndex = collapsed.findIndex(existing => {
      const overlapWidth = Math.max(0, Math.min(existing.x1, candidate.x1) - Math.max(existing.x0, candidate.x0));
      const overlapHeight = Math.max(0, Math.min(existing.y1, candidate.y1) - Math.max(existing.y0, candidate.y0));
      const overlapArea = overlapWidth * overlapHeight;
      const smallerArea = Math.min(existing.width * existing.height, candidate.width * candidate.height);
      if (overlapArea / Math.max(1, smallerArea) < 0.72) return false;

      const existingDetail = normalizeOcrEvidence(existing.detail || '');
      const candidateDetail = normalizeOcrEvidence(candidate.detail || '');
      if (existingDetail && candidateDetail && existingDetail === candidateDetail) return true;

      const existingTokens = new Set(evidenceTokens(existing.text));
      const candidateTokens = new Set(evidenceTokens(candidate.text));
      const shared = [...existingTokens].filter(token => candidateTokens.has(token)).length;
      return shared / Math.max(1, Math.min(existingTokens.size, candidateTokens.size)) >= 0.8;
    });
    if (duplicateIndex < 0) collapsed.push(candidate);
    else collapsed[duplicateIndex] = preferMoreCompleteSpatialReading(collapsed[duplicateIndex], candidate);
  }
  return collapsed.sort((left, right) => right.score - left.score);
}

export function isReliableNewspaperDetail(value: string) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  const tokens = evidenceTokens(text);
  if (tokens.length < 4 || tokens.length > 48) return false;
  if (/^[“"'(\[]*\p{Ll}/u.test(text)) return false;
  const hasTerminalPunctuation = /[.!?…]["'”’)]?$/.test(text);
  // Gazete spotları çoğu zaman noktasız, tek satırlık bir yüklemle biter. Böyle
  // bir satırı uydurarak tamamlamak yerine yalnız basılı ve çekimli yüklemi olan
  // doğrulanmış parçayı aynen kullanırız.
  if (/[:;\-–—]$/.test(text)) return false;
  if (!hasTerminalPunctuation && !hasFiniteHeadlineVerb([tokens.at(-1) || ''])) return false;
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
  const primaryTokens = evidenceTokens(primary).map(token => token.replace(/-$/u, ''));
  const verificationTokens = evidenceTokens(verification).map(token => token.replace(/-$/u, ''));
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
  if (!primary.text || primary.confidence < MIN_OCR_CANDIDATE_CONFIDENCE) return '';
  const verifications = verificationReadings
    .map(reading => ({
      text: String(reading.text || '').replace(/\s+/g, ' ').trim(),
      confidence: reading.confidence,
    }))
    .filter(reading => reading.text && reading.confidence >= 45);

  const primaryCorroboration = primary.confidence >= MIN_OCR_CONFIDENCE
    ? verifications.find(reading => hasStrictOcrConsensus(
      primary.text,
      reading.text,
      primary.confidence,
      reading.confidence,
    ))
    : undefined;
  if (primaryCorroboration) {
    return primaryCorroboration.confidence > primary.confidence
      ? primaryCorroboration.text
      : primary.text;
  }

  // Full-page OCR and cropped OCR are independent segmentations. Dense front
  // pages often make the full-page confidence modest while the crop correctly
  // contains the headline plus a masthead fragment or the first body line.
  // Consensus is intentionally asymmetric here: every primary headline token
  // (and every numeric fact) must occur in the strong crop, but unrelated crop
  // edge noise must not invalidate the printed headline. Preserve the primary
  // wording so that crop noise is never spoken.
  const strongLowConfidenceCorroboration = verifications.find(reading => (
    reading.confidence >= MIN_OCR_CONFIDENCE
    && hasStrictOcrConsensus(
      primary.text,
      reading.text,
      MIN_OCR_CONFIDENCE,
      reading.confidence,
    )
  ));
  if (strongLowConfidenceCorroboration) return primary.text;

  for (let leftIndex = 0; leftIndex < verifications.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < verifications.length; rightIndex += 1) {
      const left = verifications[leftIndex];
      const right = verifications[rightIndex];
      if (readingsMutuallyAgree(left, right)) {
        const selected = left.confidence >= right.confidence ? left : right;
        const primaryFacts = exactFactTokens(primary.text);
        const selectedFacts = new Set(exactFactTokens(selected.text));
        if (primaryFacts.some(token => !selectedFacts.has(token))) continue;
        return selected.text;
      }
    }
  }
  return '';
}

export function joinVerifiedNewspaperDetailLines(lines: string[]) {
  let joined = '';
  for (const value of lines) {
    const line = String(value || '').replace(/\s+/g, ' ').trim();
    if (!line) continue;
    const firstToken = line.match(/^([\p{L}]+(?:['’][\p{L}]+)?)/u)?.[1] || '';
    const isLikelyWrappedSuffix = /^(?:gür|ti['’]?[a-zçğıöşü]*|meler|malar|rine|rına|lik|lık|luk|lük|men|man|ları|leri)$/iu.test(firstToken);
    const trailingFragment = joined.match(/([\p{L}]{2,6})[:]?$/u)?.[1] || '';
    if (/[-–—]$/.test(joined)) joined = `${joined.slice(0, -1)}${line}`;
    else if (isLikelyWrappedSuffix && trailingFragment) {
      joined = `${joined.replace(/[:]?$/u, '')}${line}`;
    } else joined = [joined, line].filter(Boolean).join(' ');
  }
  return joined.replace(/\s+/g, ' ').trim();
}

export function selectReliableNewspaperDetailText(lines: string[]) {
  for (let count = 1; count <= lines.length; count += 1) {
    const joined = joinVerifiedNewspaperDetailLines(lines.slice(0, count));
    const firstSentence = joined.match(/^.*?[.!?…](?=(?:["'”’)]?)(?:\s|$))/u)?.[0]
      .replace(/\s+/g, ' ')
      .trim();
    if (firstSentence && isReliableNewspaperDetail(firstSentence)) return firstSentence;

    const withoutPageDirection = joined
      .replace(/\s+(?:s(?:ayfa)?\.?\s*)?\d{1,2}'?(?:de|da|te|ta)\.?$/iu, '')
      .trim();
    if (isReliableNewspaperDetail(withoutPageDirection)) return withoutPageDirection;
  }
  return '';
}

/**
 * Dar gazete sütunlarında SPARSE_TEXT aynı basılı satırı birkaç parçaya
 * ayırabilir. Satır satır doğrulama tamamlanamazsa aynı sütunun bütün paragraf
 * kırpmasını bağımsız OCR kanıtı olarak kullanır. Başlık doğrulamasındaki sayı
 * ve kelime korumaları aynen geçerlidir; yalnız tamamlanmış ilk cümle döner.
 */
export function selectVerifiedNewspaperDetailBlock(
  primaryLines: OcrTextReading[],
  verificationReadings: OcrTextReading[],
) {
  const usablePrimaryLines = primaryLines.filter(reading => reading.text.trim());
  if (!usablePrimaryLines.length) return '';
  const primaryText = joinVerifiedNewspaperDetailLines(usablePrimaryLines.map(reading => reading.text));
  const primaryConfidence = Math.min(...usablePrimaryLines.map(reading => reading.confidence));
  const verifiedText = selectVerifiedOcrReading(primaryText, primaryConfidence, verificationReadings);
  return verifiedText ? selectReliableNewspaperDetailText([verifiedText]) : '';
}

export function selectStrictDetailLineGroups(headline: HeadlineEvidenceBox, lines: OcrEvidenceBox[]) {
  const maxHeight = Math.max(1, headline.height);
  // Dar gazete sütunlarında tek bir tam cümle 7-10 basılı satıra
  // yayılabiliyor.  Önceki 140 px / 6 satır sınırı cümleyi ortadan kesiyor ve
  // doğru başlık-detay çiftini reddediyordu. Yatay hizalama ve satır sürekliliği
  // hâlâ zorunlu; yalnız aynı sütundaki ilk tam cümleye daha fazla alan verilir.
  const maxVerticalDistance = Math.max(260, maxHeight * 2.5);
  const eligible = lines
    .filter(line => {
      if (line.confidence < MIN_OCR_CANDIDATE_CONFIDENCE || line.y0 < headline.y1) return false;
      if (line.y0 - headline.y1 > maxVerticalDistance || line.height > maxHeight * 0.72) return false;
      const substantialWords = evidenceTokens(line.text).filter(token => token.replace(/\d/g, '').length >= 2);
      if (substantialWords.length < 2) return false;
      if (substantialWords.length === 2
        && substantialWords.some(token => token.replace(/[^\p{L}\p{N}]/gu, '').length < 3)) return false;
      const overlap = Math.max(0, Math.min(headline.x1, line.x1) - Math.max(headline.x0, line.x0));
      const lineContainment = overlap / Math.max(1, line.width);
      const center = (line.x0 + line.x1) / 2;
      return lineContainment >= 0.88
        && center >= headline.x0
        && center <= headline.x1
        && line.width <= headline.width * 1.15;
    })
    .sort((left, right) => left.y0 - right.y0 || left.x0 - right.x0);

  const groups: OcrEvidenceBox[][] = [];
  for (const line of eligible) {
    let bestGroup: OcrEvidenceBox[] | undefined;
    let bestAlignment = -Infinity;
    for (const group of groups) {
      const previous = group.at(-1);
      if (!previous || group.length >= 12) continue;
      const gap = line.y0 - previous.y1;
      const overlap = Math.max(0, Math.min(line.x1, previous.x1) - Math.max(line.x0, previous.x0))
        / Math.max(1, Math.min(line.width, previous.width));
      const leftAlignment = Math.abs(line.x0 - previous.x0);
      const allowedGap = Math.max(10, previous.height * 0.9);
      const allowedLeftDrift = Math.max(18, Math.min(line.width, previous.width) * 0.16);
      if (gap >= -Math.min(line.height, previous.height) * 0.25
        && gap <= allowedGap
        && overlap >= 0.72
        && leftAlignment <= allowedLeftDrift) {
        const alignment = overlap - leftAlignment / Math.max(1, headline.width) - gap / Math.max(1, maxHeight);
        if (alignment > bestAlignment) {
          bestAlignment = alignment;
          bestGroup = group;
        }
      }
    }
    if (bestGroup) bestGroup.push(line);
    else if (line.y0 - headline.y1 <= Math.max(24, maxHeight * 0.55)) groups.push([line]);
  }

  return groups
    .filter(group => group.length > 0)
    .sort((left, right) => {
      const leftReliable = selectReliableNewspaperDetailText(left.map(line => line.text)) ? 1 : 0;
      const rightReliable = selectReliableNewspaperDetailText(right.map(line => line.text)) ? 1 : 0;
      return rightReliable - leftReliable
        || (left[0]?.y0 || 0) - (right[0]?.y0 || 0)
        || (left[0]?.x0 || 0) - (right[0]?.x0 || 0)
        || right.length - left.length;
    });
}

export function selectStrictDetailLines(headline: HeadlineEvidenceBox, lines: OcrEvidenceBox[]) {
  return selectStrictDetailLineGroups(headline, lines)[0] || [];
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
