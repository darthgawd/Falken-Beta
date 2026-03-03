'use client';

import React, { useState } from 'react';
import { useEthPrice } from '@/lib/hooks';
import { 
  X, 
  Swords, 
  Coins, 
  Loader2, 
  ArrowRight,
  ShieldCheck,
  Zap
} from 'lucide-react';
import { useWriteContract, useWaitForTransactionReceipt, useAccount } from 'wagmi';
import { parseEther } from 'viem';
import { motion, AnimatePresence } from 'framer-motion';

const RPS_LOGIC = process.env.NEXT_PUBLIC_RPS_LOGIC_ADDRESS as `0x${string}`;
const ESCROW_ADDRESS = process.env.NEXT_PUBLIC_ESCROW_ADDRESS as `0x${string}`;

const ESCROW_ABI = [
  { name: 'createMatch', type: 'function', stateMutability: 'payable', inputs: [{ name: '_stake', type: 'uint256' }, { name: '_gameLogic', type: 'address' }], outputs: [] },
] as const;

export function CreateMatchModal({ isOpen, onClose }: { isOpen: boolean, onClose: () => void }) {
  const [stake, setStake] = useState('0.01');
  const { price } = useEthPrice();
  const { isConnected } = useAccount();
  
  const stakeUSD = price ? (parseFloat(stake || '0') * price) : 0;
  const isTooLow = stakeUSD < 2; // Lowered to $2 for beta testing

  const { writeContract, data: hash, isPending } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const handleCreate = () => {
    if (!stake || isTooLow || !isConnected) return;
    
    writeContract({
      address: ESCROW_ADDRESS,
      abi: ESCROW_ABI,
      functionName: 'createMatch',
      args: [parseEther(stake), RPS_LOGIC],
      value: parseEther(stake),
    });
  };

  if (isSuccess) {
    setTimeout(onClose, 2000);
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 font-mono">
          <motion.div 
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }} 
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/90 backdrop-blur-sm"
          />
          
          <motion.div 
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="relative w-full max-w-md bg-[#080808] border border-zinc-900 rounded-xl p-8 shadow-[0_0_50px_rgba(0,0,0,0.5)] overflow-hidden transition-colors"
          >
            {/* Background Accent */}
            <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/5 blur-3xl pointer-events-none" />

            <div className="flex justify-between items-start mb-8 relative z-10">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center border border-blue-500/20">
                  <Swords className="w-5 h-5 text-blue-500" />
                </div>
                <div>
                  <h2 className="text-xl font-black text-white uppercase italic tracking-tight">Match_Initializer</h2>
                  <p className="text-[10px] font-black text-blue-600 dark:text-gold uppercase tracking-[0.3em]">Neural_Engagement_System</p>
                </div>
              </div>
              <button onClick={onClose} className="p-2 hover:bg-zinc-900 rounded-lg transition-colors group">
                <X className="w-4 h-4 text-zinc-700 group-hover:text-zinc-400" />
              </button>
            </div>

            <div className="space-y-6 relative z-10">
              <div className="space-y-3">
                <label className="text-[10px] font-black text-blue-600 dark:text-gold uppercase tracking-[0.2em] px-1">Entry_Stake_Wei</label>
                <div className="relative">
                  <input 
                    type="number" 
                    step="0.001"
                    value={stake}
                    onChange={(e) => setStake(e.target.value)}
                    placeholder="0.01"
                    className={`w-full bg-[#0a0a0a] border ${isTooLow ? 'border-red-500/30' : 'border-zinc-900'} rounded-lg px-6 py-5 text-2xl font-black text-zinc-100 focus:outline-none focus:border-blue-500/50 transition-all tabular-nums`}
                  />
                  <div className="absolute right-6 top-1/2 -translate-y-1/2 flex flex-col items-end">
                    <span className={`text-[10px] font-black tabular-nums transition-colors ${isTooLow ? 'text-red-500' : 'text-zinc-500'}`}>
                      ≈ ${stakeUSD.toFixed(2)} USD
                    </span>
                    {isTooLow && (
                      <span className="text-[8px] font-black text-red-500 uppercase tracking-widest mt-1">Min $2.00</span>
                    )}
                  </div>
                </div>
              </div>

              <div className="bg-[#0a0a0a] border border-zinc-900 rounded-lg p-6 space-y-4">
                <div className="flex justify-between items-center text-[10px] font-black uppercase tracking-widest">
                  <span className="text-blue-600 dark:text-gold">Game_Logic</span>
                  <span className="text-blue-500">RPS_V1</span>
                </div>
                <div className="flex justify-between items-center text-[10px] font-black uppercase tracking-widest">
                  <span className="text-blue-600 dark:text-gold">Network_Relay</span>
                  <span className="text-zinc-400">BASE_SEPOLIA</span>
                </div>
                <div className="flex justify-between items-center text-[10px] font-black uppercase tracking-widest">
                  <span className="text-blue-600 dark:text-gold">Status</span>
                  <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                    <span className="text-blue-500">SYNCHRONIZED</span>
                  </div>
                </div>
              </div>

              {isSuccess ? (
                <div className="bg-emerald-500/5 border border-emerald-500/20 p-6 rounded-lg text-center space-y-2 animate-in zoom-in duration-500">
                  <ShieldCheck className="w-8 h-8 text-emerald-500 mx-auto" />
                  <p className="text-[10px] font-black text-emerald-500 uppercase tracking-[0.2em]">Deployment_Success</p>
                  <p className="text-[10px] text-zinc-500 uppercase">Match Hash synchronized to Arena Feed.</p>
                </div>
              ) : (
                <button 
                  onClick={handleCreate}
                  disabled={isTooLow || isPending || isConfirming || !isConnected}
                  className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-10 text-white font-black py-5 rounded-lg transition-all flex items-center justify-center gap-3 uppercase italic tracking-widest shadow-[0_0_30px_rgba(37,99,235,0.1)] active:scale-95"
                >
                  {isPending || isConfirming ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Initializing_Sequence...
                    </>
                  ) : (
                    <>
                      EXEC_INITIALIZE <Zap className="w-4 h-4" />
                    </>
                  )}
                </button>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
