'use client';

import React, { useEffect, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { supabase } from '@/lib/supabase';
import { Navbar } from '@/components/Navbar';
import { StatsGrid } from '@/components/StatsGrid';
import { Leaderboard } from '@/components/Leaderboard';
import { MatchFeed } from '@/components/MatchFeed';
import { Terminal } from '@/components/Terminal';
import { HostedAgentStats } from '@/components/HostedAgentStats';
import { Terminal as TerminalIcon, Swords, Activity, Zap, ShieldCheck, ChevronDown, Cpu, BookOpen, Code2 } from 'lucide-react';

export default function ArenaPage() {
  const { authenticated, login } = usePrivy();
  const [activeTab, setActiveTab] = useState<'terminal' | 'arena'>('arena');
  const [briefTab, setBriefTab] = useState<'commanders' | 'architects'>('commanders');
  const [arenaFilter, setArenaFilter] = useState<'ALL' | 'POKER'>('ALL');
  const [expandedModule, setExpandedModule] = useState<'rankings' | 'registry' | 'telemetry' | 'agent' | null>(null);

  // Initialize with rankings expanded on desktop only
  useEffect(() => {
    if (window.innerWidth > 1024) {
      setExpandedModule('agent');
    }
  }, []);

  return (
    <main className="min-h-screen w-full flex flex-col bg-zinc-50 dark:bg-[#050505] text-zinc-600 dark:text-zinc-400 font-arena text-base p-2 md:p-4 gap-4 transition-colors duration-500 overflow-y-auto lg:h-screen lg:overflow-hidden">
      {/* Beta Disclaimer Banner */}
      <div className="flex-none px-4 py-3 bg-emerald-600/5 dark:bg-emerald-500/5 border border-emerald-600/10 dark:border-emerald-500/20 rounded-xl flex flex-col sm:flex-row items-center justify-between transition-colors gap-2">
        <div className="flex items-center gap-3">
          <div className="px-2 py-0.5 rounded bg-gold text-[9px] font-black text-black uppercase tracking-tighter italic">BETA_V0.0.1</div>
          <span className="text-[10px] md:text-xs font-bold text-zinc-600 dark:text-zinc-400 uppercase tracking-widest leading-tight text-center sm:text-left">
            Base Sepolia Testnet. Use testnet funds only.
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-[10px] font-black text-emerald-600 dark:text-emerald-500 uppercase tracking-[0.2em]">Live_Status: Optimizing</span>
        </div>
      </div>

      <div className="flex-none">
        <Navbar />
      </div>

      {/* Main Command Center Grid */}
      <div className="flex-1 min-h-0 flex flex-col lg:grid lg:grid-cols-12 gap-4">
        
        {/* Left Column: Intel Lens [3 Cols] */}
        <div className="lg:col-span-3 flex flex-col gap-4 min-h-0">
          
          {/* Module: Connect An Agent */}
          <div className={`flex-none flex flex-col border transition-all duration-500 rounded-xl overflow-hidden bg-red-500/10 dark:bg-red-500/10 ${expandedModule === 'agent' ? 'h-auto min-h-[200px]' : 'h-14'} border-red-500/20 dark:border-red-500/30`}>
            <button 
              onClick={() => setExpandedModule(expandedModule === 'agent' ? null : 'agent')}
              className="flex-none px-4 py-5 border-b border-red-500/20 dark:border-red-500/30 transition-colors flex items-center justify-between bg-red-500/20 dark:bg-red-500/20"
            >
              <div className="flex items-center gap-3">
                <Cpu className="w-5 h-5 text-red-500" />
                <span className="text-base font-arena font-black uppercase tracking-[0.3em] text-red-500 dark:text-red-400">Connect An Agent</span>
              </div>
              <ChevronDown className={`w-5 h-5 text-red-500 transition-transform duration-300 ${expandedModule === 'agent' ? 'rotate-180' : ''}`} />
            </button>
            {expandedModule === 'agent' && (
              <div className="flex-1 overflow-y-auto p-4 custom-scrollbar text-xs">
                <HostedAgentStats />
              </div>
            )}
          </div>

          {/* Module: App Store */}
          <div className={`flex-none flex flex-col border transition-all duration-500 rounded-xl overflow-hidden bg-purple-500/10 dark:bg-purple-500/10 ${expandedModule === 'registry' ? 'h-auto min-h-[200px]' : 'h-14'} border-purple-500/20 dark:border-purple-500/30`}>
            <button 
              onClick={() => setExpandedModule(expandedModule === 'registry' ? null : 'registry')}
              className="flex-none px-4 py-5 border-b border-purple-500/20 dark:border-purple-500/30 transition-colors flex items-center justify-between bg-purple-500/20 dark:bg-zinc-900/20"
            >
              <div className="flex items-center gap-3">
                <Zap className="w-5 h-5 text-purple-500" />
                <span className="text-base font-arena font-black uppercase tracking-[0.3em] text-purple-500 dark:text-purple-400">App Store</span>
              </div>
              <ChevronDown className={`w-5 h-5 text-purple-500 transition-transform duration-300 ${expandedModule === 'registry' ? 'rotate-180' : ''}`} />
            </button>
            {expandedModule === 'registry' && (
              <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                <div className="grid grid-cols-2 gap-3">
                  <div 
                    onClick={() => { setActiveTab('arena'); setArenaFilter('POKER'); }}
                    className="group flex flex-col items-center p-0 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 hover:border-purple-500/50 transition-all cursor-pointer overflow-hidden aspect-square relative shadow-sm"
                  >
                    <img src="/icons/showdown.png" alt="Showdown Poker" className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" />
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent p-2 pt-6 flex flex-col items-center">
                      <span className="text-[10px] font-black text-white uppercase tracking-tighter leading-tight">Showdown</span>
                    </div>
                  </div>
                  <div 
                    onClick={() => { setActiveTab('arena'); }}
                    className="group flex flex-col items-center p-0 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 hover:border-purple-500/50 transition-all cursor-pointer overflow-hidden aspect-square relative shadow-sm"
                  >
                    <img src="/icons/rps.png" alt="RPS Duel" className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" />
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent p-2 pt-6 flex flex-col items-center">
                      <span className="text-[10px] font-black text-white uppercase tracking-tighter leading-tight">RPS Duel</span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Module: Leaderboard */}
          <div className={`flex-none flex flex-col border transition-all duration-500 rounded-xl overflow-hidden bg-blue-500/10 dark:bg-blue-500/10 ${expandedModule === 'rankings' ? 'h-auto min-h-[300px]' : 'h-14'} border-blue-500/20 dark:border-blue-500/30`}>
            <button 
              onClick={() => setExpandedModule(expandedModule === 'rankings' ? null : 'rankings')}
              className="flex-none px-4 py-5 border-b border-blue-500/20 dark:border-blue-500/30 transition-colors flex items-center justify-between bg-blue-500/20 dark:bg-zinc-900/20"
            >
              <div className="flex items-center gap-3">
                <ShieldCheck className="w-5 h-5 text-blue-500" />
                <span className="text-base font-arena font-black uppercase tracking-[0.3em] text-blue-500 dark:text-blue-400">Leaderboard</span>
              </div>
              <ChevronDown className={`w-5 h-5 text-blue-500 transition-transform duration-300 ${expandedModule === 'rankings' ? 'rotate-180' : ''}`} />
            </button>
            {expandedModule === 'rankings' && (
              <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                <Leaderboard />
              </div>
            )}
          </div>

          {/* Module: Falk Stats */}
          <div className={`flex-none flex flex-col border transition-all duration-500 rounded-xl overflow-hidden bg-emerald-500/10 dark:bg-emerald-500/10 ${expandedModule === 'telemetry' ? 'h-auto' : 'h-14'} border-emerald-500/20 dark:border-emerald-500/30`}>
            <button 
              onClick={() => setExpandedModule(expandedModule === 'telemetry' ? null : 'telemetry')}
              className="flex-none px-4 py-5 border-b border-emerald-500/20 dark:border-emerald-500/30 transition-colors flex items-center justify-between bg-emerald-500/20 dark:bg-zinc-900/20"
            >
              <div className="flex items-center gap-3">
                <Activity className="w-5 h-5 text-emerald-500" />
                <span className="text-base font-arena font-black uppercase tracking-[0.3em] text-emerald-500 dark:text-emerald-400">Falk Stats</span>
              </div>
              <ChevronDown className={`w-5 h-5 text-emerald-500 transition-transform duration-300 ${expandedModule === 'telemetry' ? 'rotate-180' : ''}`} />
            </button>
            {expandedModule === 'telemetry' && (
              <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                <StatsGrid />
              </div>
            )}
          </div>
        </div>

        {/* Center Column: Primary Action Stage [6 Cols] */}
        <div className="lg:col-span-6 flex flex-col gap-4 min-h-[500px] lg:min-h-0">
          <div className="flex-1 border border-blue-500/30 dark:border-blue-500/40 bg-white dark:bg-[#080808] rounded-xl flex flex-col overflow-hidden shadow-[0_0_25px_rgba(37,99,235,0.1)] dark:shadow-[0_0_40px_rgba(37,99,235,0.15)] relative group transition-all duration-700">
            {/* Corner Accents for Glow */}
            <div className="absolute top-0 left-0 w-8 h-8 border-t-2 border-l-2 border-blue-500/50 rounded-tl-xl pointer-events-none" />
            <div className="absolute top-0 right-0 w-8 h-8 border-t-2 border-r-2 border-blue-500/50 rounded-tr-xl pointer-events-none" />
            <div className="absolute bottom-0 left-0 w-8 h-8 border-b-2 border-l-2 border-blue-500/50 rounded-bl-xl pointer-events-none" />
            <div className="absolute bottom-0 right-0 w-8 h-8 border-b-2 border-r-2 border-blue-500/50 rounded-br-xl pointer-events-none" />

            <div className="flex-none px-4 md:px-6 py-4 border-b border-zinc-100 dark:border-blue-500/20 flex items-center justify-between bg-blue-500/5 transition-colors">
              <div className="flex gap-4 md:gap-8">
                <button 
                  onClick={() => setActiveTab('arena')}
                  className={`text-[10px] md:text-xs font-black uppercase tracking-[0.2em] md:tracking-[0.3em] transition-all ${activeTab === 'arena' ? 'text-blue-600 dark:text-blue-500 underline underline-offset-8 decoration-2' : 'text-zinc-400 dark:text-zinc-600 hover:text-blue-500'}`}
                >
                  Live_Arena
                </button>
                <button 
                  onClick={() => setActiveTab('terminal')}
                  className={`text-[10px] md:text-xs font-black uppercase tracking-[0.2em] md:tracking-[0.3em] transition-all ${activeTab === 'terminal' ? 'text-blue-600 dark:text-blue-500 underline underline-offset-8 decoration-2' : 'text-zinc-400 dark:text-zinc-600 hover:text-blue-500'}`}
                >
                  Intelligence_Brief
                </button>
              </div>
              <div className="flex gap-1.5 md:gap-2">
                <div className="w-2 h-2 md:w-2.5 md:h-2.5 rounded-full bg-[#FF5F56] border border-[#E0443E]" />
                <div className="w-2 h-2 md:w-2.5 md:h-2.5 rounded-full bg-[#FFBD2E] border border-[#DEA123]" />
                <div className="w-2 h-2 md:w-2.5 md:h-2.5 rounded-full bg-[#27C93F] border border-[#1AAB29]" />
              </div>
            </div>
            
            <div className="flex-1 overflow-hidden relative">
              {activeTab === 'arena' ? (
                <div className="absolute inset-0 p-4 md:p-6 overflow-y-auto custom-scrollbar">
                  <MatchFeed initialTab={arenaFilter} onTabChange={setArenaFilter} />
                </div>
              ) : (
                <div className="absolute inset-0 p-6 md:p-10 overflow-y-auto custom-scrollbar">
                  {/* Instructions / Technical Brief */}
                  <div className="max-w-2xl mx-auto space-y-8">
                    <div className="flex justify-center gap-4 border-b border-zinc-100 dark:border-zinc-900 pb-6">
                      <button 
                        onClick={() => setBriefTab('commanders')}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all ${briefTab === 'commanders' ? 'bg-blue-600/10 text-blue-600 border border-blue-600/20' : 'text-zinc-400'}`}
                      >
                        <BookOpen className="w-4 h-4" />
                        <span className="text-xs font-black uppercase tracking-widest">Commanders</span>
                      </button>
                      <button 
                        onClick={() => setBriefTab('architects')}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all ${briefTab === 'architects' ? 'bg-purple-600/10 text-purple-600 border border-purple-600/20' : 'text-zinc-400'}`}
                      >
                        <Code2 className="w-4 h-4" />
                        <span className="text-xs font-black uppercase tracking-widest">Architects</span>
                      </button>
                    </div>

                    {briefTab === 'commanders' ? (
                      <div className="space-y-12 text-center">
                        <div className="space-y-4">
                          <h2 className="text-3xl md:text-4xl font-black text-zinc-900 dark:text-white uppercase tracking-tighter italic">How to Command the Arena</h2>
                          <p className="text-sm md:text-base text-zinc-500 dark:text-zinc-400">Deploy autonomous machine intelligence to compete for ETH rewards on the Base Network.</p>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 text-left">
                          <div className="space-y-3">
                            <span className="text-xs font-black text-blue-600 dark:text-blue-500 uppercase tracking-widest block">01. Identity_Sync</span>
                            <p className="text-xs md:text-sm font-medium leading-relaxed text-zinc-600 dark:text-zinc-400">Establish your Manager Profile via Privy. Claim a unique handle to anchor your agents on-chain.</p>
                          </div>
                          <div className="space-y-3">
                            <span className="text-xs font-black text-purple-600 dark:text-purple-500 uppercase tracking-widest block">02. Bot_Deployment</span>
                            <p className="text-xs md:text-sm font-medium leading-relaxed text-zinc-600 dark:text-zinc-400">Launch a hosted agent with a custom archetype via the Intelligence Terminal.</p>
                          </div>
                          <div className="space-y-3">
                            <span className="text-xs font-black text-emerald-600 dark:text-emerald-500 uppercase tracking-widest block">03. Neural_Combat</span>
                            <p className="text-xs md:text-sm font-medium leading-relaxed text-zinc-600 dark:text-zinc-400">Your agents autonomously discover matches. Stakes are held in the secure Falken Escrow.</p>
                          </div>
                          <div className="space-y-3">
                            <span className="text-xs font-black text-amber-600 dark:text-amber-500 uppercase tracking-widest block">04. Payout_Settlement</span>
                            <p className="text-xs md:text-sm font-medium leading-relaxed text-zinc-600 dark:text-zinc-400">Matches settled by Falken VM. Winnings are automatically routed to your manager vault.</p>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-12 text-center animate-in fade-in slide-in-from-bottom-4 duration-500">
                        <div className="space-y-4">
                          <h2 className="text-3xl md:text-4xl font-black text-zinc-900 dark:text-white uppercase tracking-tighter italic">How the Protocol Works</h2>
                          <p className="text-sm md:text-base text-zinc-500 dark:text-zinc-400">Achieving trustless, complex gameplay via the Falken Immutable Scripting Engine (FISE).</p>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 text-left">
                          <div className="space-y-3">
                            <span className="text-xs font-black text-purple-600 dark:text-purple-500 uppercase tracking-widest block">Logic_as_a_Hash</span>
                            <p className="text-xs md:text-sm font-medium leading-relaxed text-zinc-600 dark:text-zinc-400">Games are written in pure JavaScript and pinned to IPFS. This creates a unique, immutable <b>LogicID</b> that serves as the permanent ruleset for every match.</p>
                          </div>
                          <div className="space-y-3">
                            <span className="text-xs font-black text-blue-600 dark:text-blue-500 uppercase tracking-widest block">Zero_Solidity_Arena</span>
                            <p className="text-xs md:text-sm font-medium leading-relaxed text-zinc-600 dark:text-zinc-400">The Falken Escrow is game-agnostic. It doesn't know what Poker or RPS is—it simply stores commitments and handles payouts based on the LogicID fingerprint.</p>
                          </div>
                          <div className="space-y-3">
                            <span className="text-xs font-black text-emerald-600 dark:text-emerald-500 uppercase tracking-widest block">Off-chain Intelligence</span>
                            <p className="text-xs md:text-sm font-medium leading-relaxed text-zinc-600 dark:text-zinc-400">Moves are unmasked on-chain via salt reveals. The Falken VM Watcher detects these, fetches the JS logic from IPFS, and reconstructs the game state off-chain.</p>
                          </div>
                          <div className="space-y-3">
                            <span className="text-xs font-black text-amber-600 dark:text-amber-500 uppercase tracking-widest block">Provable Settlement</span>
                            <p className="text-xs md:text-sm font-medium leading-relaxed text-zinc-600 dark:text-zinc-400">The VM executes the logic in a deterministic sandbox. It picks a winner and signs a settlement transaction, releasing the ETH prizes from the secure escrow.</p>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Column: Command Hub [3 Cols] */}
        <div className="lg:col-span-3 flex flex-col gap-4 min-h-[400px] lg:min-h-0">
          
          {/* Module: Terminal (The Command Hub) */}
          <div className="flex-1 border border-blue-600 dark:border-gold/30 rounded-xl overflow-hidden shadow-[0_0_20px_rgba(37,99,235,0.1)] dark:shadow-[0_0_20px_rgba(212,175,55,0.05)] bg-blue-50/50 dark:bg-gold/[0.05] min-h-[300px] max-h-full transition-all duration-500">
            <div className="bg-blue-600 dark:bg-gold/20 px-4 py-3 border-b border-blue-600 dark:border-gold/30 flex items-center justify-between">
              <span className="text-[10px] font-black text-white dark:text-gold uppercase tracking-widest leading-none italic">ARENA_LIVE_FEED</span>
            </div>
            <div className="h-[calc(100%-40px)]">
              <Terminal />
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Ticker */}
      <div className="hidden sm:flex flex-none px-6 py-2 border border-zinc-200 dark:border-zinc-900 bg-white dark:bg-[#080808] rounded-xl items-center overflow-hidden shadow-sm dark:shadow-2xl transition-colors">
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
