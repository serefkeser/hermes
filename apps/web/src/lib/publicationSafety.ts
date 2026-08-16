import {
  evaluatePublicationText,
  PUBLICATION_SAFETY_POLICY_VERSION,
  type PublicationRiskCode,
  type PublicationSafetyFinding,
} from '@otonom/shared-utils';
import type { HermesScript, HermesVideoSlide } from './aiClient';

export interface BlockedPublicationItem {
  kind: 'slide' | 'thumbnail' | 'closing' | 'question' | 'user-comment' | 'source-name';
  index?: number;
  sourceHeadlineId?: string;
  codes: PublicationRiskCode[];
  findings: PublicationSafetyFinding[];
}

export interface SecuredPublicationPlan {
  script: HermesScript;
  sourceName: string;
  userComment: string;
  blocked: BlockedPublicationItem[];
  policyVersion: string;
}

export class PublicationSafetyBlockedError extends Error {
  readonly code = 'PUBLICATION_SAFETY_BLOCKED';
  readonly blocked: BlockedPublicationItem[];

  constructor(blocked: BlockedPublicationItem[]) {
    super('Tüm haber sahneleri yayın güvenliği kontrolünde durduruldu. Riskli içerik otomatik olarak yeniden yazılmadı veya paylaşılmadı.');
    this.name = 'PublicationSafetyBlockedError';
    this.blocked = blocked;
  }
}

function findingsFor(values: unknown[]) {
  const findings = values.flatMap(value => evaluatePublicationText(value).findings);
  return findings.filter((finding, index, all) => all.findIndex(item => item.code === finding.code) === index);
}

function blockedItem(
  kind: BlockedPublicationItem['kind'],
  findings: PublicationSafetyFinding[],
  extra: Pick<BlockedPublicationItem, 'index' | 'sourceHeadlineId'> = {},
): BlockedPublicationItem {
  return {
    kind,
    ...extra,
    codes: findings.map(finding => finding.code),
    findings,
  };
}

function safeText(
  value: string | undefined,
  fallback: string,
  kind: BlockedPublicationItem['kind'],
  blocked: BlockedPublicationItem[],
) {
  const findings = findingsFor([value]);
  if (!findings.length) return String(value || '').trim();
  blocked.push(blockedItem(kind, findings));
  return fallback;
}

export function securePublicationPlan(options: {
  script: HermesScript;
  sourceName?: string;
  userComment?: string;
}): SecuredPublicationPlan {
  const blocked: BlockedPublicationItem[] = [];
  const videoSlides: HermesVideoSlide[] = [];

  options.script.videoSlides.forEach((slide, index) => {
    const findings = findingsFor([slide.sourceHeadline, slide.topText, slide.spokenText]);
    if (findings.length) {
      blocked.push(blockedItem('slide', findings, {
        index,
        sourceHeadlineId: slide.sourceHeadlineId,
      }));
      return;
    }
    videoSlides.push(slide);
  });

  if (!videoSlides.length) throw new PublicationSafetyBlockedError(blocked);

  const requestedSourceName = String(options.sourceName || options.script.sourceName || '').trim();
  const sourceFindings = findingsFor([requestedSourceName]);
  const sourceName = sourceFindings.length ? '' : requestedSourceName;
  if (sourceFindings.length) blocked.push(blockedItem('source-name', sourceFindings));

  const fallbackCover = videoSlides[0]?.topText || 'DOĞRULANMIŞ GÜNDEM';
  const thumbnailText = safeText(options.script.thumbnailText, fallbackCover, 'thumbnail', blocked) || fallbackCover;
  const sonSoz = safeText(
    options.script.sonSoz,
    'Doğru haber, doğrulanmış bilgidir.',
    'closing',
    blocked,
  );
  const lastQuote = safeText(
    options.script.lastQuote,
    'Yalnız doğrulayabildiğimiz bilgileri aktardık.',
    'closing',
    blocked,
  );
  const gununSorusu = safeText(options.script.gununSorusu, '', 'question', blocked);
  const userComment = safeText(options.userComment, '', 'user-comment', blocked);

  return {
    script: {
      ...options.script,
      videoSlides,
      thumbnailText,
      sonSoz,
      lastQuote,
      gununSorusu,
      sourceName,
    },
    sourceName,
    userComment,
    blocked,
    policyVersion: PUBLICATION_SAFETY_POLICY_VERSION,
  };
}
