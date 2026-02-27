import React from 'react';
import { AlertTriangle, Lock } from 'lucide-react';

export default function PunishmentBanner({ count, onResolve }) {
  if (!count || count === 0) return null;
  return (
    <div
      className="fixed top-0 left-0 right-0 z-[150] flex items-center justify-between px-4 py-2"
      style={{
        background: 'rgba(30,5,5,0.97)',
        borderBottom: '1px solid rgba(248,113,113,0.4)',
        boxShadow: '0 0 20px rgba(248,113,113,0.15)',
        backdropFilter: 'blur(12px)',
        animation: 'warningPulse 2s ease-in-out infinite',
      }}
    >
      <div className="flex items-center gap-2">
        <AlertTriangle className="w-3.5 h-3.5 animate-pulse" style={{ color: '#F87171' }} />
        <span className="text-xs font-black tracking-widest" style={{ color: '#F87171' }}>
          PUNISHMENT PENDING · XP LOCKED
        </span>
        {count > 1 && (
          <span className="text-xs font-mono" style={{ color: '#F8717166' }}>({count})</span>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        <Lock className="w-3 h-3" style={{ color: '#F87171' }} />
        <button onClick={onResolve}
          className="text-xs font-black tracking-widest transition-opacity hover:opacity-70"
          style={{ color: '#F87171', textDecoration: 'underline', textUnderlineOffset: 2 }}>
          RESOLVE
        </button>
      </div>
      <style>{`
        @keyframes warningPulse {
          0%, 100% { box-shadow: 0 0 20px rgba(248,113,113,0.15); }
          50% { box-shadow: 0 0 35px rgba(248,113,113,0.30); }
        }
      `}</style>
    </div>
  );
}