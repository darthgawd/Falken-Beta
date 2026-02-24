'use client';

import React, { useState, useEffect } from 'react';
import { Shield, LogOut, Settings, UserPlus, User, ChevronDown, Loader2 } from 'lucide-react';
import { usePrivy } from '@privy-io/react-auth';
import { useAccount, useDisconnect } from 'wagmi';
import { WithdrawalUI } from './WithdrawalUI';
import Link from 'next/link';
import { 
  ConnectWallet, 
  Wallet, 
} from '@coinbase/onchainkit/wallet';
import { useName } from '@coinbase/onchainkit/identity';
import { baseSepolia } from 'viem/chains';
import { useRouter } from 'next/navigation';

export function Navbar() {
  const { login, logout, authenticated, ready, user } = usePrivy();
  const { address: wagmiAddress, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const router = useRouter();

  const address = wagmiAddress || user?.wallet?.address;
  const { data: basename } = useName({ address: address as `0x${string}`, chain: baseSepolia });
  
  const [mounted, setMounted] = React.useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  const escrowAddress = process.env.NEXT_PUBLIC_ESCROW_ADDRESS || '';
  const displayEscrow = escrowAddress ? `${escrowAddress.slice(0, 6)}...${escrowAddress.slice(-4)}` : 'No Contract';

  const isLoggedIn = authenticated || isConnected;
  const displayAddress = basename || (address ? `${address.slice(0, 6)}...${address.slice(-4)}` : '');

  const handleLogin = async () => {
    setIsProcessing(true);
    try {
      await login();
    } finally {
      setTimeout(() => setIsProcessing(false), 2000);
    }
  };

  const handleLogout = async () => {
    setIsProcessing(true);
    setShowDropdown(false);
    try {
      if (authenticated) await logout();
      if (isConnected) disconnect();
      router.push('/');
    } finally {
      setTimeout(() => setIsProcessing(false), 2000);
    }
  };

  return (
    <>
      {/* Global Processing Overlay - Fixed Full Screen */}
      {isProcessing && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-xl z-[9999] flex flex-col items-center justify-center animate-in fade-in duration-500">
          <div className="flex flex-col items-center gap-6">
            <div className="relative flex items-center justify-center">
              <Shield className="w-20 h-20 text-blue-500/10 animate-pulse" />
              <Loader2 className="w-12 h-12 text-blue-500 animate-spin absolute" />
            </div>
            <div className="flex flex-col items-center gap-2">
              <span className="text-xs font-black text-white uppercase tracking-[0.4em] italic ml-1 text-center">Synchronizing</span>
              <div className="w-32 h-[1px] bg-gradient-to-r from-transparent via-blue-500/50 to-transparent" />
            </div>
          </div>
        </div>
      )}

      <nav className="border-b border-zinc-800 bg-black/50 backdrop-blur-md sticky top-0 z-50 h-16 text-zinc-400 font-sans text-xs">
        <div className="max-w-7xl mx-auto px-4 h-full flex items-center justify-between font-sans">
          <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <Shield className="w-8 h-8 text-blue-500 fill-blue-500/10" />
            <div className="flex items-baseline gap-1.5">
              <span className="font-bold text-xl tracking-tight text-white uppercase tracking-tighter leading-none">BOTBYTE</span>
              <span className="font-black text-xs text-blue-500 uppercase tracking-[0.2em] italic leading-none">Protocol</span>
            </div>
          </Link>

          <div className="flex items-center gap-6 text-zinc-500">
            <Link href="/arena" className="text-xs font-bold hover:text-white transition-colors uppercase tracking-widest text-nowrap">
              Arena
            </Link>
            <Link href="/onboarding" className="text-xs font-bold hover:text-white transition-colors uppercase tracking-widest text-nowrap">
              How to Play
            </Link>
            
            <div className="hidden lg:flex flex-col text-right border-l border-zinc-800 pl-6">
              <span className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest text-nowrap">Protocol Escrow</span>
              <a 
                href={`https://sepolia.basescan.org/address/${escrowAddress}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-mono text-zinc-400 hover:text-blue-500 transition-colors"
              >
                {escrowAddress.slice(0, 6)}...{escrowAddress.slice(-4)}
              </a>
            </div>

            <div className="flex items-center gap-3 relative">
              {!mounted || !ready ? (
                <div className="w-32 h-10 bg-zinc-900 animate-pulse rounded-xl" />
              ) : !isLoggedIn ? (
                <div key="logged-out" className="flex items-center gap-2">
                  <Wallet>
                    <ConnectWallet 
                      disconnectedLabel="Base Sign-In"
                      className="bg-gold hover:bg-gold/90 text-black text-xs font-black px-6 py-2.5 rounded-xl transition-all uppercase italic tracking-tighter shadow-lg shadow-gold/10"
                    />
                  </Wallet>

                  <button 
                    onClick={handleLogin}
                    className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold px-4 py-2.5 rounded-xl transition-all shadow-lg shadow-blue-500/10 uppercase"
                  >
                    <UserPlus className="w-4 h-4" />
                    Sign-In
                  </button>
                </div>
              ) : (
                <div key="logged-in" className="flex items-center gap-3">
                  <WithdrawalUI />
                  
                  <div className="relative">
                    <button 
                      onClick={() => setShowDropdown(!showDropdown)}
                      className="flex items-center gap-3 bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-white text-xs font-bold px-4 py-2 rounded-xl transition-all"
                    >
                      <div className="w-6 h-6 rounded-full bg-blue-500/20 flex items-center justify-center">
                        <User className="w-3.5 h-3.5 text-blue-500" />
                      </div>
                      <span className="font-mono">{displayAddress}</span>
                      <ChevronDown className={`w-4 h-4 text-zinc-500 transition-transform ${showDropdown ? 'rotate-180' : ''}`} />
                    </button>

                    {showDropdown && (
                      <>
                        <div className="fixed inset-0 z-10" onClick={() => setShowDropdown(false)} />
                        <div className="absolute right-0 mt-2 w-64 bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl p-2 z-20 animate-in fade-in zoom-in-95 duration-200">
                          <div className="px-4 pt-3 pb-2 border-b border-zinc-800/50 mb-1">
                            <p className="text-[10px] font-black text-zinc-600 uppercase tracking-widest mb-1">Active Session</p>
                            <p className="text-xs font-mono text-white truncate">{address}</p>
                          </div>
                          <div className="space-y-1">
                            <Link 
                              href="/settings"
                              onClick={() => setShowDropdown(false)}
                              className="flex items-center gap-3 w-full px-4 py-2 hover:bg-zinc-800 rounded-lg text-zinc-400 hover:text-white transition-colors text-sm font-medium"
                            >
                              <Settings className="w-4 h-4" />
                              Settings
                            </Link>
                            <button 
                              onClick={handleLogout}
                              className="flex items-center gap-3 w-full px-4 py-2 hover:bg-red-500/10 rounded-lg text-zinc-500 hover:text-red-500 transition-colors text-sm font-medium text-left"
                            >
                              <LogOut className="w-4 h-4" />
                              Sign Out
                            </button>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </nav>
    </>
  );
}
