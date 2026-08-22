import type { MediaFile, RenderConfig } from '@otonom/shared-types';
import { writeSystemLog } from '@otonom/shared-utils';
import { buildNewspaperNarration } from './newspaperCopy';
import {
  buildVerifiedCoverHook,
  filterIndependentNewspaperHeadlines,
  groundedNewspaperHook,
  hasStrictOcrConsensus,
  isLikelyCompleteNewspaperHeadline,
  isProminentSingleWordLine,
  isReliableNewspaperDetail,
  newspaperHeadlineRejectionReason,
  normalizeOcrEvidence,
  selectStrictDetailLines,
} from './newspaperVerification';

const API_BASE = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '');
const MAX_ANALYSIS_IMAGES = 3;
const MAX_IMAGE_EDGE = 1600;
const MAX_OCR_IMAGE_EDGE = 2600;
const ACCESS_TOKEN_STORAGE_KEY = 'hermes_ai_access_token';

export interface HermesVideoSlide {
  sourceHeadlineId?: string;
  sourceHeadline?: string;
  topText: string;
  spokenText: string;
  imagePrompts: string[];
}

export interface HermesScript {
  isContentUnreadable?: boolean;
  videoSlides: HermesVideoSlide[];
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

export interface AnalyzeResult {
  provider: string;
  model: string;
  attempts: Array<{
    provider: string;
    model: string;
    ok: boolean;
    status?: number;
    reason?: string;
  }>;
  script: HermesScript;
  fallbackReason?: string;
}

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: { message?: string };
}

interface LocalOcrHeadlineCandidate {
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

function parseLocalOcrCandidates(ocrText: string): LocalOcrHeadlineCandidate[] {
  return ocrText
    .split(/\n+/)
    .map(line => line.match(/^(H\d+)\|score=(\d+)\|confidence=(\d+)\|x=(-?\d+)\|y=(-?\d+)\|w=(\d+)\|h=(\d+)\|text=(.*?)\|detail=(.*)$/i))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map(match => ({
      id: match[1].toUpperCase(), score: Number(match[2]), confidence: Number(match[3]),
      x: Number(match[4]), y: Number(match[5]), w: Number(match[6]), h: Number(match[7]),
      text: match[8].trim(), detail: match[9].trim(),
    }))
    .filter((candidate, index, all) => candidate.text && all.findIndex(item => item.id === candidate.id) === index)
    .sort((left, right) => Number(left.id.slice(1)) - Number(right.id.slice(1)))
    .slice(0, 8);
}

function readBlobAsDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Görsel analiz için okunamadı.'));
    reader.readAsDataURL(blob);
  });
}

async function shrinkImage(blob: Blob, maxEdge = MAX_IMAGE_EDGE, quality = 0.82) {
  const bitmap = await createImageBitmap(blob);
  try {
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Görsel küçültme alanı oluşturulamadı.');
    context.drawImage(bitmap, 0, 0, width, height);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        result => result ? resolve(result) : reject(new Error('Görsel küçültülemedi.')),
        'image/jpeg',
        quality,
      );
    });
  } finally {
    bitmap.close();
  }
}

async function extractTextLocally(media: MediaFile, configuredSourceName = '') {
  const url = media.url || media.thumbnailUrl;
  if (!url) throw new Error('Yerel OCR için gazete görseli bulunamadı.');
  writeSystemLog('Gazete başlıklarını ve büyüklük sırasını doğrulamak için tablet üzerinde Türkçe OCR başlatılıyor.');
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Gazete görseli OCR için açılamadı (HTTP ${response.status}).`);
  const source = await response.blob();
  const image = media.type === 'video'
    ? await videoFrameToImage(source)
    : await shrinkImage(source, MAX_OCR_IMAGE_EDGE, 0.9).catch(() => source);
  const { createWorker, OEM, PSM } = await import('tesseract.js');
  let progressBucket = -1;
  let verificationMode = false;
  const worker = await createWorker('tur', OEM.LSTM_ONLY, {
    logger: event => {
      if (verificationMode) return;
      if (event.status !== 'recognizing text' || typeof event.progress !== 'number') return;
      const bucket = Math.floor(event.progress * 10);
      if (bucket === progressBucket) return;
      progressBucket = bucket;
      writeSystemLog(`Yerel gazete OCR: %${Math.min(100, bucket * 10)}`);
    },
  });
  try {
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
    const result = await worker.recognize(image, {}, { blocks: true, text: true });
    const text = result.data.text.replace(/\s+\n/g, '\n').trim();
    const wordCount = text.split(/\s+/).filter(Boolean).length;
    if (wordCount < 20) throw new Error('Gazete görselinden yeterli okunabilir metin çıkarılamadı.');
    const normalizedSourceName = configuredSourceName.replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    const excludedText = /^(\d{1,2}\s+\p{L}+\s+\d{4}|abone ol|beğen|paylaş|günün sorusu|son söz)/iu;
    const allOcrLines = (result.data.blocks || [])
      .flatMap(block => block.paragraphs || [])
      .flatMap(paragraph => paragraph.lines || [])
      .map(line => {
        const lineText = line.text.replace(/\s+/g, ' ').trim();
        const height = Math.max(1, line.bbox.y1 - line.bbox.y0);
        const width = Math.max(1, line.bbox.x1 - line.bbox.x0);
        return {
          text: lineText,
          confidence: line.confidence,
          score: height * Math.sqrt(width),
          x0: line.bbox.x0,
          y0: line.bbox.y0,
          x1: line.bbox.x1,
          y1: line.bbox.y1,
          width,
          height,
        };
      });
    const maximumLineHeight = Math.max(1, ...allOcrLines.map(line => line.height));
    const ocrLines = allOcrLines.filter(line => {
        const substantialWords = line.text.split(/\s+/)
          .map(word => word.replace(/[^\p{L}\p{N}]/gu, ''))
          .filter(word => word.length >= 3);
        const letters = (line.text.match(/\p{L}/gu) || []).length;
        return line.confidence >= 45
          && line.text.length <= 160
          && (substantialWords.length >= 2 || isProminentSingleWordLine(
            line.text,
            line.confidence,
            line.height,
            maximumLineHeight,
          ))
          && letters / Math.max(1, line.text.length) >= 0.45
          && !excludedText.test(line.text.trim())
          && normalizeOcrEvidence(line.text) !== normalizeOcrEvidence(normalizedSourceName);
      })
      .sort((left, right) => left.y0 - right.y0 || left.x0 - right.x0);

    const groups: Array<{ lines: typeof ocrLines }> = [];
    for (const line of ocrLines) {
      let bestGroup: { lines: typeof ocrLines } | null = null;
      let bestScore = -Infinity;
      for (const group of groups) {
        const previous = group.lines.at(-1);
        if (!previous) continue;
        const verticalGap = line.y0 - previous.y1;
        const overlap = Math.max(0, Math.min(line.x1, previous.x1) - Math.max(line.x0, previous.x0))
          / Math.max(1, Math.min(line.width, previous.width));
        const heightRatio = Math.min(line.height, previous.height) / Math.max(line.height, previous.height);
        if (verticalGap >= -Math.min(line.height, previous.height) * 0.3
          && verticalGap <= Math.max(line.height, previous.height) * 0.9
          && overlap >= 0.3
          && heightRatio >= 0.45) {
          const candidateScore = overlap - verticalGap / Math.max(line.height, previous.height);
          if (candidateScore > bestScore) {
            bestGroup = group;
            bestScore = candidateScore;
          }
        }
      }
      if (bestGroup) bestGroup.lines.push(line);
      else groups.push({ lines: [line] });
    }

    const groupedCandidates = groups
      .map(group => {
        const x0 = Math.min(...group.lines.map(line => line.x0));
        const y0 = Math.min(...group.lines.map(line => line.y0));
        const x1 = Math.max(...group.lines.map(line => line.x1));
        const y1 = Math.max(...group.lines.map(line => line.y1));
        const candidateText = group.lines.map(line => line.text).join(' ').replace(/\s+/g, ' ').trim();
        const maxHeight = Math.max(...group.lines.map(line => line.height));
        const detailLines = selectStrictDetailLines(
          { x0, y0, x1, y1, width: x1 - x0, height: y1 - y0 },
          allOcrLines.filter(line => !group.lines.includes(line)),
        );
        const confidence = Math.min(...group.lines.map(line => line.confidence));
        return {
          text: candidateText,
          detailLines,
          confidence,
          score: maxHeight * Math.sqrt(Math.max(1, x1 - x0)),
          x0, y0, x1, y1, width: x1 - x0, height: y1 - y0,
        };
      })
      .filter(candidate => {
        const reason = newspaperHeadlineRejectionReason(candidate.text);
        if (reason) writeSystemLog(`Haber olmayan metin atlandı (${reason}): “${candidate.text}”`, 'warn');
        return !reason && isLikelyCompleteNewspaperHeadline(candidate.text);
      })
      .sort((left, right) => right.score - left.score)
      .filter((candidate, index, all) => {
        const normalized = candidate.text.toLocaleLowerCase('tr-TR').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
        return all.findIndex(item => item.text.toLocaleLowerCase('tr-TR').replace(/[^\p{L}\p{N}]+/gu, ' ').trim() === normalized) === index;
      });
    const independentCandidates = filterIndependentNewspaperHeadlines(groupedCandidates);
    const headlineCandidates = independentCandidates.slice(0, 12);
    for (const candidate of groupedCandidates) {
      if (!independentCandidates.includes(candidate)) {
        writeSystemLog(`Aynı haber bölgesindeki alt etiket atlandı: “${candidate.text}”`, 'warn');
      }
    }
    if (!headlineCandidates.length) throw new Error('OCR doğrulanabilecek bir başlık bölgesi bulamadı.');

    verificationMode = true;
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
    const verificationBitmap = await createImageBitmap(image);
    const verificationWidth = verificationBitmap.width;
    const verificationHeight = verificationBitmap.height;
    verificationBitmap.close();
    const verifiedCandidates = [];
    for (let index = 0; index < headlineCandidates.length; index += 1) {
      const candidate = headlineCandidates[index];
      writeSystemLog(`Kesin okuma doğrulaması: ${index + 1}/${headlineCandidates.length}`);
      const padX = Math.max(3, Math.round(candidate.width * 0.03));
      const padY = Math.max(3, Math.round(candidate.height * 0.12));
      const left = Math.max(0, candidate.x0 - padX);
      const top = Math.max(0, candidate.y0 - padY);
      const headlineRectangle = {
        left,
        top,
        width: Math.max(1, Math.min(candidate.width + padX * 2, verificationWidth - left)),
        height: Math.max(1, Math.min(candidate.height + padY * 2, verificationHeight - top)),
      };
      const verification = await worker.recognize(image, { rectangle: headlineRectangle }, { text: true });
      const verificationText = verification.data.text.replace(/\s+/g, ' ').trim();
      if (!hasStrictOcrConsensus(candidate.text, verificationText, candidate.confidence, verification.data.confidence)) {
        writeSystemLog(
          `Başlık atlandı: iki bağımsız OCR okuması uyuşmadı · P${Math.round(candidate.confidence)}/V${Math.round(verification.data.confidence)} · “${candidate.text}”`,
          'warn',
        );
        continue;
      }
      let detailVerificationText = verificationText;
      let detailVerificationConfidence = verification.data.confidence;
      if (candidate.detailLines.length) {
        const detailBottom = candidate.detailLines.at(-1)?.y1 || candidate.y1;
        const articleRectangle = {
          ...headlineRectangle,
          height: Math.max(1, Math.min(detailBottom - candidate.y0 + padY * 2, verificationHeight - top)),
        };
        const detailVerification = await worker.recognize(image, { rectangle: articleRectangle }, { text: true });
        detailVerificationText = detailVerification.data.text.replace(/\s+/g, ' ').trim();
        detailVerificationConfidence = detailVerification.data.confidence;
      }
      const rawVerifiedDetail = candidate.detailLines
        .filter(line => hasStrictOcrConsensus(
          line.text,
          detailVerificationText,
          line.confidence,
          detailVerificationConfidence,
        ))
        .map(line => line.text)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      const verifiedDetail = isReliableNewspaperDetail(rawVerifiedDetail) ? rawVerifiedDetail : '';
      if (rawVerifiedDetail && !verifiedDetail) {
        writeSystemLog(`Detay atlandı: tam ve güvenilir cümle doğrulanamadı · ${index + 1}. başlık`, 'warn');
      }
      verifiedCandidates.push({ ...candidate, detail: verifiedDetail });
    }
    if (!verifiedCandidates.length) {
      throw new Error('Gazete metni iki bağımsız OCR okumasında doğrulanamadı; yanlış okumamak için video durduruldu.');
    }

    const independentVerifiedCandidates = filterIndependentNewspaperHeadlines(verifiedCandidates);
    for (const candidate of verifiedCandidates) {
      if (!independentVerifiedCandidates.includes(candidate)) {
        writeSystemLog(`Doğrulandı fakat bağımsız haber olmadığı için atlandı: “${candidate.text}”`, 'warn');
      }
    }
    if (!independentVerifiedCandidates.length) {
      throw new Error('Bağımsız ve doğrulanmış gazete başlığı bulunamadı; yanlış okumamak için video durduruldu.');
    }

    const candidateText = independentVerifiedCandidates.map((candidate, index) => {
      const safeText = candidate.text.replace(/[|\n]+/g, ' ').trim();
      const safeDetail = candidate.detail.replace(/[|\n]+/g, ' ').trim();
      return `H${index + 1}|score=${Math.round(candidate.score)}|confidence=${Math.round(candidate.confidence)}|x=${candidate.x0}|y=${candidate.y0}|w=${candidate.width}|h=${candidate.height}|text=${safeText}|detail=${safeDetail}`;
    }).join('\n');
    writeSystemLog(
      `Kesin OCR tamamlandı: ${wordCount} kelime · ${independentVerifiedCandidates.length} bağımsız doğrulanmış başlık · ${headlineCandidates.length - independentVerifiedCandidates.length} şüpheli/alt etiket atlandı.`,
      'success',
    );
    writeSystemLog(
      `Doğrulanmış tam başlık sırası: ${independentVerifiedCandidates.map((candidate, index) => `H${index + 1} “${candidate.text}”`).join(' · ')}`,
      'success',
    );
    return `OCR_HEADLINE_CANDIDATES (kimlikler ve sıralama sabittir):\n${candidateText}\n\nOCR TAM METİN:\n${text}`;
  } finally {
    await worker.terminate();
  }
}

async function videoFrameToImage(blob: Blob) {
  const url = URL.createObjectURL(blob);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = url;
  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(new Error('Videodan analiz karesi alınamadı.'));
      video.load();
    });
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Video analiz karesi hazırlanamadı.');
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        result => result ? resolve(result) : reject(new Error('Video analiz karesi kaydedilemedi.')),
        'image/jpeg',
        0.82,
      );
    });
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}

async function mediaToAnalysisImage(media: MediaFile) {
  const url = media.url || media.thumbnailUrl;
  if (!url || (media.type !== 'image' && media.type !== 'video')) return null;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${media.name} analiz için açılamadı.`);
  const source = await response.blob();
  const optimized = media.type === 'video'
    ? await videoFrameToImage(source)
    : await shrinkImage(source).catch(() => source);
  const dataUrl = await readBlobAsDataUrl(optimized);
  const comma = dataUrl.indexOf(',');
  if (comma < 0) throw new Error(`${media.name} görsel verisine çevrilemedi.`);
  return {
    name: media.name,
    mimeType: optimized.type || media.mimeType || 'image/jpeg',
    data: dataUrl.slice(comma + 1),
  };
}

async function request<T>(path: string, body: unknown, allowTokenPrompt = true): Promise<T> {
  const accessToken = localStorage.getItem(ACCESS_TOKEN_STORAGE_KEY)?.trim();
  const startedAt = performance.now();
  writeSystemLog(`AI API isteği gönderiliyor: ${path}`);
  const response = await fetch(`${API_BASE}/ai${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { 'X-Hermes-Access': accessToken } : {}),
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null) as ApiEnvelope<T> | null;
  const elapsedMs = Math.round(performance.now() - startedAt);
  writeSystemLog(
    `AI API yanıtı: ${path} · HTTP ${response.status} · ${elapsedMs} ms`,
    response.ok ? 'info' : 'warn',
  );

  if (response.status === 401 && allowTokenPrompt) {
    writeSystemLog('Hermes AI erişim anahtarı gerekli; kullanıcıdan güvenli giriş bekleniyor.', 'warn');
    localStorage.removeItem(ACCESS_TOKEN_STORAGE_KEY);
    const supplied = window.prompt('Hermes AI erişim anahtarını girin. Bu değer yalnızca bu tarayıcıda saklanır.');
    if (supplied?.trim()) {
      localStorage.setItem(ACCESS_TOKEN_STORAGE_KEY, supplied.trim());
      return request<T>(path, body, false);
    }
  }

  if (!response.ok || !payload?.success || !payload.data) {
    writeSystemLog(`AI API başarısız: ${path} · ${payload?.error?.message || `HTTP ${response.status}`}`, 'error');
    throw new Error(payload?.error?.message || `AI servisi yanıt vermedi (HTTP ${response.status}).`);
  }
  return payload.data;
}

function normalizeScript(script: HermesScript): HermesScript {
  const videoSlides = Array.isArray(script.videoSlides)
    ? script.videoSlides
      .filter(slide => slide && (slide.spokenText || slide.topText))
      .map(slide => ({
        sourceHeadlineId: String(slide.sourceHeadlineId || '').trim() || undefined,
        sourceHeadline: String(slide.sourceHeadline || '').trim() || undefined,
        topText: String(slide.topText || '').trim(),
        spokenText: String(slide.spokenText || slide.topText || '').trim(),
        imagePrompts: Array.isArray(slide.imagePrompts) ? slide.imagePrompts.map(String) : [],
      }))
    : [];
  if (!videoSlides.length) throw new Error('AI kullanılabilir video sahnesi üretmedi.');
  return { ...script, videoSlides };
}

function applyLocalNewspaperOrder(
  script: HermesScript,
  candidates: LocalOcrHeadlineCandidate[],
  configuredSourceName?: string,
): HermesScript {
  if (!candidates.length) {
    throw new Error('Doğrulanmış gazete başlığı bulunamadı; yanlış okumamak için seslendirme durduruldu.');
  }
  const selected = candidates.slice(0, 8);
  const sourceName = String(configuredSourceName || script.sourceName || 'Gazete').trim();
  const videoSlides = selected.map(candidate => {
    const aiSlide = script.videoSlides.find(slide => String(slide.sourceHeadlineId || '').toUpperCase() === candidate.id);
    const hook = groundedNewspaperHook(aiSlide?.topText || '', candidate.text);
    const spokenText = buildNewspaperNarration({
      sourceName,
      headline: candidate.text,
      detail: candidate.detail,
    });
    return {
      sourceHeadlineId: candidate.id,
      sourceHeadline: candidate.text,
      topText: hook,
      spokenText,
      imagePrompts: [],
    };
  });
  return {
    ...script,
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
  };
}

export async function analyzeForVideo(options: {
  inputType: 'text' | 'url' | 'media' | 'prompt' | 'gazete';
  text: string;
  media: MediaFile[];
  config: RenderConfig;
}): Promise<AnalyzeResult> {
  const imageCandidates = options.media
    .filter(item => item.type === 'image' || item.type === 'video')
    .slice(0, MAX_ANALYSIS_IMAGES);
  const ocrPromise = options.inputType === 'gazete' && imageCandidates[0]
    ? extractTextLocally(imageCandidates[0], options.config.sourceName)
    : Promise.resolve('');
  const settled = await Promise.allSettled(imageCandidates.map(mediaToAnalysisImage));
  const images = settled
    .filter((item): item is PromiseFulfilledResult<NonNullable<Awaited<ReturnType<typeof mediaToAnalysisImage>>>> => item.status === 'fulfilled' && Boolean(item.value))
    .map(item => item.value);
  let localOcrText = await ocrPromise;

  const requestConfig = {
    duration: options.config.duration,
    language: options.config.language,
    analysisMode: options.config.analysisMode,
    videoStyle: options.config.videoStyle,
    imageStyle: options.config.imageStyle,
    tip: options.config.tip,
    sourceName: options.config.sourceName,
    yorum: options.config.yorum,
  };
  let result = await request<AnalyzeResult>('/analyze', {
    inputType: options.inputType,
    text: [
      options.text.trim(),
      options.inputType === 'gazete' && localOcrText
        ? 'YAYIN TALİMATI: Her topText, bağlı olduğu gerçek habere göre merak ve devamını dinleme isteği uyandıran bir hook olmalı. Gerçeği çarpıtma, başlığı aynen tekrarlama ve dört kelimeyi kesinlikle aşma.'
        : '',
      localOcrText,
    ].filter(Boolean).join('\n\n'),
    // Gazete görseli cihazdan çıkmaz; yerel OCR metni analiz için yeterlidir.
    images: options.inputType === 'gazete' && localOcrText ? [] : images,
    config: requestConfig,
  });

  if (result.provider === 'local-fallback' && imageCandidates.length && !localOcrText) {
    writeSystemLog(`Canlı görsel sağlayıcıları sonuç üretemedi: ${result.fallbackReason || 'sağlayıcı hatası'}`, 'warn');
    try {
      localOcrText ||= await extractTextLocally(imageCandidates[0], options.config.sourceName);
      result = await request<AnalyzeResult>('/analyze', {
        inputType: options.inputType === 'gazete' ? 'gazete' : 'text',
        text: localOcrText,
        images: [],
        config: requestConfig,
      });
      writeSystemLog(
        result.provider === 'local-fallback'
          ? 'AI metin sağlayıcısı da kullanılamadı; gerçek OCR satırlarından güvenli senaryo oluşturuldu.'
          : `OCR metni başarıyla analiz edildi: ${result.provider} / ${result.model}.`,
        result.provider === 'local-fallback' ? 'warn' : 'success',
      );
    } catch (ocrError) {
      const reason = ocrError instanceof Error ? ocrError.message : String(ocrError);
      writeSystemLog(`Yerel OCR tamamlanamadı; ilk güvenli senaryo korunuyor: ${reason}`, 'warn');
    }
  }

  const localCandidates = options.inputType === 'gazete' ? parseLocalOcrCandidates(localOcrText) : [];
  const orderedScript = options.inputType === 'gazete'
    ? applyLocalNewspaperOrder(result.script, localCandidates, options.config.sourceName)
    : result.script;
  if (localCandidates.length) {
    writeSystemLog(
      `Kesin sahne kilidi hazır: ${Math.min(8, localCandidates.length)} doğrulanmış başlık · ${localCandidates.slice(0, 8).map(candidate => candidate.id).join(' → ')}.`,
      'success',
    );
    writeSystemLog(
      `Gazete hook ve ses akışı hazır: ${orderedScript.videoSlides.map(slide => `${slide.sourceHeadlineId} “${slide.topText}”`).join(' · ')} · kaynak + özgün başlık + detay.`,
      'success',
    );
  }
  return { ...result, script: normalizeScript(orderedScript) };
}

function decodeBase64(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function writeAscii(view: DataView, offset: number, text: string) {
  for (let index = 0; index < text.length; index += 1) view.setUint8(offset + index, text.charCodeAt(index));
}

function pcmToWav(pcm: Uint8Array, sampleRate: number) {
  const headerSize = 44;
  const buffer = new ArrayBuffer(headerSize + pcm.byteLength);
  const view = new DataView(buffer);
  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + pcm.byteLength, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, pcm.byteLength, true);
  new Uint8Array(buffer, headerSize).set(pcm);
  return new Blob([buffer], { type: 'audio/wav' });
}

export async function createNarration(text: string, voice = 'Aoede') {
  const speech = await request<{
    audioData: string;
    mimeType: string;
    sampleRate: number;
  }>('/tts', { text, voice });
  return pcmToWav(decodeBase64(speech.audioData), speech.sampleRate || 24000);
}
