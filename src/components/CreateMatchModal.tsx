'use client';

import React, { useState } from 'react';
import { useEthPrice } from '@/lib/hooks';
import { 
  X, 
  Swords, 
  AlertCircle, 
  Coins, 
  Loader2, 
  ArrowRight,
  ShieldCheck
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
  const isTooLow = stakeUSD < 5;

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
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <motion.div 
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }} 
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/80 backdrop-blur-md"
          />
          
          <motion.div 
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="relative w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-[2.5rem] p-8 shadow-2xl overflow-hidden"
          >
            {/* Background Glow */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-32 bg-blue-500/10 blur-[80px] pointer-events-none" />

            <div className="flex justify-between items-start mb-8 relative z-10">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center border border-blue-500/20">
                  <Swords className="w-5 h-5 text-blue-500" />
                </div>
                <div>
                  <h2 className="text-xl font-black text-white uppercase italic tracking-tight">Open Arena</h2>
                  <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Create New Match</p>
                </div>
              </div>
              <button onClick={onClose} className="p-2 hover:bg-zinc-800 rounded-full transition-colors">
                <X className="w-5 h-5 text-zinc-500" />
              </button>
            </div>

            <div className="space-y-6 relative z-10">
              <div className="space-y-3">
                <label className="text-[10px] font-black text-zinc-600 uppercase tracking-[0.2em] px-1">Entry Stake (ETH)</label>
                <div className="relative">
                  <input 
                    type="number" 
                    step="0.001"
                    value={stake}
                    onChange={(e) => setStake(e.target.value)}
                    placeholder="0.01"
                    className={`w-full bg-black border ${isTooLow ? 'border-red-500/50' : 'border-zinc-800'} rounded-2xl px-6 py-5 text-2xl font-black text-white focus:outline-none focus:border-blue-500 transition-all`}
                  />
                  <div className="absolute right-6 top-1/2 -translate-y-1/2 flex flex-col items-end">
                    <span className={`text-xs font-black italic transition-colors ${isTooLow ? 'text-red-500' : 'text-gold'}`}>
                      ≈ ${stakeUSD.toFixed(2)} USD
                    </span>
                    {isTooLow && (
                      <span className="text-[8px] font-bold text-red-500 uppercase tracking-widest mt-1">Min $5.00 required</span>
                    )}
                  </div>
                </div>
              </div>

              <div className="bg-black/40 border border-zinc-800 rounded-2xl p-6 space-y-4">
                <div className="flex justify-between items-center text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                  <span>Match Logic</span>
                  <span className="text-blue-500">Rock-Paper-Scissors</span>
                </div>
                <div className="flex justify-between items-center text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                  <span>Network</span>
                  <span className="text-white">Base Sepolia</span>
                </div>
              </div>

              {isSuccess ? (
                <div className="bg-green-500/10 border border-green-500/20 p-6 rounded-2xl text-center space-y-2 animate-in zoom-in duration-500">
                  <ShieldCheck className="w-8 h-8 text-green-500 mx-auto" />
                  <p className="text-sm font-bold text-green-500 uppercase">Match Created Successfully</p>
                  <p className="text-xs text-zinc-500">The Arena is now open for opponents.</p>
                </div>
              ) : (
                <button 
                  onClick={handleCreate}
                  disabled={isTooLow || isPending || isConfirming || !isConnected}
                  className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-20 text-white font-black py-5 rounded-2xl transition-all flex items-center justify-center gap-3 uppercase italic shadow-xl shadow-blue-500/10 active:scale-95"
                >
                  {isPending || isConfirming ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Initializing...
                    </>
                  ) : (
                    <>
                      Initialize Match <ArrowRight className="w-5 h-5" />
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
