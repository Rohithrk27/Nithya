import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useNavigate } from 'react-router-dom';
import { createPageUrl } from '../utils';
import { ArrowLeft, Plus, Trash2, Edit3, Check, X, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuthedPageUser } from '@/lib/useAuthedPageUser';
import { toastError, toastSuccess } from '@/lib/toast';
import SystemBackground from '../components/SystemBackground';
import HoloPanel from '../components/HoloPanel';
import { motion, AnimatePresence } from 'framer-motion';
import { scaledXP } from '../components/gameEngine';
import {
  completeHabitSubtask,
  createHabitSubtask,
  deleteHabitSubtask,
  fetchHabitSubtasks,
  mapSubtasksByHabit,
} from '@/lib/habitSubtasks';

const DIFFICULTIES = ['easy', 'medium', 'hard'];
const PUNISHMENT_DIFFS = ['low', 'medium', 'high', 'extreme'];
const PUNISHMENT_TYPES = ['xp_deduction', 'streak_reset', 'relic_loss'];
const DIFF_COLORS = { easy: '#34D399', medium: '#FBBF24', hard: '#F87171' };
const PDIFF_COLORS = { low: '#FBBF24', medium: '#FB923C', high: '#F87171', extreme: '#38BDF8' };

const DEFAULT_FORM = {
  title: '', frequency: 'daily', xp_value: 50,
  description: '', difficulty: 'medium', punishment_text: '',
  punishment_difficulty: 'medium', punishment_xp_penalty_pct: 10,
  punishment_type: 'xp_deduction', punishment_value: 30, deadline_at: '',
};

const toDateTimeLocalValue = (value) => {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  parsed.setMinutes(parsed.getMinutes() - parsed.getTimezoneOffset());
  return parsed.toISOString().slice(0, 16);
};

const HABIT_OPTIONAL_COLUMNS = [
  'description',
  'deadline_at',
  'punishment_type',
  'punishment_value',
  'punishment_difficulty',
  'punishment_xp_penalty_pct',
];

const isMissingHabitsColumnError = (error) => {
  const msg = String(error?.message || '').toLowerCase();
  return (
    (
      msg.includes("column of 'habits'")
      && msg.includes('could not find')
    )
    || (
      msg.includes('relation "habits"')
      && msg.includes('column')
      && msg.includes('does not exist')
    )
    || (
      msg.includes('column')
      && msg.includes('habits')
      && msg.includes('does not exist')
    )
  );
};

const getMissingHabitsColumn = (error) => {
  const raw = String(error?.message || '');
  let match = raw.match(/Could not find the '([^']+)' column of 'habits'/i);
  if (match?.[1]) return match[1];
  match = raw.match(/column "([^"]+)" of relation "habits" does not exist/i);
  if (match?.[1]) return match[1];
  return null;
};

const runHabitWriteCompat = async ({ mode, payload, userId, habitId }) => {
  let workingPayload = { ...payload };
  let fallbackUsed = false;

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const result = mode === 'update'
      ? await supabase
        .from('habits')
        .update(workingPayload)
        .eq('id', habitId)
        .eq('user_id', userId)
        .select('*')
        .maybeSingle()
      : await supabase
        .from('habits')
        .insert(workingPayload)
        .select('*')
        .single();

    if (!result.error) {
      return { data: result.data || null, payload: workingPayload, fallbackUsed, error: null };
    }

    if (!isMissingHabitsColumnError(result.error)) {
      return { data: null, payload: workingPayload, fallbackUsed, error: result.error };
    }

    const missingColumn = getMissingHabitsColumn(result.error);
    if (missingColumn && Object.prototype.hasOwnProperty.call(workingPayload, missingColumn)) {
      delete workingPayload[missingColumn];
      fallbackUsed = true;
      continue;
    }

    if (!fallbackUsed) {
      fallbackUsed = true;
      for (const columnName of HABIT_OPTIONAL_COLUMNS) {
        delete workingPayload[columnName];
      }
      continue;
    }

    return { data: null, payload: workingPayload, fallbackUsed, error: result.error };
  }

  return {
    data: null,
    payload: workingPayload,
    fallbackUsed: true,
    error: new Error('Failed to save habit because the habits schema is out of date.'),
  };
};

export default function Habits() {
  const navigate = useNavigate();
  const { user, authReady } = useAuthedPageUser();
  const [habits, setHabits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(DEFAULT_FORM);
  const [saving, setSaving] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [subtasksByHabit, setSubtasksByHabit] = useState({});
  const [subtaskDrafts, setSubtaskDrafts] = useState({});
  const [subtaskBusyId, setSubtaskBusyId] = useState('');

  useEffect(() => {
    if (!authReady || !user?.id) return;
    void loadData(user.id);
  }, [authReady, user?.id]);

  const loadData = async (userId) => {
    if (!userId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('habits')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });
      if (error) throw error;

      const habitRows = data || [];
      setHabits(habitRows);
      const habitIds = habitRows.map((row) => row.id).filter(Boolean);
      if (habitIds.length > 0) {
        try {
          const subtasks = await fetchHabitSubtasks({ userId, habitIds });
          setSubtasksByHabit(mapSubtasksByHabit(subtasks));
        } catch (_) {
          setSubtasksByHabit({});
        }
      } else {
        setSubtasksByHabit({});
      }
    } catch (err) {
      setHabits([]);
      setSubtasksByHabit({});
      toastError(err?.message || 'Failed to load habits.');
    } finally {
      setLoading(false);
    }
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
      description: habit.description || '',
      difficulty: habit.difficulty || 'medium',
      punishment_text: habit.punishment_text || '',
      punishment_difficulty: habit.punishment_difficulty || 'medium',
      punishment_xp_penalty_pct: habit.punishment_xp_penalty_pct ?? 10,
      punishment_type: habit.punishment_type || 'xp_deduction',
      punishment_value: Number(habit.punishment_value ?? 30),
      deadline_at: toDateTimeLocalValue(habit.deadline_at),
    });
    setEditingId(habit.id);
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!user?.id) {
      toastError('You must be signed in to save habits.');
      return;
    }

    const title = form.title.trim();
    const punishmentText = form.punishment_text.trim();

    if (!title) {
      toastError('Habit name is required.');
      return;
    }

    if (!punishmentText && !editingId) {
      toastError('Punishment description is required for new habits.');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        ...form,
        title,
        description: form.description?.trim() || '',
        punishment_text: punishmentText,
        xp_value: Number(form.xp_value) || 50,
        punishment_xp_penalty_pct: Number(form.punishment_xp_penalty_pct) || 10,
        punishment_value: Math.max(0, Number(form.punishment_value || 0)),
        deadline_at: form.deadline_at ? new Date(form.deadline_at).toISOString() : null,
        user_id: user.id,
      };

      if (editingId) {
        const result = await runHabitWriteCompat({
          mode: 'update',
          payload,
          userId: user.id,
          habitId: editingId,
        });
        if (result.error) throw result.error;

        const nextHabit = result.data || { id: editingId, ...result.payload };
        setHabits((prev) => prev.map((row) => (row.id === editingId ? { ...row, ...nextHabit } : row)));
      } else {
        const result = await runHabitWriteCompat({
          mode: 'insert',
          payload,
          userId: user.id,
          habitId: null,
        });
        if (result.error) throw result.error;

        if (result.data?.id) {
          setHabits((prev) => [...prev, result.data]);
          setSubtasksByHabit((prev) => ({ ...prev, [result.data.id]: [] }));
        } else {
          await loadData(user.id);
        }
      }

      setShowForm(false);
      setEditingId(null);
    } catch (err) {
      toastError(err?.message || 'Failed to save habit.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!user?.id) return;
    try {
      const { error } = await supabase.from('habits').delete().eq('id', id).eq('user_id', user.id);
      if (error) throw error;

      setHabits((h) => h.filter((x) => x.id !== id));
      setSubtasksByHabit((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    } catch (err) {
      toastError(err?.message || 'Failed to delete habit.');
    }
  };

  const updateSubtaskDraft = (habitId, patch) => {
    setSubtaskDrafts((prev) => ({
      ...prev,
      [habitId]: {
        title: '',
        xpValue: 10,
        ...(prev[habitId] || {}),
        ...(patch || {}),
      },
    }));
  };

  const addSubtask = async (habitId) => {
    if (!user?.id || !habitId || subtaskBusyId) return;
    const draft = subtaskDrafts[habitId] || { title: '', xpValue: 10 };
    if (!draft.title?.trim()) return;
    setSubtaskBusyId(habitId);
    try {
      const created = await createHabitSubtask({
        habitId,
        title: draft.title.trim(),
        xpValue: Number(draft.xpValue || 10),
        sortOrder: (subtasksByHabit[habitId] || []).length,
      });
      setSubtasksByHabit((prev) => ({
        ...prev,
        [habitId]: [...(prev[habitId] || []), created],
      }));
      updateSubtaskDraft(habitId, { title: '', xpValue: draft.xpValue || 10 });
    } finally {
      setSubtaskBusyId('');
    }
  };

  const toggleSubtask = async (habitId, subtask) => {
    if (!user?.id || !subtask?.id || subtaskBusyId) return;
    setSubtaskBusyId(subtask.id);
    try {
      const nextComplete = !subtask.completed;
      const snapshot = await completeHabitSubtask({
        userId: user.id,
        subtaskId: subtask.id,
        complete: nextComplete,
      });
      setSubtasksByHabit((prev) => ({
        ...prev,
        [habitId]: (prev[habitId] || []).map((row) => (
          row.id === subtask.id
            ? { ...row, completed: nextComplete, completed_at: nextComplete ? new Date().toISOString() : null }
            : row
        )),
      }));
      if (snapshot?.habit_completed && nextComplete) {
        toastSuccess('All subtasks completed. Habit streak updated and XP granted.');
      }
    } catch (err) {
      toastError(err?.message || 'Failed to update subtask.');
    } finally {
      setSubtaskBusyId('');
    }
  };

  const removeSubtask = async (habitId, subtaskId) => {
    if (!user?.id || !subtaskId || subtaskBusyId) return;
    setSubtaskBusyId(subtaskId);
    try {
      await deleteHabitSubtask({ userId: user.id, subtaskId });
      setSubtasksByHabit((prev) => ({
        ...prev,
        [habitId]: (prev[habitId] || []).filter((row) => row.id !== subtaskId),
      }));
    } finally {
      setSubtaskBusyId('');
    }
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

                  <div className="space-y-1.5">
                    <Label className="text-xs font-black tracking-widest" style={{ color: '#64748B' }}>DESCRIPTION</Label>
                    <Input value={form.description} onChange={e => f('description', e.target.value)}
                      placeholder="What exactly should be done?"
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

                  <div className="space-y-1.5">
                    <Label className="text-xs font-black tracking-widest" style={{ color: '#64748B' }}>DEADLINE (OPTIONAL)</Label>
                    <Input
                      type="datetime-local"
                      value={form.deadline_at}
                      onChange={(e) => f('deadline_at', e.target.value)}
                      style={{ background: 'rgba(10,25,33,0.8)', border: '1px solid rgba(56,189,248,0.2)', color: '#F1F5F9' }}
                    />
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

                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1.5">
                        <Label className="text-xs font-black tracking-widest" style={{ color: '#64748B' }}>PUNISHMENT TYPE</Label>
                        <select
                          value={form.punishment_type}
                          onChange={(e) => f('punishment_type', e.target.value)}
                          className="w-full rounded-md bg-slate-900/80 border border-red-500/20 text-slate-100 text-sm px-3 py-2"
                        >
                          {PUNISHMENT_TYPES.map((type) => (
                            <option key={type} value={type}>{type}</option>
                          ))}
                        </select>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs font-black tracking-widest" style={{ color: '#64748B' }}>PUNISHMENT VALUE</Label>
                        <Input
                          type="number"
                          min={0}
                          value={form.punishment_value}
                          onChange={(e) => f('punishment_value', e.target.value)}
                          style={{ background: 'rgba(10,25,33,0.8)', border: '1px solid rgba(248,113,113,0.2)', color: '#F1F5F9' }}
                        />
                      </div>
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
                  <Button onClick={handleSave} disabled={saving || !form.title.trim() || (!editingId && !form.punishment_text.trim())} className="w-full font-black tracking-widest"
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
            const habitSubtasks = subtasksByHabit[habit.id] || [];
            const completedSubtasks = habitSubtasks.filter((s) => s.completed).length;
            const draft = subtaskDrafts[habit.id] || { title: '', xpValue: 10 };
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
                            <p className="text-xs mt-1" style={{ color: '#94A3B8' }}>
                              Type: <span style={{ color: '#FCA5A5' }}>{habit.punishment_type || 'xp_deduction'}</span>
                              {' · '}
                              Value: <span style={{ color: '#FCA5A5' }}>{Math.max(0, Number(habit.punishment_value || 0))}</span>
                            </p>
                            <p className="text-xs mt-1" style={{ color: '#475569' }}>
                              Refusal penalty: <span style={{ color: '#F87171' }}>{habit.punishment_xp_penalty_pct || 10}% XP</span>
                            </p>
                          </div>

                          <div className="rounded-lg p-3" style={{ background: 'rgba(34,211,238,0.05)', border: '1px solid rgba(34,211,238,0.2)' }}>
                            <p className="text-xs font-black tracking-widest mb-1" style={{ color: '#67E8F9' }}>DETAILS</p>
                            <p className="text-xs text-slate-200">{habit.description || 'No description set.'}</p>
                            <p className="text-xs mt-1" style={{ color: '#94A3B8' }}>
                              Deadline: {habit.deadline_at ? new Date(habit.deadline_at).toLocaleString() : 'No deadline'}
                            </p>
                          </div>

                          <div className="rounded-lg p-3 space-y-2" style={{ background: 'rgba(56,189,248,0.06)', border: '1px solid rgba(56,189,248,0.2)' }}>
                            <div className="flex items-center justify-between">
                              <p className="text-xs font-black tracking-widest" style={{ color: '#38BDF8' }}>
                                SUBTASKS
                              </p>
                              <p className="text-[10px] font-bold" style={{ color: '#94A3B8' }}>
                                {completedSubtasks}/{habitSubtasks.length} COMPLETE
                              </p>
                            </div>

                            {habitSubtasks.length === 0 ? (
                              <p className="text-xs" style={{ color: '#64748B' }}>No subtasks yet. Add steps to split this habit into progress chunks.</p>
                            ) : (
                              <div className="space-y-1.5">
                                {habitSubtasks.map((subtask) => (
                                  <div key={subtask.id} className="flex items-center gap-2 rounded-md px-2 py-1.5"
                                    style={{ background: 'rgba(15,32,39,0.55)', border: '1px solid rgba(56,189,248,0.15)' }}>
                                    <button
                                      type="button"
                                      onClick={() => toggleSubtask(habit.id, subtask)}
                                      disabled={!!subtaskBusyId}
                                      className="w-4 h-4 rounded border flex items-center justify-center text-[10px]"
                                      style={{
                                        borderColor: subtask.completed ? '#34D399' : '#475569',
                                        color: subtask.completed ? '#34D399' : '#64748B',
                                      }}
                                    >
                                      {subtask.completed ? '✓' : ''}
                                    </button>
                                    <p className="text-xs flex-1" style={{ color: subtask.completed ? '#34D399' : '#F1F5F9' }}>
                                      {subtask.title}
                                    </p>
                                    <span className="text-[10px] font-bold" style={{ color: '#FBBF24' }}>+{subtask.xp_value || 0} XP</span>
                                    <button
                                      type="button"
                                      onClick={() => removeSubtask(habit.id, subtask.id)}
                                      disabled={!!subtaskBusyId}
                                      className="text-[10px]"
                                      style={{ color: '#F87171' }}
                                    >
                                      DEL
                                    </button>
                                  </div>
                                ))}
                              </div>
                            )}

                            <div className="grid grid-cols-12 gap-2">
                              <Input
                                className="col-span-8"
                                value={draft.title || ''}
                                onChange={(e) => updateSubtaskDraft(habit.id, { title: e.target.value })}
                                placeholder="Add subtask title"
                                style={{ background: 'rgba(10,25,33,0.8)', border: '1px solid rgba(56,189,248,0.2)', color: '#F1F5F9' }}
                              />
                              <Input
                                className="col-span-2"
                                type="number"
                                min={1}
                                max={500}
                                value={draft.xpValue || 10}
                                onChange={(e) => updateSubtaskDraft(habit.id, { xpValue: e.target.value })}
                                style={{ background: 'rgba(10,25,33,0.8)', border: '1px solid rgba(56,189,248,0.2)', color: '#F1F5F9' }}
                              />
                              <Button
                                className="col-span-2"
                                onClick={() => addSubtask(habit.id)}
                                disabled={!!subtaskBusyId || !(draft.title || '').trim()}
                                style={{ background: 'rgba(56,189,248,0.2)', border: '1px solid rgba(56,189,248,0.4)', color: '#38BDF8' }}
                              >
                                + Step
                              </Button>
                            </div>
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

