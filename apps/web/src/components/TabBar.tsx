// TabBar component
import React from 'react';

type Tab = 'text' | 'url' | 'media' | 'prompt' | 'gazete';

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'text', label: 'Metin / Haber', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg> },
  { id: 'url', label: 'Haber Linki', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg> },
  { id: 'media', label: 'Medya Analizi', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="2" width="20" height="20" rx="2.18"/><line x1="2" y1="10" x2="22" y2="10"/><line x1="10" y1="2" x2="10" y2="22"/></svg> },
  { id: 'prompt', label: 'Serbest Prompt', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 19a7 7 0 0 0 7-7c0-2.3-1.2-4.4-3-5.7"/><path d="M8 12a7 7 0 0 1 7-7c0 2.3 1.2 4.4 3 5.7"/><line x1="12" y1="12" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/></svg> },
  { id: 'gazete', label: 'Gazete Takip', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2"/><line x1="18" y1="14" x2="18" y2="18"/><line x1="15" y1="18" x2="21" y2="18"/><line x1="6" y1="7h4"/><line x1="6" y1="11h4"/><line x1="6" y1="15h4"/></svg> },
];

interface TabBarProps {
  activeTab: Tab;
  onChange: (tab: Tab) => void;
}

export function TabBar({ activeTab, onChange }: TabBarProps) {
  return (
    <div className="flex flex-col sm:flex-row gap-2 bg-black/30 p-1.5 rounded-xl mb-4 flex-wrap">
      {TABS.map(({ id, label, icon }) => (
        <button
          key={id}
          onClick={() => onChange(id)}
          className={`flex-1 min-w-[120px] py-2.5 rounded-lg text-xs md:text-sm font-bold transition-all ${activeTab === id ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:text-slate-300'}`}
        >
          <span className="flex items-center justify-center gap-1.5">
            {icon}
            {label}
          </span>
        </button>
      ))}
    </div>
  );
}