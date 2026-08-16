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

export const MIN_OCR_CONFIDENCE = 72;

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

function exactFactTokens(value: string) {
  return normalizeOcrEvidence(value)
    .match(/(?:%\s*)?\d+(?:[.,]\d+)?(?:-\d+(?:[.,]\d+)?)?|[₺$€£]/g) || [];
}

export function hasStrictOcrConsensus(
  primary: string,
  verification: string,
  primaryConfidence: number,
  verificationConfidence: number,
) {
  if (primaryConfidence < MIN_OCR_CONFIDENCE || verificationConfidence < MIN_OCR_CONFIDENCE) return false;
  const primaryTokens = evidenceTokens(primary);
  const verificationTokens = new Set(evidenceTokens(verification));
  if (primaryTokens.length < 2 || !verificationTokens.size) return false;

  const exactFacts = exactFactTokens(primary);
  const verificationFacts = new Set(exactFactTokens(verification));
  if (exactFacts.some(token => !verificationFacts.has(token))) return false;

  const matched = primaryTokens.filter(token => verificationTokens.has(token)).length;
  return matched / primaryTokens.length >= 0.82;
}

export function selectStrictDetailLines(headline: HeadlineEvidenceBox, lines: OcrEvidenceBox[]) {
  const maxHeight = Math.max(1, headline.height);
  const maxVerticalDistance = Math.max(150, maxHeight * 3.25);
  return lines
    .filter(line => {
      if (line.confidence < MIN_OCR_CONFIDENCE || line.y0 < headline.y1) return false;
      if (line.y0 - headline.y1 > maxVerticalDistance || line.height > maxHeight * 0.82) return false;
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
    .sort((left, right) => left.y0 - right.y0 || left.x0 - right.x0)
    .slice(0, 3);
}

export function groundedNewspaperHook(aiHook: string, headline: string) {
  const headlineTokens = new Set(evidenceTokens(headline));
  const hookWords = String(aiHook || '').replace(/^['"“”‘’]+|['"“”‘’]+$/g, '').split(/\s+/).filter(Boolean).slice(0, 4);
  const hookTokens = evidenceTokens(hookWords.join(' '));
  const isGrounded = hookTokens.length > 0 && hookTokens.every(token => headlineTokens.has(token));
  return (isGrounded ? hookWords : String(headline || '').split(/\s+/).filter(Boolean).slice(0, 4))
    .join(' ')
    .replace(/[,:;.!?]+$/, '')
    .trim();
}

export function buildVerifiedCoverHook(headline: string) {
  const hook = groundedNewspaperHook('', headline).toLocaleUpperCase('tr-TR');
  return hook && !/[!?]$/.test(hook) ? `${hook}!` : hook;
}
