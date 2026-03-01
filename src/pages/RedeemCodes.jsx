import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Sparkles, Ticket } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { createPageUrl } from '../utils';
import { Button } from '@/components/ui/button';
import SystemBackground from '@/components/SystemBackground';
import HoloPanel from '@/components/HoloPanel';
import { fetchRelicBalance, mapRedeemCodeError, redeemRelicCode, RELIC_MAX_BALANCE } from '@/lib/relics';

export default function RedeemCodes() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [balance, setBalance] = useState(0);
  const [pulse, setPulse] = useState(0);
  const [status, setStatus] = useState({ kind: '', text: '' });

  const loadBalance = async (userId) => {
    if (!userId) return;
    try {
      const next = await fetchRelicBalance(userId);
      setBalance(next);
    } catch (_) {
      // Non-blocking for page rendering.
    }
  };

  useEffect(() => {
    const init = async () => {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (!authUser) {
        navigate(createPageUrl('Landing'));
        return;
      }
      setUser(authUser);
      await loadBalance(authUser.id);
      setLoading(false);
    };
    void init();
  }, [navigate]);

  useEffect(() => {
    if (!pulse) return undefined;
    const t = setTimeout(() => setPulse(0), 1400);
    return () => clearTimeout(t);
  }, [pulse]);

  const onSubmit = async (e) => {
    e.preventDefault();
    if (!user?.id || busy) return;

    setBusy(true);
    setStatus({ kind: '', text: '' });
    try {
      const normalized = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (!normalized) throw new Error('Enter a valid code.');

      const result = await redeemRelicCode({ userId: user.id, code: normalized });
      if (!result?.success) {
        const text = mapRedeemCodeError(result?.error_code);
        setStatus({ kind: 'error', text });
      } else {
        setCode('');
        setStatus({
          kind: 'success',
          text: `Code redeemed successfully. +${Number(result.relics_awarded || 0)} relic(s).`,
        });
        await loadBalance(user.id);
        setPulse(Math.max(1, Number(result.relics_awarded || 1)));
      }
    } catch (err) {
      const msg = err?.message || '';
      const normalizedError = (
        msg.includes('expired') ? 'code_expired'
          : msg.includes('limit') ? 'usage_limit_reached'
            : msg.includes('Invalid') ? 'invalid_code'
              : msg.includes('Too many') ? 'rate_limited'
                : ''
      );
      setStatus({
        kind: 'error',
        text: normalizedError ? mapRedeemCodeError(normalizedError) : (msg || 'Failed to redeem code.'),
      });
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <SystemBackground>
        <div className="min-h-screen flex items-center justify-center">
          <div className="w-8 h-8 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin" />
        </div>
      </SystemBackground>
    );
  }

  return (
    <SystemBackground>
      <div className="max-w-xl mx-auto p-4 md:p-6 space-y-4">
        <HoloPanel>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => navigate(createPageUrl('Relics'))}
              className="w-9 h-9 rounded-lg flex items-center justify-center"
              style={{ background: 'rgba(15,32,39,0.8)', border: '1px solid #1e3a4a' }}
            >
              <ArrowLeft className="w-4 h-4 text-white" />
            </button>
            <div className="flex-1">
              <p className="text-cyan-300 text-xs tracking-widest font-black">REDEEM DISCIPLINE CODE</p>
              <p className="text-white text-base font-bold">Relic Balance: {balance}/{RELIC_MAX_BALANCE}</p>
            </div>
          </div>
        </HoloPanel>

        <HoloPanel>
          <div className="rounded-xl p-3 border border-cyan-500/30 bg-cyan-950/20 flex items-center justify-between">
            <div>
              <p className="text-xs tracking-widest font-black text-cyan-300">BALANCE</p>
              <p
                className="text-3xl font-black text-white transition-transform duration-300"
                style={{ transform: pulse ? 'scale(1.08)' : 'scale(1)' }}
              >
                {balance}
              </p>
            </div>
            {pulse > 0 && (
              <div className="text-emerald-300 font-black text-xl flex items-center gap-1">
                <Sparkles className="w-5 h-5" />
                +{pulse}
              </div>
            )}
          </div>
        </HoloPanel>

        <HoloPanel>
          <form onSubmit={onSubmit} className="space-y-3">
            <label className="block text-xs text-slate-300 tracking-widest font-black">ENTER CODE</label>
            <div className="flex gap-2">
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                placeholder="ALPHANUMERIC CODE"
                maxLength={64}
                className="flex-1 rounded-md px-3 py-2 bg-slate-900 border border-slate-700 text-white text-sm tracking-wider"
              />
              <Button type="submit" disabled={busy}>
                <Ticket className="w-4 h-4 mr-2" />
                {busy ? 'Checking...' : 'Redeem'}
              </Button>
            </div>
          </form>
        </HoloPanel>

        {status.text && (
          <HoloPanel>
            <p className={`text-sm ${status.kind === 'success' ? 'text-emerald-300' : 'text-red-300'}`}>
              {status.text}
            </p>
          </HoloPanel>
        )}
      </div>
    </SystemBackground>
  );
}
