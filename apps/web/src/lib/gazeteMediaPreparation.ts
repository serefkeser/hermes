import type { MediaFile } from '@otonom/shared-types';

function mimeTypeFromLocalUrl(url: string) {
  return url.match(/^data:(image\/[a-z0-9.+-]+)[;,]/i)?.[1] || 'image/jpeg';
}

export async function prepareGazeteMedia(
  input: { id: string; name: string; src: string },
  localize: (src: string) => Promise<string>,
): Promise<{ media: MediaFile; localSrc: string }> {
  const localSrc = await localize(input.src);
  if (!localSrc || /^https?:\/\//i.test(localSrc)) {
    throw new Error(`${input.name} görselinin yerel kopyası oluşturulamadı.`);
  }
  if (/^data:image\/svg\+xml/i.test(localSrc)) {
    throw new Error(`${input.name} için gerçek tam sayfa bulunamadı; yer tutucu görsel kullanılamaz.`);
  }

  return {
    localSrc,
    media: {
      id: input.id,
      name: `${input.name}.jpg`,
      type: 'image',
      mimeType: mimeTypeFromLocalUrl(localSrc),
      size: 0,
      url: localSrc,
      thumbnailUrl: localSrc,
    },
  };
}
