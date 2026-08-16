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
import { renderLocally } from './lib/localRenderer';
import { analyzeForVideo, createNarration } from './lib/aiClient';
import { buildRenderStoryboard, getStoryboardNarration } from './lib/storyboard';
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
  resolution: '4K',
  transition: 'none',
  videoFormat: 'mp4',
  analysisMode: 'yorumsuz',
  tip: 'haber',
  sourceName: '',
  yorum: '',
  customSceneImages: [],
  backgroundMusicVolume: 0.29,
};

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

export function App() {
  const [activeTab, setActiveTab] = useState<'text' | 'url' | 'media' | 'prompt' | 'gazete'>('media');
  const [textInput, setTextInput] = useState(() => SafeStorage.getItem('ns_textInput') || '');
  const [config, setConfig] = useState<RenderConfig>(() => {
    const saved = SafeStorage.getItem('ns_config');
    return saved ? { ...DEFAULT_CONFIG, ...JSON.parse(saved) } : DEFAULT_CONFIG;
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
  const [showLogPanel, setShowLogPanel] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const actionButtonsRef = useRef<HTMLDivElement>(null);
  const outputUrlRef = useRef<string | null>(null);

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
    setVideoUrl(null);
  };

  const handleExecuteStart = async (forceOutputType?: 'image' | 'video') => {
    const outType = forceOutputType ?? (config.tip === 'guzel_soz' ? 'image' : 'video');

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
      const slides = analysis.script.videoSlides;
      writeSystemLog(`Analiz tamamlandı: ${analysis.provider} / ${analysis.model}`, 'success');
      analysis.attempts
        .filter(attempt => !attempt.ok)
        .forEach(attempt => writeSystemLog(`${attempt.provider} atlandı: ${attempt.status || attempt.reason || 'geçici hata'}`, 'warn'));

      const runConfig = {
        ...config,
        sourceName: config.sourceName || analysis.script.sourceName || '',
        customSceneImages,
        backgroundMusic,
        backgroundMusicVolume: config.backgroundMusicVolume ?? 0.29,
      };
      const storyboard = buildRenderStoryboard(analysis.script, runConfig);
      recordDiagnosticEvent('storyboard', 'Video sahne akışı oluşturuldu.', 'success', {
        aiSlideCount: slides.length,
        renderSceneCount: storyboard.length,
        sceneKinds: storyboard.map(scene => scene.kind || 'content'),
      });
      writeSystemLog(
        `Tam video akışı hazır: kapak + ${slides.length} haber sahnesi + Son Söz${analysis.script.gununSorusu ? ' + Günün Sorusu' : ''} + outro.`,
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
          narrationAudio = await createNarration(narrationText, 'Aoede');
          recordDiagnosticEvent('tts', 'Anlatım ses dosyası alındı.', 'success', {
            size: narrationAudio.size,
            mimeType: narrationAudio.type,
          });
          writeSystemLog('Kapak, haber, Son Söz ve outro anlatım sesi hazır.', 'success');
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
          ? (analysis.script.thumbnailText || slides[0]?.topText || slides[0]?.spokenText || textInput)
          : textInput,
        config: runConfig,
        backgroundMusic,
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
      setVideoUrl(result.url);
      setOutputType(outType);
      setOutputExtension(result.extension);
      setIsProcessing(false);
      setProcessingProgress(100);
      writeSystemLog(`Üretim tamamlandı: ${result.extension.toUpperCase()} · ${(result.blob.size / 1024 / 1024).toFixed(1)} MB`, 'success');
      finishDiagnosticRun('success', {
        outputExtension: result.extension,
        mimeType: result.mimeType,
        fileSize: result.blob.size,
        sceneCount: storyboard.length,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Bilinmeyen hata';
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
    const existingMedia = selectedMediaFiles.find(file => (file.url || file.thumbnailUrl) === src);
    const mediaId = existingMedia?.id || `gazete_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const mediaItem: MediaFile = {
      id: mediaId,
      name: `${normalizedName}.jpg`,
      type: 'image',
      mimeType: 'image/jpeg',
      size: 0,
      url: src,
      thumbnailUrl: src,
    };

    // Tam sayfa seçimi aynı görselle S1 + M1 eşleşmesini tek tıkla hazırlar.
    setSelectedMediaFiles(prev => prev.some(file => (file.url || file.thumbnailUrl) === src)
      ? prev
      : [...prev, mediaItem]);
    setCustomSceneImages(prev => prev.includes(src)
      ? prev
      : [...prev, src].slice(0, RENDER_CONFIG.MAX_CUSTOM_SCENE_IMAGES));
    setConfig(prev => ({ ...prev, sourceName: normalizedName, tip: 'haber' }));
    setError('');
    setActiveTab('media');
    writeSystemLog(`Tam gazete görseli S1 ve M1 alanlarına eklendi: ${normalizedName}`, 'success');

    requestAnimationFrame(() => {
      actionButtonsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });

    // Mümkünse uzak görseli yerel data URL'ye çevir; böylece AI analizi ve
    // tarayıcı içi video üretimi üçüncü taraf CORS kurallarına bağlı kalmaz.
    try {
      const localSrc = await localizeGazeteImage(src);
      if (localSrc !== src) {
        setSelectedMediaFiles(prev => prev.map(file => file.id === mediaId
          ? { ...file, url: localSrc, thumbnailUrl: localSrc }
          : file));
        setCustomSceneImages(prev => prev.map(image => image === src ? localSrc : image));
        writeSystemLog(`${normalizedName} görseli yerel üretim için hazırlandı.`, 'success');
      }
    } catch {
      // Görsel ekranda ve üretim kuyruğunda kalır; renderer kendi URL fallback'ini dener.
      writeSystemLog(`${normalizedName} uzak URL olarak eklendi; yerel kopyalama atlandı.`, 'warn');
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
            <ActionButtons
              onImageGenerate={() => handleExecuteStart('image')}
              onVideoGenerate={() => handleExecuteStart('video')}
              isProcessing={isProcessing}
              disabled={config.tip === 'guzel_soz' 
                ? !textInput.trim() && selectedMediaFiles.length === 0
                : (activeTab === 'media' || activeTab === 'gazete') 
                  ? selectedMediaFiles.length === 0 
                  : !textInput.trim()}
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
              onNewProject={handleNewProject}
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
