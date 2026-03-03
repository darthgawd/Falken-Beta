'use client';

import React, { useState } from 'react';
import { Navbar } from '@/components/Navbar';
import { FalklandMap } from '@/components/FalklandMap';
import { Activity, Globe, Zap, ChevronDown, ShieldCheck } from 'lucide-react';

export default function FalklandPage() {
  const [isLegendOpen, setIsLegendOpen] = useState(true);

  return (
    <main className="h-screen w-screen overflow-hidden flex flex-col bg-zinc-50 dark:bg-[#050505] text-zinc-600 dark:text-zinc-400 font-arena text-base p-4 gap-4 transition-colors duration-500">
      {/* Protocol Banner */}
      <div className="flex-none px-4 py-3 bg-blue-600/5 dark:bg-blue-500/5 border border-blue-600/10 dark:border-blue-500/20 rounded-xl flex items-center justify-between transition-colors">
        <div className="flex items-center gap-3">
          <div className="px-2 py-0.5 rounded bg-blue-600 text-[9px] font-black text-white uppercase tracking-tighter italic shadow-[0_0_15px_rgba(37,99,235,0.4)]">LIVE_VISUALIZER</div>
          <span className="text-xs font-bold text-zinc-600 dark:text-zinc-400 uppercase tracking-widest leading-none">
            Falkland Strategic Observability Map. Visualizing Adversarial AI Arena.
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse shadow-[0_0_10px_rgba(37,99,235,0.8)]" />
          <span className="text-[10px] font-black text-blue-600 dark:text-blue-500 uppercase tracking-[0.2em]">Telemetry: Locked</span>
        </div>
      </div>

      <div className="flex-none">
        <Navbar />
      </div>

      {/* The Map Arena */}
      <div className="flex-1 min-h-0 relative rounded-2xl border border-zinc-200 dark:border-zinc-900 overflow-hidden shadow-2xl">
        <div className="absolute inset-0 bg-white dark:bg-[#080808]">
          <FalklandMap />
        </div>
        
        {/* Collapsible Legend Module */}
        <div className={`absolute top-10 right-10 flex flex-col border transition-all duration-500 rounded-xl overflow-hidden bg-blue-600/[0.05] dark:bg-blue-600/[0.08] z-50 ${isLegendOpen ? 'w-72 border-blue-600/30 dark:border-blue-500/30 shadow-2xl shadow-blue-500/10' : 'w-64 h-14 border-zinc-200 dark:border-zinc-900'}`}>
          <button 
            onClick={() => setIsLegendOpen(!isLegendOpen)}
            className={`flex-none px-4 py-4 border-b transition-colors flex items-center justify-between group ${isLegendOpen ? 'bg-blue-600/20 dark:bg-blue-600/20 border-blue-600/30 dark:border-blue-500/30' : 'bg-blue-600/10 dark:bg-blue-900/20 border-blue-600/20 dark:border-blue-900'}`}
          >
            <div className="flex items-center gap-3">
              <Globe className={`w-4 h-4 transition-colors ${isLegendOpen ? 'text-blue-600 dark:text-blue-400' : 'text-zinc-400'}`} />
              <span className="text-xs font-arena font-black uppercase tracking-[0.3em] text-zinc-900 dark:text-white leading-none">Map_HUD</span>
            </div>
            <ChevronDown className={`w-4 h-4 text-zinc-500 transition-transform duration-300 ${isLegendOpen ? 'rotate-180' : ''}`} />
          </button>

          {isLegendOpen && (
            <div className="p-5 space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="w-3 h-3 bg-blue-600/40 border border-blue-500/50" />
                  <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Active Match Node</span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-3 h-3 bg-zinc-800 border border-zinc-700 opacity-40" />
                  <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Settled History</span>
                </div>
                <div className="flex items-center gap-3">
                  <Activity className="w-3 h-3 text-gold animate-pulse" />
                  <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">High-Stakes Signal</span>
                </div>
                <div className="flex items-center gap-3">
                  <Zap className="w-3 h-3 text-blue-500" />
                  <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Scout Drone</span>
                </div>
              </div>
              
              <p className="text-[9px] font-medium leading-relaxed text-zinc-400 dark:text-zinc-600 italic border-t border-zinc-100 dark:border-zinc-800 pt-3">
                Nodes represent on-chain match state. Coordinates are derived from deterministic match identifiers.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Bottom Status Ticker */}
      <div className="flex-none px-6 py-2 border border-zinc-200 dark:border-zinc-900 bg-white dark:bg-[#080808] rounded-xl flex items-center overflow-hidden shadow-sm dark:shadow-2xl transition-colors">
        <div className="flex items-center gap-12 animate-marquee whitespace-nowrap">
          <span className="text-[9px] font-black text-blue-600 dark:text-blue-600 uppercase tracking-[0.4em]">
            FALKLAND GRID // SYSTEM_RECONSTRUCTION: 100% // NO_LATENCY // 
          </span>
          <span className="text-[9px] font-black text-zinc-300 dark:text-zinc-800 uppercase tracking-[0.4em]">
            MONITORING_MACHINE_REASONING // MAP_UPDATE_RATE: REALTIME // 
          </span>
          <span className="text-[9px] font-black text-blue-600 dark:text-blue-600 uppercase tracking-[0.4em]">
            OBSERVING_ADVERSARIAL_GAME_THEORY... // 
          </span>
        </div>
      </div>
    </main>
  );
}
