import type { MediaFile } from '@otonom/shared-types';

const MAX_ANALYSIS_IMAGES = 3;

function normalizedMediaName(media: MediaFile) {
  return `${media.type}|${String(media.name || '').toLocaleLowerCase('tr-TR').replace(/\s+/g, ' ').trim()}`;
}

/**
 * Gazete paneli aynı tam sayfayı hem data URL hem uzak URL olarak medya
 * listesine ekleyebiliyor. Yerel OCR zaten ilk tam sayfayı okuduğu için aynı
 * gazeteyi görsel sağlayıcıya iki kez göndermek yalnız payload'ı büyütür.
 */
export function selectAnalysisMedia(
  media: MediaFile[],
  inputType: 'text' | 'url' | 'media' | 'prompt' | 'gazete',
) {
  const visualMedia = media.filter(item => item.type === 'image' || item.type === 'video');
  if (inputType !== 'gazete') return visualMedia.slice(0, MAX_ANALYSIS_IMAGES);

  const seen = new Set<string>();
  const unique = visualMedia.filter(item => {
    const key = normalizedMediaName(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  // Gazete adayları ve koordinatları tek sayfaya aittir. Bir çağrıda yalnız
  // yerel OCR'ın doğruladığı ilk sayfayı analiz ederek sağlayıcı yükünü sınırla.
  return unique.slice(0, 1);
}

export function shouldRetryWithLocalOcr(
  provider: string,
  imageCount: number,
  localOcrText: string,
) {
  return provider === 'local-fallback' && imageCount > 0 && localOcrText.trim().length > 0;
}
