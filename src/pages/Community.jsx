import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, MessageSquarePlus, Send } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { createPageUrl } from '@/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import HoloPanel from '@/components/HoloPanel';
import SystemBackground from '@/components/SystemBackground';
import { useAuthedPageUser } from '@/lib/useAuthedPageUser';

const CATEGORIES = [
  { value: 'suggestion', label: 'Suggestion' },
  { value: 'feature_request', label: 'Feature Request' },
  { value: 'bug_report', label: 'Bug Report' },
];

const STATUS_COLORS = {
  pending: '#FBBF24',
  reviewed: '#38BDF8',
  resolved: '#34D399',
};

export default function Community() {
  const navigate = useNavigate();
  const { user, authReady } = useAuthedPageUser();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [category, setCategory] = useState('suggestion');
  const [statusFilter, setStatusFilter] = useState('all');
  const [rows, setRows] = useState([]);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const loadRows = async (userId) => {
    if (!userId) return;
    setLoading(true);
    setError('');
    try {
      const { data, error: readError } = await supabase
        .from('community_submissions')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(200);
      if (readError) throw readError;
      setRows(data || []);
    } catch (err) {
      setError(err?.message || 'Failed to load community submissions.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!authReady || !user?.id) return;
    void loadRows(user.id);
  }, [authReady, user?.id]);

  const filteredRows = useMemo(() => {
    if (statusFilter === 'all') return rows;
    return rows.filter((row) => row.status === statusFilter);
  }, [rows, statusFilter]);

  const submitItem = async () => {
    if (!user?.id || !message.trim() || saving) return;
    setSaving(true);
    setError('');
    setInfo('');
    try {
      const payload = {
        user_id: user.id,
        category,
        message: message.trim(),
        status: 'pending',
      };
      const { error: insertError } = await supabase
        .from('community_submissions')
        .insert(payload);
      if (insertError) throw insertError;
      setMessage('');
      setInfo('Submitted. Admin will review and reply here.');
      await loadRows(user.id);
    } catch (err) {
      setError(err?.message || 'Failed to submit message.');
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
              onClick={() => navigate(createPageUrl('Dashboard'))}
              className="w-9 h-9 rounded-lg flex items-center justify-center"
              style={{ background: 'rgba(10,25,33,0.8)', border: '1px solid rgba(56,189,248,0.2)' }}
            >
              <ArrowLeft className="w-4 h-4 text-white" />
            </button>
            <div>
              <p className="text-white font-black tracking-widest">COMMUNITY</p>
              <p className="text-xs text-slate-400">Suggestions, requests, and bug reports</p>
            </div>
          </div>
        </HoloPanel>

        <HoloPanel>
          <p className="text-cyan-300 text-xs font-bold tracking-widest mb-3 flex items-center gap-2">
            <MessageSquarePlus className="w-3.5 h-3.5" /> SUBMIT FEEDBACK
          </p>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-slate-400 tracking-widest">CATEGORY</Label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full rounded-md bg-slate-900/70 border border-slate-700 text-slate-100 text-sm px-3 py-2"
              >
                {CATEGORIES.map((item) => (
                  <option key={item.value} value={item.value}>{item.label}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-slate-400 tracking-widest">MESSAGE</Label>
              <Input
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Describe your suggestion / issue..."
                className="bg-slate-900/70 border-slate-700 text-white"
              />
            </div>
            <Button onClick={submitItem} disabled={saving || !message.trim()} className="w-full sm:w-auto">
              <Send className="w-4 h-4 mr-2" /> {saving ? 'Submitting...' : 'Submit'}
            </Button>
          </div>
          {error && <p className="text-xs mt-2 text-red-300">{error}</p>}
          {info && <p className="text-xs mt-2 text-emerald-300">{info}</p>}
        </HoloPanel>

        <HoloPanel>
          <div className="flex items-center justify-between gap-2 mb-3">
            <p className="text-cyan-300 text-xs font-bold tracking-widest">YOUR SUBMISSIONS</p>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-md bg-slate-900/70 border border-slate-700 text-slate-100 text-xs px-2 py-1.5"
            >
              <option value="all">All</option>
              <option value="pending">Pending</option>
              <option value="reviewed">Reviewed</option>
              <option value="resolved">Resolved</option>
            </select>
          </div>
          {loading ? (
            <div className="py-4 text-sm text-slate-400">Loading...</div>
          ) : filteredRows.length === 0 ? (
            <div className="py-4 text-sm text-slate-500">No submissions in this filter.</div>
          ) : (
            <div className="space-y-2">
              {filteredRows.map((row) => (
                <div key={row.id} className="rounded-lg p-3 border border-slate-700/60 bg-slate-900/35 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs text-slate-300 uppercase tracking-widest">
                      {String(row.category || '').replace(/_/g, ' ')}
                    </p>
                    <span
                      className="text-[10px] font-black tracking-widest px-2 py-0.5 rounded border"
                      style={{
                        color: STATUS_COLORS[row.status] || '#94A3B8',
                        borderColor: `${STATUS_COLORS[row.status] || '#94A3B8'}66`,
                        background: `${STATUS_COLORS[row.status] || '#94A3B8'}1a`,
                      }}
                    >
                      {String(row.status || 'pending').toUpperCase()}
                    </span>
                  </div>
                  <p className="text-sm text-white whitespace-pre-wrap break-words">{row.message}</p>
                  <p className="text-[11px] text-slate-500">{new Date(row.created_at).toLocaleString()}</p>
                  {row.admin_reply && (
                    <div className="rounded-md p-2 border border-cyan-500/30 bg-cyan-950/20">
                      <p className="text-[10px] font-black tracking-widest text-cyan-300 mb-1">ADMIN REPLY</p>
                      <p className="text-xs text-cyan-100 whitespace-pre-wrap break-words">{row.admin_reply}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </HoloPanel>
      </div>
    </SystemBackground>
  );
}
