import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, Send } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { createPageUrl } from '@/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import HoloPanel from '@/components/HoloPanel';
import SystemBackground from '@/components/SystemBackground';
import { useAuthedPageUser } from '@/lib/useAuthedPageUser';

const getDefaultPaidAt = () => {
  const now = new Date();
  const localIso = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString();
  return localIso.slice(0, 16);
};

const sanitizeAmountInput = (raw) => {
  const text = String(raw || '');
  const cleaned = text.replace(/[^\d.]/g, '');
  const [integerPart, ...rest] = cleaned.split('.');
  if (!rest.length) return integerPart;
  return `${integerPart}.${rest.join('').slice(0, 2)}`;
};

const toAmount = (raw) => {
  const parsed = Number.parseFloat(String(raw || ''));
  if (!Number.isFinite(parsed)) return 0;
  if (parsed < 0) return 0;
  return parsed;
};

const PAYMENT_PROOF_BUCKET = 'payment-proofs';
const MAX_PROOF_BYTES = 5 * 1024 * 1024;

const guessFileExtension = (file) => {
  const fromName = String(file?.name || '').split('.').pop()?.trim().toLowerCase();
  if (fromName && /^[a-z0-9]+$/.test(fromName)) return fromName;
  const mime = String(file?.type || '').toLowerCase();
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  return 'img';
};

const formatFileSize = (bytes) => {
  const n = Number(bytes || 0);
  if (!Number.isFinite(n) || n <= 0) return '0 MB';
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
};

export default function PaymentVerification() {
  const navigate = useNavigate();
  const { user } = useAuthedPageUser();
  const [searchParams] = useSearchParams();

  const initialAmount = useMemo(() => {
    const raw = searchParams.get('amount');
    const parsed = Number.parseFloat(String(raw || ''));
    if (!Number.isFinite(parsed) || parsed < 1) return '';
    return parsed.toFixed(2);
  }, [searchParams]);

  const [amountInput, setAmountInput] = useState(initialAmount);
  const [utrReference, setUtrReference] = useState('');
  const [payerName, setPayerName] = useState('');
  const [paymentApp, setPaymentApp] = useState('');
  const [paidAt, setPaidAt] = useState(getDefaultPaidAt());
  const [notes, setNotes] = useState('');
  const [proofFile, setProofFile] = useState(null);
  const [proofPreviewUrl, setProofPreviewUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const amount = useMemo(() => toAmount(amountInput), [amountInput]);

  useEffect(() => {
    if (!proofFile) {
      setProofPreviewUrl('');
      return undefined;
    }
    const url = URL.createObjectURL(proofFile);
    setProofPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [proofFile]);

  const handleProofChange = (event) => {
    const file = event.target.files?.[0] || null;
    if (!file) {
      setProofFile(null);
      return;
    }

    if (!String(file.type || '').startsWith('image/')) {
      setError('Screenshot must be an image file.');
      setProofFile(null);
      return;
    }

    if (file.size > MAX_PROOF_BYTES) {
      setError('Screenshot size must be 5 MB or less.');
      setProofFile(null);
      return;
    }

    setError('');
    setProofFile(file);
  };

  const handleSubmit = async () => {
    if (!user?.id || saving) return;

    const normalizedUtr = String(utrReference || '').trim().toUpperCase();
    if (amount < 1) {
      setError('Amount must be at least 1 INR.');
      return;
    }
    if (normalizedUtr.length < 6) {
      setError('Enter a valid UTR / transaction reference.');
      return;
    }
    if (!proofFile) {
      setError('Upload payment screenshot for verification.');
      return;
    }

    setSaving(true);
    setError('');
    setInfo('');
    let proofPath = '';
    try {
      const ext = guessFileExtension(proofFile);
      const randomPart = typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      proofPath = `${user.id}/${Date.now()}-${randomPart}.${ext}`;

      const { error: uploadError } = await supabase
        .storage
        .from(PAYMENT_PROOF_BUCKET)
        .upload(proofPath, proofFile, {
          upsert: false,
          contentType: proofFile.type || undefined,
          cacheControl: '3600',
        });
      if (uploadError) throw uploadError;

      const { error: insertError } = await supabase
        .from('payment_verification_requests')
        .insert({
          user_id: user.id,
          amount_inr: Number(amount.toFixed(2)),
          utr_reference: normalizedUtr,
          payer_name: payerName.trim() || null,
          payment_app: paymentApp.trim() || null,
          paid_at: paidAt ? new Date(paidAt).toISOString() : new Date().toISOString(),
          notes: notes.trim() || null,
          proof_path: proofPath,
          status: 'pending',
        });

      if (insertError) {
        await supabase.storage.from(PAYMENT_PROOF_BUCKET).remove([proofPath]).catch(() => {});
        throw insertError;
      }

      setInfo('Verification submitted. Admin will review it.');
      setUtrReference('');
      setPayerName('');
      setPaymentApp('');
      setNotes('');
      setProofFile(null);
    } catch (err) {
      setError(err?.message || 'Failed to submit verification details.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SystemBackground>
      <div className="max-w-2xl mx-auto p-4 md:p-6 space-y-4">
        <HoloPanel>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                if (window.history.length > 1) {
                  navigate(-1);
                  return;
                }
                navigate(createPageUrl('Profile'));
              }}
              className="w-9 h-9 rounded-lg flex items-center justify-center"
              style={{ background: 'rgba(10,25,33,0.8)', border: '1px solid rgba(56,189,248,0.2)' }}
            >
              <ArrowLeft className="w-4 h-4 text-white" />
            </button>
            <div>
              <p className="text-white font-black tracking-widest">PAYMENT VERIFICATION</p>
              <p className="text-xs text-slate-400">Submit UPI transaction details for confirmation</p>
            </div>
          </div>
        </HoloPanel>

        <HoloPanel>
          <p className="text-cyan-300 text-xs font-bold tracking-widest mb-3 flex items-center gap-2">
            <CheckCircle2 className="w-3.5 h-3.5" /> VERIFY DONATION
          </p>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-slate-400 tracking-widest">AMOUNT (INR)</Label>
              <Input
                type="number"
                min={1}
                step={0.01}
                value={amountInput}
                onChange={(e) => setAmountInput(sanitizeAmountInput(e.target.value))}
                placeholder="Enter paid amount"
                className="bg-slate-900/70 border-slate-700 text-white"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-slate-400 tracking-widest">UTR / TRANSACTION REFERENCE</Label>
              <Input
                value={utrReference}
                onChange={(e) => setUtrReference(e.target.value.toUpperCase())}
                placeholder="Example: 123456789012"
                className="bg-slate-900/70 border-slate-700 text-white"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-slate-400 tracking-widest">PAYER NAME (OPTIONAL)</Label>
                <Input
                  value={payerName}
                  onChange={(e) => setPayerName(e.target.value)}
                  placeholder="Your name"
                  className="bg-slate-900/70 border-slate-700 text-white"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-slate-400 tracking-widest">PAYMENT APP (OPTIONAL)</Label>
                <Input
                  value={paymentApp}
                  onChange={(e) => setPaymentApp(e.target.value)}
                  placeholder="GPay / PhonePe / Paytm"
                  className="bg-slate-900/70 border-slate-700 text-white"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-slate-400 tracking-widest">PAID AT</Label>
              <Input
                type="datetime-local"
                value={paidAt}
                onChange={(e) => setPaidAt(e.target.value)}
                className="bg-slate-900/70 border-slate-700 text-white"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-slate-400 tracking-widest">NOTES (OPTIONAL)</Label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Any additional detail for verification..."
                className="w-full min-h-[90px] rounded-md bg-slate-900/70 border border-slate-700 text-white text-sm px-3 py-2 outline-none focus:ring-2 focus:ring-cyan-500/40"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-slate-400 tracking-widest">PAYMENT SCREENSHOT</Label>
              <Input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={handleProofChange}
                className="bg-slate-900/70 border-slate-700 text-white file:text-slate-200"
              />
              <p className="text-[11px] text-slate-500">Accepted: PNG, JPG, WEBP. Max size: 5 MB.</p>
              {proofFile && (
                <p className="text-[11px] text-slate-400">
                  {proofFile.name} ({formatFileSize(proofFile.size)})
                </p>
              )}
              {proofPreviewUrl && (
                <img
                  src={proofPreviewUrl}
                  alt="Payment proof preview"
                  className="w-full max-h-64 object-contain rounded-md border border-slate-700"
                />
              )}
            </div>

            <Button onClick={handleSubmit} disabled={saving || amount < 1 || !utrReference.trim() || !proofFile} className="w-full sm:w-auto">
              <Send className="w-4 h-4 mr-2" />
              {saving ? 'Submitting...' : 'Submit Verification'}
            </Button>
          </div>

          {error && <p className="text-xs mt-2 text-red-300">{error}</p>}
          {info && <p className="text-xs mt-2 text-emerald-300">{info}</p>}
        </HoloPanel>
      </div>
    </SystemBackground>
  );
}
