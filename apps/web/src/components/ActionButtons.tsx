// ActionButtons component
import React from 'react';
import { ImagePlus, Clapperboard, Eye, Wand2, Loader2 } from './icons';

interface ActionButtonsProps {
  onImageGenerate: () => void;
  onVideoGenerate: () => void;
  isProcessing: boolean;
  disabled: boolean;
  tip: string;
}

export function ActionButtons({ onImageGenerate, onVideoGenerate, isProcessing, disabled, tip }: ActionButtonsProps) {
  const isGuzelSoz = tip === 'guzel_soz' || tip === 'iddia_analizi';

  if (isGuzelSoz) {
    return (
      <div className="flex flex-col sm:flex-row gap-2 relative z-0">
        <button
          onClick={onImageGenerate}
          disabled={isProcessing || disabled}
          className="flex-1 bg-slate-800 hover:bg-slate-700 disabled:bg-slate-900 disabled:text-slate-600 text-slate-200 py-2.5 md:py-3 rounded-full font-medium text-xs transition-all border border-slate-700 flex items-center justify-center gap-2"
        >
          {isProcessing ? (
            <>
              <Loader2 size={16} className="animate-spin" /> İŞLENİYOR...
            </>
          ) : (
            <>
              <ImagePlus size={16} /> Kart Oluştur
            </>
          )}
        </button>
        <button
          onClick={onVideoGenerate}
          disabled={isProcessing || disabled}
          className="flex-1 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-900/50 disabled:text-indigo-400 text-white py-2.5 md:py-3 rounded-full font-bold text-xs transition-all shadow-lg shadow-indigo-500/20 flex items-center justify-center gap-2"
        >
          {isProcessing ? (
            <>
              <Loader2 size={16} className="animate-spin" /> İŞLENİYOR...
            </>
          ) : (
            <>
              {tip === 'iddia_analizi' ? <Eye size={16} /> : <Wand2 size={16} />}
              {tip === 'iddia_analizi' ? 'İddia Analizi' : 'Güzel Söz Oluştur'}
            </>
          )}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col sm:flex-row gap-2 relative z-0">
      <button
        onClick={onImageGenerate}
        disabled={isProcessing || disabled}
        className="flex-1 bg-slate-800 hover:bg-slate-700 disabled:bg-slate-900 disabled:text-slate-600 text-slate-200 py-2.5 md:py-3 rounded-full font-medium text-xs transition-all border border-slate-700 flex items-center justify-center gap-2"
      >
        {isProcessing ? (
          <>
            <Loader2 size={16} className="animate-spin" /> İŞLENİYOR...
          </>
        ) : (
          <>
            <ImagePlus size={16} /> Görsel oluştur
          </>
        )}
      </button>
      <button
        onClick={onVideoGenerate}
        disabled={isProcessing || disabled}
        className="flex-1 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-900/50 disabled:text-indigo-400 text-white py-2.5 md:py-3 rounded-full font-bold text-xs transition-all shadow-lg shadow-indigo-500/20 flex items-center justify-center gap-2"
      >
        {isProcessing ? (
          <>
            <Loader2 size={16} className="animate-spin" /> İŞLENİYOR...
          </>
        ) : (
          <>
            <Clapperboard size={16} /> Video oluştur
          </>
        )}
      </button>
    </div>
  );
}
