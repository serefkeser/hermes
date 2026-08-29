// Main App component for OTONOM Web
import React, { useState, useEffect, useRef } from 'react';
import { Header } from './components/Header';
import { BackgroundMusicPicker } from './components/BackgroundMusicPicker';
import { TabBar } from './components/TabBar';
import { ConfigPanel } from './components/ConfigPanel';
import { MediaUpload } from './components/MediaUpload';
import { GazetePanel } from './components/GazetePanel';
import { ActionButtons } from './components/ActionButtons';
import { OutputPanel } from './components/OutputPanel';
import { ProcessingModal } from './components/ProcessingModal';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LogPanel } from './components/LogPanel';
import { PartialRenderError, renderLocally } from './lib/localRenderer';
import { analyzeForVideo, createNarration } from './lib/aiClient';
import { buildRenderStoryboard, getStoryboardNarration } from './lib/storyboard';
import { MIN_NEWSPAPER_STORIES } from './lib/newspaperPipeline';
import { buildSocialCaption, shareGeneratedMedia } from './lib/socialShare';
import { securePublicationPlan } from './lib/publicationSafety';
import { loadAutomaticDriveMusic } from './lib/driveMusic';
import { prepareGazeteMedia } from './lib/gazeteMediaPreparation';
import {
  AutoBufferPublishError,
  autoPublishGeneratedMedia,
  summarizeAutoBufferResult,
  type BufferDispatchResult,
} from './lib/autoBuffer';
import {
  captureSystemLog,
  downloadLastDiagnosticRun,
  finishDiagnosticRun,
  installDiagnosticErrorCapture,
  markDiagnosticRunInterrupted,
  recordDiagnosticEvent,
  recordDiagnosticProgress,
  recoverInterruptedDiagnosticRun,
  startDiagnosticRun,
} from './lib/diagnosticLog';
import { addSystemLog, fileToBase64, SafeStorage, writeSystemLog } from '@otonom/shared-utils';
import { RENDER_CONFIG } from '@otonom/shared-config';
import type { RenderConfig, MediaFile } from '@otonom/shared-types';

const DEFAULT_CONFIG: RenderConfig = {
  duration: '30',
  aspectRatio: '9:16',
  videoStyle: 'cinematic',
  fontStyle: 'modern',
  imageStyle: 'cinematic',
  language: 'tr',
  subtitles: 'on',
  resolution: '1K',
  transition: 'none',
  videoFormat: 'mp4',
  analysisMode: 'yorumsuz',
  tip: 'haber',
  sourceName: '',
  yorum: '',
  customSceneImages: [],
  backgroundMusicVolume: 0.29,
};

type AutoBufferState = 'idle' | 'uploading' | 'queued' | 'partial' | 'needs-key' | 'failed' | 'skipped';

async function localizeGazeteImage(src: string): Promise<string> {
  if (!/^https?:\/\//i.test(src)) return src;

  const response = await fetch(src, {
    cache: 'no-store',
    referrerPolicy: 'no-referrer',
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const blob = await response.blob();
  if (!blob.type.startsWith('image/')) throw new Error('Seçilen gazete dosyası görsel değil.');
  return fileToBase64(blob);
}

function autoDownloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2_000);
}

export function App() {
  const [activeTab, setActiveTab] = useState<'text' | 'url' | 'media' | 'prompt' | 'gazete'>('media');
  const [textInput, setTextInput] = useState(() => SafeStorage.getItem('ns_textInput') || '');
  const [config, setConfig] = useState<RenderConfig>(() => {
    const saved = SafeStorage.getItem('ns_config');
    const restored = saved ? { ...DEFAULT_CONFIG, ...JSON.parse(saved) } : DEFAULT_CONFIG;
    return { ...restored, resolution: '1K', videoFormat: 'mp4' };
  });
  const [selectedMediaFiles, setSelectedMediaFiles] = useState<MediaFile[]>([]);
  const [customSceneImages, setCustomSceneImages] = useState<string[]>([]);
  const [backgroundMusic, setBackgroundMusic] = useState<MediaFile | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingProgress, setProcessingProgress] = useState(0);
  const [processingStatus, setProcessingStatus] = useState('');
  const [error, setError] = useState<string>('');
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [outputType, setOutputType] = useState<'image' | 'video'>('video');
  const [outputExtension, setOutputExtension] = useState<'png' | 'mp4' | 'webm'>('mp4');
  const [logs, setLogs] = useState<string[]>([]);
  const [socialCaption, setSocialCaption] = useState('');
  const [autoBufferState, setAutoBufferState] = useState<AutoBufferState>('idle');
  const [autoBufferMessage, setAutoBufferMessage] = useState('Video tamamlandığında Buffer kuyruğuna otomatik gönderilecek.');
  const [autoBufferProgress, setAutoBufferProgress] = useState(0);
  const [autoBufferResults, setAutoBufferResults] = useState<BufferDispatchResult[]>([]);
  const [showLogPanel, setShowLogPanel] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const actionButtonsRef = useRef<HTMLDivElement>(null);
  const outputUrlRef = useRef<string | null>(null);
  const outputBlobRef = useRef<Blob | null>(null);
  const pendingGazetePreparationsRef = useRef(0);
  const pendingGazeteSourcesRef = useRef(new Set<string>());
  const [pendingGazetePreparationCount, setPendingGazetePreparationCount] = useState(0);

  // Persist config and text input
  useEffect(() => {
    SafeStorage.setItem('ns_config', JSON.stringify(config));
  }, [config]);

  useEffect(() => {
    SafeStorage.setItem('ns_textInput', textInput);
  }, [textInput]);

  // Log listener
  useEffect(() => {
    const unsubscribe = addSystemLog((log) => {
      captureSystemLog(log);
      setLogs(prev => [...prev.slice(-99), `[${log.timestamp}] ${log.type.toUpperCase()}: ${log.text}`]);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    const recovered = recoverInterruptedDiagnosticRun();
    if (recovered) {
      setLogs(prev => [...prev, `[${new Date().toLocaleTimeString('tr-TR')}] WARN: Yarıda kalan önceki üretimin tanılama logu kurtarıldı ve indirildi.`]);
    }
    const removeErrorCapture = installDiagnosticErrorCapture();
    const handlePageHide = () => markDiagnosticRunInterrupted('Üretim sürerken sayfa kapandı, yenilendi veya arka planda sonlandırıldı.');
    window.addEventListener('pagehide', handlePageHide);
    return () => {
      removeErrorCapture();
      window.removeEventListener('pagehide', handlePageHide);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (outputUrlRef.current) URL.revokeObjectURL(outputUrlRef.current);
    };
  }, []);

  const clearOutput = () => {
    if (outputUrlRef.current) {
      URL.revokeObjectURL(outputUrlRef.current);
      outputUrlRef.current = null;
    }
    outputBlobRef.current = null;
    setSocialCaption('');
    setAutoBufferState('idle');
    setAutoBufferMessage('Video tamamlandığında Buffer kuyruğuna otomatik gönderilecek.');
    setAutoBufferProgress(0);
    setAutoBufferResults([]);
    setVideoUrl(null);
  };

  const handleExecuteStart = async (forceOutputType?: 'image' | 'video') => {
    const outType = forceOutputType ?? (config.tip === 'guzel_soz' ? 'image' : 'video');

    if (pendingGazetePreparationsRef.current > 0) {
      setError('Gazete görselinin yerel kopyası hazırlanıyor. Hazırlık tamamlanmadan üretim başlatılmaz.');
      return;
    }

    if (config.tip === 'guzel_soz') {
      if (!textInput.trim() && selectedMediaFiles.length === 0) {
        setError('Güzel söz için metin veya resim girin.');
        return;
      }
    } else if (activeTab === 'media' || activeTab === 'gazete') {
      if (selectedMediaFiles.length === 0) {
        setError('En az bir dosya seçin.');
        return;
      }
    } else if (!textInput.trim()) {
      setError('Metin girin.');
      return;
    }

    setError('');
    setLogs([]);
    setIsProcessing(true);
    setProcessingProgress(0);
    setProcessingStatus('İçerik ücretsiz AI sağlayıcılarıyla analiz ediliyor...');
    clearOutput();
    const diagnosticRunId = startDiagnosticRun({
      outputType: outType,
      inputType: activeTab,
      config,
      media: selectedMediaFiles,
      customImageCount: customSceneImages.length,
      hasBackgroundMusic: Boolean(backgroundMusic),
    });

    try {
      writeSystemLog(`Üretim başlatıldı · tanılama kimliği: ${diagnosticRunId}`);
      let effectiveBackgroundMusic = backgroundMusic;
      if (outType === 'video' && !effectiveBackgroundMusic) {
        setProcessingStatus('Google Drive klasöründen arka plan müziği alınıyor...');
        effectiveBackgroundMusic = await loadAutomaticDriveMusic();
        setBackgroundMusic(effectiveBackgroundMusic);
        recordDiagnosticEvent('music.drive', 'Google Drive arka plan müziği otomatik yüklendi.', 'success', {
          name: effectiveBackgroundMusic.name,
          size: effectiveBackgroundMusic.size,
        });
      }
      writeSystemLog('AI analizi başlatıldı.');
      recordDiagnosticEvent('ai.analyze', 'AI analiz isteği hazırlanıyor.', 'info', {
        mediaCount: selectedMediaFiles.length,
        outputType: outType,
      });
      setProcessingProgress(5);
      const analysis = await analyzeForVideo({
        inputType: activeTab,
        text: textInput,
        media: selectedMediaFiles,
        config,
      });
      const safety = securePublicationPlan({
        script: analysis.script,
        sourceName: config.sourceName || analysis.script.sourceName,
        userComment: config.yorum,
      });
      const safeScript = safety.script;
      const slides = safeScript.videoSlides;
      const blockedSlides = safety.blocked.filter(item => item.kind === 'slide');
      recordDiagnosticEvent(
        'publication.safety',
        blockedSlides.length
          ? `${blockedSlides.length} riskli haber sahnesi yayın dışı bırakıldı.`
          : 'Video metni ve sosyal medya açıklaması yayın güvenliği kontrolünden geçti.',
        blockedSlides.length ? 'warn' : 'success',
        {
          policyVersion: safety.policyVersion,
          keptSlideCount: slides.length,
          blocked: safety.blocked.map(item => ({
            kind: item.kind,
            index: item.index,
            sourceHeadlineId: item.sourceHeadlineId,
            codes: item.codes,
          })),
        },
      );
      writeSystemLog(
        blockedSlides.length
          ? `Yayın güvenliği ${safety.policyVersion}: ${blockedSlides.length} riskli sahne atlandı; gerekçeler tanılama loguna yazıldı.`
          : `Yayın güvenliği ${safety.policyVersion}: metin, ses ve sosyal açıklama uygun.`,
        blockedSlides.length ? 'warn' : 'success',
      );
      const distinctHeadlineCount = new Set(
        slides
          .map(slide => String(slide.sourceHeadline || slide.topText || '').toLocaleLowerCase('tr-TR').replace(/[^\p{L}\p{N}]+/gu, ' ').trim())
          .filter(Boolean),
      ).size;
      writeSystemLog(`Analiz tamamlandı: ${analysis.provider} / ${analysis.model}`, 'success');
      if (activeTab === 'gazete') {
        writeSystemLog(
          `Gazete başlık kontrolü: ${distinctHeadlineCount} farklı haber · sıralama büyük ana manşetten küçük başlıklara.`,
          distinctHeadlineCount >= MIN_NEWSPAPER_STORIES ? 'success' : 'error',
        );
        if (distinctHeadlineCount < MIN_NEWSPAPER_STORIES) {
          throw new Error(
            `Yayın güvenliği sonrasında en az ${MIN_NEWSPAPER_STORIES} güvenli ve doğrulanmış haber kalmadı; eksik gazete videosu üretilmedi.`,
          );
        }
      }
      analysis.attempts
        .filter(attempt => !attempt.ok)
        .forEach(attempt => writeSystemLog(`${attempt.provider} atlandı: ${attempt.status || attempt.reason || 'geçici hata'}`, 'warn'));

      const runConfig = {
        ...config,
        resolution: '1K' as const,
        videoFormat: 'mp4' as const,
        sourceName: safety.sourceName,
        yorum: safety.userComment,
        customSceneImages,
        backgroundMusic: effectiveBackgroundMusic,
        backgroundMusicVolume: config.backgroundMusicVolume ?? 0.29,
      };
      const storyboard = buildRenderStoryboard(safeScript, runConfig);
      const preparedSocialCaption = buildSocialCaption({
        sourceName: runConfig.sourceName,
        hook: slides[0]?.topText || safeScript.thumbnailText,
        headlines: slides.map(slide => slide.sourceHeadline || slide.topText),
      });
      recordDiagnosticEvent('storyboard', 'Video sahne akışı oluşturuldu.', 'success', {
        aiSlideCount: slides.length,
        distinctHeadlineCount,
        renderSceneCount: storyboard.length,
        sceneKinds: storyboard.map(scene => scene.kind || 'content'),
      });
      writeSystemLog(
        `Tam video akışı hazır: kapak + ${slides.length} haber sahnesi + Son Söz${safeScript.gununSorusu ? ' + Günün Sorusu' : ''} + outro.`,
        'success',
      );

      setProcessingProgress(25);
      let narrationAudio: Blob | null = null;
      if (outType === 'video') {
        setProcessingStatus('Türkçe anlatım sesi oluşturuluyor...');
        const narrationText = getStoryboardNarration(storyboard);
        recordDiagnosticEvent('tts', 'Anlatım metni hazırlandı.', 'info', {
          characterCount: narrationText.length,
          wordCount: narrationText.trim().split(/\s+/).filter(Boolean).length,
          voice: 'Aoede',
        });
        if (narrationText) {
          try {
            narrationAudio = await createNarration(narrationText, 'Aoede');
            recordDiagnosticEvent('tts', 'Anlatım ses dosyası alındı.', 'success', {
              size: narrationAudio.size,
              mimeType: narrationAudio.type,
            });
            writeSystemLog('Kapak, haber, Son Söz ve outro anlatım sesi hazır.', 'success');
          } catch (ttsError) {
            const reason = ttsError instanceof Error ? ttsError.message : String(ttsError);
            recordDiagnosticEvent('tts', 'Anlatım alınamadı; sessiz video üretimi devam ediyor.', 'warn', { reason });
            writeSystemLog(`Anlatım alınamadı; video sessiz olarak devam ediyor: ${reason}`, 'warn');
          }
        }
      }

      if (!canvasRef.current) throw new Error('Yerel oluşturma alanı hazırlanamadı.');
      setProcessingProgress(40);
      setProcessingStatus('Video ve ses cihazınızda birleştiriliyor...');
      const result = await renderLocally({
        canvas: canvasRef.current,
        media: selectedMediaFiles,
        customImages: customSceneImages,
        text: outType === 'image'
          ? (safeScript.thumbnailText || slides[0]?.topText || slides[0]?.spokenText || textInput)
          : textInput,
        config: runConfig,
        backgroundMusic: effectiveBackgroundMusic,
        narrationAudio,
        script: outType === 'video' ? storyboard : slides,
        outputType: outType,
        onProgress: (progress, status) => {
          setProcessingProgress(Math.min(100, 40 + Math.round(progress * 0.6)));
          setProcessingStatus(status);
          recordDiagnosticProgress(progress, status);
        },
      });

      outputUrlRef.current = result.url;
      outputBlobRef.current = result.blob;
      setSocialCaption(preparedSocialCaption);
      setVideoUrl(result.url);
      setOutputType(outType);
      setOutputExtension(result.extension);
      setIsProcessing(false);
      setProcessingProgress(100);
      writeSystemLog(`Üretim tamamlandı: ${result.extension.toUpperCase()} · ${(result.blob.size / 1024 / 1024).toFixed(1)} MB`, 'success');
      const outputFilename = `otonom_${Date.now()}.${result.extension}`;
      autoDownloadBlob(result.blob, outputFilename);

      let bufferSummary: Record<string, unknown> = { status: 'skipped' };
      if (outType === 'video' && result.extension === 'mp4') {
        setAutoBufferState('uploading');
        setAutoBufferMessage('MP4, R2’ye yükleniyor ve bağlı Buffer kanalları hazırlanıyor...');
        setAutoBufferProgress(0);
        recordDiagnosticEvent('buffer.auto', 'Otomatik R2 yüklemesi ve Buffer kuyruğu başlatıldı.', 'info', {
          filename: outputFilename,
          size: result.blob.size,
          mimeType: result.mimeType,
        });
        try {
          const publishResult = await autoPublishGeneratedMedia({
            blob: result.blob,
            filename: outputFilename,
            caption: preparedSocialCaption,
            onProgress: progress => {
              setAutoBufferProgress(progress);
              setAutoBufferMessage(progress < 100
                ? `MP4, R2’ye yükleniyor: %${progress}`
                : 'R2 yüklemesi tamamlandı; Buffer kuyruğu doğrulanıyor...');
            },
          });
          const state = publishResult.failedCount ? 'partial' : 'queued';
          const message = summarizeAutoBufferResult(publishResult);
          setAutoBufferState(state);
          setAutoBufferMessage(message);
          setAutoBufferProgress(100);
          setAutoBufferResults(publishResult.results);
          bufferSummary = {
            status: state,
            queuedCount: publishResult.queuedCount,
            failedCount: publishResult.failedCount,
            mediaUrl: publishResult.mediaUrl,
            results: publishResult.results,
          };
          recordDiagnosticEvent(
            'buffer.auto',
            message,
            publishResult.failedCount ? 'warn' : 'success',
            bufferSummary,
          );
        } catch (publishError) {
          const message = publishError instanceof Error ? publishError.message : String(publishError);
          const needsKey = publishError instanceof AutoBufferPublishError && publishError.code === 'BUFFER_NOT_CONFIGURED';
          setAutoBufferState(needsKey ? 'needs-key' : 'failed');
          setAutoBufferMessage(needsKey
            ? 'Buffer API anahtarı henüz Worker’a eklenmemiş. Video cihazınıza indirildi; anahtar eklenince sonraki videolar otomatik kuyruğa girecek.'
            : `Otomatik Buffer gönderimi tamamlanamadı: ${message}`);
          setAutoBufferResults(publishError instanceof AutoBufferPublishError ? publishError.result?.results || [] : []);
          writeSystemLog(`BUFFER AUTO atlandı: ${message}`, 'warn');
          bufferSummary = {
            status: needsKey ? 'needs-key' : 'failed',
            code: publishError instanceof AutoBufferPublishError ? publishError.code : 'UNKNOWN',
            message,
            results: publishError instanceof AutoBufferPublishError ? publishError.result?.results : undefined,
          };
          recordDiagnosticEvent('buffer.auto', message, 'warn', bufferSummary);
        }
      } else {
        setAutoBufferState('skipped');
        setAutoBufferMessage('Otomatik Buffer kuyruğu yalnızca tamamlanmış MP4 videolarda çalışır.');
      }
      finishDiagnosticRun('success', {
        outputExtension: result.extension,
        mimeType: result.mimeType,
        fileSize: result.blob.size,
        sceneCount: storyboard.length,
        buffer: bufferSummary,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Bilinmeyen hata';
      if (err instanceof PartialRenderError && err.partialResult) {
        const partial = err.partialResult;
        outputUrlRef.current = partial.url;
        outputBlobRef.current = partial.blob;
        setVideoUrl(partial.url);
        setOutputType('video');
        setOutputExtension(partial.extension);
        autoDownloadBlob(partial.blob, `otonom_kismi_${Date.now()}.${partial.extension}`);
        writeSystemLog(`Kısmi video korundu ve indirildi: ${(partial.blob.size / 1024 / 1024).toFixed(1)} MB`, 'warn');
      }
      writeSystemLog(`Üretim durdu: ${message}`, 'error');
      recordDiagnosticEvent('exception', message, 'error', {
        name: err instanceof Error ? err.name : typeof err,
        stack: err instanceof Error ? err.stack : undefined,
        progress: processingProgress,
        status: processingStatus,
      });
      finishDiagnosticRun('error', { message });
      setError(message);
      setIsProcessing(false);
    }
  };

  const handleDownload = () => {
    if (!videoUrl) return;
    const a = document.createElement('a');
    a.href = videoUrl;
    a.download = `otonom_${Date.now()}.${outputExtension}`;
    a.click();
  };

  const handleShare = async () => {
    const blob = outputBlobRef.current;
    if (!blob) {
      setError('Paylaşılacak çıktı dosyası bulunamadı. Videoyu yeniden oluşturun.');
      return;
    }
    try {
      const result = await shareGeneratedMedia({
        blob,
        filename: `otonom_${Date.now()}.${outputExtension}`,
        caption: socialCaption || 'OTONOM ile hazırlanan video.',
      });
      if (result === 'clipboard') {
        setError('Tarayıcı dosyalı paylaşımı desteklemiyor. Açıklama panoya kopyalandı; İndir düğmesiyle videoyu kaydedebilirsiniz.');
      }
    } catch (shareError) {
      if (shareError instanceof DOMException && shareError.name === 'AbortError') {
        writeSystemLog('Sistem paylaşımı kullanıcı tarafından kapatıldı.', 'warn');
        return;
      }
      const message = shareError instanceof Error ? shareError.message : String(shareError);
      writeSystemLog(`Sistem paylaşımı açılamadı: ${message}`, 'error');
      setError(`Paylaşım açılamadı: ${message}`);
    }
  };

  const handleNewProject = () => {
    setTextInput('');
    setSelectedMediaFiles([]);
    setCustomSceneImages([]);
    setBackgroundMusic(null);
    clearOutput();
    setError('');
    setLogs([]);
    setConfig(DEFAULT_CONFIG);
    for (let i = 0; i < 5; i++) {
      SafeStorage.removeItem(`CUSTOM_SCENE_IMG_${i}`);
    }
  };

  const handleAddGazeteToMedia = async (src: string, name: string) => {
    if (!src) {
      setError('Seçilen gazete görseli bulunamadı.');
      return;
    }

    if (customSceneImages.length >= RENDER_CONFIG.MAX_CUSTOM_SCENE_IMAGES && !customSceneImages.includes(src)) {
      setError(`Sabit Görseller alanı dolu. En fazla ${RENDER_CONFIG.MAX_CUSTOM_SCENE_IMAGES} görsel eklenebilir.`);
      return;
    }

    const normalizedName = name.trim() || 'Gazete';
    if (pendingGazeteSourcesRef.current.has(src)) {
      writeSystemLog(`${normalizedName} görselinin yerel kopyası zaten hazırlanıyor.`, 'warn');
      return;
    }

    const mediaId = `gazete_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    pendingGazeteSourcesRef.current.add(src);
    pendingGazetePreparationsRef.current += 1;
    setPendingGazetePreparationCount(pendingGazetePreparationsRef.current);
    setError('');
    setActiveTab('gazete');
    writeSystemLog(`${normalizedName} tam sayfası yerel kopyaya alınıyor; hazır olmadan üretim başlatılmayacak.`);

    try {
      const prepared = await prepareGazeteMedia({
        id: mediaId,
        name: normalizedName,
        src,
      }, localizeGazeteImage);
      setSelectedMediaFiles(prev => prev.some(file => (file.url || file.thumbnailUrl) === prepared.localSrc)
        ? prev
        : [...prev, prepared.media]);
      setCustomSceneImages(prev => prev.includes(prepared.localSrc)
        ? prev
        : [...prev, prepared.localSrc].slice(0, RENDER_CONFIG.MAX_CUSTOM_SCENE_IMAGES));
      setConfig(prev => ({ ...prev, sourceName: normalizedName, tip: 'haber' }));
      writeSystemLog(`${normalizedName} görseli yerel üretim için hazırlandı ve gazete moduna eklendi.`, 'success');
      requestAnimationFrame(() => {
        actionButtonsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    } catch (localizeError) {
      const reason = localizeError instanceof Error ? localizeError.message : String(localizeError);
      setError(`${normalizedName} tam sayfası hazırlanamadı. ${reason}`);
      writeSystemLog(`${normalizedName} yerelleştirme başarısız; uzak URL ile üretim başlatılmadı: ${reason}`, 'error');
    } finally {
      pendingGazeteSourcesRef.current.delete(src);
      pendingGazetePreparationsRef.current = Math.max(0, pendingGazetePreparationsRef.current - 1);
      setPendingGazetePreparationCount(pendingGazetePreparationsRef.current);
    }
  };

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-[#0B0F19] text-slate-200 font-sans p-3 md:p-4">
        <div className="max-w-3xl mx-auto">
          <Header />

          <BackgroundMusicPicker
            value={backgroundMusic}
            volume={config.backgroundMusicVolume ?? 0.29}
            onChange={setBackgroundMusic}
            onVolumeChange={volume => setConfig(prev => ({ ...prev, backgroundMusicVolume: volume }))}
          />
          
          <TabBar activeTab={activeTab} onChange={setActiveTab} />
          
          <ConfigPanel
            config={config}
            onChange={patch => setConfig(prev => ({ ...prev, ...patch }))}
          />
          
          <MediaUpload
            files={selectedMediaFiles}
            onChange={setSelectedMediaFiles}
            customImages={customSceneImages}
            onCustomImagesChange={setCustomSceneImages}
          />
          
          {activeTab === 'gazete' && (
            <GazetePanel
              onAddToMedia={handleAddGazeteToMedia}
              onOpenCrop={handleAddGazeteToMedia}
            />
          )}
          
          {activeTab !== 'media' && activeTab !== 'gazete' && (
            <textarea
              value={textInput}
              onChange={e => setTextInput(e.target.value)}
              placeholder={config.tip === 'guzel_soz' 
                ? 'Güzel sözü veya alıntıyı yazın...' 
                : activeTab === 'url' 
                  ? 'Haber linkini yapıştırın...' 
                  : 'Haberi yazın veya araştırılacak gündemi verin...'}
              className="w-full h-20 bg-black/30 border rounded-xl p-3 text-sm outline-none mb-3 text-slate-200 resize-none"
            />
          )}
          
          <div ref={actionButtonsRef}>
            {pendingGazetePreparationCount > 0 && (
              <div className="mb-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-center text-xs font-bold text-amber-300">
                Gazete tam sayfası yerel olarak hazırlanıyor; üretim düğmeleri işlem bitince açılacak.
              </div>
            )}
            <ActionButtons
              onImageGenerate={() => handleExecuteStart('image')}
              onVideoGenerate={() => handleExecuteStart('video')}
              isProcessing={isProcessing}
              disabled={pendingGazetePreparationCount > 0 || (
                config.tip === 'guzel_soz'
                  ? !textInput.trim() && selectedMediaFiles.length === 0
                  : (activeTab === 'media' || activeTab === 'gazete')
                    ? selectedMediaFiles.length === 0
                    : !textInput.trim()
              )}
              tip={config.tip}
            />
          </div>
          
          {error && (
            <div className="mt-6 bg-rose-500/10 border border-rose-500/20 p-4 rounded-xl flex flex-wrap items-center gap-3 text-rose-400 text-sm font-medium">
              <span><strong>Hata:</strong> {error}</span>
              <button
                type="button"
                onClick={downloadLastDiagnosticRun}
                className="ml-auto bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 px-3 py-1.5 rounded-lg text-[11px] font-black"
              >
                LOGU YENİDEN İNDİR
              </button>
            </div>
          )}
          
          {videoUrl && (
            <OutputPanel
              videoUrl={videoUrl}
              config={config}
              outputType={outputType}
              outputExtension={outputExtension}
              onDownload={handleDownload}
              onShare={handleShare}
              onNewProject={handleNewProject}
              autoBufferState={autoBufferState}
              autoBufferMessage={autoBufferMessage}
              autoBufferProgress={autoBufferProgress}
              autoBufferResults={autoBufferResults}
            />
          )}
          
          {(showLogPanel || isProcessing) && logs.length > 0 && (
            <LogPanel logs={logs} onClose={() => setShowLogPanel(false)} />
          )}
          
          {isProcessing && (
            <ProcessingModal
              progress={processingProgress}
              status={processingStatus}
              logs={logs}
            />
          )}
        </div>
        <canvas ref={canvasRef} style={{ position: 'fixed', top: '-10000px', left: '-10000px', zIndex: -50 }} />
      </div>
    </ErrorBoundary>
  );
}
