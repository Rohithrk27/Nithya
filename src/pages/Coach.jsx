import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { useNavigate } from 'react-router-dom';
import { createPageUrl } from '../utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ArrowLeft, Send } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

const LOGO_URL = "";

export default function Coach() {
  const navigate = useNavigate();
  const [profile, setProfile] = useState(null);
  const [stats, setStats] = useState(null);
  const [habits, setHabits] = useState([]);
  const [conversation, setConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const bottomRef = useRef(null);
  const unsubscribeRef = useRef(null);

  useEffect(() => {
    const init = async () => {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (!authUser) {
        navigate(createPageUrl('Landing'));
        return;
      }
      await loadData(authUser.id);
    };
    init();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!session?.user) {
        navigate(createPageUrl('Landing'));
        return;
      }
      await loadData(session.user.id);
    });
    unsubscribeRef.current = () => subscription.unsubscribe();
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const loadData = async (userId) => {
    if (!userId) return;
    
    const [profileRes, statsRes, habitsRes] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', userId).limit(1),
      supabase.from('stats').select('*').eq('user_id', userId).limit(1),
      supabase.from('habits').select('*').eq('user_id', userId),
    ]);
    const profiles = profileRes.data || [];
    const statsData = statsRes.data || [];
    const habitsData = habitsRes.data || [];
    if (!profiles || profiles.length === 0) { navigate(createPageUrl('Landing')); return; }
    const p = profiles[0];
    const s = statsData[0] || null;
    setProfile(p);
    setStats(s);
    setHabits(habitsData);
    const level = Math.floor((p.total_xp || 0) / 500) + 1;
    setMessages([{
      role: 'assistant',
      content: `Hey ${p.name?.split(' ')[0]}! I'm Niത്യ, your discipline coach 💪\n\nYou're at Level ${level} with ${p.global_streak || 0} day streak and ${habitsData.length} tracked habits.\n\nHardcore mode: ${s?.hardcore_mode ? 'ON' : 'OFF'}.`
    }]);
    setInitializing(false);
  };

  const sendMessage = async () => {
    if (!input.trim() || loading) return;
    const content = input.trim();
    setInput('');
    setLoading(true);
    setMessages(prev => [...prev, { role: 'user', content }]);

    setTimeout(() => {
      setMessages(prev => [...prev, { role: 'assistant', content: `Thanks — I heard: "${content}". Coaching features coming soon.` }]);
      setLoading(false);
    }, 800);
  };

  if (initializing) return (
    <div className="min-h-screen bg-[#0F172A] flex items-center justify-center">
      <div className="animate-pulse text-[#94A3B8]">Loading...</div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#0F172A] flex flex-col">
      <div className="flex items-center gap-3 p-4 border-b border-[#334155] bg-[#1E293B]">
        <Button variant="ghost" size="icon" className="text-[#94A3B8]" onClick={() => navigate(createPageUrl('Dashboard'))}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <img src={LOGO_URL} alt="Niത്യ" className="w-8 h-8 object-contain" />
        <div>
          <p className="font-bold text-[#F8FAFC]">Niത്യ</p>
          <p className="text-xs text-green-400">Online</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] px-4 py-3 rounded-2xl text-sm ${msg.role === 'user' ? 'bg-[#3B82F6] text-white rounded-br-sm' : 'bg-[#1E293B] text-[#F8FAFC] border border-[#334155] rounded-bl-sm'}`}>
              <ReactMarkdown>{msg.content}</ReactMarkdown>
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-[#1E293B] border border-[#334155] px-4 py-3 rounded-2xl rounded-bl-sm">
              <div className="flex gap-1">
                <span className="w-2 h-2 bg-[#94A3B8] rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
                <span className="w-2 h-2 bg-[#94A3B8] rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                <span className="w-2 h-2 bg-[#94A3B8] rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="p-4 border-t border-[#334155] bg-[#1E293B]">
        <div className="flex gap-2">
          <Input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && sendMessage()}
            placeholder="Ask your coach..."
            className="bg-[#0F172A] border-[#334155] text-[#F8FAFC] placeholder:text-[#475569]"
          />
          <Button onClick={sendMessage} disabled={loading} className="bg-[#3B82F6] hover:bg-[#3B82F6]/90 px-4">
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

