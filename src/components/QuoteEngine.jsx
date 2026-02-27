import React, { useState, useEffect } from 'react';
import { RefreshCw } from 'lucide-react';

const QUOTES = [
  "Discipline is choosing between what you want now and what you want most.",
  "You don't rise to the level of your goals. You fall to the level of your systems.",
  "The man who moves a mountain begins by carrying away small stones.",
  "We suffer more in imagination than in reality.",
  "Do what is hard. Life will be easy. Do what is easy. Life will be hard.",
  "Waste no more time arguing about what a good man should be. Be one.",
  "The obstacle is the way.",
  "Excellence is not a gift, but a skill that takes practice.",
  "Routine, in an intelligent man, is a sign of ambition.",
  "Self-discipline begins with the mastery of your thoughts.",
  "The successful warrior is the average man, with laser-like focus.",
  "It does not matter how slowly you go as long as you do not stop.",
  "First say what you would be, then do what you have to do.",
  "What you do today is who you become tomorrow.",
  "Pain is temporary. Quitting lasts forever.",
  "Iron rusts from disuse. Stagnation saps the vigor of the mind.",
  "The price of discipline is always less than the pain of regret.",
  "Strength does not come from winning. Your struggles develop your strengths.",
  "He who conquers himself is the mightiest warrior.",
  "Hard choices, easy life. Easy choices, hard life.",
  "Comfort is the enemy of achievement.",
  "The cave you fear to enter holds the treasure you seek.",
  "Your future self is watching you right now through memories.",
  "Small disciplines repeated with consistency every day lead to great achievements.",
  "You have power over your mind, not outside events. Realize this, and you will find strength.",
  "The secret of getting ahead is getting started.",
  "Every moment of resistance to temptation is a victory.",
  "Do not wait. The time will never be just right.",
  "Be harder on yourself now so the world can be easier on you later.",
  "Think in the morning. Act in the noon. Eat in the evening. Sleep in the night.",
  "We are what we repeatedly do. Excellence, then, is not an act, but a habit.",
  "A year from now you may wish you had started today.",
  "The man who has no imagination has no wings.",
  "Push yourself because no one else is going to do it for you.",
  "Great things never come from comfort zones.",
  "Dream bigger. Do bigger.",
  "Your only limit is your mind.",
  "The harder you work, the luckier you get.",
  "Success is earned in the hours no one sees.",
  "Suffer the pain of discipline, or suffer the pain of regret.",
  "Don't count the days. Make the days count.",
  "The chains of habit are too light to be felt until they are too heavy to be broken.",
  "Motivation gets you started. Discipline keeps you going.",
  "Energy flows where intention goes.",
  "The body achieves what the mind believes.",
  "No man is free who is not master of himself.",
  "Either you run the day or the day runs you.",
  "Endure now and enjoy later.",
  "Be the warrior, not the worrier.",
  "Rise above the storm and you will find the sunshine.",
];

const getDailyIndex = () => {
  const day = Math.floor(Date.now() / 86400000);
  return day % QUOTES.length;
};

export default function QuoteEngine() {
  const [quoteIndex, setQuoteIndex] = useState(getDailyIndex());
  const [visible, setVisible] = useState(true);
  const [floatUp, setFloatUp] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => {
      setFloatUp(true);
      setTimeout(() => setFloatUp(false), 1000);
    }, 8000);
    return () => clearInterval(interval);
  }, []);

  const nextQuote = () => {
    setVisible(false);
    setTimeout(() => {
      setQuoteIndex(i => (i + 1) % QUOTES.length);
      setVisible(true);
    }, 300);
  };

  return (
    <div className="relative rounded-2xl overflow-hidden border border-[#334155]/60 bg-gradient-to-br from-[#1E293B] to-[#0F172A] p-5 backdrop-blur-sm">
      <div className="absolute inset-0 bg-gradient-to-br from-[#3B82F6]/5 to-[#0EA5E9]/5 pointer-events-none" />

      <div
        className="relative transition-all duration-500"
        style={{
          opacity: visible ? 1 : 0,
          transform: `translateY(${visible ? (floatUp ? '-4px' : '0px') : '8px'})`,
          transition: 'opacity 0.4s ease, transform 0.8s ease'
        }}
      >
        <p className="text-sm text-[#3B82F6] font-semibold tracking-widest uppercase mb-2">Daily Principle</p>
        <p className="text-[#F8FAFC] text-base font-bold leading-relaxed text-center italic">
          "{QUOTES[quoteIndex]}"
        </p>
      </div>

      <button
        onClick={nextQuote}
        className="mt-4 flex items-center gap-1.5 mx-auto text-xs text-[#475569] hover:text-[#94A3B8] transition-colors group"
      >
        <RefreshCw className="w-3 h-3 group-hover:rotate-180 transition-transform duration-500" />
        New Quote
      </button>
    </div>
  );
}
