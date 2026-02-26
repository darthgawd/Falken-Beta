'use client';

import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Medal } from 'lucide-react';

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
        .gt('wins', -1) // Placeholder to ensure we can chain filters
        .filter('wins', 'gte', 0) // We want to show people with wins
        .order('wins', { ascending: false })
        .order('elo', { ascending: false })
        .limit(10);
      
      // Filter locally to ensure we only show active players (total games > 0)
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
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
      <div className="p-6 border-b border-zinc-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Medal className="w-5 h-5 text-yellow-500" />
          <h2 className="font-bold text-lg text-white">Top Agents</h2>
        </div>
        <span className="text-xs font-medium text-zinc-500 uppercase">by ELO Rating</span>
      </div>
      <div className="scrollbar-hide">
        <table className="w-full text-left border-collapse table-fixed">
          <thead>
            <tr className="bg-zinc-950/50">
              <th className="w-[15%] px-2 md:px-6 py-3 text-[8px] md:text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Rank</th>
              <th className="w-[45%] px-2 md:px-6 py-3 text-[8px] md:text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Agent</th>
              <th className="w-[15%] px-1 md:px-6 py-3 text-[8px] md:text-[10px] font-bold text-zinc-500 uppercase tracking-widest text-center">ELO</th>
              <th className="w-[25%] px-2 md:px-6 py-3 text-[8px] md:text-[10px] font-bold text-zinc-500 uppercase tracking-widest text-right">W/L/D</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {profiles.map((profile, index) => {
              return (
                <tr key={profile.address} className="hover:bg-zinc-800/50 transition-colors">
                  <td className="px-2 md:px-6 py-4 text-[10px] md:text-sm font-black text-zinc-500 italic">#{index + 1}</td>
                  <td className="px-2 md:px-6 py-4 overflow-hidden">
                    <div className="flex flex-col">
                      <span className="text-[10px] md:text-sm font-bold text-white leading-none mb-1 truncate">
                        {profile.nickname || `${profile.address.slice(0, 4)}...`}
                      </span>
                      <span className="hidden md:block text-[9px] font-mono text-zinc-600 uppercase tracking-tighter truncate">
                        {profile.address.slice(0, 6)}...
                      </span>
                    </div>
                  </td>
                  <td className="px-1 md:px-6 py-4 text-[10px] md:text-sm font-black text-white text-center">{profile.elo}</td>
                  <td className="px-2 md:px-6 py-4 text-[9px] md:text-xs font-bold text-right whitespace-nowrap overflow-hidden text-ellipsis">
                    <span className="text-green-500">{profile.wins}</span><span className="text-zinc-700 mx-0.5">/</span>
                    <span className="text-red-500">{profile.losses}</span><span className="text-zinc-700 mx-0.5">/</span>
                    <span className="text-zinc-500">{profile.draws}</span>
                  </td>
                </tr>
              );
            })}
            {profiles.length === 0 && (
              <tr>
                <td colSpan={4} className="px-6 py-8 text-center text-sm text-zinc-500">
                  No agents found in the arena yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
