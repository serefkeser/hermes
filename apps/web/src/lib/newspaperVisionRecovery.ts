import type { VerifiedNewspaperCandidate } from './newspaperPipeline';
import {
  isLikelyCompleteNewspaperHeadline,
  isReliableNewspaperDetail,
  normalizeOcrEvidence,
  newspaperHeadlineRejectionReason,
} from './newspaperVerification';

export interface VisionNewspaperCandidate {
  sourceHeadlineId?: string;
  baslik: string;
  aciklama: string;
  onem?: number;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  localCropEvidence?: string;
}

export interface VisionRecoveryRejection {
  headline: string;
  reason: string;
}

export interface VisionRecoveryResult {
  candidates: VerifiedNewspaperCandidate[];
  recoveredCount: number;
  rejected: VisionRecoveryRejection[];
}

const TURKISH_FOLD: Record<string, string> = {
  'ç': 'c', 'ğ': 'g', 'ı': 'i', 'ö': 'o', 'ş': 's', 'ü': 'u',
};

function fold(value: string) {
  return normalizeOcrEvidence(value).replace(/[çğıöşü]/g, character => TURKISH_FOLD[character] || character);
}

function tokens(value: string) {
  return fold(value).split(/\s+/).filter(Boolean);
}

function exactFacts(value: string) {
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

function tokenMatches(left: string, right: string) {
  if (left === right) return true;
  if (/\d/u.test(left) || /\d/u.test(right) || left.length < 5 || right.length < 5) return false;
  return editDistance(left, right) <= Math.max(1, Math.floor(Math.max(left.length, right.length) * 0.14));
}

function lcsMatchCount(left: string[], right: string[]) {
  const previous = new Array(right.length + 1).fill(0) as number[];
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    let diagonal = 0;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const above = previous[rightIndex];
      previous[rightIndex] = tokenMatches(left[leftIndex - 1], right[rightIndex - 1])
        ? diagonal + 1
        : Math.max(previous[rightIndex], previous[rightIndex - 1]);
      diagonal = above;
    }
  }
  return previous[right.length];
}

function bestEvidenceWindow(proposedText: string, rawOcrText: string) {
  const proposed = tokens(proposedText);
  const evidence = tokens(rawOcrText);
  if (!proposed.length || !evidence.length) return { coverage: 0, factsMatch: false };

  let bestCoverage = 0;
  let bestFactsMatch = false;
  const minimumWindow = Math.max(1, proposed.length - 2);
  const maximumWindow = proposed.length + Math.max(4, Math.ceil(proposed.length * 0.35));
  const proposedFacts = exactFacts(proposedText);
  for (let start = 0; start < evidence.length; start += 1) {
    const window = evidence.slice(start, Math.min(evidence.length, start + maximumWindow));
    if (window.length < minimumWindow) continue;
    const coverage = lcsMatchCount(proposed, window) / proposed.length;
    if (coverage < bestCoverage) continue;
    const windowFacts = new Set(exactFacts(window.join(' ')));
    const factsMatch = proposedFacts.every(fact => windowFacts.has(fact));
    if (coverage > bestCoverage || factsMatch) {
      bestCoverage = coverage;
      bestFactsMatch = factsMatch;
    }
  }
  return { coverage: bestCoverage, factsMatch: bestFactsMatch };
}

function normalizeVisibleText(value: string) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function isDuplicateHeadline(left: string, right: string) {
  const leftTokens = tokens(left);
  const rightTokens = tokens(right);
  if (!leftTokens.length || !rightTokens.length) return false;
  const shared = lcsMatchCount(leftTokens, rightTokens);
  return shared / Math.min(leftTokens.length, rightTokens.length) >= 0.8;
}

function hasRequiredEvidence(proposedText: string, evidenceText: string, minimumCoverage: number) {
  const evidence = bestEvidenceWindow(proposedText, evidenceText);
  return evidence.factsMatch && evidence.coverage >= minimumCoverage;
}

function validateVisionCandidate(candidate: VisionNewspaperCandidate, rawOcrText: string) {
  const headline = normalizeVisibleText(candidate.baslik);
  const detail = normalizeVisibleText(candidate.aciklama);
  const rejectionReason = newspaperHeadlineRejectionReason(headline);
  if (rejectionReason) return rejectionReason;
  if (!isLikelyCompleteNewspaperHeadline(headline)) return 'tam bir haber başlığı değil';
  if (!isReliableNewspaperDetail(detail)) return 'tam bir haber açıklaması değil';

  const headlineTokenCount = tokens(headline).length;
  const requiredHeadlineCoverage = headlineTokenCount <= 4 ? 1 : 0.8;
  const evidenceSources = [candidate.localCropEvidence || '', rawOcrText].filter(Boolean);
  if (!evidenceSources.some(evidence => hasRequiredEvidence(headline, evidence, requiredHeadlineCoverage))) {
    return 'başlık yerel OCR metniyle eşleşmedi';
  }
  if (!evidenceSources.some(evidence => hasRequiredEvidence(detail, evidence, 0.78))) {
    return 'açıklama yerel OCR metniyle eşleşmedi';
  }
  return '';
}

function rawOcrBody(ocrText: string) {
  const marker = 'OCR TAM METİN:';
  const markerIndex = ocrText.indexOf(marker);
  return markerIndex >= 0 ? ocrText.slice(markerIndex + marker.length).trim() : ocrText.trim();
}

/**
 * Tam sayfa görsel analizi yalnız haber bölgelerini ve ilişkilerini önerir.
 * Önerilen başlık ve açıklama, cihazdaki bağımsız OCR metninde yüksek
 * oranda bulunmadan aday listesine giremez. Böylece eski sürümün sayfa
 * anlayışı geri gelirken AI'nin metin veya sayı uydurması engellenir.
 */
export function recoverNewspaperCandidatesFromVision(options: {
  localCandidates: VerifiedNewspaperCandidate[];
  visionCandidates?: VisionNewspaperCandidate[];
  localOcrText: string;
  maximumStories: number;
}): VisionRecoveryResult {
  const evidence = rawOcrBody(options.localOcrText);
  const rejected: VisionRecoveryRejection[] = [];
  const proposals = (options.visionCandidates || [])
    .filter(candidate => candidate && typeof candidate === 'object')
    .sort((left, right) => {
      const importance = Number(right.onem || 0) - Number(left.onem || 0);
      if (importance) return importance;
      return Number(right.w || 0) * Number(right.h || 0) - Number(left.w || 0) * Number(left.h || 0);
    });

  const ordered: Array<VerifiedNewspaperCandidate & { recovered: boolean }> = [];
  for (const proposal of proposals) {
    const headline = normalizeVisibleText(proposal.baslik);
    if (!headline || ordered.some(candidate => isDuplicateHeadline(candidate.text, headline))) continue;
    const localMatch = options.localCandidates.find(candidate => isDuplicateHeadline(candidate.text, headline));
    if (localMatch) {
      ordered.push({ ...localMatch, recovered: false });
      continue;
    }

    const reason = validateVisionCandidate(proposal, evidence);
    if (reason) {
      rejected.push({ headline, reason });
      continue;
    }
    const importance = Math.max(1, Math.min(100, Number(proposal.onem || 1)));
    const width = Math.max(1, Number(proposal.w || 1));
    const height = Math.max(1, Number(proposal.h || 1));
    ordered.push({
      id: '',
      text: headline,
      detail: normalizeVisibleText(proposal.aciklama),
      confidence: 80,
      score: importance * 10_000 + width * height,
      x: Number(proposal.x || 0),
      y: Number(proposal.y || 0),
      w: width,
      h: height,
      recovered: true,
    });
  }

  for (const candidate of options.localCandidates) {
    if (!ordered.some(existing => isDuplicateHeadline(existing.text, candidate.text))) {
      ordered.push({ ...candidate, recovered: false });
    }
  }

  const selected = ordered.slice(0, options.maximumStories);
  return {
    candidates: selected.map((candidate, index) => ({
      ...candidate,
      id: `H${index + 1}`,
    })),
    recoveredCount: selected.filter(candidate => candidate.recovered).length,
    rejected,
  };
}
