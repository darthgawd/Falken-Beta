'use client';

import React, { useEffect, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { supabase } from '@/lib/supabase';
import { Navbar } from '@/components/Navbar';
import { StatsGrid } from '@/components/StatsGrid';
import { Leaderboard } from '@/components/Leaderboard';
import { MatchFeed } from '@/components/MatchFeed';
import { Terminal } from '@/components/Terminal';
import { Terminal as TerminalIcon, Swords, Activity, Zap, ShieldCheck } from 'lucide-react';

export default function ArenaPage() {
  const { authenticated, login } = usePrivy();
  const [activeTab, setActiveTab] = useState<'terminal' | 'arena'>('terminal');

  return (
    <main className="h-screen w-screen overflow-hidden flex flex-col bg-zinc-50 dark:bg-[#050505] text-zinc-600 dark:text-zinc-400 font-mono p-4 gap-4 transition-colors duration-500">
      {/* Top Navigation */}
      <div className="flex-none">
        <Navbar />
      </div>

      {/* Beta Disclaimer Banner */}
      <div className="flex-none px-4 py-2 bg-blue-600/5 dark:bg-blue-500/5 border border-blue-600/10 dark:border-blue-500/20 rounded-xl flex items-center justify-between transition-colors">
        <div className="flex items-center gap-3">
          <div className="px-2 py-0.5 rounded bg-gold text-[9px] font-black text-black uppercase tracking-tighter italic">BETA_V0.0.1</div>
          <span className="text-[10px] font-bold text-zinc-500 dark:text-zinc-500 uppercase tracking-widest">
            Falken Protocol is currently in early beta. Smart contracts are on Base Sepolia. Use with testnet funds only.
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
          <span className="text-[9px] font-black text-blue-600 dark:text-blue-500 uppercase tracking-[0.2em]">Live_Status: Optimizing</span>
        </div>
      </div>

      {/* Main Command Center Grid */}
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 gap-4">
        
        {/* Left Column: Intelligence Lens (Rankings) [3 Cols] */}
        <div className="lg:col-span-3 border border-zinc-200 dark:border-zinc-900 bg-white dark:bg-[#080808] rounded-xl flex flex-col min-h-0 shadow-sm dark:shadow-2xl overflow-hidden transition-colors">
          <div className="flex-none px-4 py-3 bg-zinc-100/50 dark:bg-zinc-900/20 border-b border-zinc-200 dark:border-zinc-900 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <ShieldCheck className="w-4 h-4 text-blue-600 dark:text-blue-500" />
              <span className="text-[10px] font-mono font-black uppercase tracking-[0.3em] text-gold">Intelligence_Lens</span>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
            <Leaderboard />
          </div>
        </div>

        {/* Center Column: The Primary Feed [6 Cols] */}
        <div className="lg:col-span-6 border border-zinc-200 dark:border-zinc-900 bg-white dark:bg-[#080808] rounded-xl flex flex-col min-h-0 shadow-sm dark:shadow-2xl overflow-hidden transition-colors">
          <div className="flex-none px-4 py-3 bg-zinc-100/50 dark:bg-zinc-900/20 border-b border-zinc-200 dark:border-zinc-900 flex items-center justify-between">
            <div className="flex gap-6">
              <button 
                onClick={() => setActiveTab('terminal')}
                className={`flex items-center gap-3 text-[10px] font-mono font-black tracking-[0.3em] uppercase transition-all ${activeTab === 'terminal' ? 'text-gold underline underline-offset-4 decoration-blue-500/50' : 'text-zinc-400 dark:text-zinc-600 hover:text-gold'}`}
              >
                <TerminalIcon className={`w-4 h-4 ${activeTab === 'terminal' ? 'text-blue-600 dark:text-blue-500' : 'text-zinc-300 dark:text-zinc-700'}`} />
                Intelligence_Terminal
              </button>
              <button 
                onClick={() => setActiveTab('arena')}
                className={`flex items-center gap-3 text-[10px] font-mono font-black tracking-[0.3em] uppercase transition-all ${activeTab === 'arena' ? 'text-gold underline underline-offset-4 decoration-blue-500/50' : 'text-zinc-400 dark:text-zinc-600 hover:text-gold'}`}
              >
                <Swords className={`w-4 h-4 ${activeTab === 'arena' ? 'text-blue-600 dark:text-blue-500' : 'text-zinc-300 dark:text-zinc-700'}`} />
                Engagement_Feed
              </button>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-blue-500/30 dark:bg-blue-500/50 animate-pulse" />
                <div className="w-1.5 h-1.5 rounded-full bg-blue-500/30 dark:bg-blue-500/50" />
              </div>
            </div>
          </div>
          <div className="flex-1 overflow-hidden relative">
            {activeTab === 'terminal' ? (
              <div className="absolute inset-0">
                <Terminal />
              </div>
            ) : (
              <div className="absolute inset-0 p-4 overflow-y-auto custom-scrollbar">
                <MatchFeed />
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Global Telemetry [3 Cols] */}
        <div className="lg:col-span-3 flex flex-col gap-4 min-h-0">
          
          {/* Module: Network Telemetry */}
          <div className="flex-1 border border-zinc-200 dark:border-zinc-900 bg-white dark:bg-[#080808] rounded-xl flex flex-col min-h-0 shadow-sm dark:shadow-2xl overflow-hidden transition-colors">
            <div className="flex-none px-4 py-3 bg-zinc-100/50 dark:bg-zinc-900/20 border-b border-zinc-200 dark:border-zinc-900 flex items-center gap-3">
              <Activity className="w-4 h-4 text-blue-600 dark:text-blue-500" />
              <span className="text-[10px] font-mono font-black uppercase tracking-[0.3em] text-gold">Global_Telemetry</span>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
              <StatsGrid />
              
              <div className="p-4 border border-zinc-200 dark:border-zinc-900 bg-zinc-50 dark:bg-zinc-900/10 rounded-xl space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-[9px] font-black text-zinc-400 dark:text-zinc-600 uppercase tracking-widest">Protocol_Link</span>
                  <div className="px-2 py-0.5 rounded bg-blue-600/5 dark:bg-blue-500/10 border border-blue-600/10 dark:border-blue-500/20 text-[8px] font-bold text-blue-600 dark:text-blue-500 uppercase">Secure</div>
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between text-[10px]">
                    <span className="text-zinc-400 dark:text-zinc-500 uppercase tracking-tighter">Network</span>
                    <span className="text-zinc-900 dark:text-zinc-200 font-bold tracking-tight">BASE_SEPOLIA</span>
                  </div>
                  <div className="flex justify-between text-[10px]">
                    <span className="text-zinc-400 dark:text-zinc-500 uppercase tracking-tighter">Sync_Status</span>
                    <span className="text-blue-600 dark:text-blue-500 font-bold tracking-tight uppercase">Optimal</span>
                  </div>
                  <div className="flex justify-between text-[10px]">
                    <span className="text-zinc-400 dark:text-zinc-500 uppercase tracking-tighter">Node_ID</span>
                    <span className="text-zinc-900 dark:text-zinc-200 font-bold tabular-nums">0XFALKEN_772</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Module: System Status Bar */}
          <div className="flex-none border border-zinc-200 dark:border-zinc-900 bg-white dark:bg-[#080808] rounded-xl p-4 flex flex-col gap-3 shadow-sm dark:shadow-2xl transition-colors">
            <div className="flex items-center gap-3">
              <Zap className="w-3 h-3 text-blue-600 dark:text-blue-500 animate-pulse" />
              <span className="text-[9px] font-black text-zinc-400 dark:text-zinc-500 uppercase tracking-widest">System_Load</span>
            </div>
            <div className="w-full h-1 bg-zinc-100 dark:bg-zinc-900 rounded-full overflow-hidden">
              <div className="h-full bg-blue-600 w-1/3 shadow-[0_0_10px_rgba(37,99,235,0.2)] dark:shadow-[0_0_10px_rgba(37,99,235,0.5)]" />
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Ticker */}
      <div className="flex-none px-6 py-2 border border-zinc-200 dark:border-zinc-900 bg-white dark:bg-[#080808] rounded-xl flex items-center overflow-hidden shadow-sm dark:shadow-2xl transition-colors">
        <div className="flex items-center gap-12 animate-marquee whitespace-nowrap">
          <span className="text-[9px] font-black text-blue-600 dark:text-blue-600 uppercase tracking-[0.4em]">
            FALKEN PROTOCOL // LOGIC IS ABSOLUTE // STAKES ARE REAL // 
          </span>
          <span className="text-[9px] font-black text-zinc-300 dark:text-zinc-800 uppercase tracking-[0.4em]">
            $FALK BURN_RATE: ACTIVE // MATCH_SETTLEMENT: ENCRYPTED // 
          </span>
          <span className="text-[9px] font-black text-blue-600 dark:text-blue-600 uppercase tracking-[0.4em]">
            SYNCHRONIZING NEURAL ARCHITECTURE... // 
          </span>
        </div>
      </div>

    </main>
  );
}
