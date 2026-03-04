import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { QRCodeCanvas as QRCode } from 'qrcode.react';
import { X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toastError } from '@/lib/toast';
import { createPageUrl } from '@/utils';

const MOBILE_REGEX = /Android|iPhone|iPad|iPod/i;
const DEFAULT_UPI_ID = '9526642343@slc';

const sanitizeAmountInput = (raw) => {
  const text = String(raw || '');
  const cleaned = text.replace(/[^\d.]/g, '');
  const [integerPart, ...rest] = cleaned.split('.');
  if (!rest.length) return integerPart;
  const decimalPart = rest.join('').slice(0, 2);
  return `${integerPart}.${decimalPart}`;
};

const toAmount = (raw) => {
  const parsed = Number.parseFloat(String(raw || ''));
  if (!Number.isFinite(parsed)) return 0;
  if (parsed < 0) return 0;
  return parsed;
};

const buildUpiLink = ({ upiId, amount }) => {
  const params = new URLSearchParams({
    pa: upiId,
    pn: 'Nithya',
    am: amount.toFixed(2),
    cu: 'INR',
    tn: 'Support',
  });
  return `upi://pay?${params.toString()}`;
};

const getEnvUpiId = () => String(
  import.meta?.env?.VITE_UPI_ID
  || import.meta?.env?.UPI_ID
  || DEFAULT_UPI_ID
  || ''
).trim();

const resolveUpiId = async () => {
  const fallbackUpiId = getEnvUpiId();
  const isNativePlatform = typeof window !== 'undefined'
    && typeof window?.Capacitor?.isNativePlatform === 'function'
    && window.Capacitor.isNativePlatform();

  if (isNativePlatform && fallbackUpiId) {
    return fallbackUpiId;
  }
  if (isNativePlatform && !fallbackUpiId) {
    throw new Error('UPI ID is unavailable in this app build.');
  }

  try {
    const response = await fetch('/api/config', {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });

    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    if (contentType.includes('application/json')) {
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (fallbackUpiId) return fallbackUpiId;
        throw new Error(payload?.message || 'Failed to load payment configuration.');
      }

      const upiId = String(payload?.upiId || '').trim();
      if (upiId) return upiId;
      if (fallbackUpiId) return fallbackUpiId;
      throw new Error('UPI ID is unavailable.');
    }

    if (fallbackUpiId) return fallbackUpiId;
    throw new Error('Payment configuration endpoint is unavailable.');
  } catch (error) {
    if (fallbackUpiId) return fallbackUpiId;
    throw error;
  }
};

export default function DonationModal({ open, onClose }) {
  const navigate = useNavigate();
  const [amountInput, setAmountInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [upiLink, setUpiLink] = useState('');
  const [showQr, setShowQr] = useState(false);
  const amount = useMemo(() => toAmount(amountInput), [amountInput]);
  const amountValid = amount >= 1;

  const handlePaymentDone = () => {
    if (!amountValid) {
      toastError('Enter a valid donation amount before submitting verification.');
      return;
    }
    const params = new URLSearchParams({
      amount: amount.toFixed(2),
      source: 'upi',
    });
    onClose?.();
    navigate(`${createPageUrl('PaymentVerification')}?${params.toString()}`);
  };

  useEffect(() => {
    if (!open) return;
    setUpiLink('');
    setShowQr(false);
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  const handlePay = async () => {
    if (loading) return;
    if (!amountValid) {
      toastError('Enter a valid donation amount (minimum 1).');
      return;
    }

    setLoading(true);
    setShowQr(false);
    setUpiLink('');
    try {
      const upiId = await resolveUpiId();

      const deepLink = buildUpiLink({ upiId, amount });
      const isMobile = typeof navigator !== 'undefined' && MOBILE_REGEX.test(navigator.userAgent);

      if (isMobile) {
        window.location.href = deepLink;
        return;
      }

      setUpiLink(deepLink);
      setShowQr(true);
    } catch (error) {
      toastError(error?.message || 'Unable to start donation. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[260] flex items-center justify-center p-4"
          style={{ background: 'rgba(2, 6, 23, 0.78)', backdropFilter: 'blur(8px)' }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            className="w-full max-w-md rounded-2xl p-5 space-y-4"
            style={{
              background: 'linear-gradient(180deg, rgba(15,23,42,0.96), rgba(2,6,23,0.96))',
              border: '1px solid rgba(56,189,248,0.24)',
            }}
            initial={{ y: 18, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 18, opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-cyan-300 text-xs tracking-widest font-black">SUPPORT NITHYA</p>
                <p className="text-slate-200 text-sm">Donate securely via UPI</p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-300 hover:text-white"
                style={{ background: 'rgba(15,23,42,0.7)' }}
                aria-label="Close donation modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs tracking-widest font-bold text-slate-400">AMOUNT (INR)</Label>
              <Input
                type="number"
                min={1}
                step={1}
                required
                placeholder="Enter amount"
                value={amountInput}
                onChange={(event) => setAmountInput(sanitizeAmountInput(event.target.value))}
                className="bg-slate-900/80 border-slate-700 text-white"
              />
              {!amountValid && amountInput !== '' && (
                <p className="text-xs text-red-300">Minimum amount is 1 INR.</p>
              )}
            </div>

            <Button onClick={handlePay} disabled={loading || !amountValid} className="w-full">
              {loading ? 'Loading...' : 'Pay with UPI'}
            </Button>
            <Button variant="outline" onClick={handlePaymentDone} disabled={loading || !amountValid} className="w-full">
              Payment Done
            </Button>

            {showQr && upiLink && (
              <div className="rounded-xl p-4 flex flex-col items-center gap-2" style={{ background: 'rgba(15,23,42,0.7)', border: '1px solid rgba(56,189,248,0.2)' }}>
                <p className="text-xs text-cyan-300 font-bold tracking-widest">SCAN TO PAY</p>
                <QRCode value={upiLink} size={200} bgColor="#0f172a" fgColor="#e2e8f0" />
                <p className="text-[11px] text-slate-400 text-center">Use any UPI app on your phone to scan this QR code.</p>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
