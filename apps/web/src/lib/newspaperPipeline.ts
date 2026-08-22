import { buildNewspaperNarration } from './newspaperCopy';
import {
  buildVerifiedCoverHook,
  groundedNewspaperHook,
  isLikelyCompleteNewspaperHeadline,
  isReliableNewspaperDetail,
} from './newspaperVerification';

export const MIN_NEWSPAPER_STORIES = 2;
export const MAX_NEWSPAPER_STORIES = 6;

export interface VerifiedNewspaperCandidate {
  id: string;
  text: string;
  detail: string;
  confidence: number;
  score: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface NewspaperVideoSlide {
  sourceHeadlineId?: string;
  sourceHeadline?: string;
  topText: string;
  spokenText: string;
  imagePrompts: string[];
}

export interface NewspaperScriptContract {
  isContentUnreadable?: boolean;
  videoSlides: NewspaperVideoSlide[];
  thumbnailText?: string;
  sonSoz?: string;
  gununSorusu?: string;
  lastQuote?: string;
  sourceName?: string;
  gazeteBasliklari?: Array<{
    sourceHeadlineId?: string;
    baslik: string;
    aciklama: string;
    onem?: number;
    x: number;
    y: number;
    w: number;
    h: number;
  }>;
}

function normalize(value: string) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function selectPublishableCandidates(candidates: VerifiedNewspaperCandidate[]) {
  return candidates
    .filter((candidate, index, all) => {
      const id = normalize(candidate.id).toUpperCase();
      return /^H\d+$/.test(id)
        && isLikelyCompleteNewspaperHeadline(candidate.text)
        && isReliableNewspaperDetail(candidate.detail)
        && all.findIndex(item => normalize(item.id).toUpperCase() === id) === index;
    })
    .slice(0, MAX_NEWSPAPER_STORIES);
}

export function assertLockedNewspaperScript(
  script: NewspaperScriptContract,
  candidates: VerifiedNewspaperCandidate[],
  sourceName: string,
) {
  const selected = selectPublishableCandidates(candidates);
  if (selected.length < MIN_NEWSPAPER_STORIES) {
    throw new Error(
      `En az ${MIN_NEWSPAPER_STORIES} bağımsız haberin başlığı ve açıklaması doğrulanamadı; eksik veya yanlış video üretilmedi.`,
    );
  }
  if (script.videoSlides.length !== selected.length) {
    throw new Error('Gazete sahne sözleşmesi bozuldu: her doğrulanmış haber için tam bir sahne gerekir.');
  }

  script.videoSlides.forEach((slide, index) => {
    const candidate = selected[index];
    const expectedNarration = buildNewspaperNarration({
      sourceName,
      headline: candidate.text,
      detail: candidate.detail,
    });
    if (slide.sourceHeadlineId !== candidate.id
      || slide.sourceHeadline !== candidate.text
      || slide.spokenText !== expectedNarration) {
      throw new Error(`Gazete sahne sözleşmesi bozuldu: ${candidate.id} başlığı veya açıklaması değiştirildi.`);
    }
    const hookWords = normalize(slide.topText).split(/\s+/).filter(Boolean);
    if (!hookWords.length || hookWords.length > 4) {
      throw new Error(`Gazete sahne sözleşmesi bozuldu: ${candidate.id} hook metni 1-4 kelime olmalı.`);
    }
  });
}

export function buildLockedNewspaperScript<T extends NewspaperScriptContract>(options: {
  script: T;
  candidates: VerifiedNewspaperCandidate[];
  configuredSourceName?: string;
}): T {
  const selected = selectPublishableCandidates(options.candidates);
  if (selected.length < MIN_NEWSPAPER_STORIES) {
    throw new Error(
      `En az ${MIN_NEWSPAPER_STORIES} bağımsız haberin başlığı ve açıklaması doğrulanamadı; eksik veya yanlış video üretilmedi.`,
    );
  }

  const sourceName = normalize(options.configuredSourceName || options.script.sourceName || 'Gazete');
  const videoSlides = selected.map(candidate => {
    const aiSlide = options.script.videoSlides.find(
      slide => normalize(slide.sourceHeadlineId || '').toUpperCase() === candidate.id,
    );
    return {
      sourceHeadlineId: candidate.id,
      sourceHeadline: candidate.text,
      topText: groundedNewspaperHook(aiSlide?.topText || '', candidate.text),
      spokenText: buildNewspaperNarration({
        sourceName,
        headline: candidate.text,
        detail: candidate.detail,
      }),
      imagePrompts: [],
    };
  });

  const locked = {
    ...options.script,
    isContentUnreadable: false,
    videoSlides,
    thumbnailText: buildVerifiedCoverHook(videoSlides[0]?.sourceHeadline || videoSlides[0]?.topText || 'GÜNDEM'),
    sonSoz: 'Doğru haber, doğrulanmış bilgidir.',
    gununSorusu: '',
    lastQuote: 'Yalnız doğrulayabildiğimiz bilgileri aktardık.',
    sourceName,
    gazeteBasliklari: selected.map((candidate, index) => ({
      sourceHeadlineId: candidate.id,
      baslik: candidate.text,
      aciklama: candidate.detail,
      onem: Math.max(1, 100 - index * 10),
      x: candidate.x,
      y: candidate.y,
      w: candidate.w,
      h: candidate.h,
    })),
  } as T;

  assertLockedNewspaperScript(locked, selected, sourceName);
  return locked;
}
