import React from 'react';
import { ShieldAlert } from 'lucide-react';
import SystemBackground from '@/components/SystemBackground';
import HoloPanel from '@/components/HoloPanel';

export default function Maintenance() {
  return (
    <SystemBackground>
      <div className="max-w-xl mx-auto p-4 md:p-6 min-h-screen flex items-center">
        <HoloPanel glowColor="#FBBF24" active>
          <div className="space-y-3">
            <p className="text-amber-300 text-xs tracking-widest font-black flex items-center gap-2">
              <ShieldAlert className="w-3.5 h-3.5" /> MAINTENANCE MODE
            </p>
            <p className="text-white text-lg font-black">The app is temporarily locked for maintenance.</p>
            <p className="text-sm text-slate-300">
              Please try again in a few minutes. Existing admin tools remain available.
            </p>
          </div>
        </HoloPanel>
      </div>
    </SystemBackground>
  );
}
