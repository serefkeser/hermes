import { evaluatePublicationText, publicationSafetySummary, writeSystemLog } from '@otonom/shared-utils';

function clean(value?: string) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export function buildSocialCaption(options: {
  sourceName?: string;
  hook?: string;
  headlines?: string[];
}) {
  const sourceName = clean(options.sourceName);
  const requestedHook = clean(options.hook);
  const hook = evaluatePublicationText(requestedHook).allowed
    ? requestedHook || 'Günün doğrulanmış gündemi'
    : 'Günün doğrulanmış gündemi';
  const headlines = (options.headlines || [])
    .map(clean)
    .filter(headline => headline && evaluatePublicationText(
      sourceName ? `${sourceName} kaynağının haberine göre: ${headline}` : headline,
    ).allowed)
    .slice(0, 3);
  const caption = [
    hook,
    sourceName ? `${sourceName} kaynağının haberine göre doğrulanmış gündem başlıkları.` : 'Doğrulanmış gündem başlıkları.',
    headlines.length ? headlines.map(headline => `• ${headline}`).join('\n') : '',
    'Yapay zekâ destekli içerik.',
    '#Gündem #Haber #Türkiye #OTONOM',
  ].filter(Boolean).join('\n\n');
  const safety = evaluatePublicationText(caption);
  if (!safety.allowed) {
    throw new Error(`Sosyal medya açıklaması yayın güvenliği kontrolünde durduruldu: ${publicationSafetySummary(safety)}`);
  }
  return caption;
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
