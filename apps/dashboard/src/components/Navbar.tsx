'use client';

import React, { useState, useEffect } from 'react';
import { LogOut, Settings, UserPlus, User, ChevronDown, Loader2, Menu, X } from 'lucide-react';
import { FalconIcon } from './FalconIcon';
import { ThemeToggle } from './ThemeToggle';
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
import { motion, AnimatePresence } from 'framer-motion';

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
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

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
    setIsMobileMenuOpen(false);
    try {
      if (authenticated) await logout();
      if (isConnected) disconnect();
      router.push('/');
    } finally {
      setTimeout(() => setIsProcessing(false), 2000);
    }
  };

  const navLinks = [
    { href: '/arena', label: 'Arena' },
    { href: '/falkland', label: 'Falkland Arena' },
    { href: '/onboarding', label: 'How to Play' },
  ];

  return (
    <>
      <style jsx global>{`
        @keyframes pulse-yellow-blue {
          0%, 100% { color: #EAB308; fill: rgba(234, 179, 8, 0.1); }
          50% { color: #2563EB; fill: rgba(37, 99, 235, 0.1); }
        }
        .animate-pulse-yellow-blue {
          animation: pulse-yellow-blue 3s ease-in-out infinite;
        }
      `}</style>

      {/* Global Processing Overlay - Fixed Full Screen */}
      {isProcessing && (
        <div className="fixed inset-0 bg-white/90 dark:bg-black/90 backdrop-blur-xl z-[9999] flex flex-col items-center justify-center animate-in fade-in duration-500">
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

      <nav className="border-b border-zinc-300 dark:border-zinc-800 bg-blue-600/5 dark:bg-black/50 backdrop-blur-md sticky top-0 z-50 h-16 text-zinc-500 dark:text-zinc-400 font-sans text-xs transition-colors duration-500">
        <div className="max-w-7xl mx-auto px-4 h-full flex items-center justify-between lg:justify-between font-sans relative">
          
          {/* Mobile Menu Toggle - Left-ish but centered container */}
          <div className="lg:hidden flex items-center">
            <button 
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="p-2 text-zinc-900 dark:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
            >
              {isMobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
          </div>

          {/* Logo - Centered on mobile, left on desktop */}
          <div className="absolute left-1/2 -translate-x-1/2 lg:relative lg:left-0 lg:translate-x-0">
            <Link href="/" className="flex items-center gap-2 group transition-opacity" onClick={() => setIsMobileMenuOpen(false)}>
              <FalconIcon className="w-8 h-8 animate-pulse-yellow-blue group-hover:text-gold group-hover:fill-gold/10 transition-colors duration-300" color="currentColor" />
              <div className="flex items-baseline gap-1.5">
                <span className="font-bold text-xl tracking-tight text-zinc-900 dark:text-white uppercase tracking-tighter leading-none group-hover:text-gold transition-colors duration-300">FALKEN</span>
                <span className="font-black text-xs text-blue-600 dark:text-blue-500 uppercase tracking-[0.2em] italic leading-none hidden sm:inline">Protocol</span>
              </div>
            </Link>
          </div>

          {/* Desktop Links */}
          <div className="hidden lg:flex items-center gap-6 text-zinc-500 dark:text-zinc-500">
            {navLinks.map((link) => (
              <Link key={link.href} href={link.href} className="text-xs font-bold hover:text-zinc-900 dark:hover:text-white transition-all duration-500 uppercase tracking-widest text-nowrap px-3 py-2 rounded-lg border border-gold/30 dark:bg-gold/5 dark:text-gold dark:border dark:border-gold/30 hover:shadow-[0_0_15px_rgba(37,99,235,0.4)] dark:hover:shadow-[0_0_20px_rgba(59,130,246,0.5)]">
                {link.label}
              </Link>
            ))}
            
            <div className="hidden lg:flex flex-col text-right border-l border-zinc-200 dark:border-zinc-800 pl-6">
              <span className="text-[10px] font-bold text-zinc-400 dark:text-zinc-600 uppercase tracking-widest text-nowrap">Protocol Escrow</span>
              <a 
                href={`https://sepolia.basescan.org/address/${escrowAddress}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-mono text-zinc-500 dark:text-zinc-400 hover:text-blue-600 dark:hover:text-blue-500 transition-colors"
              >
                {displayEscrow}
              </a>
            </div>
          </div>

          {/* User Auth - Right Side */}
          <div className="flex items-center gap-3 relative">
            <div className="hidden sm:block">
              <ThemeToggle />
            </div>
            
            {!mounted || !ready ? (
              <div className="w-10 sm:w-32 h-10 bg-zinc-100 dark:bg-zinc-900 animate-pulse rounded-xl" />
            ) : !isLoggedIn ? (
              <div key="logged-out" className="flex items-center gap-2">
                <div className="hidden md:block">
                  <ConnectWallet 
                    disconnectedLabel="Base Sign-In"
                    className="bg-gold hover:bg-gold/90 text-black text-xs font-black px-6 py-2.5 rounded-xl transition-all uppercase italic tracking-tighter shadow-lg shadow-gold/10"
                  />
                </div>

                <button 
                  onClick={handleLogin}
                  className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold px-4 py-2.5 rounded-xl transition-all shadow-lg shadow-blue-500/10 uppercase"
                >
                  <UserPlus className="w-4 h-4" />
                  <span className="hidden sm:inline">Sign-In</span>
                </button>
              </div>
            ) : (
              <div key="logged-in" className="flex items-center gap-3">
                <div className="hidden md:block">
                  <WithdrawalUI />
                </div>
                
                <div className="relative">
                  <button 
                    onClick={() => setShowDropdown(!showDropdown)}
                    className="flex items-center gap-3 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 text-zinc-900 dark:text-white text-xs font-bold px-3 sm:px-4 py-2 rounded-xl transition-all shadow-sm dark:shadow-none"
                  >
                    <div className="w-6 h-6 rounded-full bg-blue-600/10 dark:bg-blue-500/20 flex items-center justify-center">
                      <User className="w-3.5 h-3.5 text-blue-600 dark:text-blue-500" />
                    </div>
                    <span className="font-mono hidden sm:inline">{displayAddress}</span>
                    <ChevronDown className={`w-4 h-4 text-zinc-400 dark:text-zinc-500 transition-transform ${showDropdown ? 'rotate-180' : ''}`} />
                  </button>

                  {showDropdown && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setShowDropdown(false)} />
                      <div className="absolute right-0 mt-2 w-64 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-2xl p-2 z-20 animate-in fade-in zoom-in-95 duration-200">
                        <div className="px-4 pt-3 pb-2 border-b border-zinc-100 dark:border-zinc-800/50 mb-1">
                          <p className="text-[10px] font-black text-zinc-400 dark:text-zinc-600 uppercase tracking-widest mb-1">Active Session</p>
                          <p className="text-xs font-mono text-zinc-900 dark:text-white truncate">{address}</p>
                        </div>
                        <div className="space-y-1">
                          <Link 
                            href="/settings"
                            onClick={() => setShowDropdown(false)}
                            className="flex items-center gap-3 w-full px-4 py-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-colors text-sm font-medium"
                          >
                            <Settings className="w-4 h-4" />
                            Settings
                          </Link>
                          <button 
                            onClick={handleLogout}
                            className="flex items-center gap-3 w-full px-4 py-2 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg text-zinc-500 hover:text-red-600 dark:hover:text-red-500 transition-colors text-sm font-medium text-left"
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



        {/* Mobile Menu Overlay */}
        <AnimatePresence>
          {isMobileMenuOpen && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="lg:hidden bg-white dark:bg-black border-b border-zinc-200 dark:border-zinc-800 overflow-hidden"
            >
              <div className="p-4 space-y-4">
                {navLinks.map((link) => (
                  <Link 
                    key={link.href} 
                    href={link.href}
                    onClick={() => setIsMobileMenuOpen(false)}
                    className="block text-sm font-black uppercase tracking-widest text-zinc-900 dark:text-white p-3 rounded-xl bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-100 dark:border-zinc-800"
                  >
                    {link.label}
                  </Link>
                ))}
                
                <div className="pt-4 border-t border-zinc-100 dark:border-zinc-800 flex flex-col gap-4">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-zinc-400 dark:text-zinc-600 uppercase tracking-widest">Protocol Escrow</span>
                    <ThemeToggle />
                  </div>
                  <a 
                    href={`https://sepolia.basescan.org/address/${escrowAddress}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-mono text-blue-600 dark:text-blue-500 break-all"
                  >
                    {escrowAddress}
                  </a>

                  {!isLoggedIn && (
                    <ConnectWallet 
                      disconnectedLabel="Base Sign-In"
                      className="w-full bg-gold hover:bg-gold/90 text-black text-xs font-black px-6 py-4 rounded-xl transition-all uppercase italic tracking-tighter shadow-lg shadow-gold/10 flex justify-center"
                    />
                  )}

                  {isLoggedIn && (
                    <div className="p-3 bg-zinc-50 dark:bg-zinc-900/50 rounded-xl border border-zinc-100 dark:border-zinc-800">
                       <WithdrawalUI />
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </nav>
    </>
  );
}
