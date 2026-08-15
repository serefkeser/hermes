// Media utilities

export function getMimeType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  const mimeTypes: Record<string, string> = {
    // Images
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    avif: 'image/avif',
    bmp: 'image/bmp',
    tiff: 'image/tiff',
    svg: 'image/svg+xml',
    // Videos
    mp4: 'video/mp4',
    webm: 'video/webm',
    mov: 'video/quicktime',
    avi: 'video/x-msvideo',
    mkv: 'video/x-matroska',
    // Audio
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    flac: 'audio/flac',
    m4a: 'audio/mp4',
    aac: 'audio/aac',
    wma: 'audio/x-ms-wma',
  };
  return mimeTypes[ext || ''] || 'application/octet-stream';
}

export function getMediaType(mimeType: string): 'image' | 'video' | 'audio' | 'unknown' {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  return 'unknown';
}

export function isValidMediaType(mimeType: string, allowedTypes: string[]): boolean {
  return allowedTypes.some(t => mimeType.startsWith(t));
}

export function fileToBase64(file: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function base64ToBlob(base64: string, mimeType?: string): Blob {
  const [header, data] = base64.split(',');
  const type = mimeType || (header.match(/:(.*?);/) ? header.match(/:(.*?);/)?.[1] : 'application/octet-stream') || 'application/octet-stream';
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type });
}

export function dataUrlToBlob(dataUrl: string): Blob {
  return base64ToBlob(dataUrl);
}

export async function compressImage(
  file: File | Blob,
  maxWidth = 1080,
  quality = 0.7,
  mimeType = 'image/jpeg'
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let w = img.width;
        let h = img.height;
        if (w > maxWidth || h > maxWidth) {
          if (w > h) {
            h = Math.round((h / w) * maxWidth);
            w = maxWidth;
          } else {
            w = Math.round((w / h) * maxWidth);
            h = maxWidth;
          }
        }
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return reject(new Error('Canvas context unavailable'));
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'medium';
        ctx.drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL(mimeType, quality);
        canvas.width = 0;
        canvas.height = 0;
        resolve(dataUrl);
      };
      img.onerror = () => reject(new Error('Image load failed'));
      img.src = e.target?.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function createVideoThumbnail(videoUrl: string, time = 1): Promise<string> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.crossOrigin = 'anonymous';
    video.onloadeddata = () => {
      video.currentTime = Math.min(time, video.duration * 0.1);
    };
    video.onseeked = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth || 640;
        canvas.height = video.videoHeight || 480;
        canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.9));
      } catch (e) {
        reject(e);
      }
    };
    video.onerror = () => reject(new Error('Video load failed'));
    video.src = videoUrl;
  });
}

export function getVideoDuration(videoUrl: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.muted = true;
    video.preload = 'metadata';
    video.crossOrigin = 'anonymous';
    video.onloadedmetadata = () => {
      resolve(isFinite(video.duration) ? video.duration : 0);
    };
    video.onerror = () => reject(new Error('Video metadata load failed'));
    video.src = videoUrl;
  });
}

export function getAudioDuration(audioUrl: string): Promise<number> {
  return getVideoDuration(audioUrl); // Same API
}

export function estimateDurationFromText(text: string, wps = 2.2): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, words / wps);
}

export function makeGazetePlaceholder(name: string): string {
  const safeName = name.replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'
  }[character] || character));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1340" viewBox="0 0 800 1340"><rect width="800" height="1340" fill="#0f172a"/><rect x="32" y="32" width="736" height="1276" rx="24" fill="#111827" stroke="#334155" stroke-width="4"/><text x="400" y="620" text-anchor="middle" fill="#94a3b8" font-family="Arial,sans-serif" font-size="44" font-weight="700">${safeName}</text><text x="400" y="686" text-anchor="middle" fill="#64748b" font-family="Arial,sans-serif" font-size="26">Manşet görüntüsü bulunamadı</text></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

export function createGazeteVariants(rawUrls: string[], fallback: string | null) {
  const candidates = [...new Set(rawUrls.filter(Boolean))];
  if (fallback) candidates.push(fallback);
  return { fullCandidates: candidates, thumbCandidates: [...candidates] };
}
