// LogPanel component
import React from 'react';

interface LogPanelProps {
  logs: string[];
  onClose: () => void;
}

export function LogPanel({ logs, onClose }: LogPanelProps) {
  return (
    <div className="mt-6 bg-slate-950/90 border border-slate-800 rounded-2xl p-4 text-left font-mono text-[11px] leading-relaxed max-h-64 overflow-y-auto space-y-1.5 relative">
      <div className="flex items-center justify-between mb-2 sticky top-0 bg-slate-950/95 py-1 z-10">
        <span className="text-slate-500 text-[10px] font-bold uppercase tracking-wider">Sistem Logları ({logs.length})</span>
        <button onClick={onClose} className="bg-slate-800 hover:bg-slate-700 text-slate-300 px-2 py-1 rounded-lg text-[10px] font-bold border border-slate-700 transition-all active:scale-95">
          KAPAT
        </button>
      </div>
      {logs.slice(-50).map((log, idx) => {
        let c = "text-slate-400";
        if (log.includes('SUCCESS')) c = "text-emerald-400 font-bold";
        if (log.includes('WARN')) c = "text-amber-400 font-bold";
        if (log.includes('ERROR')) c = "text-rose-400 font-bold animate-pulse";
        if (log.includes('INFO')) c = "text-indigo-400";
        return (
          <div key={idx} className={`flex items-start gap-2 ${c}`}>
            <span className="text-slate-600 shrink-0 select-none">{log.split(']')[0]}]</span>
            <span className="break-all">{log.split(']').slice(1).join(']')}</span>
          </div>
        );
      })}
    </div>
  );
}