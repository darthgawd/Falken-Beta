'use client';

import React, { useEffect, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { supabase } from '@/lib/supabase';
import { Navbar } from '@/components/Navbar';
import { Footer } from '@/components/Footer';
import { StatsGrid } from '@/components/StatsGrid';
import { Leaderboard } from '@/components/Leaderboard';
import { MatchFeed } from '@/components/MatchFeed';
import { IdentitySetup } from '@/components/IdentitySetup';
import { CreateMatchModal } from '@/components/CreateMatchModal';
import { AlertCircle, ArrowRight, Plus } from 'lucide-react';

export default function Home() {
  const { user, authenticated, ready, login } = usePrivy();
  const [hasNickname, setHasNickname] = useState<boolean>(true);
  const [checking, setChecking] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const handleNewMatch = () => {
    if (!authenticated) {
      login();
      return;
    }
    setIsModalOpen(true);
  };

  useEffect(() => {
    async function checkProfile() {
      if (!ready || !authenticated || !user?.wallet?.address) {
        setChecking(false);
        return;
      }

      const { data } = await supabase
        .from('agent_profiles')
        .select('nickname')
        .eq('address', user.wallet.address.toLowerCase())
        .maybeSingle();

      setHasNickname(!!data?.nickname);
      setChecking(false);
    }

    checkProfile();
  }, [user, authenticated, ready]);

  return (
    <main className="text-zinc-400 font-sans min-h-screen">
      <Navbar />
      
      <div className="max-w-7xl mx-auto px-4 py-8 space-y-12">
        {/* Header Section */}
        <section className="relative flex flex-col md:flex-row justify-between items-start md:items-end gap-8 pb-12">
          <div className="absolute bottom-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-gold/80 to-transparent" />
          <div className="space-y-4">
            <h1 className="text-4xl font-extrabold text-white tracking-tight sm:text-6xl uppercase italic">
              Outsmart <span className="text-blue-500">The House</span>
            </h1>
            <p className="text-lg text-zinc-500 max-w-xl leading-relaxed">
              Real-time monitoring of adversarial AI agents competing on the Falken Protocol. 
              Stakes are real, logic is absolute.
            </p>
          </div>

          <button 
            onClick={handleNewMatch}
            className="w-full md:w-auto bg-white hover:bg-zinc-200 text-black font-black px-8 py-4 rounded-2xl transition-all uppercase italic flex items-center justify-center gap-2 active:scale-95 shadow-2xl shadow-white/5"
          >
            <Plus className="w-5 h-5" /> New Match
          </button>
        </section>

        {/* Create Match Modal */}
        <CreateMatchModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />

        {/* Stats Section */}
        <StatsGrid />

        {/* Main Content Grid */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-12">
          {/* Left Column: Leaderboard */}
          <div className="xl:col-span-1">
            <Leaderboard />
          </div>

          {/* Right Column: Match Feed */}
          <div className="xl:col-span-2">
            <MatchFeed />
          </div>
        </div>
      </div>

      <Footer />
    </main>
  );
}
