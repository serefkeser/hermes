import type { MediaFile, RenderConfig } from '@otonom/shared-types';
import { writeSystemLog } from '@otonom/shared-utils';
import {
  buildLockedNewspaperScript,
  MAX_NEWSPAPER_STORIES,
  type VerifiedNewspaperCandidate,
} from './newspaperPipeline';
import {
  collapseSpatialDuplicateNewspaperHeadlines,
  filterIndependentNewspaperHeadlines,
  hasStrictOcrConsensus,
  isLikelyCompleteNewspaperHeadline,
  isNewspaperHeadlineContinuationLine,
  isProminentSingleWordLine,
  newspaperHeadlineRejectionReason,
  normalizeOcrEvidence,
  selectReliableNewspaperDetailText,
  selectVerifiedNewspaperDetailBlock,
  selectVerifiedOcrReading,
  selectStrictDetailLineGroups,
  shouldMergeRegionalOcrLine,
  shouldGroupNewspaperHeadlineLines,
  stripLeadingNewspaperSourceFragment,
} from './newspaperVerification';
import { fetchWithNetworkRetry } from './networkRetry';
import {
  recoverNewspaperCandidatesFromVision,
  type VisionNewspaperCandidate,
} from './newspaperVisionRecovery';
import { selectAnalysisMedia, shouldRetryWithLocalOcr } from './aiInputPolicy';

const API_BASE = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '');
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
  visionGazeteBasliklari?: VisionNewspaperCandidate[];
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

type LocalOcrHeadlineCandidate = VerifiedNewspaperCandidate;

function buildLocalOcrAnalysisText(candidateText: string, fullText: string) {
  return `OCR_HEADLINE_CANDIDATES (kimlikler ve sıralama sabittir):\n${candidateText}\n\nOCR TAM METİN:\n${fullText}`;
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
    .slice(0, MAX_NEWSPAPER_STORIES);
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
    const mapOcrLines = (blocks: typeof result.data.blocks) => (blocks || [])
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
    const allOcrLines = mapOcrLines(result.data.blocks);
    const verificationBitmap = await createImageBitmap(image);
    const verificationWidth = verificationBitmap.width;
    const verificationHeight = verificationBitmap.height;
    verificationBitmap.close();

    const columnWidth = verificationWidth / 2;
    const rowHeight = verificationHeight / 3;
    const regionalRectangles = Array.from({ length: 6 }, (_, index) => {
      const column = index % 2;
      const row = Math.floor(index / 2);
      const horizontalOverlap = columnWidth * 0.08;
      const verticalOverlap = rowHeight * 0.08;
      const left = Math.max(0, Math.floor(column * columnWidth - horizontalOverlap));
      const top = Math.max(0, Math.floor(row * rowHeight - verticalOverlap));
      const right = Math.min(verificationWidth, Math.ceil((column + 1) * columnWidth + horizontalOverlap));
      const bottom = Math.min(verificationHeight, Math.ceil((row + 1) * rowHeight + verticalOverlap));
      return { left, top, width: right - left, height: bottom - top };
    });

    writeSystemLog('Tam sayfa OCR tamamlandı; küçük haberler için 2×3 örtüşmeli bölgesel tarama başlatılıyor.');
    verificationMode = true;
    for (let regionIndex = 0; regionIndex < regionalRectangles.length; regionIndex += 1) {
      const regionalResult = await worker.recognize(
        image,
        { rectangle: regionalRectangles[regionIndex] },
        { blocks: true, text: true },
      );
      for (const regionalLine of mapOcrLines(regionalResult.data.blocks)) {
        const matchIndex = allOcrLines.findIndex(existing => shouldMergeRegionalOcrLine(existing, regionalLine));
        if (matchIndex < 0) allOcrLines.push(regionalLine);
        else {
          const existing = allOcrLines[matchIndex];
          if (regionalLine.confidence > existing.confidence) {
            allOcrLines[matchIndex] = regionalLine;
          }
        }
      }
      writeSystemLog(`Bölgesel gazete OCR: ${regionIndex + 1}/6`);
    }
    const maximumLineHeight = Math.max(1, ...allOcrLines.map(line => line.height));
    const ocrLines = allOcrLines.filter(line => {
        const substantialWords = line.text.split(/\s+/)
          .map(word => word.replace(/[^\p{L}\p{N}]/gu, ''))
          .filter(word => word.length >= 3);
        const letters = (line.text.match(/\p{L}/gu) || []).length;
        return line.confidence >= 45
          && line.text.length <= 160
          && (substantialWords.length >= 2
            || (substantialWords.length >= 1 && /\d/u.test(line.text))
            || isProminentSingleWordLine(
            line.text,
            line.confidence,
            line.height,
            maximumLineHeight,
          ) || isNewspaperHeadlineContinuationLine(
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
        const overlap = Math.max(0, Math.min(line.x1, previous.x1) - Math.max(line.x0, previous.x0))
          / Math.max(1, Math.min(line.width, previous.width));
        if (shouldGroupNewspaperHeadlineLines(previous, line)) {
          const verticalGap = line.y0 - previous.y1;
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
        const headlineLines = [...group.lines];
        while (headlineLines.length > 1) {
          const firstLine = headlineLines[0];
          const nextLine = headlineLines[1];
          const firstLetters = firstLine.text.match(/\p{L}/gu) || [];
          const firstUppercase = firstLine.text.match(/\p{Lu}/gu) || [];
          const isSmallUppercaseEyebrow = firstLetters.length >= 5
            && firstUppercase.length / firstLetters.length >= 0.78
            && firstLine.height < nextLine.height * 0.75;
          if (newspaperHeadlineRejectionReason(firstLine.text) !== 'grafik veya istatistik etiketi'
            && !isSmallUppercaseEyebrow) break;
          headlineLines.shift();
        }
        const x0 = Math.min(...headlineLines.map(line => line.x0));
        const y0 = Math.min(...headlineLines.map(line => line.y0));
        const x1 = Math.max(...headlineLines.map(line => line.x1));
        const y1 = Math.max(...headlineLines.map(line => line.y1));
        const candidateText = stripLeadingNewspaperSourceFragment(
          headlineLines.map(line => line.text).join(' ').replace(/\s+/g, ' ').trim(),
          configuredSourceName,
        );
        const maxHeight = Math.max(...headlineLines.map(line => line.height));
        const detailLineGroups = selectStrictDetailLineGroups(
          { x0, y0, x1, y1, width: x1 - x0, height: y1 - y0 },
          allOcrLines.filter(line => !group.lines.includes(line)),
        );
        const confidence = Math.min(...headlineLines.map(line => line.confidence));
        const hasByline = group.lines.some(
          line => newspaperHeadlineRejectionReason(line.text) === 'yazar/köşe yazısı künyesi',
        );
        return {
          text: candidateText,
          detailLineGroups,
          hasByline,
          confidence,
          score: maxHeight * Math.sqrt(Math.max(1, x1 - x0)),
          x0, y0, x1, y1, width: x1 - x0, height: y1 - y0,
        };
      })
      .filter(candidate => {
        const reason = candidate.hasByline
          ? 'yazar/köşe yazısı künyesi'
          : newspaperHeadlineRejectionReason(candidate.text);
        if (reason) writeSystemLog(`Haber olmayan metin atlandı (${reason}): “${candidate.text}”`, 'warn');
        return !reason && isLikelyCompleteNewspaperHeadline(candidate.text);
      })
      .sort((left, right) => right.score - left.score)
      .filter((candidate, index, all) => {
        const normalized = candidate.text.toLocaleLowerCase('tr-TR').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
        return all.findIndex(item => item.text.toLocaleLowerCase('tr-TR').replace(/[^\p{L}\p{N}]+/gu, ' ').trim() === normalized) === index;
      });
    const independentCandidates = filterIndependentNewspaperHeadlines(groupedCandidates);
    const headlineCandidates = independentCandidates.slice(0, 20);
    for (const candidate of groupedCandidates) {
      if (!independentCandidates.includes(candidate)) {
        writeSystemLog(`Aynı haber bölgesindeki alt etiket atlandı: “${candidate.text}”`, 'warn');
      }
    }
    if (!headlineCandidates.length) {
      writeSystemLog(
        'Yerel OCR tam metni okudu ancak güvenli bir başlık kutusu ayıramadı; tam görsel bölge kurtarmasına geçiliyor.',
        'warn',
      );
      return buildLocalOcrAnalysisText('', text);
    }

    verificationMode = true;
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
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
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
      const verification = await worker.recognize(image, { rectangle: headlineRectangle }, { text: true });
      const verificationReadings = [{
        text: verification.data.text.replace(/\s+/g, ' ').trim(),
        confidence: verification.data.confidence,
      }];
      let verifiedHeadline = selectVerifiedOcrReading(
        candidate.text,
        candidate.confidence,
        verificationReadings,
      );
      if (!verifiedHeadline) {
        await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
        const thirdPass = await worker.recognize(image, { rectangle: headlineRectangle }, { text: true });
        verificationReadings.push({
          text: thirdPass.data.text.replace(/\s+/g, ' ').trim(),
          confidence: thirdPass.data.confidence,
        });
        verifiedHeadline = selectVerifiedOcrReading(
          candidate.text,
          candidate.confidence,
          verificationReadings,
        );
      }
      if (!verifiedHeadline || !isLikelyCompleteNewspaperHeadline(verifiedHeadline)) {
        const observed = verificationReadings.map(reading => `“${reading.text || '-'}” (V${Math.round(reading.confidence)})`).join(' · ');
        writeSystemLog(
          `Başlık atlandı: üç OCR geçişinden ikisi uyuşmadı · “${candidate.text}” (P${Math.round(candidate.confidence)}) · ${observed}`,
          'warn',
        );
        continue;
      }
      let verifiedDetail = '';
      let lastObservedDetail = '';
      for (const detailLines of candidate.detailLineGroups) {
        const verifiedDetailLines = [];
        await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE });
        for (const line of detailLines) {
          const linePadX = Math.max(2, Math.round(line.width * 0.02));
          const linePadY = Math.max(2, Math.round(line.height * 0.2));
          const lineLeft = Math.max(0, line.x0 - linePadX);
          const lineTop = Math.max(0, line.y0 - linePadY);
          const lineRectangle = {
            left: lineLeft,
            top: lineTop,
            width: Math.max(1, Math.min(line.width + linePadX * 2, verificationWidth - lineLeft)),
            height: Math.max(1, Math.min(line.height + linePadY * 2, verificationHeight - lineTop)),
          };
          const lineVerification = await worker.recognize(image, { rectangle: lineRectangle }, { text: true });
          const detailReadings = [{
            text: lineVerification.data.text.replace(/\s+/g, ' ').trim(),
            confidence: lineVerification.data.confidence,
          }];
          let verifiedLine = selectVerifiedOcrReading(
            line.text,
            line.confidence,
            detailReadings,
          );
          if (!verifiedLine) {
            await worker.setParameters({ tessedit_pageseg_mode: PSM.RAW_LINE });
            const thirdLinePass = await worker.recognize(image, { rectangle: lineRectangle }, { text: true });
            detailReadings.push({
              text: thirdLinePass.data.text.replace(/\s+/g, ' ').trim(),
              confidence: thirdLinePass.data.confidence,
            });
            verifiedLine = selectVerifiedOcrReading(line.text, line.confidence, detailReadings);
            await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE });
          }
          if (!verifiedLine) {
            lastObservedDetail = detailReadings.map(reading => `“${reading.text || '-'}” (V${Math.round(reading.confidence)})`).join(' · ');
            break;
          }
          verifiedDetailLines.push(verifiedLine);
          const completeDetail = selectReliableNewspaperDetailText(verifiedDetailLines);
          if (completeDetail) {
            verifiedDetail = completeDetail;
            break;
          }
        }
        if (!verifiedDetail && detailLines.length) {
          const detailX0 = Math.min(...detailLines.map(line => line.x0));
          const detailY0 = Math.min(...detailLines.map(line => line.y0));
          const detailX1 = Math.max(...detailLines.map(line => line.x1));
          const detailY1 = Math.max(...detailLines.map(line => line.y1));
          const blockPadX = Math.max(2, Math.round((detailX1 - detailX0) * 0.015));
          const blockPadY = Math.max(2, Math.round((detailY1 - detailY0) * 0.08));
          const blockLeft = Math.max(0, detailX0 - blockPadX);
          const blockTop = Math.max(0, detailY0 - blockPadY);
          const detailRectangle = {
            left: blockLeft,
            top: blockTop,
            width: Math.max(1, Math.min(detailX1 - detailX0 + blockPadX * 2, verificationWidth - blockLeft)),
            height: Math.max(1, Math.min(detailY1 - detailY0 + blockPadY * 2, verificationHeight - blockTop)),
          };
          const blockReadings = [];
          await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
          const blockVerification = await worker.recognize(image, { rectangle: detailRectangle }, { text: true });
          blockReadings.push({
            text: blockVerification.data.text.replace(/\s+/g, ' ').trim(),
            confidence: blockVerification.data.confidence,
          });
          await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
          const sparseBlockVerification = await worker.recognize(image, { rectangle: detailRectangle }, { text: true });
          blockReadings.push({
            text: sparseBlockVerification.data.text.replace(/\s+/g, ' ').trim(),
            confidence: sparseBlockVerification.data.confidence,
          });
          verifiedDetail = selectVerifiedNewspaperDetailBlock(
            detailLines.map(line => ({ text: line.text, confidence: line.confidence })),
            blockReadings,
          );
          await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE });
          if (verifiedDetail) {
            writeSystemLog(`Açıklama bütün sütun kırpmasında doğrulandı · “${candidate.text}”`, 'success');
          } else {
            lastObservedDetail = blockReadings
              .map(reading => `“${reading.text || '-'}” (V${Math.round(reading.confidence)})`)
              .join(' · ');
          }
        }
        if (verifiedDetail) break;
      }
      if (!verifiedDetail && lastObservedDetail) {
        writeSystemLog(`Açıklama satırı atlandı: üç OCR geçişinden ikisi uyuşmadı · ${lastObservedDetail}`, 'warn');
      }
      if (!verifiedDetail) {
        writeSystemLog(`Detay atlandı: tam ve güvenilir cümle doğrulanamadı · ${index + 1}. başlık`, 'warn');
      }
      if (!verifiedDetail) {
        writeSystemLog(`Haber atlandı: başlığa bağlı tamamlanmış açıklama doğrulanamadı · “${candidate.text}”`, 'warn');
        continue;
      }
      verifiedCandidates.push({ ...candidate, text: verifiedHeadline, detail: verifiedDetail });
      if (verifiedCandidates.length === MAX_NEWSPAPER_STORIES) break;
    }
    if (!verifiedCandidates.length) {
      writeSystemLog(
        'Yerel OCR başlık kutularını iki geçişte doğrulayamadı; tam metin, görsel bölge önerileriyle çapraz doğrulanacak.',
        'warn',
      );
      return buildLocalOcrAnalysisText('', text);
    }

    const spatiallyUniqueVerifiedCandidates = collapseSpatialDuplicateNewspaperHeadlines(verifiedCandidates);
    const independentVerifiedCandidates = filterIndependentNewspaperHeadlines(spatiallyUniqueVerifiedCandidates);
    for (const candidate of verifiedCandidates) {
      if (!independentVerifiedCandidates.includes(candidate)) {
        writeSystemLog(`Doğrulandı fakat bağımsız haber olmadığı için atlandı: “${candidate.text}”`, 'warn');
      }
    }
    if (!independentVerifiedCandidates.length) {
      writeSystemLog(
        'Yerel OCR adayları bağımsız haber olarak ayrılamadı; tam metin, görsel bölge önerileriyle çapraz doğrulanacak.',
        'warn',
      );
      return buildLocalOcrAnalysisText('', text);
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
    return buildLocalOcrAnalysisText(candidateText, text);
  } finally {
    await worker.terminate();
  }
}

async function addLocalCropEvidenceToVisionCandidates(
  media: MediaFile,
  candidates: VisionNewspaperCandidate[],
) {
  if (!candidates.length) return candidates;
  const url = media.url || media.thumbnailUrl;
  if (!url) return candidates;
  writeSystemLog('Eksik haberler için tam-görsel kutuları tablette yakın OCR ile çapraz okunuyor.');
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const source = await response.blob();
    const image = media.type === 'video'
      ? await videoFrameToImage(source)
      : await shrinkImage(source, MAX_OCR_IMAGE_EDGE, 0.92).catch(() => source);
    const bitmap = await createImageBitmap(image);
    const imageWidth = bitmap.width;
    const imageHeight = bitmap.height;
    bitmap.close();
    const { createWorker, OEM, PSM } = await import('tesseract.js');
    const worker = await createWorker('tur', OEM.LSTM_ONLY);
    try {
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
      const enriched = [];
      for (let index = 0; index < Math.min(candidates.length, MAX_NEWSPAPER_STORIES); index += 1) {
        const candidate = candidates[index];
        const rawX = Number(candidate.x);
        const rawY = Number(candidate.y);
        const rawWidth = Number(candidate.w);
        const rawHeight = Number(candidate.h);
        if (![rawX, rawY, rawWidth, rawHeight].every(Number.isFinite) || rawWidth <= 0 || rawHeight <= 0) {
          enriched.push(candidate);
          continue;
        }
        const coordinateScale = Math.max(rawX, rawY, rawWidth, rawHeight) <= 1 ? 100 : 1;
        const x = Math.max(0, Math.min(100, rawX * coordinateScale));
        const y = Math.max(0, Math.min(100, rawY * coordinateScale));
        const widthPercent = Math.max(1, Math.min(100 - x, rawWidth * coordinateScale));
        const heightPercent = Math.max(1, Math.min(100 - y, rawHeight * coordinateScale));
        const boxLeft = x / 100 * imageWidth;
        const boxTop = y / 100 * imageHeight;
        const boxWidth = widthPercent / 100 * imageWidth;
        const boxHeight = heightPercent / 100 * imageHeight;
        const padX = Math.max(4, boxWidth * 0.04);
        const padTop = Math.max(3, boxHeight * 0.04);
        const padBottom = Math.max(6, boxHeight * 0.12);
        const left = Math.max(0, Math.floor(boxLeft - padX));
        const top = Math.max(0, Math.floor(boxTop - padTop));
        const right = Math.min(imageWidth, Math.ceil(boxLeft + boxWidth + padX));
        const bottom = Math.min(imageHeight, Math.ceil(boxTop + boxHeight + padBottom));
        const recognition = await worker.recognize(image, {
          rectangle: {
            left,
            top,
            width: Math.max(1, right - left),
            height: Math.max(1, bottom - top),
          },
        }, { text: true });
        const localCropEvidence = recognition.data.text.replace(/\s+/g, ' ').trim();
        enriched.push({ ...candidate, localCropEvidence });
        writeSystemLog(`Görsel haber kutusu yakın OCR: ${index + 1}/${Math.min(candidates.length, MAX_NEWSPAPER_STORIES)}`);
      }
      return enriched;
    } finally {
      await worker.terminate();
    }
  } catch (error) {
    writeSystemLog(
      `Görsel haber kutusu yakın OCR tamamlanamadı; tam sayfa yerel kanıt korunuyor: ${error instanceof Error ? error.message : String(error)}`,
      'warn',
    );
    return candidates;
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

async function mediaToAnalysisImage(media: MediaFile, maxImageEdge = MAX_IMAGE_EDGE, quality = 0.82) {
  const url = media.url || media.thumbnailUrl;
  if (!url || (media.type !== 'image' && media.type !== 'video')) return null;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${media.name} analiz için açılamadı.`);
  const source = await response.blob();
  const optimized = media.type === 'video'
    ? await videoFrameToImage(source)
    : await shrinkImage(source, maxImageEdge, quality).catch(() => source);
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
  const endpoint = `${API_BASE}/ai${path}`;
  const response = await fetchWithNetworkRetry(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { 'X-Hermes-Access': accessToken } : {}),
    },
    body: JSON.stringify(body),
  }, {
    endpoint: `/ai${path}`,
    onRetry: (attempt, delayMs, reason) => writeSystemLog(
      `AI API geçici bağlantı hatası: /ai${path} · ${reason} · ${attempt}. yeniden deneme ${delayMs} ms sonra.`,
      'warn',
    ),
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

export async function analyzeForVideo(options: {
  inputType: 'text' | 'url' | 'media' | 'prompt' | 'gazete';
  text: string;
  media: MediaFile[];
  config: RenderConfig;
}): Promise<AnalyzeResult> {
  const visualMediaCount = options.media.filter(item => item.type === 'image' || item.type === 'video').length;
  const imageCandidates = selectAnalysisMedia(options.media, options.inputType);
  if (visualMediaCount > imageCandidates.length && options.inputType === 'gazete') {
    writeSystemLog(
      `Gazete AI girdisi tekilleştirildi: ${visualMediaCount} medya kaydından aynı tam sayfaya ait 1 görsel gönderilecek.`,
      'info',
    );
  }
  const ocrPromise = options.inputType === 'gazete' && imageCandidates[0]
    ? extractTextLocally(imageCandidates[0], options.config.sourceName)
    : Promise.resolve('');
  const settled = await Promise.allSettled(imageCandidates.map(media => mediaToAnalysisImage(
    media,
    MAX_IMAGE_EDGE,
    options.inputType === 'gazete' ? 0.8 : 0.82,
  )));
  const images = settled
    .filter((item): item is PromiseFulfilledResult<NonNullable<Awaited<ReturnType<typeof mediaToAnalysisImage>>>> => item.status === 'fulfilled' && Boolean(item.value))
    .map(item => item.value);
  if (options.inputType === 'gazete' && images.length) {
    const estimatedBytes = Math.round(images.reduce((total, image) => total + image.data.length, 0) * 0.75);
    writeSystemLog(`Gazete AI görsel paketi hazır: ${images.length} görsel · yaklaşık ${Math.ceil(estimatedBytes / 1024)} KB.`);
  }
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
    // Gazete modunda yerel OCR metni kesin kanıttır; tam görsel ise yalnız
    // başlık-açıklama bölgelerini ve sayfa hiyerarşisini buldurur.
    images,
    config: requestConfig,
  });

  if (result.provider === 'local-fallback') {
    writeSystemLog(
      `Canlı görsel sağlayıcıları sonuç üretemedi: ${result.fallbackReason || 'sağlayıcı hatası'}`,
      'warn',
    );
  }
  if (result.provider === 'local-fallback' && imageCandidates.length) {
    try {
      localOcrText ||= await extractTextLocally(imageCandidates[0], options.config.sourceName);
      if (shouldRetryWithLocalOcr(result.provider, imageCandidates.length, localOcrText)) {
        writeSystemLog('Görsel sağlayıcılar kullanılamadı; hazır yerel OCR metniyle text-only kurtarma deneniyor.', 'warn');
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
      }
    } catch (ocrError) {
      const reason = ocrError instanceof Error ? ocrError.message : String(ocrError);
      writeSystemLog(`Yerel OCR tamamlanamadı; ilk güvenli senaryo korunuyor: ${reason}`, 'warn');
    }
  }

  writeSystemLog(
    `AI sağlayıcı sonucu: ${result.provider} / ${result.model}.`,
    result.provider === 'local-fallback' ? 'warn' : 'success',
  );
  result.attempts
    .filter(attempt => !attempt.ok)
    .forEach(attempt => writeSystemLog(
      `${attempt.provider} atlandı: ${attempt.status || attempt.reason || 'geçici hata'}`,
      'warn',
    ));

  const localCandidates = options.inputType === 'gazete' ? parseLocalOcrCandidates(localOcrText) : [];
  const visionCandidates = options.inputType === 'gazete'
    && localCandidates.length < 5
    && imageCandidates[0]
    && result.script.visionGazeteBasliklari?.length
    ? await addLocalCropEvidenceToVisionCandidates(
      imageCandidates[0],
      result.script.visionGazeteBasliklari,
    )
    : result.script.visionGazeteBasliklari;
  const recovery = options.inputType === 'gazete'
    ? recoverNewspaperCandidatesFromVision({
      localCandidates,
      visionCandidates,
      localOcrText,
      maximumStories: MAX_NEWSPAPER_STORIES,
    })
    : { candidates: localCandidates, recoveredCount: 0, rejected: [] };
  if (options.inputType === 'gazete') {
    writeSystemLog(
      `Gazete kanıt birleştirme: ${localCandidates.length} çift-geçiş OCR + ${recovery.recoveredCount} tam-görsel/yerel-OCR çapraz doğrulaması = ${recovery.candidates.length} bağımsız haber.`,
      recovery.candidates.length >= 5 ? 'success' : 'warn',
    );
    recovery.rejected.slice(0, 8).forEach(item => writeSystemLog(
      `Görsel haber önerisi atlandı (${item.reason}): “${item.headline}”`,
      'warn',
    ));
  }
  const orderedScript = options.inputType === 'gazete'
    ? buildLockedNewspaperScript({
      script: result.script,
      candidates: recovery.candidates,
      configuredSourceName: options.config.sourceName,
    })
    : result.script;
  if (recovery.candidates.length) {
    writeSystemLog(
      `Kesin sahne kilidi hazır: ${recovery.candidates.length} doğrulanmış başlık · ${recovery.candidates.map(candidate => candidate.id).join(' → ')}.`,
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
