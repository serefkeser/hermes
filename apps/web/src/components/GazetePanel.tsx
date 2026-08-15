// GazetePanel component for newspaper tracking
import React, { useState, useEffect, useCallback } from 'react';
import { Newspaper, RefreshCw, Loader2, AlertCircle, Clock, Scissors, Check } from './icons';
import { ALLOWED_GAZETELER, GAZETE_META } from '@otonom/shared-config';
import { makeGazetePlaceholder, createGazeteVariants, dateBackList } from '@otonom/shared-utils';

interface GazeteItem {
  name: string;
  fullSrc: string;
  thumbSrc: string;
  resolvedFull?: string;
  resolvedThumb?: string;
  placeholder: string;
  sources: string[];
  loaded: boolean;
  revision: number;
  fullCandidates: string[];
  thumbCandidates: string[];
}

export function GazetePanel({ onAddToMedia, onOpenCrop }: { onAddToMedia: (src: string, name: string) => void; onOpenCrop: (src: string, name: string) => void }) {
  const [gazeteItems, setGazeteItems] = useState<GazeteItem[]>([]);
  const [gazeteLoading, setGazeteLoading] = useState(false);
  const [gazeteError, setGazeteError] = useState('');
  const [gazeteDate, setGazeteDate] = useState(() => {
    const today = new Date();
    return today.toISOString().split('T')[0];
  });
  const [gazeteGalleryView, setGazeteGalleryView] = useState<'grid' | 'single'>('grid');
  const [gazeteCurrentIdx, setGazeteCurrentIdx] = useState(0);

  const fetchGazeteManşetleri = useCallback(async () => {
    setGazeteLoading(true);
    setGazeteError('');
    setGazeteCurrentIdx(0);

    try {
      const selectedDate = gazeteDate;
      const days = dateBackList(selectedDate, 8);

      const cards = ALLOWED_GAZETELER.map(name => {
        const meta = (GAZETE_META[name] || {}) as { ayd?: string };
        const rawUrls: string[] = [];

        if (meta.ayd) {
          for (const day of days) {
            rawUrls.push(`https://img.aydinlik.com.tr/rcman/Cw1200h2010q95gc/storage/newspapers/${day}/${meta.ayd}.jpg`);
          }
        }

        if (name === 'Gazete Pencere') {
          for (const day of days) {
            const [year, month, dayNum] = day.split('-');
            rawUrls.push(`https://cdn.gazetepencere.com/other/${year}/${month}/${dayNum}/dddd.jpg`);
          }
        }

        const variants = createGazeteVariants(rawUrls, null);
        const placeholder = makeGazetePlaceholder(name);

        return {
          name,
          ...variants,
          fullCandidates: [...variants.fullCandidates, placeholder],
          thumbCandidates: [...variants.thumbCandidates, placeholder],
          fullSrc: variants.fullCandidates[0] || placeholder,
          thumbSrc: variants.thumbCandidates[0] || placeholder,
          resolvedFull: '',
          resolvedThumb: '',
          sources: meta.ayd ? ['Aydınlık CDN'] : [],
          loaded: false,
          placeholder,
          revision: 0,
        };
      });

      setGazeteItems(cards);
      setGazeteLoading(false);
    } catch (e) {
      setGazeteError('Gazete manşetleri hazırlanırken hata oluştu.');
      setGazeteLoading(false);
    }
  }, [gazeteDate]);

  useEffect(() => {
    fetchGazeteManşetleri();
  }, [fetchGazeteManşetleri]);

  const handleImageLoad = (item: GazeteItem, kind: 'full' | 'thumb', src: string) => {
    setGazeteItems(prev => prev.map(i => {
      if (i.name !== item.name) return i;
      return {
        ...i,
        loaded: true,
        [kind === 'full' ? 'resolvedFull' : 'resolvedThumb']: src,
        [kind === 'full' ? 'fullSrc' : 'thumbSrc']: src,
      };
    }));
  };

  const handleImageError = (item: GazeteItem, kind: 'full' | 'thumb') => {
    const list = kind === 'full' ? item.fullCandidates : item.thumbCandidates;
    const currentSrc = kind === 'full' ? item.fullSrc : item.thumbSrc;
    const currentIndex = list.indexOf(currentSrc);
    const nextIndex = currentIndex + 1;

    if (nextIndex < list.length) {
      setGazeteItems(prev => prev.map(i => {
        if (i.name !== item.name) return i;
        return {
          ...i,
          [kind === 'full' ? 'fullSrc' : 'thumbSrc']: list[nextIndex],
        };
      }));
    }
  };

  return (
    <div className="mb-3">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap bg-slate-950/40 p-2.5 rounded-xl border border-slate-800">
        <div className="flex items-center gap-2">
          <Newspaper size={18} className="text-emerald-400" />
          <span className="text-xs md:text-sm font-black text-white tracking-wide">Ulusal Gazete Manşetleri (30 Gazete)</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 bg-slate-800/80 border border-slate-700 rounded-lg px-2 py-1">
            <Clock size={12} className="text-slate-400" />
            <input
              type="date"
              value={gazeteDate}
              max={new Date().toISOString().split('T')[0]}
              onChange={e => setGazeteDate(e.target.value)}
              className="bg-transparent text-slate-200 text-[10px] font-bold border-none outline-none cursor-pointer"
            />
          </div>
          <button
            onClick={fetchGazeteManşetleri}
            disabled={gazeteLoading}
            className="bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-900 text-white px-3 py-1.5 rounded-lg text-[10px] font-bold flex items-center gap-1.5 border border-emerald-500 transition-all shadow-md"
          >
            {gazeteLoading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Manşetleri Yenile
          </button>
        </div>
      </div>

      {gazeteError && (
        <div className="bg-rose-500/10 border border-rose-500/20 p-3 rounded-xl text-rose-400 text-xs font-bold mb-3 flex items-center gap-2">
          <AlertCircle size={14} /> {gazeteError}
        </div>
      )}

      {gazeteLoading && (
        <div className="text-center py-12">
          <Loader2 size={32} className="text-emerald-400 animate-spin mx-auto mb-3" />
          <p className="text-slate-400 text-sm font-bold">Gazete manşetleri yükleniyor...</p>
        </div>
      )}

      {!gazeteLoading && gazeteItems.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-emerald-400 text-[10px] font-bold uppercase tracking-wider">{gazeteItems.length} gazete listelendi</span>
            <div className="flex gap-1">
              <button onClick={() => setGazeteGalleryView('grid')} className={`p-1.5 rounded-lg text-[10px] ${gazeteGalleryView === 'grid' ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-500'}`}>▦</button>
              <button onClick={() => setGazeteGalleryView('single')} className={`p-1.5 rounded-lg text-[10px] ${gazeteGalleryView === 'single' ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-500'}`}>☐</button>
            </div>
          </div>

          {gazeteGalleryView === 'grid' ? (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2 max-h-[50vh] overflow-y-auto p-1">
              {gazeteItems.map((item, idx) => (
                <div
                  key={`${item.name}-${item.revision}`}
                  className="group relative bg-slate-800/50 rounded-xl overflow-hidden border border-slate-700/50 hover:border-emerald-500/50 transition-all cursor-pointer"
                  onClick={() => { setGazeteCurrentIdx(idx); setGazeteGalleryView('single'); }}
                >
                  <img
                    src={item.resolvedThumb || item.thumbSrc}
                    className="w-full aspect-[800/1340] object-contain block bg-slate-950"
                    alt={item.name}
                    loading="lazy"
                    decoding="async"
                    referrerPolicy="no-referrer"
                    onLoad={e => handleImageLoad(item, 'thumb', e.currentTarget.currentSrc || e.currentTarget.src)}
                    onError={e => handleImageError(item, 'thumb')}
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end justify-center p-1.5">
                    <span className="text-white text-[8px] font-bold text-center leading-tight">{item.name}</span>
                  </div>
                  <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col gap-1">
                    <button
                      onClick={e => { e.stopPropagation(); onOpenCrop(item.resolvedFull || item.resolvedThumb || item.fullSrc || item.thumbSrc, item.name); }}
                      className="bg-indigo-600 hover:bg-indigo-500 text-white p-1 rounded-md shadow-lg"
                      title="Crop yap"
                    >
                      <Scissors size={10} />
                    </button>
                    <button
                      onClick={e => { e.stopPropagation(); onAddToMedia(item.resolvedFull || item.resolvedThumb || item.fullSrc || item.thumbSrc, item.name); }}
                      className="bg-emerald-600 hover:bg-emerald-500 text-white p-1 rounded-md shadow-lg"
                      title="Tam sayfa ekle"
                    >
                      <Check size={10} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="relative">
              <div className="flex items-center justify-between gap-2 mb-3 bg-slate-900/90 border border-slate-700/80 p-2.5 rounded-2xl flex-wrap shadow-lg">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setGazeteCurrentIdx(Math.max(0, gazeteCurrentIdx - 1))}
                    disabled={gazeteCurrentIdx === 0}
                    className="bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-white px-3 py-1.5 rounded-xl text-xs font-bold transition-all"
                  >
                    ← Önceki
                  </button>
                  <span className="text-white text-sm font-bold bg-slate-950/60 px-3 py-1 rounded-xl border border-slate-800">
                    {gazeteItems[gazeteCurrentIdx]?.name} <span className="text-slate-400 font-normal">({gazeteCurrentIdx + 1}/{gazeteItems.length})</span>
                  </span>
                  <button
                    onClick={() => setGazeteCurrentIdx(Math.min(gazeteItems.length - 1, gazeteCurrentIdx + 1))}
                    disabled={gazeteCurrentIdx >= gazeteItems.length - 1}
                    className="bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-white px-3 py-1.5 rounded-xl text-xs font-bold transition-all"
                  >
                    Sonraki →
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => onOpenCrop(gazeteItems[gazeteCurrentIdx]?.resolvedFull || gazeteItems[gazeteCurrentIdx]?.resolvedThumb || gazeteItems[gazeteCurrentIdx]?.fullSrc || gazeteItems[gazeteCurrentIdx]?.thumbSrc, gazeteItems[gazeteCurrentIdx]?.name)}
                    className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-lg shadow-indigo-500/20 transition-all active:scale-95"
                  >
                    <Scissors size={14} /> Crop Yap
                  </button>
                  <button
                    onClick={() => onAddToMedia(gazeteItems[gazeteCurrentIdx]?.resolvedFull || gazeteItems[gazeteCurrentIdx]?.resolvedThumb || gazeteItems[gazeteCurrentIdx]?.fullSrc || gazeteItems[gazeteCurrentIdx]?.thumbSrc, gazeteItems[gazeteCurrentIdx]?.name)}
                    className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-lg shadow-emerald-500/20 transition-all active:scale-95"
                  >
                    <Check size={14} /> Tam Sayfa Ekle
                  </button>
                </div>
              </div>

              <div className="relative bg-black/50 rounded-xl overflow-hidden border border-slate-700/50">
                <img
                  key={`${gazeteItems[gazeteCurrentIdx]?.name}-${gazeteItems[gazeteCurrentIdx]?.revision || 0}`}
                  src={gazeteItems[gazeteCurrentIdx]?.resolvedFull || gazeteItems[gazeteCurrentIdx]?.fullSrc}
                  className="w-full h-auto block bg-slate-950"
                  alt={gazeteItems[gazeteCurrentIdx]?.name}
                  decoding="async"
                  referrerPolicy="no-referrer"
                  onLoad={e => handleImageLoad(gazeteItems[gazeteCurrentIdx]!, 'full', e.currentTarget.currentSrc || e.currentTarget.src)}
                  onError={e => handleImageError(gazeteItems[gazeteCurrentIdx]!, 'full')}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {!gazeteLoading && gazeteItems.length === 0 && !gazeteError && (
        <div className="text-center py-12">
          <Newspaper size={48} className="text-slate-700 mx-auto mb-3" />
          <p className="text-slate-500 text-sm font-bold">Gazete manşetleri yüklenmedi</p>
          <p className="text-slate-600 text-xs mt-1">Yukarıdaki "Yenile" butonuna tıklayın</p>
        </div>
      )}
    </div>
  );
}
