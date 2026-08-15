// ErrorBoundary component
import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertCircle, RotateCcw } from './icons';

interface Props {
  children: ReactNode;
  fallback?: React.ComponentType<{ error: Error; resetErrorBoundary: () => void }>;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = { hasError: false, error: null };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[ErrorBoundary]', error, errorInfo);
  }

  private resetErrorBoundary = () => {
    this.setState({ hasError: false, error: null });
  };

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        const FallbackComponent = this.props.fallback;
        return <FallbackComponent error={this.state.error!} resetErrorBoundary={this.resetErrorBoundary} />;
      }

      return (
        <div className="min-h-screen bg-[#0B0F19] text-slate-200 font-sans p-3 md:p-4 flex items-center justify-center">
          <div className="bg-slate-900 border-2 border-red-500/40 w-full max-w-md p-8 rounded-3xl shadow-2xl text-center">
            <div className="w-14 h-14 rounded-full bg-rose-500/10 flex items-center justify-center mx-auto mb-4">
              <AlertCircle size={28} className="text-rose-400" />
            </div>
            <h2 className="text-2xl font-black text-white mb-3">Bir Hata Oluştu</h2>
            <p className="text-slate-400 text-sm mb-6">{this.state.error?.message || 'Bilinmeyen hata'}</p>
            <div className="flex flex-col gap-3">
              <button
                onClick={this.resetErrorBoundary}
                className="w-full bg-gradient-to-r from-emerald-600 to-indigo-600 text-white font-bold py-3 rounded-xl text-sm flex items-center justify-center gap-2"
              >
                <RotateCcw size={16} /> SAYFAYI YENİLE
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}