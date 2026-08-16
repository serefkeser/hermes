// ConfigPanel component
import React from 'react';
import type { RenderConfig } from '@otonom/shared-types';

const DURATION_OPTIONS = [
  { value: 'unlimited', label: '∞ Sınırsız' },
  { value: '15', label: '15-30s' },
  { value: '30', label: '30-60s' },
  { value: '60', label: '60-90s' },
  { value: '90', label: '90-120s' },
];

const ASPECT_RATIOS = [
  { value: '9:16', label: 'Dikey (9:16)' },
  { value: '16:9', label: 'Yatay (16:9)' },
  { value: '1:1', label: 'Kare (1:1)' },
];

const VIDEO_STYLES = [
  { value: 'news_flash', label: 'Haber Bülteni' },
  { value: 'cinematic', label: 'Sinematik' },
  { value: 'explainer', label: 'Açıklayıcı' },
  { value: 'weekly_roundup', label: 'Haftalık Özet' },
  { value: 'prompt_output', label: 'Custom Prompt' },
];

const FONT_STYLES = [
  { value: 'modern', label: 'Modern' },
  { value: 'classic', label: 'Klasik' },
  { value: 'typewriter', label: 'Typewriter' },
];

const IMAGE_STYLES = [
  { value: 'cinematic', label: 'Gerçekçi' },
  { value: 'watercolor', label: 'Sulu Boya' },
  { value: 'sketch', label: 'Karakalem' },
  { value: 'oil_painting', label: 'Yağlı Boya' },
  { value: 'minimalist', label: 'Minimalist' },
  { value: 'cyberpunk', label: 'Cyberpunk' },
  { value: 'retro', label: 'Retro' },
  { value: '3d_render', label: '3D Render' },
  { value: 'anime', label: 'Anime' },
];

const RESOLUTIONS = [
  { value: '1K', label: '720p · Hızlı' },
];

const TRANSITIONS = [
  { value: 'none', label: 'Yok' },
  { value: 'crossfade', label: 'Karışır' },
  { value: 'fadeIn', label: 'Yavaşça Belirme' },
  { value: 'fadeOut', label: 'Yavaşça Kaybolma' },
  { value: 'slideIn', label: 'Kayarak Giriş' },
  { value: 'slideOut', label: 'Kayarak Çıkış' },
];

const VIDEO_FORMATS = [
  { value: 'mp4', label: 'MP4 · H.264/AAC' },
];

const SUBTITLES = [
  { value: 'on', label: 'Açık' },
  { value: 'off', label: 'Kapalı' },
];

const ANALYSIS_MODES = [
  { value: 'yorumsuz', label: 'Yorumsuz' },
  { value: 'visibility', label: 'Görünürlük' },
  { value: 'deep_analysis', label: 'Derin Analiz' },
];

const CONTENT_TYPES = [
  { value: 'haber', label: 'Haber', color: 'text-emerald-400' },
  { value: 'guzel_soz', label: 'Güzel Söz', color: 'text-amber-400' },
  { value: 'iddia_analizi', label: 'İddia Analizi', color: 'text-cyan-400' },
];

const LANGUAGES = [
  { value: 'tr', label: 'Türkçe' },
  { value: 'en', label: 'English' },
  { value: 'fr', label: 'Français' },
  { value: 'de', label: 'Deutsch' },
  { value: 'es', label: 'Español' },
  { value: 'ar', label: 'العربية' },
  { value: 'ru', label: 'Русский' },
];

interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string; color?: string }[];
  className?: string;
}

function Select({ value, onChange, options, className }: SelectProps) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className={`w-full bg-black/30 border border-slate-800 rounded-xl px-3 py-2 text-sm outline-none focus:border-indigo-500 text-slate-200 ${className || ''}`}
    >
      {options.map(opt => (
        <option key={opt.value} value={opt.value} style={{ color: opt.color }}>{opt.label}</option>
      ))}
    </select>
  );
}

interface ConfigPanelProps {
  config: RenderConfig;
  onChange: (config: Partial<RenderConfig>) => void;
}

export function ConfigPanel({ config, onChange }: ConfigPanelProps) {
  return (
    <div className="space-y-3 mb-3">
      {/* Row 1: Duration, Aspect Ratio, Video Style */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="bg-black/30 p-2.5 rounded-xl border border-slate-800">
          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">Süre</label>
          <Select value={config.duration} onChange={v => onChange({ duration: v as RenderConfig['duration'] })} options={DURATION_OPTIONS} />
        </div>
        <div className="bg-black/30 p-2.5 rounded-xl border border-slate-800">
          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">En-Boy</label>
          <Select value={config.aspectRatio} onChange={v => onChange({ aspectRatio: v as any })} options={ASPECT_RATIOS} />
        </div>
        <div className="bg-black/30 p-2.5 rounded-xl border border-slate-800">
          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">Video Stili</label>
          <Select value={config.videoStyle} onChange={v => onChange({ videoStyle: v as any })} options={VIDEO_STYLES} />
        </div>
      </div>

      {/* Row 2: Font, Image Style, Resolution */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="bg-black/30 p-2.5 rounded-xl border border-slate-800">
          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">Yazı Tipi</label>
          <Select value={config.fontStyle} onChange={v => onChange({ fontStyle: v as any })} options={FONT_STYLES} />
        </div>
        <div className="bg-black/30 p-2.5 rounded-xl border border-slate-800">
          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">Görsel Stili</label>
          <Select value={config.imageStyle} onChange={v => onChange({ imageStyle: v as any })} options={IMAGE_STYLES} />
        </div>
        <div className="bg-black/30 p-2.5 rounded-xl border border-slate-800">
          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">Çözünürlük</label>
          <Select value={config.resolution} onChange={v => onChange({ resolution: v as any })} options={RESOLUTIONS} />
        </div>
      </div>

      {/* Row 3: Transition, Video Format, Subtitles */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="bg-black/30 p-2.5 rounded-xl border border-slate-800">
          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">Geçiş</label>
          <Select value={config.transition} onChange={v => onChange({ transition: v as any })} options={TRANSITIONS} />
        </div>
        <div className="bg-black/30 p-2.5 rounded-xl border border-slate-800">
          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">Format</label>
          <Select value={config.videoFormat} onChange={v => onChange({ videoFormat: v as any })} options={VIDEO_FORMATS} />
        </div>
        <div className="bg-black/30 p-2.5 rounded-xl border border-slate-800">
          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">Altyazı</label>
          <Select value={config.subtitles} onChange={v => onChange({ subtitles: v as any })} options={SUBTITLES} />
        </div>
      </div>

      {/* Row 4: Language, Analysis Mode, Content Type */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="bg-black/30 p-2.5 rounded-xl border border-slate-800">
          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">Dil</label>
          <Select value={config.language} onChange={v => onChange({ language: v as any })} options={LANGUAGES} />
        </div>
        <div className="bg-black/30 p-2.5 rounded-xl border border-slate-800">
          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">Analiz Modu</label>
          <Select value={config.analysisMode} onChange={v => onChange({ analysisMode: v as any })} options={ANALYSIS_MODES} />
        </div>
        <div className="bg-black/30 p-2.5 rounded-xl border border-slate-800">
          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">İçerik Türü</label>
          <Select value={config.tip} onChange={v => onChange({ tip: v as any })} options={CONTENT_TYPES} />
        </div>
      </div>

      {/* Row 5: Source Name, Yorum */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="bg-black/30 p-2.5 rounded-xl border border-slate-800">
          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">Kaynak Adı</label>
          <input
            type="text"
            value={config.sourceName || ''}
            onChange={e => onChange({ sourceName: e.target.value })}
            placeholder="Kaynak adı (örn: Hürriyet, X, Kullanıcı)"
            className="w-full bg-transparent text-sm text-slate-200 outline-none placeholder:text-slate-600 font-bold px-1 py-1 border-t border-slate-700/50"
          />
        </div>
        <div className="bg-black/30 p-2.5 rounded-xl border border-slate-800">
          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">Yorum (2-3 satır)</label>
          <textarea
            value={config.yorum || ''}
            onChange={e => onChange({ yorum: e.target.value })}
            placeholder="Yorum ekle..."
            className="w-full bg-transparent text-[10px] text-slate-200 outline-none placeholder:text-slate-600 font-bold resize-none h-8 leading-tight"
            rows={2}
          />
        </div>
      </div>
    </div>
  );
}
