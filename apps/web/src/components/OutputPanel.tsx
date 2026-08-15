// OutputPanel component
import React from 'react';
import { Download, Share2, RotateCcw, ShieldCheck } from './icons';

interface OutputPanelProps {
  videoUrl: string;
  config: any;
  outputType: 'image' | 'video';
  outputExtension: 'png' | 'mp4' | 'webm';
  onDownload: () => void;
  onNewProject: () => void;
}

export function OutputPanel({ videoUrl, config, outputType, outputExtension, onDownload, onNewProject }: OutputPanelProps) {
  const isImage = outputType === 'image';

  return (
    <div className="mt-8 bg-slate-900 border border-emerald-900/50 p-6 rounded-3xl shadow-2xl text-center">
      <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-400 text-xs font-bold mb-4">
        <ShieldCheck size={14} />
        {isImage ? 'GÖRSEL OLUŞTURULDU' : 'VIDEO OLUŞTURULDU'}
      </div>

      <p className="mb-4 text-[10px] font-semibold text-slate-500">
        Sunucuya yüklenmedi · Bu sekme kapanana kadar cihazınızda geçici olarak tutulur · {outputExtension.toUpperCase()}
      </p>

      {isImage ? (
        <img
          src={videoUrl}
          alt="Output"
          className="w-full max-w-md mx-auto rounded-2xl shadow-lg ring-1 ring-white/10 object-cover"
        />
      ) : (
        <video
          src={videoUrl}
          controls
          autoPlay
          className="w-full max-w-md mx-auto rounded-2xl shadow-lg ring-1 ring-white/10"
        />
      )}

      <div className="mt-4 flex justify-center gap-3 flex-wrap">
        <button onClick={onDownload} className="bg-emerald-600 hover:bg-emerald-500 text-white px-5 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 transition-all active:scale-95">
          <Download size={14} /> İNDİR
        </button>
        <button className="bg-indigo-600 hover:bg-indigo-500 text-white px-5 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 shadow-lg shadow-indigo-500/20 transition-all active:scale-95">
          <Share2 size={14} /> PAYLAŞ
        </button>
        <button onClick={onNewProject} className="bg-slate-700 hover:bg-slate-600 text-white px-5 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 transition-all active:scale-95">
          <RotateCcw size={14} /> {config.tip === 'guzel_soz' || config.tip === 'iddia_analizi' ? 'YENİ SÖZ' : 'YENİ HABER'}
        </button>
      </div>
    </div>
  );
}
