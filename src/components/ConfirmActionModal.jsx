import React from 'react';
import { Button } from '@/components/ui/button';

export default function ConfirmActionModal({
  open = false,
  title = 'Confirm action',
  message = '',
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  onConfirm,
  onCancel,
  danger = false,
}) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[190] flex items-center justify-center p-4"
      style={{ background: 'rgba(2,6,23,0.75)', backdropFilter: 'blur(6px)' }}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-sm rounded-xl p-4 space-y-3"
        style={{
          background: 'rgba(15,23,42,0.96)',
          border: '1px solid rgba(56,189,248,0.24)',
          boxShadow: '0 0 30px rgba(2,6,23,0.5)',
        }}
      >
        <p className="text-sm font-black tracking-widest text-cyan-300">{title}</p>
        {message ? <p className="text-sm text-slate-300">{message}</p> : null}
        <div className="flex gap-2 justify-end pt-1">
          <Button type="button" variant="outline" onClick={onCancel}>
            {cancelText}
          </Button>
          <Button
            type="button"
            onClick={onConfirm}
            className={danger ? 'bg-red-600 hover:bg-red-700 text-white' : ''}
          >
            {confirmText}
          </Button>
        </div>
      </div>
    </div>
  );
}
