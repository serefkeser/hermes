// Header component
import React from 'react';
import { APP_VERSION } from '@otonom/shared-config';

export function Header() {
  return (
    <div className="text-center mb-4 flex items-center justify-center gap-3 flex-wrap">
      <h1 className="text-xl md:text-3xl font-black tracking-tight text-white whitespace-nowrap">OTONOM</h1>
      <div className="bg-indigo-900/40 border-2 border-indigo-500/50 px-3 py-1.5 rounded-full shadow-[0_0_20px_rgba(99,102,241,0.3)]">
        <p className="text-indigo-300 text-[10px] md:text-xs font-black tracking-widest uppercase">
          {APP_VERSION.toBadge()}
        </p>
      </div>
    </div>
  );
}