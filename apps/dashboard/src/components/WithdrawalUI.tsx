'use client';

import React, { useEffect, useState } from 'react';
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { usePrivy } from '@privy-io/react-auth';
import { formatEther } from 'viem';
import { Coins, Loader2, CheckCircle2, Wallet } from 'lucide-react';

const ESCROW_ABI = [
  {
    name: 'pendingWithdrawals',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'withdraw',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
] as const;

export function WithdrawalUI() {
  const { user, authenticated } = usePrivy();
  const { address: wagmiAddress, isConnected: wagmiConnected } = useAccount();
  const [mounted, setMounted] = useState(false);

  const address = wagmiAddress || user?.wallet?.address;
  const isConnected = wagmiConnected || authenticated;

  useEffect(() => {
    setMounted(true);
  }, []);

  const escrowAddress = process.env.NEXT_PUBLIC_ESCROW_ADDRESS as `0x${string}`;

  const { data: pendingAmount, refetch } = useReadContract({
    address: escrowAddress,
    abi: ESCROW_ABI,
    functionName: 'pendingWithdrawals',
    args: [address as `0x${string}`],
    query: {
      enabled: !!address,
    },
  });

  const { writeContract, data: hash, isPending } = useWriteContract();

  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash,
  });

  useEffect(() => {
    if (isSuccess) {
      refetch();
    }
  }, [isSuccess, refetch]);

  if (!mounted || !isConnected || !pendingAmount || pendingAmount === 0n) return null;

  const handleWithdraw = () => {
    writeContract({
      address: escrowAddress,
      abi: ESCROW_ABI,
      functionName: 'withdraw',
    });
  };

  return (
    <div className="flex items-center gap-3 bg-blue-500/10 border border-blue-500/20 px-4 py-1.5 rounded-xl animate-in fade-in zoom-in duration-500">
      <div className="flex flex-col items-start">
        <span className="text-[8px] font-black text-blue-500 uppercase tracking-widest leading-none mb-1">Claimable</span>
        <div className="flex items-center gap-1.5">
          <Coins className="w-3 h-3 text-blue-400" />
          <span className="text-xs font-black text-white leading-none">
            {parseFloat(formatEther(pendingAmount)).toFixed(4)} ETH
          </span>
        </div>
      </div>

      <button
        onClick={handleWithdraw}
        disabled={isPending || isConfirming}
        className="ml-2 bg-blue-500 hover:bg-blue-400 disabled:opacity-50 text-black text-[10px] font-black px-3 py-1.5 rounded-lg transition-all uppercase italic tracking-tighter flex items-center gap-2"
      >
        {isPending || isConfirming ? (
          <Loader2 className="w-3 h-3 animate-spin" />
        ) : isSuccess ? (
          <CheckCircle2 className="w-3 h-3" />
        ) : (
          <>
            <Wallet className="w-3 h-3" />
            Claim
          </>
        )}
      </button>
    </div>
  );
}
