import type { MediaFile, RenderConfig } from '@otonom/shared-types';
import { writeSystemLog } from '@otonom/shared-utils';
import type { HermesVideoSlide } from './aiClient';
import { isInstagramCompatibleFrameRate, readMp4AverageFrameRate } from './mp4FrameRate';
import { CTA_LABELS, OUTRO_TEXTS, type RenderSceneKind } from './storyboard';

type OutputType = 'image' | 'video';

interface LocalRenderOptions {
  canvas: HTMLCanvasElement;
  media: MediaFile[];
  customImages: string[];
  text: string;
  config: RenderConfig;
  backgroundMusic: MediaFile | null;
  narrationAudio?: Blob | null;
  script?: RenderScene[];
  outputType: OutputType;
  onProgress?: (progress: number, status: string) => void;
}

export interface LocalRenderResult {
  blob: Blob;
  url: string;
  extension: 'png' | 'mp4' | 'webm';
  mimeType: string;
}

export class PartialRenderError extends Error {
  partialResult: LocalRenderResult | null;

  constructor(message: string, partialResult: LocalRenderResult | null = null) {
    super(message);
    this.name = 'PartialRenderError';
    this.partialResult = partialResult;
  }
}

type LoadedVisual =
  | { kind: 'image'; source: HTMLImageElement; width: number; height: number; cleanup?: () => void }
  | { kind: 'video'; source: HTMLVideoElement; width: number; height: number; cleanup?: () => void };

const FPS = 30;

type RenderScene = HermesVideoSlide & { kind?: RenderSceneKind };

interface SceneTiming {
  scene: RenderScene;
  index: number;
  start: number;
  end: number;
}

interface LegacyFfmpeg {
  load: () => Promise<void>;
  setProgress: (callback: (value: { ratio: number }) => void) => void;
  FS: (operation: string, path: string, data?: Uint8Array) => Uint8Array | void;
  run: (...args: string[]) => Promise<void>;
}

declare global {
  interface Window {
    FFmpeg?: {
      createFFmpeg: (options: { log: boolean; corePath: string }) => LegacyFfmpeg;
      fetchFile: (source: Blob) => Promise<Uint8Array>;
    };
  }
}

let ffmpegInstance: { ffmpeg: LegacyFfmpeg; fetchFile: (source: Blob) => Promise<Uint8Array> } | null = null;

export function getDimensions(config: RenderConfig, outputType: OutputType = 'video') {
  // Uzun videolarda 4K Canvas + gerçek zamanlı VP8 kodlama dört çekirdekli
  // cihazlarda kare kuyruğunu durduruyor. Video için örnek çıktıyla aynı olan
  // 720p kullanılır; yüksek çözünürlük seçimi statik görsel çıktısında korunur.
  if (outputType === 'video') {
    if (config.aspectRatio === '16:9') return { width: 1280, height: 720 };
    if (config.aspectRatio === '1:1') return { width: 720, height: 720 };
    return { width: 720, height: 1280 };
  }
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

  settled.forEach((item, index) => {
    if (item.status === 'rejected') {
      const reason = item.reason instanceof Error ? item.reason.message : String(item.reason);
      writeSystemLog(`Medya ${index + 1}/${sources.length} yüklenemedi (${sources[index]?.type || 'bilinmiyor'}): ${reason}`, 'warn');
    }
  });

  const loadedCount = settled.filter(item => item.status === 'fulfilled').length;
  writeSystemLog(`Yerel görseller hazır: ${loadedCount}/${sources.length}`, loadedCount === sources.length ? 'success' : 'warn');

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

function drawContain(
  ctx: CanvasRenderingContext2D,
  visual: LoadedVisual,
  width: number,
  height: number,
  insetTop = 0,
  insetBottom = 0,
) {
  const availableHeight = Math.max(1, height - insetTop - insetBottom);
  const scale = Math.min(width / visual.width, availableHeight / visual.height);
  const drawWidth = visual.width * scale;
  const drawHeight = visual.height * scale;
  const x = (width - drawWidth) / 2;
  const y = insetTop + (availableHeight - drawHeight) / 2;
  ctx.drawImage(visual.source, x, y, drawWidth, drawHeight);
}

function drawSourcePill(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  fontSize: number,
  align: 'center' | 'right' = 'center',
) {
  if (!text.trim()) return;
  const label = text.trim();
  ctx.save();
  ctx.font = `900 ${fontSize}px Inter, Arial, sans-serif`;
  const paddingX = fontSize * 0.7;
  const pillWidth = ctx.measureText(label).width + paddingX * 2;
  const pillHeight = fontSize * 1.65;
  const left = align === 'right' ? x - pillWidth : x - pillWidth / 2;
  ctx.fillStyle = '#e53935';
  ctx.beginPath();
  ctx.roundRect(left, y, pillWidth, pillHeight, pillHeight / 2);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, left + pillWidth / 2, y + pillHeight / 2);
  ctx.restore();
}

function fitLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  initialSize: number,
  minSize: number,
  maxLines: number,
  fontFamily: string,
) {
  let size = initialSize;
  let lines: string[] = [];
  while (size >= minSize) {
    ctx.font = `900 ${size}px ${fontFamily}`;
    lines = wrapText(ctx, text, maxWidth);
    if (lines.length <= maxLines) break;
    size -= 2;
  }
  return { size, lines: lines.slice(0, maxLines) };
}

function subtitleChunk(text: string, progress: number) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '';
  const chunks: string[] = [];
  for (let index = 0; index < words.length; index += 5) chunks.push(words.slice(index, index + 5).join(' '));
  return chunks[Math.min(chunks.length - 1, Math.floor(progress * chunks.length))];
}

function drawTargetCoverScene(
  ctx: CanvasRenderingContext2D,
  visual: LoadedVisual | null,
  width: number,
  height: number,
  scene: RenderScene,
  config: RenderConfig,
) {
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, width, height);
  if (visual) drawContain(ctx, visual, width, height, height * 0.105, height * 0.015);

  const shade = ctx.createLinearGradient(0, height * 0.45, 0, height);
  shade.addColorStop(0, 'rgba(0,0,0,0)');
  shade.addColorStop(1, 'rgba(0,0,0,.78)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, width, height * 0.105);
  const sourceSize = Math.round(width * 0.045);
  drawSourcePill(ctx, config.sourceName || 'Gazete', width / 2, height * 0.015, sourceSize);

  const locale = config.language === 'tr' ? 'tr-TR' : (config.language || 'tr');
  const dateLine = new Date().toLocaleDateString(locale, {
    day: '2-digit', month: 'long', year: 'numeric', weekday: 'long',
  }).toLocaleUpperCase(locale);
  ctx.fillStyle = '#ffffff';
  ctx.font = `900 ${Math.round(width * 0.027)}px ${getFontFamily(config.fontStyle)}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(dateLine, width / 2, height * 0.078);

  const title = (scene.topText || 'GÜNDEM').toLocaleUpperCase('tr-TR');
  const fitted = fitLines(ctx, title, width * 0.88, Math.round(width * 0.105), Math.round(width * 0.055), 4, getFontFamily(config.fontStyle));
  const lineHeight = fitted.size * 1.02;
  const startY = height * 0.46 - ((fitted.lines.length - 1) * lineHeight) / 2;
  ctx.save();
  ctx.font = `900 ${fitted.size}px ${getFontFamily(config.fontStyle)}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(5, fitted.size * 0.11);
  ctx.strokeStyle = '#000000';
  ctx.fillStyle = '#ffffff';
  fitted.lines.forEach((line, index) => {
    const y = startY + index * lineHeight;
    ctx.strokeText(line, width / 2, y);
    ctx.fillText(line, width / 2, y);
  });
  ctx.restore();
}

function drawTargetContentScene(
  ctx: CanvasRenderingContext2D,
  visual: LoadedVisual | null,
  width: number,
  height: number,
  scene: RenderScene,
  progress: number,
  config: RenderConfig,
) {
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, width, height);
  if (visual) drawContain(ctx, visual, width, height, height * 0.015, height * 0.015);

  const shade = ctx.createLinearGradient(0, height * 0.48, 0, height);
  shade.addColorStop(0, 'rgba(0,0,0,0)');
  shade.addColorStop(1, 'rgba(0,0,0,.83)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, width, height);

  const title = (scene.topText || '').toLocaleUpperCase('tr-TR');
  const fitted = fitLines(ctx, title, width * 0.86, Math.round(width * 0.055), Math.round(width * 0.038), 2, getFontFamily(config.fontStyle));
  ctx.font = `900 ${fitted.size}px ${getFontFamily(config.fontStyle)}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(3, fitted.size * 0.08);
  ctx.strokeStyle = 'rgba(0,0,0,.9)';
  ctx.fillStyle = '#facc15';
  fitted.lines.forEach((line, index) => {
    const y = height * 0.027 + index * fitted.size * 1.05;
    ctx.strokeText(line, width / 2, y);
    ctx.fillText(line, width / 2, y);
  });
  drawSourcePill(ctx, config.sourceName || 'Gazete', width * 0.97, height * 0.012, Math.round(width * 0.037), 'right');

  if (config.subtitles !== 'off') {
    const subtitle = subtitleChunk(scene.spokenText, progress);
    if (subtitle) {
      let fontSize = Math.round(width * 0.052);
      ctx.font = `900 ${fontSize}px ${getFontFamily(config.fontStyle)}`;
      while (ctx.measureText(subtitle).width > width * 0.91 && fontSize > width * 0.035) {
        fontSize -= 1;
        ctx.font = `900 ${fontSize}px ${getFontFamily(config.fontStyle)}`;
      }
      const boxWidth = Math.min(width * 0.96, ctx.measureText(subtitle).width + fontSize * 1.1);
      const boxHeight = fontSize * 1.5;
      const boxX = (width - boxWidth) / 2;
      const boxY = height * 0.71;
      ctx.fillStyle = '#2563eb';
      ctx.beginPath();
      ctx.roundRect(boxX, boxY, boxWidth, boxHeight, fontSize * 0.18);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(subtitle, width / 2, boxY + boxHeight / 2);
    }
  }
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
  const hasCopy = Boolean(cleanText || config.sourceName);
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
  const centerY = isQuote ? height * 0.55 : height - padding - blockHeight / 2;
  lines.forEach((line, index) => {
    ctx.fillText(line, width / 2, centerY - blockHeight / 2 + lineHeight * (index + 0.5));
  });

  ctx.shadowBlur = 0;
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

function getWords(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function buildTimeline(script: RenderScene[] | undefined, duration: number): SceneTiming[] {
  const scenes = script?.length ? script : [{ topText: '', spokenText: '', imagePrompts: [], kind: 'content' as const }];
  const weights = scenes.map(scene => {
    const speechSeconds = Math.max(0.8, getWords(scene.spokenText) / 2.2);
    if (scene.kind === 'cover') return Math.max(2.5, speechSeconds);
    if (scene.kind === 'final' || scene.kind === 'question') return Math.max(3.2, speechSeconds);
    if (scene.kind === 'outro') return Math.max(4, speechSeconds);
    return Math.max(2.2, speechSeconds);
  });
  const totalWeight = weights.reduce((sum, value) => sum + value, 0) || 1;
  let cursor = 0;
  return scenes.map((scene, index) => {
    const start = cursor;
    cursor += index === scenes.length - 1 ? duration - cursor : duration * (weights[index] / totalWeight);
    return { scene, index, start, end: cursor };
  });
}

function drawStar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  points: number,
  outerRadius: number,
  innerRadius: number,
  color: string,
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-Math.PI / 2);
  ctx.beginPath();
  for (let point = 0; point < points * 2; point += 1) {
    const radius = point % 2 === 0 ? outerRadius : innerRadius;
    const angle = point * Math.PI / points;
    ctx.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

function drawLanguagePanel(ctx: CanvasRenderingContext2D, width: number, height: number, language: string) {
  const panelY = height / 2;
  const panelHeight = height / 2;
  if (language === 'tr') {
    ctx.fillStyle = '#E30A17';
    ctx.fillRect(0, panelY, width, panelHeight);
    const centerX = width / 2;
    const centerY = panelY + panelHeight / 2;
    const outer = panelHeight * 0.27;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(centerX - panelHeight * 0.04, centerY, outer, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#E30A17';
    ctx.beginPath();
    ctx.arc(centerX + panelHeight * 0.04, centerY, outer * 0.79, 0, Math.PI * 2);
    ctx.fill();
    drawStar(ctx, centerX + panelHeight * 0.16, centerY, 5, panelHeight * 0.1, panelHeight * 0.04, '#ffffff');
    return;
  }

  const gradient = ctx.createLinearGradient(0, panelY, width, height);
  gradient.addColorStop(0, '#312e81');
  gradient.addColorStop(0.5, '#7c3aed');
  gradient.addColorStop(1, '#0f172a');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, panelY, width, panelHeight);
  ctx.fillStyle = 'rgba(255,255,255,.1)';
  for (let index = 0; index < 8; index += 1) {
    ctx.beginPath();
    ctx.arc(width * ((index + 1) / 9), panelY + panelHeight * (0.3 + (index % 3) * 0.2), panelHeight * 0.035, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawFinalScene(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  scene: RenderScene,
  config: RenderConfig,
) {
  ctx.fillStyle = '#030712';
  ctx.fillRect(0, 0, width, height / 2);
  drawLanguagePanel(ctx, width, height, config.language || 'tr');

  const font = getFontFamily(config.fontStyle);
  const headerSize = Math.round(Math.min(width, height) * 0.052);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#e11d48';
  ctx.font = `900 ${headerSize}px ${font}`;
  ctx.fillText((scene.topText || 'SON SÖZ').toLocaleUpperCase('tr-TR'), width / 2, height * 0.075);

  let bodySize = Math.round(Math.min(width, height) * 0.043);
  let lines: string[] = [];
  const maxWidth = width * 0.84;
  const available = height * 0.31;
  do {
    ctx.font = `900 ${bodySize}px ${font}`;
    lines = wrapText(ctx, scene.spokenText, maxWidth);
    if (lines.length * bodySize * 1.25 <= available) break;
    bodySize -= 2;
  } while (bodySize > 18);
  const lineHeight = bodySize * 1.25;
  const startY = height * 0.18 + Math.max(0, (available - lines.length * lineHeight) / 2);
  ctx.fillStyle = '#f8fafc';
  ctx.font = `900 ${bodySize}px ${font}`;
  lines.forEach((line, index) => ctx.fillText(line, width / 2, startY + index * lineHeight));
}

function drawQuestionScene(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  scene: RenderScene,
  config: RenderConfig,
) {
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, '#020617');
  gradient.addColorStop(0.5, '#312e81');
  gradient.addColorStop(1, '#0f172a');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  const font = getFontFamily(config.fontStyle);
  const badgeSize = Math.round(Math.min(width, height) * 0.12);
  ctx.beginPath();
  ctx.arc(width / 2, height * 0.28, badgeSize, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(99,102,241,.35)';
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = `900 ${badgeSize * 1.1}px ${font}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('?', width / 2, height * 0.28);
  ctx.font = `900 ${Math.round(badgeSize * 0.42)}px ${font}`;
  ctx.fillStyle = '#a5b4fc';
  ctx.fillText(scene.topText, width / 2, height * 0.43);
  ctx.font = `800 ${Math.round(badgeSize * 0.48)}px ${font}`;
  ctx.fillStyle = '#ffffff';
  const lines = wrapText(ctx, scene.spokenText, width * 0.82).slice(0, 7);
  lines.forEach((line, index) => ctx.fillText(line, width / 2, height * 0.54 + index * badgeSize * 0.58));
}

function drawOutroScene(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  progress: number,
  config: RenderConfig,
) {
  const language = config.language || 'tr';
  const font = getFontFamily(config.fontStyle);
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, '#0a0015');
  gradient.addColorStop(0.45, '#251047');
  gradient.addColorStop(1, '#050010');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  for (let index = 0; index < 18; index += 1) {
    const phase = index * 1.73;
    const x = width * ((index * 0.347) % 1);
    const y = height * ((index * 0.213 - progress * (0.05 + index * 0.002) + 1) % 1);
    const radius = Math.min(width, height) * (0.018 + (index % 4) * 0.008) * (1 + Math.sin(progress * 12 + phase) * 0.15);
    const glow = ctx.createRadialGradient(x, y, 0, x, y, radius);
    glow.addColorStop(0, index % 2 ? 'rgba(168,85,247,.24)' : 'rgba(244,63,94,.2)');
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  const titleLines = OUTRO_TEXTS[language] || OUTRO_TEXTS.tr;
  const titleSize = Math.round(Math.min(width, height) * 0.052);
  const lineHeight = titleSize * 1.38;
  titleLines.forEach((line, index) => {
    const local = Math.max(0, Math.min(1, (progress * 4.5 - index * 0.28)));
    ctx.save();
    ctx.globalAlpha = local;
    ctx.font = `900 ${titleSize}px ${font}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(250,204,21,.5)';
    ctx.shadowBlur = titleSize * 0.35;
    ctx.fillStyle = '#facc15';
    ctx.fillText(line, width / 2, height * 0.2 + index * lineHeight + (1 - local) * titleSize);
    ctx.restore();
  });

  const cta = CTA_LABELS[language] || CTA_LABELS.tr;
  const buttons = [
    { label: cta.sub, color: '#ef4444', symbol: '●' },
    { label: cta.like, color: '#ec4899', symbol: '♥' },
    { label: cta.share, color: '#3b82f6', symbol: '↗' },
  ];
  const radius = Math.min(width * 0.105, height * 0.055);
  buttons.forEach((button, index) => {
    const local = Math.max(0, Math.min(1, (progress * 3.8 - 1.1 - index * 0.22)));
    const x = width * (0.23 + index * 0.27);
    const y = height * 0.66 + (1 - local) * radius * 1.4;
    ctx.save();
    ctx.globalAlpha = local;
    ctx.fillStyle = button.color;
    ctx.shadowColor = button.color;
    ctx.shadowBlur = radius * 0.5;
    ctx.beginPath();
    ctx.arc(x, y, radius * (1 + Math.sin(progress * 18 + index) * 0.035), 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#ffffff';
    ctx.font = `900 ${Math.round(radius * 0.7)}px ${font}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(button.symbol, x, y);
    ctx.font = `800 ${Math.round(radius * 0.29)}px ${font}`;
    ctx.textBaseline = 'top';
    ctx.fillText(button.label, x, y + radius * 1.25);
    ctx.restore();
  });

  ctx.font = `600 ${Math.round(Math.min(width, height) * 0.018)}px ${font}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(255,255,255,.56)';
  const disclaimer = 'Yapay zekâ çıktıları hata içerebilir; önemli bilgileri doğrulayın.';
  wrapText(ctx, disclaimer, width * 0.86).slice(0, 2).forEach((line, index) => {
    ctx.fillText(line, width / 2, height * 0.91 + index * Math.min(width, height) * 0.024);
  });
}

function drawFrame(
  ctx: CanvasRenderingContext2D,
  visuals: LoadedVisual[],
  elapsed: number,
  duration: number,
  text: string,
  config: RenderConfig,
  script?: RenderScene[],
) {
  const { width, height } = ctx.canvas;
  drawBackground(ctx, width, height);

  const timeline = buildTimeline(script, duration);
  const timing = timeline.find(item => elapsed < item.end) || timeline[timeline.length - 1];
  const scene = timing.scene;
  const sceneDuration = Math.max(0.001, timing.end - timing.start);
  const sceneProgress = Math.min(1, Math.max(0, (elapsed - timing.start) / sceneDuration));

  if (scene.kind === 'final') {
    drawFinalScene(ctx, width, height, scene, config);
    return;
  }
  if (scene.kind === 'question') {
    drawQuestionScene(ctx, width, height, scene, config);
    return;
  }
  if (scene.kind === 'outro') {
    drawOutroScene(ctx, width, height, sceneProgress, config);
    if (sceneProgress < 0.08) {
      ctx.fillStyle = `rgba(0,0,0,${1 - sceneProgress / 0.08})`;
      ctx.fillRect(0, 0, width, height);
    }
    return;
  }

  const contentIndex = timeline
    .slice(0, timing.index + 1)
    .filter(item => item.scene.kind === 'content').length;
  const visualIndex = scene.kind === 'cover' ? 0 : Math.max(0, contentIndex - 1) % Math.max(1, visuals.length);
  const currentVisual = visuals[visualIndex] || visuals[0] || null;

  if (scene.kind === 'cover') {
    drawTargetCoverScene(ctx, currentVisual, width, height, scene, config);
    return;
  }
  if (scene.kind === 'content') {
    drawTargetContentScene(ctx, currentVisual, width, height, scene, sceneProgress, config);
    return;
  }

  if (visuals.length) {
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

  const slideText = scene
    ? (config.subtitles === 'on' ? scene.spokenText : '')
    : text;
  drawText(ctx, width, height, slideText, config, scene?.topText || '');
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Görsel dosyası oluşturulamadı.')), type, quality);
  });
}

interface RecorderFormat {
  mimeType: string;
  extension: 'mp4' | 'webm';
  directMp4: boolean;
}

function getRecorderFormat(): RecorderFormat | null {
  const mp4Candidates = [
    'video/mp4;codecs="avc1.42E01E,mp4a.40.2"',
    'video/mp4;codecs="avc1.42E01E"',
    'video/mp4',
  ];
  const directMp4 = mp4Candidates.find(type => MediaRecorder.isTypeSupported(type));
  if (directMp4) return { mimeType: directMp4, extension: 'mp4', directMp4: true };

  const webmCandidates = ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp8', 'video/webm'];
  const webm = webmCandidates.find(type => MediaRecorder.isTypeSupported(type));
  return webm ? { mimeType: webm, extension: 'webm', directMp4: false } : null;
}

async function inspectVideoBlob(blob: Blob) {
  const url = URL.createObjectURL(blob);
  const video = document.createElement('video');
  video.preload = 'metadata';
  video.muted = true;
  video.src = url;
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error('Video doğrulama zaman aşımı.')), 8_000);
      video.onloadedmetadata = () => {
        window.clearTimeout(timer);
        resolve();
      };
      video.onerror = () => {
        window.clearTimeout(timer);
        reject(new Error('Oluşturulan video tarayıcıda doğrulanamadı.'));
      };
      video.load();
    });
    if (!video.videoWidth || !video.videoHeight) throw new Error('Oluşturulan dosyada görüntü kanalı yok.');
    return { width: video.videoWidth, height: video.videoHeight, duration: video.duration };
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}

function loadScript(src: string) {
  return new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
    if (existing?.dataset.loaded === 'true') {
      resolve();
      return;
    }
    const script = existing || document.createElement('script');
    script.src = src;
    script.crossOrigin = 'anonymous';
    script.onload = () => {
      script.dataset.loaded = 'true';
      resolve();
    };
    script.onerror = () => reject(new Error('Ücretsiz MP4 dönüştürücü yüklenemedi.'));
    if (!existing) document.head.appendChild(script);
  });
}

async function loadFfmpeg() {
  if (ffmpegInstance) return ffmpegInstance;
  writeSystemLog('FFmpeg WebAssembly yükleniyor; MP4 dönüşümü hazırlanıyor.');
  await loadScript('https://unpkg.com/@ffmpeg/ffmpeg@0.11.6/dist/ffmpeg.min.js');
  if (!window.FFmpeg?.createFFmpeg) throw new Error('Ücretsiz MP4 dönüştürücü başlatılamadı.');
  const ffmpeg = window.FFmpeg.createFFmpeg({
    log: false,
    corePath: 'https://unpkg.com/@ffmpeg/core@0.11.0/dist/ffmpeg-core.js',
  });
  await ffmpeg.load();
  writeSystemLog('FFmpeg WebAssembly hazır.', 'success');
  ffmpegInstance = { ffmpeg, fetchFile: window.FFmpeg.fetchFile };
  return ffmpegInstance;
}

async function convertToConstantFrameRateMp4(
  blob: Blob,
  sourceExtension: 'mp4' | 'webm',
  onProgress?: (progress: number) => void,
) {
  const { ffmpeg, fetchFile } = await loadFfmpeg();
  ffmpeg.setProgress(({ ratio }) => {
    if (ratio > 0 && ratio <= 1) onProgress?.(Math.round(ratio * 100));
  });
  try {
    const inputName = `input.${sourceExtension}`;
    writeSystemLog(`Sabit 30 FPS MP4 dönüşümü başladı: ${sourceExtension.toUpperCase()} ${(blob.size / 1024 / 1024).toFixed(1)} MB.`);
    ffmpeg.FS('writeFile', inputName, await fetchFile(blob));
    await ffmpeg.run(
      '-i', inputName, '-vf', `fps=${FPS}`, '-c:v', 'libx264', '-preset', 'ultrafast',
      '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', 'output.mp4',
    );
    const output = ffmpeg.FS('readFile', 'output.mp4') as Uint8Array;
    return new Blob([output.slice().buffer], { type: 'video/mp4' });
  } finally {
    try { ffmpeg.FS('unlink', `input.${sourceExtension}`); } catch { /* no-op */ }
    try { ffmpeg.FS('unlink', 'output.mp4'); } catch { /* no-op */ }
  }
}

function runFrameLoop(
  draw: (elapsed: number) => void,
  duration: number,
) {
  return new Promise<void>((resolve, reject) => {
    const workerSource = `
      let timer;
      self.onmessage = (event) => {
        if (event.data === 'start') timer = setInterval(() => self.postMessage('tick'), ${1000 / FPS});
        if (event.data === 'stop') { clearInterval(timer); self.close(); }
      };
    `;
    const workerUrl = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }));
    const worker = new Worker(workerUrl);
    const startedAt = performance.now();
    let finished = false;
    const cleanup = () => {
      if (finished) return;
      finished = true;
      worker.postMessage('stop');
      worker.terminate();
      URL.revokeObjectURL(workerUrl);
    };
    worker.onerror = () => {
      cleanup();
      reject(new Error('Video kare zamanlayıcısı çalıştırılamadı.'));
    };
    worker.onmessage = () => {
      try {
        const elapsed = Math.min(duration, (performance.now() - startedAt) / 1000);
        draw(elapsed);
        if (elapsed >= duration) {
          cleanup();
          resolve();
        }
      } catch (error) {
        cleanup();
        reject(error);
      }
    };
    worker.postMessage('start');
  });
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
  writeSystemLog(
    `Video motoru hazırlanıyor: ${canvas.width}x${canvas.height} · ${FPS} FPS · hedef ${duration} sn · ${options.script?.length || 0} sahne.`,
  );
  drawFrame(context, visuals, 0, duration, options.text, config, options.script);
  // Passing FPS advertises a real 30 FPS track to Chromium's MP4 encoder.
  // captureStream(0) leaves the rate unspecified and Chrome can encode the
  // requested frames as ~10 FPS, which Instagram Reels rejects.
  const canvasStream = canvas.captureStream(FPS);
  const videoTrack = canvasStream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack | undefined;
  if (!videoTrack) throw new Error('Video görüntü kanalı oluşturulamadı. Chrome veya Edge kullanın.');
  const outputStream = new MediaStream(canvasStream.getVideoTracks());
  writeSystemLog(`Canvas görüntü kanalı hazır: ${outputStream.getVideoTracks().length} video track.`, 'success');
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
      writeSystemLog(
        `Ses miksajı hazır: anlatım=${Boolean(narrationElement)} · müzik=${Boolean(backgroundElement)} · toplam ${duration.toFixed(1)} sn.`,
        'success',
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      writeSystemLog(`Ses miksajı hazırlanamadı; görüntü üretimi devam ediyor: ${reason}`, 'warn');
      await audioContext?.close().catch(() => undefined);
      audioContext = null;
      backgroundElement = null;
      narrationElement = null;
    }
  }

  const format = getRecorderFormat();
  if (!format) throw new Error('Tarayıcı video kaydını desteklemiyor. Güncel Chrome veya Edge kullanın.');
  const bitsPerSecond = 4_000_000;
  writeSystemLog(
    `MediaRecorder ayarı: ${format.mimeType} · ${(bitsPerSecond / 1_000_000).toFixed(0)} Mbps · ${format.directMp4 ? 'doğrudan MP4' : 'WebM + MP4 dönüşümü'}.`,
  );
  const recorder = new MediaRecorder(outputStream, {
    mimeType: format.mimeType,
    videoBitsPerSecond: bitsPerSecond,
    audioBitsPerSecond: 192_000,
  });
  const chunks: BlobPart[] = [];
  let recorderFailure: Error | null = null;
  const stopped = new Promise<void>(resolve => {
    recorder.ondataavailable = event => {
      if (event.data.size) chunks.push(event.data);
    };
    recorder.onstop = () => resolve();
    recorder.onerror = event => {
      recorderFailure = new Error(`Tarayıcı video kaydını tamamlayamadı: ${event.error?.message || 'bilinmeyen kayıt hatası'}`);
      resolve();
    };
  });

  let renderFailure: Error | null = null;
  let drawnFrames = 0;
  try {
    await startVisualVideos(visuals);
    recorder.start(1000);
    writeSystemLog(`MediaRecorder başladı: state=${recorder.state} · video=${outputStream.getVideoTracks().length} · audio=${outputStream.getAudioTracks().length}.`, 'success');
    videoTrack.requestFrame?.();
    if (backgroundElement) backgroundElement.currentTime = 0;
    if (narrationElement) narrationElement.currentTime = 0;
    await Promise.all([
      backgroundElement?.play().catch(() => undefined),
      narrationElement?.play().catch(() => undefined),
    ]);

    await runFrameLoop(elapsed => {
      drawFrame(context, visuals, elapsed, duration, options.text, config, options.script);
      videoTrack.requestFrame?.();
      drawnFrames += 1;
      const progress = Math.min(98, Math.round((elapsed / duration) * 98));
      onProgress?.(progress, `MP4 görüntü ve sesle oluşturuluyor · ${Math.ceil(duration - elapsed)} sn`);
    }, duration);
    writeSystemLog(`Tüm video kareleri çizildi: ${drawnFrames} kare; kayıt sonlandırılıyor.`, 'success');
  } catch (error) {
    renderFailure = error instanceof Error ? error : new Error(String(error));
    writeSystemLog(`Kare üretimi yarıda kesildi; oluşan kayıt parçası korunuyor: ${renderFailure.message}`, 'warn');
  } finally {
    if (recorder.state !== 'inactive') {
      try { recorder.requestData(); } catch { /* tarayıcı zaten son parçayı göndermiş olabilir */ }
      try { recorder.stop(); } catch { /* kayıt hatası sonrasında inactive olabilir */ }
    }
    await stopped;
    backgroundElement?.pause();
    narrationElement?.pause();
    visuals.forEach(visual => visual.kind === 'video' && visual.source.pause());
    outputStream.getTracks().forEach(track => track.stop());
    await audioContext?.close().catch(() => undefined);
    if (narrationUrl) URL.revokeObjectURL(narrationUrl);
  }

  renderFailure ||= recorderFailure;
  const recordedBlob = new Blob(chunks, { type: recorder.mimeType || format.mimeType });
  if (!recordedBlob.size) {
    throw new PartialRenderError(renderFailure?.message || 'Video dosyası boş oluşturuldu.');
  }
  writeSystemLog(
    `${format.extension.toUpperCase()} kayıt tamamlandı: ${chunks.length} parça · ${drawnFrames} kare · ${(recordedBlob.size / 1024 / 1024).toFixed(1)} MB.`,
    'success',
  );

  let result: LocalRenderResult;
  try {
    let mp4Blob = recordedBlob;
    if (!format.directMp4) {
      onProgress?.(99, 'Video MP4 biçimine dönüştürülüyor...');
      mp4Blob = await convertToConstantFrameRateMp4(recordedBlob, 'webm', progress => {
        onProgress?.(99, `MP4 dönüştürülüyor · %${progress}`);
      });
    }
    if (!mp4Blob.size) throw new Error('MP4 dosyası boş oluşturuldu.');
    let measuredFrameRate = readMp4AverageFrameRate(await mp4Blob.arrayBuffer());
    writeSystemLog(
      `MP4 kare hızı doğrulaması: ${measuredFrameRate === null ? 'okunamadı' : `${measuredFrameRate.toFixed(2)} FPS`}.`,
      isInstagramCompatibleFrameRate(measuredFrameRate) ? 'success' : 'warn',
    );
    if (!isInstagramCompatibleFrameRate(measuredFrameRate)) {
      onProgress?.(99, 'Instagram uyumlu sabit 30 FPS hazırlanıyor...');
      writeSystemLog('MP4 sosyal medya kare hızı uygun değil; sabit 30 FPS olarak düzeltiliyor.', 'warn');
      mp4Blob = await convertToConstantFrameRateMp4(mp4Blob, 'mp4', progress => {
        onProgress?.(99, `Sabit 30 FPS hazırlanıyor · %${progress}`);
      });
      measuredFrameRate = readMp4AverageFrameRate(await mp4Blob.arrayBuffer());
      if (measuredFrameRate === null || !isInstagramCompatibleFrameRate(measuredFrameRate)) {
        throw new Error(`MP4 sabit 30 FPS doğrulanamadı (${measuredFrameRate?.toFixed(2) || 'okunamadı'} FPS).`);
      }
      writeSystemLog(`MP4 kare hızı düzeltildi: ${measuredFrameRate.toFixed(2)} FPS.`, 'success');
    }
    const metadata = await inspectVideoBlob(mp4Blob);
    writeSystemLog(
      `MP4 doğrulandı: ${metadata.width}x${metadata.height} · ${Number.isFinite(metadata.duration) ? metadata.duration.toFixed(1) : '?'} sn.`,
      'success',
    );
    result = {
      blob: mp4Blob,
      url: URL.createObjectURL(mp4Blob),
      extension: 'mp4',
      mimeType: 'video/mp4',
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    writeSystemLog(`MP4 tamamlanamadı; ham video parçası korundu: ${reason}`, 'warn');
    const partial: LocalRenderResult = {
      blob: recordedBlob,
      url: URL.createObjectURL(recordedBlob),
      extension: format.extension,
      mimeType: recordedBlob.type || format.mimeType,
    };
    throw new PartialRenderError(`MP4 oluşturulamadı: ${reason}`, partial);
  }

  onProgress?.(100, 'MP4 video hazır ve otomatik indiriliyor');
  if (renderFailure) throw new PartialRenderError(`Video yarıda kesildi: ${renderFailure.message}`, result);
  return result;
}

export async function renderLocally(options: LocalRenderOptions): Promise<LocalRenderResult> {
  const { width, height } = getDimensions(options.config, options.outputType);
  options.canvas.width = width;
  options.canvas.height = height;
  options.onProgress?.(3, 'Yerel medya hazırlanıyor...');
  writeSystemLog(
    `Yerel üretim ayarları: ${width}x${height} · ${options.config.aspectRatio} · ${options.config.videoFormat.toUpperCase()} · ${options.outputType}.`,
  );

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
