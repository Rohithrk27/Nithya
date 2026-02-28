import React from 'react';

export default class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error) {
    return {
      hasError: true,
      errorMessage: error?.message || 'Unexpected application error',
    };
  }

  componentDidCatch(error, errorInfo) {
    console.error('AppErrorBoundary caught error', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center p-6 bg-[#071229] text-slate-100">
          <div className="w-full max-w-lg rounded-xl border border-red-500/30 bg-[#12080A] p-5 space-y-3">
            <p className="text-xs tracking-widest font-black text-red-400">SYSTEM FAILURE</p>
            <p className="text-xl font-black text-white">Something crashed while rendering.</p>
            <p className="text-sm text-slate-300">{this.state.errorMessage}</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-3 py-2 rounded-md border border-cyan-500/40 text-cyan-300 text-sm font-bold"
            >
              Reload App
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
