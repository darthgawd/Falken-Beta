'use client';

import React from 'react';
import { Shield, User, LogOut, Settings } from 'lucide-react';
import { usePrivy } from '@privy-io/react-auth';
import Link from 'next/link';

export function Navbar() {
  const { login, logout, authenticated, user, ready } = usePrivy();
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  const escrowAddress = process.env.NEXT_PUBLIC_ESCROW_ADDRESS || '';
  const displayEscrow = escrowAddress ? `${escrowAddress.slice(0, 6)}...${escrowAddress.slice(-4)}` : 'No Contract';

  const address = user?.wallet?.address;
  const displayAddress = address ? `${address.slice(0, 6)}...${address.slice(-4)}` : '';

  return (
    <nav className="border-b border-zinc-800 bg-black/50 backdrop-blur-md sticky top-0 z-50 h-16">
      <div className="max-w-7xl mx-auto px-4 h-full flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
          <Shield className="w-8 h-8 text-blue-500 fill-blue-500/10" />
          <span className="font-bold text-xl tracking-tight text-white uppercase">BOTBYTE</span>
        </Link>

        <div className="flex items-center gap-6">
          <Link href="/vision" className="text-xs font-bold text-zinc-500 hover:text-white transition-colors uppercase tracking-widest">
            Vision
          </Link>
          <Link href="/onboarding" className="text-xs font-bold text-zinc-500 hover:text-white transition-colors uppercase tracking-widest text-nowrap">
            How to Play
          </Link>
          <div className="hidden lg:flex flex-col text-right">
            <span className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest text-nowrap">Escrow Contract</span>
            <span className="text-xs font-mono text-zinc-400">{displayEscrow}</span>
          </div>

          {!mounted || !ready ? (
            <div className="w-24 h-8 bg-zinc-900 animate-pulse rounded-xl" />
          ) : !authenticated ? (
            <button 
              onClick={login}
              className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold px-5 py-2 rounded-xl transition-all shadow-lg shadow-blue-500/10"
            >
              Sign In
            </button>
          ) : (
            <div className="flex items-center gap-3">
              <Link 
                href="/settings"
                className="p-2 hover:bg-zinc-800 rounded-lg text-zinc-400 hover:text-white transition-colors"
                title="Profile Settings"
              >
                <Settings className="w-4 h-4" />
              </Link>
              <div className="flex items-center gap-2 bg-zinc-900 border border-zinc-800 px-3 py-1.5 rounded-xl">
                <div className="w-5 h-5 rounded-full bg-blue-500/20 flex items-center justify-center">
                  <User className="w-3 h-3 text-blue-500" />
                </div>
                <span className="text-xs font-mono text-zinc-300">{displayAddress}</span>
              </div>
              <button 
                onClick={logout}
                className="p-2 hover:bg-red-500/10 rounded-lg text-zinc-500 hover:text-red-500 transition-colors"
                title="Sign Out"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      </div>
    </nav>
  );
}
