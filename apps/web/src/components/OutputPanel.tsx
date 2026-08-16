// OutputPanel component
import React from 'react';
import { Download, Share2, RotateCcw, ShieldCheck } from './icons';
import type { BufferDispatchResult } from '../lib/autoBuffer';

interface OutputPanelProps {
  videoUrl: string;
  config: any;
  outputType: 'image' | 'video';
  outputExtension: 'png' | 'mp4' | 'webm';
  onDownload: () => void;
  onShare: () => void;
  onNewProject: () => void;
  autoBufferState: 'idle' | 'uploading' | 'queued' | 'partial' | 'needs-key' | 'failed' | 'skipped';
  autoBufferMessage: string;
  autoBufferProgress: number;
  autoBufferResults: BufferDispatchResult[];
}

export function OutputPanel({
  videoUrl,
  config,
  outputType,
  outputExtension,
  onDownload,
  onShare,
  onNewProject,
  autoBufferState,
  autoBufferMessage,
  autoBufferProgress,
  autoBufferResults,
}: OutputPanelProps) {
  const isImage = outputType === 'image';
  const statusClass = autoBufferState === 'queued'
    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
    : autoBufferState === 'failed'
      ? 'border-rose-500/30 bg-rose-500/10 text-rose-300'
      : autoBufferState === 'uploading'
        ? 'border-indigo-500/30 bg-indigo-500/10 text-indigo-200'
        : 'border-amber-500/30 bg-amber-500/10 text-amber-200';

  return (
    <div className="mt-8 bg-slate-900 border border-emerald-900/50 p-6 rounded-3xl shadow-2xl text-center">
      <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-400 text-xs font-bold mb-4">
        <ShieldCheck size={14} />
        {isImage ? 'GÖRSEL OLUŞTURULDU' : 'VIDEO OLUŞTURULDU'}
      </div>

      <p className="mb-4 text-[10px] font-semibold text-slate-500">
        Cihazınıza otomatik indirildi · {outputExtension.toUpperCase()} · Buffer aktarımı aşağıda ayrıca izlenir
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

      {!isImage && (
        <div className={`mt-4 rounded-2xl border p-3 text-left ${statusClass}`}>
          <div className="text-[11px] font-black tracking-wide">BUFFER OTOMATİK KUYRUK</div>
          <p className="mt-1 text-[11px] font-semibold leading-relaxed">{autoBufferMessage}</p>
          {autoBufferState === 'uploading' && (
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-black/30">
              <div
                className="h-full rounded-full bg-indigo-400 transition-all"
                style={{ width: `${Math.max(2, autoBufferProgress)}%` }}
              />
            </div>
          )}
          {autoBufferResults.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {autoBufferResults.map(result => (
                <span
                  key={`${result.channelId}-${result.service}`}
                  className={`rounded-full border px-2 py-1 text-[9px] font-black ${result.ok
                    ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200'
                    : 'border-rose-400/30 bg-rose-400/10 text-rose-200'}`}
                  title={result.message || result.postId}
                >
                  {result.ok ? '✓' : '✕'} {result.channelName} · {result.service}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="mt-4 flex justify-center gap-3 flex-wrap">
        <button onClick={onDownload} className="bg-emerald-600 hover:bg-emerald-500 text-white px-5 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 transition-all active:scale-95">
          <Download size={14} /> İNDİR
        </button>
        <button onClick={onShare} className="bg-indigo-600 hover:bg-indigo-500 text-white px-5 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 shadow-lg shadow-indigo-500/20 transition-all active:scale-95">
          <Share2 size={14} /> ELLE / DİĞER UYGULAMALAR
        </button>
        <button onClick={onNewProject} className="bg-slate-700 hover:bg-slate-600 text-white px-5 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 transition-all active:scale-95">
          <RotateCcw size={14} /> {config.tip === 'guzel_soz' || config.tip === 'iddia_analizi' ? 'YENİ SÖZ' : 'YENİ HABER'}
        </button>
      </div>
      <p className="mt-3 text-[10px] font-semibold text-slate-500">
        Buffer gönderimi düğmesiz çalışır. Bu düğme yalnızca başka bir uygulamaya elle paylaşmak için yedektir.
      </p>
    </div>
  );
}
