import type { MediaFile, RenderConfig } from '@otonom/shared-types';
import type { HermesVideoSlide } from './aiClient';

type OutputType = 'image' | 'video';

interface LocalRenderOptions {
  canvas: HTMLCanvasElement;
  media: MediaFile[];
  customImages: string[];
  text: string;
  config: RenderConfig;
  backgroundMusic: MediaFile | null;
  narrationAudio?: Blob | null;
  script?: HermesVideoSlide[];
  outputType: OutputType;
  onProgress?: (progress: number, status: string) => void;
}

export interface LocalRenderResult {
  blob: Blob;
  url: string;
  extension: 'png' | 'mp4' | 'webm';
  mimeType: string;
}

type LoadedVisual =
  | { kind: 'image'; source: HTMLImageElement; width: number; height: number; cleanup?: () => void }
  | { kind: 'video'; source: HTMLVideoElement; width: number; height: number; cleanup?: () => void };

const FPS = 30;

function getDimensions(config: RenderConfig) {
  const longEdge = config.resolution === '4K' ? 3840 : config.resolution === '2K' ? 1920 : 1280;
  const shortEdge = config.resolution === '4K' ? 2160 : config.resolution === '2K' ? 1080 : 720;

  if (config.aspectRatio === '16:9') return { width: longEdge, height: shortEdge };
  if (config.aspectRatio === '1:1') return { width: shortEdge, height: shortEdge };
  return { width: shortEdge, height: longEdge };
}

function getDuration(config: RenderConfig) {
  if (config.duration === 'unlimited') return 30;
  return Math.max(3, Number(config.duration) || 30);
}

function getFontFamily(style: RenderConfig['fontStyle']) {
  if (style === 'classic') return 'Georgia, serif';
  if (style === 'typewriter') return '"Courier New", monospace';
  return 'Inter, Arial, sans-serif';
}

async function localizeRemoteUrl(url: string) {
  if (!/^https?:\/\//i.test(url)) return { url };

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const objectUrl = URL.createObjectURL(await response.blob());
    return { url: objectUrl, cleanup: () => URL.revokeObjectURL(objectUrl) };
  } catch {
    return { url };
  }
}

async function loadImage(url: string): Promise<LoadedVisual> {
  const localized = await localizeRemoteUrl(url);
  const image = new Image();
  image.decoding = 'async';
  image.crossOrigin = 'anonymous';

  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('Görsel tarayıcıda açılamadı.'));
    image.src = localized.url;
  });

  return {
    kind: 'image',
    source: image,
    width: image.naturalWidth || 1,
    height: image.naturalHeight || 1,
    cleanup: localized.cleanup,
  };
}

async function loadVideo(url: string): Promise<LoadedVisual> {
  const localized = await localizeRemoteUrl(url);
  const video = document.createElement('video');
  video.src = localized.url;
  video.muted = true;
  video.loop = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.crossOrigin = 'anonymous';

  await new Promise<void>((resolve, reject) => {
    video.onloadeddata = () => resolve();
    video.onerror = () => reject(new Error('Video tarayıcıda açılamadı.'));
    video.load();
  });

  return {
    kind: 'video',
    source: video,
    width: video.videoWidth || 1,
    height: video.videoHeight || 1,
    cleanup: () => {
      video.pause();
      video.removeAttribute('src');
      video.load();
      localized.cleanup?.();
    },
  };
}

async function loadVisuals(media: MediaFile[], customImages: string[]) {
  const sources = [
    ...customImages.map(url => ({ type: 'image' as const, url })),
    ...media
      .filter(item => (item.type === 'image' || item.type === 'video') && (item.url || item.thumbnailUrl))
      .map(item => ({ type: item.type as 'image' | 'video', url: item.url || item.thumbnailUrl || '' })),
  ].filter((item, index, all) => all.findIndex(candidate => candidate.url === item.url) === index);

  const settled = await Promise.allSettled(
    sources.map(item => item.type === 'video' ? loadVideo(item.url) : loadImage(item.url)),
  );

  return settled
    .filter((item): item is PromiseFulfilledResult<LoadedVisual> => item.status === 'fulfilled')
    .map(item => item.value);
}

function drawBackground(ctx: CanvasRenderingContext2D, width: number, height: number) {
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, '#111827');
  gradient.addColorStop(0.52, '#1e1b4b');
  gradient.addColorStop(1, '#020617');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  const glow = ctx.createRadialGradient(width * 0.72, height * 0.18, 0, width * 0.72, height * 0.18, width * 0.72);
  glow.addColorStop(0, 'rgba(99, 102, 241, 0.32)');
  glow.addColorStop(1, 'rgba(99, 102, 241, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);
}

function drawCover(
  ctx: CanvasRenderingContext2D,
  visual: LoadedVisual,
  width: number,
  height: number,
  alpha = 1,
  offsetX = 0,
  scaleBoost = 1,
) {
  const scale = Math.max(width / visual.width, height / visual.height) * scaleBoost;
  const drawWidth = visual.width * scale;
  const drawHeight = visual.height * scale;
  const x = (width - drawWidth) / 2 + offsetX;
  const y = (height - drawHeight) / 2;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.drawImage(visual.source, x, y, drawWidth, drawHeight);
  ctx.restore();
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const paragraphs = text.trim().split(/\n+/);
  const lines: string[] = [];

  for (const paragraph of paragraphs) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (ctx.measureText(candidate).width > maxWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) lines.push(line);
  }

  return lines;
}

function drawText(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  text: string,
  config: RenderConfig,
  topText = '',
) {
  const cleanText = text.trim();
  const footerText = config.yorum?.trim();
  const hasCopy = Boolean(cleanText || footerText || config.sourceName);
  if (!hasCopy) return;

  const isQuote = config.tip === 'guzel_soz' || config.tip === 'iddia_analizi';
  const fontSize = Math.round(Math.min(width, height) * (isQuote ? 0.058 : 0.047));
  const lineHeight = fontSize * 1.18;
  const padding = width * 0.075;
  const maxWidth = width - padding * 2;

  ctx.save();
  const overlay = ctx.createLinearGradient(0, height * 0.35, 0, height);
  overlay.addColorStop(0, 'rgba(2, 6, 23, 0)');
  overlay.addColorStop(0.58, 'rgba(2, 6, 23, 0.55)');
  overlay.addColorStop(1, 'rgba(2, 6, 23, 0.94)');
  ctx.fillStyle = overlay;
  ctx.fillRect(0, 0, width, height);

  ctx.font = `800 ${fontSize}px ${getFontFamily(config.fontStyle)}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = 'rgba(0,0,0,.85)';
  ctx.shadowBlur = Math.max(8, fontSize * 0.18);

  const lines = wrapText(ctx, cleanText, maxWidth).slice(0, isQuote ? 8 : 5);
  const blockHeight = lines.length * lineHeight;
  const centerY = isQuote ? height * 0.55 : height - padding - blockHeight / 2 - (footerText ? fontSize * 1.65 : 0);
  lines.forEach((line, index) => {
    ctx.fillText(line, width / 2, centerY - blockHeight / 2 + lineHeight * (index + 0.5));
  });

  ctx.shadowBlur = 0;
  if (footerText) {
    ctx.font = `600 ${Math.round(fontSize * 0.53)}px ${getFontFamily(config.fontStyle)}`;
    ctx.fillStyle = '#c7d2fe';
    const footerLines = wrapText(ctx, footerText, maxWidth).slice(0, 3);
    footerLines.forEach((line, index) => {
      ctx.fillText(line, width / 2, height - padding + index * fontSize * 0.62 - footerLines.length * fontSize * 0.62);
    });
  }

  if (config.sourceName) {
    ctx.font = `700 ${Math.round(fontSize * 0.42)}px ${getFontFamily(config.fontStyle)}`;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#a5b4fc';
    ctx.fillText(config.sourceName, padding, padding);
  }

  if (topText.trim()) {
    const labelSize = Math.round(fontSize * 0.62);
    ctx.font = `900 ${labelSize}px ${getFontFamily(config.fontStyle)}`;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    const label = topText.trim().toLocaleUpperCase('tr-TR');
    const labelWidth = Math.min(width * 0.82, ctx.measureText(label).width + labelSize * 1.8);
    const labelHeight = labelSize * 1.75;
    const labelX = (width - labelWidth) / 2;
    const labelY = height * 0.11;
    ctx.fillStyle = 'rgba(79, 70, 229, 0.9)';
    ctx.beginPath();
    ctx.roundRect(labelX, labelY, labelWidth, labelHeight, labelHeight / 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.fillText(label, width / 2, labelY + labelHeight / 2);
  }
  ctx.restore();
}

function drawFrame(
  ctx: CanvasRenderingContext2D,
  visuals: LoadedVisual[],
  elapsed: number,
  duration: number,
  text: string,
  config: RenderConfig,
  script?: HermesVideoSlide[],
) {
  const { width, height } = ctx.canvas;
  drawBackground(ctx, width, height);

  const sceneCount = Math.max(1, script?.length || 0, visuals.length);
  const sceneDuration = duration / sceneCount;
  const sceneIndex = Math.min(sceneCount - 1, Math.floor(elapsed / sceneDuration));
  const sceneProgress = Math.min(1, (elapsed - sceneIndex * sceneDuration) / sceneDuration);

  if (visuals.length) {
    const visualIndex = sceneIndex % visuals.length;
    const current = visuals[visualIndex];
    const next = visuals[(visualIndex + 1) % visuals.length];
    const zoom = 1 + sceneProgress * 0.035;

    if (config.transition === 'crossfade' && sceneProgress > 0.82 && visuals.length > 1) {
      const mix = (sceneProgress - 0.82) / 0.18;
      drawCover(ctx, current, width, height, 1 - mix, 0, zoom);
      drawCover(ctx, next, width, height, mix, 0, 1);
    } else if ((config.transition === 'slideIn' || config.transition === 'slideOut') && visuals.length > 1) {
      const slide = config.transition === 'slideIn'
        ? (1 - Math.min(1, sceneProgress * 4)) * width
        : -Math.max(0, (sceneProgress - 0.78) / 0.22) * width;
      drawCover(ctx, current, width, height, 1, slide, zoom);
    } else {
      const fadeIn = config.transition === 'fadeIn' ? Math.min(1, sceneProgress * 5) : 1;
      const fadeOut = config.transition === 'fadeOut' ? Math.min(1, (1 - sceneProgress) * 5) : 1;
      drawCover(ctx, current, width, height, Math.min(fadeIn, fadeOut), 0, zoom);
    }
  }

  const slide = script?.[sceneIndex];
  const slideText = slide
    ? (config.subtitles === 'on' ? slide.spokenText : '')
    : text;
  drawText(ctx, width, height, slideText, config, slide?.topText || '');
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Görsel dosyası oluşturulamadı.')), type, quality);
  });
}

function getRecorderMimeType(preferred: RenderConfig['videoFormat']) {
  const candidates = preferred === 'mp4'
    ? ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
    : ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
  return candidates.find(type => MediaRecorder.isTypeSupported(type)) || '';
}

async function startVisualVideos(visuals: LoadedVisual[]) {
  await Promise.all(visuals.map(async visual => {
    if (visual.kind !== 'video') return;
    try {
      visual.source.currentTime = 0;
      await visual.source.play();
    } catch {
      // The first decoded frame is still usable when autoplay is unavailable.
    }
  }));
}

function waitForAudioMetadata(audio: HTMLAudioElement) {
  if (Number.isFinite(audio.duration) && audio.duration > 0) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    audio.onloadedmetadata = () => resolve();
    audio.onerror = () => reject(new Error('Ses dosyası tarayıcıda açılamadı.'));
    audio.load();
  });
}

async function renderVideo(options: LocalRenderOptions, visuals: LoadedVisual[]): Promise<LocalRenderResult> {
  const { canvas, config, backgroundMusic, narrationAudio, onProgress } = options;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('Tarayıcı Canvas özelliğini desteklemiyor.');
  if (!('MediaRecorder' in window) || !canvas.captureStream) {
    throw new Error('Bu tarayıcı yerel video oluşturmayı desteklemiyor. Chrome veya Edge kullanın.');
  }

  let duration = getDuration(config);
  const canvasStream = canvas.captureStream(FPS);
  const outputStream = new MediaStream(canvasStream.getVideoTracks());
  let audioContext: AudioContext | null = null;
  let backgroundElement: HTMLAudioElement | null = null;
  let narrationElement: HTMLAudioElement | null = null;
  let narrationUrl: string | null = null;

  if (backgroundMusic?.url || narrationAudio) {
    try {
      audioContext = new AudioContext();
      await audioContext.resume();
      const destination = audioContext.createMediaStreamDestination();

      if (backgroundMusic?.url) {
        backgroundElement = new Audio(backgroundMusic.url);
        backgroundElement.loop = true;
        backgroundElement.crossOrigin = 'anonymous';
        const musicSource = audioContext.createMediaElementSource(backgroundElement);
        const musicGain = audioContext.createGain();
        musicGain.gain.value = Math.min(1, Math.max(0, config.backgroundMusicVolume ?? 0.29));
        musicSource.connect(musicGain);
        musicGain.connect(destination);
      }

      if (narrationAudio) {
        narrationUrl = URL.createObjectURL(narrationAudio);
        narrationElement = new Audio(narrationUrl);
        await waitForAudioMetadata(narrationElement);
        duration = Math.max(duration, narrationElement.duration || 0);
        const narrationSource = audioContext.createMediaElementSource(narrationElement);
        const narrationGain = audioContext.createGain();
        narrationGain.gain.value = 1;
        narrationSource.connect(narrationGain);
        narrationGain.connect(destination);
      }

      destination.stream.getAudioTracks().forEach(track => outputStream.addTrack(track));
    } catch {
      await audioContext?.close().catch(() => undefined);
      audioContext = null;
      backgroundElement = null;
      narrationElement = null;
    }
  }

  const mimeType = getRecorderMimeType(config.videoFormat);
  const bitsPerSecond = config.resolution === '4K' ? 20_000_000 : config.resolution === '2K' ? 10_000_000 : 6_000_000;
  const recorder = new MediaRecorder(outputStream, {
    ...(mimeType ? { mimeType } : {}),
    videoBitsPerSecond: bitsPerSecond,
  });
  const chunks: BlobPart[] = [];
  const stopped = new Promise<void>((resolve, reject) => {
    recorder.ondataavailable = event => {
      if (event.data.size) chunks.push(event.data);
    };
    recorder.onstop = () => resolve();
    recorder.onerror = () => reject(new Error('Tarayıcı video kaydını tamamlayamadı.'));
  });

  await startVisualVideos(visuals);
  recorder.start(1000);
  if (backgroundElement) backgroundElement.currentTime = 0;
  if (narrationElement) narrationElement.currentTime = 0;
  await Promise.all([
    backgroundElement?.play().catch(() => undefined),
    narrationElement?.play().catch(() => undefined),
  ]);

  const startedAt = performance.now();
  await new Promise<void>((resolve, reject) => {
    const tick = (now: number) => {
      try {
        const elapsed = Math.min(duration, (now - startedAt) / 1000);
        drawFrame(context, visuals, elapsed, duration, options.text, config, options.script);
        const progress = Math.min(99, Math.round((elapsed / duration) * 100));
        onProgress?.(progress, `Video cihazınızda oluşturuluyor · ${Math.ceil(duration - elapsed)} sn`);
        if (elapsed >= duration) {
          resolve();
          return;
        }
        requestAnimationFrame(tick);
      } catch (error) {
        reject(error);
      }
    };
    requestAnimationFrame(tick);
  });

  recorder.stop();
  await stopped;
  backgroundElement?.pause();
  narrationElement?.pause();
  visuals.forEach(visual => visual.kind === 'video' && visual.source.pause());
  outputStream.getTracks().forEach(track => track.stop());
  await audioContext?.close().catch(() => undefined);
  if (narrationUrl) URL.revokeObjectURL(narrationUrl);

  const actualType = recorder.mimeType || mimeType || 'video/webm';
  const blob = new Blob(chunks, { type: actualType });
  if (!blob.size) throw new Error('Video dosyası boş oluşturuldu.');
  const extension = actualType.includes('mp4') ? 'mp4' : 'webm';
  onProgress?.(100, 'Video hazır — dosya yalnızca bu cihazda tutuluyor');
  return { blob, url: URL.createObjectURL(blob), extension, mimeType: actualType };
}

export async function renderLocally(options: LocalRenderOptions): Promise<LocalRenderResult> {
  const { width, height } = getDimensions(options.config);
  options.canvas.width = width;
  options.canvas.height = height;
  options.onProgress?.(3, 'Yerel medya hazırlanıyor...');

  const visuals = await loadVisuals(options.media, options.customImages);
  const context = options.canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('Tarayıcı Canvas özelliğini desteklemiyor.');

  try {
    if (options.outputType === 'image') {
      options.onProgress?.(55, 'Görsel cihazınızda oluşturuluyor...');
      await startVisualVideos(visuals);
      drawFrame(context, visuals, 0, 1, options.text, options.config, options.script);
      const blob = await canvasToBlob(options.canvas, 'image/png');
      options.onProgress?.(100, 'Görsel hazır — sunucuya yüklenmedi');
      return { blob, url: URL.createObjectURL(blob), extension: 'png', mimeType: 'image/png' };
    }

    return await renderVideo(options, visuals);
  } finally {
    visuals.forEach(visual => visual.cleanup?.());
  }
}
