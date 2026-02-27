import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useNavigate } from 'react-router-dom';
import { createPageUrl } from '../utils';
import { ArrowLeft, Plus, Trash2, Edit3, Check, X, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import SystemBackground from '../components/SystemBackground';
import HoloPanel from '../components/HoloPanel';
import { motion, AnimatePresence } from 'framer-motion';
import { scaledXP } from '../components/gameEngine';

const DIFFICULTIES = ['easy', 'medium', 'hard'];
const PUNISHMENT_DIFFS = ['low', 'medium', 'high', 'extreme'];
const DIFF_COLORS = { easy: '#34D399', medium: '#FBBF24', hard: '#F87171' };
const PDIFF_COLORS = { low: '#FBBF24', medium: '#FB923C', high: '#F87171', extreme: '#A78BFA' };

const DEFAULT_FORM = {
  title: '', frequency: 'daily', xp_value: 50,
  difficulty: 'medium', punishment_text: '',
  punishment_difficulty: 'medium', punishment_xp_penalty_pct: 10,
};

export default function Habits() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [habits, setHabits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(DEFAULT_FORM);
  const [saving, setSaving] = useState(false);
  const [expandedId, setExpandedId] = useState(null);

  useEffect(() => {
    const init = async () => {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (!authUser) {
        navigate(createPageUrl('Landing'));
        return;
      }
      setUser({ id: authUser.id, email: authUser.email });
      await loadData(authUser.id);
    };
    init();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!session?.user) {
        navigate(createPageUrl('Landing'));
        return;
      }
      setUser({ id: session.user.id, email: session.user.email });
      await loadData(session.user.id);
    });
    return () => subscription.unsubscribe();
  }, []);

  const loadData = async (userId) => {
    if (!userId) return;
    const { data } = await supabase
      .from('habits')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    setHabits(data || []);
    setLoading(false);
  };

  const openNew = () => {
    setForm(DEFAULT_FORM);
    setEditingId(null);
    setShowForm(true);
  };

  const openEdit = (habit) => {
    setForm({
      title: habit.title || '',
      frequency: habit.frequency || 'daily',
      xp_value: habit.xp_value || 50,
      difficulty: habit.difficulty || 'medium',
      punishment_text: habit.punishment_text || '',
      punishment_difficulty: habit.punishment_difficulty || 'medium',
      punishment_xp_penalty_pct: habit.punishment_xp_penalty_pct ?? 10,
    });
    setEditingId(habit.id);
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.title.trim() || !form.punishment_text.trim()) return;
    setSaving(true);
    const payload = {
      ...form,
      xp_value: parseInt(form.xp_value) || 50,
      punishment_xp_penalty_pct: parseInt(form.punishment_xp_penalty_pct) || 10,
      user_id: user.id,
    };
    if (editingId) {
      await supabase.from('habits').update(payload).eq('id', editingId).eq('user_id', user.id);
      setHabits(h => h.map(x => x.id === editingId ? { ...x, ...payload } : x));
    } else {
      const { data } = await supabase.from('habits').insert(payload).select().single();
      setHabits(h => [...h, data || { ...payload }]);
    }
    setShowForm(false);
    setEditingId(null);
    setSaving(false);
  };

  const handleDelete = async (id) => {
    await supabase.from('habits').delete().eq('id', id).eq('user_id', user.id);
    setHabits(h => h.filter(x => x.id !== id));
  };

  const f = (field, val) => setForm(p => ({ ...p, [field]: val }));

  if (loading) return (
    <SystemBackground>
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin" />
      </div>
    </SystemBackground>
  );

  return (
    <SystemBackground>
      <div className="max-w-2xl mx-auto p-4 md:p-6 space-y-4">

        {/* Header */}
        <div className="flex items-center justify-between py-2">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate(createPageUrl('Dashboard'))}
              className="w-9 h-9 rounded-lg flex items-center justify-center"
              style={{ background: 'rgba(10,25,33,0.8)', border: '1px solid rgba(56,189,248,0.2)' }}>
              <ArrowLeft className="w-4 h-4 text-white" />
            </button>
            <div>
              <h1 className="text-lg font-black tracking-widest text-white">HABIT CONFIGURATION</h1>
              <p className="text-xs font-mono" style={{ color: '#38BDF866' }}>{habits.length} HABITS REGISTERED</p>
            </div>
          </div>
          <Button onClick={openNew} size="sm"
            style={{ background: 'rgba(56,189,248,0.12)', border: '1px solid rgba(56,189,248,0.4)', color: '#38BDF8' }}>
            <Plus className="w-4 h-4 mr-1" /> ADD
          </Button>
        </div>

        {/* Form */}
        <AnimatePresence>
          {showForm && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
            >
              <HoloPanel glowColor="#38BDF8" active>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xs font-black tracking-widest" style={{ color: '#38BDF8' }}>
                    {editingId ? 'EDIT HABIT' : 'NEW HABIT'}
                  </h2>
                  <button onClick={() => setShowForm(false)} style={{ color: '#475569' }}>
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="space-y-4">
                  {/* Title */}
                  <div className="space-y-1.5">
                    <Label className="text-xs font-black tracking-widest" style={{ color: '#64748B' }}>HABIT NAME</Label>
                    <Input value={form.title} onChange={e => f('title', e.target.value)}
                      placeholder="e.g. Morning Run"
                      style={{ background: 'rgba(10,25,33,0.8)', border: '1px solid rgba(56,189,248,0.2)', color: '#F1F5F9' }} />
                  </div>

                  {/* XP + Difficulty */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-black tracking-widest" style={{ color: '#64748B' }}>BASE XP</Label>
                      <Input type="number" min={10} max={500} value={form.xp_value} onChange={e => f('xp_value', e.target.value)}
                        style={{ background: 'rgba(10,25,33,0.8)', border: '1px solid rgba(56,189,248,0.2)', color: '#F1F5F9' }} />
                      <p className="text-xs" style={{ color: '#475569' }}>Awarded: {scaledXP(form.xp_value)} XP</p>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs font-black tracking-widest" style={{ color: '#64748B' }}>DIFFICULTY</Label>
                      <div className="flex gap-2">
                        {DIFFICULTIES.map(d => (
                          <button key={d} onClick={() => f('difficulty', d)}
                            className="flex-1 py-2 rounded-lg text-xs font-black tracking-wide transition-all"
                            style={{
                              background: form.difficulty === d ? `${DIFF_COLORS[d]}20` : 'rgba(10,25,33,0.6)',
                              border: `1px solid ${form.difficulty === d ? DIFF_COLORS[d] : 'rgba(56,189,248,0.1)'}`,
                              color: form.difficulty === d ? DIFF_COLORS[d] : '#475569',
                            }}>
                            {d.charAt(0).toUpperCase()}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Punishment section */}
                  <div className="rounded-xl p-4 space-y-3"
                    style={{ background: 'rgba(248,113,113,0.04)', border: '1px solid rgba(248,113,113,0.15)' }}>
                    <p className="text-xs font-black tracking-widest" style={{ color: '#F87171' }}>⚠ PUNISHMENT SETTINGS</p>

                    <div className="space-y-1.5">
                      <Label className="text-xs font-black tracking-widest" style={{ color: '#64748B' }}>PUNISHMENT DESCRIPTION</Label>
                      <Input value={form.punishment_text} onChange={e => f('punishment_text', e.target.value)}
                        placeholder="e.g. 50 pushups, cold shower..."
                        style={{ background: 'rgba(10,25,33,0.8)', border: '1px solid rgba(248,113,113,0.2)', color: '#F1F5F9' }} />
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs font-black tracking-widest" style={{ color: '#64748B' }}>PUNISHMENT SEVERITY</Label>
                      <div className="flex gap-2">
                        {PUNISHMENT_DIFFS.map(d => (
                          <button key={d} onClick={() => f('punishment_difficulty', d)}
                            className="flex-1 py-2 rounded-lg text-xs font-black tracking-wide transition-all"
                            style={{
                              background: form.punishment_difficulty === d ? `${PDIFF_COLORS[d]}20` : 'rgba(10,25,33,0.6)',
                              border: `1px solid ${form.punishment_difficulty === d ? PDIFF_COLORS[d] : 'rgba(248,113,113,0.1)'}`,
                              color: form.punishment_difficulty === d ? PDIFF_COLORS[d] : '#475569',
                              fontSize: 9,
                            }}>
                            {d.toUpperCase()}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs font-black tracking-widest" style={{ color: '#64748B' }}>
                        XP PENALTY IF REFUSED: <span style={{ color: '#F87171' }}>{form.punishment_xp_penalty_pct}%</span>
                      </Label>
                      <input type="range" min={5} max={25} step={1}
                        value={form.punishment_xp_penalty_pct}
                        onChange={e => f('punishment_xp_penalty_pct', e.target.value)}
                        className="w-full accent-red-400" />
                      <div className="flex justify-between text-xs" style={{ color: '#475569' }}>
                        <span>5% (lenient)</span><span>25% (brutal)</span>
                      </div>
                    </div>
                  </div>

                  {/* Save */}
                  <Button onClick={handleSave} disabled={saving || !form.title || !form.punishment_text} className="w-full font-black tracking-widest"
                    style={{ background: 'rgba(56,189,248,0.15)', border: '1px solid rgba(56,189,248,0.4)', color: '#38BDF8' }}>
                    <Check className="w-4 h-4 mr-2" />
                    {saving ? 'SAVING...' : editingId ? 'UPDATE HABIT' : 'CREATE HABIT'}
                  </Button>
                </div>
              </HoloPanel>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Habit list */}
        {habits.length === 0 && !showForm && (
          <HoloPanel>
            <div className="text-center py-6">
              <p className="text-sm mb-2" style={{ color: '#475569' }}>No habits registered.</p>
              <p className="text-xs mb-4" style={{ color: '#334155' }}>Discipline starts here.</p>
              <Button onClick={openNew} size="sm"
                style={{ background: 'rgba(56,189,248,0.12)', border: '1px solid rgba(56,189,248,0.4)', color: '#38BDF8' }}>
                <Plus className="w-4 h-4 mr-1" /> Add First Habit
              </Button>
            </div>
          </HoloPanel>
        )}

        <div className="space-y-3">
          {habits.map((habit, i) => {
            const dc = DIFF_COLORS[habit.difficulty] || '#64748B';
            const pc = PDIFF_COLORS[habit.punishment_difficulty] || '#F87171';
            const expanded = expandedId === habit.id;
            return (
              <motion.div key={habit.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}>
                <HoloPanel glowColor={dc}>
                  <div className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-black text-white truncate">{habit.title}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs font-bold" style={{ color: '#FBBF24' }}>+{scaledXP(habit.xp_value)} XP</span>
                        <span className="text-xs font-black px-1.5 py-0.5 rounded"
                          style={{ background: `${dc}15`, color: dc, border: `1px solid ${dc}33`, fontSize: 9 }}>
                          {habit.difficulty?.toUpperCase()}
                        </span>
                        <span className="text-xs font-black px-1.5 py-0.5 rounded"
                          style={{ background: `${pc}15`, color: pc, border: `1px solid ${pc}33`, fontSize: 9 }}>
                          ⚠ {(habit.punishment_difficulty || 'medium').toUpperCase()}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button onClick={() => openEdit(habit)}
                        className="w-8 h-8 rounded-lg flex items-center justify-center transition-all hover:scale-110"
                        style={{ background: 'rgba(56,189,248,0.08)', border: '1px solid rgba(56,189,248,0.2)', color: '#38BDF8' }}>
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => handleDelete(habit.id)}
                        className="w-8 h-8 rounded-lg flex items-center justify-center transition-all hover:scale-110"
                        style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)', color: '#F87171' }}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => setExpandedId(expanded ? null : habit.id)}
                        className="w-8 h-8 rounded-lg flex items-center justify-center"
                        style={{ color: '#475569' }}>
                        {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <AnimatePresence>
                    {expanded && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden">
                        <div className="mt-3 pt-3 space-y-2" style={{ borderTop: '1px solid rgba(56,189,248,0.1)' }}>
                          <div className="rounded-lg p-3" style={{ background: `${pc}0a`, border: `1px solid ${pc}22` }}>
                            <p className="text-xs font-black tracking-widest mb-1" style={{ color: pc }}>PUNISHMENT</p>
                            <p className="text-xs text-white">{habit.punishment_text || 'None set'}</p>
                            <p className="text-xs mt-1" style={{ color: '#475569' }}>
                              Refusal penalty: <span style={{ color: '#F87171' }}>{habit.punishment_xp_penalty_pct || 10}% XP</span>
                            </p>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </HoloPanel>
              </motion.div>
            );
          })}
        </div>
      </div>
    </SystemBackground>
  );
}
