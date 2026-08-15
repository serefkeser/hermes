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
import { addSystemLog, SafeStorage } from '@otonom/shared-utils';
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
      setLogs(prev => [...prev.slice(-99), `[${log.timestamp}] ${log.type.toUpperCase()}: ${log.text}`]);
    });
    return unsubscribe;
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
    setIsProcessing(true);
    setProcessingProgress(0);
    setProcessingStatus('Yerel oluşturma hazırlanıyor...');
    clearOutput();

    try {
      const runConfig = {
        ...config,
        customSceneImages,
        backgroundMusic,
        backgroundMusicVolume: config.backgroundMusicVolume ?? 0.29,
      };

      if (!canvasRef.current) throw new Error('Yerel oluşturma alanı hazırlanamadı.');
      const result = await renderLocally({
        canvas: canvasRef.current,
        media: selectedMediaFiles,
        customImages: customSceneImages,
        text: textInput,
        config: runConfig,
        backgroundMusic,
        outputType: outType,
        onProgress: (progress, status) => {
          setProcessingProgress(progress);
          setProcessingStatus(status);
        },
      });

      outputUrlRef.current = result.url;
      setVideoUrl(result.url);
      setOutputType(outType);
      setOutputExtension(result.extension);
      setIsProcessing(false);
      setProcessingProgress(100);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Bilinmeyen hata';
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

  const handleAddGazeteToMedia = (src: string, name: string) => {
    const mediaItem: MediaFile = {
      id: `gazete_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name: `${name}.jpg`,
      type: 'image',
      mimeType: 'image/jpeg',
      size: 0,
      url: src,
      thumbnailUrl: src,
    };
    setSelectedMediaFiles(prev => [...prev, mediaItem]);
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
          
          {error && (
            <div className="mt-6 bg-rose-500/10 border border-rose-500/20 p-4 rounded-xl flex gap-3 text-rose-400 text-sm font-medium">
              <strong>Hata:</strong> {error}
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
