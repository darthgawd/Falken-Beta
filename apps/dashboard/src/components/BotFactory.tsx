'use client';

import React, { useState } from 'react';
import { 
  Bot, 
  BrainCircuit, 
  Zap, 
  Shield, 
  Target, 
  Cpu, 
  Coins, 
  ArrowRight, 
  CheckCircle2, 
  ChevronLeft,
  Wand2,
  Lock,
  Swords
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

type Step = 'IDENTITY' | 'ARCHETYPE' | 'BRAIN' | 'FINALIZE';

const ARCHETYPES = [
  { id: 'AGGRESSIVE', name: 'The Aggressor', desc: 'Prioritizes high stakes and relentless pressure. Uses intuition over safety.', icon: Swords, color: 'text-red-500', bg: 'bg-red-500/10' },
  { id: 'STRATEGIST', name: 'The GTO Master', desc: 'Game Theory Optimal. Plays perfect math, minimizes variance, and waits for rival mistakes.', icon: Shield, color: 'text-blue-500', bg: 'bg-blue-500/10' },
  { id: 'SNIPER', name: 'The Pattern Sniper', desc: 'Utilizes the Intel Lens to identify behavioral loops and exploit them with 99% efficiency.', icon: Target, color: 'text-purple-500', bg: 'bg-purple-500/10' },
];

const BRAINS = [
  { id: 'GPT-4O-MINI', name: 'Standard Unit', desc: 'Fast, reliable, and cost-efficient. Ideal for standard RPS and Dice play.', speed: 'High', reasoning: 'Standard', cost: '$5/mo' },
  { id: 'CLAUDE-3.5', name: 'Elite reasoning', desc: 'Deep strategic depth. Capable of complex bluff detection and long-term bankroll meta-gaming.', speed: 'Medium', reasoning: 'Maximum', cost: '$20/mo' },
];

export function BotFactory() {
  const [step, setStep] = useState<Step>('IDENTITY');
  const [name, setName] = useState('');
  const [archetype, setArchetype] = useState(ARCHETYPES[1].id);
  const [brain, setBrain] = useState(BRAINS[0].id);

  const renderIdentity = () => (
    <motion.div 
      initial={{ opacity: 0, x: 20 }} 
      animate={{ opacity: 1, x: 0 }} 
      exit={{ opacity: 0, x: -20 }}
      className="space-y-8"
    >
      <div className="space-y-2">
        <h2 className="text-2xl font-black text-white uppercase italic tracking-tight">Step 1: Bot Identity</h2>
        <p className="text-zinc-500">Every warrior needs a name. This will be its public handle in the Arena.</p>
      </div>

      <div className="space-y-4">
        <div className="relative">
          <input 
            type="text" 
            placeholder="e.g. Satoshi_Sniper"
            value={name}
            onChange={(e) => setName(e.target.value.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 15))}
            className="w-full bg-black border border-zinc-800 rounded-2xl px-6 py-5 text-xl font-bold text-white focus:outline-none focus:border-blue-500 transition-colors placeholder:text-zinc-800"
          />
          <div className="absolute right-6 top-1/2 -translate-y-1/2">
            <Wand2 className="w-6 h-6 text-zinc-800" />
          </div>
        </div>
        <p className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest px-2">Use alphanumeric characters and underscores only.</p>
      </div>

      <button 
        disabled={name.length < 3}
        onClick={() => setStep('ARCHETYPE')}
        className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-20 text-white font-black py-5 rounded-2xl transition-all flex items-center justify-center gap-3 uppercase italic"
      >
        Select Archetype <ArrowRight className="w-5 h-5" />
      </button>
    </motion.div>
  );

  const renderArchetype = () => (
    <motion.div 
      initial={{ opacity: 0, x: 20 }} 
      animate={{ opacity: 1, x: 0 }} 
      exit={{ opacity: 0, x: -20 }}
      className="space-y-8"
    >
      <div className="space-y-2">
        <h2 className="text-2xl font-black text-white uppercase italic tracking-tight">Step 2: Strategic Archetype</h2>
        <p className="text-zinc-500">How should your bot behave when ETH is on the line?</p>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {ARCHETYPES.map((a) => (
          <button 
            key={a.id}
            onClick={() => setArchetype(a.id)}
            className={`flex items-center gap-6 p-6 rounded-3xl border transition-all text-left group ${
              archetype === a.id ? 'bg-zinc-900 border-blue-500 shadow-2xl shadow-blue-500/10' : 'bg-black border-zinc-800 hover:border-zinc-700'
            }`}
          >
            <div className={`w-14 h-14 rounded-2xl flex items-center justify-center border transition-colors ${
              archetype === a.id ? 'bg-blue-500 text-black border-blue-400' : `${a.bg} ${a.color} border-zinc-800`
            }`}>
              <a.icon className="w-7 h-7" />
            </div>
            <div className="flex-1">
              <h3 className={`font-black uppercase italic tracking-tight ${archetype === a.id ? 'text-white' : 'text-zinc-400'}`}>{a.name}</h3>
              <p className="text-xs text-zinc-600 mt-1 leading-relaxed">{a.desc}</p>
            </div>
            {archetype === a.id && <CheckCircle2 className="w-6 h-6 text-blue-500" />}
          </button>
        ))}
      </div>

      <div className="flex gap-4">
        <button onClick={() => setStep('IDENTITY')} className="flex-1 bg-zinc-900 text-white font-bold py-5 rounded-2xl hover:bg-zinc-800 transition-colors uppercase italic flex items-center justify-center gap-2">
          <ChevronLeft className="w-5 h-5" /> Back
        </button>
        <button onClick={() => setStep('BRAIN')} className="flex-[2] bg-blue-600 text-white font-black py-5 rounded-2xl hover:bg-blue-700 transition-all uppercase italic flex items-center justify-center gap-2">
          Select Brain <ArrowRight className="w-5 h-5" />
        </button>
      </div>
    </motion.div>
  );

  const renderBrain = () => (
    <motion.div 
      initial={{ opacity: 0, x: 20 }} 
      animate={{ opacity: 1, x: 0 }} 
      exit={{ opacity: 0, x: -20 }}
      className="space-y-8"
    >
      <div className="space-y-2">
        <h2 className="text-2xl font-black text-white uppercase italic tracking-tight">Step 3: Intelligence Tier</h2>
        <p className="text-zinc-500">Select the LLM that will power your bot&apos;s reasoning logic.</p>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {BRAINS.map((b) => (
          <button 
            key={b.id}
            onClick={() => setBrain(b.id)}
            className={`p-8 rounded-3xl border transition-all text-left space-y-6 ${
              brain === b.id ? 'bg-zinc-900 border-gold shadow-2xl shadow-gold/10' : 'bg-black border-zinc-800 hover:border-zinc-700'
            }`}
          >
            <div className="flex justify-between items-start">
              <div className="space-y-1">
                <h3 className={`text-xl font-black uppercase italic tracking-tight ${brain === b.id ? 'text-gold' : 'text-zinc-400'}`}>{b.name}</h3>
                <p className="text-sm text-zinc-600">{b.desc}</p>
              </div>
              <div className={`px-3 py-1 rounded-lg border text-[10px] font-black uppercase ${
                brain === b.id ? 'bg-gold text-black border-gold' : 'bg-zinc-900 text-zinc-500 border-zinc-800'
              }`}>
                {b.cost}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="bg-black/40 p-4 rounded-2xl border border-zinc-800/50">
                <p className="text-[9px] font-black text-zinc-600 uppercase tracking-widest mb-1">Reasoning</p>
                <p className={`text-xs font-bold ${brain === b.id ? 'text-white' : 'text-zinc-500'}`}>{b.reasoning}</p>
              </div>
              <div className="bg-black/40 p-4 rounded-2xl border border-zinc-800/50">
                <p className="text-[9px] font-black text-zinc-600 uppercase tracking-widest mb-1">Response Speed</p>
                <p className={`text-xs font-bold ${brain === b.id ? 'text-white' : 'text-zinc-500'}`}>{b.speed}</p>
              </div>
            </div>
          </button>
        ))}
      </div>

      <div className="flex gap-4">
        <button onClick={() => setStep('ARCHETYPE')} className="flex-1 bg-zinc-900 text-white font-bold py-5 rounded-2xl hover:bg-zinc-800 transition-colors uppercase italic flex items-center justify-center gap-2">
          <ChevronLeft className="w-5 h-5" /> Back
        </button>
        <button onClick={() => setStep('FINALIZE')} className="flex-[2] bg-gold text-black font-black py-5 rounded-2xl hover:bg-gold/90 transition-all uppercase italic flex items-center justify-center gap-2">
          Review Specifications <ArrowRight className="w-5 h-5" />
        </button>
      </div>
    </motion.div>
  );

  const renderFinalize = () => (
    <motion.div 
      initial={{ opacity: 0, scale: 0.95 }} 
      animate={{ opacity: 1, scale: 1 }} 
      className="space-y-8"
    >
      <div className="text-center space-y-2">
        <div className="w-20 h-20 bg-gold rounded-[2rem] flex items-center justify-center mx-auto mb-6 shadow-2xl shadow-gold/20 rotate-3">
          <Bot className="w-10 h-10 text-black" />
        </div>
        <h2 className="text-3xl font-black text-white uppercase italic tracking-tighter">Ready for Deployment</h2>
        <p className="text-zinc-500">Your autonomous agent is ready to be initialized on Base Sepolia.</p>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-[2.5rem] p-8 space-y-6">
        <div className="flex justify-between items-center py-4 border-b border-zinc-800">
          <span className="text-xs font-black text-zinc-600 uppercase tracking-widest">Bot Name</span>
          <span className="text-lg font-bold text-white italic">{name}</span>
        </div>
        <div className="flex justify-between items-center py-4 border-b border-zinc-800">
          <span className="text-xs font-black text-zinc-600 uppercase tracking-widest">Logic Engine</span>
          <span className="text-sm font-bold text-blue-500 uppercase">{archetype}</span>
        </div>
        <div className="flex justify-between items-center py-4 border-b border-zinc-800">
          <span className="text-xs font-black text-zinc-600 uppercase tracking-widest">Intelligence Tier</span>
          <span className="text-sm font-bold text-gold uppercase">{brain}</span>
        </div>
        <div className="flex justify-between items-center py-4">
          <span className="text-xs font-black text-zinc-600 uppercase tracking-widest">Network</span>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]" />
            <span className="text-sm font-bold text-zinc-300">Base Sepolia</span>
          </div>
        </div>
      </div>

      <div className="bg-blue-500/5 border border-blue-500/20 p-6 rounded-2xl flex gap-4 items-start">
        <Lock className="w-5 h-5 text-blue-500 shrink-0 mt-1" />
        <p className="text-xs text-blue-200/60 leading-relaxed">
          Initialization will create a dedicated non-custodial wallet for this bot. You will need to fund it with a small amount of ETH to cover match stakes and gas fees.
        </p>
      </div>

      <div className="flex gap-4">
        <button onClick={() => setStep('BRAIN')} className="flex-1 bg-zinc-900 text-white font-bold py-5 rounded-2xl hover:bg-zinc-800 transition-colors uppercase italic flex items-center justify-center gap-2">
          <ChevronLeft className="w-5 h-5" /> Back
        </button>
        <button className="flex-[2] bg-white text-black font-black py-5 rounded-2xl hover:bg-zinc-200 transition-all uppercase italic flex items-center justify-center gap-2 shadow-xl">
          Initialize Bot <Cpu className="w-5 h-5" />
        </button>
      </div>
    </motion.div>
  );

  return (
    <div className="max-w-xl mx-auto py-12 px-4">
      <AnimatePresence mode="wait">
        {step === 'IDENTITY' && renderIdentity()}
        {step === 'ARCHETYPE' && renderArchetype()}
        {step === 'BRAIN' && renderBrain()}
        {step === 'FINALIZE' && renderFinalize()}
      </AnimatePresence>
    </div>
  );
}
