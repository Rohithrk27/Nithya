import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, MessageCircle, MessageSquarePlus, Send } from 'lucide-react';
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

const CHAT_ROOM = 'global';

const firstRow = (data) => (Array.isArray(data) ? (data[0] || null) : (data || null));

export default function Community() {
  const navigate = useNavigate();
  const { user, authReady } = useAuthedPageUser();
  const [mode, setMode] = useState('feedback');
  const [submissionsLoading, setSubmissionsLoading] = useState(true);
  const [submissionSaving, setSubmissionSaving] = useState(false);
  const [submissionMessage, setSubmissionMessage] = useState('');
  const [category, setCategory] = useState('suggestion');
  const [statusFilter, setStatusFilter] = useState('all');
  const [submissionRows, setSubmissionRows] = useState([]);
  const [submissionError, setSubmissionError] = useState('');
  const [submissionInfo, setSubmissionInfo] = useState('');
  const [chatLoading, setChatLoading] = useState(true);
  const [chatSending, setChatSending] = useState(false);
  const [chatMessage, setChatMessage] = useState('');
  const [chatRows, setChatRows] = useState([]);
  const [chatError, setChatError] = useState('');
  const [chatInfo, setChatInfo] = useState('');
  const chatScrollRef = useRef(null);

  const loadRows = async (userId) => {
    if (!userId) return;
    setSubmissionsLoading(true);
    setSubmissionError('');
    try {
      const { data, error: readError } = await supabase
        .from('community_submissions')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(200);
      if (readError) throw readError;
      setSubmissionRows(data || []);
    } catch (err) {
      setSubmissionError(err?.message || 'Failed to load community submissions.');
    } finally {
      setSubmissionsLoading(false);
    }
  };

  const loadChatRows = async () => {
    setChatLoading(true);
    setChatError('');
    try {
      const { data, error: readError } = await supabase
        .from('community_chat_messages')
        .select('*')
        .eq('room', CHAT_ROOM)
        .order('created_at', { ascending: false })
        .limit(250);
      if (readError) throw readError;
      setChatRows([...(data || [])].reverse());
    } catch (err) {
      setChatError(err?.message || 'Failed to load chat messages.');
    } finally {
      setChatLoading(false);
    }
  };

  useEffect(() => {
    if (!authReady || !user?.id) return;
    void loadRows(user.id);
    void loadChatRows();
  }, [authReady, user?.id]);

  const filteredRows = useMemo(() => {
    if (statusFilter === 'all') return submissionRows;
    return submissionRows.filter((row) => row.status === statusFilter);
  }, [submissionRows, statusFilter]);

  useEffect(() => {
    if (!user?.id) return undefined;
    const channel = supabase
      .channel(`community-chat-${user.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'community_chat_messages', filter: `room=eq.${CHAT_ROOM}` },
        (payload) => {
          const row = payload?.new;
          if (!row?.id) return;
          setChatRows((prev) => {
            if (prev.some((item) => item.id === row.id)) return prev;
            const next = [...prev, row];
            if (next.length > 300) return next.slice(next.length - 300);
            return next;
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

  useEffect(() => {
    if (mode !== 'chat') return;
    const el = chatScrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [mode, chatRows.length]);

  const submitItem = async () => {
    if (!user?.id || !submissionMessage.trim() || submissionSaving) return;
    setSubmissionSaving(true);
    setSubmissionError('');
    setSubmissionInfo('');
    const message = submissionMessage.trim();
    const optimisticId = `optimistic-submission-${Date.now()}`;
    const optimisticRow = {
      id: optimisticId,
      user_id: user.id,
      category,
      message,
      status: 'pending',
      created_at: new Date().toISOString(),
      admin_reply: null,
    };
    try {
      const payload = {
        user_id: user.id,
        category,
        message,
        status: 'pending',
      };
      setSubmissionRows((prev) => [optimisticRow, ...prev]);
      setSubmissionMessage('');
      const { data: insertedRow, error: insertError } = await supabase
        .from('community_submissions')
        .insert(payload)
        .select('*')
        .single();
      if (insertError) throw insertError;
      setSubmissionRows((prev) => prev.map((row) => (row.id === optimisticId ? (insertedRow || row) : row)));
      setSubmissionInfo('Submitted. Admin will review and reply here.');
    } catch (err) {
      setSubmissionRows((prev) => prev.filter((row) => row.id !== optimisticId));
      setSubmissionMessage(message);
      setSubmissionError(err?.message || 'Failed to submit message.');
    } finally {
      setSubmissionSaving(false);
    }
  };

  const sendChatMessage = async () => {
    if (!user?.id || !chatMessage.trim() || chatSending) return;
    setChatSending(true);
    setChatError('');
    setChatInfo('');
    const message = chatMessage.trim();
    const optimisticId = `optimistic-chat-${Date.now()}`;
    const optimisticRow = {
      id: optimisticId,
      room: CHAT_ROOM,
      user_id: user.id,
      sender_label: 'YOU',
      message,
      created_at: new Date().toISOString(),
      metadata: {},
    };
    try {
      setChatRows((prev) => [...prev, optimisticRow]);
      setChatMessage('');
      const { data, error: rpcError } = await supabase.rpc('send_community_chat_message', {
        p_user_id: user.id,
        p_message: message,
        p_room: CHAT_ROOM,
        p_metadata: {},
      });
      if (rpcError) throw rpcError;

      const row = firstRow(data);
      setChatRows((prev) => {
        const withoutOptimistic = prev.filter((item) => item.id !== optimisticId);
        if (!row?.id) return withoutOptimistic;
        if (withoutOptimistic.some((item) => item.id === row.id)) return withoutOptimistic;
        return [...withoutOptimistic, row];
      });

      setChatInfo('Message sent.');
    } catch (err) {
      setChatRows((prev) => prev.filter((item) => item.id !== optimisticId));
      setChatMessage(message);
      setChatError(err?.message || 'Failed to send chat message.');
    } finally {
      setChatSending(false);
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
              <p className="text-xs text-slate-400">Suggestions, requests, bug reports, and chat</p>
            </div>
          </div>
        </HoloPanel>

        <HoloPanel glowColor="#38BDF8">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setMode('feedback')}
              className="rounded-lg px-3 py-2 text-xs font-black tracking-widest transition-all"
              style={{
                border: '1px solid rgba(56,189,248,0.3)',
                background: mode === 'feedback' ? 'rgba(56,189,248,0.2)' : 'rgba(15,23,42,0.4)',
                color: mode === 'feedback' ? '#38BDF8' : '#94A3B8',
              }}
            >
              FEEDBACK MODE
            </button>
            <button
              type="button"
              onClick={() => setMode('chat')}
              className="rounded-lg px-3 py-2 text-xs font-black tracking-widest transition-all"
              style={{
                border: '1px solid rgba(34,197,94,0.3)',
                background: mode === 'chat' ? 'rgba(34,197,94,0.18)' : 'rgba(15,23,42,0.4)',
                color: mode === 'chat' ? '#4ADE80' : '#94A3B8',
              }}
            >
              CHAT MODE
            </button>
          </div>
        </HoloPanel>

        {mode === 'feedback' ? (
          <>
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
                    value={submissionMessage}
                    onChange={(e) => setSubmissionMessage(e.target.value)}
                    placeholder="Describe your suggestion / issue..."
                    className="bg-slate-900/70 border-slate-700 text-white"
                  />
                </div>
                <Button onClick={submitItem} disabled={submissionSaving || !submissionMessage.trim()} className="w-full sm:w-auto">
                  <Send className="w-4 h-4 mr-2" /> {submissionSaving ? 'Submitting...' : 'Submit'}
                </Button>
              </div>
              {submissionError && <p className="text-xs mt-2 text-red-300">{submissionError}</p>}
              {submissionInfo && <p className="text-xs mt-2 text-emerald-300">{submissionInfo}</p>}
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
              {submissionsLoading ? (
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
          </>
        ) : (
          <HoloPanel active glowColor="#4ADE80">
            <div className="space-y-3">
              <p className="text-emerald-300 text-xs font-bold tracking-widest flex items-center gap-2">
                <MessageCircle className="w-3.5 h-3.5" /> COMMUNITY CHAT
              </p>
              <p className="text-[11px] text-slate-400">
                Real-time text chat. Keep it respectful. Rapid spam is rate-limited.
              </p>

              <div
                ref={chatScrollRef}
                className="rounded-lg border border-emerald-500/25 bg-slate-950/40 p-3 max-h-[420px] overflow-y-auto space-y-2"
              >
                {chatLoading ? (
                  <p className="text-sm text-slate-400">Loading chat...</p>
                ) : chatRows.length === 0 ? (
                  <p className="text-sm text-slate-500">No messages yet. Start the conversation.</p>
                ) : (
                  chatRows.map((row) => {
                    const own = row.user_id === user?.id;
                    return (
                      <div key={row.id} className={`flex ${own ? 'justify-end' : 'justify-start'}`}>
                        <div
                          className="max-w-[88%] rounded-lg px-3 py-2 border"
                          style={{
                            borderColor: own ? 'rgba(56,189,248,0.45)' : 'rgba(100,116,139,0.35)',
                            background: own ? 'rgba(8,47,73,0.55)' : 'rgba(15,23,42,0.65)',
                          }}
                        >
                          <p className="text-[10px] tracking-widest font-black mb-1" style={{ color: own ? '#38BDF8' : '#94A3B8' }}>
                            {own ? 'YOU' : (row.sender_label || 'User')} · {row.created_at ? new Date(row.created_at).toLocaleTimeString() : ''}
                          </p>
                          <p className="text-sm text-slate-100 whitespace-pre-wrap break-words">{row.message}</p>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              <div className="space-y-2">
                <div className="flex gap-2">
                  <Input
                    value={chatMessage}
                    onChange={(e) => setChatMessage(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        void sendChatMessage();
                      }
                    }}
                    maxLength={500}
                    placeholder="Write a message..."
                    className="bg-slate-900/70 border-slate-700 text-white"
                  />
                  <Button onClick={sendChatMessage} disabled={chatSending || !chatMessage.trim()}>
                    <Send className="w-4 h-4 mr-2" /> {chatSending ? 'Sending...' : 'Send'}
                  </Button>
                </div>
                <p className="text-[10px] text-slate-500 text-right">{chatMessage.length}/500</p>
              </div>
            </div>
            {chatError && <p className="text-xs text-red-300">{chatError}</p>}
            {chatInfo && <p className="text-xs text-emerald-300">{chatInfo}</p>}
          </HoloPanel>
        )}
      </div>
    </SystemBackground>
  );
}
