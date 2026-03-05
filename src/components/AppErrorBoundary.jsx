import React from 'react';

export default class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
    this.handleReload = this.handleReload.bind(this);
    this.handleHardReload = this.handleHardReload.bind(this);
  }

  static getDerivedStateFromError(error) {
    return {
      hasError: true,
      errorMessage: error?.message || 'Unexpected application error',
    };
  }

  componentDidCatch(error, errorInfo) {
    console.error('AppErrorBoundary caught error', error, errorInfo);
    const message = String(error?.message || '').toLowerCase();
    if (message.includes('format is not defined')) {
      const onceKey = 'nithya_auto_cache_reset_for_format_error';
      let shouldRepair = true;
      try {
        shouldRepair = window.sessionStorage?.getItem(onceKey) !== '1';
        if (shouldRepair) window.sessionStorage?.setItem(onceKey, '1');
      } catch (_) {
        // Ignore storage failures and continue with one-shot recovery.
      }
      if (shouldRepair) {
        void this.handleHardReload();
      }
    }
  }

  async handleHardReload() {
    try {
      if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map((reg) => reg.unregister()));
      }
      if (typeof window !== 'undefined' && 'caches' in window) {
        const keys = await window.caches.keys();
        await Promise.all(keys.map((key) => window.caches.delete(key)));
      }
    } catch (_) {
      // Best effort cleanup only.
    }

    const url = new URL(window.location.href);
    url.searchParams.set('__nithya_reload', String(Date.now()));
    window.location.replace(url.toString());
  }

  handleReload() {
    window.location.reload();
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center p-6 bg-[#071229] text-slate-100">
          <div className="w-full max-w-lg rounded-xl border border-red-500/30 bg-[#12080A] p-5 space-y-3">
            <p className="text-xs tracking-widest font-black text-red-400">SYSTEM FAILURE</p>
            <p className="text-xl font-black text-white">Something crashed while rendering.</p>
            <p className="text-sm text-slate-300">{this.state.errorMessage}</p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={this.handleReload}
                className="px-3 py-2 rounded-md border border-cyan-500/40 text-cyan-300 text-sm font-bold"
              >
                Reload App
              </button>
              <button
                type="button"
                onClick={() => { void this.handleHardReload(); }}
                className="px-3 py-2 rounded-md border border-amber-500/40 text-amber-300 text-sm font-bold"
              >
                Hard Refresh
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
