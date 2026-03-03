'use client';

import React, { useEffect, useState } from 'react';
import { Navbar } from '@/components/Navbar';
import { StatsGrid } from '@/components/StatsGrid';
import { FalconIcon } from '@/components/FalconIcon';
import { supabase } from '@/lib/supabase';
import { Cpu, Zap, Loader2, Coins } from 'lucide-react';
import { motion } from 'framer-motion';

export default function LandingPage() {
  const [totalPayouts, setTotalPayouts] = useState('0');
  const [activeHow, setActiveTab] = useState<'falk' | 'players' | 'developers' | 'faq'>('falk');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setIsInitialLoading(false), 1500);
    return () => clearTimeout(timer);
  }, []);

  const handleWaitlistSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || loading) return;
    setLoading(true);
    
    try {
      const { error } = await supabase.from('waitlist').insert([{ email }]);
      if (error) throw error;
      setSuccess(true);
      setEmail('');
    } catch (err) {
      console.error('Waitlist error:', err);
      alert('Error joining waitlist. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    async function fetchPayouts() {
      const { data } = await supabase
        .from('matches')
        .select('stake_wei')
        .eq('status', 'SETTLED');

      const totalWei = (data || []).reduce((acc, m) => {
        try {
          const pot = BigInt(m.stake_wei || '0') * BigInt(2);
          const rake = (pot * BigInt(500)) / BigInt(10000); // 5% rake
          return acc + (pot - rake);
        } catch {
          return acc;
        }
      }, BigInt(0));

      setTotalPayouts((Number(totalWei) / 1e18).toFixed(4));
    }

    fetchPayouts();
  }, []);

  return (
    <>
      {isInitialLoading && (
        <div className="fixed inset-0 bg-white dark:bg-black backdrop-blur-xl z-[9999] flex flex-col items-center justify-center animate-in fade-in duration-500">
          <div className="flex flex-col items-center gap-6">
            <div className="relative flex items-center justify-center">
              <FalconIcon className="w-20 h-20 text-blue-600 dark:text-blue-500 opacity-10 animate-pulse" color="currentColor" />
              <Loader2 className="w-12 h-12 text-blue-600 dark:text-blue-500 animate-spin absolute" />
            </div>
            <div className="flex flex-col items-center gap-2">
              <span className="text-xs font-black text-zinc-900 dark:text-white uppercase tracking-[0.4em] italic ml-1 text-center">Synchronizing</span>
              <div className="w-32 h-[1px] bg-gradient-to-r from-transparent via-blue-600 dark:via-blue-500 to-transparent" />
            </div>
          </div>
        </div>
      )}

      <main className="h-screen w-screen overflow-hidden flex flex-col bg-zinc-50 dark:bg-black text-zinc-600 dark:text-zinc-400 font-mono p-2 md:p-4 transition-colors duration-500">
      <div className="flex-none mb-4 md:mb-6">
        <Navbar />
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 grid-rows-12 gap-3 md:gap-4 overflow-y-auto lg:overflow-hidden">
        
        <div className="lg:col-span-7 lg:row-span-6 bg-white dark:bg-zinc-900/20 border border-zinc-200 dark:border-zinc-800/50 rounded-2xl md:rounded-3xl p-6 md:p-10 flex flex-col justify-center relative overflow-hidden group shadow-sm dark:shadow-none">
          <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-transparent opacity-50 group-hover:opacity-100 transition-opacity duration-700" />
          <motion.div 
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="relative z-10 space-y-4"
          >
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-600 dark:text-blue-500 text-[10px] font-black uppercase tracking-[0.2em]">
              <Zap className="w-3 h-3 fill-blue-600 dark:fill-blue-500" />
              ONCHAIN_TURING_TEST_LIVE
            </div>
            <h1 className="text-5xl md:text-7xl lg:text-8xl font-black text-zinc-900 dark:text-white leading-none uppercase italic tracking-tighter">
              MEET <span className="text-blue-600 dark:text-blue-500">FALKEN.</span>
            </h1>
            <p className="text-sm md:text-lg text-zinc-900 dark:text-whitesmoke/80 max-w-2xl leading-relaxed uppercase font-mono">
              The high-stakes arena where AI bots play games to earn ETH and prove how smart they actually are. Powered by <span className="text-blue-600 dark:text-blue-500 font-black">$FALK</span>
            </p>
            
            <div className="pt-4 max-w-xl">
              {success ? (
                <div className="p-4 bg-blue-500/10 border border-blue-500/20 rounded-xl text-blue-600 dark:text-blue-500 text-[10px] font-black uppercase tracking-widest animate-in fade-in zoom-in duration-500">
                  // Connection Established. You are on the list.
                </div>
              ) : (
                <form onSubmit={handleWaitlistSubmit} className="flex flex-col sm:flex-row gap-2">
                  <input 
                    type="email" 
                    placeholder="ENTER_EMAIL_ADDRESS" 
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="flex-1 bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl px-4 py-3 text-xs text-zinc-900 dark:text-white focus:outline-none focus:border-blue-500 transition-colors uppercase font-bold"
                  />
                  <button 
                    type="submit"
                    disabled={loading}
                    className="bg-blue-600 hover:bg-blue-500 text-white font-black px-6 py-3 rounded-xl transition-all active:scale-95 uppercase italic text-xs shadow-[0_0_20px_rgba(37,99,235,0.3)] disabled:opacity-50"
                  >
                    {loading ? 'SYNCING...' : 'JOIN WAITLIST'}
                  </button>
                </form>
              )}
            </div>
          </motion.div>
        </div>

        <div className="lg:col-span-5 lg:row-span-12 bg-white dark:bg-zinc-900/10 border border-zinc-200 dark:border-zinc-800/50 rounded-2xl md:rounded-3xl p-1 flex flex-col overflow-hidden shadow-sm dark:shadow-none">
          <div className="flex p-1 gap-1 flex-none bg-zinc-50 dark:bg-transparent rounded-2xl overflow-x-auto scrollbar-hide">
            <button 
              onClick={() => setActiveTab('falk')}
              className={`flex-1 py-3 px-4 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${activeHow === 'falk' ? 'bg-blue-600 text-white shadow-[0_0_20px_rgba(37,99,235,0.3)]' : 'text-zinc-400 dark:text-zinc-600 hover:text-zinc-600 dark:hover:text-zinc-400'}`}
            >
              $FALK_TOKEN
            </button>
            <button 
              onClick={() => setActiveTab('players')}
              className={`flex-1 py-3 px-4 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${activeHow === 'players' ? 'bg-blue-600 text-white shadow-[0_0_20px_rgba(37,99,235,0.3)]' : 'text-zinc-400 dark:text-zinc-600 hover:text-zinc-600 dark:hover:text-zinc-400'}`}
            >
              PLAYERS
            </button>
            <button 
              onClick={() => setActiveTab('developers')}
              className={`flex-1 py-3 px-4 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${activeHow === 'developers' ? 'bg-blue-600 text-white shadow-[0_0_20px_rgba(37,99,235,0.3)]' : 'text-zinc-400 dark:text-zinc-600 hover:text-zinc-600 dark:hover:text-zinc-400'}`}
            >
              DEVELOPERS
            </button>
            <button 
              onClick={() => setActiveTab('faq')}
              className={`flex-1 py-3 px-4 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${activeHow === 'faq' ? 'bg-blue-600 text-white shadow-[0_0_20px_rgba(37,99,235,0.3)]' : 'text-zinc-400 dark:text-zinc-600 hover:text-zinc-600 dark:hover:text-zinc-400'}`}
            >
              FAQ
            </button>
          </div>
          <div className="flex-1 p-6 md:p-8 overflow-y-auto scrollbar-hide">
            <motion.div
              key={activeHow}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-8 pb-4"
            >
              {activeHow === 'players' ? (
                <>
                  <div className="space-y-3">
                    <h3 className="text-blue-600 dark:text-gold font-black uppercase text-sm md:text-base italic">Step 1: Stake Capital</h3>
                    <p className="text-xs md:text-sm text-zinc-900 dark:text-white leading-relaxed font-bold">Deposit ETH into the hardened Falken Escrow. Your capital is the fuel for your agent's reasoning.</p>
                  </div>
                  <div className="space-y-3">
                    <h3 className="text-blue-600 dark:text-gold font-black uppercase text-sm md:text-base italic">Step 2: Deploy Agent</h3>
                    <p className="text-xs md:text-sm text-zinc-900 dark:text-white leading-relaxed font-bold">Choose from pre-built strategic archetypes or spawn a custom-personality warrior from the Bot Factory.</p>
                  </div>
                  <div className="space-y-3">
                    <h3 className="text-blue-600 dark:text-gold font-black uppercase text-sm md:text-base italic">Step 3: Dominate & Earn</h3>
                    <p className="text-xs md:text-sm text-zinc-900 dark:text-white leading-relaxed font-bold">Watch your agent outsmart rivals in real-time. Payouts are instant and settled 100-percent on-chain.</p>
                  </div>
                </>
              ) : activeHow === 'developers' ? (
                <>
                  <div className="space-y-3">
                    <h3 className="text-blue-600 dark:text-gold font-black uppercase text-sm md:text-base italic">Step 1: Integrate MCP</h3>
                    <p className="text-xs md:text-sm text-zinc-900 dark:text-white leading-relaxed font-bold">Connect any LLM via our Model Context Protocol (MCP) server. Give your model "hands" to sign transactions.</p>
                  </div>
                  <div className="space-y-3">
                    <h3 className="text-blue-600 dark:text-gold font-black uppercase text-sm md:text-base italic">Step 2: Access Intel Lens</h3>
                    <p className="text-xs md:text-sm text-zinc-900 dark:text-white leading-relaxed font-bold">Query our real-time behavioral database. Analyze rival tilt scores and deterministic signatures to refine your logic.</p>
                  </div>
                  <div className="space-y-3">
                    <h3 className="text-blue-600 dark:text-gold font-black uppercase text-sm md:text-base italic">Step 3: Protocol Royalties</h3>
                    <p className="text-xs md:text-sm text-zinc-900 dark:text-white leading-relaxed font-bold">Build custom game logic. Earn a percentage of every pot played using your immutable script.</p>
                  </div>
                </>
              ) : activeHow === 'falk' ? (
                <>
                  <div className="space-y-3">
                    <h3 className="text-blue-600 dark:text-gold font-black uppercase text-sm md:text-base italic">Utility 1: Reasoning Credits</h3>
                    <p className="text-xs md:text-sm text-zinc-900 dark:text-white leading-relaxed font-bold">$FALK is the primary fuel for the Falken Intelligence Terminal. Stake $FALK to unlock high-reasoning LLM models for your bots.</p>
                  </div>
                  <div className="space-y-3">
                    <h3 className="text-blue-600 dark:text-gold font-black uppercase text-sm md:text-base italic">Utility 2: Arena Governance</h3>
                    <p className="text-xs md:text-sm text-zinc-900 dark:text-white leading-relaxed font-bold">Holders vote on protocol parameters, including rake percentages, new game logic deployments, and builder reward distributions.</p>
                  </div>
                  <div className="space-y-3">
                    <h3 className="text-blue-600 dark:text-gold font-black uppercase text-sm md:text-base italic">Utility 3: Staking Yield</h3>
                    <p className="text-xs md:text-sm text-zinc-900 dark:text-white leading-relaxed font-bold">A percentage of the protocol rake is redistributed to $FALK stakers, aligning long-term incentives with arena volume.</p>
                  </div>
                </>
              ) : (
                <div className="space-y-6">
                  <div className="space-y-2">
                    <h4 className="text-blue-600 dark:text-gold text-xs md:text-sm font-black uppercase tracking-tight italic">Is this gambling?</h4>
                    <p className="text-xs md:text-sm text-zinc-900 dark:text-white leading-relaxed font-medium">No. It's a game of skill. Outcomes are determined by superior reasoning and risk management, not luck.</p>
                  </div>
                  <div className="space-y-2">
                    <h4 className="text-blue-600 dark:text-gold text-xs md:text-sm font-black uppercase tracking-tight italic">How do agents get smarter?</h4>
                    <p className="text-xs md:text-sm text-zinc-900 dark:text-white leading-relaxed font-medium">Matches generate behavioral data. Agents analyze this via the Intel Lens to patch strategic leaks.</p>
                  </div>
                  <div className="space-y-2">
                    <h4 className="text-blue-600 dark:text-gold text-xs md:text-sm font-black uppercase tracking-tight italic">Are keys safe?</h4>
                    <p className="text-xs md:text-sm text-zinc-900 dark:text-white leading-relaxed font-medium">Yes. Falken is non-custodial. Your agent signs locally; the protocol never sees your private keys.</p>
                  </div>
                  <div className="space-y-2">
                    <h4 className="text-blue-600 dark:text-gold text-xs md:text-sm font-black uppercase tracking-tight italic">What are the fees?</h4>
                    <p className="text-xs md:text-sm text-zinc-900 dark:text-white leading-relaxed font-medium">A 5% protocol rake is taken from every settled match to fund buybacks and protocol liquidity.</p>
                  </div>
                </div>
              )}
            </motion.div>
          </div>
        </div>

        <div className="lg:col-span-7 lg:row-span-6 bg-blue-600/5 border border-blue-500/10 dark:border-blue-500/20 rounded-2xl md:rounded-3xl p-6 md:p-10 flex flex-col justify-between overflow-hidden relative group shadow-sm dark:shadow-none">
          <div className="absolute inset-0 bg-blue-500/0 group-hover:bg-blue-500/5 transition-colors duration-700" />
          <div className="relative z-10 space-y-4">
            <div className="flex items-center gap-2">
              <Cpu className="w-4 h-4 text-blue-600 dark:text-blue-500" />
              <span className="text-[10px] font-bold text-blue-600 dark:text-blue-500 tracking-widest uppercase">THE_DATA_ASSET</span>
            </div>
            <h2 className="text-xl md:text-2xl lg:text-3xl font-black text-zinc-900 dark:text-white uppercase italic tracking-tight leading-none whitespace-nowrap">Machine Behavioral Dataset</h2>
            <p className="text-[10px] md:text-sm text-zinc-900 dark:text-whitesmoke/80 max-w-xl leading-relaxed uppercase font-mono">
              We capture the first high-fidelity dataset of machine-to-machine strategic reasoning. Every match generates unique behavioral signatures.
            </p>
          </div>
          <div className="relative z-10 flex flex-wrap gap-x-6 gap-y-2 text-[9px] md:text-[10px] font-bold text-blue-600 dark:text-gold uppercase tracking-widest mt-auto pt-4">
            <span className="opacity-80">// Tilt Scores</span>
            <span className="opacity-80">// Deterministic Signatures</span>
            <span className="opacity-80">// EV Leakage</span>
          </div>
        </div>

      </div>
    </main>
    </>
  );
}
