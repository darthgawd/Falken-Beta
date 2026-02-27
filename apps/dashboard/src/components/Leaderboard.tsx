'use client';

import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

interface Profile {
  address: string;
  nickname?: string;
  elo: number;
  wins: number;
  losses: number;
  draws: number;
}

export function Leaderboard() {
  const [profiles, setProfiles] = useState<Profile[]>([]);

  useEffect(() => {
    async function fetchLeaderboard() {
      const { data } = await supabase
        .from('agent_profiles')
        .select('*')
        .or('nickname.is.null,nickname.not.ilike.StressBot_%')
        .order('wins', { ascending: false })
        .order('elo', { ascending: false })
        .limit(10);
      
      const activeProfiles = (data || []).filter(p => (p.wins + p.losses + p.draws) > 0);
      setProfiles(activeProfiles);
    }

    fetchLeaderboard();

    const channel = supabase
      .channel('leaderboard-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'agent_profiles' }, () => {
        fetchLeaderboard();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return (
    <div className="w-full transition-colors duration-500">
      <div className="flex flex-col gap-1">
        {profiles.map((profile, index) => {
          const total = profile.wins + profile.losses + profile.draws;
          const winRate = total > 0 ? ((profile.wins / total) * 100).toFixed(0) : '0';
          
          return (
            <div 
              key={profile.address} 
              className="flex items-center justify-between p-3 bg-white dark:bg-[#0a0a0a] border border-zinc-100 dark:border-zinc-900/50 hover:border-zinc-200 dark:hover:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-[#0c0c0c] transition-all rounded-md group"
            >
              <div className="flex items-center gap-4">
                <span className={`text-[10px] font-black w-4 text-center ${index < 3 ? 'text-blue-600 dark:text-blue-500' : 'text-zinc-200 dark:text-zinc-800'}`}>
                  {String(index + 1).padStart(2, '0')}
                </span>
                <div className="flex flex-col">
                  <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors truncate max-w-[120px]">
                    {profile.nickname || profile.address.slice(0, 6)}
                  </span>
                  <span className="text-[9px] font-bold text-zinc-300 dark:text-zinc-800 tracking-tighter tabular-nums uppercase">
                    {winRate}% WIN_RATE
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-6 text-right tabular-nums">
                <div className="flex flex-col">
                  <span className="text-[8px] font-black text-gold uppercase tracking-tighter mb-0.5">ELO</span>
                  <span className="text-sm font-black text-zinc-900 dark:text-zinc-100">{profile.elo}</span>
                </div>
                <div className="flex flex-col min-w-[70px]">
                  <span className="text-[8px] font-black text-gold uppercase tracking-tighter mb-0.5">W/L/D</span>
                  <div className="text-xs font-bold tracking-tight">
                    <span className="text-emerald-600 dark:text-green-600">{profile.wins}</span>
                    <span className="text-zinc-200 dark:text-zinc-800 mx-0.5">/</span>
                    <span className="text-red-600 dark:text-red-600">{profile.losses}</span>
                    <span className="text-zinc-200 dark:text-zinc-800 mx-0.5">/</span>
                    <span className="text-zinc-400 dark:text-zinc-600">{profile.draws}</span>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
        {profiles.length === 0 && (
          <div className="py-20 flex flex-col items-center justify-center gap-2 opacity-20 dark:opacity-10 grayscale">
            <div className="w-8 h-[1px] bg-zinc-400 dark:bg-zinc-800" />
            <span className="text-[9px] font-black text-zinc-400 dark:text-zinc-500 uppercase tracking-[0.4em]">NO_DATA</span>
          </div>
        )}
      </div>
    </div>
  );
}
