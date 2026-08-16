import { writeSystemLog } from '@otonom/shared-utils';

function clean(value?: string) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export function buildSocialCaption(options: {
  sourceName?: string;
  hook?: string;
  headlines?: string[];
}) {
  const sourceName = clean(options.sourceName);
  const hook = clean(options.hook) || 'Günün öne çıkan haberleri';
  const headlines = (options.headlines || []).map(clean).filter(Boolean).slice(0, 3);
  return [
    hook,
    sourceName ? `${sourceName} gazetesinin öne çıkan gündem başlıkları.` : 'Günün öne çıkan gündem başlıkları.',
    headlines.length ? headlines.map(headline => `• ${headline}`).join('\n') : '',
    '#Gündem #Haber #SonDakika #Türkiye #OTONOM',
  ].filter(Boolean).join('\n\n');
}

export async function shareGeneratedMedia(options: {
  blob: Blob;
  filename: string;
  caption: string;
}) {
  const file = new File([options.blob], options.filename, {
    type: options.blob.type || 'video/mp4',
    lastModified: Date.now(),
  });
  const shareData: ShareData = {
    title: options.caption.split(/\n/)[0] || 'OTONOM',
    text: options.caption,
    files: [file],
  };

  if (typeof navigator.share === 'function' && (!navigator.canShare || navigator.canShare(shareData))) {
    writeSystemLog(`Sistem paylaşımı açılıyor: ${file.name} · ${(file.size / 1024 / 1024).toFixed(1)} MB.`);
    await navigator.share(shareData);
    writeSystemLog('Video sistem paylaşım menüsüne başarıyla aktarıldı.', 'success');
    return 'shared' as const;
  }

  if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(options.caption);
  writeSystemLog('Bu tarayıcı dosyalı paylaşımı desteklemiyor; açıklama panoya kopyalandı.', 'warn');
  return 'clipboard' as const;
}
