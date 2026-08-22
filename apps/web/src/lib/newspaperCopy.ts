function clean(value?: string) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function ensureSentence(value: string) {
  const text = clean(value);
  if (!text || /[.!?…:]$/.test(text)) return text;
  return `${text}.`;
}

function normalizeForComparison(value: string) {
  return clean(value).toLocaleLowerCase('tr-TR').replace(/[^a-z0-9çğıöşü]+/gi, ' ').trim();
}

export function limitNewspaperHook(value: string, fallback: string) {
  const selected = clean(value) || clean(fallback);
  return selected
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 4)
    .join(' ')
    .replace(/[,:;.!?]+$/, '')
    .trim();
}

export function buildNewspaperNarration(options: {
  sourceName?: string;
  headline: string;
  detail?: string;
  fallbackDetail?: string;
  maxWords?: number;
}) {
  const sourceName = clean(options.sourceName);
  const headline = clean(options.headline);
  let detail = clean(options.detail) || clean(options.fallbackDetail);
  const normalizedHeadline = normalizeForComparison(headline);
  const normalizedDetail = normalizeForComparison(detail);
  if (normalizedHeadline && normalizedDetail.startsWith(normalizedHeadline)) {
    detail = clean(detail.slice(headline.length).replace(/^[\s.,:;!?–—-]+/, ''));
  }

  const sourceIntro = sourceName && !/^gazete$/i.test(sourceName)
    ? `${sourceName} gazetesinin haberine göre`
    : 'Gazete manşeti';
  const narration = [sourceIntro, headline, detail]
    .filter(Boolean)
    .map(ensureSentence)
    .join(' ');
  const words = narration.split(/\s+/).filter(Boolean);
  if (options.maxWords && words.length > options.maxWords) {
    throw new Error('Gazete anlatımı kelime sınırına sığmadı; cümle yarıda kesilmedi.');
  }
  const result = words.join(' ').trim();
  return ensureSentence(result);
}
