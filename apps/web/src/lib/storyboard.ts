import type { RenderConfig } from '@otonom/shared-types';
import type { HermesScript, HermesVideoSlide } from './aiClient';

export type RenderSceneKind = 'cover' | 'content' | 'final' | 'question' | 'outro';

export interface HermesRenderScene extends HermesVideoSlide {
  kind: RenderSceneKind;
}

const LOCALES: Record<string, string> = {
  tr: 'tr-TR',
  en: 'en-US',
  fr: 'fr-FR',
  de: 'de-DE',
  es: 'es-ES',
  ar: 'ar-SA',
  ru: 'ru-RU',
};

const FINAL_LABELS: Record<string, string> = {
  tr: 'SON SÖZ', en: 'FINAL WORDS', fr: 'MOT DE LA FIN', de: 'SCHLUSSWORT',
  es: 'ÚLTIMAS PALABRAS', ar: 'الكلمة الأخيرة', ru: 'ПОСЛЕСЛОВИЕ',
};

const QUESTION_LABELS: Record<string, string> = {
  tr: 'GÜNÜN SORUSU', en: 'QUESTION OF THE DAY', fr: 'QUESTION DU JOUR',
  de: 'FRAGE DES TAGES', es: 'PREGUNTA DEL DÍA', ar: 'سؤال اليوم', ru: 'ВОПРОС ДНЯ',
};

const DEFAULT_QUESTIONS: Record<string, string> = {
  tr: 'Siz bu gelişme hakkında ne düşünüyorsunuz?',
  en: 'What do you think about this development?',
  fr: 'Que pensez-vous de cette évolution ?',
  de: 'Was denken Sie über diese Entwicklung?',
  es: '¿Qué opina de este acontecimiento?',
  ar: 'ما رأيك في هذا التطور؟',
  ru: 'Что вы думаете об этом событии?',
};

export const OUTRO_TEXTS: Record<string, string[]> = {
  tr: ['Abone olmayı,', 'beğenmeyi ve', 'paylaşmayı', 'ihmal etmeyin.'],
  en: ["Don't forget to", 'subscribe, like', 'and share.'],
  fr: ["N'oubliez pas de", 'vous abonner,', 'aimer et partager.'],
  de: ['Vergessen Sie nicht', 'zu abonnieren, liken', 'und zu teilen.'],
  es: ['No olvides', 'suscribirte, dar', 'me gusta y compartir.'],
  ar: ['لا تنسَ', 'الاشتراك والإعجاب', 'والمشاركة.'],
  ru: ['Не забудьте', 'подписаться, лайкнуть', 'и поделиться.'],
};

export const CTA_LABELS: Record<string, { sub: string; like: string; share: string }> = {
  tr: { sub: 'Abone Ol', like: 'Beğen', share: 'Paylaş' },
  en: { sub: 'Subscribe', like: 'Like', share: 'Share' },
  fr: { sub: "S'abonner", like: 'Aimer', share: 'Partager' },
  de: { sub: 'Abonnieren', like: 'Liken', share: 'Teilen' },
  es: { sub: 'Suscribir', like: 'Me gusta', share: 'Compartir' },
  ar: { sub: 'اشتراك', like: 'إعجاب', share: 'مشاركة' },
  ru: { sub: 'Подписка', like: 'Лайк', share: 'Поделиться' },
};

function clean(value?: string) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function ensureSentence(value: string) {
  const text = clean(value);
  if (!text || /[.!?…]$/.test(text)) return text;
  return `${text}.`;
}

function normalizeForComparison(value: string) {
  return clean(value)
    .toLocaleLowerCase('tr-TR')
    .replace(/[^a-z0-9çğıöşü\s]/gi, '')
    .split(/\s+/)
    .filter(word => word.length > 2);
}

function isNearDuplicate(left: string, right: string) {
  const a = new Set(normalizeForComparison(left));
  const b = new Set(normalizeForComparison(right));
  if (!a.size || !b.size) return false;
  let shared = 0;
  a.forEach(word => { if (b.has(word)) shared += 1; });
  return shared / Math.min(a.size, b.size) >= 0.75;
}

function buildCoverNarration(script: HermesScript, config: RenderConfig, now: Date) {
  const locale = LOCALES[config.language] || LOCALES.tr;
  const date = now.toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' });
  const day = now.toLocaleDateString(locale, { weekday: 'long' });
  return ensureSentence([
    `${date} ${day}`,
    clean(config.sourceName || script.sourceName),
    clean(script.thumbnailText),
  ].filter(Boolean).join('. '));
}

export function buildRenderStoryboard(script: HermesScript, config: RenderConfig, now = new Date()): HermesRenderScene[] {
  const language = config.language || 'tr';
  const contentScenes: HermesRenderScene[] = script.videoSlides.map(slide => ({
    ...slide,
    topText: clean(slide.topText),
    spokenText: ensureSentence(slide.spokenText || slide.topText),
    imagePrompts: Array.isArray(slide.imagePrompts) ? slide.imagePrompts : [],
    kind: 'content',
  }));

  const coverTitle = clean(script.thumbnailText || contentScenes[0]?.topText || config.sourceName || 'GÜNDEM');
  const scenes: HermesRenderScene[] = [{
    kind: 'cover',
    topText: coverTitle,
    spokenText: buildCoverNarration(script, config, now) || ensureSentence(coverTitle),
    imagePrompts: [],
  }, ...contentScenes];

  const lastContent = contentScenes.at(-1)?.spokenText || '';
  const requestedFinal = clean(script.sonSoz);
  const finalText = requestedFinal && !isNearDuplicate(requestedFinal, lastContent)
    ? requestedFinal
    : language === 'tr'
      ? 'Gerçeklerin er ya da geç ortaya çıkmak gibi bir huyu vardır.'
      : 'The truth has a way of coming to light.';
  const userComment = clean(config.yorum);
  scenes.push({
    kind: 'final',
    topText: FINAL_LABELS[language] || FINAL_LABELS.tr,
    spokenText: ensureSentence([finalText, userComment].filter(Boolean).join(' ')),
    imagePrompts: [],
  });

  const question = clean(script.gununSorusu);
  if (question) {
    scenes.push({
      kind: 'question',
      topText: QUESTION_LABELS[language] || QUESTION_LABELS.tr,
      spokenText: ensureSentence(question || DEFAULT_QUESTIONS[language] || DEFAULT_QUESTIONS.tr),
      imagePrompts: [],
    });
  }

  const outroLines = OUTRO_TEXTS[language] || OUTRO_TEXTS.tr;
  const callToAction = ensureSentence(outroLines.join(' '));
  const lastQuote = clean(script.lastQuote);
  const outroNarration = lastQuote && !/abone|subscribe|abonn|suscri|اشتراك|подпис/i.test(lastQuote)
    ? `${ensureSentence(lastQuote)} ${callToAction}`
    : (lastQuote ? ensureSentence(lastQuote) : callToAction);
  scenes.push({ kind: 'outro', topText: '', spokenText: outroNarration, imagePrompts: [] });

  return scenes;
}

export function getStoryboardNarration(scenes: HermesRenderScene[]) {
  return scenes.map(scene => clean(scene.spokenText)).filter(Boolean).join(' ');
}

