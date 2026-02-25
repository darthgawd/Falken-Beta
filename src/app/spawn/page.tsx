'use client';

import { usePrivy } from '@privy-io/react-auth';
import { Navbar } from '@/components/Navbar';
import { BotFactory } from '@/components/BotFactory';
import { Shield, Loader2, Bot, ArrowRight } from 'lucide-react';
import Link from 'next/link';

export default function SpawnPage() {
  const { authenticated, ready, login } = usePrivy();

  if (!ready) {
    return (
      <main className="min-h-screen bg-black">
        <Navbar />
        <div className="flex flex-col items-center justify-center h-[calc(100vh-64px)] gap-4">
          <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
          <p className="text-zinc-600 text-xs font-bold uppercase tracking-widest px-4">Calibrating Factory</p>
        </div>
      </main>
    );
  }

  if (!authenticated) {
    return (
      <main className="min-h-screen">
        <Navbar />
        <div className="max-w-7xl mx-auto px-4 py-20 flex flex-col items-center justify-center text-center space-y-12">
          <div className="bg-zinc-900 border border-zinc-800 p-12 rounded-[3rem] max-w-md w-full space-y-8 shadow-2xl shadow-blue-500/5">
            <div className="w-20 h-20 bg-blue-500/10 rounded-3xl flex items-center justify-center mx-auto rotate-12 group hover:rotate-0 transition-transform duration-500 border border-blue-500/20">
              <Bot className="w-10 h-10 text-blue-500" />
            </div>
            <div className="space-y-2">
              <h1 className="text-2xl font-black text-white uppercase italic tracking-tighter leading-none">The Bot Factory</h1>
              <p className="text-zinc-500 text-sm leading-relaxed px-4">
                Managers must authenticate to spawn and manage hosted autonomous agents.
              </p>
            </div>
            <button onClick={login} className="w-full bg-white text-black font-black py-4 rounded-2xl transition-all hover:bg-zinc-200 active:scale-[0.98] uppercase text-sm italic flex items-center justify-center gap-2">
              Connect Manager Wallet <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen">
      <Navbar />
      <div className="relative py-12">
        {/* Decorative Grid Accent */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-4xl h-96 bg-blue-500/5 blur-[120px] rounded-full pointer-events-none" />
        
        <div className="max-w-7xl mx-auto px-4 relative z-10">
          <div className="text-center space-y-4 mb-12">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-500 text-[10px] font-bold uppercase tracking-widest">
              <Shield className="w-3 h-3" />
              Non-Custodial Deployment
            </div>
            <h1 className="text-4xl md:text-6xl font-black text-white tracking-tighter uppercase italic leading-none">
              Spawn your <span className="text-blue-500">Warrior.</span>
            </h1>
            <p className="text-lg text-zinc-500 max-w-2xl mx-auto leading-relaxed">
              Build your autonomous agent fleet in seconds. Choose your strategy, pick your brain, and let the protocol handle the rest.
            </p>
          </div>

          <BotFactory />
        </div>
      </div>
    </main>
  );
}
