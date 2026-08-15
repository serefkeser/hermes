// ProcessingModal component
import React from 'react';
import { Loader2, Clock, Download, Copy } from './icons';

interface ProcessingModalProps {
  progress: number;
  status: string;
  logs: string[];
}

export function ProcessingModal({ progress, status, logs }: ProcessingModalProps) {
  const copyLogs = () => {
    const text = logs.join('\n');
    navigator.clipboard.writeText(text).then(() => {
      alert('Loglar panoya kopyalandı');
    });
  };

  return (
    <div className="fixed inset-0 bg-slate-950/90 backdrop-blur-md z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-indigo-500/30 w-full max-w-lg p-6 md:p-8 rounded-3xl shadow-2xl relative overflow-hidden text-center">
        <div className="absolute top-0 left-0 h-1 bg-indigo-600 transition-all duration-300" style={{ width: `${progress}%` }}></div>
        
        <div className="w-14 h-14 rounded-full bg-indigo-500/10 flex items-center justify-center mx-auto mb-4">
          <Loader2 size={28} className="text-indigo-400 animate-spin" />
        </div>
        
        <h2 className="text-5xl font-black text-white mb-2">{Math.round(progress)}%</h2>
        <p className="text-indigo-400 font-bold text-sm mb-3 uppercase tracking-widest">{status}</p>
        
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-800 text-slate-400 text-xs font-mono mb-4 border border-slate-700/50">
          <Clock size={12} /> Geçen: 0sn
        </div>

        {logs.length > 0 && (
          <div className="mt-4 bg-slate-950/90 border border-slate-800 rounded-2xl p-4 text-left font-mono text-[11px] leading-relaxed max-h-48 overflow-y-auto space-y-1.5 relative">
            <button onClick={copyLogs} className="absolute top-2 right-2 bg-slate-800 hover:bg-slate-700 text-slate-300 px-2 py-1 rounded-lg text-[10px] font-bold border border-slate-700 transition-all active:scale-95 z-10">
              <Copy size={12} /> KOPYALA
            </button>
            {logs.slice(-20).map((log, idx) => {
              let c = "text-slate-400";
              if (log.includes('SUCCESS')) c = "text-emerald-400 font-bold";
              if (log.includes('WARN')) c = "text-amber-400 font-bold";
              if (log.includes('ERROR')) c = "text-rose-400 font-bold animate-pulse";
              return (
                <div key={idx} className={`flex items-start gap-2 ${c}`}>
                  <span className="text-slate-600 shrink-0 select-none">{log.split(']')[0]}]</span>
                  <span className="break-all">{log.split(']').slice(1).join(']')}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}